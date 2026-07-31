'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface ProposalView {
  id: string;
  variant: number;
  direction: string;
  title: string;
  rationale: string;
}

const LABEL: Record<string, string> = {
  minimal: '最小の変更',
  refined: '整えた案',
  rethink: '作り直した案',
};

export function GenerateButton({ requestId, again }: { requestId: string; again: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      const j = (await res.json()) as {
        error?: string;
        made?: number;
        failed?: ({ variant: number; reason: string } | null)[];
      };
      if (!res.ok) {
        setMsg(j.error ?? '作れませんでした');
      } else {
        const bad = (j.failed ?? []).filter(Boolean) as { variant: number; reason: string }[];
        setMsg(bad.length ? `${j.made}案できました（${bad.length}案は失敗）` : null);
        router.refresh();
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '通信に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? '作成中…（1分ほどかかります）' : again ? 'もう一度作る' : '参考デザインを3案作る'}
      </button>
      {msg && <span className="text-sm text-amber-700">{msg}</span>}
    </div>
  );
}

export function ProposalCard({ p }: { p: ProposalView }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">
            {LABEL[p.direction] ?? p.direction}
          </span>
          <h3 className="text-sm font-bold">{p.title}</h3>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.rationale}</p>
      </div>

      {open && (
        <iframe
          src={`/api/admin/design/${p.id}`}
          title={p.title}
          sandbox=""
          className="h-[520px] w-full border-0 bg-white"
        />
      )}

      <div className="flex gap-4 px-4 py-3 text-sm">
        <button onClick={() => setOpen(!open)} className="text-slate-700 underline">
          {open ? '閉じる' : 'プレビュー'}
        </button>
        <a href={`/api/admin/design/${p.id}`} target="_blank" rel="noreferrer" className="text-slate-700 underline">
          別タブで開く
        </a>
        <a href={`/api/admin/design/${p.id}?dl=1`} className="text-slate-700 underline">
          ダウンロード
        </a>
      </div>
    </div>
  );
}
