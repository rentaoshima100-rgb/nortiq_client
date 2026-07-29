# Nortiq Revise

納品後の修正依頼を、クライアントが**本番サイト上でクリックして書くだけ**にする仕組み。

設計の正は **技術設計書 v1.4（着工版）**。コード中のコメントの `6.7` `9.10` などは
すべてその節番号を指す。**`docs/design-v1.4.md` として本リポジトリに置くこと**（未配置）。

本リポジトリは現在 **Phase 0** の実装である。

| Phase | 状態 | 内容 |
|---|---|---|
| **0** | **実装済み** | ウィジェット（マウス＋タッチ＋遷移抑止）、認証、Supabase、社内一覧、`events` |
| 2 | 未 | ラウンド、三分類、カウント、フリーズ／ディスパッチ、確認 |
| 1 | 未 | `nq-id` 注入、スナップショット、レイアウトマップ、GitHub/PR 基盤 |
| 3a / 3b / 4 | 未 | 素材差し替え／文言パッチ／変更履歴 |

Phase 0 の完了条件は技術ではなく運用側にある。

> 実案件1件で、**2週間のうち修正依頼の 70% 以上がウィジェット経由**で届くこと。

---

## 構成

```
src/app/api/w/*        ウィジェット向け API（Bearer + Origin 検証、Cookie は使わない）
src/app/admin/*        社内ダッシュボード（Supabase Auth）
src/lib/*              CORS / 認証 / 監査ログ / サニタイズ
widget/src/*           埋め込みウィジェットのソース（TypeScript・外部依存ゼロ）
scripts/build-widget   esbuild で public/w.js を生成（gzip 20KB を超えると失敗する）
supabase/migrations    スキーマ（設計 5.1）
demo/                  検証用のデモサイト（別オリジンで配信する）
```

---

## セットアップ

### 1. Supabase

1. プロジェクトを作る
2. SQL Editor で `supabase/migrations/0001_init.sql` をそのまま実行する
   - 全テーブル、採番関数（5.3）、RLS、添付用の Storage バケットが作られる
3. Authentication → Users で**社内メンバーのアカウントを作る**（メール＋パスワード）

### 2. 環境変数

`.env.example` を `.env.local` にコピーして埋める。

```
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
STAFF_EMAILS=you@nortiqlab.com
```

`STAFF_EMAILS` に入っていないメールは、Supabase Auth を通っても社内画面に入れない。
**未設定だと誰も入れない**（開けっ放しの事故を防ぐため）。

### 3. 起動

```bash
npm install
npm run dev          # http://localhost:3000
```

---

## 動作確認（別オリジンでのデモ）

ウィジェットはクライアントサイトのオリジンで動くため、**同一オリジンで試すと
CORS と Origin 検証を素通りしてしまう**。本番と同じ経路を通すために、
デモサイトは別ポートで配信する。

```bash
npm run dev      # ターミナル1: http://localhost:3000
npm run demo     # ターミナル2: http://localhost:4173
```

1. `http://localhost:3000/admin` にログインし、案件を作る
   - サイトURL: `http://localhost:4173`
   - スニペットキー: `demo-loop`（`demo/*.html` の `data-project` と揃える）
2. 案件画面で招待リンクを発行する
   - 発行された `http://localhost:4173/#nq=...` を開く
   - トークンが localStorage に入り、URL からフラグメントが消える
3. 右下の FAB → 要素をクリック → 内容を書いて送信
4. `/admin/projects/{id}` に依頼が並ぶ

デモサイトには意図的に次を仕込んである。

- **同一 `data-nq-id` を持つループ描画**（カード3枚・施工実績6件）
  → 序数だけでは特定できないこと、`textHash` と `src` で絞れることを確かめる（6.7）
- **`srcset` 付きの `<img>`**
  → `currentSrc` がビューポートで変わり、`src` 属性は変わらないことを確かめる（6.8）
- **`<meta name="nq-sha">`**
  → 依頼に `site_sha` が乗ることを確かめる（9.3）
- **リンクとボタン**
  → 選択モード中にタップしても遷移しないことを確かめる（6.5）

スマートフォンの実機で試す場合は、`NEXT_PUBLIC_APP_URL` と
`demo/*.html` の `<script src>` を LAN の IP に書き換え、案件の
サイトURL も同じホストで登録する。

---

## 設計上の約束（実装で崩してはいけないもの）

- **Cookie を使わない。** `/api/w/*` はクロスサイトになるため、
  `SameSite=Lax` は載らず `None; Secure` も Safari / Firefox で落ちる（6.1）
- **CORS のワイルドカード禁止。** `Origin` と `snippet_key` の両方を毎回検証する
- **トークンは平文で保存しない。** DB には `sha256` のみ（5.1 / 10.2）
- **`events` を通さない更新をしない。** 揉めたときに証拠能力を持つのは、
  クライアントの自己申告（6.9）と `events` の2つだけ（5.2）
- **序数だけの一致を `confirmed` にしない。** リストに1件挿入されただけで
  序数は全部ずれる。3枚目の指摘を1枚目にマッチさせるのが最も害の大きい失敗（6.7）
- **`textHash` はウィジェットとサーバで完全に一致させる。**
  `widget/src/util.ts` の `sha1Hex` と `src/lib/hash.ts` の `textHashOf` は対。
  ビルド時に突き合わせて検証している（`scripts/build-widget.mjs`）
- **`img` の判別子に `currentSrc` を使わない。** ビューポートで値が変わる（6.7 / 7.4）

---

## コマンド

```bash
npm run dev              # ウィジェットをビルドしてから Next.js を起動
npm run build            # 本番ビルド（ウィジェットの gzip 予算も検査する）
npm run widget:watch     # ウィジェットだけ監視ビルド
npm run typecheck        # アプリ側の型検査
npm run typecheck:widget # ウィジェット側の型検査（esbuild は型を見ない）
npm run demo             # 検証用デモサイト
```
