/**
 * 修正指示 → まとめて適用（設計 9.5 / 9.7 / 9.8）
 *
 * 2段に分ける。
 *
 *   1段目（安い）: 依頼ごとに「何をどう直すか」の**指示だけ**を作る。
 *                  リポジトリを読まないので費用がほぼ要らず、
 *                  社内が中身を読んで直せる。
 *   2段目（高い）: 選ばれた指示をまとめて1回投げ、そこで初めてコードを触る。
 *                  ファイルの中身は1回だけ送る。
 *
 * 依頼ごとにコードを書かせると、同じファイルを件数ぶん送ることになり、
 * しかも差分は人が読んで直しづらい。指示なら直せる。
 *
 * **自動マージはしない。例外なく PR で出す（9.8）**
 */
import Anthropic from '@anthropic-ai/sdk';
import { github, githubConfigured, installationFor } from '@/lib/github-client';
import type { T } from '@/lib/i18n-core';
import { logEvent, type Actor } from '@/lib/events';
import { tokensText } from '@/lib/site-tokens.mjs';
import type { SiteTokens } from '@/lib/site-tokens-store';
import { adminDb } from '@/lib/supabase/admin';
import { checkMaterial, looksLikeMaterialGap } from '@/lib/material-check';
import {
  anchorsFrom,
  elementNote,
  excerptAround,
  loopNeedles,
  pathError,
  selectorsFrom,
  structureChanged,
  STYLE_EXT,
  SOURCE_EXT,
  countOf,
} from '@/lib/auto-text';

const MODEL = 'claude-opus-5';

/* ── 1段目: 指示を作る ────────────────────────────────────────────────── */

