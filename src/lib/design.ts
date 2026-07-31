/**
 * 参考デザイン案の生成（社内向け）
 *
 * サイトには適用しない。デザイン変更の指示が来たとき、社内が持ち帰って
 * 検討・提示するための「たたき台」を3案つくる。リポジトリには触らない。
 *
 * 3案は無作為な配色違いではなく、**どこまで踏み込むか**の軸で分ける。
 * 社内が実際に決めるのはそこだから。
 */
import Anthropic from '@anthropic-ai/sdk';
import { adminDb } from '@/lib/supabase/admin';

export const DESIGNS_BUCKET = 'nq-designs';
const SNAPSHOTS_BUCKET = 'nq-snapshots';
const MODEL = 'claude-opus-5';

export type Direction = 'minimal' | 'refined' | 'rethink';

interface Brief {
  direction: Direction;
  variant: number;
  label: string;
  brief: string;
}

const BRIEFS: Brief[] = [
  {
    direction: 'minimal',
    variant: 1,
    label: '最小の変更',
    brief:
      '今の見た目をできるだけ保ち、依頼された点だけを直してください。' +
      '周辺の余白・配色・書体・構造には手を入れないこと。' +
      '「これなら明日出せる」と社内が思える案にしてください。',
  },
  {
    direction: 'refined',
    variant: 2,
    label: '整えた案',
    brief:
      '依頼の意図を汲んで、その要素の周辺まで含めて整えてください。' +
      '余白の刻み、文字の階層、行間、視線の流れを見直してよい。' +
      'ただしサイト全体の配色と書体は既存のものを使うこと。',
  },
  {
    direction: 'rethink',
    variant: 3,
    label: '作り直した案',
    brief:
      '同じ役割を別の構成で解いてください。並び・比率・見せ方を変えてよい。' +
      '配色と書体も、既存のトーンから離れすぎない範囲でなら変えてよい。' +
      'ただし奇をてらわないこと。実装できない表現は入れないでください。',
  },
];

const SYSTEM = `あなたは制作会社のデザイナーです。納品済みサイトに対する修正依頼を受け、社内が検討するための参考デザイン案を1案つくります。

出力する HTML の決まり:
- 自己完結した断片にしてください。<style> をその中に含め、外部のCSS・フォント・画像・スクリプトは一切参照しないこと（読み込めない環境で見ます）
- <!DOCTYPE> や <html>・<head>・<body> は書かないこと。中身だけを書いてください
- クラス名は nqd- で始めてください。プレビュー環境の他の要素と衝突させないためです
- 画像が必要な箇所は、実際の画像を参照せず、背景色とキャプションを置いたプレースホルダにしてください
- 日本語の文言は元のものを保ってください。依頼が文言の変更を求めている場合だけ変えます

守ること:
- 依頼されたことに答えてください。頼まれていない範囲まで作り変えないこと
- 現在のサイトで実際に使われている色・書体・余白を尊重してください。指示が無いのに独自の配色や書体を持ち込まないこと
- 汎用的な「AIが作った風」の見た目を避けてください。Inter / Roboto / system-ui といった既定フォント、紫のグラデーション、意味のない角丸と影の多用はしないこと
- 実装できないものを出さないこと

rationale には、なぜそうしたかを社内が施主に説明できる言葉で2〜4文で書いてください。デザイン用語を並べず、何が良くなるのかを書いてください。`;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '案の名前。10〜20文字程度の日本語' },
    rationale: { type: 'string', description: 'なぜこうしたか。日本語で2〜4文' },
    html: { type: 'string', description: '<style> を含む自己完結した HTML 断片' },
  },
  required: ['title', 'rationale', 'html'],
  additionalProperties: false,
} as const;

export interface RequestContext {
  id: string;
  seq: number;
  body: string;
  pagePath: string;
  outerHtml: string | null;
  computed: Record<string, string> | null;
  cssRules: { selector: string; cssText: string }[] | null;
  cropPath: string | null;
}

