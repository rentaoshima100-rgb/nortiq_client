/**
 * 社内向け API ルートのエラー文を t() に通す
 *
 * これらは fetch した側がそのまま画面に出す。ここが日本語のままだと
 * EN に切り替えてもエラーだけ日本語で出る。
 *
 *   node scripts/i18n-routes.mjs <file...>
 *
 * `const t = await getT();` は各ハンドラの先頭に自動で入れる。
 * getT() は cookies() を読むだけなので、ハンドラの最初で呼んで問題ない。
 */
import fs from 'node:fs';

const JA = /[぀-ヿ一-龯]/;

for (const f of process.argv.slice(2)) {
  let s = fs.readFileSync(f, 'utf8');
  const before = s;

  s = s.replace(/error: '((?:[^'\\]|\\.)*)'/g, (m, ja) => (JA.test(ja) ? `error: t('${ja}')` : m));
  if (s === before) continue;

  if (!/from '@\/lib\/i18n'/.test(s)) {
    // import の並びの先頭に足す。順序は Prettier が直す
    s = s.replace(/^(import .*\n)/, `$1import { getT } from '@/lib/i18n';\n`);
  }

  // export async function GET/POST/... の本体の先頭に getT() を置く
  s = s.replace(
    /(export async function (?:GET|POST|PUT|PATCH|DELETE)\([^)]*\)(?::\s*[^{]+)?\{\n)/g,
    (m) => (m.includes('getT()') ? m : `${m}  const t = await getT();\n`),
  );

  fs.writeFileSync(f, s, 'utf8');
  console.log('  包んだ:', f);
}
