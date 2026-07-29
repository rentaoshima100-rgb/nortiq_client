import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ATTACHMENTS_BUCKET } from '@/lib/env';
import { adminDb } from '@/lib/supabase/admin';
import type { AttachmentRow, Locator, MatchedRule, RequestRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 border-t border-slate-100 py-2 text-sm">
      <div className="w-32 shrink-0 text-xs text-slate-400">{label}</div>
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = adminDb();

  const { data } = await db.from('requests').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const req = data as RequestRow;
  const loc = req.locator as Locator;

  const [{ data: atts }, { data: events }, { data: project }] = await Promise.all([
    db.from('attachments').select('*').eq('request_id', id).order('created_at'),
    db
      .from('events')
      .select('id, action, actor_type, actor_id, before, after, at')
      .eq('entity', 'request')
      .eq('entity_id', id)
      .order('at', { ascending: false })
      .limit(50),
    db.from('projects').select('id, name').eq('id', req.project_id).maybeSingle(),
  ]);

  const files: { att: AttachmentRow; url: string | null }[] = [];
  for (const a of (atts ?? []) as AttachmentRow[]) {
    const { data: signed } = await db.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(a.storage_path, 600);
    files.push({ att: a, url: signed?.signedUrl ?? null });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/admin/projects/${req.project_id}`}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          ← {project?.name ?? '案件'}
        </Link>
        <h1 className="mt-1 text-lg font-bold">依頼 #{req.seq}</h1>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <p className="whitespace-pre-wrap text-sm">{req.body}</p>
        <div className="mt-4">
          <Row label="受付">{fmt(req.created_at)}</Row>
          <Row label="ページ">{req.page_path}</Row>
          <Row label="ビューポート">
            {req.viewport_w} × {req.viewport_h} / scrollY {req.scroll_y}
          </Row>
          <Row label="種別">
            {req.category} {req.subtype ? `／ ${req.subtype}` : ''}（{req.status}）
          </Row>
          <Row label="site_sha">
            {req.site_sha ? (
              <code className="text-xs">{req.site_sha}</code>
            ) : (
              <span className="text-xs text-amber-600">
                未取得（meta name=&quot;nq-sha&quot; がページに無い。9.3）
              </span>
            )}
          </Row>
        </div>
      </section>

      {files.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-bold">添付</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {files.map(({ att, url }) => (
              <div key={att.id} className="rounded-lg border border-slate-200 p-3">
                {url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={att.filename}
                    className="mb-2 h-40 w-full rounded object-contain bg-slate-50"
                  />
                )}
                <div className="text-xs font-medium">{att.filename}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {att.mime} ／ {att.width ?? '?'}×{att.height ?? '?'} ／{' '}
                  {(att.bytes / 1024).toFixed(0)} KB
                </div>
                <div className="mt-2">
                  {att.kind === 'material' ? (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                      素材（差し替えたい）
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                      参考イメージ → 仕様変更の候補
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-bold">ロケータ（6.7）</h2>
        <Row label="nq-id">
          {loc.nqId ? (
            <>
              <code>{loc.nqId}</code>
              {loc.nqCount && loc.nqCount > 1 ? (
                <span className="ml-2 text-xs text-amber-600">
                  同一 nq-id が {loc.nqCount} 個（序数 {loc.nqOrdinal}）— ループ描画
                </span>
              ) : (
                <span className="ml-2 text-xs text-emerald-600">文書内で一意</span>
              )}
            </>
          ) : (
            <span className="text-xs text-slate-400">なし（注入されていない）</span>
          )}
        </Row>
        <Row label="tag">{loc.tag}</Row>
        <Row label="textSample">{loc.textSample || <span className="text-slate-400">—</span>}</Row>
        <Row label="textHash">
          <code className="text-xs">{loc.textHash ?? '—'}</code>
        </Row>
        <Row label="cssPath">
          <code className="text-xs">{loc.cssPath}</code>
        </Row>
        <Row label="bbox">
          {loc.bbox.x}, {loc.bbox.y} / {loc.bbox.w}×{loc.bbox.h}（viewportW {loc.viewportW}）
        </Row>
        {req.target && (
          <>
            <Row label="src属性">
              <code className="text-xs">{req.target.srcAttr ?? '—'}</code>
            </Row>
            <Row label="srcset">
              <code className="text-xs">{req.target.srcset ?? '—'}</code>
              {req.target.srcset && (
                <div className="mt-1 text-xs text-amber-600">
                  変種あり。差し替えは全変種が対象（9.10 手順1b）
                </div>
              )}
            </Row>
            <Row label="currentSrc">
              <code className="text-xs">{req.target.currentSrc ?? '—'}</code>
            </Row>
            <Row label="原寸">
              {req.target.naturalW ?? '?'} × {req.target.naturalH ?? '?'}
            </Row>
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-bold">要素の現在値</h2>
        <div className="grid grid-cols-2 gap-x-6 text-xs sm:grid-cols-3">
          {Object.entries(req.computed ?? {}).map(([k, v]) => (
            <div key={k} className="border-t border-slate-100 py-1.5">
              <span className="text-slate-400">{k}</span>
              <div className="font-mono">{v}</div>
            </div>
          ))}
        </div>

        <h3 className="mb-2 mt-5 text-xs font-bold text-slate-500">
          適用中のCSS（9.4・編集対象ではない）
        </h3>
        <div className="space-y-1">
          {((req.css_rules ?? []) as MatchedRule[]).map((r, i) => (
            <div key={i} className="rounded bg-slate-50 px-3 py-2 text-xs">
              <div className="font-mono text-blue-700">{r.selector}</div>
              <div className="font-mono text-slate-500">{r.cssText}</div>
              {r.href && <div className="mt-0.5 text-slate-400">{r.href}</div>}
            </div>
          ))}
          {(req.css_rules ?? []).length === 0 && (
            <p className="text-xs text-slate-400">採取できたルールがありません</p>
          )}
        </div>

        <h3 className="mb-2 mt-5 text-xs font-bold text-slate-500">outerHTML</h3>
        <pre className="overflow-x-auto rounded bg-slate-900 px-3 py-2 text-xs text-slate-100">
          {req.outer_html ?? '—'}
        </pre>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-bold">監査ログ（5.2）</h2>
        <div className="space-y-2">
          {(events ?? []).map((e) => (
            <div key={e.id} className="border-t border-slate-100 py-2 text-xs">
              <div className="flex gap-2">
                <span className="font-medium">{e.action}</span>
                <span className="text-slate-400">{e.actor_type}</span>
                <span className="ml-auto text-slate-400">{fmt(e.at)}</span>
              </div>
              {(e.before || e.after) && (
                <pre className="mt-1 overflow-x-auto text-slate-500">
                  {JSON.stringify({ before: e.before, after: e.after })}
                </pre>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
