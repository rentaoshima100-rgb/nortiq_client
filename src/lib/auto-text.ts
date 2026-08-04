/**
 * 文言と文字まわりの自動反映（設計 8.2 / 9.2 / 9.5 / 9.7）
 *
 * 「ここの文字を大きく」「この一文を直して」は、判断の余地が小さく
 * 壊しても戻しやすい。ここだけを自動で回す。
 *
 * 自動で回してよい条件を厳しく取る:
 *   - 案件で ai_enabled が立っている
 *   - 依頼が **minor かつ text / style**。仕様変更・不具合は対象外（8.1）
 *   - 分類が自動でついた場合、**自信が高いものだけ**通す
 *   - 構造を変える書き換えは拒否する（9.5）
 *
 * クライアントの操作では発火しない（9.2）。デバウンスを置いて溜めてから
 * まとめて出す。1依頼1PRにすると N ブランチ N PR N レビューになる。
 *
 * **自動マージはしない。例外なく PR で出す（9.8）**
 */
import Anthropic from '@anthropic-ai/sdk';
import { github, githubConfigured, installationFor } from '@/lib/github-client';
import { adminDb } from '@/lib/supabase/admin';
import { logEvent, type Actor } from '@/lib/events';
import { tokensText } from '@/lib/site-tokens.mjs';
import type { SiteTokens } from '@/lib/site-tokens-store';

const MODEL = 'claude-opus-5';
const SYSTEM_ACTOR: Actor = { type: 'system', id: 'auto-text' };

// 許可はディレクトリで決めない。
// 実測: loop_asia は styles.css も app.jsx も**ルート直下**にあり、
// ディレクトリ許可では index.html しか候補にならなかった。
// 守るべき境界は「禁止パス」の側にあるので、そちらだけを見る。
const FORBIDDEN = [
  /^package(-lock)?\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^\.github\//,
  /^\.env/,
  /\.config\.(js|mjs|cjs|ts)$/,
  /^tsconfig(\.\w+)?\.json$/,
  /^node_modules\//,
  /^(dist|build|out|\.next)\//,   // ビルド成果物。直しても次のビルドで消える
  /\.min\.(js|css)$/,
];
const MARKUP_EXT = /\.(html?|jsx?|tsx?|vue|svelte|astro|liquid|erb|php|twig)$/i;
const STYLE_EXT = /\.(css|scss|sass|less|styl)$/i;
const SOURCE_EXT = new RegExp(`${MARKUP_EXT.source}|${STYLE_EXT.source}`, 'i');

function pathError(file: string): string | null {
  if (!file || file.includes('..')) return 'パスが不正です';
  if (FORBIDDEN.some((re) => re.test(file))) return `禁止パスです: ${file}`;
  if (!SOURCE_EXT.test(file)) return `ソースファイルではありません: ${file}`;
  return null;
}

