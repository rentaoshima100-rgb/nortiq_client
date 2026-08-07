/**
 * 言語切り替えの土台。**サーバー専用のものを入れない。**
 *
 * ここに next/headers を混ぜると、クライアントコンポーネントから
 * 辿ったときにビルドが落ちる（実測）。cookies() を使う入口は
 * i18n.ts 側に置いてある。
 */
import { DICT } from './i18n-dict';

export type Locale = 'ja' | 'en';
export type Vars = Record<string, string | number | null | undefined>;
export type T = (ja: string, vars?: Vars) => string;

export const LOCALE_COOKIE = 'nq_lang';

/**
 * 辞書の鍵は日本語そのもの。訳が無ければ日本語がそのまま出る。
 * 鍵を別に作らないのは、後から入れる i18n では鍵の付け直しが最大の
 * 作業になり、しかも**訳が抜けたときに画面が空になる**ため。
 *
 * 値を差し込む文は `{n}` を鍵に含める。テンプレート文字列のまま
 * 鍵にすると、件数が変わるたびに別の鍵になって訳が当たらない。
 *
 *   t('選んだ {n} 件を実行', { n: 3 })
 *
 * 差し込む値が無い `{…}` はそのまま残す（訳の書き間違いを画面で気づける）。
 */
/**
 * `t` を渡されなかったときの既定。
 *
 * **恒等関数にしてはいけない。** 差し込みを素通しするので、
 * `{n}件をまとめました` がそのまま画面やログに出る（実測で出した）。
 * 日本語のまま、差し込みだけは行う。cron のように Cookie が無い経路と、
 * ライブラリを直接叩く経路がこれを使う。
 */
export const plainT: T = (ja, vars) => translate('ja', ja, vars);

export function translate(locale: Locale, ja: string, vars?: Vars): string {
  const s = locale === 'ja' ? ja : (DICT[ja] ?? ja);
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in vars && vars[k] != null ? String(vars[k]) : m,
  );
}
