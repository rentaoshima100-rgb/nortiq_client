-- 1案件に複数のオリジンを許す
--
-- site_origin は site_url から自動生成される1つだけの列だった。
-- ところが実際には「Vercel の仮ドメインで作り、あとから独自ドメインに
-- 切り替える」が普通に起きる。切り替えた瞬間に CORS で弾かれ、
-- クライアントは依頼を送れなくなる（原因が分かりにくい壊れ方をする）。
--
-- 移行期間は両方を許す必要があるので、追加のオリジンを持てるようにする。
-- ワイルドカードは入れない（6.1 / 10.4）。完全一致のままで、
-- 「どれと一致してよいか」の候補を増やすだけ。

alter table projects
  add column if not exists extra_origins text[] not null default '{}';

comment on column projects.extra_origins is
  'site_origin に加えて許可するオリジン。独自ドメインへの切り替え期間などに使う。完全一致で照合する。';

-- 照合は一致するかどうかだけなので GIN で足りる
create index if not exists projects_extra_origins_idx
  on projects using gin (extra_origins);
