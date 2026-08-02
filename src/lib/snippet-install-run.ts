/**
 * 「案件 → リポジトリを編集する」を1本にまとめたもの。
 *
 * 案件を作った直後（actions.ts の createProject）と、案件ページのボタン
 * （api/admin/snippet）の両方から呼ぶ。二重実装にすると、片方だけ
 * 冪等性や記録が抜ける。
 */
import { appUrl } from '@/lib/env';
import { auditedUpdate } from '@/lib/events';
import { github, githubConfigured, installationFor, installUrl } from '@/lib/github-client';
import {
  applySnippetInstall,
  planSnippetInstall,
  type ApplyResult,
  type SnippetPlan,
} from '@/lib/snippet-install';
import { adminDb } from '@/lib/supabase/admin';
import type { Actor } from '@/lib/events';

export interface ProjectForInstall {
  id: string;
  snippet_key: string;
  repo_owner: string | null;
  repo_name: string | null;
  default_branch: string | null;
  gh_installation_id: number | null;
  allow_direct_commit: boolean | null;
}

export const INSTALL_COLUMNS =
  'id, snippet_key, repo_owner, repo_name, default_branch, gh_installation_id, allow_direct_commit';

export type RunOutcome =
  | { ok: false; kind: 'no-repo' | 'no-credentials'; message: string }
  | { ok: false; kind: 'needs-install'; message: string; installUrl: string | null }
  | { ok: false; kind: 'error'; message: string }
  | { ok: true; applied: false; plan: SnippetPlan; message: string }
  | { ok: true; applied: true; plan: SnippetPlan; result: ApplyResult };

export async function runSnippetInstall(
  p: ProjectForInstall,
  actor: Actor,
  opts: { dryRun?: boolean } = {},
): Promise<RunOutcome> {
  if (!p.repo_owner || !p.repo_name) {
    return { ok: false, kind: 'no-repo', message: 'この案件にリポジトリが設定されていません' };
  }
  if (!githubConfigured()) {
    return {
      ok: false,
      kind: 'no-credentials',
      message: 'GitHub App の認証情報が設定されていません',
    };
  }

  const gh = github();
  let installationId = p.gh_installation_id;
  if (!installationId) {
    try {
      installationId = await installationFor(gh, p.repo_owner);
    } catch (e) {
      return { ok: false, kind: 'error', message: `GitHub に接続できません: ${String(e)}` };
    }
    if (installationId == null) {
      return {
        ok: false,
        kind: 'needs-install',
        message: `${p.repo_owner}/${p.repo_name} にまだ GitHub App が入っていません。リポジトリの管理者に入れてもらってください。`,
        installUrl: await installUrl(gh).catch(() => null),
      };
    }
    await adminDb().from('projects').update({ gh_installation_id: installationId }).eq('id', p.id);
  }

  const input = {
    gh,
    installationId,
    owner: p.repo_owner,
    repo: p.repo_name,
    ref: p.default_branch || 'main',
    appUrl: appUrl(),
    snippetKey: p.snippet_key,
  };

  let plan: SnippetPlan;
  try {
    plan = await planSnippetInstall(input);
  } catch (e) {
    return { ok: false, kind: 'error', message: `リポジトリを読めませんでした: ${String(e)}` };
  }

  if (opts.dryRun) {
    return { ok: true, applied: false, plan, message: '実行していません（内容の確認のみ）' };
  }
  if (!plan.files.length) {
    const allPresent =
      plan.skipped.length > 0 && plan.skipped.every((s) => s.reason === '既に入っています');
    return {
      ok: true,
      applied: false,
      plan,
      message: allPresent
        ? 'すべてのファイルに既に入っています。'
        : '書き換えられるファイルが見つかりませんでした。',
    };
  }

  let result: ApplyResult | null;
  try {
    result = await applySnippetInstall({
      ...input,
      plan,
      direct: !!p.allow_direct_commit,
      clientLabel: p.snippet_key,
    });
  } catch (e) {
    return { ok: false, kind: 'error', message: `書き込みに失敗しました: ${String(e)}` };
  }
  if (!result) return { ok: true, applied: false, plan, message: '変更はありませんでした。' };

  // 直接コミットのときだけ installed として記録する。PR は人間がマージするまで
  // 本番に出ないので、ここで installed 扱いにすると招待を早く出してしまう。
  await auditedUpdate({
    table: 'projects',
    id: p.id,
    projectId: p.id,
    entity: 'projects',
    action: result.mode === 'pr' ? 'snippet_pr_opened' : 'snippet_committed',
    actor,
    patch: {
      snippet_commit_sha: result.commitSha,
      snippet_ref_url: result.url,
      ...(result.mode === 'direct' ? { snippet_installed_at: new Date().toISOString() } : {}),
    },
  });

  return { ok: true, applied: true, plan, result };
}
