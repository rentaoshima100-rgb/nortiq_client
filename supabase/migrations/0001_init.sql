-- ============================================================================
-- Nortiq Revise — 初期スキーマ
-- 技術設計書 v1.4 の 5.1 に対応する。Phase 1 以降で使うテーブルも含めて
-- 最初に作る（後から足すと外部キーの張り替えが発生するため）。
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── projects ────────────────────────────────────────────────────────────────
create table projects (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  client_name         text not null,
  site_url            text not null,
  -- CORS のオリジン照合に使う（6.1）。site_url から機械的に導出する。
  site_origin         text generated always as (
                        regexp_replace(site_url, '^(https?://[^/]+).*$', '\1')
                      ) stored,
  snippet_key         text not null unique,
  repo_owner          text,
  repo_name           text,
  default_branch      text default 'main',
  stack               text not null default 'static',   -- 'next' | 'static' | 'single-file'
  has_nq_id           bool default false,               -- 注入が成功しているか（6.6）
  preview_bypass_secret text,                           -- 暗号化保存（7.5）
  free_rounds         int  default 3,
  max_items_per_round int  default 10,
  dispatch_debounce_minutes int default 30,
  freeze_idle_days    int  default 3,
  auto_confirm_days   int  default 14,
  max_dispatch_per_day int default 3,
  ai_enabled          bool default false,               -- Phase 3b（LLM）の可否
  asset_swap_enabled  bool default false,               -- Phase 3a（素材差し替え）の可否
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  constraint projects_stack_check check (stack in ('next','static','single-file'))
);
create index projects_site_origin_idx on projects (site_origin);

-- ── project_pages ───────────────────────────────────────────────────────────
create table project_pages (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references projects(id) on delete cascade,
  path           text not null,
  label          text,
  capture        bool default true,
  mask_selectors text[] default '{}',
  unique (project_id, path)
);

-- ── project_counters（5.3 の採番）──────────────────────────────────────────
create table project_counters (
  project_id  uuid primary key references projects(id) on delete cascade,
  request_seq int not null default 0,
  round_seq   int not null default 0
);

-- ── rounds ──────────────────────────────────────────────────────────────────
create table rounds (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references projects(id) on delete cascade,
  seq            int not null,
  status         text not null default 'open',
    -- open | frozen | in_progress | published | confirmed | closed_auto
  counts_free    bool default true,
  reject_count   int  default 0,
  branch         text,
  dispatch_count int  default 0,
  opened_at      timestamptz default now(),
  freeze_due_at  timestamptz,
  frozen_at      timestamptz,
  last_dispatched_at timestamptz,
  published_at   timestamptz,
  confirmed_at   timestamptz,
  confirm_due_at timestamptz,
  unique (project_id, seq),
  constraint rounds_status_check check (status in
    ('open','frozen','in_progress','published','confirmed','closed_auto'))
);
create index rounds_project_status_idx on rounds (project_id, status);

-- ── requests ────────────────────────────────────────────────────────────────
create table requests (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references projects(id) on delete cascade,
  round_id     uuid references rounds(id),
  seq          int not null,
  body         text not null,
  category     text not null default 'unclassified',
    -- minor | spec_change | defect | unclassified
  subtype      text,                  -- 'text' | 'asset' | 'style' | 'order'
  status       text not null default 'received',
    -- received | in_progress | done | wont_fix | carried_over
  page_path    text not null,
  viewport_w   int not null,
  viewport_h   int not null,
  scroll_y     int not null,
  locator      jsonb not null,        -- 6.7
  nq_id        text,
  nq_ordinal   int,                   -- 同一 nq_id 内の文書順（6.5）
  site_sha     text,                  -- 依頼が出されたビルドの commit SHA（9.3）
  source_ref   text,                  -- プレビュー時のみ。参考情報（9.3）
  target       jsonb,                 -- img の場合 {srcAttr,srcset,currentSrc,naturalW,naturalH}
  outer_html   text,
  computed     jsonb,
  css_rules    jsonb,                 -- 9.4。現在値のコンテキストとしてのみ使う
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (project_id, seq),
  constraint requests_category_check check (category in
    ('minor','spec_change','defect','unclassified')),
  constraint requests_subtype_check check (subtype is null or subtype in
    ('text','asset','style','order')),
  constraint requests_status_check check (status in
    ('received','in_progress','done','wont_fix','carried_over'))
);
create index requests_project_created_idx on requests (project_id, created_at desc);
create index requests_project_page_idx    on requests (project_id, page_path);
create index requests_round_idx           on requests (round_id);

