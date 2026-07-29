import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from '@/lib/env';

let cached: SupabaseClient | null = null;

/**
 * service_role キーのクライアント。RLS をバイパスするので、
 * 必ずサーバ側（route handler / server component）からのみ使うこと。
 * Phase 0 ではクライアント経路もスタッフ経路もここを通る（10.3 のコメント参照）。
 */
export function adminDb(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cached;
}
