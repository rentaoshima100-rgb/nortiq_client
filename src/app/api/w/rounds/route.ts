import { corsHeadersFor, handlePreflight } from '@/lib/cors';
import { errorJson, json } from '@/lib/http';
import {
  activeRound,
  daysUntil,
  jaStatus,
  runDueTransitions,
  usedFreeRounds,
} from '@/lib/rounds';
import { adminDb } from '@/lib/supabase/admin';
import type { Locator } from '@/lib/types';
import { authenticateWidget } from '@/lib/widget-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 目印が外れたときに、本人が場所を思い出すための手がかり。
 *
 * 修正を当てると、指していた要素の文言そのものが変わる。目印は
 * その文言を頼りにしているので、直した瞬間に外れることがある。
 * そのとき「依頼 #12 の箇所が分かりません」とだけ出しても、本人は
 * 何のことか思い出せない。**依頼を出した当時の値**を添えて返す。
 *
 * 当時の値を使うのが要点。打ち直した錨（locator_live）は今の DOM を
 * 指しているので、思い出す助けにはならない。
 */
function hintOf(
  original: Locator | null,
  live: Locator | null,
): { text: string | null; percent: number | null; kind: string | null } {
  const o = original ?? live;
  if (!o) return { text: null, percent: null, kind: null };
  const sample = (o.textSample ?? '').trim();
  const h = Math.max(1, o.docHeight || 0);
  const y = o.bbox?.y ?? 0;
  return {
    text: sample ? sample.slice(0, 60) : null,
    percent: o.docHeight ? Math.min(100, Math.max(0, Math.round((y / h) * 100))) : null,
    kind: o.tag ? o.tag.toLowerCase() : null,
  };
}

export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

/** ウィジェットのフィードバックタブ（画面B）が使う。 */
export async function GET(req: Request) {
  const headers = await corsHeadersFor(req.headers.get('origin'));
  const url = new URL(req.url);
  const projectKey = url.searchParams.get('projectKey');

  const auth = await authenticateWidget(req, projectKey);
  if (!auth.ok) return errorJson(auth.error, auth.status, headers);

  const db = adminDb();
  const projectId = auth.project.id;

  // 読まれたときに期限の遷移へ追いつく（スケジューラを前提にしない）
  await runDueTransitions(projectId, db);

  const roundsEnabled = auth.project.rounds_enabled !== false;

  const [round, used] = await Promise.all([
    activeRound(projectId, db),
    usedFreeRounds(projectId, db),
  ]);

  const { data: reqs } = await db
    .from('requests')
    // locator は「そのとき何を指していたか」を思い出してもらうために要る。
    // 修正を当てると目印が外れることがあり、そのとき本人が場所を
    // 特定できないと、指し直しをお願いしても答えようがない。
    .select(
      'id, seq, body, status, category, page_path, round_id, created_at, client_question, client_answer, locator, locator_live',
    )
    .eq('project_id', projectId)
    .order('seq', { ascending: false })
    .limit(60);

  const carriedOver = (reqs ?? []).filter((r) => r.round_id === null).length;
  const inRound = round ? (reqs ?? []).filter((r) => r.round_id === round.id) : [];

  return json(
    {
      roundsEnabled,
      // contract は常に返す。ウィジェットは 5分キャッシュされるので、
      // API を先に変えると古い版が残っている間だけ形が食い違う。
      // null にすると古い版が d.contract.xxx で落ちるので、
      // 「出すかどうか」は roundsEnabled で判断させ、中身は常に入れておく。
      contract: {
        freeRounds: auth.project.free_rounds,
        usedFreeRounds: used,
        // 「ラウンド 2 / 3」の分子。進行中のものを含めた見え方にする
        currentIndex: Math.min(used + (round ? 1 : 0), auth.project.free_rounds + 99),
      },
      round: !roundsEnabled || !round
        ? null
        : {
            id: round.id,
            seq: round.seq,
            status: round.status,
            statusLabel: jaStatus(round.status),
            countsFree: round.counts_free,
            rejectCount: round.reject_count ?? 0,
            itemCount: inRound.length,
            maxItems: auth.project.max_items_per_round,
            freezeInDays: round.status === 'open' ? daysUntil(round.freeze_due_at) : null,
            confirmInDays: round.status === 'published' ? daysUntil(round.confirm_due_at) : null,
            canConfirm: round.status === 'published',
            canReject: round.status === 'published' && (round.reject_count ?? 0) < 2,
          },
      carriedOverCount: carriedOver,
      requests: (reqs ?? []).map((r) => ({
        id: r.id,
        seq: r.seq,
        body: r.body,
        status: r.status,
        category: r.category,
        pagePath: r.page_path,
        createdAt: r.created_at,
        // 値が無くて進められない依頼は、本人に聞く（13.4: AI の語は出さない）
        question: r.client_question ?? null,
        answered: !!r.client_answer,
        inCurrentRound: !!round && r.round_id === round.id,
        carriedOver: r.round_id === null,
        // 目印が外れたときの手がかり。**依頼を出した当時の**値を出す。
        // 「そのとき何と書いてあったか」「ページのどのあたりか」が分かれば、
        // 本人はたいてい思い出せる。
        hint: hintOf(r.locator as Locator | null, r.locator_live as Locator | null),
      })),
    },
    { headers },
  );
}
