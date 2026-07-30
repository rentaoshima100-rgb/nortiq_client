# worker — 撮影・レイアウトマップ・差分・リプレイ検証

設計 7章 と 6.7。アプリ本体とは依存を分けてある（Playwright と sharp が重いため）。
将来 Fly.io などに単独で載せる前提。**メモリ 2GB 以上必須**（13.2）。

```bash
cd worker && npm install && npx playwright install chromium
```

## 撮影

```bash
node cli.mjs --url https://example.com --out ./shots
node cli.mjs --url https://example.com --twice          # 決定性の検査
```

`--twice` は同じページを2回撮って `changed` 差分が0件かを見る。**Phase 1 の完了条件②**。
1件でも出るなら 7.2 の撮影条件にまだ非決定性が残っている。

### 実測（2026-07-31, loop-construction.vercel.app）

| 幅 | 要素数 | ページ高 | 保存 | changed | added | removed | moved |
|---|---|---|---|---|---|---|---|
| 1440 | 518 | 8154px | 1枚 2880×16308 | **0** | 0 | 0 | 0 |
| 768 | 534 | 16139px | **5タイル** 1536×32278 | **0** | 0 | 0 | 0 |
| 390 | 534 | 14079px | **4タイル** 780×28158 | **0** | 0 | 0 | 0 |

768/390 でタイル分割に入った。WebP の1辺の上限は 16383px で、`deviceScaleFactor: 2`
を掛けた実寸で超える。設計 13.2 が「縦 15000px を超えるページはタイル分割」と
書いている箇所だが、**CSS px ではなく実寸で判定する必要がある**。

## スナップショットの保存（7.1 / 7.7）

```bash
node snapshot.mjs --project loop-2026 --phase initial
node snapshot.mjs --project loop-2026 --phase before --round <round_id>
node snapshot.mjs --project loop-2026 --phase after --url <不変デプロイURL> --sha <commit>
```

ページ×幅で撮り、画像とレイアウトマップを Storage に、`snapshots` / `snapshot_shots` に保存する。
あわせて**同じ DOM のまま**ロケータを当て直し、その bbox からピン箇所を切り出して
`request_shots` に入れる。撮影と別の DOM で測ると座標がズレるので、ここは分けない。

切り出す幅は、指摘時の `viewport_w` に一番近いものを選ぶ。
失敗時は3回リトライし、それでも駄目なら `status='failed'`。
**部分成功のスナップショットは比較に使わない**（7.7）。

## 比較（7.4）

```bash
node compare.mjs --before <snapshot_id> --after <snapshot_id>
```

レイアウトマップを結合 → 4分類 → `intended` 判定 → `diffs` に記録する。
ピクセル差分は判定に使わない。

### 実測

同一サイトを2回撮って比較（loop-construction）: 3幅とも **changed 0 / added 0 / removed 0**。

意図的に3種類の変更を入れたデモサイト: **changed 5 / moved 1（無視）** を3幅とも検出。
内訳は文言1・色3・画像1で、入れた変更と過不足なく一致した。

`element_key` には **cssPath を使う**。`nq-id` はループ描画で重複するため一意キーにできない
（3枚のカードの `<p>` が同じ id を持つので、同一バッチ内で unique 制約に当たる）。

同一 `nq-id` グループ内の対応付けは `src` 属性で行うため、**素材を差し替えると判別子自体が
変わる**。文言変更で textHash が変わるのと同じ構造で、対処も同じ（7.4 末尾）。

## リプレイ検証（6.7）

保存済みロケータを後のビルドの DOM に当て直し、段1〜4のどこに落ちるかを実測する。
閾値の議論はこの実データを得てから行う（15.3-⑦）。

```bash
node replay.mjs --project loop-2026
node replay.mjs --project loop-2026 --viewport 1912       # 指摘時と同じ幅で見る
node replay.mjs --project loop-2026 --url https://別ビルド  # 別のデプロイに当てる
```

照合器は `widget/src/locator.ts` を束ねたものを注入している（`npm run widget:build`
が `worker/vendor/locator-bundle.js` を生成する）。**別実装で測ってはいけない。**
測っているものが本番と違うものになる。

出力の `drift` は元の bbox からのズレ。**問題になるのは「confirmed のまま別の要素に
マッチする」誤り**なので、drift が大きい confirmed を疑う。段4（stale）に落ちても
ピンが出ないだけで、依頼内容と切り出し画像は残る。

ビューポート幅が違うとレスポンシブでレイアウトが変わるため、drift は当然大きくなる。
`--viewport` を指摘時の幅に合わせて比較すること。

## まだ無いもの

- Storage / DB への保存（撮影結果はローカルに置くだけ）
- `snapshots` / `snapshot_shots` / `diffs` テーブルへの書き込み
- odiff によるピクセル差分（クライアントに見せる before/after 用。判定には使わない）
- ピン座標からの切り出し（`request_shots`）
- Vercel プレビュー保護のバイパス（`capturePage` の `bypassSecret` は口だけ用意済み・7.5）
- GitHub App / ブランチ / PR 基盤
