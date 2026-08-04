'use client';

import { useT } from '@/lib/i18n-client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {b.clientSpec ? (
        <div className="mb-3 rounded border-l-4 border-slate-900 bg-white px-3 py-2">
          <div className="text-xs font-bold text-slate-500">{t('施主の指定（3案すべてが従っています）')}</div>
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
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  /**
   * 失敗したときの本文は JSON とは限らない。504 だと Vercel の
   * エラーページ（プレーンテキスト）が返る。素直に res.json() すると
   * そこで落ちて、本当の失敗が「JSON として不正」に化けてしまう。
   */
  const post = async (body: unknown) => {
    const r = await fetch('/api/admin/design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    try {
      return { ok: r.ok, json: JSON.parse(text) as Record<string, unknown> };
    } catch {
      const hint =
        r.status === 504
          ? t('時間内に終わりませんでした（504）')
          : `サーバーが応答しませんでした（${r.status}）`;
      return { ok: false, json: { error: `${hint}: ${text.slice(0, 120)}` } };
    }
  };

  async function run() {
    setBusy(true);
    setMsg(t('実例を調べています…'));
    try {
      // 1段目。調査と生成をまとめると 60秒に当たって何も残らない
      const r1 = await post({ requestId });
      if (!r1.ok) {
        setMsg(String(r1.json.error ?? t('調査に失敗しました')));
        return;
      }
      const batch = r1.json.batch as number;
      router.refresh();

      // 2段目。3案は別々の呼び出しにして並行に投げる
      setMsg(t('3案を作っています…'));
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
      setMsg(e instanceof Error ? e.message : t('通信に失敗しました'));
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
        {busy ? t('作成中…') : again ? t('もう一度作る') : t('参考デザインを3案作る')}
      </button>
      {msg && <span className="text-sm text-amber-700">{msg}</span>}
    </div>
  );
}

const WIDTHS = [
  { label: 'PC', w: 1440, h: 900 },
  { label: 'タブレット', w: 768, h: 900 },
  { label: 'スマホ', w: 390, h: 760 },
] as const;

/**
 * 案は 1440px 前提のグリッドで作られている。
 * 狭い枠にそのまま入れると崩れて見えて、案そのものの評価を誤る。
 * **実寸で描いて縮小して見せる**。
 */
function Preview({ id, title }: { id: string; title: string }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const [size, setSize] = useState<(typeof WIDTHS)[number]>(WIDTHS[0]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / size.w));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        {WIDTHS.map((wd) => (
          <button
            key={wd.label}
            onClick={() => setSize(wd)}
            className={
              wd.label === size.label
                ? 'rounded bg-slate-900 px-2 py-1 text-xs text-white'
                : 'rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100'
            }
          >
            {wd.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-400">
          {size.w}px 幅で描画 ／ {Math.round(scale * 100)}% 表示
        </span>
      </div>
      <div
        ref={box}
        className="overflow-hidden bg-slate-100"
        style={{ height: size.h * scale }}
      >
        <iframe
          src={`/api/admin/design/${id}`}
          title={title}
          sandbox=""
          scrolling="no"
          style={{
            width: size.w,
            height: size.h,
            border: 0,
            background: '#fff',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      </div>
    </div>
  );
}

export function ProposalCard({ p }: { p: ProposalView }) {
  const t = useT();
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

      <Preview id={p.id} title={p.title} />

      <div className="flex items-center gap-4 border-t border-slate-200 px-4 py-3 text-sm">
        <a
          href={`/api/admin/design/${p.id}`}
          target="_blank"
          rel="noreferrer"
          className="text-slate-700 underline"
        >
          実寸で開く
        </a>
        <a href={`/api/admin/design/${p.id}?dl=1`} className="text-slate-700 underline">
          ダウンロード
        </a>
        <div className="ml-auto">
          <Implement proposalId={p.id} />
        </div>
      </div>
    </div>
  );
}


interface Plan {
  file: string;
  oldStr: string;
  newStr: string;
  summary: string;
  notes: string[];
}

/**
 * 採用した案をリポジトリに落とす。
 * **必ず2段**。下書きで差分を見せ、社内が確かめてから PR を出す。
 * 押した瞬間にリポジトリが変わる作りにはしない。
 */
function Implement({ proposalId }: { proposalId: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<'plan' | 'pr' | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pr, setPr] = useState<string | null>(null);

  async function call(confirm: boolean) {
    setBusy(confirm ? 'pr' : 'plan');
    setErr(null);
    try {
      const r = await fetch('/api/admin/design/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId, confirm }),
      });
      const text = await r.text();
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(text) as Record<string, unknown>;
      } catch {
        setErr(r.status === 504 ? '時間内に終わりませんでした（504）' : `応答が不正です（${r.status}）`);
        return;
      }
      if (!j.ok) {
        setErr(String(j.message ?? j.error ?? t('失敗しました')));
        return;
      }
      setPlan(j.plan as Plan);
      if (j.applied) {
        setPr(String(j.prUrl));
        router.refresh();
      } else {
        setMsg(String(j.message ?? ''));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('通信に失敗しました'));
    } finally {
      setBusy(null);
    }
  }

  if (pr) {
    return (
      <a href={pr} target="_blank" rel="noreferrer" className="text-sm font-medium text-green-700 underline">
        PR を出しました → 開く
      </a>
    );
  }

  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-3">
        {err && <span className="text-xs text-amber-700">{err}</span>}
        {!plan ? (
          <button
            onClick={() => call(false)}
            disabled={busy !== null}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {busy === 'plan' ? t('ソースを読んでいます…') : t('この案で実装する')}
          </button>
        ) : (
          <button
            onClick={() => call(true)}
            disabled={busy !== null}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy === 'pr' ? t('PR を作っています…') : t('PR を出す')}
          </button>
        )}
      </div>

      {plan && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left">
          <p className="text-xs text-slate-600">
            <code className="text-[11px]">{plan.file}</code> — {plan.summary}
          </p>
          {msg && <p className="mt-1 text-xs text-slate-500">{msg}</p>}
          {plan.notes.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {plan.notes.map((n, i) => (
                <li key={i} className="text-xs text-amber-700">
                  ・{n}
                </li>
              ))}
            </ul>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-slate-500">{t('差分を見る')}</summary>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <pre className="max-h-64 overflow-auto rounded bg-red-50 p-2 text-[11px] leading-relaxed text-red-900">
                {plan.oldStr}
              </pre>
              <pre className="max-h-64 overflow-auto rounded bg-green-50 p-2 text-[11px] leading-relaxed text-green-900">
                {plan.newStr}
              </pre>
            </div>
          </details>
          <p className="mt-2 text-xs text-slate-400">
            PR を出すまでリポジトリは変わりません。自動マージはしません。
          </p>
        </div>
      )}
    </div>
  );
}
