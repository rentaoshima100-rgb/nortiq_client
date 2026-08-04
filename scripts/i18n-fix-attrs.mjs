/**
 * JSX の属性値は {t('…')} でないといけない
 *
 *   placeholder=t("…")   ← 壊れる
 *   placeholder={t("…")} ← 正しい
 *
 * i18n-wrap.mjs の後始末。属性かどうかは = の直前が属性名かで見る。
 */
import fs from 'node:fs';
import path from 'node:path';

function walk(d) {
  return fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}

const files = [...walk('src/app/admin'), ...walk('src/app/login')].filter((f) =>
  f.endsWith('.tsx'),
);

const RE = /(\s[A-Za-z][\w-]*)=t\((['"])((?:[^'"\\]|\\.)*?)\2\)/g;

let total = 0;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  let n = 0;
  const out = s.replace(RE, (_m, attr, q, body) => {
    n++;
    return `${attr}={t(${q}${body}${q})}`;
  });
  if (n) {
    fs.writeFileSync(f, out, 'utf8');
    console.log(`  ${String(n).padStart(3)} 箇所  ${f}`);
    total += n;
  }
}
console.log(`\n合計 ${total} 箇所`);
