import { errorJson, json } from '@/lib/http';
import { runDueTransitions } from '@/lib/rounds';
import { adminDb } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 期限で進む遷移をまとめて処理する（設計 8.2 ② / 8.6）
 *
 * - open のラウンドが freeze_idle_days 新規依頼なしならフリーズ
 * - published のラウンドが auto_confirm_days 経過したら自動確認
 *
 * 読まれたときに追いつく方式（runDueTransitions）を各画面でも呼んでいるので、
 * これが止まっても状態は壊れない。誰も画面を見ていない案件のために置く。
 *
 * ディスパッチ（素材差し替え）はここには置かない。sharp と GitHub 操作が要るため、
 * ワーカー側の tick.mjs が持つ。
 */
export async function GET(req: Request) {
  // Vercel Cron は Authorization: Bearer $CRON_SECRET を付けてくる
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) return errorJson('unauthorized', 401);
  }

  const db = adminDb();
  const { data: projects, error } = await db.from('projects').select('id, name');
  if (error) return errorJson('案件を取得できませんでした', 500);

  const results: { project: string; ok: boolean }[] = [];
  for (const p of projects ?? []) {
    try {
      await runDueTransitions(p.id, db);
      results.push({ project: p.name, ok: true });
    } catch (e) {
      console.error('[tick] 失敗', p.name, e);
      results.push({ project: p.name, ok: false });
    }
  }

  return json({ ok: true, checked: results.length, results });
}
