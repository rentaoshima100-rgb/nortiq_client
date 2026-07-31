/**
 * 素材差し替え（設計 9.10 / 系統A）
 *
 * LLM を使わない。使えないのではなく、使う必要がない。
 * 系統B のパッチ形式 {file, old_str, new_str} はテキスト置換なのでバイナリを
 * 表現できず、9.5 のプロンプトは「新規作成・削除・リネーム禁止」なので、
 * LLM に流すと全件が構造的に reject される。
 *
 * 必要な情報はすべて揃っている:
 *   - ロケータから対象 <img> と現在の src（requests.target）
 *   - attachments.kind = 'material' の添付ファイル
 * したがって決定的に処理する。ZDR の取得を待たずに投入できる（13.3）。
 */
import sharp from 'sharp';
import { createHash } from 'node:crypto';

const MAX_BYTES = 500 * 1024;
const RASTER = /\.(jpe?g|png|webp|avif)$/i;

/** srcset を [{url, width}] に開く */
export function parseSrcset(srcset) {
  if (!srcset) return [];
  return srcset
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(/\s+/);
      const url = parts[0];
      const desc = parts[1] ?? '';
      const w = /^(\d+)w$/.exec(desc);
      return { url, width: w ? Number(w[1]) : null };
    })
    .filter((v) => v.url);
}

/**
 * 変種の集合を確定する（9.10 手順1・1b）
 *
 * currentSrc だけを差し替えてはならない。1440px で受けた依頼の 800w だけを
 * 更新すると、390px の閲覧者には古い 400w が出続ける。
 */
export function resolveVariants(target) {
  const fromSrcset = parseSrcset(target?.srcset);
  const base = target?.srcAttr ? [{ url: target.srcAttr, width: null }] : [];

  if (fromSrcset.length === 0) {
    if (!base.length) return { ok: false, reason: 'src が取れていません' };
    return { ok: true, variants: base, kind: 'single' };
  }

  // /_next/image?url=... は元画像1枚から動的生成される。
  // 元1枚を差し替えれば全変種が更新される（安全側）。
  const nextImage = fromSrcset.filter((v) => v.url.includes('/_next/image'));
  if (nextImage.length === fromSrcset.length) {
    const sources = new Set(
      nextImage.map((v) => {
        try {
          const u = new URL(v.url, 'https://x');
          return u.searchParams.get('url');
        } catch {
          return null;
        }
      }),
    );
    sources.delete(null);
    if (sources.size === 1) {
      return { ok: true, variants: [{ url: [...sources][0], width: null }], kind: 'next-image' };
    }
    return { ok: false, reason: '/_next/image の元画像が一意に決まりません' };
  }

  // 実ファイルが列挙されている場合は、それが変種の全集合。
  // src 属性も含めて重複を除く。
  const all = new Map();
  for (const v of [...fromSrcset, ...base]) {
    if (!all.has(v.url) || (v.width && !all.get(v.url).width)) all.set(v.url, v);
  }
  return { ok: true, variants: [...all.values()], kind: 'multi' };
}

