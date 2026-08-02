-- 案件を作った時点で、こちらからリポジトリにスニペットを入れられるようにする。
--
-- これまでは onboarding.ts が「エンジニアに渡す指示文」を作って止まっていた。
-- Tier 0（注入なしでも段2に留まる照合）が入ったことで、導入に必要な編集が
-- スニペット1行だけになり、こちらで実行して差し支えない大きさになった。

alter table projects add column if not exists gh_installation_id bigint;
alter table projects add column if not exists allow_direct_commit bool not null default false;
alter table projects add column if not exists snippet_installed_at timestamptz;
alter table projects add column if not exists snippet_commit_sha text;
alter table projects add column if not exists snippet_ref_url text;

comment on column projects.gh_installation_id is
  'GitHub App のインストール ID。リポジトリのオーナーが承認したときに決まる。ここが空なら書き込みはできない。';

comment on column projects.allow_direct_commit is
  '既定は false（PR を出すだけ）。他人のリポジトリなので、直接コミットは案件ごとに明示的に許可する。';

comment on column projects.snippet_commit_sha is
  'スニペットを入れたコミット。デプロイが本番に出たかの判定に使う（このコミットの deployment を見る）。';

comment on column projects.snippet_ref_url is
  'PR の URL、または直接コミットしたときのコミット URL。管理画面から辿れるようにするためだけのもの。';
