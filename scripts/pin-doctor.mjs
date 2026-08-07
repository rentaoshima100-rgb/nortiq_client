/**
 * ピンが出ない理由を、実データで切り分ける
 *
 *   node scripts/pin-doctor.mjs <案件キー or 案件名の一部>
 *
 * 「消えた」の原因は毎回ちがう。推測で直すと同じことが起きるので、
 * 依頼ごとに**どの段で落ちているか**を出す。
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
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const needle = process.argv[2] ?? '';
const projects = await q(
  'projects?select=id,name,client_name,snippet_key,site_url,extra_origins,repo_owner,repo_name,has_nq_id',
);
const hit = projects.filter(
  (p) =>
    !needle ||
    [p.snippet_key, p.name, p.client_name].some((v) => (v ?? '').toLowerCase().includes(needle.toLowerCase())),
);

if (!hit.length) {
  console.log('案件が見つかりません。あるのは:');
  for (const p of projects) console.log(`  ${p.snippet_key}  ${p.name} / ${p.client_name}`);
  process.exit(1);
}

for (const p of hit) {
  console.log(`\n=== ${p.name}（${p.snippet_key}）`);
  console.log(`    site_url      ${p.site_url}`);
  console.log(`    extra_origins ${JSON.stringify(p.extra_origins ?? [])}`);
  console.log(`    has_nq_id     ${p.has_nq_id}`);
  console.log(`    repo          ${p.repo_owner ?? '—'}/${p.repo_name ?? '—'}`);

  const reqs = await q(
    `requests?select=id,seq,status,page_path,body,locator,locator_live,locator_live_at,nq_id,nq_ordinal&project_id=eq.${p.id}&order=seq.asc&limit=300`,
  );
  console.log(`    依頼          ${reqs.length} 件`);

  // ピン API と同じ条件で数える
  const shown = reqs.filter((r) => r.status !== 'wont_fix');
  console.log(`    ピンに出る対象 ${shown.length} 件（wont_fix を除く）`);

  const byPath = {};
  for (const r of shown) byPath[r.page_path] = (byPath[r.page_path] ?? 0) + 1;
  console.log(`    ページ別      ${JSON.stringify(byPath)}`);

  const noNq = shown.filter((r) => !r.locator?.nqId).length;
  const live = shown.filter((r) => r.locator_live).length;
  console.log(`    nqId 無し     ${noNq} / ${shown.length}`);
  console.log(`    錨を打ち直し済 ${live} / ${shown.length}`);

  console.log('\n    seq  status      page       nqId              手がかり');
  for (const r of shown) {
    const l = r.locator_live ?? r.locator ?? {};
    const cues = [
      l.nqId ? 'nqId' : null,
      l.elId ? 'elId' : null,
      l.srcAttr ? 'src' : null,
      l.hrefKey ? 'href' : null,
      l.textHash ? 'text' : null,
      l.deepTextHash ? 'deep' : null,
      l.richPath ? 'rich' : null,
      l.cssPath ? 'css' : null,
    ].filter(Boolean);
    console.log(
      `    ${String(r.seq).padStart(3)}  ${String(r.status).padEnd(11)} ${String(r.page_path).padEnd(10)} ` +
        `${String(l.nqId ?? '—').padEnd(17)} ${cues.join(',')}` +
        `${r.locator_live ? '  [live]' : ''}`,
    );
  }
}
