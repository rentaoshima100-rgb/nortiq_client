/**
 * outer_html のサニタイズ（10.4）
 *
 * 保存された outer_html は「エスケープされたテキスト」としてしか表示せず、
 * dangerouslySetInnerHTML には決して渡さない。
 * ここでのサニタイズは、その前提のうえでの二重の安全弁である。
 */

const MAX_OUTER_HTML = 4096;

export function sanitizeOuterHtml(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = String(input);

  // <script> / <iframe> はまるごと落とす
  s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  s = s.replace(/<script\b[^>]*\/?>/gi, '');
  s = s.replace(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, '<iframe></iframe>');

  // on* イベント属性（"..." / '...' / 裸）
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');

  // javascript: スキーム
  s = s.replace(/javascript:/gi, 'javascript_:');

  if (s.length > MAX_OUTER_HTML) s = s.slice(0, MAX_OUTER_HTML) + '…';
  return s;
}

/** 依頼本文。制御文字（改行・タブ・復帰は除く）を落とし、長さを切る。 */
export function sanitizeBody(input: string, max = 4000): string {
  let out = '';
  for (const ch of String(input)) {
    const c = ch.codePointAt(0) as number;
    const isControl = (c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127;
    if (!isControl) out += ch;
  }
  return out.trim().slice(0, max);
}

/** ページパス。クエリとフラグメントを落として path だけにする。 */
export function normalizePagePath(input: string): string {
  let p = String(input || '/').trim();
  p = p.split('#')[0].split('?')[0];
  if (!p.startsWith('/')) p = '/' + p;
  // 末尾スラッシュは「/」以外では落として正規化する（撮影対象の一覧と揃える）
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p.slice(0, 512);
}
