/**
 * ディスパッチ（設計 8.2 / 9.2 / 9.10）
 *
 * 「溜まった依頼を処理に投入すること」。フリーズとは別事象で、
 * **ラウンドは open のまま**でよく、1ラウンドで複数回起きる。
 *
 * クライアントの操作では発火しない（9.2）。理由はコストではない。
 *   1. 期待値の管理 — 「押せば直る」と体感されると依頼が増え、
 *      無償上限が主張しづらくなる
 *   2. バッチ効率 — 個別処理すると N ブランチ・N PR・N レビューになる
 *   3. 品質の露出 — 出来の悪い差分を見せた時点で信頼が失われる
 */
import { supa } from './supabase.mjs';
import { createGitHub, privateKeyFromEnv } from './github.mjs';
import { planAssetSwap, countReferences } from './asset-swap.mjs';
import { ensureRoundBranch, applyPatches, ensureRoundPr } from './patch.mjs';

/**
 * ディスパッチすべきラウンドを探す（8.2）
 *
 * 条件:
 *   - ラウンドが open / frozen / in_progress
 *   - 最後の依頼から dispatch_debounce_minutes 経過している
 *     （デバウンスはラウンド単位。新規依頼の登録ごとにリセットされる）
 *   - まだ ai_jobs が作られていない minor 依頼がある
 *   - その案件の当日ディスパッチ回数が max_dispatch_per_day 未満
 */
export async function findDueRounds(project, db = supa()) {
  const rounds = await db.select(
    'rounds',
    `project_id=eq.${project.id}&status=in.(open,frozen,in_progress)&select=*&order=seq.desc`,
  );
  const due = [];

  for (const round of rounds) {
    const reqs = await db.select(
      'requests',
      `round_id=eq.${round.id}&select=id,seq,category,subtype,created_at&order=created_at.desc`,
    );
    if (!reqs.length) continue;

    // デバウンス: 最後の依頼からの経過（8.2）
    const lastAt = new Date(reqs[0].created_at).getTime();
    const debounceMs = (project.dispatch_debounce_minutes ?? 30) * 60_000;
    const waited = Date.now() - lastAt;
    if (waited < debounceMs) {
      due.push({
        round,
        skip: `デバウンス中（あと ${Math.ceil((debounceMs - waited) / 60_000)} 分）`,
      });
      continue;
    }

    // 仕様変更・不具合はラウンドから外れるので対象外（8.1）
    const targets = reqs.filter((r) => r.category !== 'spec_change' && r.category !== 'defect');
    const jobs = await db.select('ai_jobs', `round_id=eq.${round.id}&select=request_id`);
    const dispatched = new Set(jobs.map((j) => j.request_id));
    const pending = targets.filter((r) => !dispatched.has(r.id));

    if (!pending.length) {
      due.push({ round, skip: '未ディスパッチの依頼がありません' });
      continue;
    }
    due.push({ round, pending });
  }
  return due;
}

/** 安全弁: 1案件あたり 1日 max_dispatch_per_day 回まで（8.2） */
export async function dispatchesToday(project, db = supa()) {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = await db.select(
    'events',
    `project_id=eq.${project.id}&action=eq.round.dispatched&at=gte.${since}&select=id`,
  );
  return rows.length;
}

/**
 * 素材差し替えのディスパッチ本体（系統A・9.10）
 * LLM を一切呼ばない。ZDR の取得を待たずに投入できる。
 */
