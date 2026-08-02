/**
 * サイト側の導入状況を見て、エンジニアに渡す指示を作る
 *
 * 汎用の手順書は docs/サイト側の導入手順.md にある。こちらは
 * **その案件の実際の値が入った、済んでいる作業を抜いた指示**を出す。
 * 「何をすればいいか」を人間が読み替える手間をなくすのが目的。
 */

export interface SiteCheck {
  reachable: boolean;
  /** w.js の script タグがあるか */
  hasSnippet: boolean;
  /** その script の data-project がこの案件のものか */
  snippetKey: string | null;
  /** data-nq-id が注入されているか */
  nqIdCount: number;
  /** nq-sha meta の値。'dev' やプレースホルダのままなら未完了 */
  siteSha: string | null;
  /** 判定に使った HTML の長さ。0 なら取れていない */
  htmlBytes: number;
}

export async function checkSite(siteUrl: string | null): Promise<SiteCheck> {
  const empty: SiteCheck = {
    reachable: false,
    hasSnippet: false,
    snippetKey: null,
    nqIdCount: 0,
    siteSha: null,
    htmlBytes: 0,
  };
  if (!siteUrl) return empty;

  let html: string;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(siteUrl, {
      signal: ac.signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'nortiq-revise/1.0 (+onboarding-check)' },
    });
    clearTimeout(timer);
    if (!res.ok) return empty;
    html = await res.text();
  } catch {
    return empty;
  }

  const snippetTag = html.match(/<script\b[^>]*\/w\.js[^>]*>/i)?.[0] ?? null;
  const sha = html.match(/<meta\s+name=["']nq-sha["']\s+content=["']([^"']*)["']/i)?.[1] ?? null;

  return {
    reachable: true,
    hasSnippet: !!snippetTag,
    snippetKey: snippetTag?.match(/data-project=["']([^"']+)["']/i)?.[1] ?? null,
    nqIdCount: [...html.matchAll(/data-nq-id=/g)].length,
    siteSha: sha && sha !== 'dev' && !/^\{\{|^\$\{/.test(sha) ? sha : null,
    htmlBytes: html.length,
  };
}

export interface OnboardingInput {
  projectName: string;
  clientName: string | null;
  siteUrl: string | null;
  snippetKey: string;
  appUrl: string;
  repoOwner: string | null;
  repoName: string | null;
  assetSwapEnabled: boolean;
}

export interface Step {
  key: 'snippet' | 'nqid' | 'sha' | 'repo';
  title: string;
  done: boolean;
  /** 済んでいないときに、なぜ要るかを社内が説明できる一言 */
  why: string;
  note?: string;
}

export function steps(p: OnboardingInput, c: SiteCheck): Step[] {
  const keyMatches = c.snippetKey === p.snippetKey;
  return [
    {
      key: 'snippet',
      title: 'スニペットを置く',
      done: c.hasSnippet && keyMatches,
      why: 'これが無いとクライアントは依頼を出せません。ここだけで運用は始められます。',
      note:
        c.hasSnippet && !keyMatches
          ? `スニペットはありますが data-project が "${c.snippetKey ?? '不明'}" になっています。この案件は "${p.snippetKey}" です。`
          : undefined,
    },
    {
      key: 'nqid',
      title: 'data-nq-id を注入する',
      done: c.nqIdCount > 0,
      why: 'ページを直したときに、依頼のピンが正しい要素に付き続けます。実測で的中率が 0% → 74% に上がりました。',
      note: c.nqIdCount > 0 ? `${c.nqIdCount} 箇所に入っています。` : undefined,
    },
    {
      key: 'sha',
      title: 'ビルド SHA を埋める',
      done: !!c.siteSha,
      why: '「どのビルドに対する依頼か」が確定します。撮影と差分の判定に要ります。',
      note: c.siteSha ? `現在: ${c.siteSha.slice(0, 12)}` : undefined,
    },
    {
      key: 'repo',
      title: 'GitHub App を入れる',
      done: !!(p.repoOwner && p.repoName),
      why: '画像の差し替えを PR で出せます。使わないなら不要です。',
      note:
        p.repoOwner && p.repoName
          ? `${p.repoOwner}/${p.repoName}${p.assetSwapEnabled ? '（差し替え有効）' : '（差し替えは無効のまま）'}`
          : undefined,
    },
  ];
}

/**
 * エンジニアにそのまま渡せる指示文を作る。
 * AI コーディングエージェントに貼っても動くように書く。
 */
export function buildPrompt(p: OnboardingInput, c: SiteCheck): string {
  const todo = steps(p, c).filter((s) => !s.done);
  const done = steps(p, c).filter((s) => s.done);
  const snippet = `<script src="${p.appUrl}/w.js" data-project="${p.snippetKey}" defer></script>`;
  const L: string[] = [];

  L.push(`# ${p.clientName ?? p.projectName} のサイトを修正依頼ツールに繋ぐ`);
  L.push('');
  L.push(
    'このリポジトリのサイトを、納品後の修正依頼ツール（Nortiq Revise）に対応させてください。' +
      'クライアントが本番サイト上で直接クリックして修正依頼を出せるようになります。',
  );
  L.push('');
  L.push(`- 対象サイト: ${p.siteUrl ?? '（未設定）'}`);
  L.push(`- 案件キー: \`${p.snippetKey}\``);
  if (p.repoOwner && p.repoName) L.push(`- リポジトリ: \`${p.repoOwner}/${p.repoName}\``);
  L.push('');

  if (done.length) {
    L.push('## すでに済んでいること（触らないでください）');
    L.push('');
    for (const s of done) L.push(`- ${s.title}${s.note ? ` — ${s.note}` : ''}`);
    L.push('');
  }

  if (!todo.length) {
    L.push('## やること');
    L.push('');
    L.push('**ありません。** 4段階すべて済んでいます。');
    return L.join('\n');
  }

  L.push('## やること');
  L.push('');
  L.push(
    '下の作業は独立しています。**上から順に効果が増えます。1つ目だけでも運用は始められる**ので、' +
      '手が回らなければそこで止めて構いません。止めた場合はどこまでやったかを共有してください。',
  );
  L.push('');

  let n = 0;

  if (todo.some((s) => s.key === 'snippet')) {
    n++;
    L.push(`### ${n}. スニペットを置く（必須・5分）`);
    L.push('');
    L.push('`</body>` の直前に次の1行を追加してください。');
    L.push('');
    L.push('```html');
    L.push(snippet);
    L.push('```');
    L.push('');
    L.push(
      '**本番に常設して構いません。** 招待トークンを持たない訪問者には一切描画しません（DOM も作りません）。' +
        '一般の訪問者にとっては JS が1本読まれるだけです。',
    );
    L.push('');
    L.push('CSP を設定している場合は次を許可してください。');
    L.push('');
    L.push('```');
    L.push(`script-src  ${p.appUrl}`);
    L.push(`connect-src ${p.appUrl}`);
    L.push('img-src     data: blob:');
    L.push('style-src   \'unsafe-inline\'   （ウィジェットは shadow root 内に <style> を挿します）');
    L.push('```');
    L.push('');
  }

  if (todo.some((s) => s.key === 'nqid')) {
    n++;
    L.push(`### ${n}. data-nq-id を注入する（30分）`);
    L.push('');
    L.push(
      '**なぜ必要か:** 依頼のピンは「ページのどの要素か」を覚えています。これが無いと CSS セレクタと' +
        '文字列で探すことになり、ページを直すと簡単にずれます。要素を1つ挿しただけで ' +
        '`div:nth-child(3)` は別物を指します。`data-nq-id` はソース上の位置から作った ID なので、' +
        '見た目や並びを直しても変わりません。**実測で的中率が 0% → 74% に上がりました。**',
    );
    L.push('');
    L.push('社内から `tools/nq-inject/` 一式を受け取り、リポジトリ直下に置いてください。');
    L.push('');
    L.push('```json');
    L.push('{');
    L.push('  "scripts": {');
    L.push('    "prebuild": "node tools/nq-inject/cli.mjs --root . --out .nq",');
    L.push('    "build": "＜既存のビルドコマンド＞"');
    L.push('  },');
    L.push('  "devDependencies": { "@babel/parser": "^7.26.0" }');
    L.push('}');
    L.push('```');
    L.push('');
    L.push('`.gitignore` に `.nq/` を足してください。**対応表はコミットしないでください**（毎ビルドで差分ノイズが出ます）。');
    L.push('');
    L.push('```sh');
    L.push('node tools/nq-inject/cli.mjs --root . --dry     # 何件付くか確認するだけ');
    L.push('node tools/nq-inject/cli.mjs --root . --out .nq # 実際に書き換える');
    L.push('```');
    L.push('');
    L.push(
      '**Babel プラグインでやろうとしないでください。** Next.js 15 で実測済みで、両方とも塞がっています。' +
        '`babel.config.js` を置くと `"next/font" requires SWC although Babel is being used` でビルドが落ち、' +
        'Turbopack は `Babel is not yet supported` で拒否します。ビルド前にソースを書き換えるこの方式なら、' +
        'フレームワークが動く前に終わっているので普通のソースにしか見えません。',
    );
    L.push('');
    L.push(
      '**同じ ID が複数の要素に付くのは仕様です。** ループで描画している要素には同じ ID が付きます。' +
        'ツール側は「ID で絞る → テキストか画像の src で1つに決める」順で見ているので、重複自体は問題ありません。',
    );
    L.push('');
    L.push('ビルドの無いサイト（手書き HTML）の場合は、デプロイのワークフローに1ステップとして足してください。');
    L.push('');
  }

  if (todo.some((s) => s.key === 'sha')) {
    n++;
    L.push(`### ${n}. ビルド SHA を埋める（15分）`);
    L.push('');
    L.push(
      '**なぜ必要か:** 依頼が「どのビルドに対して出されたか」が分からないと、直したあとに撮り比べても' +
        '**直した結果なのか、その間に別の更新が入ったのか**が区別できません。',
    );
    L.push('');
    L.push('`<head>` に次の meta を置き、ビルド時に実際の commit SHA を埋めてください。');
    L.push('');
    L.push('```html');
    L.push('<meta name="nq-sha" content="＜commit sha＞">');
    L.push('```');
    L.push('');
    L.push('Vercel なら環境変数が来ているので、ビルド前のスクリプトで差し込むだけです。');
    L.push('');
    L.push('```js');
    L.push('// nq-sha.mjs — build の前に走らせる');
    L.push("import fs from 'node:fs';");
    L.push("const sha = process.env.VERCEL_GIT_COMMIT_SHA || 'dev';");
    L.push("const p = 'index.html';");
    L.push("fs.writeFileSync(p, fs.readFileSync(p, 'utf8')");
    L.push('  .replace(/<meta name="nq-sha"[^>]*>/, `<meta name="nq-sha" content="${sha}">`));');
    L.push('```');
    L.push('');
    L.push(
      '**Vercel の落とし穴:** Build Command を設定すると、Output Directory を明示しないと ' +
        '`No Output Directory named "public" found` でビルドが落ちます。ルートをそのまま配信している' +
        '静的サイトなら Output Directory に `.` を明示してください（Override ON）。',
    );
    L.push('');
  }

  if (todo.some((s) => s.key === 'repo')) {
    n++;
    L.push(`### ${n}. GitHub App を入れる（15分・画像差し替えを使う場合だけ）`);
    L.push('');
    L.push(
      'クライアントが画像にピンを打って差し替え用の画像を添付すると、ブランチを切って差し替え、PR を作ります。' +
        '**自動マージはしません。例外なくです。** PR が作られるだけで、本番に出るには人間がマージする必要があります。',
    );
    L.push('');
    L.push('社内が用意した GitHub App を対象リポジトリにインストールしてください。必要な権限は2つだけです。');
    L.push('');
    L.push('| 権限 | レベル | 用途 |');
    L.push('|---|---|---|');
    L.push('| Contents | Read and write | ブランチ作成・コミット |');
    L.push('| Pull requests | Read and write | PR 作成 |');
    L.push('');
    L.push('インストール後、**リポジトリのオーナー名とリポジトリ名を社内に伝えてください。**');
    L.push('');
    L.push('書き込めるのは次のパスだけで、それ以外は拒否されます。');
    L.push('');
    L.push('```');
    L.push('許可: src/  app/  components/  styles/  assets/  public/  index.html');
    L.push('禁止: package.json  各種ロックファイル  .github/  .env*  *.config.*  tsconfig*.json');
    L.push('```');
    L.push('');
  }

  L.push('## 崩してはいけないこと');
  L.push('');
  L.push(
    '1. **`<img>` の `src` 属性を消さないでください。** `srcset` だけにして `src` を落とすと画像の同定ができなくなります。' +
      'ツール側は `currentSrc` ではなく `src` 属性を見ています（`currentSrc` はビューポートで変わるため、' +
      'PC で出した依頼をスマホで見ると別の画像を指してしまいます）。',
  );
  L.push(
    `2. **オリジンを変えたら社内に伝えてください。** 独自ドメインを当てた、\`www\` の有無を変えた、` +
      `ステージングを増やした。いずれも CORS の許可判定に直接効きます。現在の登録は \`${p.siteUrl ?? '未設定'}\` です。` +
      '伝えないと依頼が送れなくなります。',
  );
  L.push(
    '3. **Cookie を前提にしないでください。** ツールとの通信はクロスサイトで Cookie は載りません。' +
      '認証は Authorization ヘッダで通しています。',
  );
  L.push('');
  L.push('## 終わったら');
  L.push('');
  L.push('社内に「どこまでやったか」を伝えてください。社内側で招待リンクを発行して動作を確認します。');

  return L.join('\n');
}
