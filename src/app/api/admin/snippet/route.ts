/**
 * スニペットをリポジトリに入れる。
 *
 * GET  … 何をどう書き換えるかを返すだけ（実行しない）
 * POST … 実行する。既定は PR。projects.allow_direct_commit のときだけ直接コミット。
 *
 * 実処理は snippet-install-run.ts。案件の作成直後にも同じものを通す。
 */
import {
  INSTALL_COLUMNS,
  runSnippetInstall,
  type ProjectForInstall,
} from '@/lib/snippet-install-run';
import { currentStaff, staffActor } from '@/lib/staff';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function load(projectId: string | null) {
  if (!projectId) return null;
  const { data } = await adminDb()
    .from('projects')
    .select(INSTALL_COLUMNS)
    .eq('id', projectId)
    .maybeSingle();
  return (data as ProjectForInstall | null) ?? null;
}

function toResponse(out: Awaited<ReturnType<typeof runSnippetInstall>>) {
  if (!out.ok) {
    if (out.kind === 'needs-install') {
      return Response.json({
        needsInstall: true,
        installUrl: out.installUrl,
        message: out.message,
      });
    }
    return Response.json({ error: out.message }, { status: out.kind === 'error' ? 502 : 400 });
  }
  return Response.json({
    needsInstall: false,
    applied: out.applied,
    plan: out.plan,
    ...(out.applied ? { result: out.result } : { message: out.message }),
  });
}

export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: '権限がありません' }, { status: 403 });

  const p = await load(new URL(req.url).searchParams.get('projectId'));
  if (!p) return Response.json({ error: '案件が見つかりません' }, { status: 404 });

  const out = await runSnippetInstall(p, staffActor(staff), { dryRun: true });
  const res = toResponse(out);
  if (out.ok) {
    // 押す前に、どちらの反映のしかたになるかを見せる
    const body = await res.json();
    return Response.json({ ...body, mode: p.allow_direct_commit ? 'direct' : 'pr' });
  }
  return res;
}

export async function POST(req: Request) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: '権限がありません' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { projectId?: string };
  const p = await load(body.projectId ?? null);
  if (!p) return Response.json({ error: '案件が見つかりません' }, { status: 404 });

  return toResponse(await runSnippetInstall(p, staffActor(staff)));
}
