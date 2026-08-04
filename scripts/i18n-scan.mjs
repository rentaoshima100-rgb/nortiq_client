/**
 * t() の外に残っている日本語を出す
 *
 *   node scripts/i18n-scan.mjs [dir...]
 *
 * 既定は社内画面（src/app/admin, src/app/login）。
 * コメントと t('…') の中身は除く。
 */
import fs from 'node:fs';
import path from 'node:path';

const JA = /[぀-ヿ一-龯]/;

function walk(d) {
  return fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}

const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const roots = dirs.length ? dirs : ['src/app/admin', 'src/app/login'];
const files = roots.flatMap(walk).filter((f) => /\.(tsx?|mts)$/.test(f));

const rows = [];
let block = false;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (block) {
      if (l.includes('*/')) block = false;
      return;
    }
    if (/^\s*\/\*/.test(l) && !l.includes('*/')) {
      block = true;
      return;
    }
    if (!JA.test(l)) return;
    const s = l
      // t('…') も t('…', {n}) も鍵の部分だけ消す
      .replace(/\bt\((['"])(?:[^'"\\]|\\.)*?\1/g, '')
      .replace(/\/\/.*$/, '')
      .replace(/^\s*\*.*$/, '');
    if (JA.test(s)) rows.push(`${f}:${i + 1}  ${l.trim().slice(0, 100)}`);
  });
}

console.log(rows.join('\n'));
console.error(`\n${rows.length} 行`);
