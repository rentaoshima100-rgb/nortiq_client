/**
 * アプリ側から GitHub App を使うための入口。
 *
 * 認証の実装は src/lib/github.mjs（ワーカーと共有）。ここは
 * 「案件 → インストール ID」の解決だけを持つ。
 */
import { appIdFromEnv, createGitHub, privateKeyFromEnv, type GitHubClient } from './github.mjs';

export function githubConfigured(): boolean {
  return !!(
    (process.env.NQ_GH_APP_ID || process.env.GITHUB_APP_ID) &&
    (process.env.NQ_GH_APP_PRIVATE_KEY_B64 ||
      process.env.GITHUB_APP_PRIVATE_KEY_B64 ||
      process.env.NQ_GH_APP_PRIVATE_KEY ||
      process.env.GITHUB_APP_PRIVATE_KEY)
  );
}

export function github(): GitHubClient {
  return createGitHub(appIdFromEnv(), privateKeyFromEnv());
}

/**
 * オーナー名からインストール ID を引く。
 *
 * インストールはリポジトリのオーナーがブラウザで承認したときに作られる。
 * ここで見つからない = まだ App が入っていない、ということなので、
 * 「入れてもらってください」と言えるだけの情報を返す。
 */
export async function installationFor(
  gh: GitHubClient,
  owner: string,
): Promise<number | null> {
  const list = await gh.installations();
  const hit = list.find((i) => i.account?.login?.toLowerCase() === owner.toLowerCase());
  return hit ? hit.id : null;
}

/** App のインストール画面。オーナーに踏んでもらう導線に使う。 */
export async function installUrl(gh: GitHubClient): Promise<string> {
  const app = await gh.app();
  return `https://github.com/apps/${app.slug}/installations/new`;
}
