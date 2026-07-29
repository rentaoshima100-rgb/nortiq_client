'use client';

import { useActionState, useState } from 'react';
import { issueInvite, updateRequestField, type InviteState } from '@/app/admin/actions';

/* ── 埋め込みスニペット ─────────────────────────────────────── */

export function SnippetBox({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-slate-900 px-4 py-3 text-xs leading-relaxed text-slate-100">
        {snippet}
      </pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(snippet).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute right-2 top-2 rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
      >
        {copied ? 'コピーしました' : 'コピー'}
      </button>
    </div>
  );
}

/* ── 招待リンクの発行 ───────────────────────────────────────── */

const initialInvite: InviteState = {};

export function InviteIssuer({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(issueInvite, initialInvite);

  return (
    <div className="space-y-3">
      <form action={action} className="flex gap-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input
          name="label"
          placeholder="宛先のメモ（例: 田中様）"
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:bg-white"
        />
        <button
          disabled={pending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? '発行中…' : '招待リンクを発行'}
        </button>
      </form>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      {state.url && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-semibold text-amber-800">
            このリンクは今この画面にしか出ません。閉じると二度と表示できません。
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={state.url}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-md border border-amber-300 bg-white px-2 py-1.5 font-mono text-xs"
            />
            <button
              onClick={() => navigator.clipboard.writeText(state.url as string)}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              コピー
            </button>
          </div>
          <p className="mt-2 text-xs text-amber-700">
            LINE でこのリンクを送ってください。開いた時点でトークンが端末に保存され、
            URL からは自動で消えます。
          </p>
        </div>
      )}
    </div>
  );
}

/* ── 依頼の分類・状態 ───────────────────────────────────────── */

const SELECT =
  'rounded-md border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-blue-600';

export function FieldSelect({
  requestId,
  field,
  value,
  options,
}: {
  requestId: string;
  field: 'category' | 'subtype' | 'status';
  value: string | null;
  options: [string, string][];
}) {
  return (
    <form action={updateRequestField}>
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="field" value={field} />
      <select
        name="value"
        defaultValue={value ?? ''}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={SELECT}
      >
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </form>
  );
}

export const CATEGORY_OPTIONS: [string, string][] = [
  ['unclassified', '未分類'],
  ['minor', '軽微修正'],
  ['spec_change', '仕様変更'],
  ['defect', '不具合'],
];

export const SUBTYPE_OPTIONS: [string, string][] = [
  ['', '—'],
  ['text', '文言'],
  ['asset', '素材'],
  ['style', '色・余白'],
  ['order', '並び順'],
];

export const STATUS_OPTIONS: [string, string][] = [
  ['received', '受付済'],
  ['in_progress', '対応中'],
  ['done', '完了'],
  ['carried_over', '次回持ち越し'],
  ['wont_fix', '見送り'],
];
