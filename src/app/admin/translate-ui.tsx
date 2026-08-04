'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useT } from '@/lib/i18n-client';

/**
 * クライアントが書いた文を英訳するボタン。
 *
 * **日本語で見ているときは出さない。** 日本語のまま読める人には要らない
 * 機能で、置いておくと押せてしまう（押すと費用がかかる）。
 *
 * 自動では走らせない。案件を開くたびに勝手に訳すと、読むつもりのない
 * 依頼まで費用がかかる。押したぶんだけ訳す。
 */
export function TranslateButton({
  projectId,
  ids,
  pending,
  label,
  className,
}: {
  projectId: string;
  /** 名指しで訳すとき。省くと案件の未訳ぶん全部 */
  ids?: string[];
  /** 未訳の件数。0 なら「訳し直す」の見た目にする */
  pending?: number;
  label?: string;
  className?: string;
}) {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (locale !== 'en') return null;

  const again = pending === 0;

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ids, force: again }),
      });
      // Vercel のエラーページは JSON ではない。先に本文で受ける
      const text = await res.text();
      let j: { ok?: boolean; message?: string; error?: string };
      try {
        j = JSON.parse(text) as typeof j;
      } catch {
        setMsg(
          res.status === 504
            ? t('時間内に終わりませんでした（504）')
            : t('応答が不正です（{status}）', { status: res.status }),
        );
        return;
      }
      setMsg(j.message ?? j.error ?? null);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('通信に失敗しました'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={className ?? 'inline-flex items-center gap-2'}>
      <button
        onClick={run}
        disabled={busy}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
      >
        {busy
          ? t('訳しています…')
          : label
            ? label
            : again
              ? t('訳し直す')
              : pending != null
                ? t('依頼文を英訳する（{n}件）', { n: pending })
                : t('依頼文を英訳する')}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </span>
  );
}

/**
 * 原文と訳の出し分け。
 *
 * EN で訳があればそれを出す。**原文は消さない。** 訳が怪しいときに
 * 戻れないと社内が判断できなくなるので、開けば見られるようにしておく。
 */
export function ClientText({
  ja,
  en,
  className,
}: {
  ja: string;
  en: string | null;
  className?: string;
}) {
  const locale = useLocale();
  const t = useT();
  const [showJa, setShowJa] = useState(false);

  if (locale !== 'en' || !en) return <span className={className}>{ja}</span>;

  return (
    <span className={className}>
      {showJa ? ja : en}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowJa((v) => !v);
        }}
        className="ml-2 align-middle text-[11px] text-slate-400 underline decoration-dotted"
      >
        {showJa ? t('英訳') : t('原文')}
      </button>
    </span>
  );
}
