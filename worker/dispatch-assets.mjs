#!/usr/bin/env node
/**
 * 素材差し替えのディスパッチ（設計 9.10 / 系統A / Phase 3a）
 *
 *   node dispatch-assets.mjs --project loop-2026 [--round <id>] [--dry]
 *
 * LLM を一切呼ばない。したがって ZDR の取得を待たずに投入できる（13.3）。
 * ai_jobs には patch_kind='asset' / provider=null / cost_usd=0 で記録する。
 */
import { loadEnv, supa } from './supabase.mjs';
import { createGitHub, privateKeyFromEnv } from './github.mjs';
import { planAssetSwap, countReferences } from './asset-swap.mjs';
import { ensureRoundBranch, applyPatches, ensureRoundPr } from './patch.mjs';

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const dry = args.includes('--dry');

const projectKey = opt('project');
if (!projectKey) {
  console.error('--project <snippet_key> が必要です');
  process.exit(1);
}

loadEnv();
const db = supa();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const [project] = await db.select(
  'projects',
  `snippet_key=eq.${encodeURIComponent(projectKey)}&select=*`,
);
if (!project) {
  console.error(`案件 ${projectKey} が見つかりません`);
  process.exit(1);
}
if (!project.asset_swap_enabled) {
  console.error('この案件は asset_swap_enabled が false です。案件設定で有効にしてください。');
  process.exit(1);
}
if (!project.repo_owner || !project.repo_name) {
  console.error('案件に repo_owner / repo_name が設定されていません。');
  process.exit(1);
}

// 対象ラウンド
let roundId = opt('round');
if (!roundId) {
  const rs = await db.select(
    'rounds',
    `project_id=eq.${project.id}&status=in.(frozen,in_progress)&select=id,seq&order=seq.desc&limit=1`,
  );
  if (!rs.length) {
    console.error('フリーズ済みのラウンドがありません。--round で指定してください。');
    process.exit(1);
  }
  roundId = rs[0].id;
}
const [round] = await db.select('rounds', `id=eq.${roundId}&select=*`);

// 対象依頼: そのラウンドで、素材の添付があり、まだ ai_jobs が作られていないもの（8.2）
const requests = await db.select(
  'requests',
  `round_id=eq.${roundId}&select=id,seq,body,target,locator,page_path&order=seq`,
);
const done = await db.select('ai_jobs', `round_id=eq.${roundId}&select=request_id,patch_kind`);
const alreadyDispatched = new Set(done.filter((j) => j.patch_kind === 'asset').map((j) => j.request_id));

const gh = createGitHub(process.env.GITHUB_APP_ID, privateKeyFromEnv());
const inst = Number(process.env.GITHUB_APP_INSTALLATION_ID);
const O = project.repo_owner;
const R = project.repo_name;
const BASE = project.default_branch || 'main';
const BRANCH = round.branch || `revise/round-${round.seq}`;

console.log(`  案件: ${project.name} → ${O}/${R}`);
console.log(`  ラウンド ${round.seq}（${round.status}）/ ブランチ ${BRANCH}`);
console.log(`  対象候補: ${requests.length} 件\n`);

const dispatchNo = (round.dispatch_count ?? 0) + 1;
const plans = [];

for (const req of requests) {
  if (alreadyDispatched.has(req.id)) continue;

  const atts = await db.select(
    'attachments',
    `request_id=eq.${req.id}&kind=eq.material&select=id,storage_path,filename,mime&order=created_at&limit=1`,
  );
  if (!atts.length) continue;
  const att = atts[0];

  if (!req.target?.srcAttr && !req.target?.srcset) {
    console.log(`  #${req.seq} needs_human — 対象が画像ではありません（target が空）`);
    plans.push({ req, att, error: '対象が画像ではありません' });
    continue;
  }

  const res = await fetch(`${url}/storage/v1/object/nq-attachments/${att.storage_path}`, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
  });
  if (!res.ok) {
    console.log(`  #${req.seq} failed — 添付を読めません`);
    plans.push({ req, att, error: '添付を読めません' });
    continue;
  }
  const attachBuffer = Buffer.from(await res.arrayBuffer());

  const plan = await planAssetSwap({
    gh,
    inst,
    owner: O,
    repo: R,
    ref: BASE,
    target: req.target,
    attachBuffer,
  });

  if (!plan.ok) {
    console.log(`  #${req.seq} needs_human — ${plan.reason}`);
    plans.push({ req, att, error: plan.reason, needsHuman: true });
    continue;
  }
  console.log(
    `  #${req.seq} 差し替え可 — ${plan.kind} / ${plan.patches.length}変種: ` +
      plan.patches.map((p) => p.path).join(', '),
  );
  plans.push({ req, att, plan });
}

