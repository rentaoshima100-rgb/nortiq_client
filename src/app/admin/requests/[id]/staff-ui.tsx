'use client';

import { useLocale, useT } from '@/lib/i18n-client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

/**
 * 社内があとから添付を足す。
 *
 * 「この写真に差し替えて」に対して、正しい素材を社内が持っていることがある。
 * 素材／参考の別は必ず選ばせる（6.9）。あとで揉めたときに、
 * 誰が「これは素材だ」と言ったかが要る。
 */
export function StaffAttach({ requestId }: { requestId: string }) {
  const t = useT();
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<'material' | 'reference'>('reference');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload() {
    const f = file.current?.files?.[0];
    if (!f) {
      setErr(t('ファイルを選んでください'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          filename: f.name,
          mime: f.type,
          bytes: f.size,
          kind,
        }),
      });
      const j = (await res.json()) as { uploadUrl?: string; error?: string };
      if (!res.ok || !j.uploadUrl) {
        setErr(j.error ?? t('登録に失敗しました'));
        return;
      }
      const put = await fetch(j.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': f.type },
        body: f,
      });
      if (!put.ok) {
        setErr(t('アップロードに失敗しました（{status}）', { status: put.status }));
        return;
      }
      if (file.current) file.current.value = '';
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('通信に失敗しました'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-3">
      <p className="mb-2 text-xs font-medium text-slate-600">{t('社内から画像を足す')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className="text-xs"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as 'material' | 'reference')}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          <option value="reference">{t('参考（イメージを伝えるだけ）')}</option>
          <option value="material">{t('素材（サイトに使う）')}</option>
        </select>
        <button
          onClick={upload}
          disabled={busy}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? t('追加しています…') : t('追加する')}
        </button>
        {err && <span className="text-xs text-amber-700">{err}</span>}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {t('「素材」を選ぶと、この案件で画像差し替えが有効なとき、差し替えの対象になります。イメージを伝えるだけの画像は「参考」にしてください。')}
      </p>
    </div>
  );
}

export interface AutoJob {
  status: string;
  summary: string | null;
  pr_url: string | null;
  pr_number: number | null;
  merged_at: string | null;
  created_at: string;
}