-- ── attachments ─────────────────────────────────────────────────────────────
create table attachments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid references requests(id) on delete cascade,
  storage_path text not null,
  filename     text not null,
  mime         text not null,
  width        int,
  height       int,
  bytes        int not null,
  kind         text not null,     -- 'material' | 'reference'（クライアント申告・6.9）
  created_at   timestamptz default now(),
  constraint attachments_kind_check check (kind in ('material','reference'))
);
create index attachments_request_idx on attachments (request_id);

-- ── snapshots（Phase 1）─────────────────────────────────────────────────────
create table snapshots (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects(id) on delete cascade,
  round_id    uuid references rounds(id),
  phase       text not null,      -- 'initial' | 'before' | 'preview' | 'after'
  commit_sha  text,
  deploy_url  text,
  status      text not null default 'pending',
  error       text,
  taken_at    timestamptz default now(),
  constraint snapshots_phase_check check (phase in ('initial','before','preview','after')),
  constraint snapshots_status_check check (status in ('pending','running','ready','failed'))
);
create index snapshots_project_idx on snapshots (project_id, taken_at desc);

create table snapshot_shots (
  id              uuid primary key default gen_random_uuid(),
  snapshot_id     uuid references snapshots(id) on delete cascade,
  page_path       text not null,
  viewport_w      int not null,
  storage_path    text not null,
  width           int not null,
  height          int not null,
  layout_map_path text not null,     -- Storage 上の JSON（7.4）
  unique (snapshot_id, page_path, viewport_w)
);

create table request_shots (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid references requests(id) on delete cascade,
  snapshot_id  uuid references snapshots(id) on delete cascade,
  bbox         jsonb,
  match_tier   text,               -- 'confirmed'|'provisional'|'weak'|'stale'
  crop_path    text,
  unique (request_id, snapshot_id),
  constraint request_shots_tier_check check (match_tier is null or match_tier in
    ('confirmed','provisional','weak','stale'))
);

-- ── diffs（Phase 1）─────────────────────────────────────────────────────────
create table diffs (
  id                 uuid primary key default gen_random_uuid(),
  round_id           uuid references rounds(id) on delete cascade,
  before_snapshot_id uuid references snapshots(id),
  after_snapshot_id  uuid references snapshots(id),
  page_path          text not null,
  viewport_w         int not null,
  kind               text not null,   -- 'changed' | 'added' | 'removed'
  change_fields      text[],          -- ['text'] ['style'] ['src'] ['size']
  element_key        text,
  bbox               jsonb not null,
  nearest_request    uuid references requests(id),
  relation           text,            -- 'self'|'descendant'|'ancestor'|'none'
  intended           bool not null,
  unique (before_snapshot_id, after_snapshot_id, page_path, viewport_w, element_key),
  constraint diffs_kind_check check (kind in ('changed','added','removed'))
);

-- ── ai_jobs（Phase 3）───────────────────────────────────────────────────────
create table ai_jobs (
  id            uuid primary key default gen_random_uuid(),
  round_id      uuid references rounds(id) on delete cascade,
  request_id    uuid references requests(id),
  dispatch_no   int not null,
  patch_kind    text not null,     -- 'text' | 'asset'（9.10）
  provider      text,              -- asset の場合は null（LLM 不使用）
  attempt       int  default 1,
  status        text not null default 'queued',
    -- queued | running | succeeded | rejected | failed | needs_human
  patch         jsonb,
  applied_sha   text,
  reject_reason text,
  cost_usd      numeric(10,4),
  created_at    timestamptz default now(),
  finished_at   timestamptz,
  constraint ai_jobs_kind_check check (patch_kind in ('text','asset')),
  constraint ai_jobs_status_check check (status in
    ('queued','running','succeeded','rejected','failed','needs_human'))
);
create index ai_jobs_round_idx on ai_jobs (round_id);

