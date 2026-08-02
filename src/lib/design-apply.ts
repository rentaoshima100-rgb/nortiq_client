/**
 * 採用した参考デザインを、実際のリポジトリに落とす（9.7）
 *
 * 参考デザインは **プレビュー用の自己完結した断片**で、リポジトリの
 * ソースそのものではない（相手は JSX かもしれないし Liquid かもしれない）。
 * そのまま貼れば動く、という代物ではないので、
 * **「今のソース」→「採用案の見た目」への書き換え**を作らせる。
 *
 * 守ること:
 *   - 自動マージはしない。例外なく PR で出す（9.8）
 *   - 当てる直前に old_str がブランチ HEAD でちょうど1回だけ出ることを再検証する。
 *     ここを省くと静かに壊れる（9.7）
 *   - 社内が差分を見てから PR を出す。作ると同時に PR は立てない
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Actor } from '@/lib/events';
import { github, githubConfigured, installationFor, installUrl } from '@/lib/github-client';
import { tokensText } from '@/lib/site-tokens.mjs';
import type { SiteTokens } from '@/lib/site-tokens-store';
import { adminDb } from '@/lib/supabase/admin';
import { DESIGNS_BUCKET } from '@/lib/design';

const MODEL = 'claude-opus-5';

/** 触ってよいパス（9.6）。ここに無いものは書かせない */
const ALLOWED = [/^src\//, /^app\//, /^components\//, /^styles\//, /^assets\//, /^public\//, /^index\.html$/];
const FORBIDDEN = [
  /^package(-lock)?\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^\.github\//,
  /^\.env/,
  /\.config\.(js|mjs|cjs|ts)$/,
  /^tsconfig(\.\w+)?\.json$/,
  /^node_modules\//,
];

const SOURCE_EXT = /\.(html?|jsx?|tsx?|vue|svelte|astro|liquid|erb|php|twig)$/i;

export interface Plan {
  file: string;
  oldStr: string;
  newStr: string;
  summary: string;
  notes: string[];
}

export type ApplyOutcome =
  | { ok: false; kind: 'no-repo' | 'no-credentials' | 'error'; message: string }
  | { ok: false; kind: 'needs-install'; message: string; installUrl: string | null }
  | { ok: true; applied: false; plan: Plan; message: string }
  | { ok: true; applied: true; plan: Plan; prUrl: string; branch: string };

function checkPath(file: string): string | null {
  if (!file || file.includes('..')) return 'パスが不正です';
  if (FORBIDDEN.some((re) => re.test(file))) return `禁止パスです: ${file}`;
  if (!ALLOWED.some((re) => re.test(file))) return `許可パスの外です: ${file}`;
  return null;
}

/** getFile はディレクトリだと配列を返す型。ここではファイルしか扱わない */
async function readFile(
  gh: ReturnType<typeof github>,
  inst: number,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<{ content: string; sha: string } | null> {
  const f = await gh.getFile(inst, owner, repo, path, ref);
  if (Array.isArray(f)) return null;
  return { content: Buffer.from(f.content ?? '', 'base64').toString('utf8'), sha: f.sha };
}

function countOccurrences(hay: string, needle: string): number {
  let n = 0;
  let i = 0;
  for (;;) {
    const at = hay.indexOf(needle, i);
    if (at < 0) break;
    n++;
    i = at + needle.length;
  }
  return n;
}

/**
 * 依頼が指している要素が、どのファイルに書かれているかを探す。
 *
 * 対応表（.nq/）はコミットしない運用なので、リポジトリ側からは引けない。
 * 依頼の outer_html から**特徴的な文字列**を取り、それを含むファイルを探す。
 * 機械的に決まるので、ここをモデルに推測させない。
 */
function anchorsFrom(outerHtml: string): string[] {
  const out: string[] = [];
  // 日本語の連なりは、そのサイトにしか無い文字列になりやすい
  for (const m of outerHtml.matchAll(/[぀-ヿ一-龯ー]{4,20}/g)) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (out.length >= 12) break;
  }
  for (const m of outerHtml.matchAll(/\b[A-Z]{4,16}\b/g)) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (out.length >= 18) break;
  }
  return out;
}

const SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string', description: '書き換えるファイルのパス。候補として渡したものの中から選ぶ' },
    oldStr: {
      type: 'string',
      description:
        '現在のファイルに**そのまま一字一句含まれている**文字列。書き換える範囲。ファイル内で一意になる長さにすること',
    },
    newStr: { type: 'string', description: 'oldStr を置き換える新しい文字列' },
    summary: { type: 'string', description: '何をどう変えたか。日本語で1〜3文' },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: '社内が確認すべき点。判断で決めたこと、確認が要ること。無ければ空配列',
    },
  },
  required: ['file', 'oldStr', 'newStr', 'summary', 'notes'],
  additionalProperties: false,
} as const;

const SYSTEM = `あなたはこのリポジトリを保守しているエンジニアです。採用されたデザイン案を、実際のソースに落とします。

**参考デザインはプレビュー用の自己完結した断片であり、このリポジトリのソースではありません。** クラス名は nqd- で始まり、単独で開けるように書かれています。**そのまま貼らないでください。** 案が示している「並び・比率・階層・余白の取り方」を読み取り、**このリポジトリの書き方に翻訳**してください。

守ること:
- **このファイルが使っている書き方に合わせること。** JSX なら JSX、テンプレートならテンプレート。周りのコードの記法・命名・インデントに揃える
- **既存のクラス名と CSS 変数を使うこと。** nqd- のクラスを持ち込まない。新しい色や書体を導入しない
- **style 属性でのインライン指定を新たに増やさないこと。** 元からインラインで書いているファイルなら、その流儀に合わせてよい
- 文言は変えないこと。案が文言の変更を含んでいても、**依頼が文言変更を求めていない限り元のまま**にする
- 頼まれていない範囲に手を入れないこと

oldStr の決まり:
- **現在のファイルに一字一句そのまま含まれている文字列**にしてください。空白もインデントも含めて正確に
- ファイル内で**ちょうど1回だけ**現れる長さにしてください。短すぎると複数箇所に当たって拒否されます
- 変更する範囲だけを取ってください。ファイル全体を oldStr にしないこと

notes には、あなたが判断で決めたことと、社内が施主に確認すべきことを書いてください（例: 実績数値の中身、主役に置く事業）。無ければ空配列にしてください。`;

