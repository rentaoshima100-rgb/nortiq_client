import { putToSignedUrl, type Api, type CreateRequestPayload } from './api';
import { collectComputed, collectMatchedRules, collectTarget, collectLocator } from './locator';
import { el, fmtBytes, jaLabel, shortLabel } from './util';

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;

interface Att {
  file: File;
  previewUrl: string;
  w: number | null;
  h: number | null;
  kind: 'material' | 'reference' | null;
}

export interface ComposerOptions {
  api: Api;
  projectKey: string;
  layer: HTMLElement;
  target: Element;
  siteSha: string | null;
  pagePath: string;
  onSubmitted: (res: { id: string; seq: number; carriedOver?: boolean }) => void;
  onClose: () => void;
}

export interface Composer {
  destroy(): void;
}

export function openComposer(o: ComposerOptions): Composer {
  const atts: Att[] = [];
  const isSheet = window.innerWidth < 480;

  const panel = el('div', 'panel' + (isSheet ? ' sheet' : ''));

  // ヘッダ
  const head = el('div', 'head');
  head.appendChild(el('h2', undefined, '修正内容を入力'));
  const closeBtn = el('button', 'x', '✕');
  closeBtn.setAttribute('aria-label', '閉じる');
  head.appendChild(closeBtn);
  panel.appendChild(head);

  // 本文
  const body = el('div', 'body');
  const targetLine = el('div', 'target');
  targetLine.appendChild(el('span', undefined, jaLabel(o.target)));
  const code = el('b', undefined, shortLabel(o.target));
  targetLine.appendChild(code);
  body.appendChild(targetLine);

  const ta = el('textarea');
  ta.placeholder = '例）この見出しをもう少し大きくしてください';
  body.appendChild(ta);

  /*
   * 画面の写真を勧める。
   *
   * 依頼のとおりに直すと、目印が頼りにしている文言そのものが変わる。
   * そこで目印が外れると、あとから「どこの話でしたか」を聞くことになる。
   * **そのときに効くのは、その人が見ていた画面の写真**。位置も見た目も
   * 一枚で残る。指し直しをお願いする回数がそのぶん減る。
   *
   * 強制はしない。1行だけ添えて、押しやすいところに置く。
   */
  const shotTip = el('div', 'tip');
  shotTip.appendChild(
    el('span', undefined, '画面の写真を添えていただけると確実です（スクリーンショットで結構です）'),
  );
  body.appendChild(shotTip);

  const fileList = el('div');
  body.appendChild(fileList);

  const errBox = el('div', 'err');
  errBox.style.display = 'none';
  body.appendChild(errBox);
  panel.appendChild(body);

  // フッタ
  const foot = el('div', 'foot');
  const attachBtn = el('button', 'btn sec', '画面の写真を添付');
  const sendBtn = el('button', 'btn pri', '送信する');
  foot.appendChild(attachBtn);
  foot.appendChild(sendBtn);
  panel.appendChild(foot);

  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = ALLOWED_MIME.join(',');
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  panel.appendChild(fileInput);

  o.layer.appendChild(panel);
  position();
  setTimeout(() => ta.focus(), 30);

  /* ── 位置決め ─────────────────────────────────────────────── */
  function position() {
    if (isSheet) return; // ボトムシートは CSS 側で固定
    const r = o.target.getBoundingClientRect();
    const ph = panel.offsetHeight || 320;
    const pw = 340;
    let x = r.left;
    if (r.right + 12 + pw <= window.innerWidth) x = r.right + 12;
    x = Math.min(Math.max(8, x), window.innerWidth - pw - 8);
    let y = r.top;
    if (y + ph > window.innerHeight - 8) y = window.innerHeight - ph - 8;
    y = Math.max(8, y);
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  }

  function showError(msg: string | null) {
    if (!msg) {
      errBox.style.display = 'none';
      return;
    }
    errBox.textContent = msg;
    errBox.style.display = '';
  }

  function refreshSendState() {
    const hasBody = ta.value.trim().length > 0;
    const kindsDone = atts.every((a) => a.kind !== null);
    sendBtn.disabled = !hasBody || !kindsDone;
  }

  /* ── 添付（6.9）──────────────────────────────────────────── */
  attachBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const picked = Array.prototype.slice.call(fileInput.files || []) as File[];
    fileInput.value = '';
    for (const f of picked) {
      if (atts.length >= MAX_FILES) {
        showError('画像は1件の依頼につき ' + MAX_FILES + ' 枚までです');
        break;
      }
      if (ALLOWED_MIME.indexOf(f.type) < 0) {
        showError('対応していない形式です（PNG / JPEG / WebP / GIF / AVIF）');
        continue;
      }
      if (f.size > MAX_BYTES) {
        showError('1ファイル 10MB までです');
        continue;
      }
      const dim = await readDimensions(f);
      const att: Att = {
        file: f,
        previewUrl: URL.createObjectURL(f),
        w: dim.w,
        h: dim.h,
        kind: null,
      };
      atts.push(att);
      fileList.appendChild(renderAtt(att));
      showError(null);
    }
    refreshSendState();
    position();
  });

  function renderAtt(att: Att): HTMLElement {
    const wrap = el('div');
    const row = el('div', 'file');
    const thumb = el('img');
    thumb.src = att.previewUrl;
    thumb.alt = '';
    const meta = el('div', 'meta');
    meta.appendChild(el('div', 'nm', att.file.name));
    meta.appendChild(el('div', 'sz', fmtBytes(att.file.size)));
    const rm = el('button', 'x', '✕');
    rm.setAttribute('aria-label', '削除');
    row.appendChild(thumb);
    row.appendChild(meta);
    row.appendChild(rm);
    wrap.appendChild(row);

    // 種別は必ず選ばせる。スキップさせない（6.9）
    wrap.appendChild(el('div', 'kindq', 'この画像は？'));
    const name = 'k' + Math.random().toString(36).slice(2);
    const warn = el(
      'div',
      'warn',
      '参考イメージは仕様変更にあたるため、別途お見積りのご案内になる場合があります。',
    );
    warn.style.display = 'none';

    const mk = (value: 'material' | 'reference', label: string) => {
      const lab = el('label', 'opt');
      const input = el('input');
      input.type = 'radio';
      input.name = name;
      lab.appendChild(input);
      lab.appendChild(el('span', undefined, label));
      input.addEventListener('change', () => {
        att.kind = value;
        warn.style.display = value === 'reference' ? '' : 'none';
        refreshSendState();
        position();
      });
      return lab;
    };
    wrap.appendChild(mk('material', 'サイトに使う素材（差し替えたい）'));
    wrap.appendChild(mk('reference', 'イメージの参考（こんな雰囲気にしたい）'));
    wrap.appendChild(warn);

    rm.addEventListener('click', () => {
      const i = atts.indexOf(att);
      if (i >= 0) atts.splice(i, 1);
      URL.revokeObjectURL(att.previewUrl);
      wrap.remove();
      refreshSendState();
      position();
    });
    return wrap;
  }

  /* ── 送信 ────────────────────────────────────────────────── */
  ta.addEventListener('input', refreshSendState);
  refreshSendState();

  closeBtn.addEventListener('click', () => o.onClose());

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    const original = sendBtn.textContent;
    sendBtn.textContent = '送信中…';
    showError(null);
    try {
      const payload: CreateRequestPayload = {
        projectKey: o.projectKey,
        body: ta.value.trim(),
        pagePath: o.pagePath,
        siteSha: o.siteSha,
        viewport: {
          w: window.innerWidth,
          h: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
        },
        scrollY: Math.round(window.scrollY),
        locator: collectLocator(o.target),
        target: collectTarget(o.target),
        outerHTML: (o.target as HTMLElement).outerHTML.slice(0, 4096),
        computed: collectComputed(o.target),
        cssRules: collectMatchedRules(o.target),
        ua: navigator.userAgent,
      };
      const created = await o.api.createRequest(payload);

      for (const att of atts) {
        const signed = await o.api.signAttachment({
          requestId: created.id,
          filename: att.file.name,
          mime: att.file.type,
          bytes: att.file.size,
          width: att.w,
          height: att.h,
          kind: att.kind as 'material' | 'reference',
        });
        await putToSignedUrl(signed.uploadUrl, att.file);
      }
      o.onSubmitted(created);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '送信に失敗しました';
      showError(msg);
      sendBtn.disabled = false;
      sendBtn.textContent = original;
    }
  });

  return {
    destroy() {
      for (const a of atts) URL.revokeObjectURL(a.previewUrl);
      panel.remove();
    },
  };
}

async function readDimensions(f: File): Promise<{ w: number | null; h: number | null }> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(f);
      const out = { w: bmp.width, h: bmp.height };
      bmp.close();
      return out;
    }
  } catch {
    /* GIF/AVIF で失敗する環境がある。下の Image にフォールバック */
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ w: null, h: null });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
