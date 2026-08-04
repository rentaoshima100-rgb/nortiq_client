/**
 * クライアントが書いた文の英訳
 *
 * 社内画面の文字列は辞書で訳せるが、**依頼文はクライアントが打ったもの**
 * なので辞書では訳せない。ここだけモデルを呼ぶ。
 *
 * 費用の考え方:
 *   - **一度訳したら保存する。** 依頼文は後から変わらない
 *   - 未訳のものだけを、**1回にまとめて**投げる。依頼ごとに呼ばない
 *   - effort は low。訳すだけの仕事に考える時間は要らない
 *   - 社内が EN にしている案件でしか走らない（呼ぶ側で見ている）
 *
 * 原文は消さない。`body` はそのまま残し、`body_en` を足すだけにする。
 * 訳が怪しいときに原文へ戻れないと、社内が判断できなくなる。
 */
import Anthropic from '@anthropic-ai/sdk';
import type { T } from '@/lib/i18n-core';
import { adminDb } from '@/lib/supabase/admin';

const MODEL = 'claude-opus-5';

/** 1回に投げる上限。多すぎると出力が長くなって切れる */
const BATCH = 40;

const SYSTEM = `You translate Japanese website fix-requests into English for the internal team of a web agency.

The text was typed by a client on their own live website, after clicking the element they want changed. It is usually a fragment, not a sentence — "文字が小さい", "イメージ写真", a person's name, a phone number.

Rules:
- Translate what is there. **Do not add, explain, or interpret.** "文字が小さい" is "the text is small", not "please make the text larger".
- Keep fragments as fragments. Do not turn a noun into a sentence.
- **Leave proper nouns, product names, addresses, phone numbers, licence numbers and dates as they are** when they carry no meaning in translation. A person's name may be romanised, but keep the original in parentheses when the reading is not obvious.
- Keep the original line breaks.
- If the text is already English, return it unchanged.
- Return an empty string for an empty input.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: 'One entry per request, in the order given. Do not skip any.',
      items: {
        type: 'object',
        properties: {
          seq: { type: 'integer', description: 'The #number of the request' },
          bodyEn: { type: 'string', description: 'English of the request text' },
          answerEn: {
            type: 'string',
            description: "English of the client's answer. Empty string if there was none",
          },
        },
        required: ['seq', 'bodyEn', 'answerEn'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

interface Row {
  id: string;
  seq: number;
  body: string;
  client_answer: string | null;
}

export interface TranslateOut {
  ok: boolean;
  message: string;
  /** 訳した件数 */
  done: number;
}

/**
 * 未訳の依頼を訳して保存する。
 *
 * `ids` を渡すとその依頼だけ。渡さなければ案件の未訳ぶん全部。
 * `force` を立てると、訳済みでも訳し直す（原文を直したとき用）。
 */
export async function translateRequests(
  projectId: string,
  opts: { ids?: string[]; force?: boolean; t?: T } = {},
): Promise<TranslateOut> {
  const t = opts.t ?? ((s: string) => s);
  const db = adminDb();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: t('ANTHROPIC_API_KEY が設定されていません'), done: 0 };
  }

  let q = db
    .from('requests')
    .select('id, seq, body, client_answer')
    .eq('project_id', projectId);
  if (opts.ids?.length) q = q.in('id', opts.ids);
  if (!opts.force) q = q.is('translated_at', null);

  const { data } = await q.order('seq').limit(BATCH);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return { ok: true, message: t('訳すものはありません'), done: 0 };

  const prompt = rows
    .map((r) =>
      [
        `## Request #${r.seq}`,
        r.body.trim() || '(empty)',
        r.client_answer?.trim() ? `\n### Client's answer\n${r.client_answer.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');

  let items: { seq: number; bodyEn: string; answerEn: string }[];
  try {
    const stream = new Anthropic().messages.stream({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: {
        // 訳すだけ。考える時間に費用をかけない
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
      message: t('訳せませんでした: {why}', {
        why: e instanceof Error ? e.message : String(e),
      }),
      done: 0,
    };
  }

  const bySeq = new Map(items.map((i) => [i.seq, i]));
  const now = new Date().toISOString();
  let done = 0;
  for (const r of rows) {
    const got = bySeq.get(r.seq);
    if (!got) continue;
    await db
      .from('requests')
      .update({
        body_en: got.bodyEn || null,
        client_answer_en: got.answerEn || null,
        translated_at: now,
      } as never)
      .eq('id', r.id);
    done++;
  }

  // events は通していない。訳は原文を書き換えないので、5.2 の監査対象外
  const left = rows.length - done;
  return {
    ok: true,
    message: left
      ? t('{n}件を訳しました（{left}件は返りませんでした）', { n: done, left })
      : t('{n}件を訳しました', { n: done }),
    done,
  };
}

/** まだ訳していない依頼の件数。ボタンに出す */
export async function untranslatedCount(projectId: string): Promise<number> {
  const { count } = await adminDb()
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .is('translated_at', null);
  return count ?? 0;
}
