import { corsHeadersFor, handlePreflight } from '@/lib/cors';
import { SNAPSHOTS_BUCKET } from '@/lib/env';
import { errorJson, json } from '@/lib/http';
import { adminDb } from '@/lib/supabase/admin';
import { authenticateWidget } from '@/lib/widget-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

/**
 * ラウンドの変更前後（設計 7.1 / 画面F）
 *
 * ピンごとに before/after を撮るのではなく、ラウンド節目の全体撮影から
 * 切り出したものを返す。追加の撮影はしない。
 *
 * intended = false（意図しない変更）はここには出さない。
 * 社内で確認するものであって、クライアントに見せるものではない（7.4）。
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const headers = await corsHeadersFor(req.headers.get('origin'));
  const url = new URL(req.url);
  const auth = await authenticateWidget(req, url.searchParams.get('projectKey'));
  if (!auth.ok) return errorJson(auth.error, auth.status, headers);

  const { id: roundId } = await ctx.params;
  const db = adminDb();

  const { data: round } = await db
    .from('rounds')
    .select('id, seq, status, project_id')
    .eq('id', roundId)
    .eq('project_id', auth.project.id)
    .maybeSingle();
  if (!round) return errorJson('ラウンドが見つかりません', 404, headers);

  // 公開前の中身は見せない（9.8: 公開は人間の判断で行う）
  if (!['published', 'confirmed', 'closed_auto'].includes(round.status)) {
    return json({ round: { seq: round.seq, status: round.status }, items: [] }, { headers });
  }

  const { data: snaps } = await db
    .from('snapshots')
    .select('id, phase, taken_at')
    .eq('round_id', roundId)
    .eq('status', 'ready')
    .in('phase', ['before', 'after'])
    .order('taken_at');

  const beforeSnap = (snaps ?? []).filter((s) => s.phase === 'before').pop();
  const afterSnap = (snaps ?? []).filter((s) => s.phase === 'after').pop();

  const { data: requests } = await db
    .from('requests')
    .select('id, seq, body')
    .eq('round_id', roundId)
    .order('seq');

  const snapIds = [beforeSnap?.id, afterSnap?.id].filter(Boolean) as string[];
  const shots = snapIds.length
    ? ((
        await db
          .from('request_shots')
          .select('request_id, snapshot_id, crop_path, match_tier, diff_path, diff_ratio')
          .in('snapshot_id', snapIds)
      ).data ?? [])
    : [];

  const paths = [
    ...shots.map((s) => s.crop_path),
    ...shots.map((s) => s.diff_path),
  ].filter(Boolean) as string[];
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await db.storage.from(SNAPSHOTS_BUCKET).createSignedUrls(paths, 900);
    for (const u of urls ?? []) if (u.signedUrl && u.path) signed.set(u.path, u.signedUrl);
  }

  const pick = (requestId: string, snapshotId?: string) => {
    if (!snapshotId) return null;
    const s = shots.find((x) => x.request_id === requestId && x.snapshot_id === snapshotId);
    return s?.crop_path ? (signed.get(s.crop_path) ?? null) : null;
  };

  const items = (requests ?? []).map((r) => {
    // 差分画像は after 側のショットに載っている（7.4 末尾）
    const afterShot = shots.find(
      (x) => x.request_id === r.id && x.snapshot_id === afterSnap?.id,
    );
    return {
      requestId: r.id,
      seq: r.seq,
      body: r.body,
      before: pick(r.id, beforeSnap?.id),
      after: pick(r.id, afterSnap?.id),
      diff: afterShot?.diff_path ? (signed.get(afterShot.diff_path) ?? null) : null,
      diffRatio: afterShot?.diff_ratio ?? null,
    };
  });

  return json(
    {
      round: { seq: round.seq, status: round.status },
      hasBefore: !!beforeSnap,
      hasAfter: !!afterSnap,
      items: items.filter((i) => i.before || i.after),
    },
    { headers },
  );
}
