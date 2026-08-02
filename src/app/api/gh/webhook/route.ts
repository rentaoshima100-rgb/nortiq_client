/**
 * GitHub からの webhook
 *
 * 既定は PR を出すだけなので、こちらは「いつマージされたか」を知らない。
 * 押して確認する運用だと、マージが翌日でも気づけない。
 * ここで拾って、招待を送れる状態になったことを案件に記録する。
 *
 *   pull_request (closed & merged)  … 入れた PR がマージされた
 *   deployment_status (success)     … そのコミットが本番に出た
 *
 * 公開エンドポイントなので、署名を検証できないものは一切処理しない。
 * 秘密が設定されていないときは受け付けない（黙って通すと誰でも
 * 「本番に出た」と書き込めてしまう）。
 */
import { logEvent } from '@/lib/events';
import { verifySignature, webhookSecret } from '@/lib/gh-webhook';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM = { type: 'system' as const, id: 'github-webhook' };

interface RepoRef {
  full_name?: string;
  owner?: { login?: string };
  name?: string;
}

async function projectForRepo(repo: RepoRef | undefined, extra?: { snippetKey?: string }) {
  const owner = repo?.owner?.login ?? repo?.full_name?.split('/')[0];
  const name = repo?.name ?? repo?.full_name?.split('/')[1];
  if (!owner || !name) return null;

  let q = adminDb()
    .from('projects')
    .select('id, snippet_key, snippet_commit_sha, snippet_installed_at')
    .eq('repo_owner', owner)
    .eq('repo_name', name);
  if (extra?.snippetKey) q = q.eq('snippet_key', extra.snippetKey);

  const { data } = await q.limit(2);
  // 同じリポジトリに複数案件がぶら下がっている場合、どれのことか決められない。
  // 取り違えて「出た」と記録するより、何もしないほうがよい。
  if (!data || data.length !== 1) return null;
  return data[0] as {
    id: string;
    snippet_key: string;
    snippet_commit_sha: string | null;
    snippet_installed_at: string | null;
  };
}

export async function POST(req: Request) {
  const secret = webhookSecret();
  if (!secret) return new Response('webhook secret が未設定です', { status: 503 });

  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'), secret)) {
    return new Response('署名が一致しません', { status: 401 });
  }

  const event = req.headers.get('x-github-event');
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new Response('本文を読めません', { status: 400 });
  }

  if (event === 'pull_request') {
    const pr = payload.pull_request as
      | { merged?: boolean; merge_commit_sha?: string; head?: { ref?: string }; html_url?: string }
      | undefined;
    if (payload.action !== 'closed' || !pr?.merged) return Response.json({ ok: true });

    // こちらが出した PR だけを見る。ブランチ名に案件キーが入っている。
    const key = pr.head?.ref?.match(/^nortiq\/setup-(.+)$/)?.[1];
    if (!key) return Response.json({ ok: true });

    const p = await projectForRepo(payload.repository as RepoRef, { snippetKey: key });
    if (!p) return Response.json({ ok: true });

    await adminDb()
      .from('projects')
      .update({ snippet_commit_sha: pr.merge_commit_sha ?? p.snippet_commit_sha })
      .eq('id', p.id);
    await logEvent({
      projectId: p.id,
      actor: SYSTEM,
      entity: 'projects',
      entityId: p.id,
      action: 'snippet_pr_merged',
      after: { merge_commit_sha: pr.merge_commit_sha, pr: pr.html_url },
    });
    return Response.json({ ok: true, handled: 'pull_request.merged' });
  }

  if (event === 'deployment_status') {
    const st = (payload.deployment_status as { state?: string; environment_url?: string }) ?? {};
    const dep = (payload.deployment as { sha?: string; environment?: string }) ?? {};
    if (st.state !== 'success' || !dep.sha) return Response.json({ ok: true });

    const p = await projectForRepo(payload.repository as RepoRef);
    if (!p) return Response.json({ ok: true });
    // スニペットを入れたコミットが出たときだけ。無関係なデプロイでは書かない。
    if (p.snippet_commit_sha !== dep.sha) return Response.json({ ok: true });
    if (p.snippet_installed_at) return Response.json({ ok: true, handled: 'already' });

    await adminDb()
      .from('projects')
      .update({ snippet_installed_at: new Date().toISOString() })
      .eq('id', p.id);
    await logEvent({
      projectId: p.id,
      actor: SYSTEM,
      entity: 'projects',
      entityId: p.id,
      action: 'snippet_deployed',
      after: { sha: dep.sha, environment: dep.environment, url: st.environment_url },
    });
    return Response.json({ ok: true, handled: 'deployment_status.success' });
  }

  return Response.json({ ok: true, ignored: event });
}
