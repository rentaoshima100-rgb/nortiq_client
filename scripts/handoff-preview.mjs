/**
 * Claude Code に渡すプロンプトを、実データで作って中身を見る
 *
 *   node scripts/handoff-preview.mjs <案件キー> [--all] [--out ファイル]
 *
 * 画面から確かめるにはログインが要るので、ここで直に叩けるようにする。
 * **本物の src/lib/handoff.ts を束ねて使う**（別実装で確かめても意味がない）。
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// .env.local を読み込む（アプリと同じ環境変数を使う）
for (const line of fs.readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
  if (!line.includes('=') || line.startsWith('#')) continue;
  const i = line.indexOf('=');
  process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
}

const tmp = join(root, 'node_modules/.cache/nq-handoff.mjs');
fs.mkdirSync(dirname(tmp), { recursive: true });
await build({
  entryPoints: [join(root, 'src/lib/handoff.ts')],
  outfile: tmp,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  packages: 'external',
  alias: { '@': join(root, 'src') },
  logLevel: 'silent',
});
const { buildHandoff } = await import('file://' + tmp.replace(/\\/g, '/'));

const key = process.argv[2];
if (!key) throw new Error('案件キーを渡してください');
const all = process.argv.includes('--all');
const outIdx = process.argv.indexOf('--out');

const res = await fetch(
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/projects?select=id,name&snippet_key=eq.${key}`,
  {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  },
);
const [p] = await res.json();
if (!p) throw new Error('案件が見つかりません: ' + key);

const out = await buildHandoff(p.id, {
  statuses: all
    ? ['received', 'in_progress', 'done', 'carried_over', 'wont_fix']
    : undefined,
});

console.error(`=== ${p.name}`);
console.error(`    ${out.message} / ${out.prompt.length.toLocaleString()} 文字`);
if (outIdx > 0 && process.argv[outIdx + 1]) {
  fs.writeFileSync(process.argv[outIdx + 1], out.prompt, 'utf8');
  console.error(`    ${process.argv[outIdx + 1]} に書きました`);
} else {
  console.log(out.prompt);
}
fs.rmSync(tmp, { force: true });
