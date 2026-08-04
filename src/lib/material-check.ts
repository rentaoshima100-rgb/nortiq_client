/**
 * 材料の点検
 *
 * これまでの見送りは、判断の問題ではなく**材料の問題**だった。
 *
 *   「styles.css をご提示いただければ」      → 候補に入れていなかった
 *   「提示されたファイルは途中で切れており」   → 90,000 文字で頭切りしていた
 *   「同じ nq-id で記述が食い違っており」      → 序数を渡していなかった
 *   「{w.year} は動的な式です」               → ループ描画だと伝えていなかった
 *
 * どれもモデルは正しく報告していた。問題は、**呼んでみるまで分からない**
 * ことだった。モデルを呼ぶ前に機械で点検し、足りないものを名指しする。
 *
 * ここで止まったものは費用がかからない。そして理由が具体的なので、
 * 社内が次に何をすればよいかが分かる。
 */

export interface Material {
  /** 対象がリポジトリの中で見つかったか */
  found: boolean;
  /** どのファイルで見つかったか */
  files: string[];
  /** 実際に渡す本文の中に、対象が含まれているか（抜粋で落ちていないか） */
  inExcerpt: boolean;
  /** 対象の出現回数。1 でなければ一意に取れない */
  occurrences: number;
  /** 繰り返し描画されているか */
  loop: { count: number; ordinal: number | null } | null;
  /** 止めるべき理由。空なら通してよい */
  problems: string[];
  /** モデルに添える事実 */
  facts: string[];
}

export interface RequestForCheck {
  nq_id?: string | null;
  nq_ordinal?: number | null;
  outer_html?: string | null;
  locator?: unknown;
  subtype?: string | null;
}

/** 対象を指す文字列を、確からしい順に並べる */
export function targetKeys(r: RequestForCheck): string[] {
  const loc = (r.locator ?? {}) as { textSample?: string | null };
  const keys: string[] = [];
  if (r.nq_id) keys.push(`data-nq-id="${r.nq_id}"`);
  const text = (loc.textSample ?? '').trim();
  // 「—」のような1文字は手がかりにならない
  if (text.length >= 3) keys.push(text.slice(0, 60));
  return keys;
}

function countIn(hay: string, needle: string): number {
  let n = 0;
  let i = 0;
  for (;;) {
    const at = hay.indexOf(needle, i);
    if (at < 0) break;
    n++;
    i = at + needle.length;
  }
  return n;
}

/**
 * 実際に渡す本文（抜粋済み）に対して点検する。
 * **抜粋の後で見るのが要点。** 元ファイルにあっても、渡す本文から
 * 落ちていれば同じことになる。
 */
export function checkMaterial(
  r: RequestForCheck,
  sent: { path: string; text: string }[],
): Material {
  const loc = (r.locator ?? {}) as { nqCount?: number | null; textSample?: string | null };
  const keys = targetKeys(r);
  const problems: string[] = [];
  const facts: string[] = [];

  const loop =
    loc.nqCount != null && loc.nqCount > 1
      ? { count: loc.nqCount, ordinal: r.nq_ordinal ?? null }
      : null;

  const files: string[] = [];
  let occurrences = 0;
  for (const f of sent) {
    for (const k of keys) {
      const n = countIn(f.text, k);
      if (n > 0) {
        if (!files.includes(f.path)) files.push(f.path);
        occurrences += n;
        break; // 同じファイルで二重に数えない
      }
    }
  }

  const found = files.length > 0;

  if (!keys.length) {
    problems.push(
      '対象を指す手がかりがありません（nq-id もテキストも取れていない）。' +
        'サイトに data-nq-id を注入すると確実になります。',
    );
  } else if (!found) {
    problems.push(
      `対象（${keys[0]}）が、渡すファイルの中に見つかりません。` +
        'リポジトリに無いか、ビルド後に生成される要素の可能性があります。' +
        `探した範囲: ${sent.map((s) => s.path).join(' , ') || 'なし'}`,
    );
  }

  if (found) {
    facts.push(`対象は ${files.join(' , ')} にあります`);
    if (occurrences > 1 && !loop) {
      facts.push(
        `同じ手がかりが ${occurrences} 箇所にあります。前後を含めて一意にしてください`,
      );
    }
  }

  if (loop) {
    facts.push(
      `**この要素は文書内に ${loop.count} 個あり、対象はその ${(loop.ordinal ?? 0) + 1} 番目です。**` +
        '配列データから繰り返し描画されています。' +
        `テンプレートを書き換えると ${loop.count} 個すべてが変わります。` +
        `直すのはデータ配列の ${(loop.ordinal ?? 0) + 1} 番目のエントリです。`,
    );
    if (loop.ordinal == null) {
      problems.push(
        `繰り返し描画されている要素ですが、何番目かが記録されていません。` +
          'どのデータを直すか決められません。',
      );
    }
  }

  if (loc.textSample) {
    facts.push(`対象の現在のテキスト: 「${String(loc.textSample).slice(0, 80)}」`);
  }

  return {
    found,
    files,
    inExcerpt: found,
    occurrences,
    loop,
    problems,
    facts,
  };
}

/**
 * モデルが返した理由が「材料が足りない」ものかを見分ける。
 *
 * これはこちらの不具合であって、依頼の問題ではない。
 * 普通の見送りと同じ見え方にすると、原因が埋もれて再発する。
 */
const MATERIAL_PATTERNS = [
  /途中で切れ/,
  /含まれていません/,
  /提示され(てい|)ない/,
  /ご提示[いを]/,
  /全文が必要/,
  /が必要です/,
  /確認できな/,
  /特定できません/,
];

export function looksLikeMaterialGap(reason: string): boolean {
  return MATERIAL_PATTERNS.some((re) => re.test(reason));
}
