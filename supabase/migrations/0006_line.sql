-- ============================================================================
-- LINE 通知（設計 11.1）
--
-- 「メールは読まれない。クライアントは LINE にいる。」
-- LINE をやめさせるのではなく、LINE には通知だけ流して本体に誘導する。
-- ============================================================================

-- 送り先（ユーザーID または グループID）。未設定なら通知しない。
alter table projects add column if not exists line_to text;

-- 送信済みの判定に使う。同じ通知を二度送らないため。
create index if not exists events_project_action_idx on events (project_id, action, at desc);
