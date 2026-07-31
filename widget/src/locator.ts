import { cssPath, docRect, ownText, sha1Hex } from './util';

/** 設計 6.7 */
export interface Locator {
  nqId: string | null;
  nqOrdinal: number | null;
  nqCount: number | null;
  sourceRef: string | null;
  tag: string;
  textHash: string | null;
  textSample: string;
  cssPath: string;
  bbox: { x: number; y: number; w: number; h: number };
  viewportW: number;
  docHeight: number;
  /** img / picture のグループ内判別子。currentSrc ではなく src 属性（6.7） */
  srcAttr: string | null;
}

/** 設計 6.8 */
export interface Target {
  srcAttr: string | null;
  srcset: string | null;
  currentSrc: string | null;
  naturalW: number | null;
  naturalH: number | null;
}

export interface MatchedRule {
  href: string | null;
  selector: string;
  cssText: string;
}

export type MatchTier = 'confirmed' | 'provisional' | 'weak' | 'stale';

const COMPUTED_PROPS = [
  'fontSize',
  'fontWeight',
  'lineHeight',
  'color',
  'backgroundColor',
  'margin',
  'padding',
  'display',
  'textAlign',
  'borderRadius',
  'width',
  'height',
] as const;

function textHashOf(text: string): string | null {
  if (!text) return null;
  return 'sha1:' + sha1Hex(text);
}

/** img / picture のグループ内判別子。ビューポート非依存の src 属性を使う。 */
function srcAttrOf(el: Element): string | null {
  if (el.tagName === 'IMG') {
    return el.getAttribute('src') || el.getAttribute('srcset') || null;
  }
  if (el.tagName === 'PICTURE') {
    const img = el.querySelector('img');
    if (img) return img.getAttribute('src') || img.getAttribute('srcset') || null;
    const src = el.querySelector('source');
    return src ? src.getAttribute('srcset') : null;
  }
  return null;
}

export function collectLocator(target: Element): Locator {
  const nqId = target.getAttribute('data-nq-id');
  let nqOrdinal: number | null = null;
  let nqCount: number | null = null;
  if (nqId) {
    const group = nqIdGroup(nqId);
    nqCount = group.length;
    const i = group.indexOf(target);
    nqOrdinal = i >= 0 ? i : null;
  }
  const text = ownText(target);
  return {
    nqId: nqId || null,
    nqOrdinal,
    nqCount,
    sourceRef: target.getAttribute('data-nq-src'),
    tag: target.tagName,
    textHash: textHashOf(text),
    textSample: text,
    cssPath: cssPath(target),
    bbox: docRect(target),
    viewportW: window.innerWidth,
    docHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
    ),
    srcAttr: srcAttrOf(target),
  };
}

function nqIdGroup(nqId: string): Element[] {
  const esc =
    typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(nqId) : nqId.replace(/"/g, '\\"');
  return Array.prototype.slice.call(document.querySelectorAll('[data-nq-id="' + esc + '"]'));
}

/** img / picture のときだけ入る（6.8 / 9.10） */
export function collectTarget(target: Element): Target | null {
  let img: HTMLImageElement | null = null;
  let sourceSets: string[] = [];

  if (target.tagName === 'IMG') {
    img = target as HTMLImageElement;
    const parent = target.parentElement;
    if (parent && parent.tagName === 'PICTURE') {
      sourceSets = Array.prototype.map
        .call(parent.querySelectorAll('source'), (s: Element) => s.getAttribute('srcset') || '')
        .filter(Boolean) as string[];
    }
  } else if (target.tagName === 'PICTURE') {
    img = target.querySelector('img');
    sourceSets = Array.prototype.map
      .call(target.querySelectorAll('source'), (s: Element) => s.getAttribute('srcset') || '')
      .filter(Boolean) as string[];
  } else {
    return null;
  }

  const ownSrcset = img ? img.getAttribute('srcset') : null;
  if (ownSrcset) sourceSets.push(ownSrcset);

  return {
    srcAttr: img ? img.getAttribute('src') : null,
    // <picture> の場合は全 <source> を含める（9.10 の変種集合の材料）
    srcset: sourceSets.length ? sourceSets.join(' , ') : null,
    currentSrc: img && img.currentSrc ? img.currentSrc : null,
    naturalW: img && img.naturalWidth ? img.naturalWidth : null,
    naturalH: img && img.naturalHeight ? img.naturalHeight : null,
  };
}

export function collectComputed(target: Element): Record<string, string> {
  const cs = getComputedStyle(target);
  const out: Record<string, string> = {};
  for (const p of COMPUTED_PROPS) out[p] = cs[p] as string;
  return out;
}

/**
 * 適用中の CSS ルール（9.4）。
 * href はビルド成果物を指すため「現在値のコンテキスト」としてのみ使う。
 */
export function collectMatchedRules(target: Element): MatchedRule[] {
  const out: MatchedRule[] = [];
  let sheets: StyleSheetList;
  try {
    sheets = document.styleSheets;
  } catch {
    return out;
  }
  for (let i = 0; i < sheets.length && out.length < 20; i++) {
    const sheet = sheets[i] as CSSStyleSheet;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // クロスオリジンのシートは読めない
    }
    for (let j = 0; j < rules.length && out.length < 20; j++) {
      const rule = rules[j];
      if (!(rule instanceof CSSStyleRule)) continue;
      try {
        if (!target.matches(rule.selectorText)) continue;
      } catch {
        continue;
      }
      out.push({
        href: sheet.href,
        selector: rule.selectorText,
        cssText: rule.style.cssText.slice(0, 500),
      });
    }
  }
  return out;
}

