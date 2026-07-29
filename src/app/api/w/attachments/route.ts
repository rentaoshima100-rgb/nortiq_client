import { randomUUID } from 'node:crypto';
import { corsHeadersFor, handlePreflight } from '@/lib/cors';
import { ATTACHMENTS_BUCKET } from '@/lib/env';
import { logEvent } from '@/lib/events';
import { errorJson, json } from '@/lib/http';
import { SignAttachmentSchema } from '@/lib/schemas';
import { adminDb } from '@/lib/supabase/admin';
import { authenticateWidget } from '@/lib/widget-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 6.9: 1依頼あたり 5枚まで */
const MAX_PER_REQUEST = 5;

export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

export async function POST(req: Request) {
  const headers = await corsHeadersFor(req.headers.get('origin'));

  const parsed = SignAttachmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson('添付の指定が正しくありません', 400, headers);
  const input = parsed.data;

  const auth = await authenticateWidget(req, input.projectKey);
  if (!auth.ok) return errorJson(auth.error, auth.status, headers);

  const db = adminDb();

  // 依頼が本当にこの案件のものか確かめる
  const { data: reqRow } = await db
    .from('requests')
    .select('id, project_id')
    .eq('id', input.requestId)
    .maybeSingle();
  if (!reqRow || reqRow.project_id !== auth.project.id) {
    return errorJson('依頼が見つかりません', 404, headers);
  }

  const { count } = await db
    .from('attachments')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', input.requestId);
  if ((count ?? 0) >= MAX_PER_REQUEST) {
    return errorJson(`画像は1件の依頼につき ${MAX_PER_REQUEST} 枚までです`, 400, headers);
  }

  // Storage のキーは ASCII に寄せる（元のファイル名は attachments.filename に残す）
  const safeName = (input.filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'image').replace(
    /^\.+/,
    '',
  );
  const storagePath = `${auth.project.id}/${input.requestId}/${randomUUID()}-${safeName}`;

  const { data: signed, error: signErr } = await db.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed) {
    return errorJson('アップロード先の発行に失敗しました', 500, headers);
  }

  const { data: att, error: attErr } = await db
    .from('attachments')
    .insert({
      request_id: input.requestId,
      storage_path: storagePath,
      filename: input.filename.slice(0, 255),
      mime: input.mime,
      width: input.width ?? null,
      height: input.height ?? null,
      bytes: input.bytes,
      kind: input.kind,
    })
    .select('id')
    .single();
  if (attErr || !att) return errorJson('添付の登録に失敗しました', 500, headers);

  // 素材 / 参考 の別はクライアント自身の申告であり、揉めたときの証拠になる（6.9）
  await logEvent(
    {
      projectId: auth.project.id,
      actor: { type: 'client', id: auth.tokenHash },
      entity: 'attachment',
      entityId: att.id,
      action: 'attachment.declared',
      after: {
        request_id: input.requestId,
        filename: input.filename,
        mime: input.mime,
        bytes: input.bytes,
        width: input.width ?? null,
        height: input.height ?? null,
        kind: input.kind,
      },
    },
    db,
  );

  return json(
    { uploadUrl: signed.signedUrl, storagePath, attachmentId: att.id },
    { status: 201, headers },
  );
}
