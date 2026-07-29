import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireEnv } from '@/lib/env';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/** 社内ダッシュボード用（Supabase Auth のセッションを Cookie で持つ） */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(list: CookieToSet[]) {
          try {
            for (const { name, value, options } of list) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component からは書き込めない。middleware 側で更新される。
          }
        },
      },
    },
  );
}
