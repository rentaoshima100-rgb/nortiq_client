import { corsHeadersFor, handlePreflight } from '@/lib/cors';
import { errorJson, json } from '@/lib/http';
import { normalizePagePath } from '@/lib/sanitize';
import { adminDb } from '@/lib/supabase/admin';
import { authenticateWidget } from '@/lib/widget-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

export async function GET(req: Request) {
  const headers = await corsHeadersFor(req.headers.get('origin'));
  const url = new URL(req.url);
  const projectKey = url.searchParams.get('projectKey');
  const path = normalizePagePath(url.searchParams.get('path') || '/');

  const auth = await authenticateWidget(req, projectKey);
  if (!auth.ok) return errorJson(auth.error, auth.status, headers);

  const { data, error } = await adminDb()
    .from('requests')
    .select('id, seq, status, category, body, locator, locator_live, created_at')
    .eq('project_id', auth.project.id)
    .eq('page_path', path)
    /*
     * 完了（done）はサイトに出さない。
     *
     * 直し終えた箇所に番号が浮いていても読む側の役に立たない。そして
     * **目印が外れやすいのはまさに完了分**で、直したことで本文が変わり、
     * 手がかりが同時に死ぬ。地図から降ろして、記録の側に残す。
     * 「何をしたか」（resolution）を一覧に出すので、黙って消えはしない。
     *
     * 見送り（wont_fix）は残す。以前は除いていたが、一覧には出していたので
     * **片方にだけ載っている**状態になり、「選び直そうとしたら見つからない」
     * という形で出た（#23）。地図の側だけ欠けているのは筋が通らない。
     */
    .neq('status', 'done')
    .order('seq', { ascending: true })
    .limit(200);

  if (error) return errorJson('ピンの取得に失敗しました', 500, headers);

  return json(
    {
      pins: (data ?? []).map((r) => ({
        id: r.id,
        seq: r.seq,
        status: r.status,
        category: r.category,
        body: r.body,
        // 打ち直した錨があればそちら。原本（locator）は照合には使わないが残す
        locator: (r as { locator_live?: unknown }).locator_live ?? r.locator,
        createdAt: r.created_at,
      })),
    },
    { headers },
  );
}

/**
 * 錨を打ち直す。
 *
 * ウィジェットが要素を当てられたときに、その場の手がかりを送ってくる。
 * 次の訪問は「1回前のデプロイの DOM」と照合することになり、差が溜まらない。
 * これをやらないと、サイトを直すたびにロケータが古びて、いつか当たらなくなる。
 *
 * **原本（locator）は書き換えない。** あれは「何を押したか」の記録で、
 * 5.2 の監査対象。打ち直しは派生値なので locator_live に置く。
 */
export async function POST(req: Request) {
  const headers = await corsHeadersFor(req.headers.get('origin'));

  let body: { projectKey?: string; anchors?: { id?: string; locator?: unknown }[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return errorJson('リクエストが不正です', 400, headers);
  }

  const auth = await authenticateWidget(req, body.projectKey ?? null);
  if (!auth.ok) return errorJson(auth.error, auth.status, headers);

  // 1ページ分。多すぎるものは相手にしない
  const anchors = (body.anchors ?? []).slice(0, 200).filter((a) => {
    if (!a.id || typeof a.id !== 'string') return false;
    const l = a.locator as { tag?: unknown; bbox?: unknown } | null;
    return !!l && typeof l.tag === 'string' && !!l.bbox;
  });
  if (!anchors.length) return json({ updated: 0 }, { headers });

  const db = adminDb();
  const now = new Date().toISOString();
  let updated = 0;
  for (const a of anchors) {
    // project_id で必ず絞る。他人の案件の依頼を書き換えられないようにする
    const { error } = await db
      .from('requests')
      .update({ locator_live: a.locator, locator_live_at: now } as never)
      .eq('id', a.id!)
      .eq('project_id', auth.project.id);
    if (!error) updated++;
  }

  return json({ updated }, { headers });
}
