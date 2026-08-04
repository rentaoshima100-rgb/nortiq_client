/**
 * 社内画面の日本語を t() で包む
 *
 *   node scripts/i18n-wrap.mjs --dry            確認だけ
 *   node scripts/i18n-wrap.mjs src/app/admin/page.tsx
 *
 * 包む対象:
 *   1. JSX のテキストノード      >日本語<        → >{t('日本語')}<
 *   2. 文字列リテラル            '日本語'        → t('日本語')
 *
 * 包まないもの（壊れる・意味がない）:
 *   - コメント
 *   - すでに t(...) の中にあるもの
 *   - import 文
 *   - テンプレートリテラル（式が混ざるので手で見る）
 *   - className / href など、訳す意味のない属性
 *
 * 抽出した日本語は辞書の鍵になる。翻訳は src/lib/i18n-dict.ts に書く。
 */
import fs from 'node:fs';

const JA = /[぀-ヿ一-龯]/;
const SKIP_ATTR = /\b(className|href|src|id|name|key|type|action|method|rel|target|value)\s*=\s*$/;

/** 行がコメントかどうか。粗くてよい（包まない方に倒す） */
function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

export function wrapFile(src) {
  const lines = src.split('\n');
  const found = new Set();
  let changed = 0;
  let inBlockComment = false;

  const out = lines.map((line) => {
    // ブロックコメントの中は触らない
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      return line;
    }
    if (/^\s*\/\*/.test(line) && !line.includes('*/')) {
      inBlockComment = true;
      return line;
    }
    if (isComment(line) || /^\s*import\s/.test(line) || !JA.test(line)) return line;
    // テンプレートリテラルは式が混ざるので手で見る
    if (line.includes('`')) return line;

    let s = line;

    // ① 文字列リテラル。すでに t( の中なら触らない
    s = s.replace(/(['"])((?:[^'"\\]|\\.)*?)\1/g, (m, q, body, offset) => {
      if (!JA.test(body)) return m;
      const before = s.slice(0, offset);
      if (/t\(\s*$/.test(before)) return m; // t('…') は済み
      if (SKIP_ATTR.test(before)) return m;
      found.add(body);
      changed++;
      return `t(${q}${body}${q})`;
    });

    // ② JSX のテキストノード。> と < の間に日本語だけがある行
    s = s.replace(/>([^<>{}]*[぀-ヿ一-龯][^<>{}]*)</g, (m, text) => {
      const trimmed = text.trim();
      if (!trimmed) return m;
      const lead = text.match(/^\s*/)[0];
      const tail = text.match(/\s*$/)[0];
      found.add(trimmed);
      changed++;
      return `>${lead}{t('${trimmed.replace(/'/g, "\\'")}')}${tail}<`;
    });

    return s;
  });

  return { text: out.join('\n'), found: [...found], changed };
}

/** t を取れるようにする。サーバーは getT、クライアントは useT */
function ensureT(src, file) {
  const isClient = /^['"]use client['"]/m.test(src);
  if (/\bconst t = (await getT\(\)|useT\(\))/.test(src)) return src;

  if (isClient) {
    if (!src.includes("from '@/lib/i18n-client'")) {
      src = src.replace(/^(['"]use client['"];\n)/m, `$1\nimport { useT } from '@/lib/i18n-client';\n`);
    }
    // 各コンポーネント関数の先頭に差し込む
    src = src.replace(
      /(export function \w+\([^)]*\)(?::[^{]+)?\s*\{\n)/g,
      `$1  const t = useT();\n`,
    );
    return src;
  }

  if (!src.includes("from '@/lib/i18n'")) {
    const m = src.match(/^import .*\n/m);
    if (m) src = src.replace(m[0], `${m[0]}import { getT } from '@/lib/i18n';\n`);
  }
  src = src.replace(
    /(export default async function \w+\([^)]*\)\s*\{\n)/,
    `$1  const t = await getT();\n`,
  );
  return src;
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('ファイルを指定してください');
  process.exit(1);
}

const all = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const { text, found, changed } = wrapFile(src);
  for (const x of found) all.add(x);
  if (!changed) {
    console.log(`  変更なし  ${f}`);
    continue;
  }
  const withT = ensureT(text, f);
  if (!dry) fs.writeFileSync(f, withT, 'utf8');
  console.log(`  ${String(changed).padStart(3)} 箇所  ${f}`);
}

if (dry) {
  console.log('\n--- 抽出した日本語 ---');
  for (const x of [...all].sort()) console.log(JSON.stringify(x));
}
console.log(`\n合計 ${all.size} 種類`);
