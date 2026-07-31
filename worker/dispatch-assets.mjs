#!/usr/bin/env node
/**
 * 素材差し替えの手動ディスパッチ（設計 9.10 / 系統A）
 *
 *   node dispatch-assets.mjs --project loop-2026 [--round <id>] [--dry]
 *
 * 自動発火は tick.mjs が持つ（8.2）。こちらは社内が手で回すとき用。
 */
import { loadEnv, supa } from './supabase.mjs';
import { dispatchAssets } from './dispatch.mjs';

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

const [project] = await db.select(
  'projects',
  `snippet_key=eq.${encodeURIComponent(projectKey)}&select=*`,
);
if (!project) {
  console.error(`案件 ${projectKey} が見つかりません`);
  process.exit(1);
}
if (!project.asset_swap_enabled) {
  console.error('この案件は asset_swap_enabled が false です（案件設定で有効にしてください）');
  process.exit(1);
}

let roundId = opt('round');
if (!roundId) {
  const rs = await db.select(
    'rounds',
    `project_id=eq.${project.id}&status=in.(open,frozen,in_progress)&select=id,seq&order=seq.desc&limit=1`,
  );
  if (!rs.length) {
    console.error('進行中のラウンドがありません。--round で指定してください。');
    process.exit(1);
  }
  roundId = rs[0].id;
}

console.log(`  案件: ${project.name} → ${project.repo_owner}/${project.repo_name}`);
const res = await dispatchAssets({ project, roundId, dry, log: console.log });

if (!res.ok) {
  console.error(`\n  失敗: ${res.reason}`);
  process.exit(1);
}
if (res.dry) {
  console.log(`\n  --dry: ${res.plans} 件が対象（適用していません）`);
} else if (res.dispatched === 0) {
  console.log(`\n  ${res.reason}`);
} else {
  console.log(`\n  ${res.dispatched} 件処理 / ${res.applied} 件適用`);
  if (res.pr) console.log(`  PR #${res.pr.number}: ${res.pr.url}`);
  console.log('\n  自動マージはしません。人間のレビューを経てからマージしてください（9.8）。');
}
