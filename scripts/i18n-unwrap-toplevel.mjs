/**
 * 関数の外にある t() を素の文字列に戻す
 *
 * モジュール直下の定数（STATUS_LABEL、CATEGORY_OPTIONS など）は
 * t が使えない。素の日本語に戻し、使う側で t() を通す。
 */
import fs from 'node:fs';

const RE = /\bt\((['"])((?:[^'"\\]|\\.)*?)\1\)/g;

let total = 0;
for (const f of process.argv.slice(2)) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  let depth = 0;
  let n = 0;
  const out = lines.map((l) => {
    const before = depth;
    depth += (l.match(/\{/g) ?? []).length - (l.match(/\}/g) ?? []).length;
    if (before !== 0) return l; // 関数の中はそのまま
    return l.replace(RE, (_m, q, body) => {
      n++;
      return `${q}${body}${q}`;
    });
  });
  if (n) {
    fs.writeFileSync(f, out.join('\n'), 'utf8');
    console.log(`  ${String(n).padStart(3)} 箇所を戻しました  ${f}`);
    total += n;
  }
}
console.log(`\n合計 ${total} 箇所`);
