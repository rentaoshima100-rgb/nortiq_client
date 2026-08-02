'use client';

/**
 * スニペットをこちらから入れる。
 *
 * 押す前に「どのファイルをどう書き換えるか」を必ず見せる。他人のリポジトリを
 * 触るので、実行したあとに「何が起きたか分からない」状態を作らない。
 */
import { useState } from 'react';
import type { SnippetPlan } from '@/lib/snippet-install';

interface PlanRes {
  needsInstall: boolean;
  installUrl?: string | null;
  message?: string;
  owner?: string | null;
  repo?: string | null;
  mode?: 'pr' | 'direct';
  plan?: SnippetPlan;
}

interface ApplyRes {
  applied: boolean;
  message?: string;
  result?: { mode: 'pr' | 'direct'; url: string; commitSha: string; changed: string[] };
  plan?: SnippetPlan;
}

interface DeployRes {
  canInvite: boolean;
  reason: string | null;
  refUrl: string | null;
  live: { reachable: boolean; hasSnippet: boolean; snippetKey: string | null; nqIdCount: number };
  deploy: { state: string; url: string | null; environment: string | null } | null;
}

const btn = 'rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50';

export function SnippetInstall({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState<null | 'plan' | 'apply' | 'deploy'>(null);
  const [plan, setPlan] = useState<PlanRes | null>(null);
  const [applied, setApplied] = useState<ApplyRes | null>(null);
  const [deploy, setDeploy] = useState<DeployRes | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function call<T>(url: string, init?: RequestInit): Promise<T | null> {
    setErr(null);
    try {
      const r = await fetch(url, init);
      const j = (await r.json()) as T & { error?: string };
      if (!r.ok) {
        setErr(j.error ?? `失敗しました（${r.status}）`);
        return null;
      }
      return j;
    } catch (e) {
      setErr(e instanceof Error ? e.message : '通信に失敗しました');
      return null;
    }
  }

  async function doPlan() {
    setBusy('plan');
    setApplied(null);
    const j = await call<PlanRes>(`/api/admin/snippet?projectId=${projectId}`);
    if (j) setPlan(j);
    setBusy(null);
  }

  async function doApply() {
    setBusy('apply');
    const j = await call<ApplyRes>('/api/admin/snippet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    if (j) setApplied(j);
    setBusy(null);
  }

  async function doDeploy() {
    setBusy('deploy');
    const j = await call<DeployRes>(`/api/admin/deploy-status?projectId=${projectId}`);
    if (j) setDeploy(j);
    setBusy(null);
  }

  return (
    <div className="mt-5 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">こちらでリポジトリに入れる</span>
        <button onClick={doPlan} disabled={!!busy} className={`${btn} border border-slate-300`}>
          {busy === 'plan' ? '読んでいます…' : '何が変わるか見る'}
        </button>
        {err && <span className="text-sm text-amber-700">{err}</span>}
      </div>

      {plan?.needsInstall && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>{plan.message}</p>
          {plan.installUrl && (
            <p className="mt-1">
              <a className="underline" href={plan.installUrl} target="_blank" rel="noreferrer">
                インストール画面を開く
              </a>
              — この1回だけはリポジトリの管理者による承認が必要です。
            </p>
          )}
        </div>
      )}

      {plan && !plan.needsInstall && plan.plan && (
        <div className="mt-3 text-sm">
          <p className="text-slate-600">
            構成: <code className="text-xs">{plan.plan.stack}</code> ／ 反映のしかた:{' '}
            <strong>{plan.mode === 'direct' ? '直接コミット' : 'PR を出すだけ'}</strong>
            {plan.mode !== 'direct' && (
              <span className="text-slate-500">（マージは先方が行います）</span>
            )}
          </p>

          {plan.plan.files.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {plan.plan.files.map((f) => (
                <li key={f.path} className="text-slate-700">
                  <code className="text-xs">{f.path}</code>
                  <span className="ml-2 text-xs text-slate-500">{f.note}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-slate-500">書き換えるファイルはありません。</p>
          )}

          {plan.plan.skipped.length > 0 && (
            <ul className="mt-2 space-y-1">
              {plan.plan.skipped.map((s) => (
                <li key={s.path} className="text-xs text-slate-500">
                  <code>{s.path}</code> — {s.reason}
                </li>
              ))}
            </ul>
          )}

          {plan.plan.originCandidates.length > 0 && (
            <p className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              リポジトリの HTML が名乗っているオリジン:{' '}
              {plan.plan.originCandidates.map((o) => (
                <code key={o} className="mr-2">
                  {o}
                </code>
              ))}
              <br />
              登録済みのオリジンと違う場合、独自ドメインに切り替えた時点で依頼が送れなくなります。
              両方登録しておいてください。
            </p>
          )}

          {plan.plan.treeTruncated && (
            <p className="mt-2 text-xs text-amber-700">
              リポジトリが大きく、ファイル一覧が GitHub 側で打ち切られました。挿入先の取りこぼしがある可能性があります。
            </p>
          )}

          {plan.plan.files.length > 0 && (
            <button
              onClick={doApply}
              disabled={!!busy}
              className={`${btn} mt-3 bg-slate-900 text-white`}
            >
              {busy === 'apply'
                ? '書き込んでいます…'
                : plan.mode === 'direct'
                  ? 'コミットする'
                  : 'PR を出す'}
            </button>
          )}
        </div>
      )}

      {applied && (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          {applied.applied && applied.result ? (
            <>
              <p>
                {applied.result.mode === 'pr' ? 'PR を出しました' : 'コミットしました'} —{' '}
                <a
                  className="underline"
                  href={applied.result.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub で開く
                </a>
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {applied.result.mode === 'pr'
                  ? 'マージされて本番に出るまで、招待は送らないでください。'
                  : 'デプロイが終わるまで数分かかります。下で確認してから招待してください。'}
              </p>
            </>
          ) : (
            <p>{applied.message ?? '変更はありませんでした。'}</p>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-slate-200 pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">本番に出たか確認する</span>
          <button onClick={doDeploy} disabled={!!busy} className={`${btn} border border-slate-300`}>
            {busy === 'deploy' ? '見ています…' : '確認'}
          </button>
        </div>
        {deploy && (
          <div
            className={
              'mt-2 rounded border px-3 py-2 text-sm ' +
              (deploy.canInvite
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-amber-200 bg-amber-50 text-amber-900')
            }
          >
            {deploy.canInvite ? (
              <p>
                <strong>本番に出ています。招待を送れます。</strong>
                {deploy.live.nqIdCount > 0 && (
                  <span className="ml-2 text-xs">
                    data-nq-id も {deploy.live.nqIdCount} 箇所入っています
                  </span>
                )}
              </p>
            ) : (
              <>
                <p>
                  <strong>まだ招待を送らないでください。</strong> {deploy.reason}
                </p>
                {deploy.deploy && (
                  <p className="mt-1 text-xs">
                    デプロイ: {deploy.deploy.environment ?? '—'} / {deploy.deploy.state}
                  </p>
                )}
                {deploy.refUrl && (
                  <p className="mt-1 text-xs">
                    <a className="underline" href={deploy.refUrl} target="_blank" rel="noreferrer">
                      出した PR / コミットを見る
                    </a>
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
