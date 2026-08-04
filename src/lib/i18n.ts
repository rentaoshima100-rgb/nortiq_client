/**
 * 社内画面の言語切り替え（サーバー側の入口）
 *
 * 土台は i18n-core.ts にある。ここは cookies() を読むだけ。
 * クライアントから辿られると落ちるので、分けてある。
 */
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, translate, type Locale, type T } from './i18n-core';

export { LOCALE_COOKIE, translate };
export type { Locale, T };

export async function getLocale(): Promise<Locale> {
  const c = await cookies();
  return c.get(LOCALE_COOKIE)?.value === 'en' ? 'en' : 'ja';
}

export async function getT(): Promise<T> {
  const locale = await getLocale();
  return (ja: string) => translate(locale, ja);
}
