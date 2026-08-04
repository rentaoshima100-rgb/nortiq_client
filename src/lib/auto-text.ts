/**
 * 文言と文字まわりの自動反映（設計 8.2 / 9.2 / 9.5 / 9.7）
 *
 * 「ここの文字を大きく」「この一文を直して」は、判断の余地が小さく
 * 壊しても戻しやすい。ここだけを自動で回す。
 *
 * 自動で回してよい条件を厳しく取る:
 *   - 案件で ai_enabled が立っている
 *   - 依頼が **minor かつ text / style**。仕様変更・不具合は対象外（8.1）
 *   - 分類が自動でついた場合、**自信が高いものだけ**通す
 *   - 構造を変える書き換えは拒否する（9.5）
 *
 * クライアントの操作では発火しない（9.2）。デバウンスを置いて溜めてから
 * まとめて出す。1依頼1PRにすると N ブランチ N PR N レビューになる。
 *
 * **自動マージはしない。例外なく PR で出す（9.8）**
 */
import Anthropic from '@anthropic-ai/sdk';
import { github, githubConfigured, installationFor } from '@/lib/github-client';
import { adminDb } from '@/lib/supabase/admin';
import { logEvent, type Actor } from '@/lib/events';

const MODEL = 'claude-opus-5';
const SYSTEM_ACTOR: Actor = { type: 'system', id: 'auto-text' };

const ALLOWED = [/^src\//, /^app\//, /^components\//, /^styles\//, /^assets\//, /^public\//, /^index\.html$/];
const FORBIDDEN = [
  /^package(-lock)?\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /^\.github\//,
  /^\.env/,
  /\.config\.(js|mjs|cjs|ts)$/,
  /^tsconfig(\.\w+)?\.json$/,
  /^node_modules\//,
];
const SOURCE_EXT = /\.(html?|jsx?|tsx?|vue|svelte|astro|liquid|erb|php|twig)$/i;

function pathError(file: string): string | null {
  if (!file || file.includes('..')) return 'パスが不正です';
  if (FORBIDDEN.some((re) => re.test(file))) return `禁止パスです: ${file}`;
  if (!ALLOWED.some((re) => re.test(file))) return `許可パスの外です: ${file}`;
  return null;
}

function count(hay: string, needle: string): number {
  let n = 0;
  let i = 0;
  for (;;) {
    const at = hay.indexOf(needle, i);
    if (at < 0) break;
    n++;
    i = at + needle.length;
  }
  return n;
}

/* ── 分類 ───────────────────────────────────────────────────────────────── */

const CLASSIFY_SYSTEM = `あなたは制作会社のディレクターです。クライアントから来た修正依頼を仕分けします。

**自動で直してよいものだけを minor にしてください。** ここで通したものは人手を介さずコードが書き換わり、PR として出ます。迷ったら unclassified にしてください。人が見ます。**取りこぼしは安全ですが、通しすぎは事故になります。**

category:
- minor    文言の言い換え、誤字、文字の大小・太さ・行間・字間の調整。**元からある要素の中身や見え方を変えるだけ**のもの
- spec_change  要素の追加・削除・並べ替え、機能の変更、ページの追加。「〜を増やして」「〜を無くして」「〜の順番を」
- defect   表示崩れ、動かない、リンク切れ。「ずれている」「押せない」「表示されない」
- unclassified  上のどれか判断がつかない。**曖昧な表現、複数のことを同時に言っている、対象が特定できない**

subtype（category が minor のときだけ）:
- text   文言そのものを変える
- style  文字の大きさ・太さ・色・行間・字間・余白を変える
- asset  画像の差し替え
- order  並べ替え（これは minor にしない。spec_change です）

confidence:
- high    依頼文だけで、どこをどう直すか一意に決まる
- medium  だいたい分かるが、解釈の余地がある
- low     推測が要る

**自動反映は minor かつ confidence が high のものだけ**に使われます。そのつもりで付けてください。`;

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['minor', 'spec_change', 'defect', 'unclassified'] },
    subtype: { type: 'string', enum: ['text', 'style', 'asset', 'order', 'none'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string', description: 'そう判断した理由。日本語1文' },
  },
  required: ['category', 'subtype', 'confidence', 'reason'],
  additionalProperties: false,
} as const;

