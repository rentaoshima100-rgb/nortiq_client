'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n-client';

/**
 * Claude Code に渡すプロンプト。
 *
 * このツールは**修正を当てない**。クライアントが「どこを、どう直してほしいか」
 * を書き、こちらはそれをそのまま実装できる形に整えて渡すところまでを持つ。
 *
 * 当てるのをやめた理由は src/lib/handoff.ts に書いてある。要点は、
 * **当てると目印が外れる**こと。指していた文言そのものが変わるため。
 */
export function Handoff({ projectId }: { projectId: string }) {
  const t = useT();
  const [prompt, setPrompt] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [all, setAll] = useState(false);

  async function load(withAll: boolean) {
    setBusy(true);
    setMsg(null);
    setCopied(false);
    try {
      const res = await fetch(
        `/api/admin/handoff?projectId=${projectId}${withAll ? '&all=1' : ''}`,
      );
      const text = await res.text();
      let j: { prompt?: string; message?: string; error?: string; count?: number };
      try {
        j = JSON.parse(text) as typeof j;
      } catch {
        setMsg(t('応答が不正です（{status}）', { status: res.status }));
        return;
      }
      setPrompt(j.prompt ?? null);
      setCount(j.count ?? 0);
      setMsg(j.message ?? j.error ?? null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('通信に失敗しました'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-bold">{t('Claude Code に渡すプロンプト')}</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        {t('未処理の依頼を1本のプロンプトにまとめます。クリックされた要素・当たっていた CSS・ページ内の位置・社内の補足まで入るので、これ1回で実装できます。')}
        <b>{t('このツールからはコードを触りません。')}</b>
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => load(all)}
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? t('まとめています…') : t('プロンプトを作る')}
        </button>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {t('完了・見送りも含める')}
        </label>
        {prompt && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(prompt).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium"
          >
            {copied ? t('コピーしました') : t('全文をコピー')}
          </button>
        )}
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>

      {prompt && (
        <>
          <p className="mt-3 text-xs text-slate-400">
            {t('{n}件 ／ {chars}文字', { n: count, chars: prompt.length.toLocaleString() })}
          </p>
          <textarea
            readOnly
            value={prompt}
            onFocus={(e) => e.currentTarget.select()}
            rows={18}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed"
          />
        </>
      )}
    </section>
  );
}

/**
 * 依頼ごとの社内メモ。
 *
 * **依頼文に無い値はここに書く。** クライアントは「許可番号を入れて」と
 * しか書かない。番号を持っているのは社内で、それが無いと実装者の手が
 * 止まる。プロンプトには「依頼文より優先」と明記して載せる。
 */
export function StaffNote({ requestId, value }: { requestId: string; value: string | null }) {
  const t = useT();
  const [text, setText] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = text !== (value ?? '');

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: requestId, staffNote: text }),
      });
      setMsg(res.ok ? t('保存しました') : t('失敗しました（{status}）', { status: res.status }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('通信に失敗しました'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-bold">{t('社内からの補足')}</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        {t('依頼文に無い値や、外してほしくない条件をここに書いてください。プロンプトには「依頼文より優先」と書いて載せます。')}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={t('例）許可番号は 27-305570。写真は添付の 2 枚目を使う。')}
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {busy ? t('保存中…') : t('保存する')}
        </button>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
    </section>
  );
}