/** 自動で当てた跡。無いと社内が二重に作業する */
export function AutoFixMark({ job }: { job: AutoJob }) {
  const t = useT();
  const done = !!job.merged_at;
  return (
    <div
      className={
        done
          ? 'rounded-lg border border-green-200 bg-green-50 px-4 py-3'
          : 'rounded-lg border border-blue-200 bg-blue-50 px-4 py-3'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            done
              ? 'rounded bg-green-600 px-2 py-0.5 text-xs font-bold text-white'
              : 'rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white'
          }
        >
          {done ? t('自動修正で完了') : t('自動修正 — PR 待ち')}
        </span>
        {job.summary && <span className="text-sm">{job.summary}</span>}
        {job.pr_url && (
          <a
            href={job.pr_url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-slate-700 underline"
          >
            {t('PR {num} を開く', { num: job.pr_number ? `#${job.pr_number}` : '' })}
          </a>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {done
          ? t('PR がマージされ、本番に出ています。')
          : t('まだマージされていません。PR を確認してマージすると本番に出ます。自動マージはしません。')}
      </p>
    </div>
  );
}

/** 案件ページから手で走らせる */
export function RunAutoText({ projectId }: { projectId: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{
    message: string;
    prUrl?: string;
    results: { seq: number; status: string; detail: string }[];
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/auto-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const text = await res.text();
      let j;
      try {
        j = JSON.parse(text) as typeof out;
      } catch {
        setErr(
          res.status === 504
            ? t('時間内に終わりませんでした（504）')
            : t('応答が不正です（{status}）', { status: res.status }),
        );
        return;
      }
      setOut(j);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('通信に失敗しました'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {busy ? t('依頼を見ています…') : t('いま走らせる')}
        </button>
        {err && <span className="text-xs text-amber-700">{err}</span>}
        {out && !err && <span className="text-xs text-slate-600">{out.message}</span>}
        {out?.prUrl && (
          <a href={out.prUrl} target="_blank" rel="noreferrer" className="text-xs text-green-700 underline">
            {t('PR を開く')}
          </a>
        )}
      </div>

      {out && out.results.length > 0 && (
        <ul className="mt-3 space-y-1">
          {out.results.map((r) => (
            <li key={r.seq} className="text-xs">
              <span
                className={
                  r.status === 'applied'
                    ? 'text-green-700'
                    : r.status === 'failed'
                      ? 'text-red-700'
                      : 'text-slate-500'
                }
              >
                #{r.seq}{' '}
                {r.status === 'applied' ? t('反映') : r.status === 'failed' ? t('失敗') : t('見送り')}
              </span>
              <span className="ml-2 text-slate-500">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * この依頼だけを AI に直させる。
 *
 * 自動は「迷ったら人に回す」で止まる。社内が中身を見て
 * 「これは直せる」と判断したときは、その判断を通す。
 * **判断の門だけを開ける。機械の安全確認は外さない**
 * （構造を変えていないか、対象が一意か、当てる直前の再検証）。
 */
export function FixThisRequest({
  projectId,
  requestId,
}: {
  projectId: string;
  requestId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [out, setOut] = useState<{
    message: string;
    prUrl?: string;
    results: { seq: number; status: string; detail: string }[];
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    setOut(null);
    try {
      const res = await fetch('/api/admin/auto-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, requestId, note: note.trim() || undefined }),
      });
      const text = await res.text();
      try {
        setOut(JSON.parse(text) as typeof out);
      } catch {
        setErr(
          res.status === 504
            ? t('時間内に終わりませんでした（504）')
            : t('応答が不正です（{status}）', { status: res.status }),
        );
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('通信に失敗しました'));
    } finally {
      setBusy(false);
    }
  }

  const r = out?.results?.[0];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      {/*
        {t('依頼文だけでは足りないことがある。値を持っているのは社内で、クライアントは「許可番号を入れて」としか書かない。ここに書いたものは依頼文より優先される。')}
      */}
      <label className="mb-3 block">
        <span className="text-xs font-medium text-slate-600">{t('補足の指示（任意）')}</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={t("例: 許可番号は 派13-300000 です／文字は1段だけ小さく／ヘッダーは触らないで")}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <span className="mt-1 block text-xs text-slate-400">
          {t('依頼文に無い値や、外してほしくない条件をここに書いてください。**依頼文より優先されます。**')}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? t('ソースを読んでいます…') : t('この依頼を直させる')}
        </button>
        <span className="text-xs text-slate-500">
          {t('文言と文字まわりだけ。PR を出すところまで行います。')}
          <b>{t('自動マージはしません。')}</b>
        </span>
        {err && <span className="text-sm text-amber-700">{err}</span>}
      </div>

      {out && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {r ? (
            <p className="text-sm">
              <span
                className={
                  r.status === 'applied'
                    ? 'font-medium text-green-700'
                    : r.status === 'failed'
                      ? 'font-medium text-red-700'
                      : 'font-medium text-slate-600'
                }
              >
                {r.status === 'applied' ? t('反映しました') : r.status === 'failed' ? t('失敗') : t('当てられません')}
              </span>
              <span className="ml-2 text-slate-600">{r.detail}</span>
            </p>
          ) : (
            <p className="text-sm text-slate-600">{out.message}</p>
          )}
          {out.prUrl && (
            <a
              href={out.prUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-green-700 underline"
            >
              {t('PR を開く')}
            </a>
          )}
          <p className="mt-2 text-xs text-slate-400">
            {t('当てられなかった理由は、材料が足りないことがほとんどです。対象がリポジトリに無い、値が依頼文に書かれていない、など。')}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * クライアントに確認する。
 *
 * 値が依頼文に無いもの（許可番号、正式名称、どの写真か）は、こちらでは
 * 決められない。想像で埋めると事故になるので、出した本人に聞く。
 *
 * **依頼のページに常設する。** 修正指示のページの中だけに置いていたが、
 * そこは指示を作らないと出てこない。社内が「これ分からないな」と
 * 思うのは依頼を見ている時なので、その場で聞けないと使われない。
 */
export function AskClient({
  requestId,
  question,
  answer,
  answeredAt,
}: {
  requestId: string;
  question: string | null;
  answer: string | null;
  answeredAt: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(v: string | null) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/fixes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, askClient: v }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? t('失敗しました（{status}）', { status: res.status }));
        return;
      }
      setText('');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('通信に失敗しました'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-bold">{t('クライアントに確認する')}</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        {t('依頼だけでは決められないこと（番号、正式名称、どの写真か）を、出した本人に聞けます。')}
        {t('依頼者のパネルに')}
        <b>{t('「保留中」')}</b>
        {t('として出ます。')}
      </p>

      {answer ? (
        <div className="mt-4 rounded-lg border-l-4 border-green-600 bg-green-50 px-3 py-2">
          <div className="text-xs font-bold text-green-800">
            {answeredAt
              ? t('回答がありました（{at}）', {
                  at: new Date(answeredAt).toLocaleString(locale === 'en' ? 'en-US' : 'ja-JP'),
                })
              : t('回答がありました')}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{answer}</p>
        </div>
      ) : null}

      {question ? (
        <div className="mt-4 rounded-lg border-l-4 border-blue-600 bg-blue-50 px-3 py-2">
          <div className="text-xs font-bold text-blue-800">{t('確認中（相手の画面に出ています）')}</div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{question}</p>
          <button
            onClick={() => send(null)}
            disabled={busy}
            className="mt-2 text-xs text-slate-500 underline disabled:opacity-50"
          >
            {busy ? t('取り下げています…') : t('取り下げる')}
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder={t("例: 派遣事業の許可番号をお教えいただけますか。")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={() => send(text)}
              disabled={busy || !text.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? t('出しています…') : t('クライアントに聞く')}
            </button>
            {err && <span className="text-sm text-amber-700">{err}</span>}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t('相手がそのまま読む文です。何を答えればよいかが一読で分かる形で書いてください。「情報が不足しています」ではなく「許可番号をお教えいただけますか」。')}
          </p>
        </div>
      )}
    </div>
  );
}
