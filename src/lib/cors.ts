import { adminDb } from '@/lib/supabase/admin';

/**
 * CORS（6.1）
 * ワイルドカードは使わない。Origin が「登録済み案件の site_url のオリジン」と
 * 一致するときだけ、そのオリジンだけを返す。
 *
 * preflight（OPTIONS）ではリクエストボディが読めず snippet_key が分からないため、
 * ここでは Origin だけで判定する。snippet_key の照合は本リクエスト側
 * （widget-auth.ts）で必ず行う。
 */

type CacheEntry = { allowed: boolean; expires: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

export async function isAllowedOrigin(origin: string | null): Promise<boolean> {
  if (!origin) return false;
  const hit = cache.get(origin);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.allowed;

  let allowed = false;
  try {
    const db = adminDb();
    const { data } = await db.from('projects').select('id').eq('site_origin', origin).limit(1);
    allowed = !!data && data.length > 0;

    // 独自ドメインへの切り替え期間など、1案件が複数のオリジンを持つことがある。
    // ワイルドカードは使わない。候補が増えるだけで、照合は完全一致のまま。
    if (!allowed) {
      const { data: extra } = await db
        .from('projects')
        .select('id')
        .contains('extra_origins', [origin])
        .limit(1);
      allowed = !!extra && extra.length > 0;
    }
  } catch (e) {
    // 環境変数が未設定など。許可しない側に倒す。
    console.error('[cors] オリジンの照会に失敗しました', e);
    return false;
  }

  cache.set(origin, { allowed, expires: now + TTL_MS });
  return allowed;
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'false',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/** 本リクエスト用。許可されていないオリジンには CORS ヘッダを付けない。 */
export async function corsHeadersFor(
  origin: string | null,
): Promise<Record<string, string>> {
  if (origin && (await isAllowedOrigin(origin))) return corsHeaders(origin);
  return { Vary: 'Origin' };
}

/** OPTIONS ハンドラの共通実装 */
export async function handlePreflight(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  if (origin && (await isAllowedOrigin(origin))) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
}
