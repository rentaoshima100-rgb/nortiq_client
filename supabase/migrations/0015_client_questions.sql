-- クライアントへの確認
--
-- 「許可番号を入力してください」のように、**値が依頼文に無い**ものは
-- こちらでは決められない。社内が想像で埋めると事故になる。
-- 依頼を出した本人に、その場で聞けるようにする。
--
-- 質問はウィジェットの依頼一覧に出る。クライアントは自分が出した依頼の
-- 下に「確認したいこと」を見て、そのまま答えられる。
--
-- 13.4 に従い、画面に「AI」の語は出さない。文面も社内が書いたものとして
-- 読める形にする（実際、社内が確認してから出す）。

alter table requests add column if not exists client_question text;
alter table requests add column if not exists client_question_at timestamptz;
alter table requests add column if not exists client_answer text;
alter table requests add column if not exists client_answered_at timestamptz;

comment on column requests.client_question is
  'クライアントに聞きたいこと。入っている間、ウィジェットの依頼一覧に出る。';
comment on column requests.client_answer is
  'クライアントの返答。入ると質問は消え、社内が指示を作り直せる。';

-- 指示づくりの段で作った質問の下書き。社内が確認してから requests へ移す
alter table fix_instructions add column if not exists question text;

comment on column fix_instructions.question is
  'クライアントに聞くべきこと。社内が確認してから requests.client_question に移す。';