export interface Classification {
  category: 'minor' | 'spec_change' | 'defect' | 'unclassified';
  subtype: 'text' | 'style' | 'asset' | 'order' | 'none';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export async function classify(body: string, outerHtml: string | null): Promise<Classification> {
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2000,
    system: CLASSIFY_SYSTEM,
    output_config: {
      effort: 'low', // 仕分けは短い判断。ここに時間をかけない
      format: { type: 'json_schema', schema: CLASSIFY_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `# 依頼\n${body.trim()}\n\n` +
              (outerHtml ? `# 指された要素\n\`\`\`\n${outerHtml.slice(0, 2000)}\n\`\`\`` : ''),
          },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  const t = msg.content.find((b) => b.type === 'text');
  if (!t || t.type !== 'text') throw new Error('分類が空でした');
  return JSON.parse(t.text) as Classification;
}

/* ── 書き換え ───────────────────────────────────────────────────────────── */

const PATCH_SYSTEM = `あなたはこのリポジトリを保守しているエンジニアです。クライアントからの修正依頼を、**最小の書き換え**で反映します。

**やってよいのは、文言を変えることと、文字の大きさ・太さ・行間・字間・色を変えることだけです。**

やってはいけないこと:
- 要素を増やす・減らす・並べ替える
- タグや構造を変える
- 新しいクラスや CSS 変数を作る
- 依頼に書かれていない箇所を直す（ついでの整形もしない）
- style 属性を新しく足す（元からインラインで書いているファイルなら、その流儀に合わせてよい）
- 色や書体を、そのサイトで使われていないものに変える

**依頼が上の範囲を超えている場合は、applicable を false にして理由を書いてください。** 無理に当てないでください。人が見ます。

oldStr の決まり:
- 現在のファイルに**一字一句そのまま含まれている**文字列にしてください。空白もインデントも正確に
- ファイル内で**ちょうど1回だけ**現れる長さにしてください
- 変更する範囲だけを取ってください。**前後の行を巻き込まないこと**`;

const PATCH_SCHEMA = {
  type: 'object',
  properties: {
    applicable: { type: 'boolean', description: '文言・文字まわりの変更として当てられるか' },
    reason: { type: 'string', description: 'applicable が false のときの理由。true なら空文字でよい' },
    file: { type: 'string' },
    oldStr: { type: 'string' },
    newStr: { type: 'string' },
    summary: { type: 'string', description: '何をどう変えたか。日本語1文' },
  },
  required: ['applicable', 'reason', 'file', 'oldStr', 'newStr', 'summary'],
  additionalProperties: false,
} as const;

interface Patch {
  applicable: boolean;
  reason: string;
  file: string;
  oldStr: string;
  newStr: string;
  summary: string;
}

function anchorsFrom(outerHtml: string): string[] {
  const out: string[] = [];
  for (const m of outerHtml.matchAll(/[぀-ヿ一-龯ー]{4,20}/g)) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (out.length >= 12) break;
  }
  for (const m of outerHtml.matchAll(/\b[A-Z]{4,16}\b/g)) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (out.length >= 18) break;
  }
  return out;
}

/**
 * 構造を変えていないかを機械で見る（9.5）
 * モデルの自己申告だけに頼らない。
 */
