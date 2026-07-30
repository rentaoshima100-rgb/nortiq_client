import Link from 'next/link';
import { notFound } from 'next/navigation';
import { appUrl, ATTACHMENTS_BUCKET } from '@/lib/env';
import { describeTarget, positionInPage, siteViewUrl } from '@/lib/describe';
import { revokeInvite, roundAdvance, roundOpen, roundToggleFree } from '@/app/admin/actions';
import {
  daysUntil,
  jaFreezeReason,
  jaStatus,
  runDueTransitions,
  usedFreeRounds,
  type RoundRow,
} from '@/lib/rounds';
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

function RoundButton({
  projectId,
  roundId,
  to,
  label,
  primary,
}: {
  projectId: string;
  roundId: string;
  to: 'in_progress' | 'published' | 'frozen';
  label: string;
  primary?: boolean;
}) {
  return (
    <form action={roundAdvance}>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="round_id" value={roundId} />
      <input type="hidden" name="to" value={to} />
      <button
        className={
          primary
            ? 'rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700'
            : 'rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50'
        }
      >
        {label}
      </button>
    </form>
  );
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = adminDb();

  const { data: project } = await db.from('projects').select('*').eq('id', id).maybeSingle();
  if (!project) notFound();

  // 期限切れのフリーズ・自動確認に追いついてから描く（8.2 / 8.6）
  await runDueTransitions(id, db);

  const [{ data: rounds }, usedFree] = await Promise.all([
    db
      .from('rounds')
      .select('*')
      .eq('project_id', id)
      .order('seq', { ascending: false })
      .limit(20),
    usedFreeRounds(id, db),
  ]);
  const active = (rounds ?? []).find((r) =>
    ['open', 'frozen', 'in_progress', 'published'].includes(r.status),
  ) as RoundRow | undefined;

  const { count: carriedOver } = await db
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', id)
    .is('round_id', null);

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

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-bold">ラウンド</h2>
          <div className="text-xs text-slate-500">
            無償修正{' '}
            <span
              className={
                usedFree >= project.free_rounds
                  ? 'font-bold text-amber-700'
                  : 'font-bold text-slate-800'
              }
            >
              {usedFree} / {project.free_rounds}
            </span>{' '}
            使用
            {usedFree >= project.free_rounds && '（以降は有償）'}
          </div>
        </div>

        {active ? (
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold">ラウンド {active.seq}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                {jaStatus(active.status)}
              </span>
              {!active.counts_free && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  有償（カウント外）
                </span>
              )}
              {active.reject_count > 0 && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                  差し戻し {active.reject_count} 回
                </span>
              )}
            </div>

            <div className="mt-2 space-y-0.5 text-xs text-slate-500">
              {active.status === 'open' && (
                <p>
                  受付中 ／ あと {daysUntil(active.freeze_due_at) ?? '—'} 日 新規依頼が無ければ自動で締切
                  ／ 上限 {project.max_items_per_round} 件で即時締切
                </p>
              )}
              {active.frozen_at && <p>締切: {fmt(active.frozen_at)}（{jaFreezeReason(active.freeze_reason)}）</p>}
              {active.published_at && (
                <p>
                  公開: {fmt(active.published_at)} ／ 自動確認まで あと{' '}
                  {daysUntil(active.confirm_due_at) ?? '—'} 日
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {active.status === 'open' && (
                <RoundButton projectId={project.id} roundId={active.id} to="frozen" label="受付を締め切る" primary />
              )}
              {active.status === 'frozen' && (
                <RoundButton projectId={project.id} roundId={active.id} to="in_progress" label="修正に着手" primary />
              )}
              {active.status === 'in_progress' && (
                <RoundButton
                  projectId={project.id}
                  roundId={active.id}
                  to="published"
                  label="公開した（確認依頼を出す）"
                  primary
                />
              )}
              {active.status === 'in_progress' && (
                <RoundButton projectId={project.id} roundId={active.id} to="frozen" label="着手前に戻す" />
              )}
              <form action={roundToggleFree}>
                <input type="hidden" name="project_id" value={project.id} />
                <input type="hidden" name="round_id" value={active.id} />
                <input type="hidden" name="value" value={String(!active.counts_free)} />
                <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                  {active.counts_free ? '無償カウントから外す' : '無償カウントに戻す'}
                </button>
              </form>
            </div>

            {active.status === 'in_progress' && (
              <p className="mt-3 text-xs text-slate-400">
                公開はクライアントへの確認依頼を意味します。Phase 1 以降は、ここに
                「全ジョブが終端」「差分に intended=false が無い」という条件が加わります（9.8）。
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
            <p className="text-sm text-slate-500">進行中のラウンドはありません</p>
            {(carriedOver ?? 0) > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                持ち越しの依頼が {carriedOver} 件あります。ラウンドを開くと引き取ります。
              </p>
            )}
            <form action={roundOpen} className="mt-3">
              <input type="hidden" name="project_id" value={project.id} />
              <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                ラウンドを開く
              </button>
            </form>
          </div>
        )}

        {rounds && rounds.length > 0 && (
          <table className="mt-5 w-full text-xs">
            <thead className="text-left text-slate-400">
              <tr>
                <th className="py-1.5 font-medium">#</th>
                <th className="py-1.5 font-medium">状態</th>
                <th className="py-1.5 font-medium">カウント</th>
                <th className="py-1.5 font-medium">締切</th>
                <th className="py-1.5 font-medium">公開</th>
                <th className="py-1.5 font-medium">確認</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-2 tabular-nums">{r.seq}</td>
                  <td className="py-2">{jaStatus(r.status)}</td>
                  <td className="py-2">
                    {r.counts_free ? (
                      <span className="text-slate-600">無償に算入</span>
                    ) : (
                      <span className="text-amber-700">カウント外</span>
                    )}
                  </td>
                  <td className="py-2 text-slate-500">
                    {r.frozen_at ? fmt(r.frozen_at) : '—'}
                  </td>
                  <td className="py-2 text-slate-500">
                    {r.published_at ? fmt(r.published_at) : '—'}
                  </td>
                  <td className="py-2 text-slate-500">
                    {r.confirmed_at ? fmt(r.confirmed_at) : '—'}
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
