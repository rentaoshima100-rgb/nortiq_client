'use client';

import { createContext, useContext } from 'react';
import { translate, type Locale, type T } from './i18n-core';

const Ctx = createContext<Locale>('ja');

/** サーバーで決めた言語をクライアント側に配る */
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}

/** クライアントコンポーネント用。呼び方はサーバー側と同じ t(ja) */
export function useT(): T {
  const locale = useContext(Ctx);
  return (ja: string) => translate(locale, ja);
}

export function useLocale(): Locale {
  return useContext(Ctx);
}
