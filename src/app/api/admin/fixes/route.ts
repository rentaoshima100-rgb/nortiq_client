import { applyInstructions, generateInstructions } from '@/lib/fix-instructions';
import { currentStaff, staffActor } from '@/lib/staff';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 *   { projectId, action: 'plan' }                    → 指示を作る（リポジトリは触らない）
 *   { projectId, action: 'apply', ids: [...] }       → 選んだ指示をまとめて当て、PR を出す
 *   { id, instruction, targetHint, status }          → 指示を直す
 */
export async function POST(req: Request) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: '権限がありません' }, { status: 403 });

  let b: {
    projectId?: string;
    action?: 'plan' | 'apply' | 'inspect';
    ids?: string[];
    requestIds?: string[];
    id?: string;
    instruction?: string;
    targetHint?: string;
    status?: string;
  };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return Response.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  // 指示そのものの編集。ここではモデルを呼ばない
  if (b.id) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.instruction != null) patch.instruction = b.instruction;
    if (b.targetHint != null) patch.target_hint = b.targetHint || null;
    if (b.status) patch.status = b.status;
    if (b.instruction != null) patch.source = 'staff';
    const { error } = await adminDb()
      .from('fix_instructions')
      .update(patch as never)
      .eq('id', b.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  if (!b.projectId) return Response.json({ error: 'projectId がありません' }, { status: 400 });

  if (b.action === 'apply' || b.action === 'inspect') {
    // 点検はモデルを呼ばない。材料が揃っているかだけを見る
    const out = await applyInstructions(b.projectId, b.ids ?? [], staffActor(staff), {
      inspectOnly: b.action === 'inspect',
    });
    return Response.json(out);
  }

  const out = await generateInstructions(b.projectId, staffActor(staff), {
    requestIds: b.requestIds,
  });
  return Response.json(out);
}
