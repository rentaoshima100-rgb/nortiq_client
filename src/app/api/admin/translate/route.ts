/**
 * クライアントが書いた文を英訳する。
 *
 * 社内が押したときだけ走る。開いただけでは走らせない — 依頼が溜まった
 * 案件を開くたびに勝手に呼ぶと、読むつもりがなくても費用がかかる。
 */
import { getT } from '@/lib/i18n';
import { logEvent } from '@/lib/events';
import { currentStaff, staffActor } from '@/lib/staff';
import { translateRequests } from '@/lib/translate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 40件をまとめて1回。長くても2分は見ておく
export const maxDuration = 300;

export async function POST(req: Request) {
  const t = await getT();
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: t('権限がありません') }, { status: 403 });

  let b: { projectId?: string; ids?: string[]; force?: boolean };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return Response.json({ error: t('リクエストが不正です') }, { status: 400 });
  }
  if (!b.projectId) return Response.json({ error: t('projectId がありません') }, { status: 400 });

  const out = await translateRequests(b.projectId, { ids: b.ids, force: b.force, t });

  if (out.done) {
    await logEvent({
      projectId: b.projectId,
      actor: staffActor(staff),
      entity: 'project',
      entityId: b.projectId,
      action: 'requests.translated',
      after: { count: out.done, ids: b.ids ?? null, force: !!b.force },
    });
  }

  return Response.json(out);
}
