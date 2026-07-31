/**
 * 設計トークンの保管
 *
 * 案を作るたびに本番サイトを取りに行くと、毎回数秒待たされ、
 * サイトが落ちていればその回だけ案の質が落ちる。案件に持たせて固定する。
 */
import { adminDb } from '@/lib/supabase/admin';
import { fetchSiteTokens } from '@/lib/site-tokens.mjs';
import type { SiteTokens } from '@/lib/site-tokens.d.mts';

export type { SiteTokens };

/** 取り直して案件に保存する。案件登録時と、社内が「取り直す」を押したとき */
export async function refreshProjectTokens(
  projectId: string,
  siteUrl: string | null,
): Promise<SiteTokens | null> {
  if (!siteUrl) return null;
  const tokens = await fetchSiteTokens(siteUrl);
  if (!tokens) return null;

  const at = new Date().toISOString();
  tokens.takenAt = at;
  await adminDb()
    .from('projects')
    .update({ design_tokens: tokens, design_tokens_at: at } as never)
    .eq('id', projectId);
  return tokens;
}

/**
 * 保存済みのトークンを返す。まだ無ければ一度だけ取りに行って保存する。
 * 案件登録より前に作られた案件を拾うため。
 */
export async function projectTokens(
  projectId: string,
  siteUrl: string | null,
): Promise<SiteTokens | null> {
  const { data } = await adminDb()
    .from('projects')
    .select('design_tokens')
    .eq('id', projectId)
    .maybeSingle();

  const saved = data?.design_tokens as SiteTokens | null | undefined;
  if (saved) return saved;

  return await refreshProjectTokens(projectId, siteUrl);
}
