import { adminDb } from '@/lib/supabase/admin';
import { sha256hex } from '@/lib/hash';
import type { ClientSessionRow, ProjectRow } from '@/lib/types';

export type WidgetAuthOk = {
  ok: true;
  project: ProjectRow;
  session: ClientSessionRow;
  tokenHash: string;
};
export type WidgetAuthNg = { ok: false; status: number; error: string };
export type WidgetAuthResult = WidgetAuthOk | WidgetAuthNg;

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/**
 * ウィジェット経路の認証（6.1 / 10.4）
 * - Cookie は使わない。Authorization: Bearer のみ。
 * - トークンは sha256 して client_sessions.token_hash で引く（平文は保存しない）。
 * - Origin と snippet_key の両方を検証する。
 */
export async function authenticateWidget(
  req: Request,
  projectKey: string | null,
): Promise<WidgetAuthResult> {
  const token = bearer(req);
  if (!token) return { ok: false, status: 401, error: 'トークンがありません' };

  const origin = req.headers.get('origin');
  if (!origin) return { ok: false, status: 403, error: 'Origin がありません' };

  const tokenHash = sha256hex(token);
  const db = adminDb();

  const { data, error } = await db
    .from('client_sessions')
    .select('*, projects(*)')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: 'セッションの照会に失敗しました' };
  if (!data) return { ok: false, status: 401, error: 'トークンが無効です' };

  const session = data as unknown as ClientSessionRow & { projects: ProjectRow | null };
  const project = session.projects;
  if (!project) return { ok: false, status: 401, error: '案件が見つかりません' };

  if (session.revoked_at) return { ok: false, status: 401, error: 'トークンは失効しています' };
  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 401, error: 'トークンの有効期限が切れています' };
  }

  if (projectKey && projectKey !== project.snippet_key) {
    return { ok: false, status: 403, error: '案件キーが一致しません' };
  }

  if (origin !== project.site_origin) {
    return { ok: false, status: 403, error: 'オリジンが一致しません' };
  }

  // last_used_at は毎回書かない（依頼登録 p95 300ms の予算を食うため）。
  // 5分以上古いときだけ更新する。
  const last = session.last_used_at ? new Date(session.last_used_at).getTime() : 0;
  if (Date.now() - last > 5 * 60_000) {
    await db
      .from('client_sessions')
      .update({ last_used_at: new Date().toISOString() })
      .eq('token_hash', tokenHash);
  }

  return { ok: true, project, session, tokenHash };
}