export async function planImplementation(
  proposalId: string,
  actor: Actor,
  opts: { dryRun?: boolean } = {},
): Promise<ApplyOutcome> {
  const db = adminDb();

  const { data: p } = await db
    .from('design_proposals')
    .select('id, request_id, batch, variant, title, direction, rationale, html_path')
    .eq('id', proposalId)
    .maybeSingle();
  if (!p) return { ok: false, kind: 'error', message: '案が見つかりません' };

  const { data: req } = await db
    .from('requests')
    .select('id, seq, body, project_id, outer_html, page_path')
    .eq('id', p.request_id)
    .maybeSingle();
  if (!req) return { ok: false, kind: 'error', message: '依頼が見つかりません' };

  const { data: proj } = await db
    .from('projects')
    .select('id, repo_owner, repo_name, default_branch, gh_installation_id, design_tokens')
    .eq('id', req.project_id)
    .maybeSingle();
  if (!proj?.repo_owner || !proj.repo_name) {
    return { ok: false, kind: 'no-repo', message: 'この案件にリポジトリが設定されていません' };
  }
  if (!githubConfigured()) {
    return { ok: false, kind: 'no-credentials', message: 'GitHub App の認証情報が設定されていません' };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, kind: 'error', message: 'ANTHROPIC_API_KEY が設定されていません' };
  }

  const gh = github();
  let inst = proj.gh_installation_id as number | null;
  if (!inst) {
    try {
      inst = await installationFor(gh, proj.repo_owner);
    } catch (e) {
      return { ok: false, kind: 'error', message: `GitHub に接続できません: ${String(e)}` };
    }
    if (inst == null) {
      return {
        ok: false,
        kind: 'needs-install',
        message: `${proj.repo_owner}/${proj.repo_name} にまだ GitHub App が入っていません。`,
        installUrl: await installUrl(gh).catch(() => null),
      };
    }
  }

  const base = proj.default_branch || 'main';
  const owner = proj.repo_owner;
  const repo = proj.repo_name;

  // ── 採用案の HTML
  const { data: file } = await db.storage.from(DESIGNS_BUCKET).download(p.html_path as string);
  if (!file) return { ok: false, kind: 'error', message: '案の HTML を取り出せませんでした' };
  const designHtml = await file.text();

  // ── 対象ファイルを機械的に絞る
  let candidates: { path: string; content: string }[] = [];
  try {
    const tree = await gh.getTree(inst, owner, repo, base);
    const paths = (tree.entries as { path: string; type: string; size?: number }[])
      .filter((e) => e.type === 'blob' && SOURCE_EXT.test(e.path) && !checkPath(e.path))
      .filter((e) => (e.size ?? 0) < 400_000)
      .map((e) => e.path);

    const anchors = anchorsFrom(req.outer_html ?? '');
    const scored: { path: string; content: string; hits: number }[] = [];
    for (const path of paths.slice(0, 40)) {
      const f = await readFile(gh, inst, owner, repo, path, base);
      if (!f) continue;
      const hits = anchors.filter((a) => f.content.includes(a)).length;
      if (hits > 0) scored.push({ path, content: f.content, hits });
    }
    scored.sort((a, b) => b.hits - a.hits);
    candidates = scored.slice(0, 2).map(({ path, content }) => ({ path, content }));
  } catch (e) {
    return { ok: false, kind: 'error', message: `リポジトリを読めません: ${String(e)}` };
  }

  if (!candidates.length) {
    return {
      ok: false,
      kind: 'error',
      message:
        '依頼の箇所がリポジトリのどのファイルにあるか特定できませんでした。' +
        'ビルド後に生成される要素か、別のリポジトリにある可能性があります。手で当ててください。',
    };
  }

  // ── 書き換えを作らせる
  const tokens = (proj.design_tokens as SiteTokens | null) ?? null;
  const parts: string[] = [];
  parts.push(`# 依頼 #${req.seq}`);
  parts.push(req.body.trim());
  parts.push('');
  parts.push(`# 採用された案: ${p.title}（${p.direction}）`);
  parts.push(String(p.rationale));
  parts.push('');
  parts.push('## 案のプレビュー HTML（プレビュー用。そのまま貼らないこと）');
  parts.push('```html');
  parts.push(designHtml.slice(0, 12000));
  parts.push('```');
  parts.push('');
  const tok = tokensText(tokens);
  if (tok) parts.push(tok);
  parts.push('');
  parts.push('# 書き換え先の候補');
  for (const c of candidates) {
    parts.push(`## ${c.path}`);
    parts.push('```');
    parts.push(c.content.slice(0, 60000));
    parts.push('```');
  }

  const client = new Anthropic();
  let plan: Plan;
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: {
        effort: 'high', // 既存コードへの書き換え。ここは削らない
        format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: 'user', content: [{ type: 'text', text: parts.join('\n') }] }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      return { ok: false, kind: 'error', message: '生成が拒否されました' };
    }
    const t = msg.content.find((b) => b.type === 'text');
    if (!t || t.type !== 'text') return { ok: false, kind: 'error', message: '空の応答' };
    plan = JSON.parse(t.text) as Plan;
  } catch (e) {
    return { ok: false, kind: 'error', message: `書き換えを作れませんでした: ${String(e)}` };
  }

  // ── ゲート（9.6）
  const pathErr = checkPath(plan.file);
  if (pathErr) return { ok: false, kind: 'error', message: pathErr };

  const target = candidates.find((c) => c.path === plan.file);
  if (!target) {
    return { ok: false, kind: 'error', message: `候補に無いファイルを指しています: ${plan.file}` };
  }
  if (!/\bstyle\s*=/.test(plan.oldStr) && /\bstyle\s*=/.test(plan.newStr)) {
    return { ok: false, kind: 'error', message: 'style 属性のインライン付与は禁止です' };
  }
  if (/!important/.test(plan.newStr) && !/!important/.test(plan.oldStr)) {
    return { ok: false, kind: 'error', message: '!important の使用は禁止です' };
  }
  if (/nqd-/.test(plan.newStr)) {
    return {
      ok: false,
      kind: 'error',
      message: 'プレビュー用のクラス（nqd-）が残っています。リポジトリの書き方に翻訳できていません。',
    };
  }

  if (!opts.dryRun) {
    // 当てる直前に、ブランチ HEAD の現在の内容で再検証する（9.7）
    const branch = `nq/design-${req.seq}-v${p.variant}`;
    try {
      let headSha: string;
      try {
        const ref = await gh.getRef(inst, owner, repo, `heads/${branch}`);
        headSha = ref.object.sha;
      } catch {
        const b = await gh.getRef(inst, owner, repo, `heads/${base}`);
        await gh.createBranch(inst, owner, repo, branch, b.object.sha);
        headSha = b.object.sha;
      }

      const cur = await readFile(gh, inst, owner, repo, plan.file, branch);
      if (!cur) {
        return { ok: false, kind: 'error', message: `${plan.file} を読めませんでした` };
      }
      const n = countOccurrences(cur.content, plan.oldStr);
      if (n !== 1) {
        return {
          ok: false,
          kind: 'error',
          message:
            n === 0
              ? '当てる直前の再検証で、書き換え対象が見つかりませんでした。ファイルが変わっています。作り直してください。'
              : `書き換え対象が ${n} 箇所に当たります。範囲が一意になっていないので当てられません。`,
        };
      }

      const next = cur.content.replace(plan.oldStr, plan.newStr);
      await gh.putFile(
        inst,
        owner,
        repo,
        plan.file,
        Buffer.from(next, 'utf8'),
        `依頼 #${req.seq} の参考デザイン「${p.title}」を反映`,
        branch,
        cur.sha,
      );

      const pr = await gh.createPull(inst, owner, repo, {
        title: `依頼 #${req.seq}: ${p.title}`,
        head: branch,
        base,
        body:
          `修正依頼 #${req.seq} に対する参考デザイン案「${p.title}」を反映しました。\n\n` +
          `> ${req.body.trim()}\n\n` +
          `## 変更点\n${plan.summary}\n\n` +
          (plan.notes.length
            ? `## 確認してください\n${plan.notes.map((x) => `- ${x}`).join('\n')}\n\n`
            : '') +
          `---\n自動マージはしません。内容を確認してからマージしてください。\n` +
          `参考デザインはプレビュー用の断片を翻訳したものです。実際の表示は必ず確認してください。\n` +
          `_${headSha.slice(0, 7)} から作成 / 操作: ${actor.type}_`,
      });

      return { ok: true, applied: true, plan, prUrl: pr.html_url, branch };
    } catch (e) {
      return { ok: false, kind: 'error', message: `PR を作れませんでした: ${String(e)}` };
    }
  }

  // ── 下書きの段階でも、当たるかどうかは今の内容で確かめておく
  const n = countOccurrences(target.content, plan.oldStr);
  if (n !== 1) {
    return {
      ok: false,
      kind: 'error',
      message:
        n === 0
          ? '書き換え対象がファイルに見つかりません。作り直してください。'
          : `書き換え対象が ${n} 箇所に当たります。範囲が一意になっていません。`,
    };
  }

  return {
    ok: true,
    applied: false,
    plan,
    message: `${plan.file} の1箇所を書き換えます。PR を出すまでリポジトリは変わりません。`,
  };
}
