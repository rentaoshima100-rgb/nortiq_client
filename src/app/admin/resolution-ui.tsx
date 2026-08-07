'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n-client';

/** Vercel のエラーページは JSON ではない。先に本文で受ける */
async function readJson(res: Response, fallback: string) {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: fallback };
  }
}

/**
 * 案件のまとめ書き。
 *
 * 完了・見送りの依頼について、実際の記録から下書きを作る。
 * **そのままクライアントが読む文**なので、下書きのあと社内が目を通す。
 */
export function DraftResolutions({ projectId, pending }: { projectId: string; pending: number }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action: 'draft' }),
      });
      const j = await readJson(res, t('応答が不正です（{status}）', { status: res.status }));
      setMsg(String(j.message ?? j.error ?? ''));
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('通信に失敗しました'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
      >
        {busy
          ? t('記録から書いています…')
          : pending > 0
            ? t('対応内容の下書きを作る（{n}件）', { n: pending })
            : t('対応内容を作り直す')}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </span>
  );
}

/**
 * 1件ぶんの対応内容。
 *
 * クライアントの一覧にそのまま出る。完了した依頼はサイトから目印を
 * 降ろすので、**これが唯一の記録**になる。空のまま完了にすると、
 * 相手からは依頼が消えたのと同じに見える。
 */
export function ResolutionBox({
  requestId,
  value,
  status,
}: {
  requestId: string;
  value: string | null;
  status: string;
}) {
  const t = useT();
  const router = useRouter();
  const [text, setText] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = text !== (value ?? '');
  const missing = !value && (status === 'done' || status === 'wont_fix');

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: requestId, resolution: text }),
      });
      const j = await readJson(res, t('応答が不正です（{status}）', { status: res.status }));
      setMsg(j.ok ? t('保存しました') : String(j.error ?? j.message ?? ''));
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('通信に失敗しました'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-bold">{t('対応内容')}</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        {t('依頼した本人がそのまま読みます。完了した依頼はサイトから目印を降ろすので、これが唯一の記録になります。')}
        {missing && (
          <b className="ml-1 text-amber-700">
            {t('未記入です。このままだと、相手からは依頼が消えたように見えます。')}
          </b>
        )}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={t('例）年号の表記を西暦に変更しました。')}
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