function structureChanged(oldStr: string, newStr: string): string | null {
  const tags = (s: string) =>
    [...s.matchAll(/<\s*\/?\s*([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase()).sort().join(',');
  if (tags(oldStr) !== tags(newStr)) {
    return 'タグの構成が変わっています。文言・文字まわりの変更ではありません。';
  }
  if (!/\bstyle\s*=/.test(oldStr) && /\bstyle\s*=/.test(newStr)) {
    return 'style 属性を新しく足しています。';
  }
  if (/!important/.test(newStr) && !/!important/.test(oldStr)) {
    return '!important を新しく使っています。';
  }
  const grew = newStr.length / Math.max(1, oldStr.length);
  if (grew > 3) return '書き換え後が元の3倍を超えています。最小の変更になっていません。';
  return null;
}

export interface AutoResult {
  requestId: string;
  seq: number;
  status: 'applied' | 'skipped' | 'failed';
  detail: string;
}

/**
 * 1案件ぶん回す。**PR は1本にまとめる**（9.2 の理由2）。
 * 依頼ごとに PR を立てると N ブランチ N レビューになる。
 */
export async function runAutoText(
  projectId: string,
  opts: { manual?: boolean } = {},
): Promise<{
  ok: boolean;
  message: string;
  results: AutoResult[];
  prUrl?: string;
}> {
  const db = adminDb();
  const results: AutoResult[] = [];

  const { data: proj } = await db
    .from('projects')
    .select(
      'id, name, ai_enabled, repo_owner, repo_name, default_branch, gh_installation_id, dispatch_debounce_minutes',
    )
    .eq('id', projectId)
    .maybeSingle();

  if (!proj) return { ok: false, message: '案件が見つかりません', results };
  // 手で押したときは、無効でも走らせる。社内が明示的に押している
  if (!proj.ai_enabled && !opts.manual) {
    return { ok: true, message: '自動反映は無効です', results };
  }
  if (!proj.repo_owner || !proj.repo_name) {
    return { ok: false, message: 'リポジトリが設定されていません', results };
  }
  if (!githubConfigured() || !process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: '認証情報が設定されていません', results };
  }

  // デバウンス（8.2）。直近の依頼が続いている間は動かさない
  // 手で押したときは待たせない（クライアントの目の前で直したい、締切が近い）
  const debounceMs = opts.manual ? 0 : (proj.dispatch_debounce_minutes ?? 30) * 60_000;
  const { data: latest } = await db
    .from('requests')
    .select('created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (latest?.length) {
    const waited = Date.now() - new Date(latest[0].created_at).getTime();
    if (waited < debounceMs) {
      return {
        ok: true,
        message: `デバウンス中（あと ${Math.ceil((debounceMs - waited) / 60_000)} 分）`,
        results,
      };
    }
  }

  // 未処理の依頼
  const { data: reqs } = await db
    .from('requests')
    .select('id, seq, body, category, subtype, status, outer_html')
    .eq('project_id', projectId)
    .eq('status', 'received')
    .order('seq')
    .limit(20);
  if (!reqs?.length) return { ok: true, message: '対象の依頼がありません', results };

  const { data: jobs } = await db
    .from('ai_jobs')
    .select('request_id')
    .in('request_id', reqs.map((r) => r.id));
  const done = new Set((jobs ?? []).map((j) => j.request_id));

  // ── 分類。未分類のものだけ、その場で仕分ける
  const targets: typeof reqs = [];
  for (const r of reqs) {
    if (done.has(r.id)) continue;

    let category = r.category as string;
    let subtype = r.subtype as string | null;

    if (category === 'unclassified') {
      try {
        const c = await classify(r.body, r.outer_html);
        await db
          .from('requests')
          .update({ category: c.category, subtype: c.subtype === 'none' ? null : c.subtype } as never)
          .eq('id', r.id);
        await logEvent({
          projectId,
          actor: SYSTEM_ACTOR,
          entity: 'request',
          entityId: r.id,
          action: 'request.classified',
          after: { ...c, auto: true },
        });
        category = c.category;
        subtype = c.subtype === 'none' ? null : c.subtype;

        // 自動反映は「自信が高い」ものだけ。迷いがあるものは人が見る
        if (c.confidence !== 'high') {
          results.push({
            requestId: r.id,
            seq: r.seq,
            status: 'skipped',
            detail: `分類の自信が ${c.confidence} のため人の確認に回します（${c.reason}）`,
          });
          continue;
        }
      } catch (e) {
        results.push({ requestId: r.id, seq: r.seq, status: 'failed', detail: `分類に失敗: ${e}` });
        continue;
      }
    }

    if (category !== 'minor' || (subtype !== 'text' && subtype !== 'style')) {
      results.push({
        requestId: r.id,
        seq: r.seq,
        status: 'skipped',
        detail: `${category}${subtype ? ' / ' + subtype : ''} は自動反映の対象外です`,
      });
      continue;
    }
    targets.push(r);
  }

  if (!targets.length) return { ok: true, message: '自動で当てられる依頼はありませんでした', results };

  // ── リポジトリ
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
    .slice(0, 40);

  const branch = `nq/auto-text-${new Date().toISOString().slice(0, 10)}`;
  let branchReady = false;
  const applied: { seq: number; summary: string; jobId?: string }[] = [];
  const client = new Anthropic();

  for (const r of targets) {
    try {
      // 対象ファイルは機械で絞る。モデルに探させない
      const anchors = anchorsFrom(r.outer_html ?? '');
      const scored: { path: string; content: string; hits: number }[] = [];
      for (const path of paths) {
        const f = await readFile(path, base);
        if (!f) continue;
        const hits = anchors.filter((a) => f.content.includes(a)).length;
        if (hits > 0) scored.push({ path, content: f.content, hits });
      }
      scored.sort((a, b) => b.hits - a.hits);
      const cand = scored.slice(0, 2);
      if (!cand.length) {
        results.push({
          requestId: r.id,
          seq: r.seq,
          status: 'skipped',
          detail: '該当箇所をリポジトリで特定できませんでした',
        });
        continue;
      }

      const body =
        `# 依頼 #${r.seq}\n${r.body.trim()}\n\n# 指された要素\n\`\`\`\n${(r.outer_html ?? '').slice(0, 3000)}\n\`\`\`\n\n` +
        cand.map((c) => `# 候補: ${c.path}\n\`\`\`\n${c.content.slice(0, 60000)}\n\`\`\``).join('\n\n');

      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        system: PATCH_SYSTEM,
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: PATCH_SCHEMA as unknown as Record<string, unknown> },
        },
        messages: [{ role: 'user', content: [{ type: 'text', text: body }] }],
      });
      const msg = await stream.finalMessage();
      const t = msg.content.find((b) => b.type === 'text');
      if (!t || t.type !== 'text') throw new Error('空の応答');
      const patch = JSON.parse(t.text) as Patch;

      if (!patch.applicable) {
        results.push({ requestId: r.id, seq: r.seq, status: 'skipped', detail: patch.reason });
        continue;
      }

      const pe = pathError(patch.file);
      if (pe) {
        results.push({ requestId: r.id, seq: r.seq, status: 'skipped', detail: pe });
        continue;
      }
      const se = structureChanged(patch.oldStr, patch.newStr);
      if (se) {
        results.push({ requestId: r.id, seq: r.seq, status: 'skipped', detail: se });
        continue;
      }

      // ブランチはここで初めて作る（当てるものが1件も無ければ作らない）
      if (!branchReady) {
        try {
          await gh.getRef(inst, owner, repo, `heads/${branch}`);
        } catch {
          const b = await gh.getRef(inst, owner, repo, `heads/${base}`);
          await gh.createBranch(inst, owner, repo, branch, b.object.sha);
        }
        branchReady = true;
      }

      // 当てる直前に、ブランチ HEAD の現在の内容で再検証する（9.7）
      const cur = await readFile(patch.file, branch);
      if (!cur) throw new Error(`${patch.file} を読めません`);
      const n = count(cur.content, patch.oldStr);
      if (n !== 1) {
        results.push({
          requestId: r.id,
          seq: r.seq,
          status: 'skipped',
          detail:
            n === 0
              ? '当てる直前の再検証で対象が見つかりませんでした'
              : `対象が ${n} 箇所に当たるため当てられません`,
        });
        continue;
      }

      await gh.putFile(
        inst,
        owner,
        repo,
        patch.file,
        Buffer.from(cur.content.replace(patch.oldStr, patch.newStr), 'utf8'),
        `依頼 #${r.seq}: ${patch.summary}`,
        branch,
        cur.sha,
      );

      const { data: job } = await db
        .from('ai_jobs')
        .insert({
          request_id: r.id,
          dispatch_no: 1,
          patch_kind: 'text',
          provider: 'anthropic',
          status: 'succeeded',
          patch: patch as never,
          summary: patch.summary,
          branch,
          finished_at: new Date().toISOString(),
        } as never)
        .select('id')
        .maybeSingle();

      // 手つかずに見えると社内が二重に作業する。着手済みにしておく
      await db.from('requests').update({ status: 'in_progress' } as never).eq('id', r.id);

      await logEvent({
        projectId,
        actor: SYSTEM_ACTOR,
        entity: 'request',
        entityId: r.id,
        action: 'auto_text.applied',
        after: { file: patch.file, summary: patch.summary, branch },
      });

      applied.push({ seq: r.seq, summary: patch.summary, jobId: job?.id as string | undefined });
      results.push({ requestId: r.id, seq: r.seq, status: 'applied', detail: patch.summary });
    } catch (e) {
      results.push({
        requestId: r.id,
        seq: r.seq,
        status: 'failed',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (!applied.length) {
    return { ok: true, message: '当てられる書き換えはありませんでした', results };
  }

  const pr = await gh.createPull(inst, owner, repo, {
    title: `文言・文字まわりの修正 ${applied.length}件`,
    head: branch,
    base,
    body:
      `クライアントからの修正依頼のうち、文言と文字まわりのものを反映しました。\n\n` +
      applied.map((a) => `- 依頼 #${a.seq}: ${a.summary}`).join('\n') +
      `\n\n---\n自動マージはしません。内容を確認してからマージしてください。\n` +
      `対象は「文言の変更」と「文字の大きさ・太さ・行間・字間・色」に限っています。` +
      `構造を変える書き換えは機械で弾いています。`,
  });

  // どの依頼がどの PR に入ったかを引けるようにする。
  // これが無いと、社内は「自動で直ったのか、まだなのか」を追えない。
  for (const a of applied) {
    if (!a.jobId) continue;
    await db
      .from('ai_jobs')
      .update({ pr_url: pr.html_url, pr_number: pr.number } as never)
      .eq('id', a.jobId);
  }

  await logEvent({
    projectId,
    actor: SYSTEM_ACTOR,
    entity: 'project',
    entityId: projectId,
    action: 'auto_text.pull_request_opened',
    after: { branch, pr: pr.html_url, applied: applied.length, results },
  });

  return { ok: true, message: `${applied.length}件を反映して PR を出しました`, results, prUrl: pr.html_url };
}
