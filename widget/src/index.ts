/**
 * Nortiq Revise 埋め込みウィジェット
 *
 *   <script src="https://revise.nortiqlab.com/w.js" data-project="loop-2026" defer></script>
 *
 * - トークンを持たない訪問者には一切描画しない（6.2）。本番に常設できる。
 * - DOM はすべて closed の Shadow DOM 配下に置く。
 * - Cookie は使わない。Authorization: Bearer のみ（6.1）。
 */
import { createApi, type Api, type PinDTO } from './api';
import { openComposer, type Composer } from './composer';
import { findByLocator } from './locator';
import { CSS_TEXT, PAGE_CSS } from './styles';
import { docRect, el, fmtDate, isSelectable, jaLabel, shortLabel } from './util';

type Mode = 'idle' | 'selecting' | 'composing';

const PENCIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

function currentPagePath(): string {
  let p = location.pathname || '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function readSiteSha(): string | null {
  const m = document.querySelector('meta[name="nq-sha"]');
  return m ? m.getAttribute('content') : null;
}

/** 招待リンクの #nq=... を受け取り、直ちに URL から消す（6.1） */
function acquireToken(projectKey: string): string | null {
  const storageKey = 'nq_token:' + projectKey;
  const m = /[#&]nq=([^&]+)/.exec(location.hash || '');
  if (m) {
    const token = decodeURIComponent(m[1]);
    try {
      localStorage.setItem(storageKey, token);
    } catch {
      /* プライベートモード等。今回のページ内でだけ使う */
    }
    const rest = (location.hash || '')
      .replace(/([#&])nq=[^&]*/, '$1')
      .replace(/[#&]+$/, '');
    const cleanHash = rest === '#' ? '' : rest;
    try {
      history.replaceState(null, '', location.pathname + location.search + cleanHash);
    } catch {
      /* 失敗しても続行する */
    }
    return token;
  }
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function boot(): void {
  const script =
    (document.currentScript as HTMLScriptElement | null) ||
    (document.querySelector('script[data-project][src*="w.js"]') as HTMLScriptElement | null);
  if (!script) return;

  const projectKey = script.getAttribute('data-project');
  if (!projectKey) return;

  let apiBase = '';
  try {
    apiBase = new URL(script.src, location.href).origin;
  } catch {
    return;
  }

  const token = acquireToken(projectKey);
  if (!token) return; // 一般の訪問者には何も出さない

  const api = createApi(apiBase, token, projectKey);
  api.init().then(
    () => start(api, projectKey),
    (e: unknown) => {
      // 401 は「このサイトの招待ではない / 失効した」。静かに捨てる。
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) {
        try {
          localStorage.removeItem('nq_token:' + projectKey);
        } catch {
          /* noop */
        }
      }
    },
  );
}

function start(api: Api, projectKey: string): void {
  /* ── ホストと Shadow DOM ───────────────────────────────────── */
  const host = document.createElement('nq-revise');
  host.style.cssText =
    'all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  root.appendChild(style);

  const layer = el('div', 'nq');
  root.appendChild(layer);

  const pinsLayer = el('div');
  layer.appendChild(pinsLayer);

  // 選択中のハイライト
  const hi = el('div', 'hi');
  const hiTag = el('div', 'hi-tag');
  hi.style.display = 'none';
  hiTag.style.display = 'none';
  layer.appendChild(hi);
  layer.appendChild(hiTag);

  // 粒度調整バー（タッチ・6.4）
  const bar = el('div', 'bar');
  const barKind = el('span', 'kind');
  const upBtn = el('button', undefined, '▲ 親要素');
  const downBtn = el('button', undefined, '▼ 子要素');
  const okBtn = el('button', 'ok', 'これでOK');
  bar.appendChild(barKind);
  bar.appendChild(upBtn);
  bar.appendChild(downBtn);
  bar.appendChild(okBtn);
  bar.style.display = 'none';
  layer.appendChild(bar);

  // FAB
  const fab = el('button', 'fab');
  fab.innerHTML = PENCIL;
  fab.setAttribute('aria-label', '修正を依頼する');
  const hint = el('div', 'hint');
  layer.appendChild(hint);
  layer.appendChild(fab);

  /* ── 状態 ──────────────────────────────────────────────────── */
  let mode: Mode = 'idle';
  let touchMode = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let candidate: Element | null = null;
  let candidateAt = 0;
  let anchorDoc = { x: 0, y: 0 };
  let composer: Composer | null = null;
  let pins: PinDTO[] = [];
  let pageStyle: HTMLStyleElement | null = null;
  let lastPath = currentPagePath();

  updateHint();

  /* ── ヒント / FAB ─────────────────────────────────────────── */
  function updateHint() {
    if (mode === 'idle') {
      hint.textContent = touchMode ? '修正したい箇所をタップ' : '修正したい箇所をクリック';
      hint.style.display = '';
      fab.innerHTML = PENCIL;
      fab.classList.remove('on');
    } else if (mode === 'selecting') {
      hint.textContent = touchMode
        ? '箇所をタップして選んでください'
        : '箇所をクリックしてください（Esc で中止）';
      hint.style.display = '';
      fab.innerHTML = CLOSE_ICON;
      fab.classList.add('on');
    } else {
      hint.style.display = 'none';
      fab.innerHTML = CLOSE_ICON;
      fab.classList.add('on');
    }
  }

  fab.addEventListener('click', () => {
    if (mode === 'idle') enterSelect();
    else reset();
  });

  /* ── 選択モード ────────────────────────────────────────────── */
  function enterSelect() {
    mode = 'selecting';
    pinsLayer.style.pointerEvents = 'none';
    if (!pageStyle) {
      pageStyle = document.createElement('style');
      pageStyle.textContent = PAGE_CSS;
      document.head.appendChild(pageStyle);
    }
    document.documentElement.classList.add('nq-selecting');
    window.addEventListener('scroll', onScroll, { passive: true });
    updateHint();
  }

  function reset() {
    mode = 'idle';
    candidate = null;
    hi.style.display = 'none';
    hiTag.style.display = 'none';
    bar.style.display = 'none';
    pinsLayer.style.pointerEvents = '';
    document.documentElement.classList.remove('nq-selecting');
    if (pageStyle) {
      pageStyle.remove();
      pageStyle = null;
    }
    window.removeEventListener('scroll', onScroll);
    if (composer) {
      composer.destroy();
      composer = null;
    }
    updateHint();
  }

  function onScroll() {
    if (candidate) drawHighlight(candidate);
  }

  function drawHighlight(target: Element) {
    const r = target.getBoundingClientRect();
    hi.style.display = '';
    hi.style.left = r.left + 'px';
    hi.style.top = r.top + 'px';
    hi.style.width = r.width + 'px';
    hi.style.height = r.height + 'px';

    hiTag.style.display = '';
    hiTag.textContent = shortLabel(target);
    const tagTop = r.top > 24 ? r.top - 22 : r.bottom + 4;
    hiTag.style.left = Math.max(4, r.left) + 'px';
    hiTag.style.top = tagTop + 'px';

    if (mode === 'selecting' && touchMode) {
      barKind.textContent = jaLabel(target);
      bar.style.display = '';
      const bw = bar.offsetWidth || 280;
      let bx = r.left + r.width / 2 - bw / 2;
      bx = Math.min(Math.max(8, bx), window.innerWidth - bw - 8);
      let by = r.bottom + 10;
      if (by + 52 > window.innerHeight - 8) by = Math.max(8, r.top - 62);
      bar.style.left = bx + 'px';
      bar.style.top = by + 'px';
      upBtn.disabled = !target.parentElement || !isSelectable(target.parentElement, host);
      downBtn.disabled = !childAt(target, anchorDoc);
    }
  }

  function setCandidate(target: Element | null) {
    if (!target || target === candidate) return;
    candidate = target;
    candidateAt = Date.now();
    drawHighlight(target);
  }

  function pickAt(clientX: number, clientY: number): Element | null {
    let e = document.elementFromPoint(clientX, clientY);
    if (e === host) return null;
    while (e && !isSelectable(e, host)) e = e.parentElement;
    return e;
  }

  function childAt(parent: Element, doc: { x: number; y: number }): Element | null {
    const x = doc.x - window.scrollX;
    const y = doc.y - window.scrollY;
    const kids = parent.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      const r = c.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && isSelectable(c, host)) {
        return c;
      }
    }
    for (let i = 0; i < kids.length; i++) {
      if (isSelectable(kids[i], host)) return kids[i];
    }
    return null;
  }

  upBtn.addEventListener('click', () => {
    if (!candidate) return;
    const p = candidate.parentElement;
    if (p && isSelectable(p, host)) setCandidate(p);
  });
  downBtn.addEventListener('click', () => {
    if (!candidate) return;
    const c = childAt(candidate, anchorDoc);
    if (c) setCandidate(c);
  });
  okBtn.addEventListener('click', () => {
    // タップ直後 300ms は確定しない（誤タップの取り消し猶予・6.4）
    if (!candidate || Date.now() - candidateAt < 300) return;
    commit(candidate);
  });

  function commit(target: Element) {
    mode = 'composing';
    bar.style.display = 'none';
    document.documentElement.classList.remove('nq-selecting');
    if (pageStyle) {
      pageStyle.remove();
      pageStyle = null;
    }
    updateHint();
    composer = openComposer({
      api,
      projectKey,
      layer,
      target,
      siteSha: readSiteSha(),
      pagePath: currentPagePath(),
      onClose: () => reset(),
      onSubmitted: (res) => {
        reset();
        toast('ご依頼を受け付けました（#' + res.seq + '）');
        loadPins();
      },
    });
  }

  /* ── 既定動作の抑止（6.5）────────────────────────────────────
   * 選択モード中にリンクをタップするとページが遷移し、依頼が書けない。
   * capture フェーズで止める。mousedown / touchstart はハイライトに
   * 使うので通す。自分の Shadow DOM 内で起きたイベント（closed shadow の
   * retarget により e.target === host になる）は対象外。
   * -------------------------------------------------------------------- */
  const fromWidget = (e: Event) => e.target === host;

  document.addEventListener(
    'mousemove',
    (e) => {
      if (mode !== 'selecting' || touchMode) return;
      const me = e as MouseEvent;
      anchorDoc = { x: me.clientX + window.scrollX, y: me.clientY + window.scrollY };
      setCandidate(pickAt(me.clientX, me.clientY));
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    'click',
    (e) => {
      if (mode !== 'selecting' || fromWidget(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (touchMode) return; // タッチは touchend 側で処理する
      const me = e as MouseEvent;
      const target = pickAt(me.clientX, me.clientY) || candidate;
      if (target) {
        setCandidate(target);
        commit(target);
      }
    },
    { capture: true },
  );

  document.addEventListener(
    'submit',
    (e) => {
      if (mode !== 'selecting' || fromWidget(e)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true },
  );

  document.addEventListener(
    'keydown',
    (e) => {
      const ke = e as KeyboardEvent;
      if (mode === 'composing' && ke.key === 'Escape') {
        reset();
        return;
      }
      if (mode !== 'selecting' || fromWidget(e)) return;
      if (ke.key === 'Escape') {
        reset();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true },
  );

  let touchStart: { x: number; y: number } | null = null;
  document.addEventListener(
    'touchstart',
    (e) => {
      touchMode = true;
      const t = (e as TouchEvent).touches[0];
      if (t) touchStart = { x: t.clientX, y: t.clientY };
    },
    { capture: true, passive: true }, // touchmove を妨げない（ページのスクロールは素通し）
  );

  document.addEventListener(
    'touchend',
    (e) => {
      if (mode !== 'selecting' || fromWidget(e)) return;
      const te = e as TouchEvent;
      const t = te.changedTouches[0];
      e.preventDefault();
      e.stopPropagation();
      if (!t || !touchStart) return;
      const moved = Math.hypot(t.clientX - touchStart.x, t.clientY - touchStart.y);
      touchStart = null;
      if (moved > 10) return; // スクロールはタップとみなさない
      anchorDoc = { x: t.clientX + window.scrollX, y: t.clientY + window.scrollY };
      setCandidate(pickAt(t.clientX, t.clientY));
    },
    { capture: true },
  );

  /* ── ピン ──────────────────────────────────────────────────── */
  let openCard: HTMLElement | null = null;

  function loadPins() {
    api.listPins(currentPagePath()).then(
      (r) => {
        pins = r.pins;
        drawPins();
      },
      () => {
        /* 表示できなくてもサイトの邪魔はしない */
      },
    );
  }

  function drawPins() {
    pinsLayer.innerHTML = '';
    openCard = null;
    for (const p of pins) {
      const hit = findByLocator(p.locator);
      if (!hit) continue; // 段4（stale）はサイト上には描かない（6.7）
      const r = docRect(hit.el);
      const node = el('button', 'pin' + (p.status === 'done' ? ' done' : ''), String(p.seq));
      node.style.left = Math.max(0, r.x + r.w - 13) + 'px';
      node.style.top = Math.max(0, r.y - 13) + 'px';
      node.title = p.body;
      node.addEventListener('click', (ev) => {
        ev.stopPropagation();
        showCard(p, r);
      });
      pinsLayer.appendChild(node);
    }
  }

  function showCard(p: PinDTO, r: { x: number; y: number; w: number; h: number }) {
    if (openCard) {
      openCard.remove();
      openCard = null;
    }
    const card = el('div', 'pincard');
    const top = el('div', 'top');
    top.appendChild(el('span', undefined, '#' + p.seq));
    top.appendChild(el('span', undefined, fmtDate(p.createdAt)));
    top.appendChild(el('span', 'st', statusLabel(p.status)));
    card.appendChild(top);
    card.appendChild(el('div', undefined, p.body));
    card.style.left = Math.max(8, Math.min(r.x, document.documentElement.clientWidth - 268)) + 'px';
    card.style.top = r.y + r.h + 8 + 'px';
    card.addEventListener('click', (ev) => ev.stopPropagation());
    pinsLayer.appendChild(card);
    openCard = card;
    setTimeout(() => {
      const close = () => {
        if (openCard) {
          openCard.remove();
          openCard = null;
        }
        document.removeEventListener('click', close, true);
      };
      document.addEventListener('click', close, true);
    }, 0);
  }

  function statusLabel(s: string): string {
    if (s === 'done') return '完了';
    if (s === 'in_progress') return '対応中';
    if (s === 'carried_over') return '次回';
    if (s === 'wont_fix') return '見送り';
    return '受付済';
  }

  /* ── トースト ──────────────────────────────────────────────── */
  function toast(msg: string) {
    const t = el('div', 'toast', msg);
    layer.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  /* ── 再描画のきっかけ ──────────────────────────────────────── */
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener(
    'resize',
    () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        drawPins();
        if (candidate) drawHighlight(candidate);
      }, 150);
    },
    { passive: true },
  );

  // SPA のルート遷移。history を差し替えず、パスの変化を見るだけにする。
  setInterval(() => {
    const p = currentPagePath();
    if (p !== lastPath) {
      lastPath = p;
      loadPins();
    }
  }, 1000);

  loadPins();
  // 画像の遅延読み込みでレイアウトが動くため、少し置いてもう一度合わせる
  setTimeout(drawPins, 1500);
}

try {
  boot();
} catch {
  /* ウィジェットの不具合でサイトを壊さない */
}
