// ウィジェットのビルド。widget/src/*.ts → public/w.js（単一ファイル・外部依存なし）
import { build, context } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'widget/src/index.ts');
const outfile = join(root, 'public/w.js');
const watch = process.argv.includes('--watch');

// 13.1 の予算。超えたらビルドを失敗させる。
const GZIP_BUDGET = 20 * 1024;

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
  banner: { js: '/* Nortiq Revise widget */' },
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

async function run() {
  mkdirSync(join(root, 'public'), { recursive: true });
  await verifySha1();

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
