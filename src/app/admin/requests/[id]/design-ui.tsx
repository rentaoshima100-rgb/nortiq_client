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

export interface BatchView {
  clientSpec: string | null;
  brief: string;
  sources: { title: string; url: string }[];
}

/** 調査結果。施主に示す根拠になるので、折りたたんでも消さない */
export function ResearchPanel({ b }: { b: BatchView }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {b.clientSpec ? (
        <div className="mb-3 rounded border-l-4 border-slate-900 bg-white px-3 py-2">
          <div className="text-xs font-bold text-slate-500">施主の指定（3案すべてが従っています）</div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{b.clientSpec}</p>
        </div>
      ) : (
        <p className="mb-3 text-xs text-slate-500">
          依頼文に具体的な指定はありませんでした。構成は調査で見つけた実例に寄せています。
        </p>
      )}

      <button onClick={() => setOpen(!open)} className="text-sm text-slate-700 underline">
        {open ? '調査結果を閉じる' : `調査結果を見る（参照 ${b.sources.length} 件）`}
      </button>

      {open && (
        <>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded bg-white px-3 py-2 text-xs leading-relaxed text-slate-700">
            {b.brief}
          </pre>
          {b.sources.length > 0 && (
            <ul className="mt-3 space-y-1">
              {b.sources.map((s) => (
                <li key={s.url} className="truncate text-xs">
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-slate-600 underline">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function GenerateButton({ requestId, again }: { requestId: string; again: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const post = (body: unknown) =>
    fetch('/api/admin/design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => ({ ok: r.ok, json: (await r.json()) as Record<string, unknown> }));

  async function run() {
    setBusy(true);
    setMsg('実例を調べています…');
    try {
      // 1段目。調査と生成をまとめると 60秒に当たって何も残らない
      const r1 = await post({ requestId });
      if (!r1.ok) {
        setMsg(String(r1.json.error ?? '調査に失敗しました'));
        return;
      }
      const batch = r1.json.batch as number;
      router.refresh();

      // 2段目。3案は別々の呼び出しにして並行に投げる
      setMsg('3案を作っています…');
      const results = await Promise.all(
        [1, 2, 3].map((variant) => post({ requestId, batch, variant })),
      );
      const bad = results.filter((r) => !r.ok);
      setMsg(
        bad.length
          ? `${3 - bad.length}案できました（${bad.length}案は失敗: ${String(bad[0].json.error ?? '')}）`
          : null,
      );
      router.refresh();
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
        {busy ? '作成中…' : again ? 'もう一度作る' : '参考デザインを3案作る'}
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
            案{p.variant}・{p.direction}
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
