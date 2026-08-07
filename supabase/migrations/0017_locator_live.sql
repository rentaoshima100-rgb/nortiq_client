-- ピンの錨を打ち直す（番号を消さないための土台）
--
-- 依頼を出した日のロケータは、その日の DOM を指している。サイトを直すたび
-- 本文・クラス・経路がずれ、いつか当たらなくなる。当たらなくなった瞬間に
-- **ピンが消える**ので、クライアントから見れば依頼ごと無くなったのと同じ。
--
-- そこで、当てられたときにその場の手がかりを書き戻しておく。次の訪問は
-- 「1回前のデプロイの DOM」と照合することになり、差が溜まらない。
--
-- **requests.locator は書き換えない。**
-- あれは「クライアントが何を押したか」の記録であって、5.2 の監査対象。
-- 打ち直した錨は別の列に持ち、原本は残す。照合は live を先に見る。

alter table requests add column if not exists locator_live jsonb;
alter table requests add column if not exists locator_live_at timestamptz;

comment on column requests.locator_live is
  '最後に当てられたときの手がかり。照合はこれを優先し、無ければ locator を使う。'
  '原本（locator）は書き換えない。';
comment on column requests.locator_live_at is
  '打ち直した時刻。古いままなら、その依頼はしばらく当たっていない。';
