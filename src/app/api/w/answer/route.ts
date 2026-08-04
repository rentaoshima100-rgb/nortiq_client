import { corsHeadersFor, handlePreflight } from '@/lib/cors';
import { logEvent } from '@/lib/events';
import { errorJson, json } from '@/lib/http';
import { sanitizeBody } from '@/lib/sanitize';
import { adminDb } from '@/lib/supabase/admin';
import { authenticateWidget } from '@/lib/widget-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

/**
 * クライアントが「確認したいこと」に答える。
 *
 * 値が依頼文に無いもの（許可番号、正式名称、どの写真か）は、
 * こちらで想像して埋めると事故になる。出した本人にその場で聞く。
 */
export async function POST(req: Request) {
  const headers = await corsHeadersFor(req.headers.get('origin'));

  let input: { projectKey?: string; requestId?: string; answer?: string };
  try {
    input = (await req.json()) as typeof input;
  } catch {
    return errorJson('送信内容の形式が正しくありません', 400, headers);
  }
  if (!input.requestId || !input.answer?.trim()) {
    return errorJson('答えが空です', 400, headers);
  }

  const auth = await authenticateWidget(req, input.projectKey ?? null);
  if (!auth.ok) return errorJson(auth.error, auth.status, headers);

  const db = adminDb();
  const { data: r } = await db
    .from('requests')
    .select('id, seq, project_id, client_question')
    .eq('id', input.requestId)
    .eq('project_id', auth.project.id)
    .maybeSingle();
  if (!r) return errorJson('依頼が見つかりません', 404, headers);
  if (!r.client_question) return errorJson('この依頼に確認事項はありません', 409, headers);

  const answer = sanitizeBody(input.answer).slice(0, 2000);

  await db
    .from('requests')
    .update({
      client_answer: answer,
      client_answered_at: new Date().toISOString(),
      // 答えが入ったら質問は消す。同じことを二度聞かない
      client_question: null,
      client_question_at: null,
    } as never)
    .eq('id', r.id);

  await logEvent({
    projectId: auth.project.id,
    actor: { type: 'client', id: auth.tokenHash },
    entity: 'request',
    entityId: r.id,
    action: 'client_question.answered',
    before: { question: r.client_question },
    after: { answer },
  });

  return json({ ok: true }, { headers });
}
