import { corsHeadersFor, handlePreflight } from '@/lib/cors';
import { errorJson, json } from '@/lib/http';
import { confirmRound } from '@/lib/rounds';
import { adminDb } from '@/lib/supabase/admin';
import { authenticateWidget } from '@/lib/widget-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

/**
 * 「確認しました」（8.6）
 * ここで無償修正のカウントが +1 される。
 * 「1カウントに同意しますか」とは聞かない。争点は金額ではなく直ったかどうか。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const headers = await corsHeadersFor(req.headers.get('origin'));
  const body = (await req.json().catch(() => null)) as { projectKey?: string } | null;

  const auth = await authenticateWidget(req, body?.projectKey ?? null);
  if (!auth.ok) return errorJson(auth.error, auth.status, headers);

  const { id } = await ctx.params;
  const res = await confirmRound(
    auth.project.id,
    id,
    { type: 'client', id: auth.tokenHash },
    adminDb(),
  );
  if (!res.ok) return errorJson(res.error, 409, headers);

  return json({ ok: true }, { headers });
}
