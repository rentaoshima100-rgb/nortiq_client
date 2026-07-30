#!/usr/bin/env node
/**
 * スナップショット同士の比較（設計 7.4）
 *
 *   node compare.mjs --before <snapshot_id> --after <snapshot_id>
 *
 * レイアウトマップを Storage から読み、結合 → 4分類 → intended 判定を行い、
 * diffs に書く。ピクセル差分は判定に使わない。
 *
 * intended = false が1件でもあれば社内に警告を出す。
 * クライアントには表示しない（7.4）。
 */
import { loadEnv, supa } from './supabase.mjs';
import { classify } from './diff.mjs';

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};

const beforeId = opt('before');
const afterId = opt('after');
if (!beforeId || !afterId) {
  console.error('--before <snapshot_id> --after <snapshot_id> が必要です');
  process.exit(1);
}

loadEnv();
const db = supa();
const BUCKET = 'nq-snapshots';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function readMap(path) {
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
  });
  if (!res.ok) throw new Error(`レイアウトマップを読めません: ${path} (${res.status})`);
  return res.json();
}

const [before] = await db.select('snapshots', `id=eq.${beforeId}&select=*`);
const [after] = await db.select('snapshots', `id=eq.${afterId}&select=*`);
if (!before || !after) {
  console.error('スナップショットが見つかりません');
  process.exit(1);
}
if (before.status !== 'ready' || after.status !== 'ready') {
  // 部分成功のスナップショットを比較に使わない（7.7）
  console.error(`比較できません: before=${before.status} / after=${after.status}`);
  process.exit(1);
}

const beforeShots = await db.select(
  'snapshot_shots',
  `snapshot_id=eq.${beforeId}&select=page_path,viewport_w,layout_map_path`,
);
const afterShots = await db.select(
  'snapshot_shots',
  `snapshot_id=eq.${afterId}&select=page_path,viewport_w,layout_map_path`,
);

// ピン対象（そのラウンドの依頼）。intended の判定に使う。
const roundId = after.round_id ?? before.round_id ?? null;
let pins = [];
if (roundId) {
  const reqs = await db.select(
    'requests',
    `round_id=eq.${roundId}&select=id,seq,page_path,locator`,
  );
  pins = reqs.map((r) => ({
    requestId: r.id,
    seq: r.seq,
    pagePath: r.page_path,
    path: r.locator?.cssPath ?? '',
  }));
}

console.log(`  before: ${before.phase} ${before.taken_at}`);
console.log(`  after : ${after.phase} ${after.taken_at}`);
console.log(`  ピン  : ${pins.length} 件${roundId ? '' : '（ラウンド未紐付けのため intended は判定しない）'}\n`);

let totalChanged = 0;
let totalUnintended = 0;
const rowsToInsert = [];

for (const bs of beforeShots) {
  const as = afterShots.find(
    (a) => a.page_path === bs.page_path && a.viewport_w === bs.viewport_w,
  );
  if (!as) {
    console.log(`  ${bs.page_path} @ ${bs.viewport_w}px … after 側に対応するショットが無い`);
    continue;
  }

  const [bMap, aMap] = await Promise.all([readMap(bs.layout_map_path), readMap(as.layout_map_path)]);
  const { diffs, movedCount, pairCount } = classify(bMap, aMap);

  // ピンの子孫数はレイアウトマップから数える（7.4 のガード用）
  const pagePins = pins
    .filter((p) => p.pagePath === bs.page_path && p.path)
    .map((p) => ({
      ...p,
      descendantCount: aMap.filter((e) => e.path.startsWith(p.path + ' > ')).length,
    }));

  const marked = diffs.map((d) => {
    let relation = 'none';
    let nearest = null;
    for (const pin of pagePins) {
      if (d.elementKey === pin.path) {
        relation = 'self';
        nearest = pin.requestId;
        break;
      }
      if (typeof d.elementKey === 'string' && d.elementKey.startsWith(pin.path + ' > ')) {
        // 大きなコンテナにピンが打たれるとページ全体が intended になり、
        // 巻き添え検出が死ぬ。子孫が 50 を超えるピンは直接の子までにする。
        if (pin.descendantCount > 50) {
          const rest = d.elementKey.slice(pin.path.length + 3);
          if (rest.includes(' > ')) continue;
        }
        relation = 'descendant';
        nearest = pin.requestId;
        break;
      }
      if (typeof d.elementKey === 'string' && pin.path.startsWith(d.elementKey + ' > ')) {
        relation = 'ancestor';
        nearest = pin.requestId;
        break;
      }
    }
    return { ...d, relation, nearestRequest: nearest, intended: relation !== 'none' };
  });

  const changed = marked.filter((d) => d.kind === 'changed');
  const unintended = marked.filter((d) => !d.intended);
  totalChanged += changed.length;
  totalUnintended += unintended.length;

  console.log(
    `  ${bs.page_path} @ ${bs.viewport_w}px … 対応 ${pairCount} / changed ${changed.length} / ` +
      `added ${marked.filter((d) => d.kind === 'added').length} / ` +
      `removed ${marked.filter((d) => d.kind === 'removed').length} / moved ${movedCount}（無視）`,
  );

  // element_key は cssPath だが、8段で打ち切っているので深い木では衝突しうる。
  // unique 制約に当たる前にここで一意化する。
  const usedKeys = new Set();
  for (const d of marked) {
    let ek = String(d.elementKey ?? '').slice(0, 480);
    if (usedKeys.has(ek)) {
      let n = 2;
      while (usedKeys.has(`${ek}#${n}`)) n++;
      ek = `${ek}#${n}`;
    }
    usedKeys.add(ek);
    rowsToInsert.push({
      round_id: roundId,
      before_snapshot_id: beforeId,
      after_snapshot_id: afterId,
      page_path: bs.page_path,
      viewport_w: bs.viewport_w,
      kind: d.kind,
      change_fields: d.changeFields,
      element_key: ek,
      bbox: d.bbox,
      nearest_request: d.nearestRequest,
      relation: d.relation,
      intended: d.intended,
    });
  }
}

// 同じ対の再計算は洗い替える（unique 制約で担保・7.4）
if (rowsToInsert.length) {
  const CHUNK = 200;
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    await db.upsert(
      'diffs',
      rowsToInsert.slice(i, i + CHUNK),
      'before_snapshot_id,after_snapshot_id,page_path,viewport_w,element_key',
    );
  }
}

console.log(`\n  diffs に ${rowsToInsert.length} 件を記録しました`);
if (totalUnintended > 0) {
  console.log(`\n  ⚠ 意図しない変更が ${totalUnintended} 件あります。`);
  console.log('    ピン対象の自身・子孫・祖先のいずれでもない場所が変わっています。');
  console.log('    クライアントには表示しません（7.4）。社内で中身を確認してください。');
} else if (totalChanged > 0) {
  console.log('\n  変更はすべてピン対象の範囲内でした。');
} else {
  console.log('\n  変更はありませんでした。');
}
