import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ATTACHMENTS_BUCKET, SNAPSHOTS_BUCKET } from '@/lib/env';
import { describeTarget, positionInPage, siteViewUrl } from '@/lib/describe';
import { adminDb } from '@/lib/supabase/admin';
import type { AttachmentRow, Locator, MatchedRule, RequestRow } from '@/lib/types';
import {
  GenerateButton,
  ProposalCard,
  ResearchPanel,
  type BatchView,
  type ProposalView,
} from './design-ui';
import { AutoFixMark, StaffAttach, type AutoJob } from './staff-ui';

export const dynamic = 'force-dynamic';

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * ページのどこを指しているかの見取り図。
 * 縦がページ全体（docHeight）、横がビューポート幅。青い矩形が指摘された要素。
 * Phase 1 のスナップショットが入るまで、社内が「どこ」を掴む唯一の手段になる。
 */
function PositionMap({ loc }: { loc: Locator }) {
  const H = 200;
  const docH = Math.max(1, loc.docHeight);
  const vw = Math.max(1, loc.viewportW);
  const top = Math.min(H - 3, Math.max(0, (loc.bbox.y / docH) * H));
  const h = Math.max(3, Math.min(H - top, (loc.bbox.h / docH) * H));
  const left = Math.min(97, Math.max(0, (loc.bbox.x / vw) * 100));
  const w = Math.max(3, Math.min(100 - left, (loc.bbox.w / vw) * 100));

  return (
    <div
      className="relative w-32 shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-100"
      style={{ height: H }}
      title={`ページ全体 ${docH}px 中 y=${loc.bbox.y}px`}
    >
      <div
        className="absolute rounded-sm bg-blue-600/70 ring-2 ring-blue-600"
        style={{ top: `${top}px`, height: `${h}px`, left: `${left}%`, width: `${w}%` }}
      />
    </div>
  );
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
  const pos = positionInPage(loc);

  const [{ data: atts }, { data: events }, { data: project }] = await Promise.all([
    db.from('attachments').select('*').eq('request_id', id).order('created_at'),
    db
      .from('events')
      .select('id, action, actor_type, actor_id, before, after, at')
      .eq('entity', 'request')
      .eq('entity_id', id)
      .order('at', { ascending: false })
      .limit(50),
    db.from('projects').select('id, name, site_url').eq('id', req.project_id).maybeSingle(),
  ]);

  // 切り出し（7.1）。全スナップショット分を時系列で並べる = 画面F の前後ビュー。
  type ShotRow = {
    crop_path: string | null;
    match_tier: string | null;
    viewport_w: number | null;
    snapshots: { phase: string; taken_at: string; deploy_url: string | null } | null;
  };
  const { data: rawShots } = await db
    .from('request_shots')
    .select('crop_path, match_tier, viewport_w, snapshots(phase, taken_at, deploy_url)')
    .eq('request_id', id);

  const PHASE_ORDER: Record<string, number> = { initial: 0, before: 1, preview: 2, after: 3 };
  const shots = ((rawShots ?? []) as unknown as ShotRow[])
    .filter((s) => s.crop_path)
    .sort((a, b) => {
      const t = (a.snapshots?.taken_at ?? '').localeCompare(b.snapshots?.taken_at ?? '');
      return t !== 0
        ? t
        : (PHASE_ORDER[a.snapshots?.phase ?? ''] ?? 9) - (PHASE_ORDER[b.snapshots?.phase ?? ''] ?? 9);
    });

  const cropUrls = new Map<string, string>();
  if (shots.length) {
    const { data: signed } = await db.storage
      .from(SNAPSHOTS_BUCKET)
      .createSignedUrls(
        shots.map((s) => s.crop_path as string),
        600,
      );
    for (const u of signed ?? []) if (u.signedUrl && u.path) cropUrls.set(u.path, u.signedUrl);
  }
  const shot = shots[shots.length - 1];
  const cropUrl = shot?.crop_path ? (cropUrls.get(shot.crop_path) ?? null) : null;

  const files: { att: AttachmentRow; url: string | null }[] = [];
  for (const a of (atts ?? []) as AttachmentRow[]) {
    const { data: signed } = await db.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(a.storage_path, 600);
    files.push({ att: a, url: signed?.signedUrl ?? null });
  }

  // 自動で当てた跡。無いと社内が二重に作業する
  const { data: autoJobs } = await db
    .from('ai_jobs')
    .select('status, summary, pr_url, pr_number, merged_at, created_at')
    .eq('request_id', req.id)
    .eq('patch_kind', 'text')
    .order('created_at', { ascending: false })
    .limit(1);
  const autoJob = (autoJobs?.[0] as AutoJob | undefined) ?? null;

  // 参考デザイン案。最新の世代だけを出す（過去の世代は残るが画面には出さない）
  const { data: allProposals } = await db
    .from('design_proposals')
    .select('id, batch, variant, direction, title, rationale')
    .eq('request_id', req.id)
    .order('batch', { ascending: false })
    .order('variant', { ascending: true });
  const latestBatch = allProposals?.[0]?.batch ?? null;
  const proposals: ProposalView[] = ((allProposals ?? []) as (ProposalView & { batch: number })[])
    .filter((p) => p.batch === latestBatch)
    .sort((a, b) => a.variant - b.variant);

  let batchView: BatchView | null = null;
  if (latestBatch != null) {
    const { data: bt } = await db
      .from('design_batches')
      .select('client_spec, brief, sources')
      .eq('request_id', req.id)
      .eq('batch', latestBatch)
      .maybeSingle();
    if (bt) {
      batchView = {
        clientSpec: bt.client_spec,
        brief: bt.brief,
        sources: (bt.sources as { title: string; url: string }[] | null) ?? [],
      };
    }
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

      {autoJob && (
        <div>
          <AutoFixMark job={autoJob} />
        </div>
      )}

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

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold">どこの話か</h2>
          {project?.site_url && (
            <a
              href={siteViewUrl(project.site_url, req.page_path, req.seq)}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              サイトで見る →
            </a>
          )}
        </div>
        {shots.length > 0 && (
          <div className="mb-5">
            {/* 2枚以上あれば前後比較として並べる（画面F）*/}
            <div className={shots.length > 1 ? 'grid gap-3 sm:grid-cols-2' : ''}>
              {(shots.length > 1 ? shots.slice(-2) : shots).map((s, i, arr) => {
                const u = s.crop_path ? cropUrls.get(s.crop_path) : null;
                if (!u) return null;
                const isAfter = arr.length > 1 && i === arr.length - 1;
                return (
                  <figure key={s.crop_path}>
                    <figcaption className="mb-1 flex items-center gap-2 text-xs">
                      <span
                        className={
                          isAfter
                            ? 'rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700'
                            : 'rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600'
                        }
                      >
                        {arr.length > 1 ? (isAfter ? '変更後' : '変更前') : '現在'} ／{' '}
                        {s.snapshots?.phase}
                      </span>
                      <span className="text-slate-400">
                        {s.snapshots?.taken_at ? fmt(s.snapshots.taken_at) : ''} ／ {s.viewport_w}px
                      </span>
                    </figcaption>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u}
                      alt="指摘箇所の切り出し"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50"
                    />
                  </figure>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              全体撮影からピン座標で切り出したもの（7.1）。照合は{' '}
              <span
                className={
                  shot?.match_tier === 'confirmed'
                    ? 'font-semibold text-emerald-700'
                    : shot?.match_tier === 'provisional'
                      ? 'font-semibold text-amber-700'
                      : 'font-semibold text-slate-600'
                }
              >
                {shot?.match_tier}
              </span>
              {shot?.match_tier === 'provisional' &&
                '（本文・画像の src・リンクの行き先・クラス込みの経路のいずれかで一つに決めています。nq-id を注入すると confirmed に上がります）'}
              {(shot?.match_tier === 'weak' || shot?.match_tier === 'stale') &&
                '（決め手が無く、経路と座標で当てています。別の要素を指している可能性があります）'}
              {shots.length > 2 && ` ／ 撮影 ${shots.length} 回のうち直近2回を表示`}
            </p>
          </div>
        )}

        <div className="flex gap-5">
          <PositionMap loc={loc} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-sm font-medium">{describeTarget(loc, req.outer_html)}</p>
            <p className="text-xs text-slate-500">
              {req.page_path} ／ {pos.label}（ページの上から {pos.percent}%）
            </p>
            <p className="text-xs text-slate-500">
              指摘時のビューポート {req.viewport_w}×{req.viewport_h} ／ スクロール位置{' '}
              {req.scroll_y}px ／ ページ全体 {loc.docHeight}px
            </p>
            <p className="text-xs text-slate-400">
              要素の大きさ {loc.bbox.w}×{loc.bbox.h}px（左から {loc.bbox.x}px・上から {loc.bbox.y}
              px）
            </p>
            <p className="pt-2 text-xs text-slate-400">
              「サイトで見る」は、その箇所までスクロールしてピンを光らせます。開く側にも招待トークンが要るので、
              持っていなければ案件画面で自分宛てに1本発行してください。
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-bold">添付</h2>
        {files.length > 0 && (
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
        )}
        {files.length === 0 && (
          <p className="text-xs text-slate-400">添付はありません。</p>
        )}
        <StaffAttach requestId={req.id} />
      </section>

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
        <h2 className="text-sm font-bold">参考デザイン</h2>
        <p className="mt-1 mb-4 text-xs leading-relaxed text-slate-500">
          社内の検討用です。サイトには何も適用されません。
          <br />
          先に構成の似ている実例を調べ、その型に沿って3案作ります。施主の指定があればそちらが優先されます。
          <br />
          持ち帰って提示する前に、必ず中身を確認してください。
        </p>

        <GenerateButton requestId={req.id} again={proposals.length > 0} />

        {batchView && <ResearchPanel b={batchView} />}

        {proposals.length > 0 && (
          <div className="mt-5 space-y-4">
            {proposals.map((p) => (
              <ProposalCard key={p.id} p={p} />
            ))}
          </div>
        )}
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
