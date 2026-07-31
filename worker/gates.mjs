/**
 * パッチのゲート（設計 9.6 / 9.4）
 *
 * ここを通らなかったものはリポジトリに触らせない。
 * 「ビルドが通るから大丈夫」ではない。インラインスタイルは
 * ビルドが通るのでゲートをすり抜け、設計システムを壊す「動くゴミ」になる。
 */

const ALLOWED = [
  /^src\//,
  /^app\//, // Next.js App Router。設計の列挙には無いが実態として必要
  /^components\//,
  /^styles\//,
  /^assets\//,
  /^public\//,
  /^index\.html$/,
];

const FORBIDDEN = [
  /^package(-lock)?\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^\.github\//,
  /^\.env/,
  /\.config\.(js|mjs|cjs|ts)$/,
  /^tsconfig(\.\w+)?\.json$/,
  /^node_modules\//,
];

export function checkPath(file) {
  if (typeof file !== 'string' || !file || file.includes('..')) {
    return { ok: false, reason: 'パスが不正です' };
  }
  if (FORBIDDEN.some((re) => re.test(file))) {
    return { ok: false, reason: `禁止パスです: ${file}` };
  }
  if (!ALLOWED.some((re) => re.test(file))) {
    return { ok: false, reason: `許可パスの外です: ${file}` };
  }
  return { ok: true };
}

/**
 * インラインスタイル禁止（9.4）
 * 元の要素に style 属性が無かったのに style= や !important を足すパッチは
 * 無条件で reject する。
 */
export function checkInlineStyle(oldStr, newStr) {
  const hadStyle = /\bstyle\s*=/.test(oldStr);
  const addsStyle = /\bstyle\s*=/.test(newStr) && !hadStyle;
  if (addsStyle) return { ok: false, reason: 'style 属性のインライン付与は禁止です' };
  if (/!important/.test(newStr) && !/!important/.test(oldStr)) {
    return { ok: false, reason: '!important の使用は禁止です' };
  }
  return { ok: true };
}

/** 変更行数の上限（9.5 / 9.6） */
export function checkSize(oldStr, newStr, maxLines = 40) {
  const lines = Math.max(oldStr.split('\n').length, newStr.split('\n').length);
  if (lines > maxLines) {
    return { ok: false, reason: `変更行数が ${lines} 行で上限 ${maxLines} を超えます` };
  }
  return { ok: true };
}

/** テキストパッチの全ゲート */
export function gateTextPatch(patch) {
  for (const check of [
    () => checkPath(patch.file),
    () => checkInlineStyle(patch.oldStr ?? '', patch.newStr ?? ''),
    () => checkSize(patch.oldStr ?? '', patch.newStr ?? ''),
  ]) {
    const r = check();
    if (!r.ok) return r;
  }
  if (!patch.oldStr) return { ok: false, reason: 'old_str が空です' };
  if (patch.oldStr === patch.newStr) return { ok: false, reason: '変更がありません' };
  return { ok: true };
}

/** 素材差し替え（9.10）。バイナリなので old_str は無い。 */
export function gateAssetPatch(patch) {
  const r = checkPath(patch.path);
  if (!r.ok) return r;
  if (!patch.buffer || !patch.buffer.length) return { ok: false, reason: '中身が空です' };
  return { ok: true };
}