function count(hay: string, needle: string): number {
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

/* ── 分類 ───────────────────────────────────────────────────────────────── */

const CLASSIFY_SYSTEM = `あなたは制作会社のディレクターです。クライアントから来た修正依頼を仕分けします。

**前提を取り違えないでください。**

1. **入ってくる文は、必ず「直してほしいこと」です。** クライアントは本番サイト上で要素をクリックし、修正依頼のフォームから送っています。感想や独り言ではありません。**指摘は指示として読んでください。**
   - 「小さい」→ 大きくしてほしい
   - 「読みにくい」→ 読みやすくしてほしい
   - 「違うイメージ写真がよい」→ この画像を差し替えてほしい

2. **どの要素の話かは、すでに決まっています。** クリックされた要素を一緒に渡します。「対象が複数あって分からない」とは考えないでください。**渡された要素が対象です。**

3. **依頼文はたいてい断片です。** 文になっていないのが普通です。「イメージ写真」「貝塚　亜起良」のような短い語だけのこともあります。
   - 文字の要素に語句だけ → **その語句に差し替えてほしい**（text）
   - 画像の要素に「イメージ写真」 → **この画像を差し替えてほしい**（asset）

4. **具体的な数値は求めないでください。** 「大きく」で十分です。何 px にするかは実装側が、そのサイトの既存の刻みから選びます。**数値が書かれていないことを理由に自信を下げないでください。**

category:
- minor    元からある要素の**中身か見え方を変えるだけ**。文言の差し替え、誤字、文字の大小・太さ・行間・字間・色、画像の差し替え
- spec_change  要素を**増やす・減らす・並べ替える**。機能やページの変更。「この下に〜を記載」「〜を追加」「〜を無くして」「順番を」
- defect   壊れている。表示崩れ、動かない、リンク切れ。「ずれている」「押せない」「表示されない」
- unclassified  **本当に判断がつかないときだけ。** 依頼文が要素と噛み合っていない、複数の別々のことを同時に言っている、など

subtype（minor のとき）:
- text   文言そのものを変える
- style  文字の大きさ・太さ・色・行間・字間・余白を変える
- asset  画像を差し替える
- order  並べ替え（これは minor にしない。spec_change です）

confidence:
- high    **渡された要素に対して、何をすればよいかが決まる。** 数値まで書かれている必要はない
- medium  要素は分かるが、変更の方向が読み取れない
- low     依頼文と要素が噛み合っておらず、推測が要る

**自動反映は minor かつ text / style かつ confidence が high のものだけ**に使われます。当てたものは PR として出て、人がマージします。

迷ったら unclassified にしてください。ただし、**上の1〜4を理由に迷わないでください。** そこは前提であって、曖昧さではありません。`;

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['minor', 'spec_change', 'defect', 'unclassified'] },
    subtype: { type: 'string', enum: ['text', 'style', 'asset', 'order', 'none'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string', description: 'そう判断した理由。日本語1文' },
  },
  required: ['category', 'subtype', 'confidence', 'reason'],
  additionalProperties: false,
} as const;

