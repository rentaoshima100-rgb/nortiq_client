/**
 * 写真の入れ替え → PR（設計 9.10 / 13.3）
 *
 * クライアントが「この写真を差し替えて」と言って画像を添えたとき、
 * リポジトリの元ファイルを置き換える PR を出す。
 *
 * **LLM を呼ばない。** 差し替え先は `locator.srcAttr`（依頼時に押された
 * `img` の src 属性）で決まっていて、推測の余地が無い。決定的処理なので
 * ZDR の取得を待たずに使える（13.3）。
 *
 * **自動マージはしない。例外なく PR で出す（9.8）。**
 *
 * 判別子に `src` 属性を使うのは 6.7 の約束。`currentSrc` はビューポートで
 * 変わるので、PC で出した依頼をスマホで見ると別の画像を指す。
 */
import { ATTACHMENTS_BUCKET } from '@/lib/env';
import { logEvent, type Actor } from '@/lib/events';
import { github, githubConfigured, installationFor } from '@/lib/github-client';
import { IMAGE_EXT, resolveRepoPath } from '@/lib/asset-path';
import type { GhTreeEntry } from '@/lib/github.d.mts';
import type { T } from '@/lib/i18n-core';
import { adminDb } from '@/lib/supabase/admin';
import type { AttachmentRow, Locator } from '@/lib/types';

export interface SwapPlan {
  requestId: string;
  seq: number;
  /** 依頼時に押された img の src 属性そのまま */
  srcAttr: string | null;
  /** 置き換えるリポジトリ上のパス。決まらなければ null */
  file: string | null;
  /** どの手で当てたか。social な判断が要るのは basename のとき */
  how: string;
  /** 候補が複数あって決められなかったときの一覧 */
  candidates: string[];
  attachment: { id: string; filename: string; mime: string; bytes: number } | null;
  /** 進められない理由。null なら出せる */
  problem: string | null;
}

async function repoFiles(
  gh: ReturnType<typeof github>,
  inst: number,
  owner: string,
  repo: string,
  ref: string,
): Promise<string[]> {
  const { entries } = await gh.getTree(inst, owner, repo, ref);
  return (entries as GhTreeEntry[]).filter((e) => e.type === 'blob').map((e) => e.path);
}

/**
 * 差し替えの下見。**リポジトリは変えない。**
 * 社内が「どのファイルが置き換わるか」を見てから出せるようにする。
 */
export async function planAssetSwap(
  requestId: string,
  t: T = (s) => s,
): Promise<{ ok: boolean; message: string; plan: SwapPlan | null }> {
  const db = adminDb();

  const { data: req } = await db
    .from('requests')
    .select('id, seq, project_id, locator, subtype')
    .eq('id', requestId)
    .maybeSingle();
  if (!req) return { ok: false, message: t('依頼が見つかりません'), plan: null };

  const { data: proj } = await db
    .from('projects')
    .select('repo_owner, repo_name, default_branch, gh_installation_id, asset_swap_enabled')
    .eq('id', req.project_id)
    .maybeSingle();
  if (!proj?.repo_owner || !proj.repo_name) {
    return { ok: false, message: t('リポジトリが設定されていません'), plan: null };
  }
  if (!githubConfigured()) {
    return { ok: false, message: t('GitHub App の認証情報が設定されていません'), plan: null };
  }

  // 素材として出されたものだけ。参考イメージは仕様変更の話で、差し替えではない（6.9）
  const { data: atts } = await db
    .from('attachments')
    .select('id, filename, mime, bytes, storage_path, kind, created_at')
    .eq('request_id', requestId)
    .eq('kind', 'material')
    .order('created_at', { ascending: false })
    .limit(1);
  const att = (atts ?? [])[0] as AttachmentRow | undefined;

  const loc = (req.locator ?? {}) as Locator;
  const srcAttr = loc.srcAttr ?? null;

  const gh = github();
  const inst = await installationFor(gh, proj.repo_owner);
  if (inst == null) return { ok: false, message: t('GitHub App が入っていません'), plan: null };

  const base = proj.default_branch || 'main';
  const paths = await repoFiles(gh, inst, proj.repo_owner, proj.repo_name, base);
  const { file, candidates, how } = resolveRepoPath(srcAttr, paths);

  let problem: string | null = null;
  if (!att) {
    problem = t('差し替える画像が添付されていません。クライアントに「素材」として送ってもらってください。');
  } else if (!srcAttr) {
    problem = t('この依頼は画像を指していません（押された要素に src がありません）。');
  } else if (!file && candidates.length > 1) {
    problem = t('元ファイルの候補が {n} 件あって決められません: {list}', {
      n: candidates.length,
      list: candidates.join(' , '),
    });
  } else if (!file) {
    problem = t('元ファイルがリポジトリに見つかりません（{src}）。ビルドで生成されている可能性があります。', {
      src: srcAttr,
    });
  } else if (!IMAGE_EXT.test(att.filename)) {
    problem = t('画像ファイルだけ差し替えられます');
  }

  return {
    ok: !problem,
    message: problem ?? t('{file} を差し替えます', { file: file! }),
    plan: {
      requestId,
      seq: req.seq,
      srcAttr,
      file,
      how,
      candidates,
      attachment: att
        ? { id: att.id, filename: att.filename, mime: att.mime, bytes: att.bytes }
        : null,
      problem,
    },
  };
}

