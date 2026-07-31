-- 案を作るときに使った設計トークンを残す
--
-- 「なぜこの色なのか」を後から説明できるようにする。
-- サイト側の CSS が変われば抽出結果も変わるので、案と一緒に固定して持つ。
alter table design_batches add column if not exists site_tokens jsonb;

comment on column design_batches.site_tokens is
  '本番サイトの CSS から抽出した配色・書体・余白。取得できなかった場合は null。';
