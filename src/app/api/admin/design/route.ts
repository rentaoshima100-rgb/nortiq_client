import { generateProposals } from '@/lib/design';
import { logEvent } from '@/lib/events';
import { currentStaff, staffActor } from '@/lib/staff';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 3案を並行して作る。生成そのものは1案あたり数十秒かかる
export const maxDuration = 60;

/** 社内が明示的に押したときだけ動く。クライアントの操作では発火しない */
export async function POST(req: Request) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: '権限がありません' }, { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY が設定されていません' },
      { status: 503 },
    );
  }

  let requestId: string;
  try {
    const body = (await req.json()) as { requestId?: string };
    if (!body.requestId) throw new Error('requestId がありません');
    requestId = body.requestId;
  } catch {
    return Response.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const out = await generateProposals(requestId, staff.id);
  if (!out.ok) return Response.json({ error: out.error }, { status: 404 });

  const made = out.results.filter((r) => r.ok);
  const failed = out.results.filter((r) => !r.ok);

  const { data: reqRow } = await adminDb()
    .from('requests')
    .select('project_id')
    .eq('id', requestId)
    .maybeSingle();

  if (reqRow?.project_id) {
    await logEvent({
      projectId: reqRow.project_id,
      actor: staffActor(staff),
      entity: 'request',
      entityId: requestId,
      action: 'design_proposals.generated',
      after: {
        batch: out.batch,
        made: made.length,
        failed: failed.map((f) => (f.ok ? null : { variant: f.variant, reason: f.reason })),
        usedCrop: out.usedCrop,
      },
    });
  }

  return Response.json({
    batch: out.batch,
    made: made.length,
    failed: failed.map((f) => (f.ok ? null : { variant: f.variant, reason: f.reason })),
  });
}
