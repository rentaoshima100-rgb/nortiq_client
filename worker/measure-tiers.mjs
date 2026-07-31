#!/usr/bin/env node
/**
 * ロケータの段の分布を測る（設計 6.7 / 15.3-⑦）
 *
 *   node measure-tiers.mjs --url https://example.com [--viewport 1440]
 *
 * replay.mjs が「保存済みの依頼」を測るのに対し、こちらは
 * 「いまこのページで指摘したら、どの段に落ちるか」を測る。
 * 注入を入れる前後で比べると、効果が数字で出る。
 *
 * 閾値の議論はこの実データを得てから行う。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './capture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};

const url = opt('url');
if (!url) {
  console.error('--url が必要です');
  process.exit(1);
}
const viewport = Number(opt('viewport', '1440'));
// 注入前の状態を同じページで再現する（A/B 比較用）
const ignoreNqId = args.includes('--ignore-nqid');

const bundlePath = join(here, 'vendor/locator-bundle.js');
if (!existsSync(bundlePath)) {
  console.error('worker/vendor/locator-bundle.js がありません。npm run widget:build を実行してください。');
  process.exit(1);
}
const bundle = readFileSync(bundlePath, 'utf8');

const browser = await launch();
try {
  const ctx = await browser.newContext({
    viewport: { width: viewport, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    timezoneId: 'Asia/Tokyo',
    locale: 'ja-JP',
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });

  // ブラウザ側で JSX をコンパイルして描画するサイト（設計 2.1 の
  // 「単一 index.html」）があるので、中身が入るまで待つ
  await page
    .waitForFunction(() => document.body && document.body.querySelectorAll('*').length > 50, {
      timeout: 20000,
    })
    .catch(() => {});

  await page.evaluate(async () => {
    const step = 600;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
    window.scrollTo(0, 0);
  });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: bundle });

  const result = await page.evaluate((ignoreNqId) => {
    // ウィジェットが選択対象にする要素（6.3 / 6.6 と同じ考え方）
    const DENY = new Set(['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'BR']);
    const vpArea = window.innerWidth * window.innerHeight;
    const candidates = [];
    for (const el of document.querySelectorAll('body *')) {
      if (DENY.has(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.width * r.height > vpArea * 0.9) continue;
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.nodeValue)
        .join('')
        .trim();
      const media = ['IMG', 'PICTURE', 'SVG', 'VIDEO'].includes(el.tagName);
      if (!ownText && !media && !el.hasAttribute('data-nq-id')) continue;
      candidates.push(el);
    }

    const tiers = { confirmed: 0, provisional: 0, weak: 0, stale: 0 };
    const wrong = [];
    const byTag = {};
    let withId = 0;

    for (const el of candidates) {
      const loc = window.__nqReplay.collectLocator(el);
      if (ignoreNqId) { loc.nqId = null; loc.nqOrdinal = null; loc.nqCount = null; }
      if (loc.nqId) withId++;
      const hit = window.__nqReplay.findByLocator(loc);
      const tier = hit ? hit.tier : 'stale';
      tiers[tier]++;
      byTag[el.tagName] = byTag[el.tagName] || { confirmed: 0, provisional: 0, weak: 0, stale: 0 };
      byTag[el.tagName][tier]++;

      // 採取した直後に当て直しているので、別の要素を掴んだら誤りである。
      // 「confirmed のまま別の要素にマッチする」のが最も害の大きい失敗（6.7）。
      if (hit && hit.bbox) {
        const drift = Math.abs(hit.bbox.x - loc.bbox.x) + Math.abs(hit.bbox.y - loc.bbox.y);
        if (drift > 2) wrong.push({ tag: el.tagName, tier, drift, nqId: loc.nqId, text: loc.textSample.slice(0, 30) });
      }
    }

    const idEls = document.querySelectorAll('[data-nq-id]');
    const idCounts = {};
    for (const e of idEls) {
      const k = e.getAttribute('data-nq-id');
      idCounts[k] = (idCounts[k] || 0) + 1;
    }
    const dupIds = Object.entries(idCounts).filter(([, n]) => n > 1);

    return {
      total: candidates.length,
      withId,
      tiers,
      byTag,
      wrong: wrong.slice(0, 15),
      wrongCount: wrong.length,
      idElements: idEls.length,
      distinctIds: Object.keys(idCounts).length,
      duplicated: dupIds.length,
      worstDup: dupIds.sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }, ignoreNqId);

  await ctx.close();

  const pct = (n) => ((n / Math.max(1, result.total)) * 100).toFixed(0) + '%';
  console.log(`  ${url}（${viewport}px）\n`);
  console.log(`  data-nq-id を持つ要素: ${result.idElements}（distinct ${result.distinctIds}）`);
  console.log(`  うち重複する id: ${result.duplicated} 件` +
    (result.worstDup.length ? '（最多 ' + result.worstDup.map(([k, n]) => `${k}×${n}`).join(', ') + '）' : ''));
  console.log(`\n  指摘の対象になりうる要素: ${result.total}（うち nq-id あり ${result.withId}）\n`);
  console.log('  ── 段の分布（6.7）──────────────────────');
  console.log(`   段1 confirmed   : ${result.tiers.confirmed}  (${pct(result.tiers.confirmed)})`);
  console.log(`   段2 provisional : ${result.tiers.provisional}  (${pct(result.tiers.provisional)})`);
  console.log(`   段3 weak        : ${result.tiers.weak}  (${pct(result.tiers.weak)})`);
  console.log(`   段4 stale       : ${result.tiers.stale}  (${pct(result.tiers.stale)})`);

  console.log(`\n  採取直後に別の要素を掴んだもの: ${result.wrongCount} 件`);
  if (result.wrongCount) {
    console.log('  （採取した直後なので、ズレがあれば誤マッチ。confirmed のものは特に危険）');
    for (const w of result.wrong) {
      console.log(`   - ${w.tag} [${w.tier}] drift ${w.drift}px  ${w.nqId ?? '—'}  ${JSON.stringify(w.text)}`);
    }
  }

  console.log('\n  ── タグ別（上位）──────────────────────');
  const rows = Object.entries(result.byTag)
    .map(([tag, t]) => ({ tag, ...t, total: t.confirmed + t.provisional + t.weak + t.stale }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  console.table(rows);
} finally {
  await browser.close();
}
