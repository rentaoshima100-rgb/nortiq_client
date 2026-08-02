'use client';

import { useState } from 'react';
import type { SiteCheck, Step } from '@/lib/onboarding';
import { SnippetInstall } from './snippet-install-ui';

interface Result {
  check: SiteCheck;
  steps: Step[];
  prompt: string;
}

export function Onboarding({ projectId, hasSiteUrl }: { projectId: string; hasSiteUrl: boolean }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/onboarding?projectId=${projectId}`);
      const text = await r.text();
      if (!r.ok) {
        setErr(`確認できませんでした（${r.status}）`);
        return;
      }
      setRes(JSON.parse(text) as Result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '通信に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!res) return;
    await navigator.clipboard.writeText(res.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const remaining = res?.steps.filter((s) => !s.done).length ?? 0;

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={busy || !hasSiteUrl}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'サイトを見ています…' : res ? 'もう一度確認する' : 'サイトを確認して指示を作る'}
        </button>
        {!hasSiteUrl && <span className="text-sm text-amber-700">サイト URL が未設定です</span>}
        {err && <span className="text-sm text-amber-700">{err}</span>}
      </div>

      <SnippetInstall projectId={projectId} />

      {res && (
        <>
          {!res.check.reachable && (
            <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              サイトに接続できませんでした。URL が正しいか、本番が公開されているか確認してください。
              下の指示は「何も入っていない」前提で作っています。
            </p>
          )}

          <ul className="mt-4 space-y-2">
            {res.steps.map((s) => (
              <li key={s.key} className="flex gap-3 text-sm">
                <span
                  className={
                    s.done
                      ? 'mt-0.5 shrink-0 text-green-600'
                      : 'mt-0.5 shrink-0 text-slate-300'
                  }
                >
                  {s.done ? '●' : '○'}
                </span>
                <div className="min-w-0">
                  <span className={s.done ? 'text-slate-500' : 'font-medium'}>{s.title}</span>
                  {s.note && <span className="ml-2 text-xs text-slate-500">{s.note}</span>}
                  {!s.done && (
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{s.why}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-5 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
              <span className="text-xs text-slate-600">
                {remaining === 0
                  ? 'すべて済んでいます。指示は不要です'
                  : `エンジニアに渡す指示（残り ${remaining} 件ぶん）`}
              </span>
              <button onClick={copy} className="rounded border border-slate-300 px-2 py-1 text-xs">
                {copied ? 'コピーしました' : 'コピー'}
              </button>
            </div>
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap px-4 py-3 text-xs leading-relaxed text-slate-700">
              {res.prompt}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
