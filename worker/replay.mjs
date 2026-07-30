#!/usr/bin/env node
/**
 * リプレイ検証ハーネス（設計 6.7 / Phase 1 の成果物）
 *
 *   node replay.mjs --project loop-2026
 *   node replay.mjs --project loop-2026 --url https://別のビルド.vercel.app
 *
 * 保存済みロケータを、後のビルドの DOM に当て直して、段1〜4のどこに落ちるかを
 * 実測する。閾値の議論はこの実データを得てから行う（設計 15.3-⑦）。
 *
 * 照合器はウィジェット本体と同じ locator.ts を束ねたものを注入する。
 * 別実装で測ると、測っているものが本番と違うものになる。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { launch } from './capture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};

const projectKey = opt('project');
if (!projectKey) {
  console.error('--project <snippet_key> が必要です');
  process.exit(1);
}
const overrideUrl = opt('url');
const viewport = Number(opt('viewport', '1440'));

function loadEnv() {
  const p = join(here, '../.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
  }
}
loadEnv();

const bundlePath = join(here, 'vendor/locator-bundle.js');
if (!existsSync(bundlePath)) {
  console.error('worker/vendor/locator-bundle.js がありません。まず npm run widget:build を実行してください。');
  process.exit(1);
}
const bundle = readFileSync(bundlePath, 'utf8');

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const { rows: projects } = await db.query(
  'select id, name, site_url from projects where snippet_key = $1',
  [projectKey],
);
if (!projects.length) {
  console.error(`案件 ${projectKey} が見つかりません`);
  process.exit(1);
}
const project = projects[0];
const baseUrl = overrideUrl ?? project.site_url;

const { rows: requests } = await db.query(
  `select id, seq, page_path, locator, viewport_w, created_at
   from requests where project_id = $1 order by seq`,
  [project.id],
);
await db.end();

if (!requests.length) {
  console.log('依頼がありません。');
  process.exit(0);
}

console.log(`  案件: ${project.name}`);
console.log(`  対象: ${baseUrl}（ビューポート ${viewport}px）`);
console.log(`  依頼: ${requests.length} 件\n`);

const byPage = new Map();
for (const r of requests) {
  if (!byPage.has(r.page_path)) byPage.set(r.page_path, []);
  byPage.get(r.page_path).push(r);
}

const browser = await launch();
const tally = { confirmed: 0, provisional: 0, weak: 0, stale: 0 };
const rows = [];

try {
  for (const [pagePath, reqs] of byPage) {
    const url = baseUrl.replace(/\/+$/, '') + (pagePath === '/' ? '/' : pagePath);
    const ctx = await browser.newContext({
      viewport: { width: viewport, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      timezoneId: 'Asia/Tokyo',
      locale: 'ja-JP',
    });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      // 遅延読み込みを起こしてから測る（実際のピン描画と同じ条件にする）
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

      for (const r of reqs) {
        const hit = await page.evaluate(
          (loc) => window.__nqReplay.findByLocator(loc),
          r.locator,
        );
        const tier = hit ? hit.tier : 'stale';
        tally[tier] = (tally[tier] ?? 0) + 1;

        // 元の bbox とどれくらいズレたか（誤マッチの検出に使う）
        let drift = null;
        if (hit && r.locator?.bbox) {
          drift = {
            dx: hit.bbox.x - r.locator.bbox.x,
            dy: hit.bbox.y - r.locator.bbox.y,
            dw: hit.bbox.w - r.locator.bbox.w,
          };
        }
        rows.push({
          seq: r.seq,
          page: pagePath,
          tag: r.locator?.tag,
          nqId: r.locator?.nqId ?? '—',
          nqCount: r.locator?.nqCount ?? '—',
          tier,
          hitTag: hit?.tag ?? '—',
          drift: drift ? `${drift.dx >= 0 ? '+' : ''}${drift.dx},${drift.dy >= 0 ? '+' : ''}${drift.dy}` : '—',
        });
      }
    } catch (e) {
      console.error(`  ${url} を開けませんでした: ${e.message}`);
      for (const r of reqs) {
        tally.stale++;
        rows.push({ seq: r.seq, page: pagePath, tag: r.locator?.tag, nqId: '—', nqCount: '—', tier: 'stale', hitTag: '—', drift: '—' });
      }
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

console.table(rows);

const total = requests.length;
const pct = (n) => ((n / total) * 100).toFixed(0) + '%';
console.log('\n  ── 段の分布（6.7）──────────────────────');
console.log(`   段1 confirmed   : ${tally.confirmed}  (${pct(tally.confirmed)})`);
console.log(`   段2 provisional : ${tally.provisional}  (${pct(tally.provisional)})`);
console.log(`   段3 weak        : ${tally.weak}  (${pct(tally.weak)})`);
console.log(`   段4 stale       : ${tally.stale}  (${pct(tally.stale)})`);
console.log('\n  段4 に落ちてもピンが出ないだけで、依頼内容と切り出し画像は残る。');
console.log('  問題になるのは「confirmed のまま別の要素にマッチする」誤りなので、');
console.log('  drift（元の bbox からのズレ）が大きい confirmed を疑うこと。');
