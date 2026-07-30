import { corsHeadersFor, handlePreflight } from '@/lib/cors';
import { errorJson, json } from '@/lib/http';
import { rejectRound } from '@/lib/rounds';
import { adminDb } from '@/lib/supabase/admin';
import { authenticateWidget } from '@/lib/widget-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

/**
 * 「直っていない箇所があります」（8.6）
 * カウントは据え置き。新しい指摘は受け付けず、そのラウンドの既存依頼から選ばせる。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const headers = await corsHeadersFor(req.headers.get('origin'));
  const body = (await req.json().catch(() => null)) as {
    projectKey?: string;
    requestIds?: unknown;
  } | null;

  const auth = await authenticateWidget(req, body?.projectKey ?? null);
  if (!auth.ok) return errorJson(auth.error, auth.status, headers);

  const requestIds = Array.isArray(body?.requestIds)
    ? (body.requestIds as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, 50)
    : [];

  const { id } = await ctx.params;
  const res = await rejectRound(
    auth.project.id,
    id,
    requestIds,
    { type: 'client', id: auth.tokenHash },
    adminDb(),
  );
  if (!res.ok) return errorJson(res.error, 409, headers);

  return json({ ok: true, rejectCount: res.rejectCount }, { headers });
}
