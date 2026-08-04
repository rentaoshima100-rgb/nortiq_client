'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auditedUpdate, logEvent } from '@/lib/events';
import { newToken, sha256hex } from '@/lib/hash';
import { getT } from '@/lib/i18n';
import { notifyOnce, publishedMessage } from '@/lib/line';
import { advanceRound, openRound } from '@/lib/rounds';
import { refreshProjectTokens } from '@/lib/site-tokens-store';
import { runSnippetInstall } from '@/lib/snippet-install-run';
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
  const t = await getT();
  const user = await requireStaff();

  const name = String(formData.get('name') || '').trim();
  const clientName = String(formData.get('client_name') || '').trim();
  const siteUrl = String(formData.get('site_url') || '').trim();
  const snippetKey = String(formData.get('snippet_key') || '').trim();
  const stack = String(formData.get('stack') || 'static');
  // 「owner/name」。空なら従来どおり、リポジトリ無しで案件だけ作る。
  const repoFull = String(formData.get('repo') || '').trim();
  const directCommit = formData.get('allow_direct_commit') === 'on';

  if (!name || !clientName || !siteUrl || !snippetKey) {
    return { error: t('すべての項目を入力してください') };
  }
  let repoOwner: string | null = null;
  let repoName: string | null = null;
  if (repoFull) {
    const m = /^([^/\s]+)\/([^/\s]+)$/.exec(repoFull);
    if (!m) return { error: t('リポジトリは owner/name の形式で指定してください') };
    [, repoOwner, repoName] = m;
  }
  let origin: string;
  try {
    const u = new URL(siteUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
    origin = u.origin;
  } catch {
    return { error: t('サイトURLは https://example.com の形式で入力してください') };
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(snippetKey)) {
    return { error: t('スニペットキーは英小文字・数字・ハイフンで指定してください') };
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
      repo_owner: repoOwner,
      repo_name: repoName,
      allow_direct_commit: directCommit,
    })
    .select('id')
    .single();

  if (error || !data) {
    return {
      error:
        error?.code === '23505'
          ? t('そのスニペットキーは既に使われています')
          : t('作成に失敗しました'),
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

  // 設計トークンを一度だけ抜いて持たせる。
  // 参考デザインを作るときの色と書体の選択肢をここで閉じる。
  // 失敗しても登録は止めない（案件設定から取り直せる）
  await refreshProjectTokens(data.id, origin);

  // リポジトリが選ばれているなら、その場でスニペットを入れる。
  // ここが「案件を作る＝サイト側の準備も終わる」の実体。
  // 失敗しても案件の作成は止めない。案件ページから何度でもやり直せるし、
  // 止めてしまうと「作れなかったのか入らなかったのか」が分からなくなる。
  if (repoOwner && repoName) {
    try {
      const out = await runSnippetInstall(
        {
          id: data.id,
          snippet_key: snippetKey,
          repo_owner: repoOwner,
          repo_name: repoName,
          default_branch: null,
          gh_installation_id: null,
          allow_direct_commit: directCommit,
        },
        staffActor(user),
      );
      if (!out.ok) console.warn('[createProject] スニペット投入を見送りました:', out.message);
    } catch (e) {
      console.error('[createProject] スニペット投入に失敗しました', e);
    }
  }

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
  const t = await getT();
  const user = await requireStaff();
  const projectId = String(formData.get('project_id') || '');
  const label = String(formData.get('label') || '').trim() || null;
  if (!projectId) return { error: t('案件が指定されていません') };

  const db = adminDb();
  const { data: project } = await db
    .from('projects')
    .select('id, site_url')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return { error: t('案件が見つかりません') };

  const token = newToken();
  const tokenHash = sha256hex(token);
  const expiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();

  const { error } = await db.from('client_sessions').insert({
    token_hash: tokenHash,
    project_id: projectId,
    label,
    expires_at: expiresAt,
  });
  if (error) return { error: t('発行に失敗しました') };

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
  const t = await getT();
  const user = await requireStaff();
  const projectId = String(formData.get('project_id') || '');
  if (!projectId) return { error: t('案件が指定されていません') };

  const repo = String(formData.get('repo') || '').trim();
  let repoOwner: string | null = null;
  let repoName: string | null = null;
  if (repo) {
    const m = /^([\w.-]+)\/([\w.-]+)$/.exec(repo);
    if (!m) return { error: t('リポジトリは owner/name の形式で入力してください') };
    repoOwner = m[1];
    repoName = m[2];
  }

  const lineTo = String(formData.get('line_to') || '').trim() || null;

  const patch = {
    line_to: lineTo,
    // 「, 」区切りで受け、末尾スラッシュを落として正規化する。
    // オリジンは完全一致で照合するので、表記ゆれがそのまま不具合になる。
    extra_origins: String(formData.get('extra_origins') || '')
      .split(/[,\s]+/)
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter((s) => /^https?:\/\//.test(s)),
    repo_owner: repoOwner,
    repo_name: repoName,
    default_branch: String(formData.get('default_branch') || 'main').trim() || 'main',
    allow_direct_commit: formData.get('allow_direct_commit') === 'on',
    // リポジトリを付け替えたときに、前のオーナーのインストール ID が残ると
    // 「権限はあるのに別のリポジトリを触る」になる。毎回引き直させる。
    gh_installation_id: null,
    rounds_enabled: formData.get('rounds_enabled') === 'on',
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

  const res = await advanceRound(projectId, roundId, to, staffActor(user), project as ProjectRow, db);

  // 公開したらクライアントに知らせる（11.1）。
  // 公開へ進めるのは人間の判断なので、通知もここで初めて出る（9.8）。
  if (res.ok && to === 'published') {
    const p = project as ProjectRow & { line_to: string | null };
    await notifyOnce({
      projectId,
      to: p.line_to ?? null,
      dedupeKey: `round:${roundId}:published`,
      text: publishedMessage(p.name, p.site_url, p.auto_confirm_days ?? 14),
    });
  }

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


/**
 * 設計トークンを取り直す（サイトを作り直したとき）。
 * 抽出は本番サイトの CSS を読むだけで、サイトには何も書き込まない。
 */
export async function refreshTokens(formData: FormData): Promise<void> {
  const t = await getT();
  const user = await requireStaff();
  const projectId = String(formData.get('project_id') || '');
  if (!projectId) return;

  const { data: p } = await adminDb()
    .from('projects')
    .select('site_url')
    .eq('id', projectId)
    .maybeSingle();

  const tokens = await refreshProjectTokens(projectId, p?.site_url ?? null);

  await logEvent({
    projectId,
    actor: staffActor(user),
    entity: 'project',
    entityId: projectId,
    action: 'project.design_tokens_refreshed',
    after: tokens
      ? { colors: tokens.colors.length, fonts: tokens.fonts.length, vars: tokens.vars.length }
      : { error: t('取得できませんでした') },
  });

  revalidatePath(`/admin/projects/${projectId}`);
}
