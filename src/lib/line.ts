import { logEvent } from '@/lib/events';
import { adminDb } from '@/lib/supabase/admin';

/**
 * LINE 通知（設計 11.1）
 *
 * 「メールは読まれない。クライアントは LINE にいる。」
 * LINE をやめさせるのではなく、**LINE には通知だけ流して本体に誘導する**。
 * 依頼の中身のやりとりは LINE でやらない。
 *
 * 13.4: 文面に「AI」の語を出さない。
 *
 * 資格情報か送り先が無ければ黙って何もしない（設定前でも動くようにするため）。
 * ただし「送ったつもり」にならないよう、無効だったことは返り値で分かるようにする。
 */

const ENDPOINT = 'https://api.line.me/v2/bot/message/push';

export type LineResult =
  | { sent: true }
  | { sent: false; reason: 'disabled' | 'no-destination' | 'error'; detail?: string };

export async function pushLine(to: string | null, text: string): Promise<LineResult> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { sent: false, reason: 'disabled' };
  if (!to) return { sent: false, reason: 'no-destination' };

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      console.error('[line] 送信に失敗しました', res.status, detail);
      return { sent: false, reason: 'error', detail };
    }
    return { sent: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[line] 送信に失敗しました', detail);
    return { sent: false, reason: 'error', detail };
  }
}

/**
 * 同じ通知を二度送らない。events を見張り番にする。
 * @param dedupeKey 例: `round:{id}:published` / `round:{id}:remind:7`
 */
export async function notifyOnce(opts: {
  projectId: string;
  to: string | null;
  dedupeKey: string;
  text: string;
}): Promise<LineResult> {
  const db = adminDb();
  const { count } = await db
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', opts.projectId)
    .eq('action', 'line.sent')
    .contains('after', { key: opts.dedupeKey });
  if ((count ?? 0) > 0) return { sent: false, reason: 'disabled', detail: '送信済み' };

  const res = await pushLine(opts.to, opts.text);
  if (res.sent) {
    await logEvent({
      projectId: opts.projectId,
      actor: { type: 'system', id: 'line' },
      entity: 'project',
      entityId: opts.projectId,
      action: 'line.sent',
      after: { key: opts.dedupeKey, chars: opts.text.length },
    });
  }
  return res;
}

/* ── 文面（11.1 / 13.4）──────────────────────────────────────── */

export function publishedMessage(projectName: string, siteUrl: string, confirmDays: number) {
  return [
    `【${projectName}】修正が反映されました。`,
    '',
    'サイトを開いて、右下のボタンからご確認ください。',
    siteUrl,
    '',
    `${confirmDays}日ご連絡がない場合は、ご確認いただいたものとして扱います。`,
  ].join('\n');
}

export function remindMessage(projectName: string, siteUrl: string, daysLeft: number) {
  return [
    `【${projectName}】修正内容のご確認をお願いします。`,
    '',
    `あと${daysLeft}日でご確認いただいたものとして扱います。`,
    '直っていない箇所があれば、その旨をお知らせください。',
    siteUrl,
  ].join('\n');
}

export function freezeSoonMessage(projectName: string, siteUrl: string, daysLeft: number) {
  return [
    `【${projectName}】今回の修正依頼の受付について。`,
    '',
    `あと${daysLeft}日 新しいご依頼がなければ、今回ぶんの受付を締め切って修正に入ります。`,
    '追加のご依頼があればお早めにお願いします。',
    siteUrl,
  ].join('\n');
}
