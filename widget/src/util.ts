/**
 * ウィジェットの雑多なヘルパ。外部依存ゼロ（6.2）。
 */

/* ── SHA-1（純JS）────────────────────────────────────────────────────────────
 * crypto.subtle は secure context 限定かつ非同期で、http のローカル検証や
 * 同期処理の中では使えない。ロケータの textHash はサーバ側（Node の crypto）と
 * 完全に一致しなければ段1〜2（6.7）が黙って全滅するため、
 * どこでも同じ結果になる純JS実装を持つ。
 * 対になる実装: src/lib/hash.ts の textHashOf()
 * ------------------------------------------------------------------------- */
export function sha1Hex(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const ml = bytes.length;
  const buf = new Uint8Array((((ml + 8) >> 6) + 1) << 6);
  buf.set(bytes);
  buf[ml] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 4, ml << 3, false);

  let h0 = 0x67452301,
    h1 = 0xefcdab89,
    h2 = 0x98badcfe,
    h3 = 0x10325476,
    h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let i = 0; i < buf.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 80; j++) {
      const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
      w[j] = (n << 1) | (n >>> 31);
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4;
    for (let j = 0; j < 80; j++) {
      let f: number, k: number;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

/* ── DOM ヘルパ ──────────────────────────────────────────────────────────── */

/** 選択できない要素（6.3） */
const DENY = new Set([
  'HTML',
  'BODY',
  'HEAD',
  'SCRIPT',
  'STYLE',
  'META',
  'LINK',
  'TITLE',
  'NOSCRIPT',
  'BR',
  'TEMPLATE',
]);

export function isSelectable(el: Element | null, host: Element): el is HTMLElement {
  if (!el || el.nodeType !== 1) return false;
  if (DENY.has(el.tagName)) return false;
  if (el === host || host.contains(el)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  // ビューポート面積の 90% を超える要素は選択不可（6.3）
  const vpArea = window.innerWidth * window.innerHeight;
  if (vpArea > 0 && r.width * r.height > vpArea * 0.9) return false;
  return true;
}

/**
 * 直下のテキストノードだけを連結する（7.4 と同じ規則）。
 * <p>お電話は<strong>075-…</strong>まで</p> の「お電話は」「まで」を拾うため、
 * childElementCount === 0 では判定しない。
 */
export function ownText(el: Element): string {
  let s = '';
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.nodeType === 3) s += n.nodeValue || '';
  }
  return s.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** main > ul > li:nth-of-type(3) の形（6.7） */
export function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 8) {
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    let index = 0;
    let total = 0;
    for (let i = 0; i < parent.children.length; i++) {
      const c = parent.children[i];
      if (c.tagName === cur.tagName) {
        total++;
        if (c === cur) index = total;
      }
    }
    parts.unshift(total > 1 ? tag + ':nth-of-type(' + index + ')' : tag);
    cur = parent;
  }
  return parts.join(' > ');
}

/* ── Tier 0（注入なし）用の手がかり ────────────────────────────────────────
 * data-nq-id が無いサイトでも段2に留まれるようにするための材料。
 * どれも「作者が書いたもの」を優先し、座標や序数のような
 * 当てになる根拠のないものは最後まで使わない。
 * ------------------------------------------------------------------------- */

/**
 * 子孫を含めたテキスト。ownText は直下のテキストノードだけを見るので、
 * <button><span>送信</span></button> や、見出しを1文字ずつ span に割る
 * 出現アニメーションでは空になり、そこで段2の手がかりを失う。
 */
