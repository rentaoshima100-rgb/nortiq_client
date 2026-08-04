-- 自動修正の跡を残す
--
-- 自動で当てたのに画面上は他の依頼と同じに見えると、社内は
-- 「まだ誰も手をつけていない」と読んでしまい二重に作業する。
-- どの依頼が自動で処理され、どの PR に入ったかを引けるようにする。

alter table ai_jobs add column if not exists pr_url text;
alter table ai_jobs add column if not exists pr_number int;
alter table ai_jobs add column if not exists branch text;
alter table ai_jobs add column if not exists merged_at timestamptz;
alter table ai_jobs add column if not exists summary text;

comment on column ai_jobs.pr_url is 'この書き換えが入った PR。マージされるまで本番には出ていない。';
comment on column ai_jobs.merged_at is 'PR がマージされた日時。ここが入って初めて本番に出ている。';

create index if not exists ai_jobs_request_idx on ai_jobs (request_id);

-- 社内が添付を足せるようにする。
-- 「この写真に差し替えて」に対して、正しい素材を社内が持っていることがある。
alter table attachments add column if not exists added_by text not null default 'client';
alter table attachments add column if not exists added_by_id text;

comment on column attachments.added_by is
  'client = クライアントが依頼時に添付 / staff = 社内があとから追加。素材差し替えの自己申告の出どころを分けるため（6.9）';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attachments_added_by_check'
  ) then
    alter table attachments
      add constraint attachments_added_by_check check (added_by in ('client', 'staff'));
  end if;
end $$;
