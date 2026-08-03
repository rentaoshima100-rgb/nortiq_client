import type { SupabaseClient } from '@supabase/supabase-js';
import { errorJson, json } from '@/lib/http';
import { freezeSoonMessage, notifyOnce, remindMessage } from '@/lib/line';
import { daysUntil, runDueTransitions } from '@/lib/rounds';
import { runAutoText } from '@/lib/auto-text';
import { adminDb } from '@/lib/supabase/admin';

interface TickProject {
  id: string;
  name: string;
  site_url: string;
  line_to: string | null;
  auto_confirm_days: number;
}

/**
 * 期限に応じた LINE 通知（11.1）
 * - 確認リマインド: 公開から 3日後・7日後・13日後
 * - フリーズ予告: 締切まで残り1日
 *
 * 「勝手に締め切られた」「勝手にカウントされた」を起こさないために送る。
 * 同じ通知は二度送らない（notifyOnce が events で見張る）。
 */
async function sendDueNotifications(p: TickProject, db: SupabaseClient): Promise<number> {
  let sent = 0;

  const { data: published } = await db
    .from('rounds')
    .select('id, seq, confirm_due_at')
    .eq('project_id', p.id)
    .eq('status', 'published')
    .not('confirm_due_at', 'is', null);

  for (const r of published ?? []) {
    const left = daysUntil(r.confirm_due_at);
    if (left == null) continue;
    const total = p.auto_confirm_days ?? 14;
    // 3日後 / 7日後 / 13日後 に相当する「残り日数」で判定する
    const milestones = [total - 3, total - 7, total - 13].filter((d) => d > 0);
    if (!milestones.includes(left)) continue;
    const res = await notifyOnce({
      projectId: p.id,
      to: p.line_to,
      dedupeKey: `round:${r.id}:remind:${left}`,
      text: remindMessage(p.name, p.site_url, left),
    });
    if (res.sent) sent++;
  }

  const { data: open } = await db
    .from('rounds')
    .select('id, seq, freeze_due_at')
    .eq('project_id', p.id)
    .eq('status', 'open')
    .not('freeze_due_at', 'is', null);

  for (const r of open ?? []) {
    const left = daysUntil(r.freeze_due_at);
    if (left !== 1) continue;
    const res = await notifyOnce({
      projectId: p.id,
      to: p.line_to,
      dedupeKey: `round:${r.id}:freeze-soon`,
      text: freezeSoonMessage(p.name, p.site_url, left),
    });
    if (res.sent) sent++;
  }

  return sent;
}

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
export const maxDuration = 300;

export async function GET(req: Request) {
  // Vercel Cron は Authorization: Bearer $CRON_SECRET を付けてくる
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) return errorJson('unauthorized', 401);
  }

  const db = adminDb();
  const { data: projects, error } = await db
    .from('projects')
    .select('id, name, site_url, line_to, auto_confirm_days');
  if (error) return errorJson('案件を取得できませんでした', 500);

  const results: {
    project: string;
    ok: boolean;
    notified: number;
    autoText?: string;
  }[] = [];
  for (const p of projects ?? []) {
    try {
      await runDueTransitions(p.id, db);
      const notified = await sendDueNotifications(p, db);

      // 文言・文字まわりの自動反映（8.2 / 9.5）。
      // ai_enabled が立っている案件だけ。落ちても通知の結果は返す。
      let autoText: string | undefined;
      try {
        const r = await runAutoText(p.id);
        autoText = r.message;
      } catch (e) {
        console.error('[tick] 自動反映に失敗', p.name, e);
        autoText = `失敗: ${e instanceof Error ? e.message : String(e)}`;
      }

      results.push({ project: p.name, ok: true, notified, autoText });
    } catch (e) {
      console.error('[tick] 失敗', p.name, e);
      results.push({ project: p.name, ok: false, notified: 0 });
    }
  }

  return json({ ok: true, checked: results.length, results });
}
