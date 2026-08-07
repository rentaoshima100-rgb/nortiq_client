/**
 * 差し替え先の引き当てを試す
 *
 *   node scripts/test-asset-path.mjs
 *
 * ここが素材差し替えの全部（LLM を使わない）なので、
 * 「当てる」より「**取り違えない**」ことを確かめる。
 */
import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, 'node_modules/.cache/nq-asset-path.mjs');
mkdirSync(dirname(tmp), { recursive: true });
await build({
  entryPoints: [join(root, 'src/lib/asset-path.ts')],
  outfile: tmp,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { resolveRepoPath, urlToPath } = await import('file://' + tmp.replace(/\\/g, '/'));

// 実際にありそうな3つの形
const STATIC = ['index.html', 'styles.css', 'images/ceo.jpg', 'images/hero.png', 'app.jsx'];
const NEXTJS = [
  'app/page.tsx',
  'public/images/ceo.jpg',
  'public/logo.svg',
  'src/assets/ceo.jpg', // ← 同名が別の場所にもある
];
const DEEP = ['public/img/team/ceo.jpg', 'public/img/news/ceo.jpg'];

const cases = [
  // [名前, src, ファイル一覧, 期待するパス（null = 決めないのが正解）]
  ['静的サイト・そのまま', '/images/ceo.jpg', STATIC, 'images/ceo.jpg'],
  ['静的サイト・相対', 'images/ceo.jpg', STATIC, 'images/ceo.jpg'],
  ['静的サイト・./ 付き', './images/ceo.jpg', STATIC, 'images/ceo.jpg'],
  ['クエリ付き', '/images/ceo.jpg?v=3', STATIC, 'images/ceo.jpg'],
  ['絶対 URL', 'https://asiakumiai.com/images/ceo.jpg', STATIC, 'images/ceo.jpg'],
  ['プロトコル相対', '//asiakumiai.com/images/ceo.jpg', STATIC, 'images/ceo.jpg'],
  ['Next.js の public/', '/images/ceo.jpg', NEXTJS, 'public/images/ceo.jpg'],
  ['同名が2か所（決めない）', '/img/ceo.jpg', DEEP, null],
  ['リポジトリに無い', '/images/nope.jpg', STATIC, null],
  ['data: URL', 'data:image/png;base64,iVBORw0KGgo=', STATIC, null],
  ['srcset が来た', '/images/ceo.jpg 1x, /images/ceo@2x.jpg 2x', STATIC, 'images/ceo.jpg'],
  ['SVG は対象外', '/logo.svg', NEXTJS, null],
  ['src が空', '', STATIC, null],
  ['ディレクトリ', '/images/', STATIC, null],
];

let ng = 0;
for (const [name, src, paths, want] of cases) {
  const got = resolveRepoPath(src, paths);
  const ok = got.file === want;
  if (!ok) ng++;
  console.log(
    `${ok ? '  ok  ' : '  NG  '}${name.padEnd(22)} → ${String(got.file)}` +
      `${ok ? '' : `  （期待: ${String(want)}）`}` +
      `${got.file ? `  [${got.how}]` : got.candidates.length ? `  候補 ${got.candidates.length}` : ''}`,
  );
}

// urlToPath 単体
for (const [src, want] of [
  ['/a/b.png', 'a/b.png'],
  ['../a/b.png', 'a/b.png'],
  ['/%E7%94%BB%E5%83%8F/a.png', '画像/a.png'],
  ['blob:https://x/y', null],
]) {
  const got = urlToPath(src);
  const ok = got === want;
  if (!ok) ng++;
  console.log(`${ok ? '  ok  ' : '  NG  '}urlToPath ${src} → ${String(got)}`);
}

rmSync(tmp, { force: true });
console.log(ng ? `\n  ${ng} 件ちがいます` : '\n  全部通りました');
process.exit(ng ? 1 : 0);
