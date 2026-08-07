// ウィジェットのビルド。widget/src/*.ts → public/w.js（単一ファイル・外部依存なし）
import { build, context } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'widget/src/index.ts');
const outfile = join(root, 'public/w.js');
const watch = process.argv.includes('--watch');

// 13.1 の予算。超えたらビルドを失敗させる。
const GZIP_BUDGET = 20 * 1024;

/*
 * どのビルドが動いているかの目印。
 *
 * w.js はブラウザに5分キャッシュされ、開きっぱなしのタブはもっと長く
 * 古いままになる。「入れたはずの機能が出ない」と言われたときに、
 * **古い w.js を掴んでいるのか、実装が悪いのか**を切り分けられないと、
 * 毎回コードを疑うところから始まる（実測で2回やった）。
 *
 * ソースの中身から作るので、内容が変わらなければ同じ値になる。
 *   curl -s https://…/w.js | head -c 60   ← 配信されているもの
 *   ホスト要素の data-nq-build             ← ブラウザが動かしているもの
 * この2つを比べれば、キャッシュかどうかが即分かる。
 */
function buildStamp() {
  const h = createHash('sha256');
  for (const f of readdirSync(join(root, 'widget/src')).sort()) {
    // 行末は正規化する。Windows の作業コピーは CRLF、Vercel の checkout は
    // LF なので、そのまま食わせると同じソースでも値が変わる（実測）
    const src = readFileSync(join(root, 'widget/src', f), 'utf8').replace(/\r\n/g, '\n');
    h.update(f).update(src, 'utf8');
  }
  return h.digest('hex').slice(0, 8);
}
const STAMP = buildStamp();

const options = {
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'iife',
  target: ['es2019'],
  platform: 'browser',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  banner: { js: `/* Nortiq Revise widget build:${STAMP} */` },
  define: { __NQ_BUILD__: JSON.stringify(STAMP) },
  logLevel: 'info',
};

/**
 * textHash はウィジェットとサーバで完全に一致しなければならない（6.7）。
 * 片方だけ壊れても症状は「ロケータが黙って段2以降に落ちる」なので、
 * ビルド時に実際に突き合わせておく。
 */
async function verifySha1() {
  const tmp = join(root, 'node_modules/.cache/nq-sha1-check.cjs');
  mkdirSync(dirname(tmp), { recursive: true });
  await build({
    entryPoints: [join(root, 'widget/src/util.ts')],
    outfile: tmp,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: ['node20'],
    logLevel: 'silent',
  });
  const { sha1Hex } = await import('file://' + tmp.replace(/\\/g, '/'));
  const samples = [
    '',
    'a',
    '京都市中京区 マンション大規模修繕',
    '選ばれる3つの理由',
    randomBytes(64).toString('hex'),
    'x'.repeat(200),
  ];
  for (const s of samples) {
    const mine = sha1Hex(s);
    const node = createHash('sha1').update(s, 'utf8').digest('hex');
    if (mine !== node) {
      throw new Error(
        `SHA-1 の実装がサーバ側と一致しません。入力=${JSON.stringify(s.slice(0, 32))} ` +
          `widget=${mine} node=${node}`,
      );
    }
  }
  rmSync(tmp, { force: true });
  console.log('  sha1: widget と Node の実装が一致しました');
}

/**
 * リプレイ検証ハーネス（6.7）に渡す照合器。
 * ウィジェット本体と同じ locator.ts を束ねる。別実装にすると、
 * 測っているものが本番と違うものになる。
 */
async function buildReplayBundle() {
  const out = join(root, 'worker/vendor/locator-bundle.js');
  mkdirSync(dirname(out), { recursive: true });
  await build({
    entryPoints: [join(root, 'widget/src/replay-entry.ts')],
    outfile: out,
    bundle: true,
    format: 'iife',
    target: ['es2019'],
    platform: 'browser',
    minify: false,
    logLevel: 'silent',
  });
  console.log('  worker/vendor/locator-bundle.js を更新しました');
}

async function run() {
  mkdirSync(join(root, 'public'), { recursive: true });
  await verifySha1();
  await buildReplayBundle();

  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log('  watching widget/src …');
    return;
  }

  await build(options);
  const raw = readFileSync(outfile);
  const gz = gzipSync(raw);
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log(`  public/w.js  ${kb(raw.length)} (gzip ${kb(gz.length)})`);
  if (gz.length > GZIP_BUDGET) {
    console.error(
      `\n  ウィジェットが gzip ${kb(gz.length)} で予算 ${kb(GZIP_BUDGET)} を超えました（13.1）。`,
    );
    process.exit(1);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
