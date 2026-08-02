# Nortiq Revise — 実装メモ

このリポジトリは技術設計書 **v1.4（着工版）** の実装である。
コード中のコメントにある `6.7` `9.10` などの番号は、すべてその設計書の節番号を指す。
**設計書本体は `docs/design-v1.4.md` に置くこと**（未配置ならまず配置する）。

現在の実装範囲は **Phase 0 と Phase 2**。Phase 1 / 3 のテーブル（`snapshots` /
`diffs` / `ai_jobs` / `pull_requests` など）は最初のマイグレーションで作ってあるが、
参照するコードはまだない。

## 設計書からの逸脱（意図的）

| 箇所 | 設計書 | 実装 | 理由 |
|---|---|---|---|
| クライアント画面 B / E | revise 側のダッシュボード `/c/{token}`（Cookie 交換 + JWT） | **ウィジェット内のパネル**（`/api/w/rounds`、Bearer のまま） | クライアントはもともと本番サイトを見ている（9.3）。認証機構を増やさずに済む。`/c/{token}` はメール導線が要るときに足す |
| 期限による遷移（自動確認・無操作フリーズ） | — | **読まれたときに追いつく方式**（`runDueTransitions`） | 外部スケジューラに状態を依存させない。Vercel Cron を足すときは `/api/admin/tick` から同じ関数を呼ぶだけ |
| RLS（10.3） | JWT 方式かアプリ層強制かは未決 | **アプリ層強制**。RLS は全テーブル有効・許可ポリシー無しで anon を全面封鎖し、全経路をサーバ側ルート（service_role）に通す | Phase 0/2 ではクライアント経路もサーバを必ず通るため。10.3 の「中途半端にしない」に従い、方式を明示して倒した |
| 導入（6.6 の注入） | 注入は必須。エンジニアに手順書を渡す | **注入は任意**。ロケータが注入なしでも段2に留まる（Tier 0）。導入の必須はスニペット1行だけ | 実測で段3 weak が 22% → 0%（注入なしの実サイト）。必須の編集が1行に減ったので、GitHub App で PR を出す形にできた |
| スニペットの設置 | サイト側の作業 | **こちらから PR を出す**（案件作成と同時、または案件ページから） | 1ファイル1行の追記なら、他人のリポジトリでも読み合わせと取り消しが簡単に済む。数百要素の書き換えは自動でやらない |

---

## 崩してはいけない約束

設計書で「実装が黙って間違えるタイプの箇所」として名指しされたもの。
変更するときは設計書の該当節を読んでからにすること。

