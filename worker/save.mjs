import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * WebP の1辺の上限は 16383px。deviceScaleFactor 2 で撮ると、
 * 縦 8200 CSS px を超えたページはそのままでは保存できない。
 * 設計 13.2 の「縦 15000px を超えるページはタイル分割」に当たる箇所だが、
 * DSF 2 を掛けた実寸で見る必要がある。
 *
 * 分割したタイルは連番で保存し、切り出し（ピン座標からの crop）のときは
 * y 座標からタイルを選ぶ。
 */
const WEBP_MAX = 16383;
const TILE_H = 8000; // 実寸。DSF2 なら CSS 4000px 相当

export async function saveShot(png, outDir, baseName, quality = 80) {
  const meta = await sharp(png).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (height <= WEBP_MAX && width <= WEBP_MAX) {
    const buf = await sharp(png).webp({ quality }).toBuffer();
    const file = join(outDir, `${baseName}.webp`);
    writeFileSync(file, buf);
    return { tiled: false, width, height, files: [{ file, y: 0, h: height, bytes: buf.length }] };
  }

  const files = [];
  for (let y = 0, i = 0; y < height; y += TILE_H, i++) {
    const h = Math.min(TILE_H, height - y);
    const buf = await sharp(png)
      .extract({ left: 0, top: y, width, height: h })
      .webp({ quality })
      .toBuffer();
    const file = join(outDir, `${baseName}.t${String(i).padStart(2, '0')}.webp`);
    writeFileSync(file, buf);
    files.push({ file, y, h, bytes: buf.length });
  }
  return { tiled: true, width, height, files };
}