export interface Classification {
  category: 'minor' | 'spec_change' | 'defect' | 'unclassified';
  subtype: 'text' | 'style' | 'asset' | 'order' | 'none';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export async function classify(body: string, outerHtml: string | null): Promise<Classification> {
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2000,
    system: CLASSIFY_SYSTEM,
    output_config: {
      effort: 'low', // 仕分けは短い判断。ここに時間をかけない
      format: { type: 'json_schema', schema: CLASSIFY_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `# クライアントが送ってきた修正依頼\n${body.trim()}\n\n` +
              (outerHtml
                ? `# クライアントがクリックした要素（これが対象です）\n\`\`\`\n${outerHtml.slice(0, 2000)}\n\`\`\``
                : ''),
          },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  const t = msg.content.find((b) => b.type === 'text');
  if (!t || t.type !== 'text') throw new Error('分類が空でした');
  return JSON.parse(t.text) as Classification;
}

/* ── 書き換え ───────────────────────────────────────────────────────────── */

const PATCH_SYSTEM = `あなたはこのリポジトリを保守しているエンジニアです。クライアントからの修正依頼を、**最小の書き換え**で反映します。

**やってよいのは、文言を変えることと、文字の大きさ・太さ・行間・字間・色を変えることだけです。**

やってはいけないこと:
- 要素を増やす・減らす・並べ替える
- タグや構造を変える
- 新しいクラスや CSS 変数を作る
- 依頼に書かれていない箇所を直す（ついでの整形もしない）
- style 属性を新しく足す（元からインラインで書いているファイルなら、その流儀に合わせてよい）
- 色や書体を、そのサイトで使われていないものに変える

**依頼が上の範囲を超えている場合は、applicable を false にして理由を書いてください。** 無理に当てないでください。人が見ます。

**依頼に具体的な数値が無いのが普通です。** 「大きく」「小さく」しか書かれていません。そのときは、**そのサイトで実際に使われている刻みの中から、隣の値を選んでください**（下に一覧を渡します）。倍にしたり、一覧に無い中途半端な値を作ったりしないこと。1段動かすのが基本です。

**クリックされた要素がコンテナのことがあります**（ヘッダー全体など）。その中にロゴ名・ナビ・英字サブテキストのように複数のテキストが入っている場合、**どれか1つを選ばないでください。** その要素の中にあるテキストを**まとめて1段動かします**。edits に、それぞれの指定を並べてください（同じファイル内に限ります）。「どれのことか分からない」と返さないでください。クライアントはその塊を見て言っています。

oldStr の決まり:
- 現在のファイルに**一字一句そのまま含まれている**文字列にしてください。空白もインデントも正確に
- ファイル内で**ちょうど1回だけ**現れる長さにしてください
- 変更する範囲だけを取ってください。**前後の行を巻き込まないこと**

**同じ文字列がファイル内に複数あることがあります**（役職名、年号、同じ見出し）。そのときは、**直前の属性やタグごと含めて一意にしてください。** 依頼にはクリックされた要素の nq-id を添えています。ソースに data-nq-id が入っているなら、**その属性を含む形で oldStr を取るのが確実です**。短く取って複数に当たると、その依頼はまるごと見送りになります。`;

const PATCH_SCHEMA = {
  type: 'object',
  properties: {
    applicable: { type: 'boolean', description: '文言・文字まわりの変更として当てられるか' },
    reason: { type: 'string', description: 'applicable が false のときの理由。true なら空文字でよい' },
    file: { type: 'string', description: '書き換えるファイル。候補として渡したものから選ぶ' },
    edits: {
      type: 'array',
      description:
        '同じファイルへの書き換え。ヘッダーのように配下に複数のテキストがある場合は、' +
        'それぞれの指定をここに並べる。1件でもよい',
      items: {
        type: 'object',
        properties: {
          oldStr: { type: 'string' },
          newStr: { type: 'string' },
        },
        required: ['oldStr', 'newStr'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string', description: '何をどう変えたか。日本語1文' },
  },
  required: ['applicable', 'reason', 'file', 'edits', 'summary'],
  additionalProperties: false,
} as const;

interface Patch {
  applicable: boolean;
  reason: string;
  file: string;
  edits: { oldStr: string; newStr: string }[];
  summary: string;
}

/**
 * マークアップを探す手がかり。
 *
 * 実測でここが原因の見送りが 17件中 7件あった。
 *   「令和6年」「平成28年」「着工：平成29年9月」
 * 日本語だけの連なりを 4文字以上で拾っていたので、**数字で切れて**
 * 令和(2) + 年(1) にしかならず、手がかりが1つも取れていなかった。
 *
 * nq_id があるならそれが最も強い。ソースに注入されているサイトでは
 * 一意に決まる。無いサイトのために文字列も併用する。
 */
function anchorsFrom(outerHtml: string, nqId: string | null): string[] {
  const out: string[] = [];
  if (nqId) out.push(nqId);

  // 日本語で始まり、途中に数字や英字が混ざってもよい連なり
  for (const m of outerHtml.matchAll(/[぀-ヿ一-龯][぀-ヿ一-龯ー0-9０-９a-zA-Z：・]{2,23}/g)) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (out.length >= 14) break;
  }
  // 短いものしか無いときの保険。2文字の熟語でも無いよりよい
  if (out.length <= (nqId ? 1 : 0)) {
    for (const m of outerHtml.matchAll(/[一-龯]{2,}/g)) {
      if (!out.includes(m[0])) out.push(m[0]);
      if (out.length >= 8) break;
    }
  }
  for (const m of outerHtml.matchAll(/\b[A-Z]{4,16}\b/g)) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * スタイルシートを探す手がかり。
 *
 * 文字サイズの指定は CSS にあり、**そこに日本語は入っていない**。
 * 本文の文字列で探すと、スタイルシートは永久に候補に入らない。
 * クラス名と、実際に当たっているセレクタで探す。
 */
function selectorsFrom(outerHtml: string, cssRules: { selector: string }[] | null): string[] {
  const out: string[] = [];
  for (const m of outerHtml.matchAll(/class(?:Name)?\s*=\s*["']([^"']+)["']/gi)) {
    for (const cls of m[1].split(/\s+/)) {
      if (cls.length >= 3 && !out.includes(cls)) out.push(cls);
    }
  }
  for (const r of cssRules ?? []) {
    for (const m of String(r.selector).matchAll(/[.#]([\w-]{3,})/g)) {
      if (!out.includes(m[1])) out.push(m[1]);
    }
  }
  return out.slice(0, 24);
}

/**
 * 構造を変えていないかを機械で見る（9.5）
 * モデルの自己申告だけに頼らない。
 */
function structureChanged(oldStr: string, newStr: string): string | null {
  const tags = (s: string) =>
    [...s.matchAll(/<\s*\/?\s*([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase()).sort().join(',');
  if (tags(oldStr) !== tags(newStr)) {
    return 'タグの構成が変わっています。文言・文字まわりの変更ではありません。';
  }
  if (!/\bstyle\s*=/.test(oldStr) && /\bstyle\s*=/.test(newStr)) {
    return 'style 属性を新しく足しています。';
  }
  if (/!important/.test(newStr) && !/!important/.test(oldStr)) {
    return '!important を新しく使っています。';
  }
  const grew = newStr.length / Math.max(1, oldStr.length);
  if (grew > 3) return '書き換え後が元の3倍を超えています。最小の変更になっていません。';
  return null;
}

export interface AutoResult {
  requestId: string;
  seq: number;
  status: 'applied' | 'skipped' | 'failed';
  detail: string;
}

/**
 * 1案件ぶん回す。**PR は1本にまとめる**（9.2 の理由2）。
 * 依頼ごとに PR を立てると N ブランチ N レビューになる。
 */
export async function runAutoText(
  projectId: string,
  opts: { manual?: boolean } = {},
): Promise<{
  ok: boolean;
  message: string;
  results: AutoResult[];
  prUrl?: string;
}> {
  const db = adminDb();
  const results: AutoResult[] = [];

  const { data: proj } = await db
    .from('projects')
    .select(
      'id, name, ai_enabled, repo_owner, repo_name, default_branch, gh_installation_id, dispatch_debounce_minutes, design_tokens',
    )
    .eq('id', projectId)
    .maybeSingle();

  if (!proj) return { ok: false, message: '案件が見つかりません', results };
  // 手で押したときは、無効でも走らせる。社内が明示的に押している
  if (!proj.ai_enabled && !opts.manual) {
    return { ok: true, message: '自動反映は無効です', results };
  }
  if (!proj.repo_owner || !proj.repo_name) {
    return { ok: false, message: 'リポジトリが設定されていません', results };
  }
  if (!githubConfigured() || !process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: '認証情報が設定されていません', results };
  }

  // デバウンス（8.2）。直近の依頼が続いている間は動かさない
  // 手で押したときは待たせない（クライアントの目の前で直したい、締切が近い）
  const debounceMs = opts.manual ? 0 : (proj.dispatch_debounce_minutes ?? 30) * 60_000;
  const { data: latest } = await db
    .from('requests')
    .select('created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (latest?.length) {
    const waited = Date.now() - new Date(latest[0].created_at).getTime();
    if (waited < debounceMs) {
      return {
        ok: true,
        message: `デバウンス中（あと ${Math.ceil((debounceMs - waited) / 60_000)} 分）`,
        results,
      };
    }
  }

  // 未処理の依頼
  const { data: reqs } = await db
    .from('requests')
    .select('id, seq, body, category, subtype, status, outer_html, css_rules, nq_id')
    .eq('project_id', projectId)
    .eq('status', 'received')
    .order('seq')
    .limit(20);
  if (!reqs?.length) return { ok: true, message: '対象の依頼がありません', results };

  const { data: jobs } = await db
    .from('ai_jobs')
    .select('request_id')
    .in('request_id', reqs.map((r) => r.id));
  const done = new Set((jobs ?? []).map((j) => j.request_id));

  // ── 分類。未分類のものだけ、その場で仕分ける
  const targets: typeof reqs = [];
  for (const r of reqs) {
    if (done.has(r.id)) continue;

    let category = r.category as string;
    let subtype = r.subtype as string | null;

    if (category === 'unclassified') {
      try {
        const c = await classify(r.body, r.outer_html);
        await db
          .from('requests')
          .update({ category: c.category, subtype: c.subtype === 'none' ? null : c.subtype } as never)
          .eq('id', r.id);
        await logEvent({
          projectId,
          actor: SYSTEM_ACTOR,
          entity: 'request',
          entityId: r.id,
          action: 'request.classified',
          after: { ...c, auto: true },
        });
        category = c.category;
        subtype = c.subtype === 'none' ? null : c.subtype;

        // 自動反映は「自信が高い」ものだけ。迷いがあるものは人が見る
        if (c.confidence !== 'high') {
          results.push({
            requestId: r.id,
            seq: r.seq,
            status: 'skipped',
            detail: `分類の自信が ${c.confidence} のため人の確認に回します（${c.reason}）`,
          });
          continue;
        }
      } catch (e) {
        results.push({ requestId: r.id, seq: r.seq, status: 'failed', detail: `分類に失敗: ${e}` });
        continue;
      }
    }

    if (category !== 'minor' || (subtype !== 'text' && subtype !== 'style')) {
      results.push({
        requestId: r.id,
        seq: r.seq,
        status: 'skipped',
        detail: `${category}${subtype ? ' / ' + subtype : ''} は自動反映の対象外です`,
      });
      continue;
    }
    targets.push(r);
  }

  if (!targets.length) return { ok: true, message: '自動で当てられる依頼はありませんでした', results };

  // ── リポジトリ
  const gh = github();
  let inst = proj.gh_installation_id as number | null;
  if (!inst) {
    inst = await installationFor(gh, proj.repo_owner).catch(() => null);
    if (inst == null) return { ok: false, message: 'GitHub App が入っていません', results };
  }
  const base = proj.default_branch || 'main';
  const owner = proj.repo_owner;
  const repo = proj.repo_name;

  const readFile = async (path: string, ref: string) => {
    const f = await gh.getFile(inst!, owner, repo, path, ref);
    if (Array.isArray(f)) return null;
    return { content: Buffer.from(f.content ?? '', 'base64').toString('utf8'), sha: f.sha };
  };

  const tree = await gh.getTree(inst, owner, repo, base);
  const paths = (tree.entries as { path: string; type: string; size?: number }[])
    .filter((e) => e.type === 'blob' && SOURCE_EXT.test(e.path) && !pathError(e.path))
    .filter((e) => (e.size ?? 0) < 400_000)
    .map((e) => e.path)
    .slice(0, 40);

  const branch = `nq/auto-text-${new Date().toISOString().slice(0, 10)}`;
  let branchReady = false;
  const applied: { seq: number; summary: string; jobId?: string }[] = [];
  const client = new Anthropic();

  for (const r of targets) {
    try {
      // 対象ファイルは機械で絞る。モデルに探させない
      /*
       * マークアップとスタイルシートは、別の手がかりで探す。
       *
       * 実測: 「文字が小さい」に対して index.html しか渡せず、
       * 「styles.css をご提示いただければ直せます」と返ってきた。
       * 文字サイズの指定は CSS にあり、そこに日本語は入っていないので、
       * 本文の文字列で探す限りスタイルシートは永久に候補に入らない。
       */
      const anchors = anchorsFrom(r.outer_html ?? '', r.nq_id as string | null);
      const selectors = selectorsFrom(
        r.outer_html ?? '',
        r.css_rules as { selector: string }[] | null,
      );

      const markup: { path: string; content: string; hits: number }[] = [];
      const styles: { path: string; content: string; hits: number }[] = [];
      for (const path of paths) {
        const f = await readFile(path, base);
        if (!f) continue;
        if (STYLE_EXT.test(path)) {
          const hits = selectors.filter((sel) => f.content.includes(sel)).length;
          if (hits > 0) styles.push({ path, content: f.content, hits });
        } else {
          const hits = anchors.filter((a) => f.content.includes(a)).length;
          if (hits > 0) markup.push({ path, content: f.content, hits });
        }
      }
      markup.sort((a, b) => b.hits - a.hits);
      styles.sort((a, b) => b.hits - a.hits);

      // 文字まわりの依頼はスタイルシート側に答えがあることが多い。
      // どちらか一方だけを渡すと「もう片方を見せてほしい」で止まる。
      const cand =
        r.subtype === 'style'
          ? [...styles.slice(0, 2), ...markup.slice(0, 1)]
          : [...markup.slice(0, 2), ...styles.slice(0, 1)];
      if (!cand.length) {
        results.push({
          requestId: r.id,
          seq: r.seq,
          status: 'skipped',
          detail: '該当箇所をリポジトリで特定できませんでした',
        });
        continue;
      }

      // サイトの刻みを渡す。依頼に数値が無いとき、勝手な値を作らせないため
      const tok = tokensText((proj.design_tokens as SiteTokens | null) ?? null);
      const body =
        `# 依頼 #${r.seq}\n${r.body.trim()}\n\n` +
        `**この依頼は、下の要素をクリックして送られています。この要素が対象です。**\n` +
        (r.nq_id
          ? `対象の nq-id: ${r.nq_id}（ソースに data-nq-id があれば、これを含めて取ると一意になります）\n`
          : '') +
        `\`\`\`\n${(r.outer_html ?? '').slice(0, 3000)}\n\`\`\`\n\n` +
        (tok ? `${tok}\n\n` : '') +
        cand.map((c) => `# 候補ファイル: ${c.path}\n\`\`\`\n${c.content.slice(0, 60000)}\n\`\`\``).join('\n\n');

      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        system: PATCH_SYSTEM,
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: PATCH_SCHEMA as unknown as Record<string, unknown> },
        },
        messages: [{ role: 'user', content: [{ type: 'text', text: body }] }],
      });
      const msg = await stream.finalMessage();
      const t = msg.content.find((b) => b.type === 'text');
      if (!t || t.type !== 'text') throw new Error('空の応答');
      const patch = JSON.parse(t.text) as Patch;

      if (!patch.applicable) {
        results.push({ requestId: r.id, seq: r.seq, status: 'skipped', detail: patch.reason });
        continue;
      }

      const pe = pathError(patch.file);
      if (pe) {
        results.push({ requestId: r.id, seq: r.seq, status: 'skipped', detail: pe });
        continue;
      }
      if (!patch.edits?.length || patch.edits.length > 6) {
        results.push({
          requestId: r.id,
          seq: r.seq,
          status: 'skipped',
          detail: `書き換えが ${patch.edits?.length ?? 0} 件です。1〜6件にしてください`,
        });
        continue;
      }
      const se = patch.edits.map((e) => structureChanged(e.oldStr, e.newStr)).find(Boolean);
      if (se) {
        results.push({ requestId: r.id, seq: r.seq, status: 'skipped', detail: se });
        continue;
      }

      // ブランチはここで初めて作る（当てるものが1件も無ければ作らない）
      if (!branchReady) {
        try {
          await gh.getRef(inst, owner, repo, `heads/${branch}`);
        } catch {
          const b = await gh.getRef(inst, owner, repo, `heads/${base}`);
          await gh.createBranch(inst, owner, repo, branch, b.object.sha);
        }
        branchReady = true;
      }

      // 当てる直前に、ブランチ HEAD の現在の内容で再検証する（9.7）。
      // 1件でも当たらなければ、その依頼はまるごと見送る。
      // 半分だけ当たった状態で出すと、レビューする側が一番困る。
      const cur = await readFile(patch.file, branch);
      if (!cur) throw new Error(`${patch.file} を読めません`);

      let next = cur.content;
      let bad: string | null = null;
      for (const e of patch.edits) {
        const n = count(next, e.oldStr);
        if (n !== 1) {
          bad =
            n === 0
              ? '当てる直前の再検証で対象が見つかりませんでした'
              : `対象が ${n} 箇所に当たるため当てられません`;
          break;
        }
        next = next.replace(e.oldStr, e.newStr);
      }
      if (bad) {
        results.push({ requestId: r.id, seq: r.seq, status: 'skipped', detail: bad });
        continue;
      }

      await gh.putFile(
        inst,
        owner,
        repo,
        patch.file,
        Buffer.from(next, 'utf8'),
        `依頼 #${r.seq}: ${patch.summary}`,
        branch,
        cur.sha,
      );

      const { data: job } = await db
        .from('ai_jobs')
        .insert({
          request_id: r.id,
          dispatch_no: 1,
          patch_kind: 'text',
          provider: 'anthropic',
          status: 'succeeded',
          patch: patch as never,
          summary: patch.summary,
          branch,
          finished_at: new Date().toISOString(),
        } as never)
        .select('id')
        .maybeSingle();

      // 手つかずに見えると社内が二重に作業する。着手済みにしておく
      await db.from('requests').update({ status: 'in_progress' } as never).eq('id', r.id);

      await logEvent({
        projectId,
        actor: SYSTEM_ACTOR,
        entity: 'request',
        entityId: r.id,
        action: 'auto_text.applied',
        after: { file: patch.file, summary: patch.summary, branch },
      });

      applied.push({ seq: r.seq, summary: patch.summary, jobId: job?.id as string | undefined });
      results.push({ requestId: r.id, seq: r.seq, status: 'applied', detail: patch.summary });
    } catch (e) {
      results.push({
        requestId: r.id,
        seq: r.seq,
        status: 'failed',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (!applied.length) {
    return { ok: true, message: '当てられる書き換えはありませんでした', results };
  }

  const pr = await gh.createPull(inst, owner, repo, {
    title: `文言・文字まわりの修正 ${applied.length}件`,
    head: branch,
    base,
    body:
      `クライアントからの修正依頼のうち、文言と文字まわりのものを反映しました。\n\n` +
      applied.map((a) => `- 依頼 #${a.seq}: ${a.summary}`).join('\n') +
      `\n\n---\n自動マージはしません。内容を確認してからマージしてください。\n` +
      `対象は「文言の変更」と「文字の大きさ・太さ・行間・字間・色」に限っています。` +
      `構造を変える書き換えは機械で弾いています。`,
  });

  // どの依頼がどの PR に入ったかを引けるようにする。
  // これが無いと、社内は「自動で直ったのか、まだなのか」を追えない。
  for (const a of applied) {
    if (!a.jobId) continue;
    await db
      .from('ai_jobs')
      .update({ pr_url: pr.html_url, pr_number: pr.number } as never)
      .eq('id', a.jobId);
  }

  await logEvent({
    projectId,
    actor: SYSTEM_ACTOR,
    entity: 'project',
    entityId: projectId,
    action: 'auto_text.pull_request_opened',
    after: { branch, pr: pr.html_url, applied: applied.length, results },
  });

  return { ok: true, message: `${applied.length}件を反映して PR を出しました`, results, prUrl: pr.html_url };
}
