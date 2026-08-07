/**
 * ビルド時に差し込まれる定数（scripts/build-widget.mjs の define）
 *
 * widget/src のソース全体の sha256 の頭8桁。内容が変わらなければ同じ値。
 * ホスト要素の data-nq-build と、w.js 先頭のコメントの両方に入る。
 */
declare const __NQ_BUILD__: string;
