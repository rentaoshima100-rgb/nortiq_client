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
      findByLocator(loc: Locator): { tier: string; tag: string; bbox: ReturnType<typeof docRect> } | null;
      collectLocator(el: Element): Locator;
    };
  }
}

window.__nqReplay = {
  findByLocator(loc: Locator) {
    const hit = findByLocator(loc);
    if (!hit) return null;
    return { tier: hit.tier, tag: hit.el.tagName, bbox: docRect(hit.el) };
  },
  collectLocator,
};
