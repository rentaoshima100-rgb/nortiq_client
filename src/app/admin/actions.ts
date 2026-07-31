'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auditedUpdate, logEvent } from '@/lib/events';
import { newToken, sha256hex } from '@/lib/hash';
import { advanceRound, openRound } from '@/lib/rounds';
import { adminDb } from '@/lib/supabase/admin';
import { requireStaff, staffActor } from '@/lib/staff';
import type { ProjectRow } from '@/lib/types';

/* ── 案件の作成 ─────────────────────────────────────────────── */

export interface CreateProjectState {
  error?: string;
}

export async function createProject(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const user = await requireStaff();

  const name = String(formData.get('name') || '').trim();
  const clientName = String(formData.get('client_name') || '').trim();
  const siteUrl = String(formData.get('site_url') || '').trim();
  const snippetKey = String(formData.get('snippet_key') || '').trim();
  const stack = String(formData.get('stack') || 'static');

  if (!name || !clientName || !siteUrl || !snippetKey) {
    return { error: 'すべての項目を入力してください' };
  }
  let origin: string;
  try {
    const u = new URL(siteUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
    origin = u.origin;
  } catch {
    return { error: 'サイトURLは https://example.com の形式で入力してください' };
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(snippetKey)) {
    return { error: 'スニペットキーは英小文字・数字・ハイフンで指定してください' };
  }

  const db = adminDb();
  const { data, error } = await db
    .from('projects')
    .insert({
      name,
      client_name: clientName,
      // オリジンだけを保存する（CORS の照合対象と一致させるため）
      site_url: origin,
      snippet_key: snippetKey,
      stack,
    })
    .select('id')
    .single();

  if (error || !data) {
    return {
      error: error?.code === '23505' ? 'そのスニペットキーは既に使われています' : '作成に失敗しました',
    };
  }

  await logEvent({
    projectId: data.id,
    actor: staffActor(user),
    entity: 'project',
    entityId: data.id,
    action: 'project.created',
    after: { name, client_name: clientName, site_url: origin, snippet_key: snippetKey, stack },
  });

  redirect(`/admin/projects/${data.id}`);
}

/* ── 招待リンクの発行（10.2）──────────────────────────────────
 * 平文のトークンはこの戻り値でしか出さない。DB には sha256 のみ保存する。
 * ------------------------------------------------------------------ */

export interface InviteState {
  token?: string;
  url?: string;
  error?: string;
}

export async function issueInvite(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const user = await requireStaff();
  const projectId = String(formData.get('project_id') || '');
  const label = String(formData.get('label') || '').trim() || null;
  if (!projectId) return { error: '案件が指定されていません' };

  const db = adminDb();
  const { data: project } = await db
    .from('projects')
    .select('id, site_url')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return { error: '案件が見つかりません' };

  const token = newToken();
  const tokenHash = sha256hex(token);
  const expiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();

  const { error } = await db.from('client_sessions').insert({
    token_hash: tokenHash,
    project_id: projectId,
    label,
    expires_at: expiresAt,
  });
  if (error) return { error: '発行に失敗しました' };

  await logEvent({
    projectId,
    actor: staffActor(user),
    entity: 'client_session',
    // client_sessions の主キーは token_hash（uuid ではない）ため、
    // entity_id には案件 ID を入れ、識別子は after に残す。
    entityId: projectId,
    action: 'client_session.issued',
    after: { token_hash: tokenHash, label, expires_at: expiresAt },
  });

  revalidatePath(`/admin/projects/${projectId}`);
  // 着地先はサイト本体。fragment はサーバのログにも Referer にも残らない（6.1）
  return { token, url: `${project.site_url}/#nq=${token}` };
}

export async function revokeInvite(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const projectId = String(formData.get('project_id') || '');
  const tokenHash = String(formData.get('token_hash') || '');
  if (!projectId || !tokenHash) return;

  const db = adminDb();
  await db
    .from('client_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', tokenHash);

  await logEvent({
    projectId,
    actor: staffActor(user),
    entity: 'client_session',
    entityId: projectId,
    action: 'client_session.revoked',
    after: { token_hash: tokenHash },
  });

  revalidatePath(`/admin/projects/${projectId}`);
}

/* ── 案件設定（画面D）──────────────────────────────────────── */

export interface SettingsState {
  error?: string;
  saved?: boolean;
}

export async function saveProjectSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireStaff();
  const projectId = String(formData.get('project_id') || '');
  if (!projectId) return { error: '案件が指定されていません' };

  const repo = String(formData.get('repo') || '').trim();
  let repoOwner: string | null = null;
  let repoName: string | null = null;
  if (repo) {
    const m = /^([\w.-]+)\/([\w.-]+)$/.exec(repo);
    if (!m) return { error: 'リポジトリは owner/name の形式で入力してください' };
    repoOwner = m[1];
    repoName = m[2];
  }

  const patch = {
    repo_owner: repoOwner,
    repo_name: repoName,
    default_branch: String(formData.get('default_branch') || 'main').trim() || 'main',
    has_nq_id: formData.get('has_nq_id') === 'on',
    asset_swap_enabled: formData.get('asset_swap_enabled') === 'on',
    ai_enabled: formData.get('ai_enabled') === 'on',
    free_rounds: Number(formData.get('free_rounds') || 3),
    max_items_per_round: Number(formData.get('max_items_per_round') || 10),
    freeze_idle_days: Number(formData.get('freeze_idle_days') || 3),
    auto_confirm_days: Number(formData.get('auto_confirm_days') || 14),
  };

  const res = await auditedUpdate({
    table: 'projects',
    id: projectId,
    patch,
    projectId,
    actor: staffActor(user),
    entity: 'project',
    action: 'project.settings_changed',
  });
  if (!res.ok) return { error: res.error };

  revalidatePath(`/admin/projects/${projectId}`);
  return { saved: true };
}

