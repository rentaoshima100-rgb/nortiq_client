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
import { authenticateWidget } from '@/lib/widget-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    .select('id, seq, body, status, category, page_path, round_id, created_at')
    .eq('project_id', projectId)
    .order('seq', { ascending: false })
    .limit(60);

  const carriedOver = (reqs ?? []).filter((r) => r.round_id === null).length;
  const inRound = round ? (reqs ?? []).filter((r) => r.round_id === round.id) : [];

  return json(
    {
      roundsEnabled,
      contract: !roundsEnabled ? null : {
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
        inCurrentRound: !!round && r.round_id === round.id,
        carriedOver: r.round_id === null,
      })),
    },
    { headers },
  );
}
