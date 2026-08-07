/**
 * 「どう対応したか」をクライアント向けに書き起こす
 *
 * 完了した依頼は、サイトから目印を降ろす。直し終えた箇所に番号が浮いていても
 * 読む側の役に立たず、**目印が外れやすいのもまさに完了分**だから
 * （直したことで本文が変わり、手がかりが同時に死ぬ）。
 *
 * ただし黙って消すと、クライアントから見れば依頼が消えたのと同じになる。
 * 消える代わりに「何をしたか」が読めるようにする。それがこの文。
 *
 * 材料は**実際の記録**（fix_instructions の指示文と PR）。ここから
 * 想像で書かない。記録が無い依頼は空のままにして、社内が手で書く。
 *
 * 13.4: 文面に「AI」「自動」「モデル」を出さない。社内が対応した記録として書く。
 */
import Anthropic from '@anthropic-ai/sdk';
import { logEvent, type Actor } from '@/lib/events';
import type { T } from '@/lib/i18n-core';
import { adminDb } from '@/lib/supabase/admin';

const MODEL = 'claude-opus-5';
const BATCH = 40;

const SYSTEM = `あなたは制作会社の担当者です。クライアントから来た修正依頼に対して**何をしたか**を、依頼した本人が読む文として1〜2文で書きます。

- **敬体**。「〜しました」「〜に変更しました」
- **事実だけ**。渡した記録に書かれていないことを足さない
- セレクタ・ファイル名・クラス名は出さない。相手はコードを読まない
- 「AI」「自動」「モデル」「生成」といった語は使わない
- 見送った依頼は、見送った理由を穏当に書く。断定的に突き放さない
- 記録が薄くて何をしたか分からない場合は空文字を返す。**推測で書かない**

例:
  依頼「2024 令和表記ではなく西暦で」＋記録「令和6年を2024年に変更」
  → 「年号の表記を西暦に変更しました。」

  依頼「この下に小さく記載…」＋記録「h2 の直下に注記の p を追加」
  → 「見出しの下に、ご指定の一文を小さく追記しました。」`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: '渡された依頼ごとに1件。飛ばさずに返すこと',
      items: {
        type: 'object',
        properties: {
          seq: { type: 'integer', description: 'どの依頼か。見出しの #番号' },
          resolution: {
            type: 'string',
            description: '何をしたか。1〜2文。分からなければ空文字',
          },
        },
        required: ['seq', 'resolution'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

export interface DraftOut {
  ok: boolean;
  message: string;
  drafted: number;
}

/**
 * まだ対応内容が入っていない依頼について、記録から下書きを作る。
 * **下書きなので、そのままではクライアントに出ない**（社内が確認して保存する）。
 */
export async function draftResolutions(
  projectId: string,
  actor: Actor,
  opts: { ids?: string[]; force?: boolean; t?: T } = {},
): Promise<DraftOut> {
  const t = opts.t ?? ((s: string) => s);
  const db = adminDb();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: t('ANTHROPIC_API_KEY が設定されていません'), drafted: 0 };
  }

  let q = db
    .from('requests')
    .select('id, seq, body, status, resolution')
    .eq('project_id', projectId)
    .in('status', ['done', 'wont_fix']);
  if (opts.ids?.length) q = q.in('id', opts.ids);
  if (!opts.force) q = q.is('resolution', null);

  const { data } = await q.order('seq').limit(BATCH);
  const rows = (data ?? []) as {
    id: string;
    seq: number;
    body: string;
    status: string;
    resolution: string | null;
  }[];
  if (!rows.length) return { ok: true, message: t('書くものはありません'), drafted: 0 };

  // 実際にやったことの記録。ここに無いものは想像で書かせない
  const { data: fixes } = await db
    .from('fix_instructions')
    .select('request_id, instruction, status, reason, pr_url')
    .in(
      'request_id',
      rows.map((r) => r.id),
    );
  const byReq = new Map<string, { instruction: string; status: string; reason: string | null }[]>();
  for (const f of (fixes ?? []) as {
    request_id: string;
    instruction: string;
    status: string;
    reason: string | null;
  }[]) {
    const list = byReq.get(f.request_id) ?? [];
    list.push({ instruction: f.instruction, status: f.status, reason: f.reason });
    byReq.set(f.request_id, list);
  }

  const prompt = rows
    .map((r) => {
      const recs = byReq.get(r.id) ?? [];
      return [
        `## 依頼 #${r.seq}（状態: ${r.status === 'done' ? '完了' : '見送り'}）`,
        `依頼された内容: ${r.body.trim()}`,
        recs.length
          ? `記録:\n${recs.map((x) => `  - [${x.status}] ${x.instruction}${x.reason ? `（理由: ${x.reason}）` : ''}`).join('\n')}`
          : '記録: なし',
      ].join('\n');
    })
    .join('\n\n');

  let items: { seq: number; resolution: string }[];
  try {
    const stream = new Anthropic().messages.stream({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
    const msg = await stream.finalMessage();
    const blk = msg.content.find((b) => b.type === 'text');
    if (!blk || blk.type !== 'text') throw new Error('空の応答');
    items = (JSON.parse(blk.text) as { items: typeof items }).items ?? [];
  } catch (e) {
    return {
      ok: false,
      message: t('対応内容を作れませんでした: {why}', {
        why: e instanceof Error ? e.message : String(e),
      }),
      drafted: 0,
    };
  }

  const bySeq = new Map(items.map((i) => [i.seq, i.resolution]));
  const now = new Date().toISOString();
  let drafted = 0;
  for (const r of rows) {
    const text = (bySeq.get(r.seq) ?? '').trim();
    if (!text) continue; // 分からなかったものは空のまま。社内が手で書く
    await db
      .from('requests')
      .update({ resolution: text, resolution_at: now } as never)
      .eq('id', r.id);
    drafted++;
  }

  if (drafted) {
    await logEvent({
      projectId,
      actor,
      entity: 'project',
      entityId: projectId,
      action: 'requests.resolution_drafted',
      after: { count: drafted },
    });
  }

  const blank = rows.length - drafted;
  return {
    ok: true,
    message: blank
      ? t('{n}件に書きました（{blank}件は記録が足りず空のままです）', { n: drafted, blank })
      : t('{n}件に書きました', { n: drafted }),
    drafted,
  };
}
