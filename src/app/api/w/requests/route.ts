import { corsHeadersFor, handlePreflight } from '@/lib/cors';
import { countRecentActions, logEvent } from '@/lib/events';
import { errorJson, json } from '@/lib/http';
import { normalizePagePath, sanitizeBody, sanitizeOuterHtml } from '@/lib/sanitize';
import { CreateRequestSchema } from '@/lib/schemas';
import { adminDb } from '@/lib/supabase/admin';
import { afterRequestCreated, attachRound, runDueTransitions } from '@/lib/rounds';
import { authenticateWidget } from '@/lib/widget-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 10.4: 依頼登録は 1トークンあたり 10件/分 */
const RATE_LIMIT = 10;
const RATE_WINDOW_SEC = 60;

export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

export async function POST(req: Request) {
  const headers = await corsHeadersFor(req.headers.get('origin'));

  const raw = await req.json().catch(() => null);
  const parsed = CreateRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return errorJson('送信内容の形式が正しくありません', 400, headers);
  }
  const input = parsed.data;

  const auth = await authenticateWidget(req, input.projectKey);
  if (!auth.ok) return errorJson(auth.error, auth.status, headers);

  const db = adminDb();

  const recent = await countRecentActions(
    auth.tokenHash,
    'request.created',
    RATE_WINDOW_SEC,
    db,
  );
  if (recent >= RATE_LIMIT) {
    return errorJson(
      '短時間に多くのご依頼が届いています。少し時間をおいてからお試しください',
      429,
      headers,
    );
  }

  // 期限切れのフリーズ・自動確認に追いついてから行き先を決める
  await runDueTransitions(auth.project.id, db);
  const roundId = await attachRound(auth.project.id, db);

  // 採番は project_counters で行う。max(seq)+1 は同時投稿で衝突する（5.3）。
  const { data: seq, error: seqErr } = await db.rpc('next_request_seq', {
    p_project_id: auth.project.id,
  });
  if (seqErr || seq == null) {
    return errorJson('受付番号の採番に失敗しました', 500, headers);
  }

  const locator = input.locator;
  const { data: inserted, error: insErr } = await db
    .from('requests')
    .insert({
      project_id: auth.project.id,
      round_id: roundId,
      seq,
      body: sanitizeBody(input.body),
      page_path: normalizePagePath(input.pagePath),
      viewport_w: input.viewport.w,
      viewport_h: input.viewport.h,
      scroll_y: input.scrollY,
      locator,
      nq_id: locator.nqId,
      nq_ordinal: locator.nqOrdinal,
      site_sha: input.siteSha ?? null,
      source_ref: locator.sourceRef,
      target: input.target ?? null,
      outer_html: sanitizeOuterHtml(input.outerHTML),
      computed: input.computed ?? null,
      css_rules: input.cssRules ?? null,
    })
    .select('id, seq')
    .single();

  if (insErr || !inserted) {
    return errorJson('依頼の登録に失敗しました', 500, headers);
  }

  await logEvent(
    {
      projectId: auth.project.id,
      actor: { type: 'client', id: auth.tokenHash },
      entity: 'request',
      entityId: inserted.id,
      action: 'request.created',
      after: {
        seq: inserted.seq,
        page_path: normalizePagePath(input.pagePath),
        nq_id: locator.nqId,
        nq_ordinal: locator.nqOrdinal,
        nq_count: locator.nqCount,
        site_sha: input.siteSha ?? null,
        viewport_w: input.viewport.w,
        ua: input.ua ?? null,
      },
    },
    db,
  );

  // フリーズ予告の引き直しと、件数上限での即時フリーズ（8.2 / 8.5）
  await afterRequestCreated(auth.project, roundId, db);

  return json(
    { id: inserted.id, seq: inserted.seq, carriedOver: roundId === null },
    { status: 201, headers },
  );
}