const PLAN_SYSTEM = `あなたは制作会社のディレクターです。クライアントから来た修正依頼を、**エンジニアがそのまま実装できる指示**に書き換えます。**あなたはコードを書きません。** 指示だけを書きます。

**前提を取り違えないでください。**
1. 入ってくる文は必ず「直してほしいこと」です。クライアントは本番サイト上で要素をクリックして送っています。**指摘は指示として読んでください。**「小さい」→ 大きくしてほしい
2. どの要素の話かは決まっています。クリックされた要素を渡します。**それが対象です。**
3. 依頼文はたいてい断片です。文字要素に語句だけなら「その語句に差し替え」、画像要素に「イメージ写真」なら「この画像を差し替え」の意味です
4. **具体的な数値は求めないでください。** 「大きく」で十分です。刻みは下に渡す一覧から選んで、あなたが決めてください

指示の書き方:
- **何を、どこで、どう変えるかを1〜3文で**。「余白を広く」ではなく「.brand-name の font-size を 15px から 14px にする」のように、値まで決めて書く
- 触りそうなファイルとセレクタが分かるなら target_hint に書く（例: styles.css の .brand-name / .nav-link）
- 対象がコンテナで中に複数のテキストがある場合は、**まとめて動かす**指示にする。どれか1つを選ばせない
- 値が依頼文にも要素にも無い場合（許可番号、電話番号など）は doable を false にし、**何が足りないか**を reason に書く
- 要素の削除・並べ替え・機能の追加は doable を false にする。人が判断します
- 一行の注記を足すのは doable にしてよい（「この下に小さく〜と記載」）
- **同じ要素が繰り返し描画されている場合**（下に「N 個あり M 番目」と書かれているもの）は、テンプレートではなく**データ側の M 番目のエントリ**を直す指示にしてください。「テンプレートの {w.year} を直す」ではなく「作品データの M 番目（現在「令和6年」）の year を 2024 にする」のように書きます

**画像の差し替えはここでは扱いません。** doable を false にし、reason に「画像の差し替えは素材を添付して別の経路で行う」と書いてください。

question の書き方:
- **こちらでは決められない値がある場合だけ**書いてください。許可番号、電話番号、正式名称、どの写真か、など
- **依頼した本人がそのまま読む文**です。制作会社の担当者が書いた一文として読めるように書いてください
- 「情報が不足しています」ではなく「**派遣事業の許可番号をお教えいただけますか**」のように、何を答えればよいかが一読で分かる形にしてください
- 敬体で、1〜2文。長く書かないこと
- **「AI」「自動」「モデル」といった語は使わないでください**
- 聞くことが無ければ空文字にしてください。分かることをわざわざ聞かないこと`;

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: '依頼ごとに1件。渡された件数ぶん、飛ばさずに返すこと',
      items: {
        type: 'object',
        properties: {
          seq: { type: 'integer', description: 'どの依頼か。見出しの #番号' },
          doable: { type: 'boolean', description: '文言・文字まわりの指示として書けるか' },
          reason: { type: 'string', description: 'doable が false のときの理由。true なら空文字' },
          instruction: { type: 'string', description: '何をどう直すか。1〜3文。値まで決めて書く' },
          targetHint: { type: 'string', description: '触りそうなファイル・セレクタ。分からなければ空文字' },
          question: {
            type: 'string',
            description:
              'こちらでは決められず、依頼した本人に聞くべきことがある場合の質問文。' +
              '無ければ空文字。**クライアントがそのまま読む文**として書く',
          },
        },
        required: ['seq', 'doable', 'reason', 'instruction', 'targetHint', 'question'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

export interface PlanResult {
  seq: number;
  requestId: string;
  doable: boolean;
  reason: string;
  instruction: string;
  targetHint: string;
  /** クライアントに聞くべきこと。無ければ空文字 */
  question: string;
}

/**
 * 依頼から指示を作る。**リポジトリは読まない。**
 * 依頼文・クリックされた要素・当たっている CSS・サイトの刻みだけで書ける。
 */
export async function generateInstructions(
  projectId: string,
  actor: Actor,
  opts: { requestIds?: string[]; t?: T } = {},
): Promise<{ ok: boolean; message: string; created: number; results: PlanResult[] }> {
  // 社内が読む文だけ訳す。モデルに渡すプロンプトは日本語のまま
  const t = opts.t ?? ((s: string) => s);
  const db = adminDb();

  const { data: proj } = await db
    .from('projects')
    .select('id, design_tokens')
    .eq('id', projectId)
    .maybeSingle();
  if (!proj) return { ok: false, message: t('案件が見つかりません'), created: 0, results: [] };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: t('ANTHROPIC_API_KEY が設定されていません'), created: 0, results: [] };
  }

  let q = db
    .from('requests')
    .select('id, seq, body, category, subtype, outer_html, css_rules, nq_id, nq_ordinal, locator, status')
    .eq('project_id', projectId);
  q = opts.requestIds?.length ? q.in('id', opts.requestIds) : q.eq('status', 'received');
  const { data: reqs } = await q.order('seq').limit(30);
  if (!reqs?.length) {
    return { ok: true, message: t('対象の依頼がありません'), created: 0, results: [] };
  }

  // すでに下書きがあるものは作り直さない（名指しのときは作り直す）
  const { data: existing } = await db
    .from('fix_instructions')
    .select('request_id')
    .in('request_id', reqs.map((r) => r.id))
    .in('status', ['draft', 'approved']);
  const has = new Set(opts.requestIds?.length ? [] : (existing ?? []).map((e) => e.request_id));
  const targets = reqs.filter((r) => !has.has(r.id));
  if (!targets.length) {
    return { ok: true, message: t('すべて指示が作られています'), created: 0, results: [] };
  }

  const tok = tokensText((proj.design_tokens as SiteTokens | null) ?? null);
  const prompt = [
    '# 直してほしいこと（複数）',
    '',
    ...targets.map((r) =>
      [
        `## 依頼 #${r.seq}`,
        r.body.trim(),
        '',
        ...elementNote(r),
        '**この依頼は、下の要素をクリックして送られています。この要素が対象です。**',
        '```',
        (r.outer_html ?? '').slice(0, 2000),
        '```',
        (r.css_rules as { selector: string; cssText: string }[] | null)?.length
          ? '当たっている CSS:\n' +
            (r.css_rules as { selector: string; cssText: string }[])
              .slice(0, 10)
              .map((c) => `  ${c.selector} { ${String(c.cssText).slice(0, 200)} }`)
              .join('\n')
          : '',
        '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    tok ? `${tok}\n` : '',
    '上の依頼それぞれについて、items に1件ずつ返してください。**飛ばさず全件ぶん返してください。**',
  ].join('\n');

  const client = new Anthropic();
  let items: PlanResult[] = [];
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: PLAN_SYSTEM,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: PLAN_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
    const msg = await stream.finalMessage();
    const blk = msg.content.find((b) => b.type === 'text');
    if (!blk || blk.type !== 'text') throw new Error('空の応答');
    const parsed = JSON.parse(blk.text) as { items: Omit<PlanResult, 'requestId'>[] };
    items = (parsed.items ?? []).map((i) => ({
      ...i,
      requestId: targets.find((r) => r.seq === i.seq)?.id ?? '',
    }));
  } catch (e) {
    return {
      ok: false,
      message: t('指示を作れませんでした: {v1}', { v1: e instanceof Error ? e.message : String(e) }),
      created: 0,
      results: [],
    };
  }

  let created = 0;
  for (const i of items) {
    if (!i.requestId) continue;
    await db.from('fix_instructions').insert({
      project_id: projectId,
      request_id: i.requestId,
      instruction: i.instruction,
      target_hint: i.targetHint || null,
      question: i.question || null,
      doable: i.doable,
      reason: i.reason || null,
      status: i.doable ? 'draft' : 'skipped',
      source: 'auto',
    } as never);
    created++;
  }

  await logEvent({
    projectId,
    actor,
    entity: 'project',
    entityId: projectId,
    action: 'fix_instructions.generated',
    after: { created, doable: items.filter((i) => i.doable).length },
  });

  return { ok: true, message: t('{v1}件の指示を作りました', { v1: created }), created, results: items };
}

/**
 * 使った量と概算費用。**見えないと調整できない。**
 * キャッシュから読めた分は 1/10 の値段になるので、そこを分けて出す。
 */
function usageSummary(u: Anthropic.Usage | null) {
  if (!u) return undefined;
  const input = u.input_tokens ?? 0;
  const cached = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  // Opus 5: 入力 $5 / 出力 $25（100万トークンあたり）。書き込みは 1.25倍、読みは 0.1倍
  const usd =
    (input / 1e6) * 5 + (write / 1e6) * 6.25 + (cached / 1e6) * 0.5 + (output / 1e6) * 25;
  return { input: input + write, cached, output, yen: Math.round(usd * 155) };
}

/* ── 2段目: まとめて当てる ────────────────────────────────────────────── */

const APPLY_SYSTEM = `あなたはこのリポジトリを保守しているエンジニアです。**すでに決まっている指示**を、そのとおりに実装します。指示の是非は考えないでください。社内が確認済みです。

守ること:
- **指示に書かれていることだけ**を行う。ついでの整形をしない
- そのファイルの書き方に合わせる。周りのコードの記法・命名・インデントに揃える
- 既存のクラス名と CSS 変数を使う。新しい色や書体を導入しない
- style 属性を新しく足さない（元からインラインで書いているファイルなら、その流儀に合わせてよい）
- 一行の注記を足すのは認めます。足してよいのは p / span / small / div / li / br / strong / em だけで、script・画像・リンク・フォーム・イベント属性は不可
- **繰り返し描画されている要素は、テンプレートではなくデータ側を直す。** 「N 個あり M 番目」と書かれているものがそれです。テンプレートを直すと全部変わります

oldStr の決まり:
- 現在のファイルに**一字一句そのまま含まれている**文字列にしてください。空白もインデントも正確に
- ファイル内で**ちょうど1回だけ**現れる長さにしてください
- 同じ文字列が複数あるときは、**直前の属性やタグごと含めて一意に**してください。data-nq-id があるならそれを含めるのが確実です
- 変更する範囲だけを取ってください

指示どおりに当てられない場合は applicable を false にし、**何が足りないか**を理由に書いてください。無理に当てないでください。`;

const APPLY_SCHEMA = {
  type: 'object',
  properties: {
    patches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '指示の番号（渡した通し番号）' },
          applicable: { type: 'boolean' },
          reason: { type: 'string' },
          file: { type: 'string' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: { oldStr: { type: 'string' }, newStr: { type: 'string' } },
              required: ['oldStr', 'newStr'],
              additionalProperties: false,
            },
          },
          summary: { type: 'string', description: '何をどう変えたか。日本語1文' },
        },
        required: ['id', 'applicable', 'reason', 'file', 'edits', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['patches'],
  additionalProperties: false,
} as const;

