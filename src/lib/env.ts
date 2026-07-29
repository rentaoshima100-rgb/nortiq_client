/**
 * 環境変数の読み出し。
 * モジュール読み込み時ではなく参照時に検証する（未設定でもビルドは通す）。
 */

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません`);
  return v;
}

export function optionalEnv(name: string): string | null {
  return process.env[name] || null;
}

export const ATTACHMENTS_BUCKET =
  process.env.SUPABASE_ATTACHMENTS_BUCKET || 'nq-attachments';

/** 社内ダッシュボードに入れるメールアドレス（カンマ区切り） */
export function staffEmails(): string[] {
  return (process.env.STAFF_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isStaffEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = staffEmails();
  // 未設定なら誰も通さない（開けっ放しの事故を防ぐ）
  if (list.length === 0) return false;
  return list.includes(email.toLowerCase());
}

/**
 * スニペットや招待リンクの組み立てに使う自分自身の URL。
 * Vercel では NEXT_PUBLIC_APP_URL を設定しなくても本番ドメインに解決できるよう、
 * プラットフォームが入れる環境変数にフォールバックする。
 */
export function appUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || null;
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}
