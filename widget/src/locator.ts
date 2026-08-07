import {
  cssEsc,
  cssPath,
  deepText,
  docRect,
  hrefKey,
  ownText,
  richPath,
  sha1Hex,
  stableId,
} from './util';

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

  /* ── Tier 0（注入なし）の手がかり ──────────────────────────────────────
   * 注入を入れていないサイトでも段2に留まるための材料。
   * 古い依頼のロケータには入っていないので、参照側は必ず欠損を許すこと。
   * -------------------------------------------------------------------- */
  /** 作者が書いた id。nq-id と同じ「識別子の宣言」として扱う */
  elId?: string | null;
  /** 子孫を含めたテキストのハッシュ。ownText と同じなら null（送る量を増やさない） */
  deepTextHash?: string | null;
  /** リンクの行き先。同一オリジンは絶対パスに寄せてある */
  hrefKey?: string | null;
  /** クラス・id を含む経路。cssPath より弁別力が高い */
  richPath?: string | null;
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
  const deep = deepText(target);
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
    elId: stableId(target),
    deepTextHash: deep && deep !== text ? textHashOf(deep) : null,
    hrefKey: hrefKey(target),
    richPath: richPath(target),
  };
}

function nqIdGroup(nqId: string): Element[] {
  const esc =
    typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(nqId) : nqId.replace(/"/g, '\\"');
  return Array.prototype.slice.call(document.querySelectorAll('[data-nq-id="' + esc + '"]'));
}

function qsa(selector: string): Element[] {
  return Array.prototype.slice.call(document.querySelectorAll(selector));
}

/**
 * 同じタグの中で条件に合うものが「ちょうど1つ」のときだけ返す。
 * 2つ以上あるなら、それはその手がかりでは判別できないということなので、
 * 先頭を返さずに次の段へ渡す（6.7）。
 */
function uniqueAmongTag(tag: string, pred: (e: Element) => boolean): Element | null {
  const cands = document.getElementsByTagName(tag);
  let hit: Element | null = null;
  for (let i = 0; i < cands.length; i++) {
    if (!pred(cands[i])) continue;
    if (hit) return null;
    hit = cands[i];
  }
  return hit;
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

/**
 * 何で当てたか。**段（tier）とは別の軸**。
 *
 *   nqid       注入された識別子。文書内で一意
 *   content    その要素自身が名乗っているもの（id / src / href / 本文）
 *   ordinal    nq-id の集団の中で「何番目か」。中身では絞れなかった
 *   structure  「上から N 番目の div」。中身が入れ替われば別物を掴む
 *
 * 錨を打ち直してよいかの判断はこちらで行う。段だけで見ると、richPath
 * （構造）も本文一致（中身）も同じ provisional なので、**構造で当てた
 * ものまで書き込んでしまう**。実測で、それが5件の当て違いを固定した。
 */
export type MatchVia = 'nqid' | 'content' | 'ordinal' | 'structure';

export interface MatchResult {
  el: Element;
  tier: MatchTier;
  via: MatchVia;
}

/**
 * 「その要素は、この文書には**居ない**」と言い切れるか。
 *
 * findByLocator が null を返す理由は2つあり、扱いが正反対になる。
 *
 *   居ない   … nq-id を記録してあるのに文書内に1つも無い。SPA で別のビューを
 *              見ている場合がこれ。ここでピンを描くと、無関係な場所に
 *              前のページの番号が出る
 *   分からない … 手がかりが弱くて絞れなかっただけ。要素はたぶんそこにある。
 *              ここで描かないと、**直したとたんに番号が消える**
 *
 * 前者だけを黙って落とす。後者は記録した座標に描いて残す。
 */
/**
 * 「その要素が何であるか」を名乗っている手がかりを持っているか。
 *
 *   中身の手がかり  nqId / elId / srcAttr / hrefKey / textHash / deepTextHash
 *                  → その要素**自身**の性質。別の要素には当たらない
 *   構造の手がかり  richPath / cssPath / bbox
 *                  → 「上から N 番目の div」。中身が入れ替われば別物を掴む
 *
 * 中身の手がかりを持っているのに1つも当たらないなら、**その要素は
 * この画面に居ない。** SPA で別のビューを見ているときがこれで、
 * ここで構造の手がかりに降りると、無関係な要素にピンが付く。
 */
/** 記録した nq-id が、いまの文書に1つも無い（＝振り直された／要素が消えた） */
export function deadNqId(loc: Locator): boolean {
  return !!loc.nqId && nqIdGroup(loc.nqId).length === 0;
}

export function hasContentCue(loc: Locator): boolean {
  /*
   * nq-id は「持っているか」ではなく「**まだ生きているか**」で数える。
   *
   * nq-id は sha1(ファイル名 + 構文木上の経路) で、経路には「同じ親の中で
   * 同じタグの何番目か」が入っている。要素を1つ足せば後ろが全部振り直される。
   * つまり文書内に無いことは「要素が消えた」ではなく「id が変わった」の
   * ことが多い。それを生きた手がかりとして数えると、**注入したせいで
   * ピンが弱くなる**という逆転が起きる。
   *
   * とくに svg / input / src の無い img / 空のラッパ div は、本文も src も
   * href も空なので手がかりが nq-id ただ1つ。ここを塞ぐと、注入していない
   * サイトなら降りられた構造の手がかりにすら降りられなくなる。
   */
  if (loc.nqId && nqIdGroup(loc.nqId).length > 0) return true;
  return !!(loc.elId || loc.srcAttr || loc.hrefKey || loc.textHash || loc.deepTextHash);
}

/**
 * 同じ本文を持つ要素が、文書全体で**ちょうど1つ**なら返す。タグは問わない。
 *
 * 直しの過程でタグが変わることがある（div を p にする、span を b で包む）。
 * タグが違うだけで見失うのはもったいない。一意であることは崩さない。
 */
/**
 * タグを捨てて本文だけで当てにいくときに、本文に求める最低の長さ。
 * これより短いものは識別子として扱わない（実測で「—」1文字が別の要素に
 * 当たった）。日本語は1文字の情報量が大きいので、6 でも短いほうに倒している。
 */
const MIN_CROSS_TAG_TEXT = 6;

function uniqueAnyTag(pred: (e: Element) => boolean): Element | null {
  const all = document.getElementsByTagName('*');
  let hit: Element | null = null;
  for (let i = 0; i < all.length; i++) {
    if (!pred(all[i])) continue;
    if (hit) return null;
    hit = all[i];
  }
  return hit;
}

export interface FindOptions {
  /**
   * 構造の手がかり（richPath / cssPath / bbox）まで降りてよいか。
   *
   * 既定は false。中身の手がかりが1つも当たらないなら、その要素は
   * この画面に居ないと考える（SPA で別のビューを見ている）。
   *
   * ただし**同じページの他のピンが中身の手がかりで当たっている**なら、
   * 見ている画面は合っている。そのときだけ true にしてよい。
   * 呼び出し側（drawPins）が2周目で立てる。
   */
  allowStructural?: boolean;
}

export function findByLocator(loc: Locator, opts?: FindOptions): MatchResult | null {
  // 段1: nqId
  if (loc.nqId) {
    const group = nqIdGroup(loc.nqId);
    if (group.length === 1) return { el: group[0], tier: 'confirmed', via: 'nqid' };
    if (group.length > 1) {
      // グループ内を判別子で絞る。img / picture は own-text が空なので src 属性。
      const isImg = loc.tag === 'IMG' || loc.tag === 'PICTURE';
      if (isImg && loc.srcAttr) {
        const hits = group.filter((e) => srcAttrOf(e) === loc.srcAttr);
        if (hits.length === 1) return { el: hits[0], tier: 'confirmed', via: 'nqid' };
      } else if (loc.textHash) {
        const hits = group.filter((e) => textHashOf(ownText(e)) === loc.textHash);
        if (hits.length === 1) return { el: hits[0], tier: 'confirmed', via: 'nqid' };
      }
      // 段2: 序数のみ。confirmed にしてはならない（1件挿入で全部ずれる）
      if (loc.nqOrdinal != null && group[loc.nqOrdinal]) {
        return { el: group[loc.nqOrdinal], tier: 'provisional', via: 'ordinal' };
      }
    }
  }

  // 段1: 作者が書いた id。nq-id と同じ「識別子の宣言」なので同じ段に置く。
  // ビルドのたびに変わる自動生成 id は stableId が採取時に弾いている。
  // confirmed にする以上、文書内で一意であることまで確かめる。
  if (loc.elId) {
    const byId = qsa('#' + cssEsc(loc.elId));
    if (byId.length === 1 && byId[0].tagName === loc.tag) {
      return { el: byId[0], tier: 'confirmed', via: 'content' };
    }
  }

  // 段2: 作者が書いた判別子。
  // src / href は「その要素が何を指すか」の宣言であって、座標や序数のような
  // 当てずっぽうではない。注入なしのサイトでは画像とリンクがここで拾える。
  // 採取時にしか使っていなかった srcAttr を、nqId が無い経路でも使う。
  if (loc.tag === 'IMG' || loc.tag === 'PICTURE') {
    if (loc.srcAttr) {
      const hit = uniqueAmongTag(loc.tag, (e) => srcAttrOf(e) === loc.srcAttr);
      if (hit) return { el: hit, tier: 'provisional', via: 'content' };
    }
  } else if (loc.hrefKey) {
    const hit = uniqueAmongTag(loc.tag, (e) => hrefKey(e) === loc.hrefKey);
    if (hit) return { el: hit, tier: 'provisional', via: 'content' };
  }

  // 段2: 本文。まず直下のテキスト（従来どおり）。
  if (loc.textHash) {
    const hit = uniqueAmongTag(loc.tag, (e) => textHashOf(ownText(e)) === loc.textHash);
    if (hit) return { el: hit, tier: 'provisional', via: 'content' };
  }

  // 段2: 子孫を含めたテキスト。
  // <button><span>送信</span></button> や、見出しを1文字ずつ span に割る
  // 出現アニメーションでは ownText が空になり、上の段が丸ごと効かない。
  if (loc.deepTextHash) {
    const hit = uniqueAmongTag(loc.tag, (e) => textHashOf(deepText(e)) === loc.deepTextHash);
    if (hit) return { el: hit, tier: 'provisional', via: 'content' };
  }

  /*
   * 段2: 記録した「直下のテキスト」を、いまの「子孫込みのテキスト」と突き合わせる。
   *
   * 採取側は deep === text のとき deepTextHash を入れない（送る量を増やさない
   * ため）。つまり <h2>会社概要</h2> のような葉要素は textHash しか持たない。
   * そこへ後から <h2><span>会社概要</span></h2> と包む変更が入ると、
   * ownText が空になって上の段が外れ、deepTextHash は無いので次の段も飛ぶ。
   * **画面の文字は1バイトも変わっていないのに見失う。**
   *
   * 独立した段にする。上の述語に OR で混ぜると、ownText 一致1件と
   * deepText 一致1件を uniqueAmongTag が2件と数えて、かえって外れる。
   */
  if (loc.textHash) {
    const hit = uniqueAmongTag(loc.tag, (e) => textHashOf(deepText(e)) === loc.textHash);
    if (hit) return { el: hit, tier: 'provisional', via: 'content' };
  }

  /*
   * 段2: タグを問わない本文一致。
   *
   * 直しの過程でタグが変わることがある（div → p、span を b で包む）。
   * タグが違うだけで見失うのはもったいない。
   *
   * ただし**短い文字列は識別子ではない。** 「—」「2024」「詳細」のような
   * ものは、たまたま文書内で1つだっただけということが起きる。
   * 実測で、記録は DIV なのに 1文字の「—」で別の SPAN に当たった。
   * タグまで捨てる以上、本文そのものに弁別力を求める。
   */
  const sample = (loc.textSample ?? '').trim();
  if (sample.length >= MIN_CROSS_TAG_TEXT) {
    if (loc.textHash) {
      const hit = uniqueAnyTag((e) => textHashOf(ownText(e)) === loc.textHash);
      if (hit) return { el: hit, tier: 'provisional', via: 'content' };
    }
    if (loc.deepTextHash) {
      const hit = uniqueAnyTag((e) => textHashOf(deepText(e)) === loc.deepTextHash);
      if (hit) return { el: hit, tier: 'provisional', via: 'content' };
    }
  }

  /*
   * ここから下は**構造の手がかり**（richPath / cssPath / bbox）。
   * 「上から N 番目の div」なので、中身が入れ替われば別物を掴む。
   *
   * 中身の手がかりを1つでも持っていたのに、上まででどれも当たらなかった
   * なら、**その要素はこの画面に居ない。** 降りてはいけない。
   *
   * これを nqId の有無だけで見ていたのが、実測で2つの不具合になった。
   *   - nq-id が振り直されただけの要素まで捨てていた（本文は残っていたのに）
   *   - nq-id を持たないサイト（ブラウザ内で描画する型）では防御が
   *     一切効かず、SPA でビューを切り替えると別の画面にピンが出ていた
   * 見るべきは「nq-id があるか」ではなく「中身の手がかりがあるか」だった。
   */
  if (hasContentCue(loc) && !opts?.allowStructural) return null;

  // 段3: richPath。cssPath と同じ構造の手がかりだが、クラスと id を含む分だけ強い。
  // 同じ文言が並ぶ「→」のような span は、本文では区別がつかずここで拾う。
  // 文言の一致は求めない。指摘を受けて文言を直すのが本来の流れであり、
  // そこで外すと「直したらピンが消える」になる。
  if (loc.richPath) {
    try {
      const hits = qsa(loc.richPath);
      if (hits.length === 1 && hits[0].tagName === loc.tag) {
        return { el: hits[0], tier: 'provisional', via: 'structure' };
      }
    } catch {
      /* 不正なセレクタは無視 */
    }
  }

  /*
   * 段3: cssPath
   *
   * **一意でなければ採らない。** ここだけ querySelector で先頭を採っていた。
   * 実測で、`div > div:nth-of-type(4) > div:nth-of-type(2)` が2か所に当たり、
   * その1件目がフッターだった。記録した本文は「BUSINESS — 事業内容…」。
   * SPA でビューを切り替えても同じ形の入れ子はどこにでもあるので、
   * 先頭を採ると**どの画面にも無関係な番号が出る**。
   * 他の段はすべて一意を求めている。ここだけ緩いのは単なる穴だった。
   */
  try {
    const hits = loc.cssPath ? document.body.querySelectorAll(loc.cssPath) : [];
    if (hits.length === 1 && hits[0].tagName === loc.tag) return { el: hits[0], tier: 'weak', via: 'structure' };
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
    if (best && bestIoU >= 0.6) return { el: best, tier: 'weak' , via: 'structure' };
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
