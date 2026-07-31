#!/usr/bin/env node
/**
 * ディスパッチの自動発火（設計 8.2 / 9.2）
 *
 *   node tick.mjs            # 1回だけ見る
 *   node tick.mjs --loop     # 常駐して5分おきに見る
 *   node tick.mjs --dry      # 何が起きるかだけ出す
 *
 * クライアントの操作では発火しない。サーバ側のタイマーが持つ（9.2）。
 * 「押せば直る」と体感されると依頼が増え、無償上限が主張しづらくなる。
 *
 * ラウンドの期限遷移（フリーズ・自動確認）はアプリ側の /api/admin/tick が持つ。
 * こちらは撮影とリポジトリ操作が要るぶん、ワーカー側に置いている。
 */
import { loadEnv, supa } from './supabase.mjs';
import { dispatchAssets, dispatchesToday, findDueRounds } from './dispatch.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const loop = args.includes('--loop');
const intervalMs = Number(args[args.indexOf('--interval') + 1] || 5) * 60_000;

loadEnv();
const db = supa();

async function tick() {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const projects = await db.select('projects', 'asset_swap_enabled=is.true&select=*');
  if (!projects.length) {
    console.log(`[${stamp}] 素材差し替えが有効な案件がありません`);
    return;
  }

  for (const project of projects) {
    const due = await findDueRounds(project, db);
    if (!due.length) {
      console.log(`[${stamp}] ${project.name}: 対象のラウンドなし`);
      continue;
    }

    for (const d of due) {
      if (d.skip) {
        console.log(`[${stamp}] ${project.name} ラウンド${d.round.seq}: ${d.skip}`);
        continue;
      }

      // 安全弁（8.2）
      const today = await dispatchesToday(project, db);
      const cap = project.max_dispatch_per_day ?? 3;
      if (today >= cap) {
        console.log(
          `[${stamp}] ${project.name} ラウンド${d.round.seq}: 本日のディスパッチ上限 ${cap} 回に到達`,
        );
        continue;
      }

      console.log(
        `[${stamp}] ${project.name} ラウンド${d.round.seq}: ${d.pending.length} 件を投入` +
          (dry ? '（--dry）' : ''),
      );
      const res = await dispatchAssets({
        project,
        roundId: d.round.id,
        dry,
        log: (m) => console.log(`   ${m}`),
      });
      if (!res.ok) {
        console.log(`   失敗: ${res.reason}`);
      } else if (res.dry) {
        console.log(`   ${res.plans} 件が対象（適用はしていない）`);
      } else if (res.dispatched === 0) {
        console.log(`   ${res.reason}`);
      } else {
        console.log(
          `   ${res.dispatched} 件処理 / ${res.applied} 件適用` +
            (res.pr ? ` / PR #${res.pr.number}` : ''),
        );
      }
    }
  }
}

await tick();
if (loop) {
  console.log(`\n  ${intervalMs / 60_000} 分おきに見ます。止めるときは Ctrl+C。\n`);
  setInterval(() => {
    tick().catch((e) => console.error('  tick に失敗:', e.message));
  }, intervalMs);
}
