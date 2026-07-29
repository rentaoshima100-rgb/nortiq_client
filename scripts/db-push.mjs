// supabase/migrations/*.sql を順に適用する。
//
//   npm run db:push
//
// 接続先は .env.local の DATABASE_URL（Supabase の Connection string）。
// 直接接続（db.<ref>.supabase.co）は IPv6 のみのことがあるため、
// IPv4 環境では Session pooler の文字列を使うこと。
import pg from 'pg';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvLocal() {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
  }
}

loadEnvLocal();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL が .env.local にありません。');
  console.error('Supabase → Project Settings → Database → Connection string（URI）を入れてください。');
  process.exit(1);
}

const dir = join(root, 'supabase/migrations');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
} catch (e) {
  console.error('接続に失敗しました:', e.message);
  if (/ENETUNREACH|EHOSTUNREACH/.test(String(e.message))) {
    console.error(
      'この環境から IPv6 に到達できていない可能性があります。' +
        'Session pooler（aws-*.pooler.supabase.com）の接続文字列を使ってください。',
    );
  }
  process.exit(1);
}

await client.query(`
  create table if not exists nq_migrations (
    name text primary key,
    applied_at timestamptz default now()
  )
`);

const { rows } = await client.query('select name from nq_migrations');
const done = new Set(rows.map((r) => r.name));

let applied = 0;
for (const f of files) {
  if (done.has(f)) {
    console.log(`  skip  ${f}（適用済み）`);
    continue;
  }
  const sql = readFileSync(join(dir, f), 'utf8');
  process.stdout.write(`  apply ${f} … `);
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into nq_migrations (name) values ($1)', [f]);
    await client.query('commit');
    console.log('ok');
    applied++;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.log('失敗');
    console.error(`\n  ${f} の適用に失敗しました:\n  ${e.message}\n`);
    await client.end();
    process.exit(1);
  }
}

const { rows: tables } = await client.query(
  `select table_name from information_schema.tables
   where table_schema = 'public' order by table_name`,
);
await client.end();

console.log(`\n  適用: ${applied}件 / public のテーブル: ${tables.length}件`);
console.log('  ' + tables.map((t) => t.table_name).join(', '));
