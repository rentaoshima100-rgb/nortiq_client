-- クライアントが書いた文の英訳
--
-- 社内画面を EN にしても、依頼文だけは日本語のまま出る。クライアントが
-- 打った文なので、辞書では訳せない。**呼んだ結果を持っておく。**
--
-- 毎回訳しに行かないこと。依頼文は後から変わらないので、一度訳せば
-- それが最終。translated_at は「いつの本文を訳したか」の目印で、
-- 本文が変わったときだけ訳し直す判断に使う。
--
-- 訳すのは**クライアントが書いたものだけ**（依頼文と、確認への返答）。
-- 社内が書いた文と、指示づくりが出した文は辞書側で訳している。

alter table requests add column if not exists body_en text;
alter table requests add column if not exists client_answer_en text;
alter table requests add column if not exists translated_at timestamptz;

comment on column requests.body_en is
  '依頼文の英訳。社内画面が EN のときだけ出す。原文は body のまま残す。';
comment on column requests.client_answer_en is
  'クライアントの返答の英訳。';
comment on column requests.translated_at is
  '訳した時刻。null なら未訳。本文が変わったら null に戻して訳し直す。';

-- 未訳の依頼を引くのは「一覧を開くたび」なので、部分索引で足りる
create index if not exists requests_untranslated_idx
  on requests (project_id)
  where translated_at is null;
