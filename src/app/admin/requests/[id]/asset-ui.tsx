'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n-client';

interface Plan {
  seq: number;
  srcAttr: string | null;
  file: string | null;
  how: string;
  candidates: string[];
  attachment: { id: string; filename: string; mime: string; bytes: number } | null;
  problem: string | null;
}

/**
 * 写真の差し替え → PR。
 *
 * 2段。**まず下見**（どのファイルが置き換わるか）を出し、社内が見てから
 * PR を出す。他人のリポジトリの画像を、確認なしに置き換えたくない。
 *
 * 候補が複数あるときは選ばせる。同じ名前の画像が複数の場所にあるのは
 * 普通で、取り違えると別のページが変わる。
 */
export function AssetSwap({ requestId }: { requestId: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<'plan' | 'apply' | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);

  /** Vercel のエラーページは JSON ではない。先に本文で受ける */
  async function readJson(res: Response) {
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {
        message:
          res.status === 504
            ? t('時間内に終わりませんでした（504）')
            : t('応答が不正です（{status}）', { status: res.status }),
      };
    }
  }

  async function look() {
    setBusy('plan');
    setMsg(null);
    setPrUrl(null);
    try {
      const j = await readJson(await fetch(`/api/admin/asset-swap?requestId=${requestId}`));
      setPlan((j.plan as Plan) ?? null);
      setPick(((j.plan as Plan) ?? null)?.file ?? null);
      setMsg(String(j.message ?? j.error ?? ''));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('通信に失敗しました'));
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setBusy('apply');
    setMsg(null);
    try {
      const j = await readJson(
        await fetch('/api/admin/asset-swap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, file: pick ?? undefined }),
        }),
      );
      setMsg(String(j.message ?? j.error ?? ''));
      setPrUrl((j.prUrl as string) ?? null);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('通信に失敗しました'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-bold">{t('写真を差し替える')}</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        {t('クライアントが「素材」として送った画像で、リポジトリの元ファイルを置き換える PR を出します。差し替え先は依頼時に押された img の src で決まっているので、推測はしません。')}
        <b>{t('自動マージはしません。')}</b>
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={look}
          disabled={busy !== null}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {busy === 'plan' ? t('リポジトリを見ています…') : t('差し替え先を調べる')}
        </button>
        {plan && (plan.file || pick) && plan.attachment && (
          <button
            onClick={apply}
            disabled={busy !== null}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy === 'apply' ? t('PR を作っています…') : t('この内容で PR を出す')}
          </button>
        )}
        {msg && <span className="text-xs text-slate-600">{msg}</span>}
        {prUrl && (
          <a href={prUrl} target="_blank" rel="noreferrer" className="text-xs text-green-700 underline">
            {t('PR を開く')}
          </a>
        )}
      </div>

      {plan && (
        <dl className="mt-4 space-y-1 text-xs">
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-slate-400">{t('元ファイル')}</dt>
            <dd>
              {plan.file ? (
                <>
                  <code className="text-slate-700">{plan.file}</code>
                  {/* ファイル名だけで当てたものは、別のページの画像かもしれない。
                      当て方を出しておかないと、社内が確認する材料が無い */}
                  {plan.how === 'basename' && (
                    <span className="ml-2 text-amber-700">
                      {t('ファイル名だけで当てています。念のため中身を確認してください')}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-amber-700">{t('決まっていません')}</span>
              )}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-slate-400">{t('参照元の src')}</dt>
            <dd>
              <code className="text-slate-500">{plan.srcAttr ?? '—'}</code>
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-slate-400">{t('差し替える画像')}</dt>
            <dd className="text-slate-700">
              {plan.attachment
                ? `${plan.attachment.filename} · ${Math.round(plan.attachment.bytes / 1024)} KB`
                : t('ありません')}
            </dd>
          </div>

          {/* 候補が複数。同名の画像が別の場所にあるのは普通なので、人が決める */}
          {!plan.file && plan.candidates.length > 0 && (
            <div className="flex gap-3 pt-2">
              <dt className="w-28 shrink-0 text-slate-400">{t('候補')}</dt>
              <dd className="space-y-1">
                {plan.candidates.map((c) => (
                  <label key={c} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="swap-file"
                      checked={pick === c}
                      onChange={() => setPick(c)}
                    />
                    <code className="text-slate-700">{c}</code>
                  </label>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
