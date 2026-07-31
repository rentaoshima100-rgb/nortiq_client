/**
 * 参考デザイン案の生成（社内向け）
 *
 * サイトには適用しない。デザイン変更の指示が来たとき、社内が持ち帰って
 * 検討・提示するための「たたき台」を3案つくる。リポジトリには触らない。
 *
 * 手順は2段。いきなり作らせるとモデルが持っている既定の作風が出るので、
 * 先に web_search で「同じ役割を担っている実在サイトの構成」を調べ、
 * その型を材料にして作らせる。施主の明示指定があればそれが最優先。
 */
import Anthropic from '@anthropic-ai/sdk';
import { adminDb } from '@/lib/supabase/admin';

export const DESIGNS_BUCKET = 'nq-designs';
const SNAPSHOTS_BUCKET = 'nq-snapshots';
const MODEL = 'claude-opus-5';

const RESEARCH_SYSTEM = `あなたは制作会社のディレクターです。納品済みサイトへの修正依頼を受け、デザイナーが案を作るための調査をします。自分で案を作るのではなく、**材料を集めて渡す**のが仕事です。

手順:
1. 依頼文から、施主が明示的に指定していることを漏れなく拾ってください（色、参考にしたいサイト、雰囲気、要素の増減など）。**指定があればそれが最優先で、以降のすべてに優先します。**
2. その要素が担っている役割（例: 建設会社トップの実績一覧、サービス紹介の3カラム）を見極め、**同じ役割を担っている実在サイトの構成を web_search で調べてください。** 業種が近いものを優先します。日本語サイトも英語サイトも見てよい。
3. 調べた中から、**構成として明確に違う型を3つ**選んでください。配色違いではなく、並べ方・情報の出し方・視線の運び方が違うものです。

出力は日本語のマークダウンで、次の形にしてください:

## 施主の指定
（依頼文から読み取れた明示指定を箇条書き。無ければ「明示的な指定なし」と書く）

## 調べたこと
（同じ役割の要素が実際どう作られているか。3〜6行。一般論ではなく、見た実例に基づいて書く）

## 案1: （型の名前）
- 参考にした実例: （サイト名とURL。何をしている会社かも一言）
- 構成: （どう並べるか。要素の順序と比率）
- 真似する点: （具体的に。「余白を広く」ではなく「見出しと本文の間を32px、セクション間を96px」のように）
- この案が効く理由: （1〜2文）

## 案2: （型の名前）
（同じ形式）

## 案3: （型の名前）
（同じ形式）

守ること:
- 実際に検索して見つけたものだけを書いてください。URLを推測で書かないこと。見つからなければ「近い実例は見つからず、一般的な型として」と正直に書く
- 3案は構成として明確に違えてください。同じ並びの色違いは案として数えません
- 施主の指定がある場合、3案すべてがその指定を満たすこと。指定の中で案を分けます`;

/** 3案それぞれに渡す指示。案の中身は調査結果が決める */
const VARIANT_PROMPTS = [1, 2, 3].map((n) => ({
  variant: n,
  instruction:
    `調査結果の「## 案${n}」を実装してください。` +
    `参考実例の構成をそのまま持ってくるのではなく、**このサイトの内容と既存のトークンに載せ替えて**ください。` +
    `他の2案とは構成として明確に違うものになるはずです。そこを曖昧にしないこと。`,
}));

const SYSTEM = `あなたは制作会社のデザイナーです。納品済みサイトに対する修正依頼を受け、社内が検討するための参考デザイン案を1案つくります。

出力する HTML の決まり:
- 自己完結した断片にしてください。<style> をその中に含め、外部のCSS・フォント・画像・スクリプトは一切参照しないこと（読み込めない環境で見ます）
- <!DOCTYPE> や <html>・<head>・<body> は書かないこと。中身だけを書いてください
- クラス名は nqd- で始めてください。プレビュー環境の他の要素と衝突させないためです
- 画像が必要な箇所は、実際の画像を参照せず、背景色とキャプションを置いたプレースホルダにしてください
- 日本語の文言は元のものを保ってください。依頼が文言の変更を求めている場合だけ変えます

守ること:
- **施主の指定が最優先です。** 調査結果の「施主の指定」に書かれていることは必ず満たしてください
- 調査結果で割り当てられた案の構成に従ってください。参考実例の型を、このサイトの内容に載せ替えます
- 現在のサイトで実際に使われている色・書体・余白を尊重してください。指定が無いのに独自の配色や書体を持ち込まないこと
- 汎用的な「AIが作った風」の見た目を避けてください。Inter / Roboto / system-ui といった既定フォント、紫のグラデーション、意味のない角丸と影の多用はしないこと
- 頼まれていない範囲まで作り変えないこと。実装できないものを出さないこと

rationale には、なぜそうしたかを社内が施主に説明できる言葉で2〜4文で書いてください。デザイン用語を並べず、何が良くなるのかを書いてください。参考にした実例があれば触れてください。`;

