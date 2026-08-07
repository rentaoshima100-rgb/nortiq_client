/**
 * Claude Code に一度で投げるプロンプトを作る
 *
 * このツールは**修正を当てない**。クライアントが「どこを、どう直してほしいか」
 * を書き、こちらはそれを**そのまま実装できる形**に整えて渡す。
 *
 * なぜ当てるのをやめたか（残しておく。また戻したくなるので）:
 *   - 当てると、指していた文言そのものが変わる。ピンはその文言を頼りに
 *     しているので、**直した瞬間に目印が外れる**。実測で 12 件中 5 件
 *   - nq-id も「同じ親の中で同じタグの何番目か」から作っているため、
 *     要素を1つ足すと後ろが全部振り直される。注記を1行足す修正で壊れた
 *   - つまり「当てる」と「場所を覚えておく」は、同じ仕組みの中で衝突する
 *
 * 代わりに、**人が Claude Code に渡す**。実装者が1人いれば、当てるより
 * 速くて確実で、こちらは場所の記録だけに責任を持てばよくなる。
 *
 * ここでは LLM を呼ばない。持っている材料を並べるだけ。
 * 呼ばないほうが速く、費用もかからず、内容が予測できる。
 */
import { plainT } from '@/lib/i18n-core';
import { ATTACHMENTS_BUCKET } from '@/lib/env';
import type { T } from '@/lib/i18n-core';
import { tokensText } from '@/lib/site-tokens.mjs';
import type { SiteTokens } from '@/lib/site-tokens-store';
import { adminDb } from '@/lib/supabase/admin';
import type { Locator, MatchedRule } from '@/lib/types';

export interface HandoffOut {
  ok: boolean;
  message: string;
  prompt: string;
  count: number;
}

interface Row {
  id: string;
  seq: number;
  body: string;
  status: string;
  category: string | null;
  subtype: string | null;
  page_path: string;
  viewport_w: number;
  locator: Locator | null;
  locator_live: Locator | null;
  outer_html: string | null;
  css_rules: MatchedRule[] | null;
  nq_id: string | null;
  nq_ordinal: number | null;
  client_question: string | null;
  client_answer: string | null;
  staff_note: string | null;
}

/** 依頼1件ぶん。実装者が読んで、そのまま手が動く形にする */
function requestBlock(
  r: Row,
  atts: { filename: string; kind: string; url: string | null }[],
): string {
  const loc = r.locator_live ?? r.locator;
  const L: string[] = [];

  L.push(`### 依頼 #${r.seq}`);
  L.push('');
  L.push('**クライアントの言葉（原文のまま）**');
  L.push('> ' + r.body.trim().split('\n').join('\n> '));
  L.push('');

  if (r.client_question && r.client_answer) {
    L.push('**こちらから聞いたこと / その答え**');
    L.push(`- 質問: ${r.client_question.trim()}`);
    L.push(`- 回答: ${r.client_answer.trim()}`);
    L.push('');
  }
  if (r.staff_note) {
    L.push('**社内からの補足（依頼文より優先）**');
    L.push('> ' + r.staff_note.trim().split('\n').join('\n> '));
    L.push('');
  }

  L.push('**どこか**');
  L.push(`- ページ: \`${r.page_path}\``);
  if (loc) {
    if (loc.textSample?.trim()) {
      L.push(`- 依頼時の表示: 「${loc.textSample.trim().slice(0, 120)}」`);
    }
    L.push(`- 要素: \`<${loc.tag.toLowerCase()}>\``);
    if (loc.elId) L.push(`- id: \`${loc.elId}\``);
    if (loc.nqId) {
      const n = loc.nqCount ?? 1;
      L.push(
        `- data-nq-id: \`${loc.nqId}\`` +
          (n > 1
            ? `（**同じ id が ${n} 個あります。${(loc.nqOrdinal ?? 0) + 1} 番目です。**` +
              'ループ描画なので、テンプレートを直すと全部変わります。' +
              `データ側の ${(loc.nqOrdinal ?? 0) + 1} 番目を直してください）`
            : ''),
      );
    }
    if (loc.srcAttr) L.push(`- 画像の src: \`${loc.srcAttr}\``);
    if (loc.hrefKey) L.push(`- リンク先: \`${loc.hrefKey}\``);
    if (loc.richPath) L.push(`- 経路: \`${loc.richPath}\``);
    const h = Math.max(1, loc.docHeight || 0);
    const pct = loc.docHeight ? Math.round(((loc.bbox?.y ?? 0) / h) * 100) : null;
    if (pct != null) L.push(`- ページの上から約 ${pct}%（依頼時のビューポート ${r.viewport_w}px）`);
  }
  L.push('');

  if (r.outer_html) {
    L.push('**クリックされた要素（依頼時のもの。いまは変わっている可能性があります）**');
    L.push('```html');
    L.push(r.outer_html.slice(0, 1200));
    L.push('```');
    L.push('');
  }

  const rules = r.css_rules ?? [];
  if (rules.length) {
    L.push('**当たっていた CSS**');
    L.push('```css');
    for (const c of rules.slice(0, 8)) {
      L.push(`${c.selector} { ${String(c.cssText).slice(0, 240)} }`);
    }
    L.push('```');
    L.push('');
  }

  if (atts.length) {
    L.push('**添付（クライアントが送った画像。URL から取得できます）**');
    for (const a of atts) {
      const kind =
        a.kind === 'material' ? 'サイトに使う素材' : 'イメージの参考（そのまま載せない）';
      L.push(`- ${a.filename}（${kind}）`);
      if (a.url) L.push(`  ${a.url}`);
    }
    L.push('');
  }

  return L.join('\n');
}

