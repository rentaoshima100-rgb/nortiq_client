/**
 * 「本番に出たか」を返す。招待を送ってよいかの判定に使う。
 *
 * リポジトリを編集した瞬間はまだ本番に出ていない。GitHub Pages で1〜3分、
 * Vercel で30秒〜2分かかる。ここを待たずに招待を送ると、クライアントは
 * 何も出ないページを開いて「動かない」と言うことになる。
 *
 * 最終的な判定は**実際の本番 HTML を見る**こと（checkSite）。
 * deployment はあくまで「まだ出ていない理由」を言うための材料で、
 * GitHub 連携を使っていないデプロイでは何も返らない。
 */
import { getT } from '@/lib/i18n';
import { github, githubConfigured } from '@/lib/github-client';
import { deployState, type DeployState } from '@/lib/snippet-install';
import { checkSite } from '@/lib/onboarding';
import { currentStaff } from '@/lib/staff';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request) {
  const t = await getT();
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: t('権限がありません') }, { status: 403 });

  const projectId = new URL(req.url).searchParams.get('projectId');
  if (!projectId) return Response.json({ error: t('projectId がありません') }, { status: 400 });

  const { data } = await adminDb()
    .from('projects')
    .select(
      'site_url, snippet_key, repo_owner, repo_name, gh_installation_id, snippet_commit_sha, snippet_ref_url',
    )
    .eq('id', projectId)
    .maybeSingle();
  if (!data) return Response.json({ error: t('案件が見つかりません') }, { status: 404 });

  const p = data as {
    site_url: string | null;
    snippet_key: string;
    repo_owner: string | null;
    repo_name: string | null;
    gh_installation_id: number | null;
    snippet_commit_sha: string | null;
    snippet_ref_url: string | null;
  };

  const live = await checkSite(p.site_url);
  const keyMatches = live.snippetKey === p.snippet_key;

  let deploy: { state: DeployState; url: string | null; environment: string | null } | null = null;
  if (
    !live.hasSnippet &&
    githubConfigured() &&
    p.gh_installation_id &&
    p.repo_owner &&
    p.repo_name &&
    p.snippet_commit_sha
  ) {
    try {
      deploy = await deployState(
        github(),
        p.gh_installation_id,
        p.repo_owner,
        p.repo_name,
        p.snippet_commit_sha,
      );
    } catch {
      deploy = null;
    }
  }

  // 招待を送ってよいのは、本番の HTML にこの案件のスニペットが
  // 実際に出ているときだけ。デプロイの成否ではなく現物で判定する。
  const canInvite = live.reachable && live.hasSnippet && keyMatches;

  return Response.json({
    canInvite,
    live: { ...live, keyMatches },
    deploy,
    refUrl: p.snippet_ref_url,
    reason: canInvite
      ? null
      : !live.reachable
        ? 'サイトに接続できません。site_url が正しいか確認してください。'
        : !live.hasSnippet
          ? deploy?.state === 'pending'
            ? 'デプロイ中です。反映まで待ってください。'
            : deploy?.state === 'failure'
              ? 'デプロイが失敗しています。'
              : p.snippet_ref_url
                ? 'まだ本番に出ていません。PR がマージされていない可能性があります。'
                : 'スニペットがまだ入っていません。'
          : `本番のスニペットの data-project が "${live.snippetKey ?? '不明'}" で、この案件（"${p.snippet_key}"）と違います。`,
  });
}
