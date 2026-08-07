-- 「どう対応したか」をクライアントに残す
--
-- 完了した依頼のピンはサイトから消す。直し終えた箇所に番号が浮いていても
-- 読む側の役に立たず、**目印が外れやすいのも完了分**（直したことで
-- 本文が変わるため）。地図から消して、記録の側に残す。
--
-- ただし黙って消さない。消える代わりに「何をしたか」が読めるようにする。
-- これが無いと、クライアントから見れば依頼が消えたのと同じになる。
--
-- 13.4: 文面に「AI」「自動」の語を出さない。社内が対応した記録として書く。

alter table requests add column if not exists resolution text;
alter table requests add column if not exists resolution_at timestamptz;

comment on column requests.resolution is
  'この依頼に対して何をしたか。クライアントの一覧に出る。'
  '社内が読んで直してから出す（そのまま相手が読む文）。';
comment on column requests.resolution_at is
  '書いた時刻。null なら未記入。';