/** 依頼から生成に必要な材料を集める */
export async function loadContext(requestId: string): Promise<RequestContext | null> {
  const db = adminDb();
  const { data: r } = await db
    .from('requests')
    .select('id, seq, body, page_path, outer_html, computed, css_rules')
    .eq('id', requestId)
    .maybeSingle();
  if (!r) return null;

  // 切り出し画像があれば渡す。文字だけより結果がはっきり良くなる
  const { data: shots } = await db
    .from('request_shots')
    .select('crop_path')
    .eq('request_id', requestId)
    .not('crop_path', 'is', null)
    .limit(5);

  return {
    id: r.id,
    seq: r.seq,
    body: r.body,
    pagePath: r.page_path,
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

function contextText(ctx: RequestContext, brief: Brief): string {
  const lines: string[] = [];
  lines.push(`# 依頼 #${ctx.seq}`);
  lines.push(ctx.body.trim());
  lines.push('');
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
    lines.push('# 現在あたっている CSS（このサイトの既存のトークン。ここから離れないこと）');
    for (const rule of ctx.cssRules.slice(0, 14)) {
      lines.push(`${rule.selector} { ${String(rule.cssText).slice(0, 240)} }`);
    }
  }

  lines.push('');
  lines.push(`# この案の方向（${brief.label}）`);
  lines.push(brief.brief);

  return lines.join('\n');
}

export interface GeneratedVariant {
  variant: number;
  direction: Direction;
  title: string;
  rationale: string;
  htmlPath: string;
  ok: true;
}
export interface FailedVariant {
  variant: number;
  direction: Direction;
  ok: false;
  reason: string;
}

async function generateOne(
  ctx: RequestContext,
  brief: Brief,
  crop: { media: string; data: string } | null,
  batch: number,
  staffId: string | null,
): Promise<GeneratedVariant | FailedVariant> {
  const client = new Anthropic();

  const content: Anthropic.ContentBlockParam[] = [];
  if (crop) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: crop.media as 'image/webp' | 'image/png',
        data: crop.data,
      },
    });
    content.push({ type: 'text', text: '上の画像が、依頼で指し示された箇所の現在の見た目です。' });
  }
  content.push({ type: 'text', text: contextText(ctx, brief) });

  let parsed: { title: string; rationale: string; html: string };
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
      messages: [{ role: 'user', content }],
    });
    const msg = await stream.finalMessage();

    if (msg.stop_reason === 'refusal') {
      return { variant: brief.variant, direction: brief.direction, ok: false, reason: '生成が拒否されました' };
    }
    const text = msg.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return { variant: brief.variant, direction: brief.direction, ok: false, reason: '空の応答' };
    }
    parsed = JSON.parse(text.text);
    usage = msg.usage;
  } catch (e) {
    return {
      variant: brief.variant,
      direction: brief.direction,
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  const htmlPath = `${ctx.id}/${batch}/${brief.variant}-${brief.direction}.html`;
  const db = adminDb();
  const { error: upErr } = await db.storage
    .from(DESIGNS_BUCKET)
    .upload(htmlPath, Buffer.from(wrapHtml(parsed.title, parsed.html), 'utf8'), {
      contentType: 'text/html; charset=utf-8',
      upsert: true,
    });
  if (upErr) {
    return { variant: brief.variant, direction: brief.direction, ok: false, reason: upErr.message };
  }

  // 1案ずつ書き込む。関数が途中で打ち切られても、出来た分は残る
  await db.from('design_proposals').upsert(
    {
      request_id: ctx.id,
      batch,
      variant: brief.variant,
      direction: brief.direction,
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
    variant: brief.variant,
    direction: brief.direction,
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
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** 3案を並行して作る。1案が落ちても他は残す */
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
  const results = await Promise.all(
    BRIEFS.map((b) => generateOne(ctx, b, crop, batch, staffId)),
  );

  return { ok: true as const, batch, results, usedCrop: !!crop };
}
