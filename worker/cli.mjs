#!/usr/bin/env node
/**
 * 撮影パイプラインの手元実行。
 *
 *   node cli.mjs --url https://example.com --out ./shots
 *   node cli.mjs --url https://example.com --twice     ← Phase 1 の完了条件の検査
 *
 * --twice は同じページを2回撮って changed 差分が 0 件かを見る。
 * 1件でも出るなら、撮影条件（7.2）にまだ非決定性が残っている。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { capturePage, launch, VIEWPORTS, DEFAULT_MASKS } from './capture.mjs';
import { classify } from '../src/lib/layout-diff.mjs';
import { saveShot } from './save.mjs';

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const flag = (n) => args.includes('--' + n);

const url = opt('url');
if (!url) {
  console.error('--url が必要です');
  process.exit(1);
}
const outDir = opt('out', './shots');
const twice = flag('twice');
const widths = opt('widths')
  ? opt('widths').split(',').map(Number)
  : twice
    ? [1440]
    : VIEWPORTS;

const browser = await launch();
mkdirSync(outDir, { recursive: true });

try {
  for (const w of widths) {
    process.stdout.write(`  ${w}px を撮影中 … `);
    const t0 = Date.now();
    const first = await capturePage(browser, url, w, { masks: DEFAULT_MASKS });
    console.log(
      `${first.layoutMap.length} 要素 / 高さ ${first.docHeight}px / ${Date.now() - t0}ms`,
    );

    // レイアウトマップを先に保存する（画像の保存で失敗しても判定材料は残す）
    writeFileSync(
      join(outDir, `map-${w}.json`),
      JSON.stringify(first.layoutMap, null, twice ? 1 : 0),
    );

    // PNG → WebP（7.7）。長いページはタイル分割（13.2）
    const saved = await saveShot(first.png, outDir, `shot-${w}`);
    const kb = saved.files.reduce((s, f) => s + f.bytes, 0) / 1024;
    console.log(
      `    → ${saved.tiled ? `${saved.files.length} タイル` : '1枚'} ` +
        `${saved.width}×${saved.height}px 実寸 / ${kb.toFixed(0)}KB / map-${w}.json`,
    );

    if (twice) {
      process.stdout.write(`  ${w}px を2回目 … `);
      const second = await capturePage(browser, url, w, { masks: DEFAULT_MASKS });
      console.log(`${second.layoutMap.length} 要素`);

      const { diffs, movedCount, pairCount } = classify(first.layoutMap, second.layoutMap);
      const changed = diffs.filter((d) => d.kind === 'changed');
      const added = diffs.filter((d) => d.kind === 'added');
      const removed = diffs.filter((d) => d.kind === 'removed');

      console.log('');
      console.log('  ── 決定性の検査（Phase 1 の完了条件）──────────────');
      console.log(`   対応付いた要素: ${pairCount}`);
      console.log(`   changed : ${changed.length}   ← 0 でなければ非決定性が残っている`);
      console.log(`   added   : ${added.length}`);
      console.log(`   removed : ${removed.length}`);
      console.log(`   moved   : ${movedCount}（無視する分類）`);

      if (changed.length) {
        console.log('');
        console.log('  変化した中身（先頭10件）:');
        for (const d of changed.slice(0, 10)) {
          console.log(
            `   - ${d.tag} [${d.changeFields.join(',')}] ${JSON.stringify(d.elementKey).slice(0, 60)}`,
          );
          for (const f of d.changeFields) {
            if (f === 'text') {
              console.log(`       text: ${JSON.stringify(d.before.text)} → ${JSON.stringify(d.after.text)}`);
            } else if (f === 'src') {
              console.log(`       src : ${d.before.src} → ${d.after.src}`);
            } else if (f === 'size') {
              console.log(
                `       size: ${d.before.bbox.w}×${d.before.bbox.h} → ${d.after.bbox.w}×${d.after.bbox.h}`,
              );
            } else if (f === 'style') {
              console.log(
                `       style: ${JSON.stringify(d.before.style)} → ${JSON.stringify(d.after.style)}`,
              );
            }
          }
        }
      }
      writeFileSync(join(outDir, `determinism-${w}.json`), JSON.stringify(diffs, null, 1));
    }
  }
} finally {
  await browser.close();
}
