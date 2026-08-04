'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface FixRow {
  id: string;
  request_id: string;
  instruction: string;
  target_hint: string | null;
  doable: boolean;
  reason: string | null;
  status: string;
  source: string;
  pr_url: string | null;
  question: string | null;
  seq: number;
  body: string;
  /** いまクライアントに出している質問。出していなければ null */
  asked: string | null;
  answer: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: '下書き',
  approved: '実行する',
  applied: '反映済み',
  skipped: '見送り',
};

/**
 * 修正指示の一覧。
 *
 * ここではまだリポジトリを触らない。指示を読んで、直して、選ぶ。
 * 選んだものを**まとめて1回**投げたときに初めてコードが変わる。
 */
export function FixList({ projectId, rows }: { projectId: string; rows: FixRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.status === 'approved').map((r) => r.id)),
  );
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [results, setResults] = useState<{ seq: number; status: string; detail: string }[]>([]);
  const [usage, setUsage] = useState<{
    input: number;
    cached: number;
    output: number;
    yen: number;
  } | null>(null);

  const post = async (body: unknown) => {
    const res = await fetch('/api/admin/fixes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return { ok: res.ok, json: JSON.parse(text) as Record<string, unknown> };
    } catch {
      return {
        ok: false,
        json: {
          error:
            res.status === 504 ? '時間内に終わりませんでした（504）' : `応答が不正です（${res.status}）`,
        },
      };
    }
  };

  async function plan() {
    setBusy('plan');
    setErr(null);
    setMsg(null);
    const r = await post({ projectId, action: 'plan' });
    setBusy(null);
    if (!r.ok || r.json.ok === false) setErr(String(r.json.message ?? r.json.error ?? '失敗しました'));
    else {
      setMsg(String(r.json.message ?? ''));
      router.refresh();
    }
  }

  async function saveOne(id: string) {
    const instruction = edits[id];
    if (instruction == null) return;
    setBusy(id);
    await post({ id, instruction });
    setBusy(null);
    setEdits((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
    router.refresh();
  }

  /**
   * クライアントに確認を出す。
   * **必ず社内が中身を見てから出す。** 誤った質問がそのまま届くと、
   * 依頼そのものの信用に関わる。
   */
  async function ask(r: FixRow, text: string | null) {
    setBusy(r.id);
    await post({ requestId: r.request_id, askClient: text });
    setBusy(null);
    router.refresh();
  }

  async function inspect() {
    const ids = picked.size ? [...picked] : pending.map((r) => r.id);
    if (!ids.length) return;
    setBusy('inspect');
    setErr(null);
    setMsg(null);
    setResults([]);
    const r = await post({ projectId, action: 'inspect', ids });
    setBusy(null);
    if (!r.ok || r.json.ok === false) setErr(String(r.json.message ?? r.json.error ?? '失敗しました'));
    else setMsg(String(r.json.message ?? ''));
    setResults((r.json.results as typeof results) ?? []);
  }

  async function apply() {
    const ids = [...picked];
    if (!ids.length) {
      setErr('実行する指示を選んでください');
      return;
    }
    setBusy('apply');
    setErr(null);
    setMsg(null);
    setResults([]);
    // 選んだものは実行対象として印を付けてから投げる
    await Promise.all(ids.map((id) => post({ id, status: 'approved' })));
    const r = await post({ projectId, action: 'apply', ids });
    setBusy(null);
    if (!r.ok || r.json.ok === false) {
      setErr(String(r.json.message ?? r.json.error ?? '失敗しました'));
    } else {
      setMsg(String(r.json.message ?? ''));
      setPrUrl((r.json.prUrl as string) ?? null);
      setUsage((r.json.usage as typeof usage) ?? null);
    }
    setResults((r.json.results as typeof results) ?? []);
    router.refresh();
  }

  const pending = rows.filter((r) => r.status === 'draft' || r.status === 'approved');
  const doneRows = rows.filter((r) => r.status === 'applied');
  const skipped = rows.filter((r) => r.status === 'skipped');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={plan}
          disabled={busy !== null}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === 'plan' ? '依頼を読んでいます…' : '未処理の依頼から指示を作る'}
        </button>
        <button
          onClick={inspect}
          disabled={busy !== null}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === 'inspect' ? 'リポジトリを見ています…' : '材料を点検する（無料）'}
        </button>
        <button
          onClick={apply}
          disabled={busy !== null || picked.size === 0}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === 'apply'
            ? 'ソースを読んで書き換えています…'
            : `選んだ ${picked.size} 件をまとめて実行して PR を出す`}
        </button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
        {err && <span className="text-sm text-amber-700">{err}</span>}
        {prUrl && (
          <a href={prUrl} target="_blank" rel="noreferrer" className="text-sm text-green-700 underline">
            PR を開く
          </a>
        )}
      </div>

      {usage && (
        <p className="text-xs text-slate-500">
          入力 {usage.input.toLocaleString()} / うちキャッシュから{' '}
          {usage.cached.toLocaleString()} ・ 出力 {usage.output.toLocaleString()} トークン ≒{' '}
          <b>{usage.yen}円</b>
          {usage.cached > 0 && <span className="ml-2 text-green-700">キャッシュが効いています</span>}
        </p>
      )}

      {results.length > 0 && (
        <ul className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          {results.map((r, i) => (
            <li key={i} className="text-xs">
              <span
                className={
                  r.status === 'applied'
                    ? 'text-green-700'
                    : r.status === 'failed'
                      ? 'text-red-700'
                      : 'text-slate-500'
                }
              >
                #{r.seq} {r.status === 'applied' ? '反映' : r.status === 'failed' ? '失敗' : '見送り'}
              </span>
              <span className="ml-2 text-slate-500">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {pending.length === 0 && (
        <p className="text-sm text-slate-500">
          実行待ちの指示はありません。「未処理の依頼から指示を作る」を押してください。
        </p>
      )}

      {pending.map((r) => (
        <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={picked.has(r.id)}
              onChange={(e) =>
                setPicked((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.add(r.id);
                  else n.delete(r.id);
                  return n;
                })
              }
              className="mt-1"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                  依頼 #{r.seq}
                </span>
                {r.source === 'staff' && (
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                    社内が直した
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">{r.body.slice(0, 90)}</p>
            </div>
          </label>

          <textarea
            value={edits[r.id] ?? r.instruction}
            onChange={(e) => setEdits((s) => ({ ...s, [r.id]: e.target.value }))}
            rows={3}
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {r.target_hint && (
              <code className="text-xs text-slate-500">{r.target_hint}</code>
            )}
            {edits[r.id] != null && edits[r.id] !== r.instruction && (
              <button
                onClick={() => saveOne(r.id)}
                disabled={busy !== null}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              >
                {busy === r.id ? '保存中…' : '指示を保存'}
              </button>
            )}
            <button
              onClick={async () => {
                await post({ id: r.id, status: 'skipped' });
                router.refresh();
              }}
              className="ml-auto text-xs text-slate-400 underline"
            >
              見送る
            </button>
          </div>

          {/* クライアントへの確認。値が分からないものは想像で埋めない */}
          {(r.question || r.asked || r.answer) && (
            <div className="mt-3 rounded-lg border-l-4 border-blue-600 bg-blue-50 px-3 py-2">
              {r.answer ? (
                <>
                  <div className="text-xs font-bold text-blue-800">クライアントの回答</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{r.answer}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    この内容で指示を作り直してください。
                  </p>
                </>
              ) : r.asked ? (
                <>
                  <div className="text-xs font-bold text-blue-800">確認中（画面に出ています）</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{r.asked}</p>
                  <button
                    onClick={() => ask(r, null)}
                    disabled={busy !== null}
                    className="mt-2 text-xs text-slate-500 underline"
                  >
                    取り下げる
                  </button>
                </>
              ) : (
                <>
                  <div className="text-xs font-bold text-blue-800">クライアントに聞く</div>
                  <textarea
                    defaultValue={r.question ?? ''}
                    onChange={(e) => setEdits((s2) => ({ ...s2, ['q:' + r.id]: e.target.value }))}
                    rows={2}
                    className="mt-2 w-full rounded border border-blue-200 bg-white px-2 py-1 text-sm"
                  />
                  <button
                    onClick={() => ask(r, edits['q:' + r.id] ?? r.question ?? '')}
                    disabled={busy !== null}
                    className="mt-2 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white"
                  >
                    {busy === r.id ? '出しています…' : 'この文でクライアントに出す'}
                  </button>
                  <p className="mt-1 text-xs text-slate-500">
                    依頼者の画面に「確認したいこと」として出ます。文面は必ず読んでから出してください。
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {doneRows.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-bold">反映済み（{doneRows.length}）</summary>
          <ul className="mt-3 space-y-2">
            {doneRows.map((r) => (
              <li key={r.id} className="text-sm">
                <span className="text-slate-400">#{r.seq}</span> {r.instruction}
                {r.pr_url && (
                  <a href={r.pr_url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-green-700 underline">
                    PR
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {skipped.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-bold">
            人が見るもの（{skipped.length}）
          </summary>
          <ul className="mt-3 space-y-2">
            {skipped.map((r) => (
              <li key={r.id} className="text-sm">
                <span className="text-slate-400">#{r.seq}</span> {r.body.slice(0, 60)}
                {r.reason && <span className="block text-xs text-amber-700">{r.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
