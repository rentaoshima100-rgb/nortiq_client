/**
 * 本番の HTML を取って、記録した手がかりがまだ生きているかを見る
 *
 *   node scripts/pin-probe.mjs <案件キー>
 *
 * ブラウザを立てずに文字列として見るだけなので、当たり判定そのものでは
 * ない。ただし「nq-id が1つも無い」「本文が消えている」は確実に分かる。
 * findByLocator が段4に落ちる理由の大半はここで出る。
 */
import fs from 'node:fs';

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function q(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

const key = process.argv[2];
const [p] = await q(`projects?select=id,name,snippet_key,site_url&snippet_key=eq.${key}`);
if (!p) throw new Error('案件が見つかりません: ' + key);

const reqs = await q(
  `requests?select=id,seq,status,page_path,body,locator,locator_live&project_id=eq.${p.id}&status=neq.wont_fix&order=seq.asc&limit=300`,
);

const pages = [...new Set(reqs.map((r) => r.page_path))];
const html = {};
for (const path of pages) {
  const u = p.site_url.replace(/\/+$/, '') + (path === '/' ? '/' : path);
  const res = await fetch(u, { headers: { 'User-Agent': 'nortiq-pin-probe' } });
  html[path] = res.ok ? await res.text() : '';
  console.log(`${u}  → ${res.status}  ${html[path].length} 文字`);
}

const allNq = new Set();
for (const path of pages) {
  for (const m of html[path].matchAll(/data-nq-id="([^"]+)"/g)) allNq.add(m[1]);
}
console.log(`\n本番にある data-nq-id: ${allNq.size} 種類`);

console.log('\n seq  記録した nqId      本番にある？  本文が残っている？');
let vanish = 0;
for (const r of reqs) {
  const l = r.locator_live ?? r.locator ?? {};
  const doc = html[r.page_path] ?? '';
  const nq = l.nqId ?? null;
  const nqAlive = nq ? doc.includes(`data-nq-id="${nq}"`) : null;
  // textSample がそのまま HTML に出ているか（空白の畳み方は無視）
  const sample = (l.textSample ?? '').trim().slice(0, 24);
  const textAlive = sample ? doc.replace(/\s+/g, ' ').includes(sample.replace(/\s+/g, ' ')) : null;
  // これが true なら findByLocator は definitelyAbsent で null を返す＝ピンが消える
  const dropped = !!nq && !nqAlive;
  if (dropped) vanish++;
  console.log(
    ` ${String(r.seq).padStart(3)}  ${String(nq ?? '—').padEnd(17)} ` +
      `${nq ? (nqAlive ? 'ある' : '**ない**') : '—'}`.padEnd(14) +
      `${textAlive === null ? '—' : textAlive ? 'ある' : '**ない**'}` +
      `${dropped ? '   ← 消える' : ''}`,
  );
}
console.log(`\n記録した nq-id が本番に無いもの: ${vanish} / ${reqs.length} 件`);
