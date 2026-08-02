/**
 * GitHub webhook の署名検証（公開エンドポイントの入口）
 *
 * ここを緩めると、誰でも「本番に出た」と書き込めて招待が早く出る。
 * ルートから切り出してあるのは、単体で確かめられるようにするため。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signBody(raw: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
}

export function verifySignature(
  raw: string,
  header: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(signBody(raw, secret));
  const b = Buffer.from(header);
  // 長さが違うと timingSafeEqual は例外を投げる。先に弾く。
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function webhookSecret(): string | null {
  return process.env.NQ_GH_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET || null;
}
