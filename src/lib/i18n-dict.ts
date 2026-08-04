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
};
