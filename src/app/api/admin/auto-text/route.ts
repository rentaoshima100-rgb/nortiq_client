import { runAutoText } from '@/lib/auto-text';
import { logEvent } from '@/lib/events';
import { currentStaff, staffActor } from '@/lib/staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// リポジトリを読んで書き換えを作る。依頼の件数ぶんかかる
export const maxDuration = 300;

/**
 * 社内から手で走らせる。
 *
 * 自動は1時間ごとに回るが、待てないときがある（クライアントの目の前で
 * 直したい、締切が近い）。手で押した場合はデバウンスを飛ばす。
 * ai_enabled が落ちていても、社内が明示的に押したなら走らせる。
 */
export async function POST(req: Request) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: '権限がありません' }, { status: 403 });

  let projectId: string;
  try {
    const b = (await req.json()) as { projectId?: string };
    if (!b.projectId) throw new Error('projectId がありません');
    projectId = b.projectId;
  } catch {
    return Response.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const out = await runAutoText(projectId, { manual: true });

  await logEvent({
    projectId,
    actor: staffActor(staff),
    entity: 'project',
    entityId: projectId,
    action: 'auto_text.run_manually',
    after: {
      message: out.message,
      applied: out.results.filter((r) => r.status === 'applied').length,
      skipped: out.results.filter((r) => r.status === 'skipped').length,
      pr: out.prUrl ?? null,
    },
  });

  return Response.json(out);
}
