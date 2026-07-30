# nq-inject

クライアントサイトのソースに `data-nq-id` を注入し、`nq-id → ソース位置` の対応表を出す。
設計 6.6 / 9.3。

## なぜソース変換なのか（実測 2026-07-31, Next.js 15.5.22）

設計書は Babel プラグイン方式の懸念を挙げていた。実際に試した結果、**両方とも塞がっている**。

| 方式 | 結果 |
|---|---|
| `babel.config.js` にプラグインを置く | `Disabled SWC as replacement for Babel` → **`"next/font" requires SWC although Babel is being used` でビルド失敗** |
| Turbopack ビルド | `Babel detected (babel.config.js) / Babel is not yet supported.` → **ビルドを拒否** |
| **ビルド前にソースを書き換える（本ツール）** | **成功。next/font もそのまま動く** |

設計書は「Babel も Turbopack も塞がっている場合に限り SWC プラグイン自作を再評価する」としていたが、
その手前にこの道がある。**SWC プラグイン（Rust/wasm）は不要**で、Next.js のバージョン追従という
恒常的な保守負債も負わない。Next が動く前に終わっているので、Next からは普通のソースにしか見えない。

## 使い方

クライアントサイトのリポジトリに `tools/nq-inject/` を置き、`@babel/parser` を devDependency に足す。

```json
{
  "scripts": {
    "prebuild": "node tools/nq-inject/cli.mjs --root . --out .nq",
    "build": "next build"
  },
  "devDependencies": { "@babel/parser": "^7.26.0" }
}
```

`.gitignore` に `.nq/` を足すこと。対応表はリポジトリにコミットしない（毎ビルドで diff ノイズが出る）。

```
node tools/nq-inject/cli.mjs --root . --out .nq        # 書き換える
node tools/nq-inject/cli.mjs --root . --dry            # 確認だけ
node tools/nq-inject/cli.mjs --root . --source         # data-nq-src も付ける（プレビュー用）
```

**ソースをその場で書き換える。** Vercel / CI のチェックアウトは使い捨てなので問題ないが、
手元で試すときは必ず `--dry` を付けること。二重実行は安全（`data-nq-id=` を含むファイルは触らない）。

あわせて、全ビルドで `<meta name="nq-sha">` を出すこと（9.3）。

```jsx
<meta name="nq-sha" content={process.env.VERCEL_GIT_COMMIT_SHA ?? ''} />
```

## 何に付くか（6.6）

- 直下にテキストを持つ要素（`{item.title}` のような動的テキストを含む）
- `img` `picture` `svg` `video` `button` `a` `input` `label`
- `h1`〜`h6` `section` `article` `header` `footer` `nav`
- `data-nq-force` が付いた要素（明示的な指定。上のどれにも当たらない
  カードのラッパなどに使う）

付かないもの: `html` `body` `head` `script` `style` など選択対象になりえないタグ、
自作コンポーネント（`<Badge>` のような大文字始まり。そのコンポーネントの
定義側で付く）、`{items.map(...)}` のように中身が JSX の式しか持たないラッパ。

## id は安定だが一意ではない

```
nq-id = sha1(相対パス + "|" + AST上の構造パス).slice(0, 8)
```

行番号は使わない。1行挿入で下位の全 id が変わってしまうため。構造パスは
**ソース上の定義箇所**を指すので、ループ描画された N 個の要素は**全部同じ id になる**。

実測（probe アプリ、カード3枚のループ）:

```
d3aba815 × 3   ← <li>
b833c87c × 3   ← <img>
bdc465f6 × 3   ← <h3>
```

これは不具合ではなく仕様（6.5）。受け側は序数と textHash（`img` は `src` 属性）で
絞る必要がある。**序数だけの一致を confirmed にしてはならない。**

## 出力

`.nq/nqmap.json`:

```json
{ "d3582137": "app/page.jsx:14:7", "b833c87c": "app/page.jsx:19:13" }
```

これを Storage の `nqmap/{project_id}/{commit_sha}.json` に置く（9.3）。
逆引きは「その時デプロイされていたコミットの表」で行う。
