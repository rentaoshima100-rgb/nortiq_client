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
import { openFeedback } from './feedback';
import { collectLocator, deadNqId, findByLocator } from './locator';
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
      .replace(/^#&/, '#')
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

/**
 * 社内から「#nq-pin=3」で来たときに、その依頼の箇所まで飛んで光らせる。
 * 依頼一覧に並ぶ「サイトで見る」の着地先。トークンの受け取りと同じく、
 * 読んだ直後に URL から消す。
 */
function readPinTarget(): number | null {
  return readHashNumber('nq-pin');
}

/**
 * 社内から「#nq-repin=3」で来たときに、その依頼の箇所を選び直す。
 *
 * こちらが文言を直すと、本文の手がかりも nq-id も同時に変わることがある
 * （nq-id は「同じ親の中で同じタグの何番目か」から作っているので、
 * 要素を1つ足すと後ろが全部ずれる）。そうなると照合では戻せない。
 * 社内が案件画面からこのリンクで飛べば、1回クリックするだけで直る。
 */
function readRepinTarget(): number | null {
  return readHashNumber('nq-repin');
}

function readHashNumber(key: string): number | null {
  const m = new RegExp('[#&]' + key + '=(\\d+)').exec(location.hash || '');
  if (!m) return null;
  const seq = parseInt(m[1], 10);
  const rest = (location.hash || '')
    .replace(new RegExp('([#&])' + key + '=[^&]*'), '$1')
    .replace(/[#&]+$/, '');
  try {
    history.replaceState(null, '', location.pathname + location.search + (rest === '#' ? '' : rest));
  } catch {
    /* 失敗しても続行する */
  }
  return Number.isFinite(seq) ? seq : null;
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
    (info) => start(api, projectKey, info.project),
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

function start(
  api: Api,
  projectKey: string,
  project: { name: string; clientName: string },
): void {
  /* ── ホストと Shadow DOM ───────────────────────────────────── */
  const host = document.createElement('nq-revise');
  host.style.cssText =
    'all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  /*
   * どのビルドが動いているか。**ここだけ light DOM に出す。**
   * 「入れたはずの機能が出ない」ときに、配信されている w.js の先頭コメントと
   * この値を比べれば、古いものを掴んでいるかが一目で分かる。
   * 中身はソースのハッシュなので、秘密は含まれない。
   */
  host.setAttribute('data-nq-build', __NQ_BUILD__);
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

  // 依頼一覧タブ（画面B / E）
  const tab = el('button', 'tab');
  const tabLabel = el('span', undefined, '依頼一覧');
  const tabCount = el('span', 'n', '0');
  tab.appendChild(tabLabel);
  tab.appendChild(tabCount);
  tab.style.display = 'none';
  layer.appendChild(tab);

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
  let pendingPin: number | null = readPinTarget();
  let feedback: { destroy(): void } | null = null;
  let tabReady = false;
  /** 指し直しの対象。入っている間、選んだ要素は新規依頼ではなく錨の差し替えになる */
  let repinSeq: number | null = null;

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
    // 選択中・入力中はタブを引っ込める（重なって邪魔になる）
    tab.style.display = tabReady && mode === 'idle' ? '' : 'none';
  }

  /** ラウンドの状況をタブに反映する（8.2 のフリーズ予告・8.6 の確認待ち） */
  function loadSummary() {
    api.getRounds().then(
      (r) => {
        tabReady = true;
        tabCount.textContent = String(r.requests.length);
        const needsAction = !!r.round && r.round.canConfirm;
        if (needsAction) tab.classList.add('alert');
        else tab.classList.remove('alert');
        tabLabel.textContent = needsAction ? 'ご確認をお願いします' : '依頼一覧';
        updateHint();
      },
      () => {
        /* 取れなくてもサイトの邪魔はしない */
      },
    );
  }

  function toggleFeedback() {
    if (feedback) {
      feedback.destroy();
      feedback = null;
      return;
    }
    reset();
    feedback = openFeedback({
      api,
      layer,
      projectName: project.name,
      clientName: project.clientName,
      onClose: () => {
        if (feedback) {
          feedback.destroy();
          feedback = null;
        }
      },
      onChanged: () => {
        loadSummary();
        loadPins();
      },
      onGoto: (seq, pagePath) => gotoPin(seq, pagePath),
      onRepin: (seq) => startRepin(seq),
      /*
       * サイト上に箇所を出せなかった依頼。一覧では必ず見えるようにし、
       * 「この画面では出せない」ことだけを伝える。
       * 番号を消さないのはここで守る。サイト上に当てずっぽうで置かない。
       */
      isPlaced: (seq) => lastDrawn.has(seq) || !lastMissing.includes(seq),
    });
  }

  tab.addEventListener('click', toggleFeedback);

  fab.addEventListener('click', () => {
    if (mode === 'idle') enterSelect();
    else reset();
  });

  /* ── 選択モード ────────────────────────────────────────────── */
  function enterSelect() {
    if (feedback) {
      feedback.destroy();
      feedback = null;
    }
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
    /*
     * 指し直しの最中なら、新しい依頼は作らず**錨だけ差し替える**。
     *
     * 指摘された文言をこちらが直すと、本文の手がかりも nq-id も同時に
     * 変わることがある（nq-id は「同じ親の中で同じタグの何番目か」から
     * 作っているので、要素を1つ足すと後ろが全部ずれる）。そうなると
     * 照合では戻せない。**もう一度指してもらうのが唯一確実な手**。
     */
    if (repinSeq != null) {
      const seq = repinSeq;
      const p = pins.find((x) => x.seq === seq);
      repinSeq = null;
      reset();
      if (!p) {
        toast('依頼 #' + seq + ' が見つかりませんでした');
        return;
      }
      api
        .reanchor([{ id: p.id, locator: collectLocator(target) }])
        .then(() => {
          toast('依頼 #' + seq + ' の箇所を覚え直しました');
          loadPins();
        })
        .catch(() => toast('覚え直せませんでした。通信をご確認ください'));
      return;
    }

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
        toast(
          res.carriedOver
            ? 'ご依頼を受け付けました（#' + res.seq + '）※次のラウンドに持ち越します'
            : 'ご依頼を受け付けました（#' + res.seq + '）',
        );
        loadPins();
        loadSummary();
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

  /**
   * 当てられたピンの手がかりを打ち直して送る。
   *
   * 依頼を出した日のロケータは、その日の DOM を指している。サイトを直すたび
   * 本文もクラスも経路もずれ、いつか当たらなくなる。当たらなくなった時点で
   * 番号が消えるので、**当たっているうちに打ち直しておく。**
   * 次の訪問は「1回前のデプロイの DOM」と照合することになり、差が溜まらない。
   *
   * confirmed のときだけ。provisional は当て違いの可能性があり、そこで
   * 上書きすると誤った錨が固定される。弱い手がかりで塗り替えない。
   */
  /**
   * 錨が変わったかを見るための鍵。
   * 座標は入れない。スクロールや画像の読み込みで毎回動くので、
   * それで送っていると開くたびに書き込むことになる。
   */
  function anchorKey(l: PinDTO['locator']): string {
    return [
      l.nqId,
      l.nqOrdinal,
      l.elId,
      l.textHash,
      l.deepTextHash,
      l.srcAttr,
      l.hrefKey,
      l.richPath,
      l.cssPath,
    ].join('|');
  }

  let anchorTimer: ReturnType<typeof setTimeout> | null = null;
  function reanchor(list: { id: string; locator: ReturnType<typeof collectLocator> }[]) {
    if (!list.length) return;
    // 描き直しのたびに投げない。落ち着いてから1回だけ
    if (anchorTimer) clearTimeout(anchorTimer);
    anchorTimer = setTimeout(() => {
      api.reanchor(list).catch(() => {
        /* 打ち直せなくても表示は変わらない */
      });
    }, 2000);
  }

  function drawPins() {
    pinsLayer.innerHTML = '';
    openCard = null;
    const drawn = new Map<number, { node: HTMLElement; rect: ReturnType<typeof docRect> }>();
    const fresh: { id: string; locator: ReturnType<typeof collectLocator> }[] = [];
    /** 今の画面では箇所を出せなかった依頼。一覧側で印を付ける */
    const missing: number[] = [];

    /*
     * 2周する。
     *
     * 1周目は**中身の手がかりだけ**（nq-id / id / src / href / 本文）。
     * これは「その要素自身が名乗っているもの」なので、別の要素には当たらない。
     *
     * 1周目で1つでも当たったなら、**見ている画面は合っている。**
     * そのときだけ2周目で構造の手がかり（richPath / cssPath）に降りる。
     * 直した結果、本文も nq-id も同時に変わった要素はここで拾える。
     *
     * 1周目が全滅なら、SPA で別のビューを見ている可能性が高い。降りない。
     * 降りると、その画面に居ない依頼の番号が無関係な場所に並ぶ。
     */
    const matched = new Map<string, ReturnType<typeof findByLocator>>();
    let anyContentHit = false;
    for (const p of pins) {
      const hit = findByLocator(p.locator);
      matched.set(p.id, hit);
      if (hit) anyContentHit = true;
    }
    if (anyContentHit) {
      for (const p of pins) {
        if (matched.get(p.id)) continue;
        matched.set(p.id, findByLocator(p.locator, { allowStructural: true }));
      }
    }

    for (const p of pins) {
      const hit = matched.get(p.id) ?? null;

      /*
       * 当てられなかったものは**サイト上には描かない。**
       *
       * 記録した座標に出す作りを一度入れたが、実測で害のほうが大きかった。
       * SPA でビューを切り替えると、その画面に居ない依頼の番号が
       * 無関係な場所に並ぶ。番号が消えるより、**別の場所に出るほうが困る**。
       *
       * 番号そのものは依頼一覧に必ず残る（missing に入れて印を付ける）ので、
       * クライアントから依頼が消えて見えることはない。
       */
      if (!hit) {
        missing.push(p.seq);
        continue;
      }

      const r = docRect(hit.el);

      /*
       * 当たっていても、その要素が**いま画面に出ていない**ことがある。
       * 折りたたみ、開いていないモーダル、モバイル用と PC 用で片方だけ
       * 表示される重複マークアップ。display:none の要素は
       * getBoundingClientRect が 0,0,0,0 を返す。
       *
       * そのまま描くと left も top も 0 になり、該当するピンが**全部
       * 文書の左上に重なる**。z-index は最大なのでロゴの上に乗り、
       * 「知らない番号が1個ずっと出ている」ように見える。
       * 照合は成功しているのに、見た目は壊れている。
       */
      if (r.w === 0 && r.h === 0) {
        missing.push(p.seq);
        continue;
      }

      const node = el('button', 'pin' + (p.status === 'done' ? ' done' : ''), String(p.seq));
      node.style.left = Math.max(0, r.x + r.w - 13) + 'px';
      node.style.top = Math.max(0, r.y - 13) + 'px';
      node.title = p.body;
      node.addEventListener('click', (ev) => {
        ev.stopPropagation();
        showCard(p, r);
      });
      pinsLayer.appendChild(node);
      drawn.set(p.seq, { node, rect: r });

      /*
       * 当てられているうちに錨を打ち直す。
       *
       * confirmed のときは無条件。加えて、**記録した nq-id が文書内に
       * 1つも無いことが確かめられている**ときは provisional でも打ち直す。
       * その nq-id は証明済みに無効なので、残しておくと毎回フォールバックを
       * 通ることになり、次に本文が1文字変わった瞬間に落ちる。
       * 死んだ手がかりを新しいものに置き換えるだけなので、情報は失わない。
       *
       * 構造の手がかりで当てたもの（weak）は塗り替えない。当て違いを
       * そこで固定してしまう。
       */
      const rescued =
        hit.tier === 'provisional' && !!p.locator.nqId && deadNqId(p.locator);
      if (hit.tier === 'confirmed' || rescued) {
        const next = collectLocator(hit.el);
        // 変わっていないなら送らない。開くたびに書き込むことになる
        if (anchorKey(next) !== anchorKey(p.locator)) fresh.push({ id: p.id, locator: next });
      }
    }

    lastDrawn = drawn;
    lastMissing = missing;
    reanchor(fresh);

    // 社内からの「サイトで見る」で来たとき、その箇所まで飛んで光らせる
    if (pendingPin != null) {
      const seq = pendingPin;
      if (drawn.has(seq)) {
        pendingPin = null;
        gotoPin(seq, null);
      }
    }
  }

  /** 直前に描いたピン。一覧から番号を押されたときに使う */
  let lastDrawn = new Map<number, { node: HTMLElement; rect: ReturnType<typeof docRect> }>();
  /** 直前の描画で箇所を出せなかった依頼 */
  let lastMissing: number[] = [];

  /**
   * 箇所を指し直してもらう。
   *
   * こちらが文言を直すと、本文の手がかりも nq-id も同時に変わることがある
   * （nq-id は「同じ親の中で同じタグの何番目か」から作っているので、
   * 要素を1つ足すと後ろが全部ずれる）。そうなると照合では戻せない。
   * **もう一度指してもらうのが唯一確実な手**で、それを1タップにする。
   */
  function startRepin(seq: number) {
    repinSeq = seq;
    enterSelect();
    hint.textContent = '依頼 #' + seq + ' の箇所をもう一度選んでください';
    toast('依頼 #' + seq + ' の箇所を選び直してください');
  }

  /**
   * その番号の箇所まで飛んで光らせる。
   *
   * 一覧を見ている人は「どこの話だったか」を確かめたい。文言だけでは
   * 思い出せないことが多く、探させると使われなくなる。
   * **見つからないときに黙って何も起きないのが一番困る**ので、必ず何か言う。
   */
  function gotoPin(seq: number, pagePath: string | null) {
    const target = lastDrawn.get(seq);
    const p = pins.find((x) => x.seq === seq);
    if (!target || !p) {
      // 見つからないと言うだけで終わらせない。その場で指し直せるようにする
      if (pagePath && pagePath !== currentPagePath()) {
        toast('依頼 #' + seq + ' は ' + pagePath + ' の依頼です');
      } else {
        startRepin(seq);
      }
      return;
    }
    if (feedback) {
      feedback.destroy();
      feedback = null;
    }
    window.scrollTo({
      top: Math.max(0, target.rect.y - window.innerHeight / 3),
      behavior: 'smooth',
    });
    target.node.classList.add('flash');
    setTimeout(() => target.node.classList.remove('flash'), 3600);
    setTimeout(() => showCard(p, target.rect), 500);
    toast('依頼 #' + seq + ' の箇所です');
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

  /**
   * URL を変えずに中身だけ差し替えるサイトがある（ブラウザ内で JSX を
   * 描画するタイプなど）。パスの変化だけを見ていると、ページを移動しても
   * 前のページのピンが残り続ける。DOM の入れ替わりを見て描き直す。
   */
  let domTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver((records) => {
    // 自分のシャドウ配下の変化は無視する（無限ループを避ける）
    if (records.every((r) => r.target === host || host.contains(r.target as Node))) return;
    if (domTimer) clearTimeout(domTimer);
    domTimer = setTimeout(() => {
      if (mode === 'idle') drawPins();
    }, 250);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // 社内から #nq-repin=3 で来たとき。ピンの読み込みを待ってから選択に入る
  const repinOnBoot = readRepinTarget();
  if (repinOnBoot != null) setTimeout(() => startRepin(repinOnBoot), 1200);

  loadPins();
  loadSummary();
  // 画像の遅延読み込みでレイアウトが動くため、少し置いてもう一度合わせる
  setTimeout(drawPins, 1500);

  // 指定された依頼にたどり着けないまま数秒経ったら、黙って終わらせない
  if (pendingPin != null) {
    setTimeout(() => {
      if (pendingPin == null) return;
      const seq = pendingPin;
      pendingPin = null;
      toast(
        pins.some((x) => x.seq === seq)
          ? '依頼 #' + seq + ' の箇所は、今のページでは特定できませんでした'
          : '依頼 #' + seq + ' はこのページの依頼ではありません',
      );
    }, 4000);
  }
}

try {
  boot();
} catch {
  /* ウィジェットの不具合でサイトを壊さない */
}
