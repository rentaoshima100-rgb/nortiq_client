-- 依頼に画面の写真を必須にするか（案件ごと）
--
-- 目印は「その要素が何と書いてあるか」を頼りにしている。ご依頼のとおりに
-- 直すと、その文言そのものが変わる。つまり**直した瞬間に外れることがある**。
-- そのとき効くのは、その人が見ていた画面の写真。位置も見た目も一枚で残る。
--
-- 既定は false（お願いするだけ）。文言だけの依頼に毎回写真を求めるのは
-- 摩擦が大きく、出してもらえなくなるほうが損。
-- 取り違えが続く案件だけ true にして、送信の条件にする。

alter table projects add column if not exists require_screenshot boolean not null default false;

comment on column projects.require_screenshot is
  'true なら、依頼の送信に画面の写真を必須にする。false ならお願いするだけ。';