-- ── pull_requests（Phase 1）─────────────────────────────────────────────────
create table pull_requests (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid references rounds(id) on delete cascade,
  number      int not null,
  branch      text not null,
  head_sha    text,
  preview_url text,
  state       text not null default 'open',
  created_at  timestamptz default now()
);

-- ── client_sessions（平文トークンは保存しない・5.1 / 10.2）──────────────────
create table client_sessions (
  token_hash   text primary key,     -- sha256(token) の hex。平文は保存しない
  project_id   uuid references projects(id) on delete cascade,
  label        text,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz default now()
);
create index client_sessions_project_idx on client_sessions (project_id);

-- ── events（監査ログ・5.2）──────────────────────────────────────────────────
create table events (
  id          bigserial primary key,
  project_id  uuid not null,
  actor_type  text not null,      -- 'staff' | 'client' | 'system'
  actor_id    text,               -- client の場合は token_hash
  entity      text not null,
  entity_id   uuid not null,
  action      text not null,
  before      jsonb,
  after       jsonb,
  at          timestamptz default now(),
  constraint events_actor_type_check check (actor_type in ('staff','client','system'))
);
create index events_project_at_idx on events (project_id, at desc);
create index events_entity_idx     on events (entity, entity_id);
-- レート制限（10.4）で「直近1分の同一トークンの投稿数」を数えるため
create index events_actor_at_idx   on events (actor_id, action, at desc);

-- ============================================================================
-- 採番（5.3）— max(seq)+1 は同時投稿で unique 制約に当たるのでカウンタで採る
-- ============================================================================
create or replace function next_request_seq(p_project_id uuid)
returns int language sql as $$
  update project_counters set request_seq = request_seq + 1
  where project_id = p_project_id
  returning request_seq;
$$;

create or replace function next_round_seq(p_project_id uuid)
returns int language sql as $$
  update project_counters set round_seq = round_seq + 1
  where project_id = p_project_id
  returning round_seq;
$$;

-- 案件を作ったらカウンタ行も必ず作る（アプリ側の作り忘れを防ぐ）
create or replace function create_project_counters()
returns trigger language plpgsql as $$
begin
  insert into project_counters (project_id) values (new.id)
  on conflict (project_id) do nothing;
  return new;
end;
$$;
create trigger projects_after_insert after insert on projects
  for each row execute function create_project_counters();

-- updated_at の自動更新
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger projects_touch before update on projects
  for each row execute function touch_updated_at();
create trigger requests_touch before update on requests
  for each row execute function touch_updated_at();

-- ============================================================================
-- RLS
--   Phase 0 では、クライアント経路もスタッフ経路もすべて Next.js の
--   サーバ側ルート（service_role キー）を通る。service_role は RLS を
--   バイパスするため、ここでは「全テーブルで RLS を有効にし、許可ポリシーを
--   1つも置かない」= anon / authenticated からの直接アクセスを全面的に塞ぐ、
--   という状態を作る。
--   設計 10.3 の JWT 方式（project_id クレーム）は Phase 2 でここに追加する。
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'projects','project_pages','project_counters','rounds','requests','attachments',
    'snapshots','snapshot_shots','request_shots','diffs','ai_jobs','pull_requests',
    'client_sessions','events'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ============================================================================
-- Storage: 添付ファイル用の非公開バケット（6.9）
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nq-attachments', 'nq-attachments', false, 10485760,
  array['image/png','image/jpeg','image/webp','image/gif','image/avif']
)
on conflict (id) do nothing;
