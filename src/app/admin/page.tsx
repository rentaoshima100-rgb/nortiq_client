import Link from 'next/link';
import { adminDb } from '@/lib/supabase/admin';
import { NewProjectForm } from './new-project-form';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const db = adminDb();
  const { data: projects } = await db
    .from('projects')
    .select('id, name, client_name, site_url, snippet_key, stack, has_nq_id, created_at')
    .order('created_at', { ascending: false });

  const ids = (projects ?? []).map((p) => p.id);
  const counts = new Map<string, number>();
  if (ids.length) {
    const { data: reqs } = await db.from('requests').select('project_id').in('project_id', ids);
    for (const r of reqs ?? []) counts.set(r.project_id, (counts.get(r.project_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-4 text-lg font-bold">案件</h1>
        {projects && projects.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">案件</th>
                  <th className="px-4 py-2.5 font-medium">サイト</th>
                  <th className="px-4 py-2.5 font-medium">スニペットキー</th>
                  <th className="px-4 py-2.5 font-medium">依頼</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/projects/${p.id}`} className="font-medium text-blue-700">
                        {p.name}
                      </Link>
                      <div className="text-xs text-slate-400">{p.client_name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{p.site_url}</td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                        {p.snippet_key}
                      </code>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{counts.get(p.id) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400">
            まだ案件がありません
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-bold">案件を追加</h2>
        <NewProjectForm />
      </section>
    </div>
  );
}
