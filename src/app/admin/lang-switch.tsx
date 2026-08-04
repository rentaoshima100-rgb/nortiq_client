'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from '@/lib/i18n-client';
import { LOCALE_COOKIE } from '@/lib/i18n-core';

/**
 * 言語の切り替え。
 *
 * Cookie に入れてサーバー側で読む。URL を分けないのは、
 * 社内画面のリンクを全部作り直すことになるため。
 */
export function LangSwitch() {
  const router = useRouter();
  const locale = useLocale();

  function set(next: 'ja' | 'en') {
    if (next === locale) return;
    // 1年。社内の人は一度決めたら変えない
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-slate-200">
      {(['ja', 'en'] as const).map((v) => (
        <button
          key={v}
          onClick={() => set(v)}
          aria-pressed={locale === v}
          className={
            locale === v
              ? 'bg-slate-900 px-2 py-1 text-xs font-medium text-white'
              : 'px-2 py-1 text-xs text-slate-500 hover:bg-slate-100'
          }
        >
          {v === 'ja' ? '日本語' : 'EN'}
        </button>
      ))}
    </div>
  );
}
