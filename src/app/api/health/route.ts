import { json } from '@/lib/http';
import { appUrl, staffEmails } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * デプロイの切り分け用。値は返さない（設定されているかどうかだけ）。
 * 環境変数の貼り付けミスは「ビルドは緑なのに 500」という形で出るため、
 * どこまで届いているのかを外から確かめられるようにしておく。
 */
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || null;

  let supabaseUrlValid: boolean | 'unset' = 'unset';
  let supabaseOrigin: string | null = null;
  if (supabaseUrl) {
    try {
      supabaseOrigin = new URL(supabaseUrl).origin;
      supabaseUrlValid = true;
    } catch {
      supabaseUrlValid = false;
    }
  }

  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

  // JWT の3セグメント構造だけ見る（中身は返さない）
  const looksLikeJwt = (v: string | null) => (v ? v.split('.').length === 3 : false);

  return json({
    ok: true,
    appUrl: appUrl(),
    env: {
      NEXT_PUBLIC_SUPABASE_URL: {
        set: !!supabaseUrl,
        valid: supabaseUrlValid,
        origin: supabaseOrigin,
        hasWhitespace: supabaseUrl ? /\s/.test(supabaseUrl) : false,
      },
      NEXT_PUBLIC_SUPABASE_ANON_KEY: {
        set: !!anon,
        looksLikeJwt: looksLikeJwt(anon),
        length: anon ? anon.length : 0,
        hasWhitespace: anon ? /\s/.test(anon) : false,
      },
      SUPABASE_SERVICE_ROLE_KEY: {
        set: !!service,
        looksLikeJwt: looksLikeJwt(service),
        length: service ? service.length : 0,
        hasWhitespace: service ? /\s/.test(service) : false,
      },
      STAFF_EMAILS: { count: staffEmails().length },
    },
  });
}
