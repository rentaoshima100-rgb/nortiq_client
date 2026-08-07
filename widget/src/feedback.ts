import { putToSignedUrl, type Api, type RoundDiffResponse, type RoundsResponse } from './api';
import { el, fmtDate } from './util';

/**
 * フィードバックタブ（画面B）とラウンド確認（画面E）。
 *
 * 設計では revise 側のダッシュボード（/c/{token}）に置く形になっているが、
 * クライアントはもともと本番サイトを見ている（9.3）ので、ウィジェットの中に
 * 置いた。認証も Bearer トークン1本のままで済み、Cookie 交換も要らない。
 *
 * ここで守っていること:
 * - フリーズ予告を常に見せる（8.2）。見えないルールで締め切られると
 *   「勝手に閉められた」になる
 * - 「1カウントに同意しますか」とは聞かない。争点は金額ではなく
 *   直ったかどうかに置く（8.6）
 * - 差し戻しは既存の依頼から選ばせる。新しい指摘は次のラウンドへ（8.6）
 */

export interface FeedbackOptions {
  api: Api;
  layer: HTMLElement;
  projectName: string;
  clientName: string;
  onClose(): void;
  onChanged(): void;
}

type Filter = 'all' | 'pending' | 'active' | 'done';

export function openFeedback(o: FeedbackOptions): { destroy(): void } {
  const backdrop = el('div', 'backdrop');
  const panel = el('div', 'sheetR');
  o.layer.appendChild(backdrop);
  o.layer.appendChild(panel);

  let data: RoundsResponse | null = null;
  let diff: RoundDiffResponse | null = null;
  let filter: Filter = 'all';
  let rejecting = false;
  const picked = new Set<string>();
  let busy = false;

  backdrop.addEventListener('click', () => o.onClose());

  render();
  load();

  function load() {
    o.api.getRounds().then(
      (r) => {
        data = r;
        render();
        // 公開済みなら、確認をお願いする前に変更前後を出す（画面F）。
        // 「直ったかどうか」を判断する材料が無いまま押させない。
        const st = r.round?.status;
        if (r.round && (st === 'published' || st === 'confirmed' || st === 'closed_auto')) {
          o.api.getRoundDiff(r.round.id).then(
            (d) => {
              diff = d;
              render();
            },
            () => {
              /* 撮影がまだなら黙って出さない */
            },
          );
        }
      },
      () => {
        panel.innerHTML = '';
        panel.appendChild(head());
        const e = el('div', 'empty', '読み込めませんでした。時間をおいてお試しください。');
        panel.appendChild(e);
      },
    );
  }

  function head(): HTMLElement {
    const hd = el('div', 'hd');
    hd.style.position = 'relative';
    hd.appendChild(el('h2', undefined, '修正依頼'));
    hd.appendChild(el('div', 'sub', o.clientName + '／' + o.projectName));
    const x = el('button', 'x', '✕');
    x.setAttribute('aria-label', '閉じる');
    x.addEventListener('click', () => o.onClose());
    hd.appendChild(x);
    return hd;
  }

  function render() {
    try {
      renderInner();
    } catch (e) {
      // 描画で落ちても空のパネルを残さない。
      // API とウィジェットの版がずれたときにここに来る。
      console.error('[nq] パネルの描画に失敗しました', e);
      panel.innerHTML = '';
      panel.appendChild(head());
      panel.appendChild(
        el('div', 'empty', '表示できませんでした。ページを再読み込みしてお試しください。'),
      );
    }
  }

  function renderInner() {
    panel.innerHTML = '';
    panel.appendChild(head());

    const bd = el('div', 'bd');
    panel.appendChild(bd);

    if (!data) {
      bd.appendChild(el('div', 'empty', '読み込み中…'));
      return;
    }

    // ラウンド制を切っている案件では、消化状況もフリーズ予告も確認ボタンも出さない。
    // 依頼の一覧と進捗だけを見せる。
    if (data.roundsEnabled && data.contract) {
      bd.appendChild(quota(data));
      for (const n of roundNotices(data)) bd.appendChild(n);
    }

    if (!rejecting) for (const n of beforeAfter()) bd.appendChild(n);

    /*
     * 確認待ちがあることは、開いた瞬間に分かるようにする。
     * 一覧の中に埋もれると気づかれず、こちらは待ち続けることになる。
     */
    if (!rejecting) {
      const p = pendingCount();
      if (p > 0 && filter !== 'pending') {
        const n = el('div', 'pend');
        n.appendChild(
          el('div', 'pend-b', p + '件、確認したいことがあります。ご返答をお待ちしています。'),
        );
        const go = el('button', 'pend-a', '見る');
        go.addEventListener('click', () => {
          filter = 'pending';
          render();
        });
        n.appendChild(go);
        bd.appendChild(n);
      }
    }

    if (!rejecting) bd.appendChild(filters());

    const list = data.requests.filter((r) => {
      if (rejecting) return r.inCurrentRound;
      if (filter === 'pending') return !!r.question;
      if (filter === 'active') return r.status === 'received' || r.status === 'in_progress';
      if (filter === 'done') return r.status === 'done';
      return true;
    });

    if (list.length === 0) {
      bd.appendChild(
        el(
          'div',
          'empty',
          rejecting
            ? 'このラウンドの依頼がありません'
            : filter === 'pending'
              ? '確認待ちのものはありません'
              : 'まだご依頼はありません',
        ),
      );
    }

    for (const r of list) {
      const row = el('div', 'item');

      if (rejecting) {
        const ck = el('input', 'ck');
        ck.type = 'checkbox';
        ck.checked = picked.has(r.id);
        ck.addEventListener('change', () => {
          if (ck.checked) picked.add(r.id);
          else picked.delete(r.id);
          renderRejectFooter();
        });
        row.appendChild(ck);
      }

      const no = el('div', 'no' + (r.status === 'done' ? ' done' : ''), String(r.seq));
      row.appendChild(no);

      const m = el('div', 'm');
      const meta = el('div', 'meta');
      meta.appendChild(el('span', undefined, fmtDate(r.createdAt)));
      meta.appendChild(el('span', undefined, r.pagePath));
      const st = r.question
        ? el('span', 'st pending', '保留中')
        : el(
            'span',
            'st ' + (r.carriedOver ? 'carry' : r.status),
            r.carriedOver ? '次回' : statusLabel(r.status),
          );
      meta.appendChild(st);
      m.appendChild(meta);
      m.appendChild(el('div', 'bd2', r.body));

      /*
       * 確認したいこと。
       *
       * 許可番号や正式名称のように、**依頼文に無い値**はこちらでは
       * 決められない。想像で埋めると事故になるので、出した本人に聞く。
       * ここで答えてもらえれば、そのまま先に進める。
       */
      if (r.question) {
        const q = el('div', 'ask');
        q.appendChild(el('div', 'ask-h', '確認したいこと'));
        q.appendChild(el('div', 'ask-b', r.question));

        const ta = el('textarea', 'ask-i') as HTMLTextAreaElement;
        ta.rows = 2;
        ta.placeholder = 'こちらにお書きください';
        q.appendChild(ta);

        /*
         * 写真を求める確認が多い（「どの写真をお使いですか」）。
         * 文字で答えさせても話が進まないので、その場で付けられるようにする。
         */
        const at = attachRow();
        q.appendChild(at.el);

        const send = el('button', 'ask-s', '送る') as HTMLButtonElement;
        const note = el('span', 'ask-n', '');
        send.onclick = async () => {
          const v = ta.value.trim();
          if (!v && !at.file) {
            note.textContent = '内容をお書きいただくか、画像を添えてください';
            return;
          }
          if (at.file && !at.kind) {
            note.textContent = 'この画像が素材か参考かをお選びください';
            return;
          }
          send.disabled = true;
          note.textContent = '送っています…';
          try {
            await at.upload(r.id);
            await o.api.answerQuestion(r.id, v || '（画像を添付しました）');
            note.textContent = 'ありがとうございます';
            data = await o.api.getRounds();
            render();
          } catch (e) {
            send.disabled = false;
            note.textContent = e instanceof Error ? e.message : '送れませんでした';
          }
        };
        const foot = el('div', 'ask-f');
        foot.appendChild(send);
        foot.appendChild(note);
        q.appendChild(foot);
        m.appendChild(q);
      } else if (!rejecting && r.status !== 'done') {
        /*
         * 確認が出ていない依頼にも、後から写真を足せるようにする。
         *
         * 「社長写真お送り済み」のように、依頼を出したあとで素材が
         * 揃うことがある。別の依頼として出し直させると、社内の一覧で
         * どの依頼の素材か分からなくなる。
         *
         * 開いたままにはしない。一覧に毎行フォームが並ぶと、依頼そのものが
         * 読めなくなる。押したときだけ出す。
         */
        const more = el('div', 'more');
        const open = el('button', 'more-b', '写真を添える');
        more.appendChild(open);
        open.addEventListener('click', () => {
          more.innerHTML = '';
          const at = attachRow();
          const send = el('button', 'ask-s', '送る') as HTMLButtonElement;
          const note = el('span', 'ask-n', '');
          send.onclick = async () => {
            if (!at.file) {
              note.textContent = '画像をお選びください';
              return;
            }
            if (!at.kind) {
              note.textContent = 'この画像が素材か参考かをお選びください';
              return;
            }
            send.disabled = true;
            note.textContent = '送っています…';
            try {
              await at.upload(r.id);
              note.textContent = 'お預かりしました';
              data = await o.api.getRounds();
              render();
            } catch (e) {
              send.disabled = false;
              note.textContent = e instanceof Error ? e.message : '送れませんでした';
            }
          };
          const foot2 = el('div', 'ask-f');
          foot2.appendChild(send);
          foot2.appendChild(note);
          more.appendChild(at.el);
          more.appendChild(foot2);
        });
        m.appendChild(more);
      }

      row.appendChild(m);

      bd.appendChild(row);
    }

    if (rejecting) renderRejectFooter();
  }

  /**
   * 写真を1枚足すための一式。
   *
   * 素材か参考かは**必ず選ばせる**（6.9）。あとで揉めたときに、誰が
   * 「これは素材だ」と言ったかが要る。選ぶまで送らせない。
   *
   * ファイル入力は label の**外**に置く。中に入れると、label のクリックが
   * 中の input に転送されたうえで自前の input.click() も走り、
   * ダイアログが二重に開く（実測）。label は見た目のためだけに使う。
   */
  function attachRow(): {
    el: HTMLElement;
    file: File | null;
    kind: 'material' | 'reference' | null;
    upload(requestId: string): Promise<void>;
  } {
    const box = el('div', 'at');

    const input = el('input') as HTMLInputElement;
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
    input.style.display = 'none';

    const row = el('div', 'ask-file');
    const pick = el('button', 'ask-pick', '画像を添付');
    const fname = el('span', 'ask-fn', '');
    const kindBox = el('div', 'ask-kind');
    pick.addEventListener('click', () => input.click());
    row.appendChild(pick);
    row.appendChild(fname);
    box.appendChild(input);
    box.appendChild(row);
    box.appendChild(kindBox);

    const out = {
      el: box,
      file: null as File | null,
      kind: null as 'material' | 'reference' | null,
      async upload(requestId: string) {
        if (!out.file || !out.kind) return;
        const signed = await o.api.signAttachment({
          requestId,
          filename: out.file.name,
          mime: out.file.type,
          bytes: out.file.size,
          width: null,
          height: null,
          kind: out.kind,
        });
        await putToSignedUrl(signed.uploadUrl, out.file);
      },
    };

    input.addEventListener('change', () => {
      out.file = input.files && input.files[0] ? input.files[0] : null;
      out.kind = null;
      fname.textContent = out.file ? out.file.name : '';
      kindBox.innerHTML = '';
      if (!out.file) return;
      kindBox.appendChild(el('span', 'ask-kq', 'この画像は？'));
      const mk = (v: 'material' | 'reference', label: string) => {
        const b = el('button', 'ask-kb', label);
        b.addEventListener('click', () => {
          out.kind = v;
          for (const n of Array.prototype.slice.call(kindBox.querySelectorAll('.ask-kb'))) {
            (n as HTMLElement).classList.remove('on');
          }
          b.classList.add('on');
        });
        return b;
      };
      kindBox.appendChild(mk('material', 'サイトに使ってください'));
      kindBox.appendChild(mk('reference', 'イメージの参考です'));
    });

    return out;
  }

  /** 返答をお願いしている件数 */
  function pendingCount(): number {
    if (!data) return 0;
    return data.requests.filter((r) => !!r.question).length;
  }

  function quota(d: RoundsResponse): HTMLElement {
    const c = d.contract!;
    const paid = d.round ? !d.round.countsFree : c.usedFreeRounds >= c.freeRounds;
    const box = el('div', 'quota' + (paid ? ' paid' : ''));
    const top = el('div', 'top');
    top.appendChild(el('span', 'lb', '無償修正ラウンド'));
    top.appendChild(
      el(
        'span',
        'val',
        paid
          ? '無償分は終了'
          : 'ラウンド ' +
              Math.min(c.usedFreeRounds + (d.round ? 1 : 0), c.freeRounds) +
              ' / ' +
              c.freeRounds,
      ),
    );
    box.appendChild(top);

    const bar = el('div', 'bar');
    const fill = el('i');
    const ratio = Math.min(
      100,
      Math.round(
        ((c.usedFreeRounds + (d.round && d.round.countsFree ? 1 : 0)) /
          Math.max(1, c.freeRounds)) *
          100,
      ),
    );
    fill.style.width = ratio + '%';
    bar.appendChild(fill);
    box.appendChild(bar);

    box.appendChild(
      el(
        'div',
        'note',
        paid
          ? 'このラウンドの修正は別途お見積りのご案内になります'
          : c.freeRounds + 'ラウンド目以降は別途お見積りとなります',
      ),
    );
    return box;
  }

  function roundNotices(d: RoundsResponse): HTMLElement[] {
    const out: HTMLElement[] = [];
    const r = d.round;

    if (r && r.status === 'open' && r.freezeInDays != null) {
      // フリーズ予告（8.2）— 常に見せる
      const n = el('div', 'notice info');
      n.appendChild(
        el(
          'div',
          undefined,
          'あと ' +
            r.freezeInDays +
            ' 日 新しいご依頼がなければ、このラウンドの受付を締め切ります（' +
            r.itemCount +
            ' / ' +
            r.maxItems +
            ' 件）',
        ),
      );
      out.push(n);
    }

    if (r && (r.status === 'frozen' || r.status === 'in_progress')) {
      const n = el('div', 'notice info');
      n.appendChild(el('div', undefined, '受付を締め切りました。修正に取りかかっています。'));
      out.push(n);
    }

    if (r && r.status === 'published') {
      const n = el('div', 'notice warn');
      n.appendChild(el('h3', undefined, '修正が公開されました'));
      n.appendChild(
        el(
          'div',
          undefined,
          r.confirmInDays != null
            ? 'ご確認をお願いします。あと ' +
              r.confirmInDays +
              ' 日 ご連絡がない場合は、確認いただいたものとして扱います。'
            : 'ご確認をお願いします。',
        ),
      );

      if (!rejecting) {
        const acts = el('div', 'acts');
        const yes = el('button', 'yes', '確認しました');
        yes.addEventListener('click', () => doConfirm(r.id));
        acts.appendChild(yes);
        if (r.canReject) {
          const no = el('button', 'no', '直っていない箇所があります');
          no.addEventListener('click', () => {
            rejecting = true;
            picked.clear();
            render();
          });
          acts.appendChild(no);
        }
        n.appendChild(acts);
      } else {
        n.appendChild(
          el('div', 'note', '直っていない箇所を選んでください。新しいご依頼は次のラウンドになります。'),
        );
      }
      out.push(n);
    }

    if (d.carriedOverCount > 0) {
      const n = el('div', 'notice info');
      n.appendChild(
        el('div', undefined, '次のラウンドに持ち越し（' + d.carriedOverCount + '件）'),
      );
      out.push(n);
    }

    return out;
  }

  /**
   * 変更前後（画面F）
   * ラウンド節目の全体撮影から、ピン座標で切り出したもの（7.1）。
   * 追加の撮影はしていない。
   */
  function beforeAfter(): HTMLElement[] {
    if (!diff || !diff.items.length) return [];
    const out: HTMLElement[] = [];

    const head = el('div', 'notice info');
    head.appendChild(el('h3', undefined, '修正した箇所'));
    head.appendChild(
      el(
        'div',
        undefined,
        diff.hasBefore && diff.hasAfter
          ? '修正前と修正後を並べています。ご確認ください。'
          : '現在の状態です。',
      ),
    );
    out.push(head);

    for (const item of diff.items) {
      const box = el('div', 'ba');
      const hd = el('div', 'hd2');
      hd.appendChild(el('div', 'no', String(item.seq)));
      hd.appendChild(el('div', 't', item.body));
      box.appendChild(hd);

      const pair = el('div', 'pair' + (item.before && item.after ? '' : ' one'));
      if (item.before) {
        const fig = el('figure', 'b');
        fig.appendChild(el('figcaption', undefined, '修正前'));
        const img = el('img');
        img.src = item.before;
        img.alt = '修正前';
        img.loading = 'lazy';
        fig.appendChild(img);
        pair.appendChild(fig);
      }
      if (item.after) {
        const fig = el('figure', 'a');
        fig.appendChild(el('figcaption', undefined, item.before ? '修正後' : '現在'));
        const img = el('img');
        img.src = item.after;
        img.alt = '修正後';
        img.loading = 'lazy';
        fig.appendChild(img);
        pair.appendChild(fig);
      }
      box.appendChild(pair);

      // 変わったところ（ピクセル差分・7.4 末尾）。見せるためのもので、判定には使わない。
      if (item.diff) {
        const fig = el('figure', 'd');
        fig.appendChild(
          el(
            'figcaption',
            undefined,
            '変わったところ' +
              (item.diffRatio != null ? `（${(item.diffRatio * 100).toFixed(1)}%）` : ''),
          ),
        );
        const img = el('img');
        img.src = item.diff;
        img.alt = '変わったところ';
        img.loading = 'lazy';
        fig.appendChild(img);
        box.appendChild(fig);
      }

      out.push(box);
    }
    return out;
  }

  function filters(): HTMLElement {
    const box = el('div', 'filters');
    const mk = (v: Filter, label: string) => {
      const b = el('button', filter === v ? 'on' : undefined, label);
      b.addEventListener('click', () => {
        filter = v;
        render();
      });
      return b;
    };
    box.appendChild(mk('all', 'すべて'));
    // 確認待ちがあるときだけ出す。無いときに空の区分を見せない
    const p = pendingCount();
    if (p > 0) box.appendChild(mk('pending', '保留中 ' + p));
    box.appendChild(mk('active', '対応中'));
    box.appendChild(mk('done', '完了'));
    return box;
  }

  let footer: HTMLElement | null = null;
  function renderRejectFooter() {
    if (footer) footer.remove();
    footer = el('div', 'foot');
    const cancel = el('button', 'btn sec', 'やめる');
    cancel.addEventListener('click', () => {
      rejecting = false;
      picked.clear();
      render();
    });
    const send = el('button', 'btn pri', 'この ' + picked.size + ' 件を差し戻す');
    send.disabled = picked.size === 0 || busy;
    send.addEventListener('click', () => doReject());
    footer.appendChild(cancel);
    footer.appendChild(send);
    panel.appendChild(footer);
  }

  function doConfirm(roundId: string) {
    if (busy) return;
    busy = true;
    o.api.confirmRound(roundId).then(
      () => {
        busy = false;
        load();
        o.onChanged();
      },
      (e: unknown) => {
        busy = false;
        alertInline(e);
      },
    );
  }

  function doReject() {
    const r = data?.round;
    if (!r || busy || picked.size === 0) return;
    busy = true;
    o.api.rejectRound(r.id, Array.from(picked)).then(
      () => {
        busy = false;
        rejecting = false;
        picked.clear();
        load();
        o.onChanged();
      },
      (e: unknown) => {
        busy = false;
        alertInline(e);
      },
    );
  }

  function alertInline(e: unknown) {
    const msg = e instanceof Error ? e.message : '処理できませんでした';
    const n = el('div', 'notice warn');
    n.textContent = msg;
    const bd = panel.querySelector('.bd');
    if (bd) bd.insertBefore(n, bd.firstChild);
  }

  function statusLabel(s: string): string {
    if (s === 'done') return '完了';
    if (s === 'in_progress') return '対応中';
    if (s === 'wont_fix') return '見送り';
    if (s === 'carried_over') return '次回';
    return '受付済';
  }

  return {
    destroy() {
      backdrop.remove();
      panel.remove();
    },
  };
}
