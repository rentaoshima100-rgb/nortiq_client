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
import type { T } from '@/lib/i18n-core';
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
export const STYLE_EXT = /\.(css|scss|sass|less|styl)$/i;
export const SOURCE_EXT = new RegExp(`${MARKUP_EXT.source}|${STYLE_EXT.source}`, 'i');

export function pathError(file: string, t: T = (s) => s): string | null {
  if (!file || file.includes('..')) return t('パスが不正です');
  if (FORBIDDEN.some((re) => re.test(file))) return t('禁止パスです: {file}', { file });
  if (!SOURCE_EXT.test(file)) return t('ソースファイルではありません: {file}', { file });
  return null;
}

export function countOf(hay: string, needle: string): number {
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
- minor    元からある要素の**中身か見え方を変えるだけ**。文言の差し替え、誤字、文字の大小・太さ・行間・字間・色、画像の差し替え。
  **一行の注記・注意書きを足すのもここです。**「この下に小さく〜と記載」「注意書きを添えて」。足すのが文字だけなら minor（subtype: text）
- spec_change  **文字以外**を増やす・減らす、並べ替える。機能やページの変更。「フォームを追加」「この項目を無くして」「順番を」
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
  const blk = msg.content.find((b) => b.type === 'text');
  if (!blk || blk.type !== 'text') throw new Error('分類が空でした');
  return JSON.parse(blk.text) as Classification;
}

/* ── 書き換え ───────────────────────────────────────────────────────────── */