/* ── ラウンド（8.2 / 8.3 / 8.6）──────────────────────────────── */

export async function roundAdvance(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const roundId = String(formData.get('round_id') || '');
  const projectId = String(formData.get('project_id') || '');
  const to = String(formData.get('to') || '') as 'in_progress' | 'published' | 'frozen';
  if (!roundId || !projectId) return;

  const db = adminDb();
  const { data: project } = await db.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (!project) return;

  await advanceRound(projectId, roundId, to, staffActor(user), project as ProjectRow, db);
  revalidatePath(`/admin/projects/${projectId}`);
}

/** 無償カウントに入れるかどうか（5.2 の監査対象） */
export async function roundToggleFree(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const roundId = String(formData.get('round_id') || '');
  const projectId = String(formData.get('project_id') || '');
  const value = String(formData.get('value') || '') === 'true';
  if (!roundId || !projectId) return;

  await auditedUpdate({
    table: 'rounds',
    id: roundId,
    patch: { counts_free: value },
    projectId,
    actor: staffActor(user),
    entity: 'round',
    action: 'round.counts_free_changed',
  });
  revalidatePath(`/admin/projects/${projectId}`);
}

/** 次のラウンドを開く（持ち越し分を引き取る。8.4） */
export async function roundOpen(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const projectId = String(formData.get('project_id') || '');
  if (!projectId) return;

  const db = adminDb();
  const roundId = await openRound(projectId, db);
  if (roundId) {
    await logEvent({
      projectId,
      actor: staffActor(user),
      entity: 'round',
      entityId: roundId,
      action: 'round.opened',
    });
  }
  revalidatePath(`/admin/projects/${projectId}`);
}

/* ── 依頼の分類・状態の変更（5.2 により events 必須）───────────── */

const FIELDS = ['category', 'subtype', 'status'] as const;
type Field = (typeof FIELDS)[number];

export async function updateRequestField(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const requestId = String(formData.get('request_id') || '');
  const field = String(formData.get('field') || '') as Field;
  const rawValue = String(formData.get('value') || '');
  if (!requestId || !FIELDS.includes(field)) return;

  const value = field === 'subtype' && rawValue === '' ? null : rawValue;

  const db = adminDb();
  const { data: reqRow } = await db
    .from('requests')
    .select('id, project_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!reqRow) return;

  await auditedUpdate({
    table: 'requests',
    id: requestId,
    patch: { [field]: value },
    projectId: reqRow.project_id,
    actor: staffActor(user),
    entity: 'request',
    action: `request.${field}_changed`,
    db,
  });

  revalidatePath(`/admin/projects/${reqRow.project_id}`);
  revalidatePath(`/admin/requests/${requestId}`);
}
