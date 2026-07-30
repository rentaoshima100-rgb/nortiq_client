import Link from 'next/link';
import { notFound } from 'next/navigation';
import { appUrl, ATTACHMENTS_BUCKET } from '@/lib/env';
import { describeTarget, positionInPage, siteViewUrl } from '@/lib/describe';
import { revokeInvite } from '@/app/admin/actions';
import { adminDb } from '@/lib/supabase/admin';
import type { Locator } from '@/lib/types';
import {
  CATEGORY_OPTIONS,
  FieldSelect,
  InviteIssuer,
  SnippetBox,
  STATUS_OPTIONS,
  SUBTYPE_OPTIONS,
} from './ui';

export const dynamic = 'force-dynamic';

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = adminDb();

  const { data: project } = await db.from('projects').select('*').eq('id', id).maybeSingle();
  if (!project) notFound();

  const [{ data: requests }, { data: sessions }] = await Promise.all([
    db
      .from('requests')
      .select(
        'id, seq, body, category, subtype, status, page_path, viewport_w, locator, outer_html, created_at',
      )
      .eq('project_id', id)
      .order('seq', { ascending: false })
      .limit(200),
    db
      .from('client_sessions')
      .select('token_hash, label, expires_at, revoked_at, last_used_at, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
  ]);

  const reqIds = (requests ?? []).map((r) => r.id);
  const attCount = new Map<string, number>();
  const firstAtt = new Map<string, { path: string; kind: string }>();
  const thumb = new Map<string, string>();

  if (reqIds.length) {
    const { data: atts } = await db
      .from('attachments')
      .select('request_id, storage_path, kind, created_at')
      .in('request_id', reqIds)
      .order('created_at');
    for (const a of atts ?? []) {
      attCount.set(a.request_id, (attCount.get(a.request_id) ?? 0) + 1);
      if (!firstAtt.has(a.request_id)) {
        firstAtt.set(a.request_id, { path: a.storage_path, kind: a.kind });
      }
    }
    // 一覧に出すサムネイルの署名URLは1回でまとめて発行する
    const paths = Array.from(firstAtt.values()).map((v) => v.path);
    if (paths.length) {
      const { data: urls } = await db.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrls(paths, 600);
      for (const u of urls ?? []) {
        if (u.signedUrl && u.path) thumb.set(u.path, u.signedUrl);
      }
    }
  }

  const snippet = `<script src="${appUrl()}/w.js" data-project="${project.snippet_key}" defer></script>`;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin" className="text-xs text-slate-400 hover:text-slate-600">
          ← 案件一覧
        </Link>
        <h1 className="mt-1 text-lg font-bold">{project.name}</h1>
        <p className="text-sm text-slate-500">
          {project.client_name} ／ {project.site_url}
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-1 text-sm font-bold">埋め込みスニペット</h2>
        <p className="mb-3 text-xs text-slate-500">
          サイトの &lt;/body&gt; の直前に置きます。招待トークンを持たない訪問者には
          何も描画されないため、本番に常設して構いません。
        </p>
        <SnippetBox snippet={snippet} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-1 text-sm font-bold">クライアントの招待</h2>
        <p className="mb-4 text-xs text-slate-500">
          トークンは sha256 でしか保存していないため、後から取り出すことはできません。
          紛失したら新しく発行して古いものを失効させてください。
        </p>
        <InviteIssuer projectId={project.id} />

        {sessions && sessions.length > 0 && (
          <table className="mt-5 w-full text-xs">
            <thead className="text-left text-slate-400">
              <tr>
                <th className="py-1.5 font-medium">メモ</th>
                <th className="py-1.5 font-medium">発行</th>
                <th className="py-1.5 font-medium">最終利用</th>
                <th className="py-1.5 font-medium">有効期限</th>
                <th className="py-1.5 font-medium">状態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.token_hash} className="border-t border-slate-100">
                  <td className="py-2">{s.label || '—'}</td>
                  <td className="py-2 text-slate-500">{fmt(s.created_at)}</td>
                  <td className="py-2 text-slate-500">
                    {s.last_used_at ? fmt(s.last_used_at) : '未使用'}
                  </td>
                  <td className="py-2 text-slate-500">
                    {s.expires_at ? fmt(s.expires_at) : '無期限'}
                  </td>
                  <td className="py-2">
                    {s.revoked_at ? (
                      <span className="text-slate-400">失効</span>
                    ) : (
                      <span className="text-emerald-600">有効</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {!s.revoked_at && (
                      <form action={revokeInvite}>
                        <input type="hidden" name="project_id" value={project.id} />
                        <input type="hidden" name="token_hash" value={s.token_hash} />
                        <button className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50">
                          失効させる
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold">
          修正依頼 <span className="text-slate-400">（{requests?.length ?? 0}件）</span>
        </h2>
        {requests && requests.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">内容</th>
                  <th className="px-3 py-2.5 font-medium">場所</th>
                  <th className="px-3 py-2.5 font-medium">種別</th>
                  <th className="px-3 py-2.5 font-medium">細目</th>
                  <th className="px-3 py-2.5 font-medium">状態</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const loc = r.locator as Locator;
                  const pos = positionInPage(loc);
                  const att = firstAtt.get(r.id);
                  const thumbUrl = att ? thumb.get(att.path) : undefined;
                  return (
                    <tr key={r.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-3 tabular-nums text-slate-400">{r.seq}</td>
                      <td className="px-3 py-3">
                        <div className="flex gap-3">
                          {thumbUrl && (
                            <a href={thumbUrl} target="_blank" rel="noreferrer" className="shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={thumbUrl}
                                alt=""
                                className="h-12 w-16 rounded border border-slate-200 bg-slate-50 object-cover"
                              />
                            </a>
                          )}
                          <div className="min-w-0">
                            <Link href={`/admin/requests/${r.id}`} className="hover:underline">
                              {r.body.length > 60 ? r.body.slice(0, 60) + '…' : r.body}
                            </Link>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                              <span>{fmt(r.created_at)}</span>
                              {att && (
                                <span
                                  className={
                                    att.kind === 'reference'
                                      ? 'rounded-full bg-amber-50 px-1.5 text-amber-700'
                                      : 'rounded-full bg-blue-50 px-1.5 text-blue-700'
                                  }
                                >
                                  {att.kind === 'reference' ? '参考イメージ' : '差し替え素材'}
                                  {(attCount.get(r.id) ?? 0) > 1 ? ` ×${attCount.get(r.id)}` : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">
                        <div className="font-medium text-slate-700">
                          {describeTarget(loc, r.outer_html)}
                        </div>
                        <div className="mt-0.5">
                          {r.page_path} ／ {pos.label}（上から {pos.percent}%）
                        </div>
                        <div className="text-slate-400">
                          {loc?.tag?.toLowerCase()}
                          {loc?.nqId ? ` · ${loc.nqId}` : ''}
                          {loc?.nqCount && loc.nqCount > 1 ? `[${loc.nqOrdinal}/${loc.nqCount}]` : ''}
                          {` · ${r.viewport_w}px幅で指摘`}
                        </div>
                        <a
                          href={siteViewUrl(project.site_url, r.page_path, r.seq)}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block font-medium text-blue-700 hover:underline"
                        >
                          サイトで見る →
                        </a>
                      </td>
                      <td className="px-3 py-3">
                        <FieldSelect
                          requestId={r.id}
                          field="category"
                          value={r.category}
                          options={CATEGORY_OPTIONS}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <FieldSelect
                          requestId={r.id}
                          field="subtype"
                          value={r.subtype}
                          options={SUBTYPE_OPTIONS}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <FieldSelect
                          requestId={r.id}
                          field="status"
                          value={r.status}
                          options={STATUS_OPTIONS}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400">
            まだ依頼がありません
          </p>
        )}
      </section>
    </div>
  );
}