/* ── 再マッチ（6.7 の4段判定）───────────────────────────────────────────────
 * ピンの再描画に使う。Phase 1 のリプレイ検証ハーネスは、この関数を
 * 後のビルドの DOM に当て直して段の分布を実測する。
 * ------------------------------------------------------------------------- */

export interface MatchResult {
  el: Element;
  tier: MatchTier;
}

export function findByLocator(loc: Locator): MatchResult | null {
  // 段1: nqId
  if (loc.nqId) {
    const group = nqIdGroup(loc.nqId);
    if (group.length === 1) return { el: group[0], tier: 'confirmed' };
    if (group.length > 1) {
      // グループ内を判別子で絞る。img / picture は own-text が空なので src 属性。
      const isImg = loc.tag === 'IMG' || loc.tag === 'PICTURE';
      if (isImg && loc.srcAttr) {
        const hits = group.filter((e) => srcAttrOf(e) === loc.srcAttr);
        if (hits.length === 1) return { el: hits[0], tier: 'confirmed' };
      } else if (loc.textHash) {
        const hits = group.filter((e) => textHashOf(ownText(e)) === loc.textHash);
        if (hits.length === 1) return { el: hits[0], tier: 'confirmed' };
      }
      // 段2: 序数のみ。confirmed にしてはならない（1件挿入で全部ずれる）
      if (loc.nqOrdinal != null && group[loc.nqOrdinal]) {
        return { el: group[loc.nqOrdinal], tier: 'provisional' };
      }
    }
  }

  // ロケータに nqId があったのに、その id が文書内に1つも無い場合。
  // 要素そのものが消えている（別のページ／別のビューを見ている）可能性が高い。
  // ここで cssPath や bbox に落ちると、**別のページの無関係な要素を掴む**。
  // SPA で URL が変わらないサイトでは、これが「ページを移動してもピンが出る」
  // という形で表に出る。強い手がかりから弱い手がかりへは降りない。
  const nqIdMissing = !!loc.nqId && nqIdGroup(loc.nqId).length === 0;

  // 段2: textHash + tag（nqId なし）
  if (loc.textHash) {
    const cands = Array.prototype.slice.call(
      document.getElementsByTagName(loc.tag),
    ) as Element[];
    const hits = cands.filter((e) => textHashOf(ownText(e)) === loc.textHash);
    if (hits.length === 1) return { el: hits[0], tier: 'provisional' };
  }

  // nqId があったのに見つからないなら、段3（cssPath / bbox）には降りない
  if (nqIdMissing) return null;

  // 段3: cssPath
  try {
    const byPath = loc.cssPath ? document.body.querySelector(loc.cssPath) : null;
    if (byPath && byPath.tagName === loc.tag) return { el: byPath, tier: 'weak' };
  } catch {
    /* 不正なセレクタは無視 */
  }

  // 段3: bbox の IoU（同一ビューポート同士でのみ比較する）
  if (loc.viewportW === window.innerWidth) {
    const cands = Array.prototype.slice.call(
      document.getElementsByTagName(loc.tag),
    ) as Element[];
    let best: Element | null = null;
    let bestIoU = 0;
    for (const c of cands) {
      const r = docRect(c);
      const iou = iouOf(r, loc.bbox);
      if (iou > bestIoU) {
        bestIoU = iou;
        best = c;
      }
    }
    if (best && bestIoU >= 0.6) return { el: best, tier: 'weak' };
  }

  // 段4
  return null;
}

function iouOf(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
