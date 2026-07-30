/**
 * Supabase への保存。
 * supabase-js は入れず REST を直接叩く（ワーカーの依存を増やさないため）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  const p = join(here, '../.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
  }
}

export function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です');
  const headers = { apikey: key, Authorization: 'Bearer ' + key };

  return {
    /** PostgREST への挿入。返却は representation。 */
    async insert(table, row) {
      const res = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(row),
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`insert ${table} 失敗 ${res.status}: ${body.slice(0, 300)}`);
      return JSON.parse(body)[0];
    },

    async upsert(table, row, onConflict) {
      const res = await fetch(
        `${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
            Prefer: 'return=representation,resolution=merge-duplicates',
          },
          body: JSON.stringify(row),
        },
      );
      const body = await res.text();
      if (!res.ok) throw new Error(`upsert ${table} 失敗 ${res.status}: ${body.slice(0, 300)}`);
      return JSON.parse(body)[0];
    },

    async update(table, filter, patch) {
      const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`update ${table} 失敗 ${res.status}: ${(await res.text()).slice(0, 300)}`);
    },

    async select(table, query) {
      const res = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
      if (!res.ok) throw new Error(`select ${table} 失敗 ${res.status}`);
      return res.json();
    },

    /** Storage へアップロード。既存は上書きする。 */
    async upload(bucket, path, body, contentType) {
      const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'true' },
        body,
      });
      if (!res.ok) {
        throw new Error(`upload ${path} 失敗 ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      return path;
    },
  };
}
