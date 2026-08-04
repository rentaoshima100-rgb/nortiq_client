import { randomUUID } from 'node:crypto';
import { getT } from '@/lib/i18n';
import { ATTACHMENTS_BUCKET } from '@/lib/env';
import { logEvent } from '@/lib/events';
import { currentStaff, staffActor } from '@/lib/staff';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];

/**
 * 社内があとから添付を足す。
 *
 * 「この写真に差し替えて」に対して、正しい素材を社内が持っていることがある。
 * クライアント経路と同じテーブルに入れるが、**出どころは分けて残す**（6.9）。
 * 素材／参考の別が揉めたとき、誰が「これは素材だ」と言ったかが要るため。
 */
export async function POST(req: Request) {
  const t = await getT();
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: t('権限がありません') }, { status: 403 });

  let input: {
    requestId?: string;
    filename?: string;
    mime?: string;
    bytes?: number;
    width?: number | null;
    height?: number | null;
    kind?: 'material' | 'reference';
  };
  try {
    input = (await req.json()) as typeof input;
  } catch {
    return Response.json({ error: t('リクエストが不正です') }, { status: 400 });
  }

  if (!input.requestId || !input.filename || !input.mime || !input.bytes) {
    return Response.json({ error: t('必要な項目がありません') }, { status: 400 });
  }
  if (!MIMES.includes(input.mime)) {
    return Response.json({ error: t('画像ファイルだけ添付できます') }, { status: 400 });
  }
  if (input.bytes > 10 * 1024 * 1024) {
    return Response.json({ error: t('10MB を超える画像は添付できません') }, { status: 400 });
  }
  const kind = input.kind === 'material' ? 'material' : 'reference';

  const db = adminDb();
  const { data: r } = await db
    .from('requests')
    .select('id, seq, project_id')
    .eq('id', input.requestId)
    .maybeSingle();
  if (!r) return Response.json({ error: t('依頼が見つかりません') }, { status: 404 });

  const safeName =
    (input.filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'image').replace(/^\.+/, '');
  const storagePath = `${r.project_id}/${r.id}/${randomUUID()}-${safeName}`;

  const { data: signed, error: signErr } = await db.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed) {
    return Response.json({ error: t('アップロード先の発行に失敗しました') }, { status: 500 });
  }

  const { data: att, error: attErr } = await db
    .from('attachments')
    .insert({
      request_id: r.id,
      storage_path: storagePath,
      filename: input.filename.slice(0, 255),
      mime: input.mime,
      width: input.width ?? null,
      height: input.height ?? null,
      bytes: input.bytes,
      kind,
      added_by: 'staff',
      added_by_id: staff.email,
    } as never)
    .select('id')
    .single();
  if (attErr || !att) {
    return Response.json({ error: t('添付の登録に失敗しました') }, { status: 500 });
  }

  await logEvent({
    projectId: r.project_id,
    actor: staffActor(staff),
    entity: 'attachment',
    entityId: att.id,
    action: 'attachment.added_by_staff',
    after: { requestId: r.id, filename: input.filename, kind, bytes: input.bytes },
  });

  return Response.json({ id: att.id, uploadUrl: signed.signedUrl, path: storagePath });
}
