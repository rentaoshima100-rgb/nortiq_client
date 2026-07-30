import type { SupabaseClient } from '@supabase/supabase-js';
import { adminDb } from '@/lib/supabase/admin';
import { logEvent, type Actor } from '@/lib/events';
import type { ProjectRow } from '@/lib/types';

export type RoundStatus =
  | 'open'
  | 'frozen'
  | 'in_progress'
  | 'published'
  | 'confirmed'
  | 'closed_auto';

export type FreezeReason = 'manual' | 'idle' | 'limit' | 'reject';

export interface RoundRow {
  id: string;
  project_id: string;
  seq: number;
  status: RoundStatus;
  counts_free: boolean;
  reject_count: number;
  branch: string | null;
  dispatch_count: number;
  freeze_reason: FreezeReason | null;
  opened_at: string;
  freeze_due_at: string | null;
  frozen_at: string | null;
  last_dispatched_at: string | null;
  published_at: string | null;
  confirmed_at: string | null;
  confirm_due_at: string | null;
}

const SYSTEM: Actor = { type: 'system', id: null };

/** ラウンドを開く（無ければ作り、持ち越し分を引き取る。8.4） */
export async function openRound(
  projectId: string,
  db: SupabaseClient = adminDb(),
): Promise<string | null> {
  const { data, error } = await db.rpc('open_round', { p_project_id: projectId });
  if (error) {
    console.error('[rounds] open_round に失敗しました', error);
    return null;
  }
  return (data as string) ?? null;
}

/** 無償修正の消化数（5.4） */
export async function usedFreeRounds(
  projectId: string,
  db: SupabaseClient = adminDb(),
): Promise<number> {
  const { data, error } = await db.rpc('used_free_rounds', { p_project_id: projectId });
  if (error) {
    console.error('[rounds] used_free_rounds に失敗しました', error);
    return 0;
  }
  return (data as number) ?? 0;
}

/** クライアントに見せる「いま進行中のラウンド」 */
export async function activeRound(
  projectId: string,
  db: SupabaseClient = adminDb(),
): Promise<RoundRow | null> {
  const { data } = await db
    .from('rounds')
    .select('*')
    .eq('project_id', projectId)
    .in('status', ['open', 'frozen', 'in_progress', 'published'])
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as RoundRow) ?? null;
}

/**
 * 新しい依頼をどのラウンドに入れるか（8.4）
 *
 * 「フリーズは入力を止めるのではなく行き先を変える」。
 * 締切後に届いた分は round_id = null で貯め、次のラウンドが開いたときに
 * open_round() が引き取る。ここで勝手に新ラウンドを開いてはいけない。
 * 開いてしまうと、締切の意味が無くなる。
 */
export async function attachRound(
  projectId: string,
  db: SupabaseClient = adminDb(),
): Promise<string | null> {
  const active = await activeRound(projectId, db);
  if (active) return active.status === 'open' ? active.id : null;
  // 進行中のラウンドが1つも無い（初回、または前回が確認済み）
  return await openRound(projectId, db);
}

/**
 * 期限で自動的に進む遷移をまとめて処理する。
 *
 * 外部のスケジューラを前提にしない。読まれたときに追いつく方式にしておくと、
 * cron が止まっていても状態が壊れない。Vercel Cron を入れたら
 * /api/admin/tick から同じ関数を呼べばよい。
 */
export async function runDueTransitions(
  projectId: string,
  db: SupabaseClient = adminDb(),
): Promise<void> {
  const now = new Date().toISOString();

  // ① 一定日数 新規依頼が無ければフリーズ（8.2 ②）
  const { data: idle } = await db
    .from('rounds')
    .select('id, seq, freeze_due_at')
    .eq('project_id', projectId)
    .eq('status', 'open')
    .not('freeze_due_at', 'is', null)
    .lt('freeze_due_at', now);
  for (const r of idle ?? []) {
    await applyFreeze(projectId, r.id, 'idle', SYSTEM, db);
  }

  // ② 公開から一定日数で自動確認（8.6）
  const { data: due } = await db
    .from('rounds')
    .select('id, seq, confirm_due_at')
    .eq('project_id', projectId)
    .eq('status', 'published')
    .not('confirm_due_at', 'is', null)
    .lt('confirm_due_at', now);
  for (const r of due ?? []) {
    const { data: after } = await db
      .from('rounds')
      .update({ status: 'closed_auto', confirmed_at: now })
      .eq('id', r.id)
      .eq('status', 'published') // 同時に確認が来ていたら負ける
      .select('id, status, confirmed_at')
      .maybeSingle();
    if (!after) continue;
    await logEvent(
      {
        projectId,
        actor: SYSTEM,
        entity: 'round',
        entityId: r.id,
        action: 'round.closed_auto',
        before: { status: 'published' },
        after: { status: 'closed_auto', seq: r.seq },
      },
      db,
    );
  }
}

