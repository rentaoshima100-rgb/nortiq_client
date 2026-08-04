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
import { logEvent, type Actor } from '@/lib/events';
import { tokensText } from '@/lib/site-tokens.mjs';
import type { SiteTokens } from '@/lib/site-tokens-store';
import { adminDb } from '@/lib/supabase/admin';
import {
  anchorsFrom,
  excerptAround,
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

**画像の差し替えはここでは扱いません。** doable を false にし、reason に「画像の差し替えは素材を添付して別の経路で行う」と書いてください。`;

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
        },
        required: ['seq', 'doable', 'reason', 'instruction', 'targetHint'],
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
}

/**
 * 依頼から指示を作る。**リポジトリは読まない。**
 * 依頼文・クリックされた要素・当たっている CSS・サイトの刻みだけで書ける。
 */
export async function generateInstructions(
  projectId: string,
  actor: Actor,
  opts: { requestIds?: string[] } = {},
): Promise<{ ok: boolean; message: string; created: number; results: PlanResult[] }> {
  const db = adminDb();

  const { data: proj } = await db
    .from('projects')
    .select('id, design_tokens')
    .eq('id', projectId)
    .maybeSingle();
  if (!proj) return { ok: false, message: '案件が見つかりません', created: 0, results: [] };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: 'ANTHROPIC_API_KEY が設定されていません', created: 0, results: [] };
  }

  let q = db
    .from('requests')
    .select('id, seq, body, category, subtype, outer_html, css_rules, nq_id, status')
    .eq('project_id', projectId);
  q = opts.requestIds?.length ? q.in('id', opts.requestIds) : q.eq('status', 'received');
  const { data: reqs } = await q.order('seq').limit(30);
  if (!reqs?.length) {
    return { ok: true, message: '対象の依頼がありません', created: 0, results: [] };
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
    return { ok: true, message: 'すべて指示が作られています', created: 0, results: [] };
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
        r.nq_id ? `対象の nq-id: ${r.nq_id}` : '',
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
    const t = msg.content.find((b) => b.type === 'text');
    if (!t || t.type !== 'text') throw new Error('空の応答');
    const parsed = JSON.parse(t.text) as { items: Omit<PlanResult, 'requestId'>[] };
    items = (parsed.items ?? []).map((i) => ({
      ...i,
      requestId: targets.find((r) => r.seq === i.seq)?.id ?? '',
    }));
  } catch (e) {
    return {
      ok: false,
      message: `指示を作れませんでした: ${e instanceof Error ? e.message : String(e)}`,
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

  return { ok: true, message: `${created}件の指示を作りました`, created, results: items };
}

/* ── 2段目: まとめて当てる ────────────────────────────────────────────── */

const APPLY_SYSTEM = `あなたはこのリポジトリを保守しているエンジニアです。**すでに決まっている指示**を、そのとおりに実装します。指示の是非は考えないでください。社内が確認済みです。

守ること:
- **指示に書かれていることだけ**を行う。ついでの整形をしない
- そのファイルの書き方に合わせる。周りのコードの記法・命名・インデントに揃える
- 既存のクラス名と CSS 変数を使う。新しい色や書体を導入しない
- style 属性を新しく足さない（元からインラインで書いているファイルなら、その流儀に合わせてよい）
- 一行の注記を足すのは認めます。足してよいのは p / span / small / div / li / br / strong / em だけで、script・画像・リンク・フォーム・イベント属性は不可

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
): Promise<{ ok: boolean; message: string; results: ApplyResultItem[]; prUrl?: string }> {
  const db = adminDb();
  const results: ApplyResultItem[] = [];

  const { data: proj } = await db
    .from('projects')
    .select('id, repo_owner, repo_name, default_branch, gh_installation_id, design_tokens')
    .eq('id', projectId)
    .maybeSingle();
  if (!proj?.repo_owner || !proj.repo_name) {
    return { ok: false, message: 'リポジトリが設定されていません', results };
  }
  if (!githubConfigured() || !process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: '認証情報が設定されていません', results };
  }
  if (!instructionIds.length) return { ok: false, message: '指示が選ばれていません', results };

  const { data: rows } = await db
    .from('fix_instructions')
    .select('id, request_id, instruction, target_hint, requests(seq, outer_html, css_rules, nq_id, subtype)')
    .in('id', instructionIds)
    .eq('project_id', projectId);
  if (!rows?.length) return { ok: false, message: '指示が見つかりません', results };

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
      subtype: string | null;
    } | null;
  };
  const list = (rows as unknown as Row[]).filter((r) => r.requests);

  const gh = github();
  let inst = proj.gh_installation_id as number | null;
  if (!inst) {
    inst = await installationFor(gh, proj.repo_owner).catch(() => null);
    if (inst == null) return { ok: false, message: 'GitHub App が入っていません', results };
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

  const tok = tokensText((proj.design_tokens as SiteTokens | null) ?? null);
  const prompt = [
    '# 実装する指示（社内で確認済み）',
    '',
    ...perItem.map(({ row, cand }) =>
      [
        `## 指示 ${row.id}（依頼 #${row.requests!.seq}）`,
        row.instruction,
        row.target_hint ? `触りそうな場所: ${row.target_hint}` : '',
        cand.length ? `見るべきファイル: ${cand.join(' , ')}` : '',
        row.requests!.nq_id ? `対象の nq-id: ${row.requests!.nq_id}` : '',
        '```',
        (row.requests!.outer_html ?? '').slice(0, 1800),
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
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
    const msg = await stream.finalMessage();
    const t = msg.content.find((b) => b.type === 'text');
    if (!t || t.type !== 'text') throw new Error('空の応答');
    patches = (JSON.parse(t.text) as { patches: typeof patches }).patches ?? [];
  } catch (e) {
    return {
      ok: false,
      message: `書き換えを作れませんでした: ${e instanceof Error ? e.message : String(e)}`,
      results,
    };
  }

  const branch = `nq/fixes-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36).slice(-4)}`;
  let branchReady = false;
  const pending = new Map<string, string>();
  const wrote = new Map<string, { row: Row; summary: string }[]>();

  for (const { row } of perItem) {
    const p = patches.find((x) => x.id === row.id);
    const seq = row.requests!.seq;
    if (!p) {
      results.push({ instructionId: row.id, seq, status: 'skipped', detail: '結果が返りませんでした' });
      continue;
    }
    if (!p.applicable) {
      results.push({ instructionId: row.id, seq, status: 'skipped', detail: p.reason });
      continue;
    }
    const pe = pathError(p.file);
    if (pe) {
      results.push({ instructionId: row.id, seq, status: 'skipped', detail: pe });
      continue;
    }
    if (!p.edits?.length || p.edits.length > 6) {
      results.push({
        instructionId: row.id,
        seq,
        status: 'skipped',
        detail: `書き換えが ${p.edits?.length ?? 0} 件です`,
      });
      continue;
    }
    const se = p.edits.map((e) => structureChanged(e.oldStr, e.newStr)).find(Boolean);
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
        results.push({ instructionId: row.id, seq, status: 'failed', detail: `${p.file} を読めません` });
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
    return { ok: true, message: '当てられる書き換えはありませんでした', results };
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

  return { ok: true, message: `${done.length}件を反映して PR を出しました`, results, prUrl: pr.html_url };
}