/**
 * 実際に差し替えて PR を出す。
 *
 * `file` を渡すと候補が複数でもそれに決められる（社内が選んだとき）。
 * 元ファイルの**拡張子は変えない**。参照側の HTML/CSS を直さずに済む。
 */
export async function applyAssetSwap(
  requestId: string,
  actor: Actor,
  opts: { file?: string; t?: T } = {},
): Promise<{ ok: boolean; message: string; prUrl?: string; file?: string }> {
  const t = opts.t ?? ((s: string) => s);
  const db = adminDb();

  const pre = await planAssetSwap(requestId, t);
  const plan = pre.plan;
  if (!plan) return { ok: false, message: pre.message };

  const file = opts.file ?? plan.file;
  if (!file) return { ok: false, message: plan.problem ?? pre.message };
  if (opts.file && !plan.candidates.includes(opts.file)) {
    return { ok: false, message: t('その候補は元ファイルの一覧にありません') };
  }
  if (!plan.attachment) {
    return {
      ok: false,
      message: t('差し替える画像が添付されていません。クライアントに「素材」として送ってもらってください。'),
    };
  }

  const { data: req } = await db
    .from('requests')
    .select('id, seq, body, project_id')
    .eq('id', requestId)
    .maybeSingle();
  const { data: proj } = await db
    .from('projects')
    .select('repo_owner, repo_name, default_branch, gh_installation_id')
    .eq('id', req!.project_id)
    .maybeSingle();

  const { data: att } = await db
    .from('attachments')
    .select('storage_path, filename, mime, bytes')
    .eq('id', plan.attachment.id)
    .maybeSingle();
  if (!att) return { ok: false, message: t('添付が見つかりません') };

  // 添付の実体を落とす。ここで初めてバイト列を触る
  const dl = await db.storage.from(ATTACHMENTS_BUCKET).download(att.storage_path);
  if (dl.error || !dl.data) {
    return { ok: false, message: t('添付を読み出せませんでした') };
  }
  const bytes = Buffer.from(await dl.data.arrayBuffer());

  const owner = proj!.repo_owner!;
  const repo = proj!.repo_name!;
  const base = proj!.default_branch || 'main';
  const gh = github();
  const inst = await installationFor(gh, owner);
  if (inst == null) return { ok: false, message: t('GitHub App が入っていません') };

  const branch = `nq/asset-${req!.seq}`;
  try {
    let headSha: string;
    try {
      headSha = (await gh.getRef(inst, owner, repo, `heads/${branch}`)).object.sha;
    } catch {
      const b = await gh.getRef(inst, owner, repo, `heads/${base}`);
      await gh.createBranch(inst, owner, repo, branch, b.object.sha);
      headSha = b.object.sha;
    }

    // 上書きには元の blob sha が要る。ブランチ HEAD の現物を見る（9.7 と同じ考え）
    const cur = await gh.getFile(inst, owner, repo, file, branch);
    const sha = Array.isArray(cur) ? undefined : cur.sha;
    if (!sha) return { ok: false, message: t('{file} を読めません', { file }) };

    await gh.putFile(
      inst,
      owner,
      repo,
      file,
      bytes,
      `依頼 #${req!.seq} の画像を差し替え`,
      branch,
      sha,
    );

    const kb = Math.round(att.bytes / 1024);
    const pr = await gh.createPull(inst, owner, repo, {
      title: `依頼 #${req!.seq}: 画像の差し替え`,
      head: branch,
      base,
      body:
        `修正依頼 #${req!.seq} で送られた画像に差し替えました。\n\n` +
        `> ${(req!.body ?? '').trim()}\n\n` +
        `## 変更点\n` +
        `- \`${file}\` を差し替え（${att.filename} / ${att.mime} / ${kb} KB）\n` +
        `- 参照元の src: \`${plan.srcAttr}\`\n\n` +
        `## 確認してください\n` +
        (plan.how === 'basename'
          ? `- **差し替え先はファイル名だけで当てています。** 別の場所の同名画像かもしれません\n`
          : '') +
        `- 縦横比が元と違う場合、レイアウトが崩れることがあります\n` +
        `- 同じファイルを他のページでも使っている場合、そちらも変わります\n` +
        `- 拡張子は変えていません。中身の形式が違う場合はご指摘ください\n\n` +
        `---\n自動マージはしません。内容を確認してからマージしてください。\n` +
        `_${headSha.slice(0, 7)} から作成 / 操作: ${actor.type}_`,
    });

    await logEvent({
      projectId: req!.project_id,
      actor,
      entity: 'request',
      entityId: requestId,
      action: 'asset_swap.pr_opened',
      after: { file, attachment: plan.attachment.id, prUrl: pr.html_url, branch },
    });

    return { ok: true, message: t('PR を出しました'), prUrl: pr.html_url, file };
  } catch (e) {
    return {
      ok: false,
      message: t('PR を作れませんでした: {why}', {
        why: e instanceof Error ? e.message : String(e),
      }),
    };
  }
}
