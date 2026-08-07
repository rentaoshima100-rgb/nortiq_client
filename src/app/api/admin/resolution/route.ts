/**
 * 対応内容（クライアントが読む記録）
 *
 * POST { projectId, action: 'draft' }  … 記録から下書きを作る
 * POST { id, resolution }              … 社内が直して保存する
 *
 * **そのままクライアントが読む文**なので、社内が目を通してから保存する。
 */
import { getT } from '@/lib/i18n';
import { logEvent } from '@/lib/events';
import { draftResolutions } from '@/lib/resolution';
import { currentStaff, staffActor } from '@/lib/staff';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const t = await getT();
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: t('権限がありません') }, { status: 403 });

  let b: { projectId?: string; action?: 'draft'; ids?: string[]; force?: boolean; id?: string; resolution?: string };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return Response.json({ error: t('リクエストが不正です') }, { status: 400 });
  }

  // 1件だけ手で直して保存
  if (b.id && b.resolution !== undefined) {
    const text = b.resolution.trim();
    const db = adminDb();
    const { data: r } = await db
      .from('requests')
      .select('id, project_id')
      .eq('id', b.id)
      .maybeSingle();
    if (!r) return Response.json({ error: t('依頼が見つかりません') }, { status: 404 });
    await db
      .from('requests')
      .update({
        resolution: text || null,
        resolution_at: text ? new Date().toISOString() : null,
      } as never)
      .eq('id', b.id);
    await logEvent({
      projectId: r.project_id,
      actor: staffActor(staff),
      entity: 'request',
      entityId: b.id,
      action: 'request.resolution_saved',
      after: { resolution: text || null },
    });
    return Response.json({ ok: true });
  }

  if (!b.projectId) return Response.json({ error: t('projectId がありません') }, { status: 400 });

  const out = await draftResolutions(b.projectId, staffActor(staff), {
    ids: b.ids,
    force: b.force,
    t,
  });
  return Response.json(out);
}
