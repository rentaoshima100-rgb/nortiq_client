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

## GitHub App / PR 基盤（9.6 / 9.7）

`github.mjs` / `gates.mjs` / `patch.mjs`。Octokit は使わず REST を直接叩く
（JWT の署名は node の crypto でできる）。

必要な環境変数:

```
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY_B64=     # .pem を base64 にしたもの（改行対策）
GITHUB_APP_INSTALLATION_ID=
```

App の権限は **contents:write / pull_requests:write / deployments:read / metadata:read** だけ。
Actions も Workflows も要らない。

### 直列適用でやっていること

パッチは「生成時点のファイル」を基準に作られるので、同一ファイルに複数当てると
2件目以降の `old_str` がズレる。バッチをまたぐと差はさらに開く。そのため
**適用の直前にブランチ HEAD の現在の内容を取り直し、`old_str` がちょうど1回
出現することを再検証する**。ここを省くと静かに壊れる。

1件の失敗で全体を止めない。落ちたものは `rejected` として理由付きで返す。

### ゲート（実測で確認済み）

| 入力 | 結果 |
|---|---|
| 同一ファイルへの2件の連続パッチ | 両方 applied（HEAD を取り直している） |
| `old_str` が2箇所に一致 | rejected |
| `old_str` が見つからない | rejected（先のパッチでズレた場合を含む） |
| `style=` の新規付与 | rejected（9.4。ビルドは通るので**ゲートでしか止まらない**） |
| `package.json` / `*.config.*` | rejected |
| バイナリの上書き（素材差し替え） | applied |

## 素材差し替え（9.10 / Phase 3a）

```bash
node dispatch-assets.mjs --project loop-2026 --dry     # 何が差し替わるか見るだけ
node dispatch-assets.mjs --project loop-2026           # ブランチに当てて PR を作る
```

**LLM を一切呼ばない。** したがって ZDR の取得を待たずに投入できる（13.3）。
`ai_jobs` には `patch_kind='asset' / provider=null / cost_usd=0` で記録する。

系統B のパッチ形式 `{file, old_str, new_str}` はテキスト置換なのでバイナリを表現できず、
9.5 のプロンプトは「新規作成・削除・リネーム禁止」なので、LLM に流すと全件が
構造的に reject される。そもそも LLM の仕事ではない。

### 止めるもの（実測で確認済み）

| 入力 | 結果 |
|---|---|
| 同じ比率・十分な解像度 | 差し替え |
| アスペクト比が 10% 超ずれる | `needs_human` |
| 添付の長辺が原画像の 70% 未満 | `needs_human`（引き伸ばすとぼやける） |
| 原画像が SVG | `needs_human`（2.3 で対象外） |
| リポジトリ上のパスを特定できない | `needs_human` |
| EXIF 入りの添付 | 除去して出力（位置情報が入っていることがある） |

### 変種（srcset / picture）

`currentSrc` だけを差し替えてはならない。1440px で受けた依頼の 800w だけを更新すると、
390px の閲覧者には古い 400w が出続ける。`srcset` を開いて**全変種を差し替える**。

`/_next/image?url=...` は元画像1枚から動的生成されるので、元1枚の差し替えで全変種が
更新される（安全側）。元画像が一意に決まらない場合は `needs_human`。

### 記録

- `events` に `asset.swapped` を旧ハッシュ付きで残す。差し戻し時に復元できる（手順5）
- 同じ画像が複数ページから参照されている場合は PR 本文に明記する。
  GitHub のコード検索が 0 を返したときは「参照なし」ではなく
  **「確認できず」**として扱う（インデックス未反映のことが多い）

---

## まだ無いもの

- **ワーカーのデプロイ**。いまは手元実行のみ。Fly.io などに載せる（メモリ 2GB 以上・13.2）
- **odiff によるピクセル差分**。クライアントに見せる視覚表現用で、判定には使わない。
  前後の切り出しを並べる形は実装済みなので、優先度は高くない
- **Vercel プレビュー保護のバイパスの実動作確認**。`capturePage` の `bypassSecret` は
  口だけ用意してあるが、実際のプレビューでは試していない（7.5）
- **文言パッチ（Phase 3b・系統B）**。着手条件は ZDR の書面確認（13.3）
- **ディスパッチの自動発火**。いまは手動実行。8.2 のデバウンスはサーバ側に置く

## ディスパッチの自動発火（8.2 / 9.2）

```bash
node tick.mjs             # 1回だけ見る
node tick.mjs --dry       # 何が起きるかだけ出す
node tick.mjs --loop      # 常駐して5分おきに見る
```

**クライアントの操作では発火しない。** サーバ側のタイマーが持つ（9.2）。
「押せば直る」と体感されると依頼が増え、無償上限が主張しづらくなる。

発火の条件:

- ラウンドが `open` / `frozen` / `in_progress`（**フリーズは要らない**。8.2 のとおり
  ディスパッチとフリーズは別事象で、ラウンドは open のままでよい）
- 最後の依頼から `dispatch_debounce_minutes`（既定30分）経過
  — デバウンスは**ラウンド単位**で、新規依頼のたびにリセットされる
- まだ `ai_jobs` が作られていない `minor` 依頼がある
  （`spec_change` / `defect` はラウンドから外れるので対象外・8.1）
- 当日のディスパッチが `max_dispatch_per_day`（既定3）未満

実測で確認済み:

| 状況 | 結果 |
|---|---|
| 最後の依頼から30分以上 | 投入する |
| 直前に依頼が入った | `デバウンス中（あと 30 分）` |
| 当日3回に到達 | `本日のディスパッチ上限 3 回に到達` |
| 素材の添付が無い | `対象がありません`（系統A の対象外） |

ラウンドの**期限遷移**（無操作フリーズ・自動確認）はアプリ側の `/api/admin/tick` が持つ。
`vercel.json` で毎正時に呼んでいる。撮影とリポジトリ操作が要らないぶん、
アプリ側に置いたほうが確実に動く。
