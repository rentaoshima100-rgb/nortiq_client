#!/usr/bin/env node
/**
 * ピクセル差分（設計 7.4 末尾）
 *
 *   node pixel-diff.mjs --round <round_id>
 *
 * odiff による差分は **クライアントに見せる before/after の視覚表現専用**。
 * 判定には使わない。判定はレイアウトマップの結合（compare.mjs）で行う。
 *
 * before と after の切り出しは、文言が伸びるなどして寸法が違うことがある。
 * odiff は同寸でないと比較できないので、大きい方に白で余白を足して揃える。
 */
import { compare } from 'odiff-bin';
import sharp from 'sharp';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, supa, supaKey, supaUrl } from './supabase.mjs';

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};

const roundId = opt('round');
if (!roundId) {
  console.error('--round <round_id> が必要です');
  process.exit(1);
}

loadEnv();
const db = supa();
const BUCKET = 'nq-snapshots';
const url = supaUrl();
const key = supaKey();
const H = { apikey: key, Authorization: 'Bearer ' + key };

async function download(path) {
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, { headers: H });
  if (!res.ok) throw new Error(`読めません: ${path} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

const snaps = await db.select(
  'snapshots',
  `round_id=eq.${roundId}&status=eq.ready&phase=in.(before,after)&select=id,phase,taken_at&order=taken_at`,
);
const before = snaps.filter((s) => s.phase === 'before').pop();
const after = snaps.filter((s) => s.phase === 'after').pop();
if (!before || !after) {
  console.error('before / after の両方が ready である必要があります');
  process.exit(1);
}

const shots = await db.select(
  'request_shots',
  `snapshot_id=in.(${before.id},${after.id})&select=id,request_id,snapshot_id,crop_path`,
);

const tmp = mkdtempSync(join(tmpdir(), 'nq-odiff-'));
let done = 0;

try {
  const byRequest = new Map();
  for (const s of shots) {
    if (!byRequest.has(s.request_id)) byRequest.set(s.request_id, {});
    byRequest.get(s.request_id)[s.snapshot_id === before.id ? 'before' : 'after'] = s;
  }

  for (const [requestId, pair] of byRequest) {
    if (!pair.before?.crop_path || !pair.after?.crop_path) continue;

    const [bBuf, aBuf] = await Promise.all([
      download(pair.before.crop_path),
      download(pair.after.crop_path),
    ]);
    const [bm, am] = await Promise.all([sharp(bBuf).metadata(), sharp(aBuf).metadata()]);

    // 同寸に揃える。切り出しは文言の伸びなどで高さが変わる。
    const W = Math.max(bm.width, am.width);
    const Hh = Math.max(bm.height, am.height);
    // 足りないぶんだけ白で埋める（全体を足すのではない）
    const pad = (buf, meta) =>
      sharp(buf)
        .extend({
          top: 0,
          left: 0,
          bottom: Hh - meta.height,
          right: W - meta.width,
          background: { r: 255, g: 255, b: 255 },
        })
        .png()
        .toBuffer();

    const bp = join(tmp, `${requestId}-b.png`);
    const ap = join(tmp, `${requestId}-a.png`);
    const dp = join(tmp, `${requestId}-d.png`);
    writeFileSync(bp, await pad(bBuf, bm));
    writeFileSync(ap, await pad(aBuf, am));

    const res = await compare(bp, ap, dp, {
      threshold: 0.1,
      diffColor: '#ff00ff',
      antialiasing: true,
    });

    let ratio = 0;
    let diffPath = null;
    if (res.match) {
      console.log(`  依頼 ${requestId.slice(0, 8)}: 見た目の変化なし`);
    } else if (res.reason === 'pixel-diff') {
      ratio = res.diffPercentage / 100;
      const webp = await sharp(readFileSync(dp)).webp({ quality: 82 }).toBuffer();
      diffPath = pair.after.crop_path.replace(/\.webp$/, '.diff.webp');
      await fetch(`${url}/storage/v1/object/${BUCKET}/${diffPath}`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'image/webp', 'x-upsert': 'true' },
        body: webp,
      });
      console.log(
        `  依頼 ${requestId.slice(0, 8)}: ${res.diffPercentage.toFixed(2)}% のピクセルが変化`,
      );
    } else {
      console.log(`  依頼 ${requestId.slice(0, 8)}: 比較できません（${res.reason}）`);
      continue;
    }

    await db.update('request_shots', `id=eq.${pair.after.id}`, {
      diff_path: diffPath,
      diff_ratio: ratio,
    });
    done++;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n  ${done} 件の差分画像を記録しました`);
console.log('  この画像は見せるためのもので、判定には使いません（7.4）。');
