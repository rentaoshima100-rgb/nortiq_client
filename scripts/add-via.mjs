/**
 * findByLocator の return に via を足す（何で当てたか）
 *
 * 段（tier）と1対1ではないので、機械的に埋める。
 * 段2の本文一致と段3の richPath はどちらも provisional だが、
 * 前者は「その要素自身が名乗っているもの」、後者は「上から N 番目」。
 * 打ち直してよいかの判断はこの違いで決まる。
 */
import fs from 'node:fs';

const p = 'widget/src/locator.ts';
let s = fs.readFileSync(p, 'utf8');

// [元の文字列, via] の順。上から順に、まだ via が付いていないものだけ置換する
const rules = [
  // 段1: nq-id
  ["if (group.length === 1) return { el: group[0], tier: 'confirmed' };", 'nqid'],
  ["if (hits.length === 1) return { el: hits[0], tier: 'confirmed' };", 'nqid'],
  // 段2: nq-id の集団内の序数
  ["return { el: group[loc.nqOrdinal], tier: 'provisional' };", 'ordinal'],
  // 段1: 作者が書いた id
  ["return { el: byId[0], tier: 'confirmed' };", 'content'],
  // 段2: 中身の手がかり（src / href / 本文）
  ["if (hit) return { el: hit, tier: 'provisional' };", 'content'],
  // 段3: 構造の手がかり
  ["return { el: hits[0], tier: 'provisional' };", 'structure'],
  ["if (hits.length === 1 && hits[0].tagName === loc.tag) return { el: hits[0], tier: 'weak' };", 'structure'],
];

let n = 0;
for (const [from, via] of rules) {
  const to = from.replace(/tier: '(\w+)'/g, `tier: '$1', via: '${via}'`);
  const parts = s.split(from);
  if (parts.length < 2) {
    console.error('  見つからない:', from.slice(0, 60));
    continue;
  }
  n += parts.length - 1;
  s = parts.join(to);
}

// bbox の IoU 段は形が違うので個別に
s = s.replace(/tier: (bestIoU[^,}]*|'stale'|'weak')\s*\}/g, (m) =>
  m.includes('via:') ? m : m.replace(/\}$/, ", via: 'structure' }"),
);

fs.writeFileSync(p, s, 'utf8');
console.log('via を付けた return:', n, '箇所');