| # | 約束 | 節 | 実装箇所 |
|---|---|---|---|
| 1 | **Cookie を使わない**（`/api/w/*` はクロスサイト。`SameSite=Lax` は載らず `None; Secure` も遮断される） | 6.1 | `src/lib/widget-auth.ts` / `widget/src/api.ts` |
| 2 | **CORS はワイルドカード禁止**。`Origin` と `snippet_key` の両方を毎回検証 | 6.1 / 10.4 | `src/lib/cors.ts` |
| 3 | **トークンは平文で保存しない**（DB は `sha256` のみ） | 5.1 / 10.2 | `src/lib/hash.ts` / `client_sessions` |
| 4 | **`events` を通さない更新をしない** | 5.2 | `src/lib/events.ts` の `auditedUpdate` |
| 5 | **序数だけの一致を `confirmed` にしない** | 6.7 | `widget/src/locator.ts` の `findByLocator` |
| 6 | **`img` の判別子は `src` 属性。`currentSrc` を使わない**（ビューポートで変わる） | 6.7 / 7.4 | 同上 / `collectTarget` |
| 7 | **`textHash` はウィジェットとサーバで完全一致させる** | 6.7 | `widget/src/util.ts` `sha1Hex` ⇔ `src/lib/hash.ts` `textHashOf`。ビルド時に突き合わせ検証 |
| 8 | **添付の種別（素材／参考）は必ず選ばせ、`events` に自己申告として残す** | 6.9 | `widget/src/composer.ts` / `api/w/attachments` |
| 9 | **選択モード中は click / submit / touchend / keydown を capture で止める**。`mousedown` / `touchstart` / `touchmove` は通す | 6.5 / 6.4 | `widget/src/index.ts` |
| 10 | **トークンを持たない訪問者には一切描画しない** | 6.2 | `widget/src/index.ts` の `boot()` |
| 11 | **招待を送ってよいかは、本番 HTML の現物で判定する**。deployment の成否ではない（GitHub 連携を使わないデプロイでは何も返らない） | — | `api/admin/deploy-status` / `ui.tsx` の `InviteIssuer` |
| 12 | **webhook は署名を検証できないものを一切処理しない**。秘密が未設定なら 503。黙って通すと誰でも「本番に出た」と書き込めて招待が早く出る | — | `src/lib/gh-webhook.ts` / `api/gh/webhook` |
| 13 | **他人のリポジトリへの書き込みは既定 PR**。直接コミットは案件ごとに明示的に許可されたときだけ（`projects.allow_direct_commit`） | — | `src/lib/snippet-install.ts` |
| 14 | **同じリポジトリに複数案件がぶら下がっているとき、webhook は何もしない**。取り違えて「出た」と記録するほうが害が大きい | — | `api/gh/webhook` の `projectForRepo` |

11〜14 は設計書 v1.4 に無い。Tier 0 と導入の自動化を入れたときに決めたもの。

---

## ウィジェット

- 外部依存ゼロ。`gzip 20KB` を超えると **ビルドが失敗する**（`scripts/build-widget.mjs`）
- DOM はすべて `attachShadow({ mode: 'closed' })` 配下。
  closed shadow の retarget により、自分の内側で起きたイベントは
  外側からは `e.target === host` に見える。抑止の除外判定はこれを使っている
- esbuild は**型を見ない**。`npm run typecheck:widget` を別途走らせること
- ロケータの Tier 0 用フィールド（`elId` / `deepTextHash` / `hrefKey` / `richPath`）は
  **すべて optional**。古い依頼の保存済みロケータには入っていないので、
  参照側は必ず欠損を許すこと。段の意味は変えていない（序数だけの一致を
  confirmed にしない＝約束 5 はそのまま）
- 段の分布は `worker/measure-tiers.mjs` で測れる。`--ignore-nqid` を付けると
  注入前の状態を同じページで再現できるので、A/B がそのまま出る
- ホストは `document.documentElement` に `position:absolute` で挿す。
  ピンは文書座標をそのまま `left/top` に使えるが、FAB とパネルは `position:fixed`

## サーバ

- Phase 0 ではクライアント経路もスタッフ経路も **service_role キー**を通る。
  RLS は「全テーブルで有効 + 許可ポリシーなし」= anon からの直接アクセスを全面封鎖、
  という形にしてある。設計 10.3 の JWT 方式は Phase 2 でここに足す
- 採番は必ず `next_request_seq()`（`project_counters`）。`max(seq)+1` は
  同時投稿で unique 制約に当たる（5.3）
- レート制限は `events` を数えている（Redis を持ち込まないための割り切り）

## まだ無いもの（意図的に）

- ラウンド / カウント / フリーズ（Phase 2）
- スナップショット・レイアウトマップ・PR 基盤（Phase 1）
- LLM は一切呼んでいない。`ai_enabled` / `asset_swap_enabled` は既定 false
- LINE 連携は「リンクを手で送る」運用（Phase 0 の想定どおり）

## 作法

- 画面・通知・自動サマリーに「AI」の語を出さない（13.4）。
  ただしクライアントから直接問われたら虚偽を述べない
- 文言はクライアントが読む前提で書く。エラーも日本語で、原因と次の行動が分かる形にする
