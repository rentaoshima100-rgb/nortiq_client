import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** マジックリンクのトークンは DB に平文で置かない（5.1 / 10.2） */
export function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 32byte ランダムの base64url（10.2） */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * ウィジェット側の textHash と同じ規則。
 * 片方だけ変えるとロケータの段1〜2（6.7）が黙って全滅するため、
 * 変更するときは widget/src/locator.ts と必ず対にすること。
 */
export function textHashOf(text: string): string {
  return 'sha1:' + createHash('sha1').update(text, 'utf8').digest('hex');
}