if (dry) {
  console.log('\n  --dry のため適用しません');
  process.exit(0);
}

const applicable = plans.filter((p) => p.plan);
if (!applicable.length) {
  // 差し替えられなかったものも ai_jobs に残す。黙って消えないようにする。
  for (const p of plans) {
    await db.insert('ai_jobs', {
      round_id: roundId,
      request_id: p.req.id,
      dispatch_no: dispatchNo,
      patch_kind: 'asset',
      provider: null,
      status: 'needs_human',
      reject_reason: p.error ?? null,
      cost_usd: 0,
      finished_at: new Date().toISOString(),
    });
  }
  console.log('\n  適用できるものがありませんでした');
  process.exit(0);
}

const br = await ensureRoundBranch(gh, inst, O, R, BRANCH, BASE);
console.log(`\n  ブランチ ${BRANCH} ${br.created ? 'を作成' : 'は既存'}`);

const patchList = [];
for (const p of applicable) {
  for (const patch of p.plan.patches) {
    patchList.push({
      id: `${p.req.id}::${patch.path}`,
      kind: 'asset',
      path: patch.path,
      buffer: patch.buffer,
      summary: `素材を差し替え: ${patch.path}（依頼 #${p.req.seq}）`,
    });
  }
}
const results = await applyPatches(gh, inst, O, R, BRANCH, patchList);
for (const r of results) {
  console.log(`   ${r.status === 'applied' ? 'OK ' : 'NG '} ${r.file ?? ''} ${r.reason ?? ''}`);
}

// ai_jobs と events を残す
for (const p of plans) {
  const mine = results.filter((r) => String(r.id).startsWith(p.req.id));
  const ok = mine.length > 0 && mine.every((r) => r.status === 'applied');
  const paths = (p.plan?.patches ?? []).map((x) => x.path);

  await db.insert('ai_jobs', {
    round_id: roundId,
    request_id: p.req.id,
    dispatch_no: dispatchNo,
    patch_kind: 'asset',
    provider: null, // LLM を使わない
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
    // 旧ファイルのハッシュを残す。差し戻し時に復元できるようにするため（9.10 手順5）
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

    // 判別子が変わるのでロケータを更新する（7.4 末尾 / 6.7）
    const loc = { ...(p.req.locator ?? {}) };
    if (loc.srcAttr && paths.length) loc.srcAttr = loc.srcAttr;
    await db.update('requests', `id=eq.${p.req.id}`, { locator: loc, status: 'in_progress' });
  }
}

await db.update('rounds', `id=eq.${roundId}`, {
  branch: BRANCH,
  dispatch_count: dispatchNo,
  last_dispatched_at: new Date().toISOString(),
});

// 同じ画像が複数ページから参照されている場合は PR に明記する（9.10 の注意）
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

const pr = await ensureRoundPr(
  gh,
  inst,
  O,
  R,
  BRANCH,
  BASE,
  `修正ラウンド ${round.seq}`,
  body,
);
console.log(`\n  PR #${pr.number} ${pr.created ? 'を作成' : 'は既存'}: ${pr.url}`);

await db.upsert(
  'pull_requests',
  { round_id: roundId, number: pr.number, branch: BRANCH, preview_url: null, state: 'open' },
  'round_id,number',
);

console.log('\n  自動マージはしません。人間のレビューを経てからマージしてください（9.8）。');
