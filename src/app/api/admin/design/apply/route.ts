import { planImplementation } from '@/lib/design-apply';
import { getT } from '@/lib/i18n';
import { logEvent } from '@/lib/events';
import { currentStaff, staffActor } from '@/lib/staff';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// リポジトリを読んで書き換えを作る。既存コードを読む分だけ時間がかかる
export const maxDuration = 300;

/**
 * 採用した案をリポジトリに落とす。
 *
 *   { proposalId }                → 下書き（差分を返すだけ。リポジトリは変わらない）
 *   { proposalId, confirm: true } → PR を出す
 */
export async function POST(req: Request) {
  const t = await getT();
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: t('権限がありません') }, { status: 403 });

  let input: { proposalId?: string; confirm?: boolean };
  try {
    input = (await req.json()) as typeof input;
    if (!input.proposalId) throw new Error('proposalId がありません');
  } catch {
    return Response.json({ error: t('リクエストが不正です') }, { status: 400 });
  }

  const out = await planImplementation(input.proposalId, staffActor(staff), {
    dryRun: !input.confirm,
  });

  if (out.ok && out.applied) {
    const { data: p } = await adminDb()
      .from('design_proposals')
      .select('request_id, title, requests(project_id, seq)')
      .eq('id', input.proposalId)
      .maybeSingle();
    const rel = p?.requests as unknown as { project_id: string; seq: number }[] | { project_id: string; seq: number } | null;
    const r = Array.isArray(rel) ? rel[0] : rel;
    if (r?.project_id) {
      await logEvent({
        projectId: r.project_id,
        actor: staffActor(staff),
        entity: 'request',
        entityId: p!.request_id as string,
        action: 'design_proposal.pull_request_opened',
        after: { title: p?.title, file: out.plan.file, branch: out.branch, pr: out.prUrl },
      });
    }
  }

  return Response.json(out, { status: out.ok ? 200 : 200 });
}
