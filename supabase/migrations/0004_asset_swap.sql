-- ============================================================================
-- Phase 3a: 素材差し替え（設計 9.10 / 系統A）
-- ============================================================================

-- ラウンドにつき PR は1つだが、作り直しに備えて番号で一意にする（9.7）
alter table pull_requests
  add constraint pull_requests_round_number_key unique (round_id, number);

-- ai_jobs は「まだディスパッチされていない依頼」を引くのに request_id で引く（8.2）
create index if not exists ai_jobs_request_idx on ai_jobs (request_id, patch_kind);

-- 素材差し替えは LLM を使わないので provider が null になる。
-- 「provider が null なのは asset のときだけ」を制約で明示しておく。
alter table ai_jobs add constraint ai_jobs_provider_check
  check (patch_kind <> 'text' or provider is not null or status in ('queued','needs_human','failed'));
