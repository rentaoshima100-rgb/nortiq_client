'use client';

import { useActionState, useEffect, useState } from 'react';
import { createProject, type CreateProjectState } from './actions';

const initial: CreateProjectState = {};

const input =
  'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:bg-white';

interface RepoList {
  repos?: { fullName: string; defaultBranch: string; installationId: number }[];
  installUrl?: string | null;
  error?: string;
}

export function NewProjectForm() {
  const [state, action, pending] = useActionState(createProject, initial);
  const [repoList, setRepoList] = useState<RepoList | null>(null);

  // App が触れるリポジトリを先に出しておく。案件を作る操作の中で
  // 「サイト側の準備」まで終わらせるため、ここで選べる必要がある。
  useEffect(() => {
    let alive = true;
    fetch('/api/admin/github/repos')
      .then((r) => r.json())
      .then((j: RepoList) => alive && setRepoList(j))
      .catch(() => alive && setRepoList({ error: 'リポジトリ一覧を取得できませんでした' }));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">案件名</label>
        <input name="name" required placeholder="ループ建設 コーポレートサイト" className={input} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">クライアント名</label>
        <input name="client_name" required placeholder="株式会社ループ建設" className={input} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          サイトURL（本番のオリジン）
        </label>
        <input
          name="site_url"
          required
          type="url"
          placeholder="https://loop-construction.jp"
          className={input}
        />
        <p className="mt-1 text-xs text-slate-400">
          CORS の許可オリジンになります。パスは無視されます。
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">スニペットキー</label>
          <input name="snippet_key" required placeholder="loop-2026" className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">スタック</label>
          <select name="stack" defaultValue="static" className={input}>
            <option value="static">静的HTML</option>
            <option value="next">Next.js / Vite</option>
            <option value="single-file">単一 index.html</option>
          </select>
        </div>
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium text-slate-600">
          リポジトリ（任意）
        </label>
        <select name="repo" defaultValue="" className={input}>
          <option value="">選ばない（サイト側は手で入れる）</option>
          {repoList?.repos?.map((r) => (
            <option key={r.fullName} value={r.fullName}>
              {r.fullName}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-400">
          {repoList == null
            ? 'リポジトリを読み込んでいます…'
            : repoList.error
              ? repoList.error
              : repoList.repos?.length
                ? '選ぶと、案件の作成と同時にスニペットを入れます。'
                : 'App が入ったリポジトリがありません。'}
          {repoList?.installUrl && (
            <>
              {' '}
              <a
                className="underline"
                href={repoList.installUrl}
                target="_blank"
                rel="noreferrer"
              >
                GitHub App を入れる
              </a>
              — この1回だけはリポジトリの管理者の承認が必要です。
            </>
          )}
        </p>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" name="allow_direct_commit" />
          既定のブランチに直接コミットする（外すと PR を出すだけ。他人のリポジトリでは外したまま）
        </label>
      </div>

      {state.error && <p className="text-sm text-red-600 sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2">
        <button
          disabled={pending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? '作成中…' : '案件を作成'}
        </button>
      </div>
    </form>
  );
}
