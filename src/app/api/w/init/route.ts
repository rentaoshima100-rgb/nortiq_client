import { corsHeadersFor, handlePreflight } from '@/lib/cors';
import { errorJson, json } from '@/lib/http';
import { adminDb } from '@/lib/supabase/admin';
import { authenticateWidget } from '@/lib/widget-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

export async function POST(req: Request) {
  const headers = await corsHeadersFor(req.headers.get('origin'));
  const body = (await req.json().catch(() => null)) as { projectKey?: string } | null;
  const projectKey = body?.projectKey ?? null;

  const auth = await authenticateWidget(req, projectKey);
  if (!auth.ok) return errorJson(auth.error, auth.status, headers);

  const { count } = await adminDb()
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', auth.project.id);

  return json(
    {
      project: { name: auth.project.name, clientName: auth.project.client_name },
      limits: {
        maxItemsPerRound: auth.project.max_items_per_round,
        freeRounds: auth.project.free_rounds,
      },
      requestCount: count ?? 0,
    },
    { headers },
  );
}
