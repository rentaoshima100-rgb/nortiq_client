'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
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

interface Readiness {
  canInvite: boolean;
  reason: string | null;
  refUrl: string | null;
  live: { nqIdCount: number };
  deploy: { state: string; environment: string | null } | null;
}

/**
 * 招待を送ってよいかを、本番 HTML の現物で確かめてから出す。
 *
 * リポジトリを編集した瞬間はまだ本番に出ていない。そこで招待を送ると
 * クライアントは何も出ないページを開くことになり、こちらの信用で払う。
 *
 * ただし塞ぎ切りにはしない。ステージングで先に渡す、といった運用が
 * 実際にあるので、確認したうえで通せる形にする。
 */
export function InviteIssuer({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(issueInvite, initialInvite);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [checking, setChecking] = useState(true);
  const [override, setOverride] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const r = await fetch(`/api/admin/deploy-status?projectId=${projectId}`);
      setReady(r.ok ? ((await r.json()) as Readiness) : null);
    } catch {
      setReady(null);
    } finally {
      setChecking(false);
    }
  }, [projectId]);

  useEffect(() => {
    void check();
  }, [check]);

  // 反映待ちのあいだだけ、自分で見に行く。押し直させない。
  // 出たら止める。出ないまま 5 分たっても止める（無限に叩かない）。
  useEffect(() => {
    if (!ready || ready.canInvite) return;
    let n = 0;
    const t = setInterval(() => {
      if (++n > 20) return clearInterval(t);
      void check();
    }, 15000);
    return () => clearInterval(t);
  }, [ready, check]);

  const blocked = !!ready && !ready.canInvite && !override;

  return (
    <div className="space-y-3">
      {ready && ready.canInvite && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          本番にスニペットが出ています。招待を送れます。
          {ready.live.nqIdCount > 0 && `（data-nq-id も ${ready.live.nqIdCount} 箇所）`}
        </p>
      )}

      {ready && !ready.canInvite && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p>
            <strong>まだ本番に出ていません。</strong> {ready.reason}
          </p>
          {ready.deploy && (
            <p className="mt-1">
              デプロイ: {ready.deploy.environment ?? '—'} / {ready.deploy.state}
            </p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-3">
            {ready.refUrl && (
              <a className="underline" href={ready.refUrl} target="_blank" rel="noreferrer">
                出した PR / コミットを見る
              </a>
            )}
            <button type="button" onClick={() => void check()} className="underline">
              {checking ? '確認しています…' : 'いま確認する'}
            </button>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              それでも発行する
            </label>
          </p>
        </div>
      )}

      <form action={action} className="flex gap-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input
          name="label"
          placeholder="宛先のメモ（例: 田中様）"
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:bg-white"
        />
        <button
          disabled={pending || blocked}
          title={blocked ? 'スニペットがまだ本番に出ていません' : undefined}
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
    allow_direct_commit: boolean;
    line_to: string | null;
    extra_origins: string[] | null;
    rounds_enabled: boolean;
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
            追加で許可するオリジン
          </label>
          <input
            name="extra_origins"
            defaultValue={(project.extra_origins ?? []).join(', ')}
            placeholder="https://example.com, https://www.example.com"
            className={FIELD}
          />
          <p className="mt-1 text-xs text-slate-400">
            独自ドメインへの切り替え期間は、旧・新の両方をここに入れておきます。
            入っていないオリジンからは依頼を送れません（ワイルドカードは使えません）。
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
          <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              name="allow_direct_commit"
              defaultChecked={project.allow_direct_commit}
              className="mt-0.5"
            />
            <span>
              このブランチに直接コミットする
              <span className="block text-slate-400">
                外すと PR を出すだけ。他人のリポジトリでは外したままにしてください
              </span>
            </span>
          </label>
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
          <input
            type="checkbox"
            name="rounds_enabled"
            defaultChecked={project.rounds_enabled}
            className="mt-1"
          />
          <span>
            <b>ラウンド制を使う</b>
            <span className="block text-xs text-slate-500">
              外すと、締切・無償回数のカウント・確認のやりとりを行いません。
              依頼は貯まり続け、進捗は依頼ごとの状態で管理します。
              撮影・差分・素材差し替えはどちらでも動きます。
            </span>
          </span>
        </label>
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
