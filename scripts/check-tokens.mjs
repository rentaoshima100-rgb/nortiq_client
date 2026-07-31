/**
 * 本番サイトから設計トークンを抜けているかを目で見る。
 *   node scripts/check-tokens.mjs https://example.com/
 */
import { fetchSiteTokens } from '../src/lib/site-tokens.mjs';

const url = process.argv[2];
if (!url) {
  console.error('使い方: node scripts/check-tokens.mjs <サイトURL>');
  process.exit(1);
}

const t = await fetchSiteTokens(url);
if (!t) {
  console.log('取得できませんでした');
  process.exit(1);
}
console.log(`CSS ${t.sheetCount} 件から抽出\n`);
console.log(`変数 (${t.vars.length})`);
for (const v of t.vars.slice(0, 12)) console.log(`  ${v.name}: ${v.value}`);
console.log(`\n書体      : ${t.fonts.join(' | ') || 'なし'}`);
console.log(`webfont   : ${t.webFonts.join(', ') || 'なし'}`);
console.log(`色        : ${t.colors.join(' ')}`);
console.log(`文字サイズ: ${t.fontSizes.join(' ')}`);
console.log(`余白      : ${t.spacings.join(' ')}`);
console.log(`角丸      : ${t.radii.join(' ')}`);
