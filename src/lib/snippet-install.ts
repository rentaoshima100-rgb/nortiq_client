/**
 * スニペットをリポジトリに入れる
 *
 * onboarding.ts が「エンジニアに渡す指示文」を作るのに対し、こちらは
 * **その指示のうち必須の1つ目を、こちらで実行する**。
 *
 * これができるようになったのは、注入なしでも段2に留まる照合（Tier 0）が
 * 入って、導入に必要な編集がスニペット1行だけに減ったから。
 * JSX 305 要素への属性注入まで自動でやるのは、失敗したときの見え方が
 * 重すぎる。1ファイル1行の追記なら、取り消しも読み合わせも簡単に済む。
 *
 * 既定は PR。他人のリポジトリなので、直接コミットは案件ごとに明示的に
 * 許可されたときだけにする（projects.allow_direct_commit）。
 */
import type { GitHubClient, GhContentFile, GhTreeEntry } from './github.mjs';

/** 木を歩くときに入らない場所 */
const IGNORED_DIR =
  /(^|\/)(node_modules|\.git|\.next|\.nuxt|\.svelte-kit|dist|build|out|coverage|vendor|\.vercel)\//;

/**
 * 触ってよいファイルか。設定・鍵・ワークフローには絶対に書かない。
 * 導入手順で先方に約束している範囲（9.7）と揃えてある。
 */
const FORBIDDEN =
  /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|\.env|\.env\..*|.*\.config\.(js|mjs|cjs|ts)|tsconfig.*\.json)$|^\.github\//;

export type Stack = 'next-app' | 'next-pages' | 'static';

export interface PlannedFile {
  path: string;
  /** 挿入後の全文 */
  content: string;
  /** 既存 blob の sha。PUT に要る */
  sha: string;
  note: string;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface SnippetPlan {
  stack: Stack;
  files: PlannedFile[];
  skipped: SkippedFile[];
  /** canonical / og:url から拾った、登録すべきオリジンの候補 */
  originCandidates: string[];
  /** 木が大きすぎて GitHub 側で切られたか */
  treeTruncated: boolean;
}

export function snippetTag(appUrl: string, snippetKey: string, jsx: boolean): string {
  const src = `${appUrl.replace(/\/+$/, '')}/w.js`;
  return jsx
    ? `<script src="${src}" data-project="${snippetKey}" defer />`
    : `<script src="${src}" data-project="${snippetKey}" defer></script>`;
}

/** 既に入っているか。data-project が別案件のものなら「入っている」とはみなさない。 */
function existingSnippet(content: string): { present: boolean; key: string | null } {
  const tag = content.match(/<script\b[^>]*\/w\.js[^>]*>/i)?.[0] ?? null;
  if (!tag) return { present: false, key: null };
  return { present: true, key: tag.match(/data-project=["']([^"']+)["']/i)?.[1] ?? null };
}

/**
 * `</body>` の直前に入れる。最後の1つを狙う（テンプレート文字列の中に
 * 出てくることがあるため）。行頭の空白を合わせて、差分を1行だけにする。
 */
function insertBeforeBody(content: string, tag: string): string | null {
  const idx = content.toLowerCase().lastIndexOf('</body>');
  if (idx < 0) return null;
  const lineStart = content.lastIndexOf('\n', idx) + 1;
  const indent = content.slice(lineStart, idx).match(/^[ \t]*/)?.[0] ?? '';
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  return content.slice(0, lineStart) + indent + tag + eol + content.slice(lineStart);
}

function decode(file: GhContentFile): string {
  if (!file.content) return '';
  return Buffer.from(file.content, 'base64').toString('utf8');
}

/** canonical と og:url。実際の公開ドメインが登録値と違う事故を導入時に出すため。 */
function originsFrom(html: string): string[] {
  const out = new Set<string>();
  const push = (u: string | undefined) => {
    if (!u) return;
    try {
      out.add(new URL(u).origin);
    } catch {
      /* 相対 URL は候補にならない */
    }
  };
  push(html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]);
  push(html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1]);
  return [...out];
}

function pickStack(paths: string[]): { stack: Stack; targets: string[] } {
  const has = (p: string) => paths.includes(p);
  for (const base of ['app', 'src/app']) {
    for (const ext of ['tsx', 'jsx', 'js', 'ts']) {
      if (has(`${base}/layout.${ext}`)) {
        return { stack: 'next-app', targets: [`${base}/layout.${ext}`] };
      }
    }
  }
  for (const base of ['pages', 'src/pages']) {
    for (const ext of ['tsx', 'jsx', 'js']) {
      if (has(`${base}/_document.${ext}`)) {
        return { stack: 'next-pages', targets: [`${base}/_document.${ext}`] };
      }
    }
  }
  // 静的サイト。全ページに要るので *.html を全部見る。
  const html = paths.filter((p) => /\.html?$/i.test(p) && !IGNORED_DIR.test('/' + p));
  return { stack: 'static', targets: html.slice(0, 30) };
}

export interface PlanInput {
  gh: GitHubClient;
  installationId: number;
  owner: string;
  repo: string;
  ref: string;
  appUrl: string;
  snippetKey: string;
}

