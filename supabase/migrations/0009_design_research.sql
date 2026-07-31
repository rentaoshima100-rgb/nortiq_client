-- デザイン案を作る前の調査
--
-- いきなり作らせると、モデルが持っている既定の作風が出る。
-- 先に「構成の似ている実例」を調べさせ、その型を踏まえて作らせる。
-- 調査結果は社内が施主に説明するときの根拠にもなるので残す。

create table if not exists design_batches (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references requests(id) on delete cascade,
  batch       int  not null,
  client_spec text,            -- 依頼文から読み取った施主の明示指定。無ければ null
  brief       text not null,   -- 調査結果（そのまま3案の材料になる）
  sources     jsonb,           -- [{title, url}]
  model       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now(),
  unique (request_id, batch)
);

create index if not exists design_batches_request_idx
  on design_batches (request_id, batch desc);

alter table design_batches enable row level security;
alter table design_batches force row level security;

-- 案の性格は調査結果から決まるようになったので、固定の3種に縛らない
alter table design_proposals drop constraint if exists design_proposals_direction_check;
comment on column design_proposals.direction is
  '案の性格。調査で挙がった型の短い名前が入る。固定語彙ではない。';
