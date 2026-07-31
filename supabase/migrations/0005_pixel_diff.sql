-- ============================================================================
-- ピクセル差分（設計 7.4 末尾）
--
-- odiff の結果は「クライアントに見せる before/after の視覚表現」専用で、
-- 判定には使わない。判定はレイアウトマップの結合で行う。
-- ============================================================================

-- after 側のショットに、before と比べた差分画像のパスを持たせる
alter table request_shots add column if not exists diff_path text;

-- 変化したピクセルの割合。0 に近ければ「見た目は変わっていない」と言える
alter table request_shots add column if not exists diff_ratio numeric(6,4);
