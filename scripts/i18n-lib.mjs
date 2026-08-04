/**
 * lib 側の「社内が読む文」を t() に通す
 *
 * 対象は message / detail だけ。**プロンプト本文と facts は触らない**
 * （対象が日本語のサイトなので、そこを訳すと当たらなくなる）。
 *
 *   node scripts/i18n-lib.mjs <file...>
 *
 * テンプレート文字列は `${x}` を `{x}` の鍵に直し、第2引数に値を渡す形にする。
 * 式が入れ子になっているものは機械では直せないので、印だけ付けて手で直す。
 */
import fs from 'node:fs';

const JA = /[぀-ヿ一-龯]/;

/** `${expr}` を {k1} に置き換え、[鍵, 値の並び] を返す */
function toKey(tpl) {
  const vars = [];
  let i = 0;
  const key = tpl.replace(/\$\{([^{}]*)\}/g, (_, expr) => {
    const name = `v${++i}`;
    vars.push([name, expr.trim()]);
    return `{${name}}`;
  });
  if (/\$\{/.test(key)) return null; // 入れ子。手で直す
  return { key, vars };
}

function wrap(m, quote, body) {
  if (!JA.test(body)) return m;
  if (quote !== '`') return `t('${body.replace(/'/g, "\\'")}')`;
  const r = toKey(body);
  if (!r) return m;
  if (!r.vars.length) return `t('${r.key.replace(/'/g, "\\'")}')`;
  const args = r.vars.map(([n, e]) => `${n}: ${e}`).join(', ');
  return `t('${r.key.replace(/'/g, "\\'")}', { ${args} })`;
}

for (const f of process.argv.slice(2)) {
  const before = fs.readFileSync(f, 'utf8');
  let n = 0;
  const after = before.replace(
    /\b(message|detail):\s*(['`])((?:[^'`\\]|\\.)*?)\2/g,
    (m, field, q, body) => {
      const out = wrap(m.slice(m.indexOf(q)), q, body);
      if (out === m.slice(m.indexOf(q))) return m;
      n++;
      return `${field}: ${out}`;
    },
  );
  if (!n) continue;
  fs.writeFileSync(f, after, 'utf8');
  console.log(`  ${String(n).padStart(3)} 箇所  ${f}`);
}
