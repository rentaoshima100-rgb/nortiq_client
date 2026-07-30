-- ============================================================================
-- Phase 1: スナップショットの保存先
-- ============================================================================

-- 撮影結果（画像・レイアウトマップ・切り出し）。非公開。
insert into storage.buckets (id, name, public, file_size_limit)
values ('nq-snapshots', 'nq-snapshots', false, 52428800)
on conflict (id) do nothing;

-- 1回の撮影で「どの幅を撮ったか」を残す。タイル分割した場合は
-- storage_path に先頭タイルを入れ、tiles に全件を持つ（13.2）。
alter table snapshot_shots add column if not exists tiles jsonb;

-- 撮影対象のページが1件も登録されていない案件でも動かせるように、
-- project_pages が空なら '/' だけを撮る（worker 側の既定）。
create index if not exists project_pages_project_idx on project_pages (project_id);

-- 切り出しの由来が分かるようにしておく。どの幅から切ったか。
alter table request_shots add column if not exists viewport_w int;
