/**
 * ブランチへの直列適用（設計 9.7）
 *
 * パッチは常に「生成時点のファイル」を基準に作られる。同一ファイルに
 * 複数当てると2件目以降の old_str がズレ、バッチをまたぐと差はさらに開く。
 * そのため **適用の直前に、ブランチ HEAD の現在の内容で old_str が
 * ちょうど1回出現することを再検証する**。ここを省くと静かに壊れる。
 */
import { gateAssetPatch, gateTextPatch } from './gates.mjs';

/** ラウンドのブランチ（9.7: ラウンドで1本、全バッチ・両系統がここに累積する） */
export async function ensureRoundBranch(gh, inst, owner, repo, branch, baseBranch = 'main') {
  try {
    const ref = await gh.getRef(inst, owner, repo, `heads/${branch}`);
    return { created: false, sha: ref.object.sha };
  } catch {
    const base = await gh.getRef(inst, owner, repo, `heads/${baseBranch}`);
    await gh.createBranch(inst, owner, repo, branch, base.object.sha);
    return { created: true, sha: base.object.sha };
  }
}

function countOccurrences(haystack, needle) {
  let n = 0;
  let i = 0;
  for (;;) {
    const at = haystack.indexOf(needle, i);
    if (at < 0) break;
    n++;
    i = at + needle.length;
  }
  return n;
}

/**
 * @param patches [{ id, kind:'text', file, oldStr, newStr, summary }]
 *              | [{ id, kind:'asset', path, buffer, summary }]
 * @returns 各パッチの結果。1件の失敗で全体を止めない（9.7 手順6）
 */
export async function applyPatches(gh, inst, owner, repo, branch, patches) {
  const results = [];

  // ファイル別にまとめ、各グループ内で1件ずつ順に当てる（9.7 手順1〜2）
  const byFile = new Map();
  for (const p of patches) {
    const key = p.kind === 'asset' ? p.path : p.file;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(p);
  }

  for (const [file, group] of byFile) {
    for (const p of group) {
      const gate = p.kind === 'asset' ? gateAssetPatch(p) : gateTextPatch(p);
      if (!gate.ok) {
        results.push({ id: p.id, status: 'rejected', reason: gate.reason });
        continue;
      }

      try {
        if (p.kind === 'asset') {
          // バイナリの上書き。old_str の再検証は要らない。
          // 同一ラウンド内で同じパスに2件来たら後勝ち＋警告（9.7 末尾）
          const already = results.find((r) => r.file === file && r.status === 'applied');
          let sha;
          try {
            const cur = await gh.getFile(inst, owner, repo, file, branch);
            sha = cur.sha;
          } catch {
            sha = undefined; // 新規
          }
          const res = await gh.putFile(
            inst,
            owner,
            repo,
            file,
            p.buffer,
            p.summary ?? `素材を差し替え: ${file}`,
            branch,
            sha,
          );
          results.push({
            id: p.id,
            file,
            status: 'applied',
            sha: res.commit.sha,
            warning: already ? '同じパスに2件目の差し替えが来たため後勝ちにしました' : undefined,
          });
          continue;
        }

        // --- テキストパッチ ---
        const cur = await gh.getFile(inst, owner, repo, file, branch);
        const content = Buffer.from(cur.content, 'base64').toString('utf8');

        // 9.7 手順3: ブランチ HEAD の現在の内容で再検証する。バッチ間でも必ず。
        const n = countOccurrences(content, p.oldStr);
        if (n !== 1) {
          results.push({
            id: p.id,
            file,
            status: 'rejected',
            reason:
              n === 0
                ? 'old_str がブランチ HEAD に見つかりません（先に当てたパッチでズレた可能性）'
                : `old_str が ${n} 箇所に一致しました（一意になる文字列が必要）`,
            needsRegeneration: true,
          });
          continue;
        }

        const next = content.replace(p.oldStr, p.newStr);
        const res = await gh.putFile(
          inst,
          owner,
          repo,
          file,
          Buffer.from(next, 'utf8'),
          p.summary ?? `修正: ${file}`,
          branch,
          cur.sha,
        );
        results.push({ id: p.id, file, status: 'applied', sha: res.commit.sha });
      } catch (e) {
        // 1件の失敗で全体を止めない（9.7 手順6）
        results.push({ id: p.id, file, status: 'failed', reason: String(e.message).slice(0, 300) });
      }
    }
  }

  return results;
}

/** ラウンドの PR（9.7: ラウンドにつき1つ） */
export async function ensureRoundPr(gh, inst, owner, repo, branch, baseBranch, title, body) {
  const token = await gh.installationToken(inst);
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'nortiq-revise',
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const existing = await res.json();
  if (Array.isArray(existing) && existing.length) {
    return { created: false, number: existing[0].number, url: existing[0].html_url };
  }
  const pr = await gh.createPull(inst, owner, repo, { title, head: branch, base: baseBranch, body });
  return { created: true, number: pr.number, url: pr.html_url };
}
