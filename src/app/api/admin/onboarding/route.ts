import { appUrl } from '@/lib/env';
import { buildPrompt, checkSite, steps, type OnboardingInput } from '@/lib/onboarding';
import { currentStaff } from '@/lib/staff';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** 案件のサイトを見て、済んでいる作業を抜いた指示文を返す */
export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: '権限がありません' }, { status: 403 });

  const projectId = new URL(req.url).searchParams.get('projectId');
  if (!projectId) return Response.json({ error: 'projectId がありません' }, { status: 400 });

  const { data: p } = await adminDb()
    .from('projects')
    .select('name, client_name, site_url, snippet_key, repo_owner, repo_name, asset_swap_enabled')
    .eq('id', projectId)
    .maybeSingle();
  if (!p) return Response.json({ error: '案件が見つかりません' }, { status: 404 });

  const input: OnboardingInput = {
    projectName: p.name,
    clientName: p.client_name,
    siteUrl: p.site_url,
    snippetKey: p.snippet_key,
    appUrl: appUrl(),
    repoOwner: p.repo_owner,
    repoName: p.repo_name,
    assetSwapEnabled: !!p.asset_swap_enabled,
  };

  const check = await checkSite(p.site_url);

  return Response.json({
    check,
    steps: steps(input, check),
    prompt: buildPrompt(input, check),
  });
}
