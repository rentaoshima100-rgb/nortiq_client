/**
 * 言語切り替えの土台。**サーバー専用のものを入れない。**
 *
 * ここに next/headers を混ぜると、クライアントコンポーネントから
 * 辿ったときにビルドが落ちる（実測）。cookies() を使う入口は
 * i18n.ts 側に置いてある。
 */
import { DICT } from './i18n-dict';

export type Locale = 'ja' | 'en';
export type T = (ja: string) => string;

export const LOCALE_COOKIE = 'nq_lang';

/**
 * 辞書の鍵は日本語そのもの。訳が無ければ日本語がそのまま出る。
 * 鍵を別に作らないのは、後から入れる i18n では鍵の付け直しが最大の
 * 作業になり、しかも**訳が抜けたときに画面が空になる**ため。
 */
export function translate(locale: Locale, ja: string): string {
  if (locale === 'ja') return ja;
  return DICT[ja] ?? ja;
}
