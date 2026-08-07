/**
 * 社内画面の英語
 *
 * 鍵は日本語そのもの。訳が無いものは日本語のまま出るので、
 * 抜けていても画面は壊れない。抜けを探すには:
 *
 *   node scripts/i18n-keys.mjs
 *
 * クライアントが読むウィジェットはこの仕組みの外にある。
 * あちらの言語は案件ごとの話で、今は日本語のみ。
 */
export const DICT: Record<string, string> = {
  // ── 写真の差し替え（9.10）
  写真を差し替える: 'Replace the photo',
  'クライアントが「素材」として送った画像で、リポジトリの元ファイルを置き換える PR を出します。差し替え先は依頼時に押された img の src で決まっているので、推測はしません。':
    'Opens a pull request replacing the original file in the repository with the image the client sent as "material". The target is fixed by the src of the img they clicked, so nothing is guessed.',
  差し替え先を調べる: 'Find the target file',
  'この内容で PR を出す': 'Open a pull request',
  元ファイル: 'Original file',
  '参照元の src': 'Referenced src',
  差し替える画像: 'Replacement image',
  候補: 'Candidates',
  決まっていません: 'Not determined',
  'ファイル名だけで当てています。念のため中身を確認してください':
    'Matched on filename alone — check the content before merging',
  ありません: 'None',
  '{file} を差し替えます': 'Will replace {file}',
  '{file} を読めません': 'Cannot read {file}',
  '差し替える画像が添付されていません。クライアントに「素材」として送ってもらってください。':
    'No replacement image is attached. Ask the client to send one as "material".',
  'この依頼は画像を指していません（押された要素に src がありません）。':
    'This request does not point at an image (the clicked element has no src).',
  '元ファイルの候補が {n} 件あって決められません: {list}':
    'There are {n} candidate files and no way to choose: {list}',
  '元ファイルがリポジトリに見つかりません（{src}）。ビルドで生成されている可能性があります。':
    'The original file is not in the repository ({src}). It may be generated at build time.',
  画像ファイルだけ差し替えられます: 'Only image files can be replaced',
  その候補は元ファイルの一覧にありません: 'That candidate is not in the list of original files',
  添付が見つかりません: 'Attachment not found',
  添付を読み出せませんでした: 'Could not read the attachment',
  'PR を作れませんでした: {why}': 'Could not create the pull request: {why}',

  // ── 依頼文の英訳（クライアントが打った文。辞書では訳せないぶん）
  '{n}件を訳しました': 'Translated {n}',
  '{n}件を訳しました（{left}件は返りませんでした）': 'Translated {n} ({left} came back empty)',
  依頼文を英訳する: 'Translate the requests',
  '依頼文を英訳する（{n}件）': 'Translate the requests ({n} left)',
  原文: 'original',
  英訳: 'English',
  '訳しています…': 'Translating…',
  訳し直す: 'Re-translate',
  訳すものはありません: 'Nothing to translate',
  '訳せませんでした: {why}': 'Could not translate: {why}',

  // ── 共通
  社内: 'Internal',
  ログアウト: 'Sign out',
  ログイン: 'Sign in',
  'ログイン中…': 'Signing in…',
  メールアドレス: 'Email',
  パスワード: 'Password',
  社内ダッシュボード: 'Internal dashboard',
  'このアカウントは社内メンバーとして登録されていません（STAFF_EMAILS を確認してください）':
    'This account is not registered as a staff member (check STAFF_EMAILS)',
  案件: 'Project',
  案件名: 'Project name',
  クライアント名: 'Client name',
  案件を追加: 'Add project',
  案件を作成: 'Create project',
  スニペットキー: 'Snippet key',
  スタック: 'Stack',
  '単一 index.html': 'Single index.html',
  静的HTML: 'Static HTML',
  サイト: 'Site',
  ページ: 'Page',
  状態: 'Status',
  種別: 'Category',
  細目: 'Subtype',
  内容: 'Content',
  場所: 'Location',
  対象: 'Target',
  現在: 'Current',
  変更: 'Change',
  変更前: 'Before',
  変更後: 'After',
  比較: 'Compare',
  失敗: 'Failed',
  失敗しました: 'Failed',
  反映: 'Applied',
  反映しました: 'Applied',
  見送り: 'Skipped',
  当てられません: 'Cannot apply',
  確認: 'Check',
  '確認しています…': 'Checking…',
  '読んでいます…': 'Reading…',
  '見ています…': 'Looking…',
  '作成中…': 'Creating…',
  '保存中…': 'Saving…',
  保存しました: 'Saved',
  設定を保存: 'Save settings',
  コピー: 'Copy',
  コピーしました: 'Copied',
  通信に失敗しました: 'Network request failed',
  '時間内に終わりませんでした（504）': 'Timed out (504)',
  ファイルを選んでください: 'Choose a file',
  登録に失敗しました: 'Failed to register',
  無期限: 'No expiry',

  // ── 案件ページ
  案件設定: 'Project settings',
  サイト側の導入: 'Site setup',
  埋め込みスニペット: 'Embed snippet',
  設計トークン: 'Design tokens',
  '書体:': 'Typefaces:',
  '変数:': 'Variables:',
  'サイトを作り直したら取り直してください。': 'Re-extract these if the site is rebuilt.',
  クライアントの招待: 'Client invitations',
  '宛先のメモ（例: 田中様）': 'Note (e.g. Mr. Tanaka)',
  招待リンクを発行: 'Issue invite link',
  メモ: 'Note',
  発行: 'Issued',
  '発行中…': 'Issuing…',
  最終利用: 'Last used',
  有効期限: 'Expires',
  有効: 'Active',
  失効: 'Revoked',
  未使用: 'Unused',
  ラウンド: 'Rounds',
  ラウンド制を使う: 'Use rounds',
  ラウンド制を使わない設定: 'Rounds are disabled',
  進行中のラウンドはありません: 'No round in progress',
  無償ラウンド数: 'Free rounds',
  '1ラウンドの上限件数': 'Max requests per round',
  '無操作で締切（日）': 'Freeze after idle (days)',
  '自動確認（日）': 'Auto-confirm after (days)',
  受付を締め切る: 'Close for new requests',
  修正に着手: 'Start work',
  公開: 'Publish',
  '公開した（確認依頼を出す）': 'Published (ask for confirmation)',
  着手前に戻す: 'Move back to not started',
  無償に算入: 'Counted as free',
  カウント: 'Counted',
  カウント外: 'Not counted',
  無償カウントから外す: 'Exclude from the free count',
  無償カウントに戻す: 'Count as free again',
  '（以降は有償）': '(billable from here on)',
  締切: 'Deadline',
  内訳: 'Breakdown',
  スナップショット: 'Snapshots',
  撮影: 'Capture',
  バージョン: 'Version',
  変更履歴: 'Change history',
  差分を見る: 'View the diff',
  比較に失敗しました: 'Comparison failed',
  レイアウトマップを読めません: 'Cannot read the layout map',
  'nq-id が注入されている': 'data-nq-id is injected',
  'なし（注入されていない）': 'None (not injected)',
  '素材差し替えを有効にする（Phase 3a）': 'Enable image replacement (Phase 3a)',
  既定ブランチ: 'Default branch',
  直接コミット: 'Commit directly',
  'U1234... 未設定なら通知しない': 'U1234… leave empty to disable notifications',
  'ループ建設 コーポレートサイト': 'Loop Construction corporate site',
  株式会社ループ建設: 'Loop Construction Co., Ltd.',

  // ── 導入
  サイトを確認して指示を作る: 'Inspect the site and draft instructions',
  もう一度確認する: 'Check again',
  'サイトを見ています…': 'Looking at the site…',
  'サイト URL が未設定です': 'No site URL is set',
  こちらでリポジトリに入れる: 'Let us add it to the repository',
  何が変わるか見る: 'Preview the change',
  'PR を出す': 'Open a pull request',
  'PR を出しました': 'Pull request opened',
  'PR を出すだけ': 'Open a pull request only',
  '（マージは先方が行います）': '(they merge it themselves)',
  コミットする: 'Commit',
  コミットしました: 'Committed',
  '書き込んでいます…': 'Writing…',
  '書き換えるファイルはありません。': 'There is no file to change.',
  '変更はありませんでした。': 'Nothing changed.',
  本番に出たか確認する: 'Check whether it is live',
  '本番に出ています。招待を送れます。': 'It is live. You can send invitations.',
  'まだ本番に出ていません。': 'Not live yet.',
  'まだ招待を送らないでください。': 'Please do not send invitations yet.',
  スニペットがまだ本番に出ていません: 'The snippet is not live yet',
  'デプロイが終わるまで数分かかります。下で確認してから招待してください。':
    'Deployment takes a few minutes. Check below before inviting.',
  'マージされて本番に出るまで、招待は送らないでください。':
    'Do not send invitations until it is merged and live.',
  'リポジトリを読み込んでいます…': 'Loading the repository…',
  リポジトリ一覧を取得できませんでした: 'Could not list the repositories',
  'App が入ったリポジトリがありません。': 'No repository has the App installed.',
  '選ばない（サイト側は手で入れる）': 'Do not select (add it by hand)',
  '選ぶと、案件の作成と同時にスニペットを入れます。':
    'If selected, the snippet is added when the project is created.',

  // ── 依頼
  依頼: 'Request',
  受付: 'Received',
  どこの話か: 'What this refers to',
  'ロケータ（6.7）': 'Locator (6.7)',
  要素の現在値: 'Current values of the element',
  '監査ログ（5.2）': 'Audit log (5.2)',
  添付: 'Attachments',
  '添付はありません。': 'No attachments.',
  社内から画像を足す: 'Add an image from our side',
  追加する: 'Add',
  '追加しています…': 'Adding…',
  '素材（サイトに使う）': 'Material (use it on the site)',
  '参考（イメージを伝えるだけ）': 'Reference (just to show the idea)',
  参考イメージ: 'Reference image',
  差し替え素材: 'Replacement material',
  指摘箇所: 'Reported element',
  指摘箇所の切り出し: 'Crop of the reported element',
  ビューポート: 'Viewport',
  採取できたルールがありません: 'No matching rules were captured',
  文書内で一意: 'Unique in the document',
  src属性: 'src attribute',
  サイトの該当箇所を開く: 'Open this spot on the site',
  '（本文・画像の src・リンクの行き先・クラス込みの経路のいずれかで一つに決めています。nq-id を注入すると confirmed に上がります）':
    '(matched by text, image src, link target, or class-qualified path. Injecting data-nq-id raises this to confirmed.)',
  '（決め手が無く、経路と座標で当てています。別の要素を指している可能性があります）':
    '(no strong signal; matched by path and position. It may point at a different element.)',

  // ── 自動反映
  '文言・文字まわりの自動反映': 'Automatic text and typography fixes',
  '文言・文字まわりを自動で反映する': 'Apply text and typography fixes automatically',
  いま走らせる: 'Run now',
  '依頼を見ています…': 'Reading the requests…',
  この依頼を直させる: 'Fix this request',
  '補足の指示（任意）': 'Additional instructions (optional)',
  '例: 許可番号は 派13-300000 です／文字は1段だけ小さく／ヘッダーは触らないで':
    'e.g. the licence number is 13-300000 / one step smaller only / do not touch the header',
  'ソースを読んでいます…': 'Reading the source…',
  'PR を作っています…': 'Opening a pull request…',
  '自動修正 — PR 待ち': 'Auto-fixed — awaiting merge',
  自動修正で完了: 'Completed by automatic fix',
  'PR がマージされ、本番に出ています。': 'The pull request is merged and it is live.',
  'まだマージされていません。PR を確認してマージすると本番に出ます。自動マージはしません。':
    'Not merged yet. Review the pull request and merge it to go live. We never auto-merge.',
  '自動マージはしません。': 'We never auto-merge.',
  'この案件では自動反映を切っています。ここから押した場合だけ走ります。':
    'Automatic fixes are off for this project. It only runs when you press here.',
  '1時間ごとに動きます。待てないときはここから走らせてください（デバウンスを飛ばします）。':
    'Runs hourly. Press here when you cannot wait (this skips the debounce).',

  // ── 修正指示
  修正指示: 'Fix instructions',
  未処理の依頼から指示を作る: 'Draft instructions from open requests',
  '依頼を読んでいます…': 'Reading the requests…',
  '材料を点検する（無料）': 'Check the inputs (free)',
  'リポジトリを見ています…': 'Looking at the repository…',
  'ソースを読んで書き換えています…': 'Reading the source and rewriting…',
  実行する指示を選んでください: 'Select the instructions to run',
  指示を保存: 'Save instruction',
  取り下げる: 'Withdraw',
  '取り下げています…': 'Withdrawing…',
  'ここではまだリポジトリを触りません。': 'Nothing in the repository is touched here.',
  'まとめて1回': 'in a single run',
  'リポジトリが未設定です。実行できません。': 'No repository is set. This cannot run.',
  キャッシュが効いています: 'The cache is working',

  // ── クライアントへの確認
  クライアントに確認する: 'Ask the client',
  クライアントに聞く: 'Ask the client',
  クライアントの回答: 'Answer from the client',
  'この文でクライアントに出す': 'Send this to the client',
  '出しています…': 'Sending…',
  '確認中（画面に出ています）': 'Waiting for an answer (shown to the client)',
  '確認中（相手の画面に出ています）': 'Waiting for an answer (shown on their screen)',
  クライアントには表示していません: 'Not shown to the client',
  '「保留中」': '"On hold"',
  いま確認する: 'Check now',
  '例: 派遣事業の許可番号をお教えいただけますか。':
    'e.g. Could you tell us your staffing licence number?',

  // ── 参考デザイン
  参考デザイン: 'Reference designs',
  参考デザインを3案作る: 'Create three reference designs',
  もう一度作る: 'Create again',
  '実例を調べています…': 'Researching real examples…',
  '3案を作っています…': 'Creating three designs…',
  調査に失敗しました: 'Research failed',
  この案で実装する: 'Implement this design',
  原寸: 'Actual size',
  '施主の指定（3案すべてが従っています）':
    "The client's explicit requirements (all three follow them)",
  'すべて済んでいます。指示は不要です': 'Everything is done. No instructions needed',

  // ── 複数行のテキストなど（後から足したぶん）
  'CORS の許可オリジンになります。パスは無視されます。':
    'This becomes the allowed CORS origin. The path is ignored.',
  'GitHub App がこのリポジトリにインストールされている必要があります':
    'The GitHub App must be installed on this repository',
  'GitHub App を入れる':
    'Install the GitHub App',
  'GitHub で開く':
    'Open on GitHub',
  'GitHub リポジトリ':
    'GitHub repository',
  'LINE でこのリンクを送ってください。開いた時点でトークンが端末に保存され、URL からは自動で消えます。':
    'Send this link over LINE. The token is stored on their device the moment they open it, and disappears from the URL automatically.',
  'LINE の送り先（ユーザーID / グループID）':
    'LINE recipient (user ID / group ID)',
  'PR を出しました → 開く':
    'Pull request opened → view it',
  'PR を出すまでリポジトリは変わりません。自動マージはしません。':
    'Nothing in the repository changes until you open the pull request. We never auto-merge.',
  'PR を開く':
    'Open the pull request',
  'tools/nq-inject を prebuild に入れてある場合。ロケータが段1で当たるようになります（6.6）':
    'Check this if tools/nq-inject runs in prebuild. Locators then match at tier 1 (6.6)',
  'worker の snapshot.mjs で initial または after を撮ると出てきます。':
    'These appear once snapshot.mjs captures an initial or after shot.',
  '— この1回だけはリポジトリの管理者による承認が必要です。':
    '— this one time, a repository admin has to approve it.',
  '— この1回だけはリポジトリの管理者の承認が必要です。':
    '— this one time, a repository admin has to approve it.',
  '← 案件一覧':
    '← All projects',
  '「この一文を直して」「ここの文字を大きく」を、人手を介さずリポジトリに当てて':
    'Applies requests like "reword this sentence" or "make this text bigger" to the repository without human hands, and',
  '「サイトで見る」は、その箇所までスクロールしてピンを光らせます。開く側にも招待トークンが要るので、持っていなければ案件画面で自分宛てに1本発行してください。':
    '"View on site" scrolls to the spot and lights up the pin. Whoever opens it also needs an invite token, so issue one to yourself from the project page if you do not have one.',
  '「素材」を選ぶと、この案件で画像差し替えが有効なとき、差し替えの対象になります。イメージを伝えるだけの画像は「参考」にしてください。':
    'Choosing "material" makes it a candidate for image replacement when that is enabled for this project. Use "reference" for images that only convey an idea.',
  'ここから':
    'From',
  'ここまで':
    'To',
  'このブランチに直接コミットする':
    'Commit directly to this branch',
  'このリンクは今この画面にしか出ません。閉じると二度と表示できません。':
    'This link is shown only here, only now. Once you close it, it can never be shown again.',
  'この内容で指示を作り直してください。':
    'Redraft the instruction using this answer.',
  'それでも発行する':
    'Issue it anyway',
  'まだバージョンがありません。':
    'No versions yet.',
  'まだ依頼がありません':
    'No requests yet',
  'まだ取得していません。':
    'Not extracted yet.',
  'まだ案件がありません':
    'No projects yet',
  'やりとりは行いません。依頼は下の一覧に貯まり続け、進捗は依頼ごとの状態で管理します。':
    'No such exchange takes place. Requests simply accumulate in the list below, and progress is tracked per request.',
  'アカウントは Supabase の Authentication から発行します。':
    'Accounts are issued from Supabase Authentication.',
  'インストール画面を開く':
    'Open the install page',
  'サイトURL（本番のオリジン）':
    'Site URL (production origin)',
  'サイトで見る →':
    'View on site →',
  'サイトに接続できませんでした。URL が正しいか、本番が公開されているか確認してください。下の指示は「何も入っていない」前提で作っています。':
    'Could not reach the site. Check that the URL is correct and that production is published. The instructions below assume nothing is installed yet.',
  'ダウンロード':
    'Download',
  'トークンは sha256 でしか保存していないため、後から取り出すことはできません。紛失したら新しく発行して古いものを失効させてください。':
    'Tokens are stored only as a sha256 hash, so they cannot be retrieved later. If one is lost, issue a new link and revoke the old one.',
  'ピン対象の自身・子孫・祖先のいずれでもない場所が変わっています。':
    'Something changed outside the pinned element, its descendants and its ancestors.',
  'ファイルの中身を1回しか送らないので費用が抑えられ、指示は差分より読みやすく直しやすい形です。':
    'The file contents are sent only once, which keeps the cost down, and instructions are easier to read and edit than diffs.',
  'ラウンドが確認済みになるたびに、その時点の撮影が1バージョンとして確定します。比較に追加の撮影は要りません。':
    'Each time a round is confirmed, the capture at that moment is fixed as a version. Comparing them needs no extra capture.',
  'ラウンドを開く':
    'Open a round',
  'リポジトリが大きく、ファイル一覧が GitHub 側で打ち切られました。挿入先の取りこぼしがある可能性があります。':
    'The repository is large and GitHub truncated the file listing. Some insertion points may have been missed.',
  'リポジトリ（任意）':
    'Repository (optional)',
  'レイアウトシフトだけの移動（moved）は差分に数えません（7.4）。':
    'Pure layout shifts (moved) are not counted as differences (7.4).',
  '使用':
    'In use',
  '依頼ごとに「何をどう直すか」の指示だけを先に作ります。':
    'For each request we first draft only an instruction saying what to change and how.',
  '依頼ごとに指示だけを先に作り、社内が読んで直してから、':
    'We draft the instructions first, you read and edit them, and then',
  '依頼だけでは決められないこと（番号、正式名称、どの写真か）を、出した本人に聞けます。':
    'Ask the person who filed the request about anything the request alone cannot settle (a number, an official name, which photo).',
  '依頼文だけでは足りないことがある。値を持っているのは社内で、クライアントは「許可番号を入れて」としか書かない。ここに書いたものは依頼文より優先される。':
    'The request alone is often not enough. You hold the value; the client only writes "put in the licence number". Whatever you write here takes precedence over the request.',
  '依頼文に具体的な指定はありませんでした。構成は調査で見つけた実例に寄せています。':
    'The request contained no explicit requirements. The layouts follow the real examples found during research.',
  '依頼文に無い値や、外してほしくない条件をここに書いてください。**依頼文より優先されます。**':
    'Write values the request does not contain, or constraints you do not want broken. This takes precedence over the request.',
  '依頼者の画面に「確認したいこと」として出ます。文面は必ず読んでから出してください。':
    'It appears on the requester\'s screen under "Something to confirm". Always read the wording before sending it.',
  '修正指示を見る・まとめて実行する →':
    'View fix instructions and run them together →',
  '先に構成の似ている実例を調べ、その型に沿って3案作ります。施主の指定があればそちらが優先されます。':
    'We first research real examples with a similar structure, then produce three designs following those patterns. Anything the client explicitly asked for takes precedence.',
  '公開はクライアントへの確認依頼を意味します。Phase 1 以降は、ここに':
    'Publishing means asking the client to confirm. From Phase 1 onward, this is where',
  '公開通知・確認リマインド・締切予告を送ります（11.1）':
    'Sends publish notices, confirmation reminders and deadline warnings (11.1)',
  '出した PR / コミットを見る':
    'View the pull request / commit',
  '参考イメージ → 仕様変更の候補':
    'Reference image → candidate for a spec change',
  '取り直す':
    'Re-extract',
  '取得できていません。サイト URL が正しいか、本番が公開されているか確認してください。取得できないままでも案は作れますが、色と書体は依頼された要素の値からしか推定できません。':
    'Not extracted. Check that the site URL is correct and that production is published. Designs can still be produced, but colours and typefaces can only be inferred from the reported element.',
  '変更あり':
    'Changed',
  '変更なし':
    'Unchanged',
  '変更履歴を見る →':
    'View change history →',
  '変種あり。差し替えは全変種が対象（9.10 手順1b）':
    'Has variants. Replacement covers every variant (9.10 step 1b)',
  '外すと PR を出すだけ。他人のリポジトリでは外したままにしてください':
    'Unchecked means we only open a pull request. Leave it unchecked for repositories you do not own',
  '外すと、締切・無償回数のカウント・確認のやりとりを行いません。依頼は貯まり続け、進捗は依頼ごとの状態で管理します。撮影・差分・素材差し替えはどちらでも動きます。':
    'Unchecked means no deadlines, no free-round counting and no confirmation exchange. Requests simply accumulate and progress is tracked per request. Capture, diffing and image replacement work either way.',
  '失効させる':
    'Revoke',
  '実寸で開く':
    'Open at actual size',
  '実行待ちの指示はありません。「未処理の依頼から指示を作る」を押してください。':
    'No instructions are waiting. Press "Draft instructions from open requests".',
  '対象は文言と文字の大小・太さ・行間・字間・色だけ。要素の増減・並べ替え・不具合は人が見ます。判断に迷った依頼も人に回します。':
    'Only wording and text size, weight, line height, letter spacing and colour. Adding or removing elements, reordering and defects are handled by a person, as is anything uncertain.',
  '対象は文言と文字の大小・太さ・行間・字間・色だけです。':
    'Only wording and text size, weight, line height, letter spacing and colour.',
  '当てられなかった理由は、材料が足りないことがほとんどです。対象がリポジトリに無い、値が依頼文に書かれていない、など。':
    'When it cannot be applied, the cause is almost always missing input: the target is not in the repository, the value is not in the request, and so on.',
  '持ち帰って提示する前に、必ず中身を確認してください。':
    'Always review the content before taking it to the client.',
  '指示を経由せず、その場で当てる（従来の動き）':
    'Apply on the spot without drafting instructions (the older behaviour)',
  '指示を読んで、必要なら直して、実行するものを選んでください。':
    'Read the instructions, edit them if needed, and choose which ones to run.',
  '撮影・差分・素材差し替えはこの設定に関係なく動きます。案件設定の「ラウンド制を使う」で切り替えられます。':
    'Capture, diffing and image replacement work regardless of this setting. Toggle it with "Use rounds" in the project settings.',
  '文言と文字まわりだけ。PR を出すところまで行います。':
    'Wording and typography only. It goes as far as opening a pull request.',
  '既定のブランチに直接コミットする（外すと PR を出すだけ。他人のリポジトリでは外したまま）':
    'Commit directly to the default branch (unchecked means we only open a pull request; leave it unchecked for repositories you do not own)',
  '最新':
    'Latest',
  '有償（カウント外）':
    'Billable (not counted)',
  '本番にスニペットが出ています。招待を送れます。':
    'The snippet is live. You can send invitations.',
  '本番サイトの CSS から抜いた配色・書体・余白です。参考デザインを作るとき、ここに載っている色と書体からしか選ばせません。':
    'Colours, typefaces and spacing extracted from the production CSS. When designs are produced, only the colours and typefaces listed here may be used.',
  '本番サイトを見て、済んでいる作業を判定します。残っているぶんだけを書いた指示文が出るので、そのままエンジニアに渡してください（AI コーディングエージェントに貼っても動く形にしてあります）。':
    'We look at the production site and work out what is already done. You get instructions covering only what is left, ready to hand to an engineer (they also work pasted into a coding agent).',
  '比較できるページがありません（両方のバージョンに同じページの撮影が必要です）':
    'There is no page to compare (both versions need a capture of the same page)',
  '決定的処理で LLM を使いません。ZDR の取得を待たずに使えます（9.10・13.3）':
    'Deterministic processing; no LLM involved. Usable without waiting for zero data retention (9.10, 13.3)',
  '独自ドメインへの切り替え期間は、旧・新の両方をここに入れておきます。入っていないオリジンからは依頼を送れません（ワイルドカードは使えません）。':
    'While switching to a custom domain, list both the old and the new origin here. Requests cannot be sent from an origin that is not listed (wildcards are not supported).',
  '登録済みのオリジンと違う場合、独自ドメインに切り替えた時点で依頼が送れなくなります。両方登録しておいてください。':
    'If this differs from the registered origin, requests will stop working the moment you switch to the custom domain. Register both.',
  '相手がそのまま読む文です。何を答えればよいかが一読で分かる形で書いてください。「情報が不足しています」ではなく「許可番号をお教えいただけますか」。':
    'The client reads this exactly as written. Make it obvious at a glance what they should answer: not "information is missing" but "could you tell us the licence number?".',
  '社内が直した':
    'Edited by staff',
  '社内の検討用です。サイトには何も適用されません。':
    'For internal review. Nothing is applied to the site.',
  '素材（差し替えたい）':
    'Material (to be used)',
  '見送る':
    'Skip',
  '詳細・参考デザイン →':
    'Details and reference designs →',
  '追加で許可するオリジン':
    'Additional allowed origins',
  '適用中のCSS（9.4・編集対象ではない）':
    'CSS currently applied (9.4; not an edit target)',

  // ── 差し込みのある文・断片・動的に渡すラベル
  ' ／ 反映のしかた: ':
    ' / How it lands: ',
  ' ／ 撮影 {n} 回のうち直近2回を表示':
    ' / showing the latest 2 of {n} captures',
  'PR {num} を開く':
    'Open pull request {num}',
  'PR を出します。1時間ごとに動きます。':
    'and opens a pull request. Runs hourly.',
  'data-nq-id も {n} 箇所入っています':
    'data-nq-id is present in {n} places too',
  '{ok}案できました（{ng}案は失敗: {why}）':
    '{ok} designs produced ({ng} failed: {why})',
  '{path} ／ {where}（ページの上から {percent}%）':
    '{path} / {where} ({percent}% down the page)',
  '{path} ／ {where}（上から {percent}%）':
    '{path} / {where} ({percent}% down)',
  '{w}px 幅で描画 ／ {scale}% 表示':
    'Rendered at {w}px wide / shown at {scale}%',
  '{w}px 幅のレイアウトマップで比較しています。':
    'Compared using the layout map captured at {w}px wide.',
  '{w}px幅で指摘':
    'reported at {w}px wide',
  '{yen}円':
    '¥{yen}',
  'アップロードに失敗しました（{status}）':
    'Upload failed ({status})',
  'エンジニアに渡す指示（残り {n} 件ぶん）':
    'Instructions for the engineer ({n} steps left)',
  'サーバーが応答しませんでした（{status}）':
    'The server did not respond ({status})',
  'デプロイ: {env} / {state}':
    'Deploy: {env} / {state}',
  'ページ全体 {docH}px 中 y={y}px':
    'y={y}px of {docH}px total page height',
  'ラウンド {seq}':
    'Round {seq}',
  'ラウンド {seq} 完了':
    'Round {seq} complete',
  '人が見るもの（{n}）':
    'For a person to look at ({n})',
  '依頼 #{seq}':
    'Request #{seq}',
  '入力 {input} / うちキャッシュから {cached} ・ 出力 {output} トークン ≒ ':
    'Input {input} ({cached} from cache) · output {output} tokens ≈ ',
  '公開: {at} ／ 自動確認まで あと {days} 日':
    'Published: {at} / {days} days until it auto-confirms',
  '反映済み（{n}）':
    'Applied ({n})',
  '取得: {at}。':
    'Extracted: {at}. ',
  '同一 nq-id が {n} 個（序数 {ordinal}）— ループ描画':
    '{n} elements share this nq-id (this is #{ordinal}) — loop-rendered',
  '回答がありました（{at}）':
    'Answered ({at})',
  '変更 {changed} / 追加 {added} / 削除 {removed}':
    '{changed} changed / {added} added / {removed} removed',
  '失敗しました（{status}）':
    'Failed ({status})',
  '差し戻し {n} 回':
    'Sent back {n} times',
  '応答が不正です（{status}）':
    'Malformed response ({status})',
  '意図しない変更が {n} 件あります':
    '{n} unintended changes',
  '持ち越しの依頼が {n} 件あります。ラウンドを開くと引き取ります。':
    '{n} requests were carried over. Opening a round takes them on.',
  '指摘時のビューポート {w}×{h} ／ スクロール位置 {y}px ／ ページ全体 {docH}px':
    'Viewport when reported {w}×{h} / scrolled to {y}px / page height {docH}px',
  '指摘箇所の切り出し（照合 {tier}）':
    'Crop of the reported spot (match: {tier})',
  '文字サイズ {sizes} ／ 余白 {spacings}':
    'Font sizes {sizes} / spacing {spacings}',
  '案{n}・{dir}':
    'Design {n} · {dir}',
  '確認できませんでした（{status}）':
    'Could not check ({status})',
  '締切: {at}（{reason}）':
    'Closed: {at} ({reason})',
  '要素の大きさ {w}×{h}px（左から {x}px・上から {y}px）':
    'Element size {w}×{h}px ({x}px from left, {y}px from top)',
  '調査結果を見る（参照 {n} 件）':
    'View the research ({n} sources)',
  '選んだ {n} 件をまとめて実行して PR を出す':
    'Run the {n} selected together and open a PR',
  '（data-nq-id も {n} 箇所）':
    '(and data-nq-id in {n} places)',
  '（{n}件）':
    '({n})',
  'この案件は':
    'This project is ',
  'です。締切・無償回数のカウント・確認のやりとりは行いません。依頼は下の一覧に貯まり続け、進捗は依頼ごとの状態で管理します。':
    '. There are no deadlines, no free-round counting and no confirmation exchange. Requests accumulate in the list below and progress is tracked per request.',
  'として出ます':
    'on their screen.',
  'として出ます。':
    ' on their screen.',
  '中身を確認してください':
    'Check the content.',
  '中身を確認してください。':
    'Check the content. ',
  '依頼者のパネルに':
    'It appears in the requester\'s panel as ',
  '全体撮影からピン座標で切り出したもの（7.1）。照合は':
    'Cropped from the full-page capture at the pin coordinates (7.1). Match tier:',
  '投げたときに、初めてコードが変わり PR が出ます。':
    ' — only then does any code change and a pull request appear.',
  '投げます。':
    '.',
  '選んだものを':
    'What you select is sent ',
  '構成: ':
    'Stack: ',
  '対象: ':
    'Target: ',
  '（7.4）。':
    ' (7.4).',
  '「全ジョブが終端」「差分に intended=false が無い」という条件が加わります（9.8）。':
    'the conditions "every job is terminal" and "no diff is marked intended=false" will also apply (9.8).',
  'リポジトリの HTML が名乗っているオリジン:':
    'Origin declared by the HTML in the repository:',
  'このアカウントは社内メンバーとして登録されていません':
    'This account is not registered as a staff member',
  'すべての項目を入力してください':
    'Please fill in every field',
  'そのスニペットキーは既に使われています':
    'That snippet key is already in use',
  'サイトURLは https://example.com の形式で入力してください':
    'Enter the site URL in the form https://example.com',
  'スニペットキーは英小文字・数字・ハイフンで指定してください':
    'The snippet key may contain only lowercase letters, digits and hyphens',
  'メールアドレスとパスワードを入力してください':
    'Enter your email address and password',
  'メールアドレスまたはパスワードが違います':
    'Wrong email address or password',
  'リポジトリは owner/name の形式で入力してください':
    'Enter the repository as owner/name',
  'リポジトリは owner/name の形式で指定してください':
    'Specify the repository as owner/name',
  '作成に失敗しました':
    'Could not create it',
  '取得できませんでした':
    'Could not fetch it',
  '案件が指定されていません':
    'No project was specified',
  '案件が見つかりません':
    'Project not found',
  '発行に失敗しました':
    'Could not issue it',
  '修正依頼':
    'Fix requests',
  '公開時':
    'At launch',
  '回答がありました':
    'Answered',
  '無償修正':
    'Free rounds',
  '調査結果を閉じる':
    'Hide the research',
  '未分類':
    'Unclassified',
  '軽微修正':
    'Minor fix',
  '仕様変更':
    'Spec change',
  '不具合':
    'Defect',
  '文言':
    'Wording',
  '素材':
    'Material',
  '色・余白':
    'Colour / spacing',
  '並び順':
    'Order',
  '受付済':
    'Received',
  '対応中':
    'In progress',
  '完了':
    'Done',
  '次回持ち越し':
    'Carried over',
  '受付中':
    'Open',
  '受付締切':
    'Closed to new requests',
  '修正中':
    'Being fixed',
  '公開済み・確認待ち':
    'Published, awaiting confirmation',
  '確認済み':
    'Confirmed',
  '自動確認':
    'Auto-confirmed',
  '手動':
    'Manual',
  '新規依頼なしで自動締切':
    'Auto-closed with no new requests',
  '件数上限に到達':
    'Item limit reached',
  '差し戻し':
    'Sent back',
  '位置不明':
    'Position unknown',
  'ページ上部':
    'Top of the page',
  'ページ上寄り':
    'Upper part of the page',
  'ページ中ほど':
    'Middle of the page',
  'ページ下寄り':
    'Lower part of the page',
  'ページ最下部':
    'Bottom of the page',
  'タブレット':
    'Tablet',
  'スマホ':
    'Phone',

  // ── サーバー側（結果・点検・導入手順・API のエラー）
  ' / {n}件は足りません':
    ' / {n} are missing material',
  '!important を新しく使っています。':
    'It introduces a new !important.',
  '# {name} のサイトを修正依頼ツールに繋ぐ':
    '# Connect {name}\'s site to the fix-request tool',
  '## すでに済んでいること（触らないでください）':
    '## Already done (please leave these alone)',
  '## やること':
    '## What to do',
  '## 崩してはいけないこと':
    '## Things that must not break',
  '## 終わったら':
    '## When you are done',
  '### {n}. GitHub App を入れる（5分・これだけで以降は不要になります）':
    '### {n}. Install the GitHub App (5 min — this alone makes the rest unnecessary)',
  '### {n}. data-nq-id を注入する（任意・30分・ビルド工程のあるサイト向け）':
    '### {n}. Inject data-nq-id (optional, 30 min, for sites with a build step)',
  '### {n}. スニペットを置く（必須・5分）':
    '### {n}. Add the snippet (required, 5 min)',
  '### {n}. ビルド SHA を埋める（任意・15分・ビルド工程のあるサイトだけ）':
    '### {n}. Embed the build SHA (optional, 15 min, only for sites with a build step)',
  '**GitHub App を入れていただければ、次のスニペットはこちらで入れます。** PR を1本お送りするので、中身を見てマージするだけです。エンジニアの作業はそこで終わります。':
    '**If you install the GitHub App, we will add the snippet ourselves.** We send one pull request; you read it and merge. That is where the engineering work ends.',
  '**ありません。** 4段階すべて済んでいます。':
    '**Nothing.** All four steps are done.',
  '**なぜあると良いか:** 依頼が「どのビルドに対して出されたか」が分からないと、直したあとに撮り比べても**直した結果なのか、その間に別の更新が入ったのか**が区別できません。':
    '**Why it helps:** without knowing which build a request was filed against, a before/after comparison cannot tell **your fix** from **some other change that landed in between**.',
  '**やらなくても動きます。** 依頼のピンは「ページのどの要素か」を覚えていますが、`data-nq-id` が無い場合は本文・画像の `src`・リンクの行き先・クラス込みの経路を組み合わせて特定します（実測で、注入なしのサイトでも当てられなかった要素は 0〜4%）。':
    '**It works without this.** A pin remembers which element on the page it points at; without `data-nq-id` we identify it from the text, the image `src`, the link target and a class-aware path (measured: 0–4% of elements went unmatched on sites with no injection).',
  '**入れると何が変わるか:** ソース上の位置から作った ID なので、見た目や並びを直しても変わりません。実測で段1 confirmed が 74% になります。文言を大きく書き換えたときや、同じ見た目の要素が並ぶページで効きます。**長く運用する案件だけ入れてください。**':
    '**What changes if you add it:** the ID comes from the position in the source, so it survives visual and ordering changes. Measured, tier-1 confirmed matches rise to 74%. It pays off when wording is rewritten heavily, or on pages full of identical-looking elements. **Only add it for projects you will maintain for a long time.**',
  '**同じ ID が複数の要素に付くのは仕様です。** ループで描画している要素には同じ ID が付きます。ツール側は「ID で絞る → テキストか画像の src で1つに決める」順で見ているので、重複自体は問題ありません。':
    '**The same ID appearing on several elements is by design.** Loop-rendered elements share one ID. The tool narrows by ID first, then settles on one element by text or image `src`, so duplicates are not a problem in themselves.',
  '**必須はスニペット1行だけ**です。それ以降は精度と自動化の話で、やらなくても運用は始められます。手が回らなければ途中で止めて構いません。止めた場合はどこまでやったかを共有してください。':
    '**Only the one-line snippet is required.** Everything after it is about accuracy and automation, and you can start operating without it. Stop partway if you run out of time — just tell us how far you got.',
  '**本番に常設して構いません。** 招待トークンを持たない訪問者には一切描画しません（DOM も作りません）。一般の訪問者にとっては JS が1本読まれるだけです。':
    '**It is safe to leave in production permanently.** Visitors without an invite token get nothing rendered at all (no DOM is created). For an ordinary visitor it is one extra script load.',
  '- リポジトリ: `{repo}`':
    '- Repository: `{repo}`',
  '- 対象サイト: {url}':
    '- Target site: {url}',
  '- 案件キー: `{key}`':
    '- Project key: `{key}`',
  '// nq-sha.mjs — build の前に走らせる':
    '// nq-sha.mjs — run this before the build',
  '1. **`<img>` の `src` 属性を消さないでください。** `srcset` だけにして `src` を落とすと画像の同定ができなくなります。ツール側は `currentSrc` ではなく `src` 属性を見ています（`currentSrc` はビューポートで変わるため、PC で出した依頼をスマホで見ると別の画像を指してしまいます）。':
    '1. **Do not remove the `src` attribute from `<img>`.** Dropping `src` in favour of `srcset` alone makes images impossible to identify. The tool reads the `src` attribute, not `currentSrc` (`currentSrc` changes with the viewport, so a request filed on desktop would point at a different image when viewed on a phone).',
  '10MB を超える画像は添付できません':
    'Images larger than 10 MB cannot be attached',
  '2. **オリジンを変えたら社内に伝えてください。** 独自ドメインを当てた、`www` の有無を変えた、ステージングを増やした。いずれも CORS の許可判定に直接効きます。現在の登録は `{url}` です。伝えないと依頼が送れなくなります。':
    '2. **Tell us if the origin changes.** Pointing a custom domain at it, adding or removing `www`, adding a staging host — each of these feeds directly into the CORS check. The registered origin is currently `{url}`. Without notice, requests stop going through.',
  '3. **Cookie を前提にしないでください。** ツールとの通信はクロスサイトで Cookie は載りません。認証は Authorization ヘッダで通しています。':
    '3. **Do not assume cookies.** Traffic to the tool is cross-site and cookies are not sent. Authentication goes through the Authorization header.',
  'ANTHROPIC_API_KEY が設定されていません':
    'ANTHROPIC_API_KEY is not set',
  'App を入れない場合は、下の作業を手で行ってください。':
    'If you do not install the App, do the steps below by hand.',
  'CSP を設定している場合は次を許可してください。':
    'If you have a CSP, allow the following.',
  'GitHub App が入っていません':
    'The GitHub App is not installed',
  'GitHub App の認証情報が設定されていません':
    'GitHub App credentials are not configured',
  'Vercel なら環境変数が来ているので、ビルド前のスクリプトで差し込むだけです。':
    'On Vercel the environment variable is already there, so a pre-build script is enough.',
  '`.gitignore` に `.nq/` を足してください。**対応表はコミットしないでください**（毎ビルドで差分ノイズが出ます）。':
    'Add `.nq/` to `.gitignore`. **Do not commit the mapping file** — it produces diff noise on every build.',
  '`</body>` の直前に次の1行を追加してください。':
    'Add the following line just before `</body>`.',
  '`<head>` に次の meta を置き、ビルド時に実際の commit SHA を埋めてください。':
    'Put this meta tag in `<head>` and fill in the real commit SHA at build time.',
  'data-nq-id を注入する':
    'Inject data-nq-id',
  'node tools/nq-inject/cli.mjs --root . --dry     # 何件付くか確認するだけ':
    'node tools/nq-inject/cli.mjs --root . --dry     # only report how many would be tagged',
  'node tools/nq-inject/cli.mjs --root . --out .nq # 実際に書き換える':
    'node tools/nq-inject/cli.mjs --root . --out .nq # actually rewrite',
  'projectId がありません':
    'projectId is missing',
  'style 属性を新しく足しています。':
    'It adds a new style attribute.',
  '{kind} は自動反映の対象外です':
    '{kind} is out of scope for automatic application',
  '{n} 箇所に入っています。':
    'Present in {n} places.',
  '{n}件は材料が揃っています':
    '{n} have everything they need',
  '{v1} を読めません':
    'Cannot read {v1}',
  '{v1}件の指示を作りました':
    'Drafted {v1} instructions',
  '{v1}件を反映して PR を出しました':
    'Applied {v1} and opened a pull request',
  '| Contents | Read and write | ブランチ作成・コミット |':
    '| Contents | Read and write | Create branches, commit |',
  '| Pull requests | Read and write | PR 作成 |':
    '| Pull requests | Read and write | Open pull requests |',
  '| 権限 | レベル | 用途 |':
    '| Permission | Level | Used for |',
  '「どのビルドに対する依頼か」が確定します。撮影と差分の判定に要ります。ビルド工程が無いサイトでは埋められないので、飛ばして構いません。':
    'It pins down which build a request was filed against. Capture and diffing need it. Sites without a build step cannot fill it in, so skip it there.',
  '【材料不足・要調査】':
    '[Missing material — needs investigation] ',
  'このリポジトリのサイトを、納品後の修正依頼ツール（Nortiq Revise）に対応させてください。クライアントが本番サイト上で直接クリックして修正依頼を出せるようになります。':
    'Please make the site in this repository work with our post-delivery fix-request tool (Nortiq Revise). It lets the client file fix requests by clicking directly on the production site.',
  'これが済んでいれば、次のスニペットはこちらから入れられます。エンジニアの作業はここで終わります。':
    'Once this is done we can add the snippet ourselves. The engineering work ends here.',
  'これが無いとクライアントは依頼を出せません。必須はここだけで、以降は精度の話です。':
    'Without this the client cannot file anything. This is the only required step; the rest is about accuracy.',
  'すべて指示が作られています':
    'Instructions already exist for all of them',
  'なし':
    'none',
  'アップロード先の発行に失敗しました':
    'Could not issue an upload destination',
  'インストール後、**リポジトリのオーナー名とリポジトリ名を社内に伝えてください。**':
    'After installing, **tell us the repository owner and repository name.**',
  'スクリプト・画像・フォームを足しています。自動反映の対象外です。':
    'It adds a script, image or form. Out of scope for automatic application.',
  'スニペットを置く':
    'Add the snippet',
  'ソースファイルではありません: {file}':
    'Not a source file: {file}',
  'タグが減っています。要素の削除は自動反映の対象外です。':
    'Tags were removed. Deleting elements is out of scope for automatic application.',
  'デバウンス中（あと {v1} 分）':
    'Debouncing ({v1} min left)',
  'パスが不正です':
    'Invalid path',
  'ビルド SHA を埋める':
    'Embed the build SHA',
  'ビルドの無いサイト（手書き HTML）の場合は、デプロイのワークフローに1ステップとして足してください。':
    'For sites with no build (hand-written HTML), add it as one step in the deploy workflow.',
  'リクエストが不正です':
    'Malformed request',
  'リポジトリが設定されていません':
    'No repository is configured',
  '不明':
    'unknown',
  '依頼が見つかりません':
    'Request not found',
  '分類に失敗: {v1}':
    'Classification failed: {v1}',
  '分類の自信が {v1} のため人の確認に回します（{v2}）':
    'Classification confidence is {v1}, so this goes to a person ({v2})',
  '対象の依頼がありません':
    'No requests to work on',
  '対象を指す手がかりがありません（nq-id もテキストも取れていない）。サイトに data-nq-id を注入すると確実になります。':
    'There is nothing to identify the target by (neither an nq-id nor any text was captured). Injecting data-nq-id into the site makes this reliable.',
  '対象（{key}）が、渡すファイルの中に見つかりません。リポジトリに無いか、ビルド後に生成される要素の可能性があります。探した範囲: {where}':
    'The target ({key}) is not in the files we send. It may not be in the repository, or it may be generated after the build. Searched: {where}',
  '当てられる書き換えはありませんでした':
    'No edits could be applied',
  '必要な権限は2つだけです。':
    'Only two permissions are needed.',
  '必要な項目がありません':
    'Required fields are missing',
  '指示が見つかりません':
    'Instructions not found',
  '指示が選ばれていません':
    'No instructions were selected',
  '指示を作れませんでした: {v1}':
    'Could not draft the instructions: {v1}',
  '文字以外の要素を足しています（{tags}）。自動反映の対象外です。':
    'It adds non-text elements ({tags}). Out of scope for automatic application.',
  '書き換えが {v1} 件です':
    '{v1} edits',
  '書き換えが {v1} 件です。1〜6件にしてください':
    '{v1} edits. Keep it between 1 and 6.',
  '書き換えが返ってきませんでした':
    'No edits came back',
  '書き換えを作れませんでした':
    'Could not produce the edits',
  '書き換えを作れませんでした: {v1}':
    'Could not produce the edits: {v1}',
  '書き換え後が元の3倍を超えています。最小の変更になっていません。':
    'The result is more than 3× the original. This is not a minimal change.',
  '書き込むのはスニペット1行と、依頼のあった画像だけです。次は触りません。':
    'We only write the one-line snippet and any images that were requested. Nothing else is touched.',
  '未設定':
    'not set',
  '材料が揃っている指示がありませんでした':
    'No instruction had everything it needed',
  '材料が足りません: {why}':
    'Missing material: {why}',
  '材料は揃っています（{files}）':
    'Everything is there ({files})',
  '権限がありません':
    'Not authorised',
  '添付の登録に失敗しました':
    'Could not register the attachment',
  '無くても動きます（実測で段3 weak は 0〜4%）。入れると段1 confirmed が 74% になり、ページを直しても依頼のピンが同じ要素に付き続けます。ビルド工程のあるサイト向けです。':
    'It works without this (measured: 0–4% land on the weak tier-3 match). With it, tier-1 confirmed matches reach 74% and a pin keeps pointing at the same element even after the page is edited. For sites with a build step.',
  '現在: {sha}':
    'Currently: {sha}',
  '画像ファイルだけ添付できます':
    'Only image files can be attached',
  '社内から `tools/nq-inject/` 一式を受け取り、リポジトリ直下に置いてください。':
    'Get the `tools/nq-inject/` set from us and place it at the repository root.',
  '社内が用意した GitHub App を対象リポジトリにインストールしてください。入れていただくと、下の「スニペットを置く」をこちらで行い、**PR としてお送りします**。自動マージはしません。例外なくです。本番に出るには必ず人間がマージする必要があります。クライアントが画像の差し替えを依頼したときも、同じく PR でお送りします。':
    'Install our GitHub App on the target repository. Once it is in, we do the "Add the snippet" step below and **send it as a pull request**. We never auto-merge — no exceptions. A human must merge for anything to reach production. When the client asks for an image to be replaced, that also arrives as a pull request.',
  '社内に「どこまでやったか」を伝えてください。社内側で招待リンクを発行して動作を確認します。':
    'Tell us how far you got. We will issue an invite link and verify it works.',
  '禁止: package.json  各種ロックファイル  .github/  .env*  *.config.*  tsconfig*.json':
    'Never written: package.json  lock files  .github/  .env*  *.config.*  tsconfig*.json',
  '禁止パスです: {file}':
    'Forbidden path: {file}',
  '結果が返りませんでした':
    'No result came back',
  '繰り返し描画されている要素ですが、何番目かが記録されていません。どのデータを直すか決められません。':
    'This element is loop-rendered but its ordinal was not recorded, so there is no way to tell which data entry to change.',
  '自動で当てられる依頼はありませんでした':
    'No request could be applied automatically',
  '自動反映は無効です':
    'Automatic application is off',
  '要素を {n} 個足しています。一行の注記の範囲を超えています。':
    'It adds {n} elements — beyond what a one-line note should need.',
  '該当箇所をリポジトリで特定できませんでした':
    'Could not locate the target in the repository',
  '認証情報が設定されていません':
    'Credentials are not configured',
  '足している量が多すぎます。一行の注記の範囲を超えています。':
    'Too much is being added — beyond what a one-line note should need.',
  '（未設定）':
    '(not set)',
  '（画像差し替えも有効）':
    ' (image replacement is on too)',
};
