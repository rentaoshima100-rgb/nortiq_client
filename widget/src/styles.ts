/** Shadow DOM 内のスタイル。ページ側の CSS とは互いに干渉しない（6.2）。 */
export const CSS_TEXT = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.nq {
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN",
    "Hiragino Sans", "Yu Gothic", Meiryo, "Noto Sans JP", sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #0f172a;
  -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
textarea { font: inherit; color: inherit; }

/* ── FAB ─────────────────────────────────────────── */
.fab {
  position: fixed; right: 24px; bottom: 24px;
  width: 56px; height: 56px; border-radius: 50%;
  background: #2563eb; color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 24px rgba(37,99,235,.35);
  pointer-events: auto; transition: background .15s, transform .15s;
}
.fab:hover { background: #1d4ed8; }
.fab:active { transform: scale(.94); }
.fab.on { background: #0f172a; box-shadow: 0 8px 24px rgba(15,23,42,.3); }
.fab svg { width: 22px; height: 22px; display: block; }

.hint {
  position: fixed; right: 92px; bottom: 38px;
  background: #0f172a; color: #fff;
  padding: 7px 14px; border-radius: 8px; font-size: 13px; white-space: nowrap;
  pointer-events: none; box-shadow: 0 4px 12px rgba(15,23,42,.2);
}

/* ── 選択中のハイライト ───────────────────────────── */
.hi {
  position: fixed; border: 2px solid #2563eb; border-radius: 4px;
  background: rgba(37,99,235,.06); pointer-events: none;
  transition: all .06s linear;
}
.hi-tag {
  position: fixed; background: #2563eb; color: #fff;
  font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 5px;
  pointer-events: none; white-space: nowrap;
  max-width: 60vw; overflow: hidden; text-overflow: ellipsis;
}

/* ── 粒度調整バー（タッチ・6.4）───────────────────── */
.bar {
  position: fixed; display: flex; align-items: center; gap: 6px;
  background: #fff; border-radius: 999px; padding: 6px;
  box-shadow: 0 8px 28px rgba(15,23,42,.22); pointer-events: auto;
  border: 1px solid #e2e8f0;
}
.bar .kind {
  font-size: 12px; font-weight: 600; color: #64748b;
  padding: 0 10px 0 8px; white-space: nowrap;
}
.bar button {
  border-radius: 999px; padding: 8px 12px; font-size: 13px; font-weight: 600;
  background: #f1f5f9; color: #0f172a; white-space: nowrap;
}
.bar button:disabled { opacity: .4; }
.bar button.ok { background: #2563eb; color: #fff; padding: 8px 16px; }

/* ── 入力パネル ──────────────────────────────────── */
.panel {
  position: fixed; width: 340px; background: #fff; border-radius: 12px;
  box-shadow: 0 16px 48px rgba(15,23,42,.24); pointer-events: auto;
  display: flex; flex-direction: column; max-height: 78vh;
}
.panel.sheet {
  width: 100%; left: 0; right: 0; bottom: 0; top: auto;
  border-radius: 16px 16px 0 0; max-height: 86vh;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 10px;
}
.head h2 { font-size: 15px; font-weight: 700; }
.head .x { width: 28px; height: 28px; border-radius: 6px; color: #94a3b8; font-size: 18px; line-height: 1; }
.head .x:hover { background: #f1f5f9; color: #0f172a; }
.body { padding: 0 16px; overflow-y: auto; flex: 1; }
.target {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: #64748b; margin-bottom: 8px;
}
.target b { color: #2563eb; font-weight: 600; }
textarea {
  width: 100%; min-height: 96px; resize: vertical;
  border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px;
  background: #f8fafc; outline: none;
}
textarea:focus { border-color: #2563eb; background: #fff; }
.err { color: #dc2626; font-size: 12px; margin-top: 8px; }

/* ── 添付 ───────────────────────────────────────── */
.file {
  display: flex; align-items: center; gap: 10px; margin-top: 10px;
  border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px;
}
.file img { width: 40px; height: 40px; object-fit: cover; border-radius: 5px; background: #e2e8f0; }
.file .meta { flex: 1; min-width: 0; }
.file .nm {
  font-size: 12px; font-weight: 600; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.file .sz { font-size: 11px; color: #94a3b8; }
.file .x { color: #94a3b8; padding: 4px; font-size: 15px; line-height: 1; }
.kindq { font-size: 12px; color: #64748b; margin: 10px 0 4px; }
.opt { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; cursor: pointer; }
.opt input { accent-color: #2563eb; width: 16px; height: 16px; }
.warn {
  background: #fff7ed; color: #c2410c; border-radius: 6px;
  padding: 8px 10px; font-size: 12px; line-height: 1.5; margin-top: 6px;
}
.foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 16px 14px; border-top: 1px solid #f1f5f9;
}
.btn {
  border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600;
}
.btn.sec { background: #f1f5f9; color: #0f172a; }
.btn.sec:hover { background: #e2e8f0; }
.btn.pri { background: #2563eb; color: #fff; }
.btn.pri:hover { background: #1d4ed8; }
.btn:disabled { opacity: .45; cursor: default; }

/* ── ピン ───────────────────────────────────────── */
.pin {
  position: absolute; width: 26px; height: 26px; border-radius: 50%;
  background: #2563eb; color: #fff; font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 8px rgba(15,23,42,.28); pointer-events: auto;
  border: 2px solid #fff;
}
.pin.done { background: #94a3b8; }
.pin.flash { animation: nqpulse 1.1s ease-out 3; }
@keyframes nqpulse {
  0%   { box-shadow: 0 0 0 0 rgba(37,99,235,.7); }
  70%  { box-shadow: 0 0 0 18px rgba(37,99,235,0); }
  100% { box-shadow: 0 0 0 0 rgba(37,99,235,0); }
}
.pincard {
  position: absolute; width: 260px; background: #fff; border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15,23,42,.22); padding: 12px 14px;
  pointer-events: auto; font-size: 13px;
}
.pincard .top {
  display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
  font-size: 11px; color: #94a3b8;
}
.pincard .st {
  margin-left: auto; background: #f1f5f9; color: #475569;
  border-radius: 999px; padding: 2px 8px; font-weight: 600;
}

/* ── トースト ────────────────────────────────────── */
.toast {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: 96px; background: #0f172a; color: #fff;
  padding: 10px 18px; border-radius: 999px; font-size: 13px;
  box-shadow: 0 8px 24px rgba(15,23,42,.3); pointer-events: none;
}
`;

/** 選択モード中だけホストページに差し込む（カーソルと選択の抑止） */
export const PAGE_CSS = `
html.nq-selecting, html.nq-selecting * { cursor: crosshair !important; }
html.nq-selecting { -webkit-user-select: none !important; user-select: none !important; }
`;
