/**
 * 複数行にまたがる JSX のテキストを t() で包む
 *
 * i18n-wrap.mjs は1行で完結するものしか拾えなかった。
 * 段落は普通こう書かれる:
 *
 *   <p className="...">
 *     本番サイトを見て、済んでいる作業を判定します。
 *     残っているぶんだけを書いた指示文が出ます。
 *   </p>
 *
 * 行ごとに包むと訳が断片になるので、**続いているテキスト行はまとめて
 * 1つの鍵**にする。訳す側も読みやすい。
 *
 *   node scripts/i18n-wrap2.mjs --dry <files...>
 */
import fs from 'node:fs';

const JA = /[぀-ヿ一-龯]/;

/**
 * その行が「JSX のテキストだけ」か。
 *
 * 最初はタグと波括弧が無ければテキストとみなしていたが、
 *   ? t('…')
 *   draft: '下書き',
 * のような**コード行を巻き込んだ**（実測）。
 * 記号が1つでもあれば、それはコードだと考える方に倒す。
 * 取りこぼしは手で足せるが、壊すと戻すのが高くつく。
 */
const CODE_CHARS = ['<', '>', '{', '}', '`', "'", '"', '(', ')', ';', '=', ':', '?', '&', '|'];

function isPureText(line) {
  const t = line.trim();
  if (!t) return false;
  if (CODE_CHARS.some((c) => t.includes(c))) return false;
  if (t.endsWith(',')) return false;
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
  return JA.test(t);
}

export function wrap2(src) {
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  let changed = 0;
  let block = false;

  while (i < lines.length) {
    const line = lines[i];

    // ブロックコメントは触らない
    if (block) {
      out.push(line);
      if (line.includes('*/')) block = false;
      i++;
      continue;
    }
    if (/^\s*\/\*/.test(line) && !line.includes('*/')) {
      out.push(line);
      block = true;
      i++;
      continue;
    }

    if (!isPureText(line)) {
      out.push(line);
      i++;
      continue;
    }

    // 続いているテキスト行をまとめる
    const start = i;
    const parts = [];
    while (i < lines.length && isPureText(lines[i])) {
      parts.push(lines[i].trim());
      i++;
    }
    const indent = lines[start].match(/^\s*/)[0];
    // 日本語の文は行末で切れても続きなので、そのまま連結する
    const merged = parts.join('');
    out.push(`${indent}{t('${merged.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')}`);
    changed++;
  }

  return { text: out.join('\n'), changed };
}

const dry = process.argv.includes('--dry');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let total = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const { text, changed } = wrap2(src);
  if (!changed) continue;
  if (!dry) fs.writeFileSync(f, text, 'utf8');
  console.log(`  ${String(changed).padStart(3)} 箇所  ${f}`);
  total += changed;
}
console.log(`\n合計 ${total} 箇所`);