export async function dispatchAssets({ project, roundId, dry = false, log = console.log }) {
  const db = supa();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const [round] = await db.select('rounds', `id=eq.${roundId}&select=*`);
  if (!round) return { ok: false, reason: 'ラウンドが見つかりません' };
  if (!project.repo_owner || !project.repo_name) {
    return { ok: false, reason: 'repo_owner / repo_name が未設定です' };
  }

  const requests = await db.select(
    'requests',
    `round_id=eq.${roundId}&select=id,seq,body,target,locator,category&order=seq`,
  );
  const jobs = await db.select('ai_jobs', `round_id=eq.${roundId}&select=request_id,patch_kind`);
  const already = new Set(jobs.filter((j) => j.patch_kind === 'asset').map((j) => j.request_id));

  const gh = createGitHub(process.env.GITHUB_APP_ID, privateKeyFromEnv());
  const inst = Number(process.env.GITHUB_APP_INSTALLATION_ID);
  const O = project.repo_owner;
  const R = project.repo_name;
  const BASE = project.default_branch || 'main';
  const BRANCH = round.branch || `revise/round-${round.seq}`;
  const dispatchNo = (round.dispatch_count ?? 0) + 1;

  const plans = [];
  for (const req of requests) {
    if (already.has(req.id)) continue;
    if (req.category === 'spec_change' || req.category === 'defect') continue;

    const atts = await db.select(
      'attachments',
      `request_id=eq.${req.id}&kind=eq.material&select=id,storage_path,filename&order=created_at&limit=1`,
    );
    if (!atts.length) continue; // 素材の添付が無いものは系統A の対象外

    if (!req.target?.srcAttr && !req.target?.srcset) {
      plans.push({ req, error: '対象が画像ではありません（target が空）', needsHuman: true });
      continue;
    }

    const res = await fetch(`${url}/storage/v1/object/nq-attachments/${atts[0].storage_path}`, {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
    });
    if (!res.ok) {
      plans.push({ req, error: '添付を読めません' });
      continue;
    }

    const plan = await planAssetSwap({
      gh,
      inst,
      owner: O,
      repo: R,
      ref: BASE,
      target: req.target,
      attachBuffer: Buffer.from(await res.arrayBuffer()),
    });
    if (!plan.ok) {
      plans.push({ req, error: plan.reason, needsHuman: true });
      log(`   #${req.seq} needs_human — ${plan.reason}`);
      continue;
    }
    plans.push({ req, plan });
    log(`   #${req.seq} 差し替え可 — ${plan.kind} / ${plan.patches.map((p) => p.path).join(', ')}`);
  }

  if (!plans.length) return { ok: true, dispatched: 0, reason: '対象がありません' };
  if (dry) return { ok: true, dry: true, plans: plans.length };

  const applicable = plans.filter((p) => p.plan);
  let results = [];
  if (applicable.length) {
    await ensureRoundBranch(gh, inst, O, R, BRANCH, BASE);
    const patchList = applicable.flatMap((p) =>
      p.plan.patches.map((patch) => ({
        id: `${p.req.id}::${patch.path}`,
        kind: 'asset',
        path: patch.path,
        buffer: patch.buffer,
        summary: `素材を差し替え: ${patch.path}（依頼 #${p.req.seq}）`,
      })),
    );
    results = await applyPatches(gh, inst, O, R, BRANCH, patchList);
  }

  // ai_jobs と events。落ちたものも必ず残す（黙って消えないように）
  for (const p of plans) {
    const mine = results.filter((r) => String(r.id).startsWith(p.req.id));
    const ok = mine.length > 0 && mine.every((r) => r.status === 'applied');
    const paths = (p.plan?.patches ?? []).map((x) => x.path);

    await db.insert('ai_jobs', {
      round_id: roundId,
      request_id: p.req.id,
      dispatch_no: dispatchNo,
      patch_kind: 'asset',
      provider: null,
      status: p.plan ? (ok ? 'succeeded' : 'failed') : 'needs_human',
      patch: p.plan
        ? {
            paths,
            from_hash: p.plan.patches.map((x) => x.fromHash),
            to_hash: p.plan.patches.map((x) => x.toHash),
            summary: `素材を差し替え（${paths.length}変種）`,
          }
        : null,
      applied_sha: mine.find((r) => r.sha)?.sha ?? null,
      reject_reason: p.error ?? mine.find((r) => r.reason)?.reason ?? null,
      cost_usd: 0,
      finished_at: new Date().toISOString(),
    });

    if (p.plan && ok) {
      await db.insert('events', {
        project_id: project.id,
        actor_type: 'system',
        actor_id: 'asset-swap',
        entity: 'request',
        entity_id: p.req.id,
        action: 'asset.swapped',
        before: { paths, hashes: p.plan.patches.map((x) => x.fromHash) },
        after: { paths, hashes: p.plan.patches.map((x) => x.toHash), branch: BRANCH },
      });
      await db.update('requests', `id=eq.${p.req.id}`, { status: 'in_progress' });
    }
  }

  await db.update('rounds', `id=eq.${roundId}`, {
    branch: BRANCH,
    dispatch_count: dispatchNo,
    last_dispatched_at: new Date().toISOString(),
  });

  await db.insert('events', {
    project_id: project.id,
    actor_type: 'system',
    actor_id: 'dispatcher',
    entity: 'round',
    entity_id: roundId,
    action: 'round.dispatched',
    after: { dispatch_no: dispatchNo, kind: 'asset', count: plans.length },
  });

  let pr = null;
  if (applicable.length) {
    const notes = [];
    for (const p of applicable) {
      for (const patch of p.plan.patches) {
        const n = await countReferences(gh, inst, O, R, BASE, patch.path);
        if (n && n > 1) {
          notes.push(`- \`${patch.path}\` は **${n} 箇所から参照** されています。他ページにも影響します`);
        } else if (n === null) {
          notes.push(`- \`${patch.path}\` の参照箇所は確認できませんでした（要目視）`);
        }
      }
    }
    const body = [
      `ラウンド ${round.seq} の素材差し替え（設計 9.10）。**LLM は使っていません。**`,
      '',
      ...applicable.map(
        (p) =>
          `### 依頼 #${p.req.seq}\n> ${p.req.body}\n\n` +
          p.plan.patches
            .map(
              (x) =>
                `- \`${x.path}\` ${x.from.w}×${x.from.h} (${(x.from.bytes / 1024).toFixed(0)}KB) → ` +
                `${x.to.w}×${x.to.h} (${(x.to.bytes / 1024).toFixed(0)}KB, q${x.to.quality})`,
            )
            .join('\n'),
      ),
      ...(notes.length ? ['', '### 注意', ...notes] : []),
      '',
      '自動マージはしません（9.8）。人間のレビューを経てからマージしてください。',
    ].join('\n');

    pr = await ensureRoundPr(gh, inst, O, R, BRANCH, BASE, `修正ラウンド ${round.seq}`, body);
    await db.upsert(
      'pull_requests',
      { round_id: roundId, number: pr.number, branch: BRANCH, state: 'open' },
      'round_id,number',
    );
  }

  return { ok: true, dispatched: plans.length, applied: results.filter((r) => r.status === 'applied').length, pr };
}
