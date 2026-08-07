/**
 * 配信 URL → リポジトリ上のパス（写真の差し替え先を決める）
 *
 * **ここが素材差し替えの全部。** LLM を使わないので、当てるか当てないかは
 * この関数の判定だけで決まる。だから依存を持たせず、単体で試せるようにする。
 *
 * 取り違えは「別のページの画像が変わる」という形で出る。PR を読めば
 * 気づけるとはいえ、気づけなかったときの害が大きい。
 * **決まらないときは決めない。** 候補を返して人に選ばせる。
 */

/** 差し替えてよい拡張子。動画と SVG は入れない（SVG はスクリプトを持てる） */
export const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;

/**
 * リポジトリの中で「配信されるファイル」が居そうな場所。
 * 静的サイトは URL とパスが一致し、Next.js / Vite は public/ の中身が
 * ルートに出る。前に付けて探すぶんだけ並べる。
 */
const PUBLIC_DIRS = ['', 'public/', 'static/', 'assets/', 'src/assets/', 'app/'];

/** `/images/ceo.jpg?v=3` → `images/ceo.jpg` */
export function urlToPath(src: string): string | null {
  let s = src.trim();
  if (!s) return null;
  // data: と blob: はリポジトリに元ファイルが無い
  if (/^(data|blob):/i.test(s)) return null;
  // srcset が入っていることがある（locator は src を優先するが念のため）
  s = s.split(',')[0].trim().split(/\s+/)[0];
  try {
    // 絶対 URL ならパスだけ。`//example.com/a.png` も URL として扱う
    s = /^(https?:)?\/\//i.test(s)
      ? new URL(s, 'https://x.invalid').pathname
      : s.split('?')[0].split('#')[0];
  } catch {
    return null;
  }
  s = s.replace(/^\.{1,2}\//, '').replace(/^\/+/, '');
  if (!s || s.endsWith('/')) return null;
  return decodeURIComponent(s);
}

export interface Resolved {
  /** 置き換えるパス。決まらなければ null */
  file: string | null;
  /** 決まらなかったときに人へ見せる候補 */
  candidates: string[];
  /** どの手で当てたか。PR の説明と画面に出す */
  how: 'exact' | 'prefix' | 'suffix' | 'basename' | 'none';
}

/**
 * @param srcAttr 依頼時に押された img の src 属性（6.7。currentSrc は使わない）
 * @param repoPaths リポジトリのファイル一覧（ツリー全部でよい）
 */
export function resolveRepoPath(srcAttr: string | null, repoPaths: string[]): Resolved {
  const want = srcAttr ? urlToPath(srcAttr) : null;
  if (!want) return { file: null, candidates: [], how: 'none' };

  const paths = repoPaths.filter((p) => IMAGE_EXT.test(p));

  // 1. そのまま一致
  if (paths.indexOf(want) >= 0) return { file: want, candidates: [want], how: 'exact' };

  // 2. public/ などを前に付けて一致
  for (const dir of PUBLIC_DIRS) {
    if (!dir) continue;
    const hit = paths.indexOf(dir + want);
    if (hit >= 0) return { file: paths[hit], candidates: [paths[hit]], how: 'prefix' };
  }

  // 3. 後ろから一致（配信時に前置きが削られている場合）。
  //    1つに絞れたときだけ採る
  const tail = paths.filter((p) => p.endsWith('/' + want));
  if (tail.length === 1) return { file: tail[0], candidates: tail, how: 'suffix' };
  if (tail.length > 1) return { file: null, candidates: tail, how: 'none' };

  /*
   * 4. ファイル名だけで一致。**最後の手段。**
   *    同じ名前の画像が複数の場所にあるのは普通なので、1つしか無いときだけ。
   */
  const base = want.split('/').pop() ?? '';
  const byName = base ? paths.filter((p) => p.split('/').pop() === base) : [];
  if (byName.length === 1) return { file: byName[0], candidates: byName, how: 'basename' };
  return { file: null, candidates: byName.slice(0, 20), how: 'none' };
}
