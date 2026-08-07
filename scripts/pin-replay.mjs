/**
 * 本番の DOM に findByLocator を当て直して、ピンが出るかを実測する
 *
 *   node scripts/pin-replay.mjs <案件キー> [--old]
 *
 * ウィジェット本体と同じ locator.ts を束ねて使う（別実装にすると、
 * 測っているものが本番と違うものになる）。--old を付けると変更前の
 * 判定（nqIdMissing で切る）を再現するので、A/B がそのまま出る。
 *
 * ブラウザ内で描画する型のサイトは、配信 HTML に本文が無い。
 * その場合は「配信 HTML では判定できない」と出す。嘘の数字を出さない。
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const env = Object.fromEntries(
  fs
    .readFileSync(join(root, '.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

async function q(path) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
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

// ウィジェットと同じ locator.ts
const tmp = join(root, 'node_modules/.cache/nq-locator.cjs');
fs.mkdirSync(dirname(tmp), { recursive: true });
await build({
  entryPoints: [join(root, 'widget/src/locator.ts')],
  outfile: tmp,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  logLevel: 'silent',
});

const pages = [...new Set(reqs.map((r) => r.page_path))];
console.log(`=== ${p.name}（${p.snippet_key}）  ${p.site_url}`);

for (const path of pages) {
  const u = p.site_url.replace(/\/+$/, '') + (path === '/' ? '/' : path);
  const res = await fetch(u, { headers: { 'User-Agent': 'nortiq-pin-replay' } });
  const html = await res.text();
  const dom = new JSDOM(html, { url: u });

  // locator.ts は document / window / CSS を素で触る
  const g = globalThis;
  g.window = dom.window;
  g.document = dom.window.document;
  g.Element = dom.window.Element;
  g.Node = dom.window.Node;
  g.CSS = dom.window.CSS;
  g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

  const mod = await import('file://' + tmp.replace(/\\/g, '/') + '?t=' + Date.now());
  const { findByLocator } = mod.default ?? mod;

  const here = reqs.filter((r) => r.page_path === path);
  const bodyText = dom.window.document.body.textContent.replace(/\s+/g, ' ').trim();
  console.log(`\n--- ${u}  本文 ${bodyText.length} 文字 / 要素 ${dom.window.document.getElementsByTagName('*').length} 個`);
  if (bodyText.length < 400) {
    console.log('    配信 HTML に中身がありません（ブラウザ内で描画する型）。');
    console.log('    この方法では判定できません。実ブラウザで見る必要があります。');
    continue;
  }

  let ok = 0;
  const tiers = {};
  for (const r of here) {
    const loc = r.locator_live ?? r.locator;
    let hit = null;
    try {
      hit = findByLocator(loc);
    } catch (e) {
      hit = null;
      console.log(`    #${r.seq} 例外: ${e.message}`);
    }
    if (hit) ok++;
    tiers[hit ? hit.tier : 'なし'] = (tiers[hit ? hit.tier : 'なし'] ?? 0) + 1;
    console.log(
      `    #${String(r.seq).padStart(3)}  ${hit ? hit.tier.padEnd(12) : 'ピンが出ない'.padEnd(9)}` +
        `  ${String(r.body).replace(/\s+/g, ' ').slice(0, 34)}`,
    );
  }
  console.log(`    → ${ok}/${here.length} 件でピンが出る   ${JSON.stringify(tiers)}`);
}

fs.rmSync(tmp, { force: true });