export interface ApplyResultItem {
  instructionId: string;
  seq: number;
  status: 'applied' | 'skipped' | 'failed';
  detail: string;
}

/** 選ばれた指示をまとめて当て、PR を1本出す */
export async function applyInstructions(
  projectId: string,
  instructionIds: string[],
  actor: Actor,
  opts: { inspectOnly?: boolean; t?: T } = {},
): Promise<{
  ok: boolean;
  message: string;
  results: ApplyResultItem[];
  prUrl?: string;
  usage?: { input: number; cached: number; output: number; yen: number };
}> {
  // 社内が読む文だけ訳す。モデルに渡すプロンプトは日本語のまま
  const t = opts.t ?? ((s: string) => s);
  const db = adminDb();
  const results: ApplyResultItem[] = [];

  const { data: proj } = await db
    .from('projects')
    .select('id, repo_owner, repo_name, default_branch, gh_installation_id, design_tokens')
    .eq('id', projectId)
    .maybeSingle();
  if (!proj?.repo_owner || !proj.repo_name) {
    return { ok: false, message: t('リポジトリが設定されていません'), results };
  }
  if (!githubConfigured() || !process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: t('認証情報が設定されていません'), results };
  }
  if (!instructionIds.length) return { ok: false, message: t('指示が選ばれていません'), results };

  const { data: rows } = await db
    .from('fix_instructions')
    .select('id, request_id, instruction, target_hint, requests(seq, outer_html, css_rules, nq_id, nq_ordinal, locator, subtype)')
    .in('id', instructionIds)
    .eq('project_id', projectId);
  if (!rows?.length) return { ok: false, message: t('指示が見つかりません'), results };

  type Row = {
    id: string;
    request_id: string;
    instruction: string;
    target_hint: string | null;
    requests: {
      seq: number;
      outer_html: string | null;
      css_rules: { selector: string }[] | null;
      nq_id: string | null;
      nq_ordinal: number | null;
      locator: unknown;
      subtype: string | null;
    } | null;
  };
  const list = (rows as unknown as Row[]).filter((r) => r.requests);

  const gh = github();
  let inst = proj.gh_installation_id as number | null;
  if (!inst) {
    inst = await installationFor(gh, proj.repo_owner).catch(() => null);
    if (inst == null) return { ok: false, message: t('GitHub App が入っていません'), results };
  }
  const base = proj.default_branch || 'main';
  const owner = proj.repo_owner;
  const repo = proj.repo_name;

  const readFile = async (path: string, ref: string) => {
    const f = await gh.getFile(inst!, owner, repo, path, ref);
    if (Array.isArray(f)) return null;
    return { content: Buffer.from(f.content ?? '', 'base64').toString('utf8'), sha: f.sha };
  };

  const tree = await gh.getTree(inst, owner, repo, base);
  const paths = (tree.entries as { path: string; type: string; size?: number }[])
    .filter((e) => e.type === 'blob' && SOURCE_EXT.test(e.path) && !pathError(e.path))
    .filter((e) => (e.size ?? 0) < 400_000)
    .map((e) => e.path)
    .slice(0, 60);

  // ファイルは一度だけ読む
  const cache = new Map<string, { content: string; sha: string }>();
  for (const p of paths) {
    const f = await readFile(p, base);
    if (f) cache.set(p, f);
  }

  // 指示ごとに候補を出し、和集合を作る。
  // 手がかりも溜める。大きいファイルは、その周りだけを切り出して渡す。
  const union = new Map<string, string>();
  const needles = new Set<string>();
  const perItem: { row: Row; cand: string[] }[] = [];
  for (const row of list) {
    const r = row.requests!;
    const anchors = anchorsFrom(r.outer_html ?? '', r.nq_id);
    const selectors = selectorsFrom(r.outer_html ?? '', r.css_rules);
    for (const a of anchors) needles.add(a);
    for (const sel of selectors) needles.add(sel);
    if (r.nq_id) needles.add(`data-nq-id="${r.nq_id}"`);
    // ループ描画なら、テンプレートが参照している項目名も手がかりにする。
    // データ配列を抜粋に引き寄せるため
    const loc = (r.locator ?? {}) as { nqCount?: number | null };
    if (r.nq_id && (loc.nqCount ?? 0) > 1) {
      for (const [, f] of cache) for (const n of loopNeedles(f.content, r.nq_id)) needles.add(n);
    }
    const markup: { path: string; hits: number }[] = [];
    const styles: { path: string; hits: number }[] = [];
    for (const [path, f] of cache) {
      if (STYLE_EXT.test(path)) {
        const hits = selectors.filter((s) => f.content.includes(s)).length;
        if (hits > 0) styles.push({ path, hits });
      } else {
        const hits = anchors.filter((a) => f.content.includes(a)).length;
        if (hits > 0) markup.push({ path, hits });
      }
    }
    markup.sort((a, b) => b.hits - a.hits);
    styles.sort((a, b) => b.hits - a.hits);
    const cand = (
      r.subtype === 'style'
        ? [...styles.slice(0, 2), ...markup.slice(0, 1)]
        : [...markup.slice(0, 2), ...styles.slice(0, 1)]
    ).map((c) => c.path);
    for (const p of cand) if (!union.has(p)) union.set(p, cache.get(p)!.content);
    perItem.push({ row, cand });
  }

  /*
   * **モデルを呼ぶ前に材料を点検する。**
   * これまでの見送りは全部ここで分かるものだった。呼んでから
   * 「ファイルが切れています」と言われるのは、費用も時間も無駄になる。
   */
  const sentFiles = [...union.entries()].map(([path, content]) => {
    const ex = excerptAround(content, [...needles]);
    return { path, text: ex.text, note: ex.note };
  });

  const checked: typeof perItem = [];
  for (const item of perItem) {
    const mine = sentFiles.filter((f) => item.cand.includes(f.path));
    const mat = checkMaterial(item.row.requests!, mine, t);
    if (mat.problems.length) {
      results.push({
        instructionId: item.row.id,
        seq: item.row.requests!.seq,
        status: 'skipped',
        detail: t('材料が足りません: {why}', { why: mat.problems.join(' / ') }),
      });
      continue;
    }
    (item as typeof item & { facts: string[] }).facts = mat.facts;
    checked.push(item);
  }
  for (const item of checked) {
    const facts = (item as typeof item & { facts?: string[] }).facts ?? [];
    results.push({
      instructionId: item.row.id,
      seq: item.row.requests!.seq,
      status: 'skipped',
      detail:
        t('材料は揃っています（{files}）', { files: item.cand.join(' , ') }) +
        (facts.length ? ` — ${facts.join(' / ')}` : ''),
    });
  }

  // 点検だけ。モデルは呼ばない
  if (opts.inspectOnly) {
    const ng = results.filter((r) => r.detail.startsWith('材料が足りません')).length;
    return {
      ok: true,
      message:
        t('{n}件は材料が揃っています', { n: checked.length }) +
        (ng ? t(' / {n}件は足りません', { n: ng }) : ''),
      results,
    };
  }
  // 実行するときは、上で入れた「揃っています」は消す
  results.length = results.length - checked.length;

  if (!checked.length) {
    return { ok: true, message: t('材料が揃っている指示がありませんでした'), results };
  }

  const tok = tokensText((proj.design_tokens as SiteTokens | null) ?? null);
  /*
   * ファイルの中身を**先に**置く。
   *
   * 入力の大半はファイルで、しかも毎回同じ。ここでキャッシュを切ると、
   * 2回目以降（やり直し、点検のあとの実行、日をまたがない再実行）は
   * その部分が 1/10 の値段で読める。
   *
   * 変わるもの（指示）は後ろに置く。前に置くとキャッシュが毎回外れる。
   */
  const filesPart = [
    '# ファイルの中身',
    '',
    '大きいファイルは、指摘箇所の周辺だけを抜き出しています。`/* ……N 文字目から…… */` の行は**こちらが入れた目印**なので、oldStr に含めないでください。',
    '',
    ...sentFiles.map(
      (f) => `## ${f.path}${f.note ? `（${f.note}）` : ''}\n\`\`\`\n${f.text}\n\`\`\`\n`,
    ),
    tok ? `${tok}\n` : '',
  ].join('\n');

  const prompt = [
    '# 実装する指示（社内で確認済み）',
    '',
    ...checked.map((item) =>
      [
        `## 指示 ${item.row.id}（依頼 #${item.row.requests!.seq}）`,
        item.row.instruction,
        item.row.target_hint ? `触りそうな場所: ${item.row.target_hint}` : '',
        item.cand.length ? `見るべきファイル: ${item.cand.join(' , ')}` : '',
        ...((item as typeof item & { facts?: string[] }).facts ?? []),
        '```',
        (item.row.requests!.outer_html ?? '').slice(0, 1800),
        '```',
        '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    tok ? `${tok}\n` : '',
    '# ファイルの中身',
    '',
    '大きいファイルは、指摘箇所の周辺だけを抜き出しています。`/* ……N 文字目から…… */` の行は**こちらが入れた目印**なので、oldStr に含めないでください。',
    '',
    ...[...union.entries()].map(([p, c]) => {
      const ex = excerptAround(c, [...needles]);
      return `## ${p}${ex.note ? `（${ex.note}）` : ''}\n\`\`\`\n${ex.text}\n\`\`\`\n`;
    }),
    '',
    '指示ごとに patches へ1件返してください。id には指示の番号をそのまま入れてください。**飛ばさず全件ぶん返してください。**',
  ].join('\n');

  const client = new Anthropic();
  let usage: Anthropic.Usage | null = null;
  let patches: {
    id: string;
    applicable: boolean;
    reason: string;
    file: string;
    edits: { oldStr: string; newStr: string }[];
    summary: string;
  }[] = [];
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: APPLY_SYSTEM,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: APPLY_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [
        {
          role: 'user',
          content: [
            // ここまでをキャッシュする。2回目以降は 1/10 の値段で読める
            { type: 'text', text: filesPart, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    const msg = await stream.finalMessage();
    const blk = msg.content.find((b) => b.type === 'text');
    if (!blk || blk.type !== 'text') throw new Error('空の応答');
    patches = (JSON.parse(blk.text) as { patches: typeof patches }).patches ?? [];
    usage = msg.usage;
  } catch (e) {
    return {
      ok: false,
      message: t('書き換えを作れませんでした: {v1}', { v1: e instanceof Error ? e.message : String(e) }),
      results,
    };
  }

  const branch = `nq/fixes-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36).slice(-4)}`;
  let branchReady = false;
  const pending = new Map<string, string>();
  const wrote = new Map<string, { row: Row; summary: string }[]>();

  for (const { row } of checked) {
    const p = patches.find((x) => x.id === row.id);
    const seq = row.requests!.seq;
    if (!p) {
      results.push({ instructionId: row.id, seq, status: 'skipped', detail: t('結果が返りませんでした') });
      continue;
    }
    if (!p.applicable) {
      // 「材料が足りない」はこちらの不具合。普通の見送りと同じ顔をさせない
      const gap = looksLikeMaterialGap(p.reason);
      results.push({
        instructionId: row.id,
        seq,
        status: 'skipped',
        // 理由はモデルが日本語で返す。前置きだけ社内の言語にする
        detail: gap ? `${t('【材料不足・要調査】')}${p.reason}` : p.reason,
      });
      if (gap) console.error('[fix] 材料不足の疑い', { instruction: row.id, reason: p.reason });
      continue;
    }
    const pe = pathError(p.file, t);
    if (pe) {
      results.push({ instructionId: row.id, seq, status: 'skipped', detail: pe });
      continue;
    }
    if (!p.edits?.length || p.edits.length > 6) {
      results.push({
        instructionId: row.id,
        seq,
        status: 'skipped',
        detail: t('書き換えが {v1} 件です', { v1: p.edits?.length ?? 0 }),
      });
      continue;
    }
    const se = p.edits.map((e) => structureChanged(e.oldStr, e.newStr, t)).find(Boolean);
    if (se) {
      results.push({ instructionId: row.id, seq, status: 'skipped', detail: se });
      continue;
    }

    if (!branchReady) {
      try {
        await gh.getRef(inst, owner, repo, `heads/${branch}`);
      } catch {
        const b = await gh.getRef(inst, owner, repo, `heads/${base}`);
        await gh.createBranch(inst, owner, repo, branch, b.object.sha);
      }
      branchReady = true;
    }

    if (!pending.has(p.file)) {
      const cur = await readFile(p.file, branch);
      if (!cur) {
        results.push({ instructionId: row.id, seq, status: 'failed', detail: t('{v1} を読めません', { v1: p.file }) });
        continue;
      }
      pending.set(p.file, cur.content);
    }

    // 同じファイルに続けて当てるので、**前の書き換えを反映した内容**で再検証する
    let next = pending.get(p.file) as string;
    let bad: string | null = null;
    for (const e of p.edits) {
      const n = countOf(next, e.oldStr);
      if (n !== 1) {
        bad = n === 0 ? '対象が見つかりませんでした' : `対象が ${n} 箇所に当たります`;
        break;
      }
      next = next.replace(e.oldStr, e.newStr);
    }
    if (bad) {
      results.push({ instructionId: row.id, seq, status: 'skipped', detail: bad });
      continue;
    }
    pending.set(p.file, next);
    const l = wrote.get(p.file) ?? [];
    l.push({ row, summary: p.summary });
    wrote.set(p.file, l);
  }

  const done: { row: Row; summary: string }[] = [];
  for (const [path, content] of pending) {
    const items = wrote.get(path);
    if (!items?.length) continue;
    try {
      const cur = await readFile(path, branch);
      if (!cur) throw new Error(`${path} を読めません`);
      await gh.putFile(
        inst,
        owner,
        repo,
        path,
        Buffer.from(content, 'utf8'),
        items.length === 1
          ? `依頼 #${items[0].row.requests!.seq}: ${items[0].summary}`
          : `依頼 ${items.map((i) => `#${i.row.requests!.seq}`).join(' ')} の修正`,
        branch,
        cur.sha,
      );
      done.push(...items);
    } catch (e) {
      for (const it of items) {
        results.push({
          instructionId: it.row.id,
          seq: it.row.requests!.seq,
          status: 'failed',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  if (!done.length) {
    return { ok: true, message: t('当てられる書き換えはありませんでした'), results };
  }

  const pr = await gh.createPull(inst, owner, repo, {
    title:
      done.length === 1
        ? `依頼 #${done[0].row.requests!.seq}: ${done[0].summary}`
        : `修正 ${done.length}件`,
    head: branch,
    base,
    body:
      `社内で確認した修正指示を反映しました。\n\n` +
      done.map((d) => `- 依頼 #${d.row.requests!.seq}: ${d.summary}`).join('\n') +
      `\n\n---\n自動マージはしません。内容を確認してからマージしてください。`,
  });

  for (const d of done) {
    await db
      .from('fix_instructions')
      .update({
        status: 'applied',
        pr_url: pr.html_url,
        applied_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', d.row.id);
    await db
      .from('requests')
      .update({ status: 'in_progress' } as never)
      .eq('id', d.row.request_id);
    await db.from('ai_jobs').insert({
      request_id: d.row.request_id,
      dispatch_no: 1,
      patch_kind: 'text',
      provider: 'anthropic',
      status: 'succeeded',
      summary: d.summary,
      branch,
      pr_url: pr.html_url,
      pr_number: pr.number,
      finished_at: new Date().toISOString(),
    } as never);
    results.push({
      instructionId: d.row.id,
      seq: d.row.requests!.seq,
      status: 'applied',
      detail: d.summary,
    });
  }

  await logEvent({
    projectId,
    actor,
    entity: 'project',
    entityId: projectId,
    action: 'fix_instructions.applied',
    after: { applied: done.length, pr: pr.html_url, branch },
  });

  return {
    ok: true,
    message: t('{v1}件を反映して PR を出しました', { v1: done.length }),
    results,
    prUrl: pr.html_url,
    usage: usageSummary(usage),
  };
}
