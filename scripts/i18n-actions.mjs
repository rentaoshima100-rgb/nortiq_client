/**
 * サーバーアクションが返すエラー文を t() に通す
 *
 * これらは画面にそのまま出るので、社内が EN にしていても日本語のまま
 * 出ていた。アクションはサーバー側なので getT() を直接呼べる。
 * getT() の宣言は手で足す（関数がどこで始まるかは機械では読み違える）。
 *
 *   node scripts/i18n-actions.mjs <file...>
 */
import fs from 'node:fs';

const JA = /[぀-ヿ一-龯]/;

for (const f of process.argv.slice(2)) {
  const before = fs.readFileSync(f, 'utf8');
  const after = before.replace(/\{ error: '((?:[^'\\]|\\.)*)' \}/g, (m, ja) =>
    JA.test(ja) ? `{ error: t('${ja}') }` : m,
  );
  if (after === before) continue;
  fs.writeFileSync(f, after, 'utf8');
  console.log('  包んだ:', f);
}
