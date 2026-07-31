-- 参考デザイン案（社内向け）
--
-- サイトには適用しない。依頼にデザイン変更の指示があったとき、
-- 社内が持ち帰って検討・提示するための「たたき台」を作る。
-- リポジトリには一切触れないので、素材差し替え（9.10）とは系統が違う。

create table if not exists design_proposals (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references requests(id) on delete cascade,
  batch       int  not null,          -- 同じ依頼で作り直した世代。1 始まり
  variant     int  not null,          -- 1=最小の変更 2=整えた案 3=作り直した案
  direction   text not null,          -- 'minimal' | 'refined' | 'rethink'
  title       text not null,
  rationale   text not null,          -- なぜこうしたか（社内が説明に使う）
  html_path   text not null,          -- nq-designs バケット
  model       text,
  input_tokens  int,
  output_tokens int,
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now(),
  unique (request_id, batch, variant),
  constraint design_proposals_direction_check
    check (direction in ('minimal','refined','rethink'))
);

create index if not exists design_proposals_request_idx
  on design_proposals (request_id, batch desc, variant);

alter table design_proposals enable row level security;
alter table design_proposals force row level security;
-- 他のテーブルと同じく許可ポリシーは置かない。
-- anon は全面的に届かず、参照は全て service_role 経由（10.3 の決定）。

insert into storage.buckets (id, name, public)
values ('nq-designs', 'nq-designs', false)
on conflict (id) do nothing;
