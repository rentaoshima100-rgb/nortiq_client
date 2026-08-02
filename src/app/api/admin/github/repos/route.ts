/**
 * App が触れるリポジトリの一覧。案件を作るときの選択肢に使う。
 *
 * インストールはリポジトリのオーナーがブラウザで承認したときに作られる。
 * ここに出てこない = まだ入っていない、なので、入れてもらう導線も一緒に返す。
 */
import { github, githubConfigured, installUrl } from '@/lib/github-client';
import { currentStaff } from '@/lib/staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: '権限がありません' }, { status: 403 });
  if (!githubConfigured()) {
    return Response.json({ error: 'GitHub App の認証情報が設定されていません' }, { status: 400 });
  }

  const gh = github();
  try {
    const installs = await gh.installations();
    const repos: { fullName: string; defaultBranch: string; installationId: number }[] = [];
    for (const inst of installs) {
      const list = await gh.repos(inst.id).catch(() => []);
      for (const r of list) {
        repos.push({
          fullName: r.full_name,
          defaultBranch: r.default_branch,
          installationId: inst.id,
        });
      }
    }
    repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
    return Response.json({
      repos,
      installUrl: await installUrl(gh).catch(() => null),
    });
  } catch (e) {
    return Response.json({ error: `GitHub に接続できません: ${String(e)}` }, { status: 502 });
  }
}