export function deepText(el: Element): string {
  return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** フレームワークが振った id は、ビルドのたびに変わるので足場にしない。 */
const UNSTABLE_ID = /^(:|radix-|mui-|headlessui-|react-aria)|^[0-9]+$|[0-9a-f]{16,}/i;

/** 作者が書いた id だけを返す。 */
export function stableId(el: Element): string | null {
  const id = el.getAttribute('id');
  if (!id || id.length > 128) return null;
  return UNSTABLE_ID.test(id) ? null : id;
}

/** CSS Modules / emotion / styled-components が生成したクラスは毎ビルド変わる。 */
const UNSTABLE_CLASS = /^(css-|sc-|jsx-|emotion-)|__[0-9a-zA-Z]{5,}$|^[0-9a-f]{8,}$/;

function stableClasses(el: Element): string[] {
  const raw = (el.getAttribute('class') || '').trim();
  if (!raw) return [];
  const out: string[] = [];
  for (const c of raw.split(/\s+/)) {
    if (!c || UNSTABLE_CLASS.test(c)) continue;
    out.push(c);
    if (out.length === 2) break;
  }
  return out;
}

export function cssEsc(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

/**
 * cssPath の弁別力を上げた版。
 *
 * cssPath はタグと序数しか持たないため、`div > div:nth-of-type(3) > span` のような
 * 「どこにでもある形」になりやすく、上に1要素挿しただけで別物を指す。
 * クラスと id を混ぜると、並びが変わっても効き、同型の兄弟とも区別がつく。
 * セレクタとしてそのまま querySelectorAll に渡せる形で返す。
 */
export function richPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 6) {
    const id = stableId(cur);
    if (id) {
      // id は文書内で一意な想定。ここより上はたどらなくてよい。
      parts.unshift('#' + cssEsc(id));
      break;
    }
    let seg = cur.tagName.toLowerCase();
    for (const c of stableClasses(cur)) seg += '.' + cssEsc(c);
    const parent: Element | null = cur.parentElement;
    if (parent) {
      let index = 0;
      let total = 0;
      for (let i = 0; i < parent.children.length; i++) {
        const c = parent.children[i];
        if (c.tagName === cur.tagName) {
          total++;
          if (c === cur) index = total;
        }
      }
      if (total > 1) seg += ':nth-of-type(' + index + ')';
    }
    parts.unshift(seg);
    cur = parent;
  }
  return parts.join(' > ');
}

/** リンクの行き先。ドメイン移行で全滅しないよう、同一オリジンは絶対パスに寄せる。 */
export function hrefKey(el: Element): string | null {
  const raw = el.getAttribute('href');
  if (raw == null || raw === '' || raw.length > 2048) return null;
  try {
    const u = new URL(raw, location.href);
    if (u.origin === location.origin) return u.pathname + u.search + u.hash;
  } catch {
    /* href が URL として壊れていてもそのまま使う */
  }
  return raw;
}

/** 文書座標の矩形 */
export function docRect(el: Element): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left + window.scrollX),
    y: Math.round(r.top + window.scrollY),
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
}

/** 選択中の要素種別を日本語で出す（6.4） */
export function jaLabel(el: Element): string {
  const t = el.tagName;
  if (/^H[1-6]$/.test(t)) return '見出し';
  switch (t) {
    case 'IMG':
    case 'PICTURE':
      return '画像';
    case 'SVG':
    case 'svg':
      return 'アイコン';
    case 'VIDEO':
      return '動画';
    case 'BUTTON':
      return 'ボタン';
    case 'A':
      return (el as HTMLAnchorElement).querySelector('img') ? '画像リンク' : 'リンク';
    case 'P':
      return '文章';
    case 'LI':
      return 'リスト項目';
    case 'UL':
    case 'OL':
      return 'リスト';
    case 'TABLE':
      return '表';
    case 'FORM':
      return 'フォーム';
    case 'INPUT':
    case 'TEXTAREA':
    case 'SELECT':
      return '入力欄';
    case 'LABEL':
      return 'ラベル';
    case 'HEADER':
      return 'ヘッダー';
    case 'FOOTER':
      return 'フッター';
    case 'NAV':
      return 'メニュー';
    case 'SECTION':
    case 'ARTICLE':
      return 'セクション';
  }
  if (getComputedStyle(el).backgroundImage !== 'none') return '背景画像つきの領域';
  if (ownText(el)) return 'テキスト';
  return '領域';
}

/** h1 · .hero__title の形（選択中に出す小さなタグ） */
export function shortLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  if (id) return tag + ' · #' + id;
  const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0];
  return cls ? tag + ' · .' + cls : tag;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function fmtBytes(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
