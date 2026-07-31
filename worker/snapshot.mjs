#!/usr/bin/env node
/**
 * スナップショットの撮影と保存（設計 7.1 / 7.7）
 *
 *   node snapshot.mjs --project loop-2026 --phase initial
 *   node snapshot.mjs --project loop-2026 --phase before --round <round_id>
 *   node snapshot.mjs --project loop-2026 --phase after --url <不変デプロイURL> --sha <commit>
 *
 * ピンごとの before/after は撮らない。全体撮影から切り出す（7.1）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { capturePage, launch, VIEWPORTS, DEFAULT_MASKS } from './capture.mjs';
import { loadEnv, supa, supaKey, supaUrl } from './supabase.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};

const projectKey = opt('project');
const phase = opt('phase', 'initial');
if (!projectKey) {
  console.error('--project <snippet_key> が必要です');
  process.exit(1);
}
if (!['initial', 'before', 'preview', 'after'].includes(phase)) {
  console.error('--phase は initial / before / preview / after のいずれか');
  process.exit(1);
}

loadEnv();
const db = supa();
const BUCKET = 'nq-snapshots';
const DSF = 2;
const CROP_PAD = 24; // CSS px

const bundlePath = join(here, 'vendor/locator-bundle.js');
if (!existsSync(bundlePath)) {
  console.error('worker/vendor/locator-bundle.js がありません。npm run widget:build を実行してください。');
  process.exit(1);
}
const locatorBundle = readFileSync(bundlePath, 'utf8');

const [project] = await db.select(
  'projects',
  `snippet_key=eq.${encodeURIComponent(projectKey)}&select=id,name,site_url,preview_bypass_secret`,
);
if (!project) {
  console.error(`案件 ${projectKey} が見つかりません`);
  process.exit(1);
}

const baseUrl = (opt('url') ?? project.site_url).replace(/\/+$/, '');
const roundId = opt('round');
const commitSha = opt('sha');

const pageRows = await db.select(
  'project_pages',
  `project_id=eq.${project.id}&capture=is.true&select=path,mask_selectors`,
);
const pages = pageRows.length
  ? pageRows.map((p) => ({ path: p.path, masks: [...DEFAULT_MASKS, ...(p.mask_selectors ?? [])] }))
  : [{ path: '/', masks: DEFAULT_MASKS }];

const requests = await db.select(
  'requests',
  `project_id=eq.${project.id}&select=id,seq,page_path,locator,viewport_w&order=seq`,
);

console.log(`  案件: ${project.name}`);
console.log(`  対象: ${baseUrl} / phase=${phase} / ${pages.length}ページ × ${VIEWPORTS.length}幅`);
console.log(`  依頼: ${requests.length} 件を切り出す\n`);

const snapshot = await db.insert('snapshots', {
  project_id: project.id,
  round_id: roundId,
  phase,
  commit_sha: commitSha,
  deploy_url: baseUrl,
  status: 'running',
});

const slug = (p) => (p === '/' ? 'index' : p.replace(/^\//, '').replace(/[^\w.-]/g, '_'));

/** 依頼をどの幅で切り出すか。指摘時の幅に一番近いものを選ぶ。 */
function viewportFor(req) {
  return VIEWPORTS.reduce((best, v) =>
    Math.abs(v - (req.viewport_w ?? 1440)) < Math.abs(best - (req.viewport_w ?? 1440)) ? v : best,
  );
}

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.log(`    ${label} に失敗（${attempt}/3）: ${e.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

const browser = await launch();
let shots = 0;
let crops = 0;
const tierTally = { confirmed: 0, provisional: 0, weak: 0, stale: 0 };

try {
  for (const page of pages) {
    const url = baseUrl + (page.path === '/' ? '/' : page.path);
    const onThisPage = requests.filter((r) => r.page_path === page.path);

    for (const vw of VIEWPORTS) {
      const toMatch = onThisPage
        .filter((r) => viewportFor(r) === vw)
        .map((r) => ({ id: r.id, locator: r.locator }));

      process.stdout.write(`  ${page.path} @ ${vw}px … `);
      const cap = await withRetry(
        () =>
          capturePage(browser, url, vw, {
            masks: page.masks,
            match: toMatch,
            locatorBundle,
            bypassSecret: project.preview_bypass_secret ?? undefined,
          }),
        `${page.path} @ ${vw}px`,
      );
      console.log(`${cap.layoutMap.length}要素 / 高さ${cap.docHeight}px`);

      const base = `${project.id}/${snapshot.id}/${slug(page.path)}-${vw}`;

      // レイアウトマップは jsonb ではなく Storage に置く（7.4）
      const mapPath = `${base}.map.json`;
      await db.upload(BUCKET, mapPath, JSON.stringify(cap.layoutMap), 'application/json');

      // 画像。長いページはタイル分割（13.2）
      const meta = await sharp(cap.png).metadata();
      const tiles = [];
      const TILE_H = 8000;
      if (meta.height <= 16383) {
        const buf = await sharp(cap.png).webp({ quality: 80 }).toBuffer();
        const p = `${base}.webp`;
        await db.upload(BUCKET, p, buf, 'image/webp');
        tiles.push({ path: p, y: 0, h: meta.height });
      } else {
        for (let y = 0, i = 0; y < meta.height; y += TILE_H, i++) {
          const h = Math.min(TILE_H, meta.height - y);
          const buf = await sharp(cap.png)
            .extract({ left: 0, top: y, width: meta.width, height: h })
            .webp({ quality: 80 })
            .toBuffer();
          const p = `${base}.t${String(i).padStart(2, '0')}.webp`;
          await db.upload(BUCKET, p, buf, 'image/webp');
          tiles.push({ path: p, y, h });
        }
      }

      await db.upsert(
        'snapshot_shots',
        {
          snapshot_id: snapshot.id,
          page_path: page.path,
          viewport_w: vw,
          storage_path: tiles[0].path,
          width: meta.width,
          height: meta.height,
          layout_map_path: mapPath,
          tiles,
        },
        'snapshot_id,page_path,viewport_w',
      );
      shots++;
      console.log(`    → ${tiles.length === 1 ? '1枚' : tiles.length + 'タイル'} / マップ保存`);

      // ピン座標からの切り出し（7.1）
      for (const m of cap.matches) {
        tierTally[m.tier] = (tierTally[m.tier] ?? 0) + 1;
        if (!m.bbox) continue; // stale は切り出さない
        const left = Math.max(0, Math.round((m.bbox.x - CROP_PAD) * DSF));
        const top = Math.max(0, Math.round((m.bbox.y - CROP_PAD) * DSF));
        const width = Math.min(meta.width - left, Math.round((m.bbox.w + CROP_PAD * 2) * DSF));
        const height = Math.min(meta.height - top, Math.round((m.bbox.h + CROP_PAD * 2) * DSF));
        if (width < 8 || height < 8) continue;

        const buf = await sharp(cap.png)
          .extract({ left, top, width, height })
          .webp({ quality: 82 })
          .toBuffer();
        const cropPath = `${project.id}/${snapshot.id}/crop-${m.id}.webp`;
        await db.upload(BUCKET, cropPath, buf, 'image/webp');

        await db.upsert(
          'request_shots',
          {
            request_id: m.id,
            snapshot_id: snapshot.id,
            bbox: m.bbox,
            match_tier: m.tier,
            crop_path: cropPath,
            viewport_w: vw,
          },
          'request_id,snapshot_id',
        );
        crops++;
      }
      if (cap.matches.length) {
        console.log(`    → 切り出し ${cap.matches.filter((m) => m.bbox).length}/${cap.matches.length} 件`);
      }
    }
  }

  await db.update('snapshots', `id=eq.${snapshot.id}`, { status: 'ready' });
  console.log(`\n  完了: ショット ${shots} 件 / 切り出し ${crops} 件`);
  console.log(
    `  段の分布: confirmed ${tierTally.confirmed} / provisional ${tierTally.provisional} / weak ${tierTally.weak} / stale ${tierTally.stale}`,
  );
  console.log(`  snapshot_id = ${snapshot.id}`);
} catch (e) {
  // 部分成功のスナップショットを比較に使わない（7.7）
  await db.update('snapshots', `id=eq.${snapshot.id}`, {
    status: 'failed',
    error: String(e.message).slice(0, 500),
  });
  console.error(`\n  撮影に失敗しました: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