const SCHEMA = {
  type: 'object',
  properties: {
    direction: { type: 'string', description: '案の型の短い名前。8文字程度の日本語' },
    title: { type: 'string', description: '案の名前。10〜20文字程度の日本語' },
    rationale: { type: 'string', description: 'なぜこうしたか。日本語で2〜4文' },
    html: { type: 'string', description: '<style> を含む自己完結した HTML 断片' },
  },
  required: ['direction', 'title', 'rationale', 'html'],
  additionalProperties: false,
} as const;

export interface RequestContext {
  id: string;
  projectId: string;
  seq: number;
  body: string;
  pagePath: string;
  outerHtml: string | null;
  computed: Record<string, string> | null;
  cssRules: { selector: string; cssText: string }[] | null;
  cropPath: string | null;
  /** 調査で「同じ役割の実例」を探すのに要る。何の会社のどのページか */
  siteName: string | null;
  siteUrl: string | null;
}

/** 依頼から生成に必要な材料を集める */
export async function loadContext(requestId: string): Promise<RequestContext | null> {
  const db = adminDb();
  const { data: r } = await db
    .from('requests')
    .select('id, project_id, seq, body, page_path, outer_html, computed, css_rules')
    .eq('id', requestId)
    .maybeSingle();
  if (!r) return null;

  const { data: proj } = await db
    .from('projects')
    .select('name, client_name, site_url')
    .eq('id', r.project_id)
    .maybeSingle();

  // 切り出し画像があれば渡す。文字だけより結果がはっきり良くなる
  const { data: shots } = await db
    .from('request_shots')
    .select('crop_path')
    .eq('request_id', requestId)
    .not('crop_path', 'is', null)
    .limit(5);

  return {
    id: r.id,
    projectId: r.project_id,
    seq: r.seq,
    body: r.body,
    pagePath: r.page_path,
    siteName: proj?.client_name ?? proj?.name ?? null,
    siteUrl: proj?.site_url ?? null,
    outerHtml: r.outer_html,
    computed: r.computed as Record<string, string> | null,
    cssRules: r.css_rules as { selector: string; cssText: string }[] | null,
    cropPath: shots?.length ? (shots[shots.length - 1].crop_path as string) : null,
  };
}

/** 切り出し画像を base64 で取る。無ければ null */
async function loadCrop(
  cropPath: string | null,
): Promise<{ media: 'image/webp' | 'image/png'; data: string } | null> {
  if (!cropPath) return null;
  try {
    const db = adminDb();
    const { data, error } = await db.storage.from(SNAPSHOTS_BUCKET).download(cropPath);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    if (buf.length > 3_500_000) return null; // 大きすぎるものは送らない
    return {
      media: cropPath.endsWith('.png') ? 'image/png' : 'image/webp',
      data: buf.toString('base64'),
    };
  } catch {
    return null;
  }
}
/** 依頼そのものの材料。調査でも生成でも同じものを使う */
function siteContext(ctx: RequestContext): string {
  const lines: string[] = [];
  lines.push(`# 依頼 #${ctx.seq}`);
  lines.push(ctx.body.trim());
  lines.push('');
  if (ctx.siteName) lines.push(`サイト: ${ctx.siteName}`);
  if (ctx.siteUrl) lines.push(`URL: ${ctx.siteUrl}`);
  lines.push(`ページ: ${ctx.pagePath}`);

  if (ctx.outerHtml) {
    lines.push('');
    lines.push('# 対象要素の現在のマークアップ');
    lines.push('```html');
    lines.push(ctx.outerHtml.slice(0, 6000));
    lines.push('```');
  }

  if (ctx.computed) {
    lines.push('');
    lines.push('# 対象要素の現在の値（ブラウザの計算値）');
    for (const [k, v] of Object.entries(ctx.computed)) lines.push(`${k}: ${v}`);
  }

  if (ctx.cssRules?.length) {
    lines.push('');
    lines.push('# 現在あたっている CSS（このサイトの既存のトークン）');
    for (const rule of ctx.cssRules.slice(0, 14)) {
      lines.push(`${rule.selector} { ${String(rule.cssText).slice(0, 240)} }`);
    }
  }

  return lines.join('\n');
}

function imageBlocks(
  crop: { media: string; data: string } | null,
): Anthropic.ContentBlockParam[] {
  if (!crop) return [];
  return [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: crop.media as 'image/webp' | 'image/png',
        data: crop.data,
      },
    },
    { type: 'text', text: '上の画像が、依頼で指し示された箇所の現在の見た目です。' },
  ];
}

export interface Research {
  clientSpec: string | null;
  brief: string;
  sources: { title: string; url: string }[];
}

/**
 * 案を作る前の調査（web_search）。
 *
 * いきなり作らせると、モデルが持っている既定の作風が出る。
 * 同じ役割を担っている実在サイトの構成を調べさせ、その型を材料にする。
 */
