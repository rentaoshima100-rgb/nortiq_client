import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * セッションの更新と /admin の入口ガード。
 *
 * ここは認可の境界ではない。境界は src/app/admin/layout.tsx の requireStaff()
 * であり、そちらでサーバ側の user と STAFF_EMAILS を必ず検証している。
 * middleware は「未ログインなら早めに /login へ送る」ための便宜と、
 * Supabase のトークン更新をクッキーに書き戻すためだけに存在する。
 *
 * したがってここで例外が出たときは、500 を返すのではなく素通しする。
 * 落ちたまま全ページが 500 になる方が実害が大きい。
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(list: CookieToSet[]) {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user && request.nextUrl.pathname.startsWith('/admin')) {
      const to = request.nextUrl.clone();
      to.pathname = '/login';
      to.search = '';
      return NextResponse.redirect(to);
    }
  } catch (e) {
    console.error('[middleware] セッションの確認に失敗しました', e);
    return NextResponse.next({ request });
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*'],
};
