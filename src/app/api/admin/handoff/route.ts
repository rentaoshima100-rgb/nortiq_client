/**
 * Claude Code に一度で投げるプロンプトを返す。
 *
 * このツールは修正を当てない。持っている材料を並べるだけなので LLM は
 * 呼ばない。呼ばないほうが速く、費用もかからず、内容が予測できる。
 */
import { buildHandoff } from '@/lib/handoff';
import { getT } from '@/lib/i18n';
import { logEvent } from '@/lib/events';
import { currentStaff, staffActor } from '@/lib/staff';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const t = await getT();
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: t('権限がありません') }, { status: 403 });

  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) return Response.json({ error: t('projectId がありません') }, { status: 400 });

  // 既定は「まだ直していないもの」。all=1 で完了済みも含める
  const statuses =
    url.searchParams.get('all') === '1'
      ? ['received', 'in_progress', 'done', 'carried_over', 'wont_fix']
      : undefined;

  return Response.json(await buildHandoff(projectId, { statuses, t }));
}

/** 依頼ごとの社内メモを保存する。プロンプトに「依頼文より優先」で載る */
export async function POST(req: Request) {
  const t = await getT();
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: t('権限がありません') }, { status: 403 });

  let b: { id?: string; staffNote?: string };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return Response.json({ error: t('リクエストが不正です') }, { status: 400 });
  }
  if (!b.id) return Response.json({ error: t('必要な項目がありません') }, { status: 400 });

  const db = adminDb();
  const { data: r } = await db
    .from('requests')
    .select('id, project_id')
    .eq('id', b.id)
    .maybeSingle();
  if (!r) return Response.json({ error: t('依頼が見つかりません') }, { status: 404 });

  const note = (b.staffNote ?? '').trim();
  await db
    .from('requests')
    .update({ staff_note: note || null } as never)
    .eq('id', b.id);

  await logEvent({
    projectId: r.project_id,
    actor: staffActor(staff),
    entity: 'request',
    entityId: b.id,
    action: 'request.staff_note_saved',
    after: { staff_note: note || null },
  });

  return Response.json({ ok: true });
}
