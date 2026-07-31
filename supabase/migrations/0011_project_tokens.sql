-- 設計トークンを案件に持つ
--
-- 依頼ごとに本番サイトを取りに行くと、案を作るたびに数秒待たされ、
-- サイトが落ちていれば案の質が落ちる。案件の登録時に一度取って持っておき、
-- サイトを作り直したときだけ社内が取り直す。

alter table projects add column if not exists design_tokens jsonb;
alter table projects add column if not exists design_tokens_at timestamptz;

comment on column projects.design_tokens is
  '本番サイトの CSS から抽出した配色・書体・余白。案を作るときの色の選択肢を閉じるのに使う。';
comment on column projects.design_tokens_at is
  '抽出した日時。サイトを作り直したら社内が取り直す。';
