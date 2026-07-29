'use client';

import { useActionState } from 'react';
import { signIn, type LoginState } from './actions';

const initial: LoginState = {};

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <form action={action} className="space-y-4">
      {notice && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{notice}</p>
      )}
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">メールアドレス</label>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:bg-white"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">パスワード</label>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:bg-white"
        />
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? 'ログイン中…' : 'ログイン'}
      </button>
    </form>
  );
}
