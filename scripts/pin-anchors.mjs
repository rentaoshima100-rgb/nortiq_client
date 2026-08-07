/**
 * 打ち直した錨（locator_live）を原本（locator）と並べて見る
 *
 *   node scripts/pin-anchors.mjs <案件キー>
 *   node scripts/pin-anchors.mjs <案件キー> --reset <seq,seq,...>
 *
 * 打ち直しは当たっているうちに走る。当て違いのまま打ち直すと、
 * **誤った場所が固定される**。原本は 0017 の決めごとで書き換えていないので、
 * 疑わしいものは locator_live を消せば元に戻る。
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
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function q(path, init) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H, ...init });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const key = process.argv[2];
const resetIdx = process.argv.indexOf('--reset');
const resetSeqs =
  resetIdx > 0 ? new Set(String(process.argv[resetIdx + 1] || '').split(',').map(Number)) : null;

const [p] = await q(`projects?select=id,name,snippet_key&snippet_key=eq.${key}`);
if (!p) throw new Error('案件が見つかりません: ' + key);

const reqs = await q(
  `requests?select=id,seq,body,status,locator,locator_live,locator_live_at&project_id=eq.${p.id}&status=neq.wont_fix&order=seq.asc&limit=300`,
);

const brief = (l) =>
  !l
    ? '—'
    : [
        l.nqId ? `nq=${l.nqId}` : null,
        l.textSample ? `「${String(l.textSample).trim().slice(0, 18)}」` : '本文なし',
        l.tag,
      ]
        .filter(Boolean)
        .join(' ');

console.log(`=== ${p.name}（${p.snippet_key}）`);
let live = 0;
for (const r of reqs) {
  if (r.locator_live) live++;
  const changed = !!r.locator_live;
  console.log(
    `\n #${String(r.seq).padStart(3)} ${r.status}  ${String(r.body).replace(/\s+/g, ' ').slice(0, 42)}`,
  );
  console.log(`      原本  ${brief(r.locator)}`);
  if (changed) {
    console.log(`      打直  ${brief(r.locator_live)}   ${r.locator_live_at ?? ''}`);
    const a = r.locator, b = r.locator_live;
    const warn = [];
    // 打ち直しで本文が消えたら、たいてい別の要素を掴んでいる
    if ((a?.textSample ?? '').trim() && !(b?.textSample ?? '').trim()) warn.push('本文が消えた');
    if (a?.tag && b?.tag && a.tag !== b.tag) warn.push(`タグが ${a.tag}→${b.tag}`);
    if (a?.nqId && !b?.nqId) warn.push('nq-id が消えた');
    if (warn.length) console.log(`      ⚠ ${warn.join(' / ')}`);
  }
}
console.log(`\n打ち直し済み: ${live} / ${reqs.length}`);

if (resetSeqs && resetSeqs.size) {
  const targets = reqs.filter((r) => resetSeqs.has(r.seq) && r.locator_live);
  for (const r of targets) {
    await q(`requests?id=eq.${r.id}`, {
      method: 'PATCH',
      headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ locator_live: null, locator_live_at: null }),
    });
    console.log(`  #${r.seq} の打ち直しを取り消しました（原本に戻ります）`);
  }
  if (!targets.length) console.log('  取り消す対象がありませんでした');
}