/** フリーズ（受付締切）。ディスパッチとは別事象（8.2） */
export async function applyFreeze(
  projectId: string,
  roundId: string,
  reason: FreezeReason,
  actor: Actor,
  db: SupabaseClient = adminDb(),
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data: after } = await db
    .from('rounds')
    .update({ status: 'frozen', frozen_at: now, freeze_reason: reason })
    .eq('id', roundId)
    .in('status', ['open', 'published'])
    .select('id, seq, status, freeze_reason')
    .maybeSingle();
  if (!after) return false;

  await logEvent(
    {
      projectId,
      actor,
      entity: 'round',
      entityId: roundId,
      action: 'round.frozen',
      after: { status: 'frozen', reason, seq: after.seq },
    },
    db,
  );
  return true;
}

/**
 * 依頼が1件入ったあとの後始末。
 * - フリーズ予告の期限を引き直す（新規依頼のたびにリセット・8.2）
 * - 件数上限に達したら即時フリーズ（8.5）
 */
export async function afterRequestCreated(
  project: ProjectRow,
  roundId: string | null,
  db: SupabaseClient = adminDb(),
): Promise<void> {
  if (!roundId) return;

  const idleDays = project.freeze_idle_days ?? 3;
  const freezeDue = new Date(Date.now() + idleDays * 86400_000).toISOString();
  await db
    .from('rounds')
    .update({ freeze_due_at: freezeDue })
    .eq('id', roundId)
    .eq('status', 'open');

  // 件数は「カウント外に外れたもの」を除いて数える（8.1 / 8.5）
  const { count } = await db
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('round_id', roundId)
    .not('category', 'in', '(spec_change,defect)');

  if ((count ?? 0) >= (project.max_items_per_round ?? 10)) {
    await applyFreeze(project.id, roundId, 'limit', SYSTEM, db);
  }
}

