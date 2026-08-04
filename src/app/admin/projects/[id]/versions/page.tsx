import Link from 'next/link';
import { getT } from '@/lib/i18n';
import { notFound } from 'next/navigation';
import { SNAPSHOTS_BUCKET } from '@/lib/env';
import { classify, type LayoutEntry } from '@/lib/layout-diff.mjs';
import { adminDb } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * 変更履歴（設計 11.2 / 画面G）
 *
 * ラウンドが confirmed / closed_auto になるたびに after スナップショットが
 * 1バージョンとして確定する。任意の2バージョンを比較でき、ページ別に
 * 「変更あり / なし」を表示する。**追加撮影は不要**。
 *
 * 比較にはレイアウトマップだけを使う。画像は読み込まないので軽い。
 * 一覧の粒度では 1440px で見る（全幅を見るのは差分ビュー側の仕事）。
 */
const COMPARE_VIEWPORT = 1440;

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function VersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const t = await getT();
  const { id } = await params;
  const { from, to } = await searchParams;
  const db = adminDb();

  const { data: project } = await db
    .from('projects')
    .select('id, name, client_name')
    .eq('id', id)
    .maybeSingle();
  if (!project) notFound();

  // バージョン = 確定した節目の撮影。initial と、確認済みラウンドの after。
  const { data: snaps } = await db
    .from('snapshots')
    .select('id, phase, taken_at, commit_sha, deploy_url, round_id, rounds(seq, status)')
    .eq('project_id', id)
    .eq('status', 'ready')
    .in('phase', ['initial', 'after'])
    .order('taken_at');

  type Snap = {
    id: string;
    phase: string;
    taken_at: string;
    commit_sha: string | null;
    round_id: string | null;
    rounds: { seq: number; status: string } | null;
  };
  const versions = ((snaps ?? []) as unknown as Snap[]).filter(
    (s) =>
      s.phase === 'initial' ||
      (s.rounds && ['confirmed', 'closed_auto', 'published'].includes(s.rounds.status)),
  );

  const label = (s: Snap) =>
    s.phase === 'initial' ? '公開時' : `ラウンド ${s.rounds?.seq ?? '?'} 完了`;

  // 比較
  let comparison: { page: string; changed: number; added: number; removed: number }[] | null = null;
  let compareError: string | null = null;

  if (from && to && from !== to) {
    try {
      const [bs, as] = await Promise.all([
        db
          .from('snapshot_shots')
          .select('page_path, layout_map_path')
          .eq('snapshot_id', from)
          .eq('viewport_w', COMPARE_VIEWPORT),
        db
          .from('snapshot_shots')
          .select('page_path, layout_map_path')
          .eq('snapshot_id', to)
          .eq('viewport_w', COMPARE_VIEWPORT),
      ]);

      const readMap = async (path: string): Promise<LayoutEntry[]> => {
        const { data } = await db.storage.from(SNAPSHOTS_BUCKET).download(path);
        if (!data) throw new Error(t('レイアウトマップを読めません'));
        return JSON.parse(await data.text());
      };

      comparison = [];
      for (const b of bs.data ?? []) {
        const a = (as.data ?? []).find((x) => x.page_path === b.page_path);
        if (!a) continue;
        const [bm, am] = await Promise.all([
          readMap(b.layout_map_path),
          readMap(a.layout_map_path),
        ]);
        const { diffs } = classify(bm, am);
        comparison.push({
          page: b.page_path,
          changed: diffs.filter((d) => d.kind === 'changed').length,
          added: diffs.filter((d) => d.kind === 'added').length,
          removed: diffs.filter((d) => d.kind === 'removed').length,
        });
      }
    } catch (e) {
      compareError = e instanceof Error ? e.message : t('比較に失敗しました');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/projects/${id}`} className="text-xs text-slate-400 hover:text-slate-600">
          ← {project.name}
        </Link>
        <h1 className="mt-1 text-lg font-bold">{t('変更履歴')}</h1>
        <p className="text-sm text-slate-500">
          ラウンドが確認済みになるたびに、その時点の撮影が1バージョンとして確定します。
          比較に追加の撮影は要りません。
        </p>
      </div>

      {versions.length < 1 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400">
          まだバージョンがありません。
          <br />
          <span className="text-xs">
            worker の snapshot.mjs で initial または after を撮ると出てきます。
          </span>
        </p>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-bold">{t('バージョン')}</h2>
          <ol className="relative space-y-0 border-l border-slate-200 pl-6">
            {versions.map((s, i) => (
              <li key={s.id} className="relative pb-5">
                <span className="absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full border-2 border-white bg-blue-600" />
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-bold">{label(s)}</span>
                  <span className="text-xs text-slate-400">{fmt(s.taken_at)}</span>
                  {s.commit_sha && (
                    <code className="rounded bg-slate-100 px-1.5 text-xs text-slate-500">
                      {s.commit_sha.slice(0, 7)}
                    </code>
                  )}
                  {i === versions.length - 1 && (
                    <span className="rounded-full bg-emerald-50 px-2 text-xs font-semibold text-emerald-700">
                      最新
                    </span>
                  )}
                </div>
                <div className="mt-1 flex gap-2 text-xs">
                  <Link
                    href={`?from=${s.id}&to=${to ?? versions[versions.length - 1].id}`}
                    className={from === s.id ? 'font-bold text-blue-700' : 'text-slate-500 hover:underline'}
                  >
                    ここから
                  </Link>
                  <Link
                    href={`?from=${from ?? versions[0].id}&to=${s.id}`}
                    className={to === s.id ? 'font-bold text-blue-700' : 'text-slate-500 hover:underline'}
                  >
                    ここまで
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {from && to && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-1 text-sm font-bold">{t('比較')}</h2>
          <p className="mb-4 text-xs text-slate-500">
            {COMPARE_VIEWPORT}px 幅のレイアウトマップで比較しています。
            レイアウトシフトだけの移動（moved）は差分に数えません（7.4）。
          </p>

          {compareError && <p className="text-sm text-red-600">{compareError}</p>}

          {comparison && comparison.length === 0 && (
            <p className="text-sm text-slate-500">
              比較できるページがありません（両方のバージョンに同じページの撮影が必要です）
            </p>
          )}

          {comparison && comparison.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-400">
                <tr>
                  <th className="py-1.5 font-medium">{t('ページ')}</th>
                  <th className="py-1.5 font-medium">{t('変更')}</th>
                  <th className="py-1.5 font-medium">{t('内訳')}</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((c) => {
                  const total = c.changed + c.added + c.removed;
                  return (
                    <tr key={c.page} className="border-t border-slate-100">
                      <td className="py-2.5 font-medium">{c.page}</td>
                      <td className="py-2.5">
                        {total > 0 ? (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                            変更あり
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                            変更なし
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-xs text-slate-500">
                        {total > 0
                          ? `変更 ${c.changed} / 追加 ${c.added} / 削除 ${c.removed}`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
