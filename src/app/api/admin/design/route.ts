import { runResearch, runVariant } from '@/lib/design';
import { logEvent } from '@/lib/events';
import { currentStaff, staffActor } from '@/lib/staff';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 調査と生成を1回の関数でやると 60秒に当たって何も残らないまま落ちる（実測）。
// 段ごとに別の呼び出しにして、それぞれに 60秒を使わせる。
export const maxDuration = 60;

/**
 * 社内が明示的に押したときだけ動く。クライアントの操作では発火しない。
 *
 *   { requestId }                    → 調査（1段目）。batch を返す
 *   { requestId, batch, variant }    → その案を1つ作る（2段目）
 */
export async function POST(req: Request) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: '権限がありません' }, { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY が設定されていません' }, { status: 503 });
  }

  let input: { requestId?: string; batch?: number; variant?: number };
  try {
    input = (await req.json()) as typeof input;
    if (!input.requestId) throw new Error('requestId がありません');
  } catch {
    return Response.json({ error: 'リクエストが不正です' }, { status: 400 });
  }
  const requestId = input.requestId;

  // ── 2段目: 1案だけ作る
  if (input.batch != null && input.variant != null) {
    const r = await runVariant(requestId, input.batch, input.variant, staff.id);
    return Response.json(r, { status: r.ok ? 200 : 502 });
  }

  // ── 1段目: 調べる
  const out = await runResearch(requestId, staff.id);
  if (!out.ok) return Response.json({ error: out.error }, { status: 502 });

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
      action: 'design_research.done',
      after: {
        batch: out.batch,
        sources: out.research.sources.length,
        clientSpec: !!out.research.clientSpec,
        usedCrop: out.usedCrop,
        hasTokens: out.hasTokens,
      },
    });
  }

  return Response.json({
    batch: out.batch,
    sources: out.research.sources.length,
    clientSpec: out.research.clientSpec,
  });
}