/** クライアントの「確認しました」（8.6）。カウント +1 はここで確定する。 */
export async function confirmRound(
  projectId: string,
  roundId: string,
  actor: Actor,
  db: SupabaseClient = adminDb(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const { data: after } = await db
    .from('rounds')
    .update({ status: 'confirmed', confirmed_at: now })
    .eq('id', roundId)
    .eq('project_id', projectId)
    .eq('status', 'published')
    .select('id, seq, counts_free')
    .maybeSingle();
  if (!after) return { ok: false, error: 'このラウンドはまだ確認できる状態ではありません' };

  await db
    .from('requests')
    .update({ status: 'done' })
    .eq('round_id', roundId)
    .in('status', ['received', 'in_progress']);

  await logEvent(
    {
      projectId,
      actor,
      entity: 'round',
      entityId: roundId,
      action: 'round.confirmed',
      before: { status: 'published' },
      after: { status: 'confirmed', seq: after.seq, counts_free: after.counts_free },
    },
    db,
  );

  // 締切後に届いて持ち越されていた分があれば、その場で次のラウンドを開いて拾う。
  // 待たせると「送ったのに何も起きていない」ように見える。
  const { count: carried } = await db
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .is('round_id', null);
  if ((carried ?? 0) > 0) await openRound(projectId, db);

  return { ok: true };
}

/**
 * 「直っていない箇所があります」（8.6）
 * カウントは据え置き。そのラウンドの既存依頼からしか選ばせない。
 * reject_count が 2 に達したあとは、これ以上ラウンドを往復させない。
 */
export async function rejectRound(
  projectId: string,
  roundId: string,
  requestIds: string[],
  actor: Actor,
  db: SupabaseClient = adminDb(),
): Promise<{ ok: true; rejectCount: number } | { ok: false; error: string }> {
  if (requestIds.length === 0) {
    return { ok: false, error: '直っていない箇所を選んでください' };
  }

  const { data: round } = await db
    .from('rounds')
    .select('id, seq, status, reject_count')
    .eq('id', roundId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (!round) return { ok: false, error: 'ラウンドが見つかりません' };
  if (round.status !== 'published') {
    return { ok: false, error: 'このラウンドは差し戻せる状態ではありません' };
  }
  if ((round.reject_count ?? 0) >= 2) {
    return {
      ok: false,
      error:
        '差し戻しは2回までです。まだ直っていない点は、不具合として個別にご連絡ください（回数には含めません）',
    };
  }

  // このラウンドの依頼だけを対象にする
  const { data: valid } = await db
    .from('requests')
    .select('id')
    .eq('round_id', roundId)
    .in('id', requestIds);
  const ids = (valid ?? []).map((v) => v.id);
  if (ids.length === 0) {
    return { ok: false, error: 'このラウンドの依頼を選んでください' };
  }

  const rejectCount = (round.reject_count ?? 0) + 1;
  const now = new Date().toISOString();

  await db
    .from('rounds')
    .update({
      status: 'frozen',
      frozen_at: now,
      freeze_reason: 'reject',
      reject_count: rejectCount,
    })
    .eq('id', roundId);

  await db
    .from('requests')
    .update({ status: 'in_progress', rejected_in_round: roundId })
    .in('id', ids);

  await logEvent(
    {
      projectId,
      actor,
      entity: 'round',
      entityId: roundId,
      action: 'round.rejected',
      before: { status: 'published', reject_count: round.reject_count },
      after: { status: 'frozen', reject_count: rejectCount, request_ids: ids },
    },
    db,
  );

  return { ok: true, rejectCount };
}

/** 社内操作の状態遷移（frozen → in_progress → published） */
export async function advanceRound(
  projectId: string,
  roundId: string,
  to: 'in_progress' | 'published' | 'frozen',
  actor: Actor,
  project: ProjectRow,
  db: SupabaseClient = adminDb(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed: Record<string, RoundStatus[]> = {
    in_progress: ['frozen'],
    published: ['in_progress', 'frozen'],
    frozen: ['open', 'in_progress'],
  };

  const patch: Record<string, unknown> = { status: to };
  if (to === 'published') {
    patch.published_at = new Date().toISOString();
    patch.confirm_due_at = new Date(
      Date.now() + (project.auto_confirm_days ?? 14) * 86400_000,
    ).toISOString();
  }
  if (to === 'frozen') {
    patch.frozen_at = new Date().toISOString();
    patch.freeze_reason = 'manual';
  }

  const { data: before } = await db
    .from('rounds')
    .select('id, seq, status')
    .eq('id', roundId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (!before) return { ok: false, error: 'ラウンドが見つかりません' };

  const { data: after } = await db
    .from('rounds')
    .update(patch)
    .eq('id', roundId)
    .in('status', allowed[to])
    .select('id, seq, status, confirm_due_at')
    .maybeSingle();
  if (!after) {
    return { ok: false, error: `「${jaStatus(before.status as RoundStatus)}」からは進められません` };
  }

  await logEvent(
    {
      projectId,
      actor,
      entity: 'round',
      entityId: roundId,
      action: 'round.' + to,
      before: { status: before.status },
      after,
    },
    db,
  );
  return { ok: true };
}

export function jaStatus(s: RoundStatus): string {
  switch (s) {
    case 'open':
      return '受付中';
    case 'frozen':
      return '受付締切';
    case 'in_progress':
      return '修正中';
    case 'published':
      return '公開済み・確認待ち';
    case 'confirmed':
      return '確認済み';
    case 'closed_auto':
      return '自動確認';
  }
}

export function jaFreezeReason(r: FreezeReason | null): string {
  switch (r) {
    case 'manual':
      return '手動';
    case 'idle':
      return '新規依頼なしで自動締切';
    case 'limit':
      return '件数上限に到達';
    case 'reject':
      return '差し戻し';
    default:
      return '—';
  }
}

/** 「あと N 日で受付を締め切ります」（8.2 のフリーズ予告） */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86400_000));
}