/**
 * 案件の未処理の依頼を、1本のプロンプトにまとめる。
 *
 * @param statuses 対象の状態。既定は「受付済・対応中」＝まだ直していないもの
 */
export async function buildHandoff(
  projectId: string,
  opts: { ids?: string[]; statuses?: string[]; t?: T } = {},
): Promise<HandoffOut> {
  const t = opts.t ?? plainT;
  const db = adminDb();

  const { data: proj } = await db
    .from('projects')
    .select('name, client_name, site_url, repo_owner, repo_name, default_branch, design_tokens')
    .eq('id', projectId)
    .maybeSingle();
  if (!proj) return { ok: false, message: t('案件が見つかりません'), prompt: '', count: 0 };

  let q = db
    .from('requests')
    .select(
      'id, seq, body, status, category, subtype, page_path, viewport_w, locator, locator_live, outer_html, css_rules, nq_id, nq_ordinal, client_question, client_answer, staff_note',
    )
    .eq('project_id', projectId);
  if (opts.ids?.length) q = q.in('id', opts.ids);
  else q = q.in('status', opts.statuses ?? ['received', 'in_progress']);

  const { data } = await q.order('seq').limit(100);
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) {
    return { ok: true, message: t('渡す依頼がありません'), prompt: '', count: 0 };
  }

  const { data: atts } = await db
    .from('attachments')
    .select('request_id, filename, kind, storage_path')
    .in(
      'request_id',
      rows.map((r) => r.id),
    );
  /*
   * 添付は URL ごと載せる。**写真を必須にした以上、ここに無いと
   * 「一度で投げられる」にならない。** 署名付き URL は7日で切れる。
   * プロンプトは貼るまでに間が空くので、既定の10分では短すぎる。
   */
  const SIGNED_TTL = 7 * 24 * 3600;
  const signed = new Map<string, string>();
  const paths = (atts ?? []).map((a) => (a as { storage_path: string }).storage_path);
  if (paths.length) {
    const { data: urls } = await db.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrls(paths, SIGNED_TTL);
    for (const u of urls ?? []) if (u.signedUrl && u.path) signed.set(u.path, u.signedUrl);
  }
  const byReq = new Map<string, { filename: string; kind: string; url: string | null }[]>();
  for (const a of (atts ?? []) as {
    request_id: string;
    filename: string;
    kind: string;
    storage_path: string;
  }[]) {
    const list = byReq.get(a.request_id) ?? [];
    list.push({ filename: a.filename, kind: a.kind, url: signed.get(a.storage_path) ?? null });
    byReq.set(a.request_id, list);
  }

  const repo =
    proj.repo_owner && proj.repo_name ? `${proj.repo_owner}/${proj.repo_name}` : null;
  const tok = tokensText((proj.design_tokens as SiteTokens | null) ?? null);

  const L: string[] = [];
  L.push(`# ${proj.client_name ?? proj.name} のサイト修正（${rows.length}件）`);
  L.push('');
  L.push(
    'クライアントが本番サイト上で箇所をクリックして送ってきた修正依頼です。' +
      '**下の依頼をすべて実装してください。**',
  );
  L.push('');
  L.push(`- 対象サイト: ${proj.site_url ?? '（未設定）'}`);
  if (repo) L.push(`- リポジトリ: \`${repo}\`（既定ブランチ: \`${proj.default_branch || 'main'}\`）`);
  L.push('');

  L.push('## 進め方');
  L.push('');
  L.push('1. まず**依頼を全部読んでから**着手してください。同じ箇所への依頼が複数あります');
  L.push('2. 各依頼について、実際のソースで対象を特定してから直してください。' +
    '下に載せている HTML と CSS は**依頼が出された時点のもの**で、いまは変わっている可能性があります');
  L.push('3. **最小の変更**にしてください。ついでの整形・リファクタはしないこと');
  L.push('4. 対象が特定できない依頼は、**推測で当てずに飛ばして**ください。' +
    '最後に「特定できなかったもの」として、何が分からなかったかを列挙してください');
  L.push('5. 作業はブランチを切って、**PR で出してください**。直接コミットはしないこと');
  L.push('');

  L.push('## 崩してはいけないこと');
  L.push('');
  L.push('- **`data-nq-id` 属性を消さないでください。** クライアントの依頼の目印です。' +
    '要素を移動するときは属性ごと持っていってください');
  L.push('- **`<img>` の `src` 属性を消さないでください**（`srcset` だけにしない）。画像の同定に使っています');
  L.push('- 依頼に書かれていない箇所は変えないでください');
  L.push('- 色と書体は、そのサイトで既に使われているものから選んでください');
  L.push('');

  if (tok) {
    L.push('## このサイトで使われている色・書体・刻み');
    L.push('');
    L.push(tok);
    L.push('');
  }

  L.push('## 依頼');
  L.push('');
  for (const r of rows) {
    L.push(requestBlock(r, byReq.get(r.id) ?? []));
  }

  L.push('## 終わったら');
  L.push('');
  L.push('- PR の説明に、**依頼番号ごとに何をしたか**を1行ずつ書いてください');
  L.push('- 特定できずに飛ばした依頼があれば、番号と理由を書いてください');
  L.push('- 縦横比や行数が変わってレイアウトが動く箇所があれば、そこも書いてください');

  return {
    ok: true,
    message: t('{n}件をまとめました', { n: rows.length }),
    prompt: L.join('\n'),
    count: rows.length,
  };
}
