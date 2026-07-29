'use client';

import { useActionState } from 'react';
import { createProject, type CreateProjectState } from './actions';

const initial: CreateProjectState = {};

const input =
  'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:bg-white';

export function NewProjectForm() {
  const [state, action, pending] = useActionState(createProject, initial);

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
