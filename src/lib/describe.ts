import type { Locator } from '@/lib/types';

/**
 * 依頼が指している要素を、社内の人間が読める一行にする。
 *
 * Phase 1 のスナップショット（切り出し画像）が入るまでの繋ぎではなく、
 * 入ったあとも一覧では文字の方が速いので残す想定。
 *
 * textSample が空になるのは珍しくない。7.4 の ownText と同じ規則で
 * 「直下のテキストノード」しか見ていないため、画像グリッドのような
 * コンテナは必ず空になる。その場合は outerHTML から手がかりを拾う。
 */
export function describeTarget(loc: Locator, outerHtml: string | null): string {
  if (loc.textSample && loc.textSample.trim()) return loc.textSample.trim();

  const html = outerHtml ?? '';

  // alt 属性は「その画像が何か」を人が書いた唯一の情報なので最優先
  const alts = Array.from(html.matchAll(/\balt="([^"]*)"/g))
    .map((m) => m[1].trim())
    .filter(Boolean);
  if (alts.length) {
    const head = alts.slice(0, 3).join(' / ');
    return `画像${alts.length}点: ${head}${alts.length > 3 ? ' ほか' : ''}`;
  }

  const files = Array.from(html.matchAll(/\bsrc="([^"]+)"/g))
    .map((m) => (m[1].split('?')[0].split('/').pop() || '').trim())
    .filter(Boolean);
  if (files.length) return `画像: ${files.slice(0, 3).join(' / ')}`;

  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text) return text.length > 80 ? text.slice(0, 80) + '…' : text;

  const cls = /\bclass="([^"]+)"/.exec(html);
  if (cls) return '.' + cls[1].trim().split(/\s+/)[0];

  return loc.tag.toLowerCase();
}

/** ページのどのあたりか（bbox.y と docHeight から） */
export function positionInPage(loc: Locator): { percent: number; label: string } {
  const h = loc.docHeight || 0;
  const y = loc.bbox?.y ?? 0;
  if (h <= 0) return { percent: 0, label: '位置不明' };
  const percent = Math.min(100, Math.max(0, Math.round((y / h) * 100)));
  const label =
    percent < 15
      ? 'ページ上部'
      : percent < 45
        ? 'ページ上寄り'
        : percent < 65
          ? 'ページ中ほど'
          : percent < 88
            ? 'ページ下寄り'
            : 'ページ最下部';
  return { percent, label };
}

/**
 * 「サイトで見る」の着地先。
 * ウィジェットが #nq-pin=N を読んで、その箇所までスクロールして光らせる。
 * 開く側にも招待トークンが要る（ウィジェットはトークン無しでは何も描かない）。
 */
export function siteViewUrl(siteUrl: string, pagePath: string, seq: number): string {
  const base = siteUrl.replace(/\/+$/, '');
  const path = pagePath && pagePath !== '/' ? pagePath : '/';
  return `${base}${path}#nq-pin=${seq}`;
}
