/**
 * t() で包まれている日本語を集めて、辞書の抜けを出す
 *
 *   node scripts/i18n-keys.mjs          抜けている鍵を一覧
 *   node scripts/i18n-keys.mjs --all    全部の鍵を一覧
 *
 * 訳が抜けていても画面は壊れない（日本語のまま出る）ので、
 * 気づかないまま残りやすい。ここで機械的に出す。
 */
import fs from 'node:fs';
import path from 'node:path';

function walk(d) {
  return fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}

const RE = /\bt\((['"])((?:[^'"\\]|\\.)*?)\1\)/g;
const files = [...walk('src/app/admin'), ...walk('src/app/login')].filter((f) =>
  f.endsWith('.tsx'),
);

const keys = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = RE.exec(s))) keys.add(m[2].replace(/\\'/g, "'"));
}

const all = process.argv.includes('--all');
const dictSrc = fs.readFileSync('src/lib/i18n-dict.ts', 'utf8');
// 辞書の鍵は引用符付きとは限らない。日本語はそのまま識別子として書ける
const have = new Set([
  ...[...dictSrc.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)].map((m) => m[1].replace(/\\'/g, "'")),
  ...[...dictSrc.matchAll(/^\s{2}([^\s'"/{}][^:\n]*?):/gm)].map((m) => m[1].trim()),
]);

const list = [...keys].filter((k) => all || !have.has(k)).sort();
for (const k of list) console.log(JSON.stringify(k));
console.error(`\n鍵 ${keys.size} 種類 / 訳あり ${have.size} / ${all ? '全部' : '未訳'} ${list.length}`);
