/**
 * ページ内で実行されるレイアウトマップ採取（設計 7.4）。
 *
 * page.evaluate に渡す関数なので、外の変数を参照してはいけない。
 * 引数で渡ったものだけを使う。
 */
export function collectLayoutMap([maskSelectors, limit]) {
  const masked = new Set();
  for (const sel of maskSelectors) {
    let nodes;
    try {
      nodes = document.querySelectorAll(sel);
    } catch {
      continue;
    }
    for (const el of nodes) {
      masked.add(el);
      for (const n of el.querySelectorAll('*')) masked.add(n);
    }
  }

  /**
   * 直下のテキストノードを連結する。
   * <p>お電話は<strong>075-…</strong>まで</p> の「お電話は」「まで」を
   * 誰にも拾わせないわけにいかないので、childElementCount では判定しない。
   * ウィジェット側の ownText と同じ規則にすること。
   */
  const ownText = (el) => {
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue || '';
    return s.replace(/\s+/g, ' ').trim().slice(0, 200);
  };

  const h = (s) => {
    let x = 0;
    for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
    return x;
  };

  const cssPath = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 8) {
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      let index = 0;
      let total = 0;
      for (const c of parent.children) {
        if (c.tagName === cur.tagName) {
          total++;
          if (c === cur) index = total;
        }
      }
      parts.unshift(total > 1 ? tag + ':nth-of-type(' + index + ')' : tag);
      cur = parent;
    }
    return parts.join(' > ');
  };

  const seen = new Map(); // nq-id ごとの出現数 → 序数
  const out = [];

  for (const el of document.querySelectorAll('body *')) {
    if (masked.has(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;

    const key = el.getAttribute('data-nq-id') || null;
    let ord = null;
    if (key) {
      ord = (seen.get(key) ?? -1) + 1;
      seen.set(key, ord);
    }

    const styleKey = [
      cs.color,
      cs.backgroundColor,
      cs.backgroundImage,
      cs.fontSize,
      cs.fontWeight,
      cs.fontFamily,
      cs.lineHeight,
      cs.letterSpacing,
      cs.padding,
      cs.margin,
      cs.textAlign,
      cs.opacity,
      cs.visibility,
      cs.borderTopWidth,
      cs.borderTopStyle,
      cs.borderTopColor,
      cs.borderRadius,
      cs.boxShadow,
    ].join('|');

    const text = ownText(el);

    out.push({
      key,
      ord,
      tag: el.tagName,
      path: cssPath(el),
      text,
      // 判別子はビューポート非依存の src 属性。currentSrc は変化検出にのみ使う
      srcAttr: el.getAttribute('src') || el.getAttribute('srcset') || null,
      src: el.currentSrc || null,
      styleHash: h(styleKey),
      style: {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontSize: cs.fontSize,
        backgroundImage: cs.backgroundImage.slice(0, 120),
      },
      bbox: {
        x: Math.round(r.x + scrollX),
        y: Math.round(r.y + scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
      // 残す優先順の判定に使う（面積では選ばない）
      _leafText: text.length > 0 && el.childElementCount === 0,
      _media: ['IMG', 'PICTURE', 'SVG', 'VIDEO'].includes(el.tagName),
    });
  }

  if (out.length <= limit) {
    return out.map((o) => {
      delete o._leafText;
      delete o._media;
      return o;
    });
  }

  /**
   * 上限を超えたら、次の優先順で残す（7.4）。
   * 面積の大きい順に残してはならない。変化が起きるのは葉のテキストと画像で、
   * 大きなラッパ div を残してもほとんど何も検出できない。
   */
  const rank = (o) => (o.key ? 0 : o._leafText ? 1 : o._media ? 2 : 3);
  out.sort((a, b) => rank(a) - rank(b));
  const kept = out.slice(0, limit);
  // 文書順に戻す（差分の読みやすさのため）
  kept.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  return kept.map((o) => {
    delete o._leafText;
    delete o._media;
    return o;
  });
}
