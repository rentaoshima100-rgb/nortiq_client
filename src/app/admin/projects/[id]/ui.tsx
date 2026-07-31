'use client';

import { useActionState, useState } from 'react';
import {
  issueInvite,
  saveProjectSettings,
  updateRequestField,
  type InviteState,
  type SettingsState,
} from '@/app/admin/actions';

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

/* ── 案件設定（画面D）──────────────────────────────────────── */

const initialSettings: SettingsState = {};
const FIELD =
  'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:bg-white';

export function ProjectSettings({
  project,
}: {
  project: {
    id: string;
    repo_owner: string | null;
    repo_name: string | null;
    default_branch: string | null;
    line_to: string | null;
    has_nq_id: boolean;
    asset_swap_enabled: boolean;
    ai_enabled: boolean;
    free_rounds: number;
    max_items_per_round: number;
    freeze_idle_days: number;
    auto_confirm_days: number;
  };
}) {
  const [state, action, pending] = useActionState(saveProjectSettings, initialSettings);
  const repo =
    project.repo_owner && project.repo_name ? `${project.repo_owner}/${project.repo_name}` : '';

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="project_id" value={project.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            GitHub リポジトリ
          </label>
          <input name="repo" defaultValue={repo} placeholder="owner/name" className={FIELD} />
          <p className="mt-1 text-xs text-slate-400">
            GitHub App がこのリポジトリにインストールされている必要があります
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            LINE の送り先（ユーザーID / グループID）
          </label>
          <input name="line_to" defaultValue={project.line_to ?? ''} placeholder="U1234... 未設定なら通知しない" className={FIELD} />
          <p className="mt-1 text-xs text-slate-400">
            公開通知・確認リマインド・締切予告を送ります（11.1）
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">既定ブランチ</label>
          <input name="default_branch" defaultValue={project.default_branch ?? 'main'} className={FIELD} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {(
          [
            ['free_rounds', '無償ラウンド数', project.free_rounds],
            ['max_items_per_round', '1ラウンドの上限件数', project.max_items_per_round],
            ['freeze_idle_days', '無操作で締切（日）', project.freeze_idle_days],
            ['auto_confirm_days', '自動確認（日）', project.auto_confirm_days],
          ] as [string, string, number][]
        ).map(([name, label, val]) => (
          <div key={name}>
            <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
            <input name={name} type="number" min={1} defaultValue={val} className={FIELD} />
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-lg bg-slate-50 p-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="has_nq_id" defaultChecked={project.has_nq_id} className="mt-1" />
          <span>
            <b>nq-id が注入されている</b>
            <span className="block text-xs text-slate-500">
              tools/nq-inject を prebuild に入れてある場合。ロケータが段1で当たるようになります（6.6）
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="asset_swap_enabled"
            defaultChecked={project.asset_swap_enabled}
            className="mt-1"
          />
          <span>
            <b>素材差し替えを有効にする（Phase 3a）</b>
            <span className="block text-xs text-slate-500">
              決定的処理で LLM を使いません。ZDR の取得を待たずに使えます（9.10・13.3）
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="ai_enabled" defaultChecked={project.ai_enabled} className="mt-1" />
          <span>
            <b>文言パッチを有効にする（Phase 3b）</b>
            <span className="block text-xs text-amber-700">
              LLM を使います。<b>ZDR の適用を書面で確認するまで有効にしないこと</b>（13.3）
            </span>
          </span>
        </label>
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.saved && <p className="text-sm text-emerald-600">保存しました</p>}
      <button
        disabled={pending}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? '保存中…' : '設定を保存'}
      </button>
    </form>
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
