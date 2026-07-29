import type { SupabaseClient } from '@supabase/supabase-js';
import { adminDb } from '@/lib/supabase/admin';

/**
 * 監査ログ（5.2）
 *
 * 「アプリのコードから直接 UPDATE させず、記録を伴うヘルパ経由に限定する」。
 * 揉めたときに証拠能力を持つのは、クライアントの自己申告（6.9）と
 * この events の2つだけなので、Phase 0 から通す。
 */

export type ActorType = 'staff' | 'client' | 'system';

export interface Actor {
  type: ActorType;
  /** client の場合は token_hash、staff の場合はメールアドレス */
  id: string | null;
}

export interface EventInput {
  projectId: string;
  actor: Actor;
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

export async function logEvent(e: EventInput, db: SupabaseClient = adminDb()): Promise<void> {
  const { error } = await db.from('events').insert({
    project_id: e.projectId,
    actor_type: e.actor.type,
    actor_id: e.actor.id,
    entity: e.entity,
    entity_id: e.entityId,
    action: e.action,
    before: e.before ?? null,
    after: e.after ?? null,
  });
  // 監査ログが落ちたことを黙って捨てない。呼び出し側の処理は続行させるが、
  // サーバログには必ず残す。
  if (error) console.error('[events] 記録に失敗しました', error, e);
}

/**
 * 記録を伴う UPDATE。
 * before は「変更するカラムだけ」を読み出して残す（差分が読める形にする）。
 */
export async function auditedUpdate(opts: {
  table: string;
  id: string;
  patch: Record<string, unknown>;
  projectId: string;
  actor: Actor;
  entity: string;
  action: string;
  db?: SupabaseClient;
}): Promise<{ ok: true; after: Record<string, unknown> } | { ok: false; error: string }> {
  const db = opts.db ?? adminDb();
  const cols = Object.keys(opts.patch);
  if (cols.length === 0) return { ok: false, error: '変更内容がありません' };

  const { data: before, error: readErr } = await db
    .from(opts.table)
    .select(cols.join(','))
    .eq('id', opts.id)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!before) return { ok: false, error: '対象が見つかりません' };

  const { data: after, error: updErr } = await db
    .from(opts.table)
    .update(opts.patch as never)
    .eq('id', opts.id)
    .select(cols.join(','))
    .maybeSingle();
  if (updErr) return { ok: false, error: updErr.message };

  await logEvent(
    {
      projectId: opts.projectId,
      actor: opts.actor,
      entity: opts.entity,
      entityId: opts.id,
      action: opts.action,
      before,
      after,
    },
    db,
  );

  return { ok: true, after: (after ?? {}) as Record<string, unknown> };
}

/**
 * レート制限（10.4）— 1トークンあたり 10件/分。
 * events を数える。Redis を持ち込まないための割り切りだが、
 * events_actor_at_idx があるので実測で十分速い。
 */
export async function countRecentActions(
  actorId: string,
  action: string,
  windowSeconds: number,
  db: SupabaseClient = adminDb(),
): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await db
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', actorId)
    .eq('action', action)
    .gte('at', since);
  if (error) {
    console.error('[events] レート制限の集計に失敗しました', error);
    return 0;
  }
  return count ?? 0;
}