export async function research(
  ctx: RequestContext,
  crop: { media: string; data: string } | null,
): Promise<Research> {
  const client = new Anthropic();

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: RESEARCH_SYSTEM,
    output_config: { effort: 'medium' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
    messages: [
      { role: 'user', content: [...imageBlocks(crop), { type: 'text', text: siteContext(ctx) }] },
    ],
  });
  const msg = await stream.finalMessage();

  const brief = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('\n')
    .trim();

  // 検索結果から出典を拾う。社内が施主に示すときの根拠になる
  const sources: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const b of msg.content) {
    if (b.type !== 'web_search_tool_result') continue;
    const items = (b as { content: unknown }).content;
    if (!Array.isArray(items)) continue; // エラー時は配列ではなくオブジェクトが入る
    for (const it of items as { title?: string; url?: string }[]) {
      if (!it.url || seen.has(it.url)) continue;
      seen.add(it.url);
      sources.push({ title: it.title ?? it.url, url: it.url });
    }
  }

  const specMatch = brief.match(/##\s*施主の指定\s*\n([\s\S]*?)(?=\n##\s|$)/);
  const spec = specMatch?.[1]?.trim() ?? null;

  return {
    clientSpec: spec && !/明示的な指定なし/.test(spec) ? spec : null,
    brief,
    sources,
  };
}

export interface GeneratedVariant {
  variant: number;
  direction: string;
  title: string;
  rationale: string;
  htmlPath: string;
  ok: true;
}
export interface FailedVariant {
  variant: number;
  ok: false;
  reason: string;
}

async function generateOne(
  ctx: RequestContext,
  v: { variant: number; instruction: string },
  brief: string,
  crop: { media: string; data: string } | null,
  batch: number,
  staffId: string | null,
): Promise<GeneratedVariant | FailedVariant> {
  const client = new Anthropic();

  const body = `${siteContext(ctx)}\n\n# 調査結果\n${brief}\n\n# あなたが作る案\n${v.instruction}`;

  let parsed: { direction: string; title: string; rationale: string; html: string };
  let usage: Anthropic.Usage;
  try {
    // 長い出力になるので必ずストリーム。非ストリームだと HTTP タイムアウトに当たる
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: 'user', content: [...imageBlocks(crop), { type: 'text', text: body }] }],
    });
    const msg = await stream.finalMessage();

    if (msg.stop_reason === 'refusal') {
      return { variant: v.variant, ok: false, reason: '生成が拒否されました' };
    }
    const text = msg.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return { variant: v.variant, ok: false, reason: '空の応答' };
    }
    parsed = JSON.parse(text.text);
    usage = msg.usage;
  } catch (e) {
    return { variant: v.variant, ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  const htmlPath = `${ctx.id}/${batch}/${v.variant}.html`;
  const db = adminDb();
  const { error: upErr } = await db.storage
    .from(DESIGNS_BUCKET)
    .upload(htmlPath, Buffer.from(wrapHtml(parsed.title, parsed.html), 'utf8'), {
      contentType: 'text/html; charset=utf-8',
      upsert: true,
    });
  if (upErr) return { variant: v.variant, ok: false, reason: upErr.message };

  // 1案ずつ書き込む。関数が途中で打ち切られても、出来た分は残る
  await db.from('design_proposals').upsert(
    {
      request_id: ctx.id,
      batch,
      variant: v.variant,
      direction: parsed.direction.slice(0, 40),
      title: parsed.title,
      rationale: parsed.rationale,
      html_path: htmlPath,
      model: MODEL,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      created_by: staffId,
    } as never,
    { onConflict: 'request_id,batch,variant' },
  );

  return {
    variant: v.variant,
    direction: parsed.direction,
    title: parsed.title,
    rationale: parsed.rationale,
    htmlPath,
    ok: true,
  };
}

/** 断片を、そのまま開けるページに包む */
function wrapHtml(title: string, fragment: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; }
</style>
</head>
<body>
${fragment}
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

/** 調べてから、3案を並行して作る。1案が落ちても他は残す */
export async function generateProposals(requestId: string, staffId: string | null) {
  const ctx = await loadContext(requestId);
  if (!ctx) return { ok: false as const, error: '依頼が見つかりません' };

  const db = adminDb();
  const { data: last } = await db
    .from('design_proposals')
    .select('batch')
    .eq('request_id', requestId)
    .order('batch', { ascending: false })
    .limit(1);
  const batch = (last?.[0]?.batch ?? 0) + 1;

  const crop = await loadCrop(ctx.cropPath);

  let found: Research;
  try {
    found = await research(ctx, crop);
  } catch (e) {
    return {
      ok: false as const,
      error: `調査に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  await db.from('design_batches').upsert(
    {
      request_id: ctx.id,
      batch,
      client_spec: found.clientSpec,
      brief: found.brief,
      sources: found.sources,
      model: MODEL,
      created_by: staffId,
    } as never,
    { onConflict: 'request_id,batch' },
  );

  const results = await Promise.all(
    VARIANT_PROMPTS.map((v) => generateOne(ctx, v, found.brief, crop, batch, staffId)),
  );

  return { ok: true as const, batch, results, usedCrop: !!crop, research: found };
}
