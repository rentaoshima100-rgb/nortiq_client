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
    .select('id, seq, status, category, body, locator, created_at')
    .eq('project_id', auth.project.id)
    .eq('page_path', path)
    .neq('status', 'wont_fix')
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
        locator: r.locator,
        createdAt: r.created_at,
      })),
    },
    { headers },
  );
}