/** URL からリポジトリ上の候補パスを作る（9.10 手順2） */
export function candidatePaths(url) {
  let p = url;
  try {
    if (/^https?:\/\//.test(p)) p = new URL(p).pathname;
  } catch {
    /* そのまま扱う */
  }
  if (p.includes('/_next/image')) {
    try {
      const u = new URL(p, 'https://x');
      p = u.searchParams.get('url') ?? p;
    } catch {
      /* noop */
    }
  }
  p = p.split('?')[0].split('#')[0];
  p = decodeURIComponent(p).replace(/^\.?\//, '');
  if (!p) return [];
  return [p, `public/${p}`, `static/${p}`, `dist/${p}`, `src/${p}`];
}

/**
 * 差し替え前のチェック（9.10 手順3）
 * ここで止めるものは、通してしまうと必ずレイアウトか画質の事故になる。
 */
export function preflight(originalPath, originalMeta, attachMeta) {
  if (/\.svg$/i.test(originalPath)) {
    return { ok: false, reason: '原画像が SVG です。ラスタ画像での置換は対象外（2.3）' };
  }
  if (!RASTER.test(originalPath)) {
    return { ok: false, reason: `対応していない形式です: ${originalPath}` };
  }
  if (!attachMeta.width || !attachMeta.height) {
    return { ok: false, reason: '添付の寸法が取れません' };
  }
  if (!originalMeta.width || !originalMeta.height) {
    return { ok: false, reason: '原画像の寸法が取れません' };
  }

  const arOrig = originalMeta.width / originalMeta.height;
  const arNew = attachMeta.width / attachMeta.height;
  const diff = Math.abs(arNew - arOrig) / arOrig;
  if (diff > 0.1) {
    return {
      ok: false,
      reason:
        `アスペクト比が ${(diff * 100).toFixed(0)}% 違います` +
        `（原 ${originalMeta.width}×${originalMeta.height} / 添付 ${attachMeta.width}×${attachMeta.height}）。` +
        'width/height 指定や aspect-ratio でレイアウトが崩れます',
    };
  }

  const longOrig = Math.max(originalMeta.width, originalMeta.height);
  const longNew = Math.max(attachMeta.width, attachMeta.height);
  if (longNew < longOrig * 0.7) {
    return {
      ok: false,
      reason:
        `添付の長辺 ${longNew}px が原画像 ${longOrig}px の 70% 未満です。` +
        '引き伸ばすとぼやけます',
    };
  }
  return { ok: true };
}

/** 原画像と同じ形式・同じ寸法で作り直す（9.10 手順4） */
export async function buildReplacement(attachBuffer, originalPath, originalMeta) {
  const ext = (originalPath.match(/\.(\w+)$/)?.[1] ?? 'jpg').toLowerCase();
  const target = { w: originalMeta.width, h: originalMeta.height };

  let quality = 82;
  for (;;) {
    // rotate() で EXIF の向きを反映してから、メタデータを落とす。
    // 位置情報が入っていることがあるため（9.10 手順4）
    let img = sharp(attachBuffer)
      .rotate()
      .resize({ width: target.w, height: target.h, fit: 'cover', withoutEnlargement: false });

    if (ext === 'png') img = img.png({ quality, compressionLevel: 9 });
    else if (ext === 'webp') img = img.webp({ quality });
    else if (ext === 'avif') img = img.avif({ quality });
    else img = img.jpeg({ quality, mozjpeg: true });

    const buf = await img.toBuffer();
    if (buf.length <= MAX_BYTES || quality <= 50) {
      return { buffer: buf, quality, ext, width: target.w, height: target.h };
    }
    quality -= 8;
  }
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * 差し替え一式を組み立てる。ここではまだリポジトリに書かない。
 * @returns { ok, patches:[{path, buffer, fromHash, toHash}], reason, needsHuman }
 */
export async function planAssetSwap({ gh, inst, owner, repo, ref, target, attachBuffer }) {
  const v = resolveVariants(target);
  if (!v.ok) return { ok: false, needsHuman: true, reason: v.reason };

  const attachMeta = await sharp(attachBuffer).metadata();

  const patches = [];
  for (const variant of v.variants) {
    let found = null;
    for (const cand of candidatePaths(variant.url)) {
      try {
        const f = await gh.getFile(inst, owner, repo, cand, ref);
        if (f && f.content) {
          found = { path: cand, buffer: Buffer.from(f.content, 'base64'), sha: f.sha };
          break;
        }
      } catch {
        /* 次の候補へ */
      }
    }
    if (!found) {
      return {
        ok: false,
        needsHuman: true,
        reason: `リポジトリ上のファイルを特定できません: ${variant.url}`,
      };
    }

    const originalMeta = await sharp(found.buffer).metadata();
    const pf = preflight(found.path, originalMeta, attachMeta);
    if (!pf.ok) return { ok: false, needsHuman: true, reason: pf.reason };

    const built = await buildReplacement(attachBuffer, found.path, originalMeta);
    patches.push({
      path: found.path,
      buffer: built.buffer,
      sha: found.sha,
      fromHash: sha256(found.buffer),
      toHash: sha256(built.buffer),
      from: { w: originalMeta.width, h: originalMeta.height, bytes: found.buffer.length },
      to: { w: built.width, h: built.height, bytes: built.buffer.length, quality: built.quality },
    });
  }

  return { ok: true, kind: v.kind, patches };
}

/**
 * 同じ画像が複数ページから参照されていないか（9.10 の注意）
 * 参照が2箇所以上あるなら PR コメントに明記する。
 */
export async function countReferences(gh, inst, owner, repo, ref, assetPath) {
  const token = await gh.installationToken(inst);
  const name = assetPath.split('/').pop();
  const res = await fetch(
    `https://api.github.com/search/code?q=${encodeURIComponent(`"${name}" repo:${owner}/${repo}`)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'nortiq-revise',
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!res.ok) return null; // 検索は失敗しても致命的ではない
  const j = await res.json();
  const n = j.total_count ?? 0;
  // 0 は「参照されていない」ではなく「インデックスが追いついていない」ことが多い。
  // リポジトリに存在するファイルの参照が 0 になるのは不自然なので、
  // 分からなかった扱いにする。誤った安心を与えない。
  return n > 0 ? n : null;
}
