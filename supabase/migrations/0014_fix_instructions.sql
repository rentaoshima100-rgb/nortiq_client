-- 修正指示（実際にコードを触る前の段階）
--
-- 依頼ごとに「何をどう直すか」の指示だけを先に作る。ここではリポジトリを
-- 読まないので安く、社内が中身を直せる。実際の書き換えは、選んだ指示を
-- まとめて1回投げたときに初めて起きる。
--
-- 分ける理由:
--   1. 指示は人が読んで直せる。コードの差分は読みづらく直しづらい
--   2. 依頼ごとにリポジトリを読むと、同じファイルを件数ぶん送ることになる
--   3. 「やる」と決めたものだけを1本の PR にまとめられる

create table if not exists fix_instructions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  request_id  uuid not null references requests(id) on delete cascade,
  instruction text not null,          -- 何をどう直すか。社内が直せる
  target_hint text,                   -- 触りそうなファイル・セレクタ
  doable      bool not null default true,
  reason      text,                   -- doable が false のときの理由
  status      text not null default 'draft',
    -- draft | approved | applied | skipped
  source      text not null default 'auto',   -- auto | staff
  pr_url      text,
  applied_at  timestamptz,
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  constraint fix_instructions_status_check
    check (status in ('draft','approved','applied','skipped')),
  constraint fix_instructions_source_check check (source in ('auto','staff'))
);

create index if not exists fix_instructions_project_idx
  on fix_instructions (project_id, status, created_at desc);
create index if not exists fix_instructions_request_idx
  on fix_instructions (request_id);

alter table fix_instructions enable row level security;
alter table fix_instructions force row level security;
