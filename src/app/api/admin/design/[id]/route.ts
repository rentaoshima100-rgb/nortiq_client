import { DESIGNS_BUCKET } from '@/lib/design';
import { currentStaff } from '@/lib/staff';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 案の HTML を返す。?dl=1 でダウンロード。
 *
 * バケットは非公開なので、社内の認証を通したここだけが取り出せる。
 * 生成物は信頼しないものとして扱い、srcdoc ではなくこのURLを
 * sandbox 付き iframe に読ませる。
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return new Response('権限がありません', { status: 403 });

  const { id } = await ctx.params;
  const db = adminDb();

  const { data: p } = await db
    .from('design_proposals')
    .select('html_path, title, variant, requests(seq)')
    .eq('id', id)
    .maybeSingle();
  if (!p) return new Response('見つかりません', { status: 404 });

  const { data: file, error } = await db.storage
    .from(DESIGNS_BUCKET)
    .download(p.html_path as string);
  if (error || !file) return new Response('取り出せませんでした', { status: 502 });

  const url = new URL(req.url);
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    // 生成物をそのまま開くので、外への通信と実行を止めておく
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
    'X-Content-Type-Options': 'nosniff',
  };

  if (url.searchParams.get('dl') === '1') {
    // PostgREST の埋め込みは配列で返る
    const rel = p.requests as unknown as { seq: number }[] | { seq: number } | null;
    const seq = Array.isArray(rel) ? (rel[0]?.seq ?? 0) : (rel?.seq ?? 0);
    const name = `依頼${seq}-案${p.variant}.html`;
    headers['Content-Disposition'] =
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
  }

  return new Response(await file.arrayBuffer(), { headers });
}
