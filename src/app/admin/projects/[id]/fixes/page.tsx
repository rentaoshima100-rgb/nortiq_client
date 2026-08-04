import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminDb } from '@/lib/supabase/admin';
import { FixList, type FixRow } from './ui';

export const dynamic = 'force-dynamic';

export default async function FixesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = adminDb();

  const { data: project } = await db
    .from('projects')
    .select('id, name, repo_owner, repo_name')
    .eq('id', id)
    .maybeSingle();
  if (!project) notFound();

  const { data: raw } = await db
    .from('fix_instructions')
    .select(
      'id, request_id, instruction, target_hint, doable, reason, status, source, pr_url, question, created_at, requests(seq, body, client_question, client_answer)',
    )
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(200);

  const rows: FixRow[] = ((raw ?? []) as unknown as (Omit<FixRow, 'seq' | 'body' | 'asked' | 'answer'> & {
    requests: {
      seq: number;
      body: string;
      client_question: string | null;
      client_answer: string | null;
    } | null;
  })[])
    .filter((r) => r.requests)
    .map((r) => ({
      ...r,
      seq: r.requests!.seq,
      body: r.requests!.body,
      asked: r.requests!.client_question,
      answer: r.requests!.client_answer,
    }))
    .sort((a, b) => a.seq - b.seq);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/projects/${id}`} className="text-xs text-slate-400 hover:text-slate-600">
          ← {project.name}
        </Link>
        <h1 className="mt-1 text-lg font-bold">修正指示</h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          依頼ごとに「何をどう直すか」の指示だけを先に作ります。
          <b>ここではまだリポジトリを触りません。</b>
          指示を読んで、必要なら直して、実行するものを選んでください。
          <br />
          選んだものを<b>まとめて1回</b>投げたときに、初めてコードが変わり PR が出ます。
          {project.repo_owner ? (
            <>
              {' '}
              対象: <code>{project.repo_owner}/{project.repo_name}</code>
            </>
          ) : (
            <span className="text-amber-700"> リポジトリが未設定です。実行できません。</span>
          )}
        </p>
      </div>

      <FixList projectId={id} rows={rows} />
    </div>
  );
}
