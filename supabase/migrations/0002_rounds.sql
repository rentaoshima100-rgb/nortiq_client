-- ============================================================================
-- Phase 2: ラウンド・カウント・確認
-- 設計 8.2 / 8.3 / 8.5 / 8.6 / 5.4
-- ============================================================================

-- なぜフリーズしたのかを残す。運用で「勝手に締められた」が起きたとき、
-- events と合わせて説明できるようにするため（8.2）。
alter table rounds add column if not exists freeze_reason text;
alter table rounds add constraint rounds_freeze_reason_check
  check (freeze_reason is null or freeze_reason in ('manual','idle','limit','reject'));

-- 差し戻しのときにクライアントが選んだ依頼（8.6）。
-- 「そのラウンドの既存依頼に対してのみ」なので、依頼側に印を持つ。
alter table requests add column if not exists rejected_in_round uuid references rounds(id);

create index if not exists requests_project_round_null_idx
  on requests (project_id) where round_id is null;

create index if not exists rounds_project_seq_idx on rounds (project_id, seq desc);

-- ============================================================================
-- カウントの導出（5.4）
--   無償修正の消化数 = confirmed / closed_auto かつ counts_free のラウンド数
-- ============================================================================
create or replace function used_free_rounds(p_project_id uuid)
returns int language sql stable as $$
  select count(*)::int from rounds
  where project_id = p_project_id
    and status in ('confirmed','closed_auto')
    and counts_free = true;
$$;

-- ============================================================================
-- ラウンドを開く（8.4）
--   フリーズ後に届いた依頼は round_id = null で貯まっている。
--   新しいラウンドを開いたら、それらを全部このラウンドに引き取る。
--   「フリーズは入力を止めるのではなく行き先を変える」の実装。
-- ============================================================================
create or replace function open_round(p_project_id uuid)
returns uuid language plpgsql as $$
declare
  v_round_id uuid;
  v_seq int;
  v_free_rounds int;
  v_used int;
  v_counts_free bool;
  v_idle_days int;
begin
  -- すでに open のラウンドがあればそれを返す
  select id into v_round_id from rounds
  where project_id = p_project_id and status = 'open'
  order by seq desc limit 1;
  if v_round_id is not null then
    return v_round_id;
  end if;

  select free_rounds, freeze_idle_days into v_free_rounds, v_idle_days
  from projects where id = p_project_id;

  v_used := used_free_rounds(p_project_id);
  -- 無償の枠を使い切っていたら、このラウンドはカウント対象にしない。
  -- （＝有償。追加見積の導線に載せる）
  v_counts_free := v_used < coalesce(v_free_rounds, 3);

  v_seq := next_round_seq(p_project_id);

  insert into rounds (project_id, seq, status, counts_free, freeze_due_at)
  values (p_project_id, v_seq, 'open', v_counts_free,
          now() + make_interval(days => coalesce(v_idle_days, 3)))
  returning id into v_round_id;

  -- 持ち越し分を引き取る
  update requests
  set round_id = v_round_id
  where project_id = p_project_id and round_id is null;

  return v_round_id;
end;
$$;