const PATCH_SYSTEM = `あなたはこのリポジトリを保守しているエンジニアです。クライアントからの修正依頼を、**最小の書き換え**で反映します。

**やってよいのは、文言を変えることと、文字の大きさ・太さ・行間・字間・色を変えることだけです。**

**一行の注記を足すのは認めます。**「この下に小さく〜と記載」のような依頼です。足してよいのは段落・スパン・注記の類（p / span / small / div / li / br / strong / em）だけで、周りの書き方に合わせてください。script・画像・リンク・フォーム・イベント属性は足さないこと。足す量は一行の注記の範囲（400文字まで、要素4つまで）に収めてください。

やってはいけないこと:
- 要素を**減らす**・並べ替える
- 上に書いた範囲を超えて要素を増やす
- タグや構造を変える
- 新しいクラスや CSS 変数を作る
- 依頼に書かれていない箇所を直す（ついでの整形もしない）
- style 属性を新しく足す（元からインラインで書いているファイルなら、その流儀に合わせてよい）
- 色や書体を、そのサイトで使われていないものに変える

**「社内からの補足」が書かれている場合、そこに書かれた値と条件が最優先です。** 依頼文に無いことを理由に断らないでください。社内が持っている情報を渡しています。

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

/** まとめて聞くときの形。依頼ごとに1件返させる */
const BATCH_SCHEMA = {
  type: 'object',
  properties: {
    patches: {
      type: 'array',
      description: '依頼ごとの結果。渡された依頼の件数ぶん、飛ばさずに返すこと',
      items: {
        type: 'object',
        properties: {
          seq: { type: 'integer', description: 'どの依頼か。見出しの #番号' },
          ...PATCH_SCHEMA.properties,
        },
        required: ['seq', ...PATCH_SCHEMA.required],
        additionalProperties: false,
      },
    },
  },
  required: ['patches'],
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
export function anchorsFrom(outerHtml: string, nqId: string | null): string[] {
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
export function selectorsFrom(outerHtml: string, cssRules: { selector: string }[] | null): string[] {
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
/** 一行の注記を足すのに要る、無害なタグだけ */
const TEXT_TAGS = new Set(['p', 'span', 'small', 'div', 'li', 'br', 'strong', 'em', 'b', 'i']);

export function structureChanged(oldStr: string, newStr: string, t: T = (s) => s): string | null {
  const tagList = (s: string) =>
    [...s.matchAll(/<\s*\/?\s*([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase());
  const before = tagList(oldStr);
  const after = tagList(newStr);

  if (before.slice().sort().join(',') !== after.slice().sort().join(',')) {
    /*
     * 「この下に小さく〜と記載」は実際によく来る。要素は増えるが、
     * **足しているのは文字だけ**で、危険がない。ここを一律で弾くと
     * 一番多い依頼が全部人手に落ちる。
     *
     * ただし増やしてよいものは厳しく絞る。段落・スパン・注記の類だけで、
     * script / img / iframe / リンク / イベント属性は認めない。
     */
    const added = [...after];
    for (const tag of before) {
      const i = added.indexOf(tag);
      if (i >= 0) added.splice(i, 1);
    }
    const removed = [...before];
    for (const tag of after) {
      const i = removed.indexOf(tag);
      if (i >= 0) removed.splice(i, 1);
    }

    if (removed.length) {
      return t('タグが減っています。要素の削除は自動反映の対象外です。');
    }
    if (!added.every((tag) => TEXT_TAGS.has(tag))) {
      return t('文字以外の要素を足しています（{tags}）。自動反映の対象外です。', {
        tags: [...new Set(added)].join(' '),
      });
    }
    if (added.length > 4) {
      return t('要素を {n} 個足しています。一行の注記の範囲を超えています。', { n: added.length });
    }
    if (/\bon\w+\s*=|<\s*(script|img|iframe|video|audio|form|input)\b/i.test(newStr)) {
      return t('スクリプト・画像・フォームを足しています。自動反映の対象外です。');
    }
    if (newStr.length - oldStr.length > 400) {
      return t('足している量が多すぎます。一行の注記の範囲を超えています。');
    }
  }
  if (!/\bstyle\s*=/.test(oldStr) && /\bstyle\s*=/.test(newStr)) {
    return t('style 属性を新しく足しています。');
  }
  if (/!important/.test(newStr) && !/!important/.test(oldStr)) {
    return t('!important を新しく使っています。');
  }
  const grew = newStr.length / Math.max(1, oldStr.length);
  if (grew > 3) return t('書き換え後が元の3倍を超えています。最小の変更になっていません。');
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
  opts: { manual?: boolean; requestId?: string; note?: string; t?: T } = {},
): Promise<{
  ok: boolean;
  message: string;
  results: AutoResult[];
  prUrl?: string;
}> {
  // 社内が読む文だけ訳す。モデルに渡すプロンプトは日本語のまま
  const t = opts.t ?? ((s: string) => s);
  const db = adminDb();
  const results: AutoResult[] = [];

  const { data: proj } = await db
    .from('projects')
    .select(
      'id, name, ai_enabled, repo_owner, repo_name, default_branch, gh_installation_id, dispatch_debounce_minutes, design_tokens',
    )
    .eq('id', projectId)
    .maybeSingle();

  if (!proj) return { ok: false, message: t('案件が見つかりません'), results };
  // 手で押したときは、無効でも走らせる。社内が明示的に押している
  if (!proj.ai_enabled && !opts.manual) {
    return { ok: true, message: t('自動反映は無効です'), results };
  }
  if (!proj.repo_owner || !proj.repo_name) {
    return { ok: false, message: t('リポジトリが設定されていません'), results };
  }
  if (!githubConfigured() || !process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: t('認証情報が設定されていません'), results };
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
        message: t('デバウンス中（あと {v1} 分）', { v1: Math.ceil((debounceMs - waited) / 60_000) }),
        results,
      };
    }
  }

  // 未処理の依頼。1件を名指しされたときは、状態を問わずそれだけを見る
  let q = db
    .from('requests')
    .select('id, seq, body, category, subtype, status, outer_html, css_rules, nq_id, nq_ordinal')
    .eq('project_id', projectId);
  q = opts.requestId ? q.eq('id', opts.requestId) : q.eq('status', 'received');
  const { data: reqs } = await q.order('seq').limit(opts.requestId ? 1 : 20);
  if (!reqs?.length) return { ok: true, message: t('対象の依頼がありません'), results };

  const { data: jobs } = await db
    .from('ai_jobs')
    .select('request_id')
    .in('request_id', reqs.map((r) => r.id));
  // 名指しで押されたときは、前に当てていてもやり直す
  const done = opts.requestId ? new Set<string>() : new Set((jobs ?? []).map((j) => j.request_id));

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

        // 自動反映は「自信が高い」ものだけ。迷いがあるものは人が見る。
        // ただし社内が名指しで押したときは、その判断を優先する
        if (c.confidence !== 'high' && !opts.requestId) {
          results.push({
            requestId: r.id,
            seq: r.seq,
            status: 'skipped',
            detail: t('分類の自信が {v1} のため人の確認に回します（{v2}）', { v1: c.confidence, v2: c.reason }),
          });
          continue;
        }
      } catch (e) {
        results.push({ requestId: r.id, seq: r.seq, status: 'failed', detail: t('分類に失敗: {v1}', { v1: e instanceof Error ? e.message : String(e) }) });
        continue;
      }
    }

    // 名指しのときは種別で止めない。社内が「これを直せ」と言っている。
    // 当てられなければモデルが applicable: false で理由を返す
    if (!opts.requestId && (category !== 'minor' || (subtype !== 'text' && subtype !== 'style'))) {
      results.push({
        requestId: r.id,
        seq: r.seq,
        status: 'skipped',
        detail: t('{kind} は自動反映の対象外です', {
          kind: `${category}${subtype ? ` / ${subtype}` : ''}`,
        }),
      });
      continue;
    }
    targets.push(r);
  }

  if (!targets.length) return { ok: true, message: t('自動で当てられる依頼はありませんでした'), results };

  // ── リポジトリ
  const gh = github();
  let inst = proj.gh_installation_id as number | null;
  if (!inst) {
    inst = await installationFor(gh, proj.repo_owner).catch(() => null);
    if (inst == null) return { ok: false, message: t('GitHub App が入っていません'), results };
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

  const branch = opts.requestId
    ? `nq/auto-text-${targets[0]?.seq ?? 'x'}-${Date.now().toString(36).slice(-4)}`
    : `nq/auto-text-${new Date().toISOString().slice(0, 10)}`;
  let branchReady = false;
  const applied: { seq: number; summary: string; jobId?: string }[] = [];
  const client = new Anthropic();

  /*
   * ファイルは一度だけ読む。
   *
   * 以前は依頼ごとに全ファイルを読み直していた。17件 × 40ファイルで
   * **680回**リポジトリを叩いていたことになる。遅いだけでなく、
   * 同じ内容を何度もモデルに送ることになり、費用の大半がそこだった。
   */
  const cache = new Map<string, { content: string; sha: string }>();
  const readCached = async (path: string) => {
    const hit = cache.get(path);
    if (hit) return hit;
    const f = await readFile(path, base);
    if (f) cache.set(path, f);
    return f;
  };

  // 依頼ごとに候補を出す（読み込みはキャッシュ経由）
  const perRequest: { r: (typeof targets)[number]; cand: { path: string; content: string }[] }[] =
    [];
  for (const r of targets) {
    const anchors = anchorsFrom(r.outer_html ?? '', r.nq_id as string | null);
    const selectors = selectorsFrom(
      r.outer_html ?? '',
      r.css_rules as { selector: string }[] | null,
    );
    const markup: { path: string; content: string; hits: number }[] = [];
    const styles: { path: string; content: string; hits: number }[] = [];
    for (const path of paths) {
      const f = await readCached(path);
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
    const cand =
      r.subtype === 'style'
        ? [...styles.slice(0, 2), ...markup.slice(0, 1)]
        : [...markup.slice(0, 2), ...styles.slice(0, 1)];

    if (!cand.length) {
      results.push({
        requestId: r.id,
        seq: r.seq,
        status: 'skipped',
        detail: t('該当箇所をリポジトリで特定できませんでした'),
      });
      continue;
    }
    perRequest.push({ r, cand: cand.map(({ path, content }) => ({ path, content })) });
  }

  if (!perRequest.length) {
    return { ok: true, message: t('当てられる書き換えはありませんでした'), results };
  }

  /*
   * 依頼ごとに呼ばず、**まとめて1回で聞く**。
   *
   * ファイルの中身が入力の大半を占めるので、依頼ごとに投げると
   * 同じファイルを件数ぶん送ることになる。まとめれば1回で済む。
   * 出力も1回にまとまるので、PR も自然に1本になる。
   */
  const union = new Map<string, string>();
  const needles = new Set<string>();
  for (const { r, cand } of perRequest) {
    for (const c of cand) if (!union.has(c.path)) union.set(c.path, c.content);
    for (const a of anchorsFrom(r.outer_html ?? '', r.nq_id as string | null)) needles.add(a);
    for (const sel of selectorsFrom(r.outer_html ?? '', r.css_rules as { selector: string }[] | null))
      needles.add(sel);
    if (r.nq_id) needles.add(`data-nq-id="${r.nq_id}"`);
  }

  const tok = tokensText((proj.design_tokens as SiteTokens | null) ?? null);
  const prompt = [
    '# 直してほしいこと（複数）',
    '',
    ...perRequest.map(({ r, cand }) =>
      [
        `## 依頼 #${r.seq}`,
        r.body.trim(),
        '',
        /*
         * 社内からの補足。
         *
         * 値を持っているのは社内で、クライアントは「許可番号を入れて」
         * としか書かない。ここに書かれたものは依頼文より優先する。
         * **依頼文に無いことを理由に断らせない。**
         */
        opts.note?.trim()
          ? `**社内からの補足（依頼文より優先します）**\n${opts.note.trim()}\n` +
            'ここに値が書かれている場合、「依頼文に無い」ことを理由に断らないでください。この値を使ってください。\n'
          : '',
        `種別: ${r.category} / ${r.subtype ?? '—'}`,
        r.nq_id
          ? `対象の nq-id: ${r.nq_id}` +
            (r.nq_ordinal != null
              ? `（**この nq-id は同じものが複数あります。文書順で ${(r.nq_ordinal as number) + 1} 番目**。上の要素のテキストで見分けてください）`
              : '（ソースに data-nq-id があれば、これを含めて取ると一意になります）')
          : '',
        `見るべきファイル: ${cand.map((c) => c.path).join(' , ')}`,
        '',
        '**この依頼は、下の要素をクリックして送られています。この要素が対象です。**',
        '```',
        (r.outer_html ?? '').slice(0, 2500),
        '```',
        '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    tok ? `${tok}\n` : '',
    '# ファイルの中身',
    '',
    '大きいファイルは、指摘箇所の周辺だけを抜き出しています。`/* ……N 文字目から…… */` の行は**こちらが入れた目印**なので、oldStr に含めないでください。',
    '',
    ...[...union.entries()].map(([path, content]) => {
      const ex = excerptAround(content, [...needles]);
      return `## ${path}${ex.note ? `（${ex.note}）` : ''}\n\`\`\`\n${ex.text}\n\`\`\`\n`;
    }),
    '',
    '上の依頼それぞれについて、patches に1件ずつ結果を入れてください。当てられないものは applicable を false にし、理由を書いてください。**依頼を飛ばさず、全件ぶん返してください。**',
  ].join('\n');

  let patches: (Patch & { seq: number })[] = [];
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: PATCH_SYSTEM,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: BATCH_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
    const msg = await stream.finalMessage();
    const blk = msg.content.find((b) => b.type === 'text');
    if (!blk || blk.type !== 'text') throw new Error('空の応答');
    patches = (JSON.parse(blk.text) as { patches: (Patch & { seq: number })[] }).patches ?? [];
  } catch (e) {
    for (const { r } of perRequest) {
      results.push({
        requestId: r.id,
        seq: r.seq,
        status: 'failed',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
    return { ok: false, message: t('書き換えを作れませんでした'), results };
  }

  // ── 適用。ファイル単位で溜めてから1回ずつ書く
  const pending = new Map<string, string>(); // path -> 現在の内容
  const wrote = new Map<string, { seq: number; summary: string; requestId: string }[]>();

  for (const { r } of perRequest) {
    const patch = patches.find((p) => p.seq === r.seq);
    if (!patch) {
      results.push({
        requestId: r.id,
        seq: r.seq,
        status: 'skipped',
        detail: t('書き換えが返ってきませんでした'),
      });
      continue;
    }
    if (!patch.applicable) {
      results.push({ requestId: r.id, seq: r.seq, status: 'skipped', detail: patch.reason });
      continue;
    }

    const pe = pathError(patch.file, t);
    if (pe) {
      results.push({ requestId: r.id, seq: r.seq, status: 'skipped', detail: pe });
      continue;
    }
    if (!patch.edits?.length || patch.edits.length > 6) {
      results.push({
        requestId: r.id,
        seq: r.seq,
        status: 'skipped',
        detail: t('書き換えが {v1} 件です。1〜6件にしてください', { v1: patch.edits?.length ?? 0 }),
      });
      continue;
    }
    const se = patch.edits.map((e) => structureChanged(e.oldStr, e.newStr, t)).find(Boolean);
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

    // 当てる直前に、その時点の内容で再検証する（9.7）。
    // 同じファイルに続けて当てるので、**前の書き換えを反映した内容**で見る。
    if (!pending.has(patch.file)) {
      const cur = await readFile(patch.file, branch);
      if (!cur) {
        results.push({
          requestId: r.id,
          seq: r.seq,
          status: 'failed',
          detail: t('{v1} を読めません', { v1: patch.file }),
        });
        continue;
      }
      pending.set(patch.file, cur.content);
    }

    let next = pending.get(patch.file) as string;
    let bad: string | null = null;
    for (const e of patch.edits) {
      const n = countOf(next, e.oldStr);
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

    pending.set(patch.file, next);
    const list = wrote.get(patch.file) ?? [];
    list.push({ seq: r.seq, summary: patch.summary, requestId: r.id });
    wrote.set(patch.file, list);
  }

  // ── ファイルごとに1回だけ書き込む
  for (const [path, content] of pending) {
    const items = wrote.get(path);
    if (!items?.length) continue;
    try {
      const cur = await readFile(path, branch);
      if (!cur) throw new Error(`${path} を読めません`);
      await gh.putFile(
        inst,
        owner,
        repo,
        path,
        Buffer.from(content, 'utf8'),
        items.length === 1
          ? `依頼 #${items[0].seq}: ${items[0].summary}`
          : `依頼 ${items.map((i) => `#${i.seq}`).join(' ')} の修正`,
        branch,
        cur.sha,
      );

      for (const it of items) {
        const { data: job } = await db
          .from('ai_jobs')
          .insert({
            request_id: it.requestId,
            dispatch_no: 1,
            patch_kind: 'text',
            provider: 'anthropic',
            status: 'succeeded',
            patch: (patches.find((p) => p.seq === it.seq) ?? null) as never,
            summary: it.summary,
            branch,
            finished_at: new Date().toISOString(),
          } as never)
          .select('id')
          .maybeSingle();

        // 手つかずに見えると社内が二重に作業する。着手済みにしておく
        await db.from('requests').update({ status: 'in_progress' } as never).eq('id', it.requestId);

        await logEvent({
          projectId,
          actor: SYSTEM_ACTOR,
          entity: 'request',
          entityId: it.requestId,
          action: 'auto_text.applied',
          after: { file: path, summary: it.summary, branch },
        });

        applied.push({ seq: it.seq, summary: it.summary, jobId: job?.id as string | undefined });
        results.push({
          requestId: it.requestId,
          seq: it.seq,
          status: 'applied',
          detail: it.summary,
        });
      }
    } catch (e) {
      for (const it of items) {
        results.push({
          requestId: it.requestId,
          seq: it.seq,
          status: 'failed',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  if (!applied.length) {
    return { ok: true, message: t('当てられる書き換えはありませんでした'), results };
  }

  const pr = await gh.createPull(inst, owner, repo, {
    title:
      applied.length === 1
        ? `依頼 #${applied[0].seq}: ${applied[0].summary}`
        : `文言・文字まわりの修正 ${applied.length}件`,
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

  return { ok: true, message: t('{v1}件を反映して PR を出しました', { v1: applied.length }), results, prUrl: pr.html_url };
}

/**
 * 大きいファイルを、手がかりの周りだけ切り出して渡す
 *
 * 実測でここが原因の見送りが多発した。index.html が 208,640 文字ある
 * サイトで、90,000 文字で頭から切っていたため、**該当箇所が
 * 落ちていた**。モデルは正しく「提示されたファイルは途中で切れており、
 * 該当の要素が含まれていません」と報告していた。
 *
 * 頭から切るのではなく、手がかりの周りを取る。
 * 目印の行は oldStr に含めないよう、プロンプト側で明示すること。
 */
export function excerptAround(
  content: string,
  needles: string[],
  opts: { window?: number; maxTotal?: number } = {},
): { text: string; full: boolean; note: string | null } {
  const window = opts.window ?? 8000;
  /*
   * 全文で渡す上限。
   *
   * 1M トークン扱えるモデルに対して、150,000 文字で切っていた。
   * loop_construction の index.html は 178,703 文字 ≈ 56,000 トークン
   * ≈ $0.28。バッチなら**1回しか送らない**ので、この額を惜しんで
   * 「抜粋に入っていなかった」を繰り返す方がずっと高くつく。
   *
   * 実測で止まった原因が2回ともこれだった（該当要素が抜粋の外、
   * データ配列が抜粋の外）。切るのは本当に巨大なファイルだけにする。
   */
  const maxTotal = opts.maxTotal ?? 400_000;
  if (content.length <= maxTotal) return { text: content, full: true, note: null };

  const ranges: [number, number][] = [];
  for (const n of needles) {
    if (!n || n.length < 2) continue;
    let i = 0;
    for (;;) {
      const at = content.indexOf(n, i);
      if (at < 0) break;
      ranges.push([Math.max(0, at - window), Math.min(content.length, at + n.length + window)]);
      i = at + n.length;
      if (ranges.length > 60) break;
    }
    if (ranges.length > 60) break;
  }

  if (!ranges.length) {
    return {
      text: content.slice(0, maxTotal),
      full: false,
      note: '手がかりが見つからず、先頭から切り出しています。該当箇所が含まれていない可能性があります',
    };
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 400) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  let out = '';
  let used = 0;
  let dropped = 0;
  for (const [s, e] of merged) {
    const seg = content.slice(s, e);
    if (used + seg.length > maxTotal) {
      dropped++;
      continue;
    }
    out += `\n/* ……${s} 文字目から…… */\n${seg}`;
    used += seg.length;
  }

  return {
    text: out,
    full: false,
    note:
      `全 ${content.length} 文字のうち、指摘箇所の周辺だけを抜き出しています` +
      (dropped ? `（${dropped} 箇所は入りきらず省略）` : ''),
  };
}

/**
 * 対象要素の説明。ループ描画かどうかが最も大事。
 *
 * 実測: 「93qnnfy8 の div の中身は固定文字列ではなく {w.year} という
 * 動的な式です。この1箇所を書き換えると全カードの年が同一表示になります」
 * — 正しい指摘だった。**同じ nq-id が複数ある = 配列から展開されている**
 * ので、直すべきはテンプレートではなくデータ側の該当エントリになる。
 * 何番目かは序数で分かるので、それを渡す。
 */
/**
 * ループ描画のとき、データ配列を引き寄せる手がかりを足す。
 *
 * テンプレートは {w.year} のような式でデータを出している。
 * 「year:」で探せばデータ配列に当たる。テンプレートの周りを一度見て、
 * 中の式から項目名を拾う。
 */
export function loopNeedles(content: string, nqId: string | null): string[] {
  if (!nqId) return [];
  const at = content.indexOf(`data-nq-id="${nqId}"`);
  if (at < 0) return [];
  const around = content.slice(Math.max(0, at - 600), at + 1200);
  const out = new Set<string>();
  for (const m of around.matchAll(/\{\s*\w+\.(\w{2,24})\s*\}/g)) {
    out.add(`${m[1]}:`);
    out.add(`"${m[1]}"`);
    out.add(`'${m[1]}'`);
  }
  return [...out].slice(0, 12);
}

export function elementNote(r: {
  nq_id?: string | null;
  nq_ordinal?: number | null;
  locator?: unknown;
}): string[] {
  const loc = (r.locator ?? {}) as { nqCount?: number | null; textSample?: string | null };
  const count = loc.nqCount ?? null;
  const ord = r.nq_ordinal;
  const out: string[] = [];
  if (!r.nq_id) return out;

  out.push(`対象の nq-id: ${r.nq_id}`);
  if (loc.textSample) out.push(`対象の現在のテキスト: 「${String(loc.textSample).slice(0, 80)}」`);

  if (count != null && count > 1 && ord != null) {
    out.push(
      `**この nq-id は文書内に ${count} 個あり、対象はその ${ord + 1} 番目です。**` +
        'つまりこの要素は配列データから繰り返し描画されています。' +
        '**テンプレート側を書き換えると ' +
        `${count} 個すべてが変わります。**` +
        `直すのはデータ配列の ${ord + 1} 番目のエントリです。` +
        '現在のテキストを手がかりに、その1件だけを直してください。' +
        'データが見当たらない場合は applicable を false にし、' +
        '「配列の何番目を直すのか、データがどこにあるか」を理由に書いてください。',
    );
  }
  return out;
}
