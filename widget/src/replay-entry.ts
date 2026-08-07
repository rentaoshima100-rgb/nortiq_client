/**
 * リプレイ検証ハーネス（設計 6.7）用のエントリ。
 *
 * ウィジェット本体と同じ locator.ts をそのまま束ねて、Playwright から
 * ページに注入できる形にする。ハーネスが別実装の照合器を持つと、
 * 測っているものが本番と違うものになり、意味が無くなる。
 */
import { collectLocator, findByLocator, type Locator } from './locator';
import { docRect } from './util';

declare global {
  interface Window {
    __nqReplay: {
      findByLocator(
      loc: Locator,
      opts?: { allowStructural?: boolean },
    ): { tier: string; via: string; tag: string; text: string; bbox: ReturnType<typeof docRect> } | null;
      collectLocator(el: Element): Locator;
    };
  }
}

window.__nqReplay = {
  findByLocator(loc: Locator, opts?: { allowStructural?: boolean }) {
    const hit = findByLocator(loc, opts);
    if (!hit) return null;
    // 当たった要素の**いまの本文**も返す。番号の取り違えは、依頼文と
    // これを並べて読まないと分からない
    return {
      tier: hit.tier,
      via: hit.via,
      tag: hit.el.tagName,
      text: (hit.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      bbox: docRect(hit.el),
    };
  },
  collectLocator,
};