export async function planSnippetInstall(input: PlanInput): Promise<SnippetPlan> {
  const { gh, installationId: inst, owner, repo, ref, appUrl, snippetKey } = input;

  const tree = await gh.getTree(inst, owner, repo, ref);
  const paths = tree.entries
    .filter((e: GhTreeEntry) => e.type === 'blob')
    .map((e: GhTreeEntry) => e.path)
    .filter((p: string) => !IGNORED_DIR.test('/' + p));

  const { stack, targets } = pickStack(paths);
  const jsx = stack !== 'static';
  const tag = snippetTag(appUrl, snippetKey, jsx);

  const files: PlannedFile[] = [];
  const skipped: SkippedFile[] = [];
  const origins = new Set<string>();

  for (const path of targets) {
    if (FORBIDDEN.test(path)) {
      skipped.push({ path, reason: '設定ファイルには書き込みません' });
      continue;
    }
    const got = await gh.getFile(inst, owner, repo, path, ref);
    if (Array.isArray(got) || got.type !== 'file') {
      skipped.push({ path, reason: 'ファイルとして取得できませんでした' });
      continue;
    }
    const content = decode(got);
    if (/\.html?$/i.test(path)) for (const o of originsFrom(content)) origins.add(o);

    const found = existingSnippet(content);
    if (found.present && found.key === snippetKey) {
      skipped.push({ path, reason: '既に入っています' });
      continue;
    }
    if (found.present) {
      skipped.push({
        path,
        reason: `別案件のスニペットが入っています（data-project="${found.key ?? '不明'}"）。二重に入れると依頼が二重に飛ぶため、手で確認してください。`,
      });
      continue;
    }

    const next = insertBeforeBody(content, tag);
    if (next == null) {
      skipped.push({ path, reason: '</body> が見つかりませんでした' });
      continue;
    }
    files.push({ path, content: next, sha: got.sha, note: '</body> の直前に1行追加' });
  }

  return {
    stack,
    files,
    skipped,
    originCandidates: [...origins],
    treeTruncated: tree.truncated,
  };
}

export interface ApplyResult {
  mode: 'pr' | 'direct';
  /** PR の URL、または最後のコミットの URL */
  url: string;
  /** 反映されたコミット。デプロイ待ちの判定に使う */
  commitSha: string;
  branch: string;
  changed: string[];
}

export async function applySnippetInstall(
  input: PlanInput & { plan: SnippetPlan; direct: boolean; clientLabel: string },
): Promise<ApplyResult | null> {
  const { gh, installationId: inst, owner, repo, ref, plan, direct, snippetKey } = input;
  if (!plan.files.length) return null;

  const message = `修正依頼ツールのスニペットを追加（${snippetKey}）`;
  const branch = direct ? ref : `nortiq/setup-${snippetKey}`;

  if (!direct) {
    const head = await gh.getRef(inst, owner, repo, `heads/${ref}`);
    try {
      await gh.createBranch(inst, owner, repo, branch, head.object.sha);
    } catch (e) {
      // 既にある（前回の実行が途中で落ちた等）なら、そのまま積む。
      if (!/422/.test(String(e))) throw e;
    }
  }

  let commitSha = '';
  let lastUrl = '';
  const changed: string[] = [];
  for (const f of plan.files) {
    // 直前に他の変更が入っている可能性があるので、書く直前の sha を取り直す。
    let sha = f.sha;
    try {
      const cur = await gh.getFile(inst, owner, repo, f.path, branch);
      if (!Array.isArray(cur) && cur.type === 'file') sha = cur.sha;
    } catch {
      /* ブランチにまだ無いなら元の sha でよい */
    }
    const res = await gh.putFile(inst, owner, repo, f.path, f.content, message, branch, sha);
    commitSha = res.commit.sha;
    lastUrl = res.commit.html_url;
    changed.push(f.path);
  }

  if (direct) return { mode: 'direct', url: lastUrl, commitSha, branch, changed };

  const body = [
    '納品後の修正依頼ツール（Nortiq Revise）を有効にするための1行です。',
    '',
    `- 追加したファイル: ${changed.map((p) => `\`${p}\``).join(' , ')}`,
    '- 変更はスクリプトタグ1行だけで、他は触っていません',
    '- **本番に常設して構いません。** 招待トークンを持たない訪問者には一切描画しません（DOM も作りません）',
    '',
    'マージして本番に出た時点で、こちらからクライアントに招待をお送りします。',
  ].join('\n');

  const pr = await gh.createPull(inst, owner, repo, {
    title: message,
    head: branch,
    base: ref,
    body,
  });
  return { mode: 'pr', url: pr.html_url, commitSha, branch, changed };
}

export type DeployState = 'none' | 'pending' | 'success' | 'failure';

/**
 * そのコミットが本番に出たか。
 * 「リポジトリを編集した」と「本番に出た」は別物で、間を待たずに招待を送ると
 * クライアントは何も出ないページを開くことになる。
 */
export async function deployState(
  gh: GitHubClient,
  installationId: number,
  owner: string,
  repo: string,
  sha: string,
): Promise<{ state: DeployState; url: string | null; environment: string | null }> {
  const deps = await gh.deployments(installationId, owner, repo, sha);
  if (!deps.length) return { state: 'none', url: null, environment: null };

  let best: { state: DeployState; url: string | null; environment: string | null } = {
    state: 'pending',
    url: null,
    environment: deps[0].environment ?? null,
  };
  for (const d of deps) {
    const sts = await gh.deploymentStatuses(installationId, owner, repo, d.id);
    const latest = sts[0];
    if (!latest) continue;
    if (latest.state === 'success') {
      return { state: 'success', url: latest.environment_url, environment: d.environment };
    }
    if (latest.state === 'failure' || latest.state === 'error') {
      best = { state: 'failure', url: latest.environment_url, environment: d.environment };
    }
  }
  return best;
}
