/**
 * 撮影とレイアウトマップ採取（設計 7.1〜7.4, 7.7）
 *
 * 非決定性が1つでも残ると、Phase 1 の完了条件（同一ページを2回撮って
 * changed 差分 0件）が満たせず、以降の巻き添え検出が全部ノイズになる。
 * ここの条件は削らないこと。
 */
import { chromium } from 'playwright';
import { collectLayoutMap } from './layout-map.mjs';

export const VIEWPORTS = [1440, 768, 390];

/** 撮るたびにピクセルが変わるもの（7.3）。日本の企業サイトは地図がほぼ必ず入る。 */
export const DEFAULT_MASKS = [
  'iframe[src*="google.com/maps"]',
  'iframe[src*="youtube.com"]',
  'iframe[src*="vimeo.com"]',
  'video',
  '.swiper-wrapper',
  '[data-nq-mask]',
];

const FIXED_EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0);

/** 7.2 の固定条件。ページ読み込み前に注入する。 */
const INIT_SCRIPT = `{
  const FIXED = ${FIXED_EPOCH};
  const D = Date;
  Date = class extends D {
    constructor(...a){ return a.length ? new D(...a) : new D(FIXED); }
    static now(){ return FIXED; }
  };
  let seed = 42;
  Math.random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  // --- rAF: 同期呼び出しは絶対にしない ---
  // tick(){ …; rAF(tick) } の形が世のアニメーションループの標準なので、
  // 同期で呼ぶと初回で無限再帰しスタックが溢れる。
  let vt = 0;
  performance.now = () => vt;
  let frozen = false;
  let nextId = 1;
  const pending = new Map();   // 配列の添字を id に使わないこと。
                               // ポンプは毎ティックでキューを空にするため、
                               // 前のティックの id が次では別のコールバックを指す。
                               // cancel → 再予約という debounce の常套手段が
                               // 無関係なコールバックを黙って殺す形で壊れる。

  window.requestAnimationFrame = (cb) => {
    if (frozen) return 0;
    if (pending.size > 10000) return 0;
    const id = nextId++;
    pending.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => { pending.delete(id); };

  window.__nqPump = (ticks) => {
    for (let i = 0; i < ticks; i++) {
      vt += 16.7;
      const batch = [...pending.values()];
      pending.clear();
      for (const cb of batch) { try { cb(vt); } catch (e) {} }
    }
    pending.clear(); frozen = true;
  };
}`;

const FREEZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    animation-duration: 0s !important;
    animation-play-state: paused !important;
    transition: none !important;
    transition-duration: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
  [style*="background-attachment: fixed"], .parallax {
    background-attachment: scroll !important;
  }
`;

export async function launch() {
  return chromium.launch({ args: ['--font-render-hinting=none'] });
}

/**
 * 1ページ・1ビューポートを撮る。
 * @returns {{ png: Buffer, layoutMap: any[], docHeight: number }}
 */
export async function capturePage(browser, url, viewportW, opts = {}) {
  const masks = opts.masks ?? DEFAULT_MASKS;
  const limit = opts.limit ?? 2000;

  const ctx = await browser.newContext({
    viewport: { width: viewportW, height: 900 },
    deviceScaleFactor: 2,
    // ヘッドレス Chromium は既定で reduce を返す。記録用途では上書きしない。
    reducedMotion: 'reduce',
    timezoneId: 'Asia/Tokyo',
    locale: 'ja-JP',
    // Vercel のプレビュー保護（7.5）。本番の不変デプロイURLでも要ることがある。
    extraHTTPHeaders: opts.bypassSecret
      ? {
          'x-vercel-protection-bypass': opts.bypassSecret,
          'x-vercel-set-bypass-cookie': 'true',
        }
      : undefined,
  });

  const page = await ctx.newPage();
  await page.addInitScript(INIT_SCRIPT);

  try {
    // networkidle は GTM 等で永遠に来ないことがある（Playwright 公式も非推奨）
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.addStyleTag({ content: FREEZE_CSS });

    // lazy load を発火させて先頭へ戻す
    await page.evaluate(async () => {
      const step = 400;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
      window.scrollTo(0, 0);
    });
    await page.evaluate(() =>
      Promise.all(
        Array.from(document.images)
          .filter((i) => !i.complete)
          .map((i) => new Promise((res) => { i.onload = i.onerror = res; })),
      ),
    );
    await page.evaluate(() => document.fonts.ready);

    // 初期化を進めてから凍結する（約1秒ぶんの仮想時間）
    await page.evaluate(() => window.__nqPump(60));
    await page.waitForTimeout(300);

    const docHeight = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    );

    // collectLayoutMap は外の変数を参照しない自己完結な関数なので、
    // Playwright が関数ソースごとページ側に渡せる
    const layoutMap = await page.evaluate(collectLayoutMap, [masks, limit]);

    const locators = masks.map((s) => page.locator(s));
    const png = await page.screenshot({
      fullPage: true,
      mask: locators,
      maskColor: '#FF00FF',
      animations: 'disabled',
    });

    return { png, layoutMap, docHeight };
  } finally {
    await ctx.close();
  }
}
