/**
 * 本番サイトから設計トークンを抜く
 *
 * 依頼に入っている computed / css_rules は「指された要素の値」でしかない。
 * それだけを渡すと、案の中で新しく必要になった色（区切り線、補助文字、
 * ホバー）をモデルが勝手に決める。そこで既定の作風が出る。
 *
 * 実際に配信されている CSS から、そのサイトが使っている色・書体・余白を
 * 頻度順に取り出して渡す。**選べる色をあらかじめ閉じてしまう**のが狙い。
 *
 * 型は site-tokens.d.mts に置いてある。アプリと検証スクリプトの両方から
 * 素の JS として読めるようにするため、実装はここに .mjs で置く
 * （layout-diff.mjs と同じ流儀）。
 */

const FETCH_TIMEOUT_MS = 8000;
const MAX_SHEETS = 6;
const MAX_SHEET_BYTES = 400_000;

async function get(url, limitBytes) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'nortiq-revise/1.0 (+design-tokens)' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > limitBytes ? text.slice(0, limitBytes) : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 頻度順に上位を返す */
function rank(counts, take) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, take)
    .map(([k]) => k);
}

function bump(m, key) {
  m.set(key, (m.get(key) ?? 0) + 1);
}

export async function fetchSiteTokens(siteUrl) {
  let origin;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return null;
  }

  const html = await get(siteUrl, 1_500_000);
  if (html == null) return null;

  const css = [];

  // インラインの <style>
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    css.push(m[1]);
  }

  // 外部シート
  const hrefs = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      const abs = new URL(href, siteUrl);
      // 自分のオリジンのものだけ。CDN のリセット CSS を数に入れると精度が落ちる
      if (abs.origin === origin) hrefs.push(abs.href);
    } catch {
      /* 不正な href は無視 */
    }
  }

  const sheets = await Promise.all(
    hrefs.slice(0, MAX_SHEETS).map((h) => get(h, MAX_SHEET_BYTES)),
  );
  for (const s of sheets) if (s) css.push(s);

  // 書体の読み込みタグ。プレビューで同じ書体を出すのに要る。
  // これが無いと、案は既定のフォントで描かれて別物に見える。
  const fontLinks = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = m[0].match(/href\s*=\s*["']([^"']+)["']/i)?.[1] ?? '';
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com|\.woff2?(\?|$)/i.test(href)) {
      fontLinks.push(href);
    }
  }

  if (!css.length) return null;
  const all = css.join('\n');

  // ── カスタムプロパティ
  //
  // 名前で絞ると取りこぼす。実測: --ink / --rule / --stone のような
  // 中核の色が「色っぽい名前ではない」という理由だけで落ちていた。
  // **値の形**で判定する。色・寸法・書体スタックなら拾う。
  const looksUseful = (v) =>
    /^#[0-9a-f]{3,8}$/i.test(v) ||
    /^(rgb|hsl)a?\(/i.test(v) ||
    /^[\d.]+(px|rem|em|%)$/.test(v) ||
    /,/.test(v) || // 書体スタック / shadow
    /^(serif|sans-serif|monospace)$/.test(v);

  const vars = [];
  const seenVar = new Set();
  for (const m of all.matchAll(/(--[\w-]+)\s*:\s*([^;{}]{1,120})[;}]/g)) {
    const name = m[1];
    const value = m[2].trim();
    if (seenVar.has(name) || !looksUseful(value)) continue;
    seenVar.add(name);
    vars.push({ name, value });
    if (vars.length >= 60) break;
  }

  // ── 書体
  // font-family が var(--font-serif) の形で書かれているサイトは珍しくない。
  // そのまま捨てると「書体なし」になってしまうので、拾った変数で解決する。
  const varMap = new Map(vars.map((v) => [v.name, v.value]));
  const resolveVars = (s, depth = 0) => {
    if (depth > 3 || !s.includes('var(')) return s;
    const next = s.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name, fallback) =>
      (varMap.get(name) ?? fallback ?? '').trim(),
    );
    return next === s ? s : resolveVars(next, depth + 1);
  };

  const fontCounts = new Map();
  for (const m of all.matchAll(/font-family\s*:\s*([^;{}]+)/gi)) {
    const stack = resolveVars(m[1]).replace(/\s+/g, ' ').replace(/["']/g, '').trim();
    if (!stack || stack.includes('var(')) continue; // 解決できなかったものは出さない
    bump(fontCounts, stack);
  }
  const webFonts = [];
  const seenFace = new Set();
  for (const m of all.matchAll(/@font-face[^{]*\{[^}]*?font-family\s*:\s*["']?([^"';}]+)/gi)) {
    const name = m[1].trim();
    if (!seenFace.has(name)) {
      seenFace.add(name);
      webFonts.push(name);
    }
  }

  // ── 色
  const colorCounts = new Map();
  for (const m of all.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    bump(colorCounts, m[0].toLowerCase());
  }
  for (const m of all.matchAll(/\b(?:rgba?|hsla?)\([^)]{1,60}\)/gi)) {
    bump(colorCounts, m[0].replace(/\s+/g, ' ').toLowerCase());
  }

  // ── 寸法
  const sizeCounts = new Map();
  for (const m of all.matchAll(/font-size\s*:\s*([\d.]+(?:rem|px|em))/gi)) {
    bump(sizeCounts, m[1]);
  }
  const spaceCounts = new Map();
  for (const m of all.matchAll(/(?:margin|padding|gap)[\w-]*\s*:\s*([^;{}]{1,40})/gi)) {
    for (const v of m[1].trim().split(/\s+/)) {
      if (/^[\d.]+(rem|px|em)$/.test(v) && v !== '0px') bump(spaceCounts, v);
    }
  }
  const radiusCounts = new Map();
  for (const m of all.matchAll(/border-radius\s*:\s*([^;{}]{1,30})/gi)) {
    bump(radiusCounts, m[1].trim());
  }

  return {
    origin,
    vars,
    fonts: rank(fontCounts, 6),
    webFonts: webFonts.slice(0, 8),
    colors: rank(colorCounts, 18),
    fontSizes: rank(sizeCounts, 10),
    spacings: rank(spaceCounts, 10),
    radii: rank(radiusCounts, 4),
    fontLinks: [...new Set(fontLinks)].slice(0, 6),
    sheetCount: css.length,
    takenAt: null, // 保存時に呼び出し側が入れる
  };
}

/** プロンプトに載せる形。無ければ null */
export function tokensText(t) {
  if (!t) return null;
  const lines = [];
  lines.push('# このサイトが実際に使っている設計トークン');
  lines.push(`（${t.origin} で配信されている CSS ${t.sheetCount} 件から抽出。頻度順）`);

  if (t.vars.length) {
    lines.push('');
    lines.push('## カスタムプロパティ（プレビュー側で :root に定義済み。var() でそのまま参照できる）');
    for (const v of t.vars) lines.push(`${v.name}: ${v.value}`);
  }
  if (t.webFonts.length) {
    lines.push('');
    lines.push(`## 読み込んでいる書体: ${t.webFonts.join(' / ')}`);
  }
  if (t.fonts.length) {
    lines.push('');
    lines.push('## 使われている font-family');
    for (const f of t.fonts) lines.push(`- ${f}`);
  }
  if (t.colors.length) {
    lines.push('');
    lines.push(`## 使われている色: ${t.colors.join(' ')}`);
  }
  if (t.fontSizes.length) lines.push(`## 文字サイズの刻み: ${t.fontSizes.join(' ')}`);
  if (t.spacings.length) lines.push(`## 余白の刻み: ${t.spacings.join(' ')}`);
  if (t.radii.length) lines.push(`## 角丸: ${t.radii.join(' / ')}`);

  lines.push('');
  lines.push(
    '**配色と書体はここから選んでください。** 一覧に無い色・書体を持ち込んでよいのは、' +
      '施主が明示的に指定した場合だけです。案の中で新しく色が要るとき' +
      '（区切り線、補助文字、ホバー）も、この一覧の色から選ぶか、' +
      '一覧の色の不透明度を変えて作ってください。',
  );

  return lines.join('\n');
}
