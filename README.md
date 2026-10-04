# 酒カス (sakekasu-builder.com)

日本酒・ウイスキー・焼酎など、「何を飲んだか」「何を買ったか」を忘れがちな酒飲みのための記録・管理 Web アプリ。

## 機能

ここに載っているものはすべて実装済み。これから作るものは [GitHub Issue](https://github.com/yuuuuuuu168/sakekasu-builder/issues) で管理している。

### 記録する

| 機能 | 補足 |
|------|------|
| 購入したお酒の登録 | 本数（`quantity`）入力に対応 |
| 飲んだお酒の登録 | 評価（★1〜5）・飲み方・感想メモ |
| 記録の編集・削除 | 編集では画像を足せる。差し替えと削除はできず、代表画像は既存のものを保つ |
| 画像添付 | ラベル写真等。複数枚に対応 |
| 飲みきりステータス管理 | 未開封 / 飲み中 / 飲みきり。まとめ買いは1本ずつ飲みきれる |
| 開封後経過日数の表示 | 飲み中のカードに「開封から◯日」を出す |
| 購入記録からの飲酒登録連携 | 「これを飲む」で在庫と飲酒記録が紐づく |
| 詳細スペックの記録 | 蔵元・産地・度数・容量・精米歩合・日本酒度・酸度・アミノ酸度・酒米・酵母・特定名称・紹介文。全項目任意で、フォームでは折りたたみ（[#87](https://github.com/yuuuuuuu168/sakekasu-builder/issues/87)） |

### 見つける・振り返る

| 機能 | 補足 |
|------|------|
| 購入・飲酒記録の一覧表示 | |
| 検索・フィルタ | キーワード横断検索（蔵元・産地・酒米・酵母も対象）・評価フィルタ・価格帯フィルタ・日付範囲フィルタ・条件の保持・表記ゆれ吸収 |
| 在庫本数サマリー | 一覧上部にウイスキー・日本酒の在庫本数を表示 |
| 統計ダッシュボード | 月別飲酒量・カテゴリ別支出・お気に入り TOP。記録数が少なく実データでの表示確認は未実施 |
| カレンダー表示 | 飲んだ日・買った日をドットで可視化（[#46](https://github.com/yuuuuuuu168/sakekasu-builder/issues/46)） |
| リピート判定リマインド | 購入時に同じ銘柄の過去評価を出す |

### AI

| 機能 | 補足 |
|------|------|
| ラベル画像の OCR | 銘柄名・カテゴリに加え、裏ラベルの詳細スペック12項目を抽出。項目ごとの確信度つきで、低確信の項目は入力欄に「要確認」を出す（[#88](https://github.com/yuuuuuuu168/sakekasu-builder/issues/88)）。既存の記録は一覧から、付いている写真をまとめて読み取れる |
| テイスティングノートの自動記載 | 購入登録の時点で備考に書き足す。ウイスキーは飲み方も。知らない銘柄は Tavily で調べてから書く。既存の記録は一覧から一括で追記できる |
| 写真1枚で購入登録 | 画像を選ぶと自動で OCR が走る。価格・店名は手入力（[#49](https://github.com/yuuuuuuu168/sakekasu-builder/issues/49)） |
| ソムリエ相談 | 在庫相談・ペアリング・銘柄レコメンド・酒知識 Q&A（[#51](https://github.com/yuuuuuuu168/sakekasu-builder/issues/51)） |
| ソムリエへの写真添付 | 店の棚や品書きの写真から、好みに合う1〜3本を選んでもらう（[#44](https://github.com/yuuuuuuu168/sakekasu-builder/issues/44)） |
| 好み学習 | AgentCore Memory。セッションをまたいで好みが育つ |
| 会話の記憶 | AgentCore Memory。履歴はサーバー側に持ち、クライアントからは送らない（[#93](https://github.com/yuuuuuuu168/sakekasu-builder/issues/93)） |
| ソムリエの Web 検索 | 新酒の発売・蔵元・相場など記録の外の話は Tavily で調べて出典つきで答える（[#122](https://github.com/yuuuuuuu168/sakekasu-builder/issues/122)） |

### アカウント・セキュリティ

| 機能 | 補足 |
|------|------|
| 共通ログイン | 4 アプリで共有する Cognito のマネージドログインへリダイレクト（Authorization code + PKCE）。ユーザーは管理者が共通ログイン側で作る。手順と経緯は [docs/shared-login.md](docs/shared-login.md) |
| MFA（TOTP） | 必須。登録も入力も共通ログインの画面で行う |
| データ保護 | DynamoDB の PITR・削除保護、S3 バージョニング |

### 運用・基盤

| 機能 | 補足 |
|------|------|
| 監視とアラート通知 | 25アラーム（AI・サービス正常性・外形監視・カナリア・SLO）を Slack へ。AWS Health の通知は共通基盤へ移した。デプロイ前に手動登録あり。ソムリエのカナリアは共通ログインへの移行で止めてある（[docs/shared-login.md](docs/shared-login.md)） |
| 新規ユーザー登録の Slack 通知 | 旧ユーザープールの Post Confirmation → SNS（[#66](https://github.com/yuuuuuuu168/sakekasu-builder/issues/66)）。共通ログインにはセルフサインアップが無いので役目を終え、旧プールを外すときに一緒に外す |
| 毎日の AWS 利用料金 Slack 通知 | 組織合計・上位サービス内訳・クレジット込み。管理アカウントへデプロイ（[#92](https://github.com/yuuuuuuu168/sakekasu-builder/issues/92)） |
| DevOps Agent による自動インシデント調査 | アラーム → 調査 → 専用 Slack チャンネル。プライベートチャンネルではメンションで調査の開始や照会もできる。コンソール側の設定あり（[#67](https://github.com/yuuuuuuu168/sakekasu-builder/issues/67)） |
| Application Signals による APM | OCR と画像アップロードの2関数を計装。OCR には SLO を2本置き、割ったらアラーム（[#86](https://github.com/yuuuuuuu168/sakekasu-builder/issues/86)） |
| CDK デプロイの自動化 | main へのマージで GitHub Actions が `cdk deploy`（OIDC 認証、[#94](https://github.com/yuuuuuuu168/sakekasu-builder/issues/94)）。infra とソムリエで対象を分ける。cdkd への移行が進行中（[#150](https://github.com/yuuuuuuu168/sakekasu-builder/issues/150)） |
| 一覧画面の画像表示高速化 | サムネイル生成・Presigned URL キャッシュ・遅延読み込み |
| PR ごとのテスト・lint・型検査 | GitHub Actions がフロント・infra・ソムリエの3系統を並べて走らせる |

## こだわりポイント

### 検索・フィルタ強化

記録が増えても目当ての1本に辿り着けるよう、一覧の絞り込みを広げた。バックエンドの変更はなく、フロントのみで完結する。

- **キーワード横断検索**: 酒名だけでなく、店名・場所名・飲み方・メモも検索対象にした。酒名は従来どおり曖昧検索（各文字が順番に出現すればヒット）で、うろ覚えや部分入力から辿れる。それ以外の項目は部分一致にしている。メモまで曖昧検索にすると、離れた位置の文字が拾われて無関係な記録が大量に混ざるため
- **表記ゆれの吸収**: 「アラン」「あらん」「ｱﾗﾝ」「Allan」「Arran」のどれで打っても同じ記録に辿り着く（詳細は下記）
- **評価フィルタ**: 「★4以上」のように星数のしきい値で絞る。評価を持つのは飲酒記録だけなので、選ぶと記録種別も自動で飲酒記録に切り替わる（飲みきりステータスを選ぶと購入記録に切り替わるのと同じ挙動）
- **価格帯フィルタ**: 「1,000円未満」「10,000円以上」など5つの帯で絞る（[#47](https://github.com/yuuuuuuu168/sakekasu-builder/issues/47)）。帯どうしは重ならず隙間もない（`min` 以上 `max` 未満）ので、どの金額もちょうど1つの帯に入る。価格が未入力の記録は、価格帯を選んだ時点で外す。金額の分からない記録が「3,000円以上」に混ざると絞り込んだ意味が無くなるため
- **日付範囲フィルタ**: 今月・直近3ヶ月・今年・カスタム範囲（[#47](https://github.com/yuuuuuuu168/sakekasu-builder/issues/47)）。カスタム範囲は片側だけの指定も許して「この日以降すべて」を出せるようにし、開始日に `max`・終了日に `min` を渡して逆転した範囲を選べないようにしてある
  - 「今月」「今年」は暦の区間なので月末・年末までを含み、「直近3ヶ月」は今日から遡る区間なので上限が今日になる。先の日付を入れた記録の見え方が変わるが、どちらもラベルの読みどおりなので揃えていない
  - 基準日（今日）は `filterRecords` の引数にしてあり、テストからは固定日を渡す。3ヶ月前に同じ日が無い場合（5/31 → 2/28）は月末に丸める。`new Date(2026, 1, 31)` は 3/3 へ繰り上がってしまうため
- **価格帯・日付範囲では記録種別を切り替えない**: どちらも購入記録・飲酒記録の両方が持つ項目なので、評価や飲みきりステータスのような自動切り替えはしない
- **詳細フィルタは畳んでおく**: 条件が7つに増えて一覧の上が埋まったため、常時出すのは記録を探すときにまず触る4つ（キーワード検索・記録種別・カテゴリ・並び替え）だけにし、残り（飲みきり・評価・価格帯・日付）は「詳細」ボタンの中へ入れた
  - 畳んだまま条件が効いていると、記録が出ない理由が分からなくなる。効いている数をボタンのバッジに出し、0 でなければ**開いた状態で始める**。条件の保持で復元したときや、タブを移って戻ったときに効く
  - 開くかどうかは初期値だけで決めて、`useEffect` では開き直さない。効いている間ずっと開きっぱなしになり、条件を残したまま畳む操作ができなくなるため
  - 畳む対象と数え方は `lib/advancedFilters.ts` の `ADVANCED_FILTER_KEYS` 1か所で決めている。片方だけ足すと、隠れているのにバッジに出ない条件ができる
- **絞り込み条件の保持**: 選んだ条件を localStorage に保存し、タブを移動して戻っても復元する。記録一覧はタブ切り替えでアンマウントされるため、以前は毎回絞り込み直しだった
  - 保存先は**ユーザーごとに分ける**（`sakekasu:record-filters:<userId>`）。検索語には銘柄名が残るため、サインアウト時にはソムリエの相談履歴と同じく削除する
  - 選択肢に無い値が保存されていた場合は、項目ごとに既定値へ落として復元する

実装は `src/features/records/hooks/useRecordFilter.ts`（判定ロジック）、`lib/dateRange.ts`（日付範囲の解決）、`lib/advancedFilters.ts`（詳細フィルタの範囲）、`lib/filterStorage.ts`（保存・復元）。条件が5つに増えた時点で、`filterRecords` の引数は位置引数から `RecordFilters` オブジェクトに変えてある。

保存値の検証は項目ごとに違う。選択肢のある条件は選択肢に無ければ既定値へ落とすが、カスタム範囲の日付は選択肢が無いので `YYYY-MM-DD` の形と実在する日付かで見る（`2026-02-31` は弾く）。壊れているのが片側だけなら、その側だけ「指定なし」にして日付範囲の選択自体は残す。価格帯と日付範囲は、知らない値が来ても絞り込まない側に倒してある。記録種別やカテゴリと違い、壊れた保存値で一覧が空になることはない。

#### 表記ゆれの吸収

同じ銘柄でもカタカナで書いたり英字で書いたりするため、**見た目を揃えた比較**と**音に変換した比較**の2段で突き合わせる（`lib/searchNormalize.ts`）。

```
「アラン」 → ローマ字化 → aran
「Allan」  → 重複子音を畳む → alan → l と r を同一視 → aran
「Arran」  → rr を畳む → aran
```

| 揺れの種類 | 例 | 対応 |
|-----------|----|----|
| ひらがな / カタカナ / 半角カナ | あらん・アラン・ｱﾗﾝ | NFKC 正規化＋かな統一 |
| 全角 / 半角、大文字 / 小文字 | ＡＲＲＡＮ・arran | NFKC 正規化 |
| カナ / アルファベット | アラン・Allan・Arran | ローマ字に変換して比較 |
| l と r、b と v、重複子音、長音 | Allan / Arran、ヴォッカ / ボッカ | 同一視して畳む |

**対応しないもの**: 漢字と読みの対応（獺祭 / だっさい。読みの辞書が必要）、音そのものがずれる借用語（ビール / Beer）。

音による比較は**部分一致に留めている**。ここに曖昧検索を掛けると、母音を落とした短いキー同士が偶然一致して無関係な記録が混ざるため。実際に「母音を落として子音の骨組みで比較する」案も試したが、「カク」と「コク」、「アサヒ」と「アシ」が衝突したため採用しなかった。

### 在庫本数サマリーと在庫連携

記録一覧の上部に在庫本数を表示し、そこから飲酒記録を登録して「これ飲んでどうだったか」を購入記録側から引けるようにした。

#### 在庫本数サマリー

- 対象は**ウイスキーと日本酒のみ**。カテゴリごとに本数を出し、飲み中があれば内訳も添える
- 「在庫あり」は**未開封 + 飲み中**（飲みきりは除外）。数えるのは記録ごとの残本数
- フィルタに関係なく全体の在庫を出す。削除やステータス変更をすると即座に追従する（楽観的更新を `useRecordList` 側に集約した）
- 対象カテゴリの在庫が0のときはサマリー自体を表示しない

#### まとめ買いを1本ずつ飲みきる

本数2以上の購入記録は、1本飲んでも残りが在庫に残る（[#159](https://github.com/yuuuuuuu168/sakekasu-builder/issues/159)）。

- 購入記録に**残本数**（`remainingQuantity`）を持たせ、飲みきり操作のたびに減らす。0本になったときにはじめて記録が「飲みきり」になる
- ステータスは残っているうちの**先頭の1本**にかかる。本数3・残り3で飲み中なら「飲み中1本 / 未開封2本」
- 残り2本以上の記録を飲みきるときは、何本ぶんかをダイアログで聞く（箱ごと飲みきったときのため）
- 「飲みきり → 未開封」に戻すと購入本数まで在庫が戻る
- 残本数を持たない既存の記録は、飲みきりなら0本、それ以外は `quantity`（未設定は1本）が残っているものとして扱う
- 編集画面で本数を書き換えたときは、飲んだ本数を保ったまま残本数を合わせる（3本のうち1本飲んだ記録を5本に直せば残り4本）

#### 在庫と飲酒記録の紐づけ

購入記録カードの「🍶 これを飲む」から飲酒登録へ進み、飲んだ記録が購入記録にぶら下がる。

- `DrinkingRecord` に `purchaseRecordId` を追加（手入力の記録では null）
- 飲酒登録フォームには銘柄名・カテゴリが引き継がれ、飲んだ場所は「自宅」を既定にする
- 登録時、購入記録が**未開封なら自動で「飲み中」**にして開封日時も記録する（飲み中・飲みきりは変更しない）。まとめ買いでも開くのは1本だけで、残りは未開封のまま在庫に残る
- 購入記録カードに、紐づいた飲酒記録の**件数・平均評価・最新メモ**を表示する
- フォーム上部のバナーから紐づけを解除できる。解除しても入力内容は消えない

### テイスティングノートの自動記載

「この酒がどんな味だったか」を後から思い出せるように、購入登録の時点で備考へ書き足す。対象は**ウイスキーと日本酒だけ**で、ウイスキーにはおすすめの飲み方も付ける。ビール・ワイン・焼酎・その他には何も書かない。

```
テイスティングノート: バニラと蜂蜜の甘い香り。余韻は長く、かすかにスモーキー
おすすめの飲み方: ストレートかトワイスアップで香りを開かせるのがおすすめ
```

- **走るのは登録ボタンを押した時点**。画像を選んだ時点ではない。銘柄名は OCR のあとに手で直されることがあり、画像側に紐づけると直す前の名前でノートを書いてしまう
- **知らない銘柄には何も書かない**。モデルにはまず「知っているか」を答えさせ（`isKnown`）、知らなければ全項目 null で返す。それらしい文章が備考に残ると、後から見て本当にその酒の話なのか判断できなくなる
- **知らない銘柄は Web で調べてから書く**。学習知識だけでは日本酒がほとんど書けなかったため（下の実測を参照）、書けなかったときだけ Tavily で検索し、その結果を根拠にもう一度書かせる。有名な銘柄は1回目で終わるので、検索の費用と待ち時間を全件には払わない
- **同じ失敗を繰り返さない**。書けなかった記録は端末に控えて一括追記の対象から外す。生成は temperature 0 なので、同じ銘柄名を投げれば答えも同じになる。控えるのは記録IDと銘柄名の組みなので、銘柄名を直せば（OCR の読み取りミスを直したときなど）自動でまた対象に入る
- **できることが無ければ案内を出さない**。追記が済んだ記録も、調べても書けなかった記録も対象から外れる。押しても何も起きないバナーは画面に残さない
- **失敗しても登録は止めない**。ノートが取れなければ備考は元のまま保存される。付随情報のために記録そのものを落とさない
- **同じ行を積み上げない**。備考の行頭が `テイスティングノート:` なら記載済みとして扱い、再編集・再保存でも書き足さない
- **一覧では2行で切る**。備考はカードに出すが、ノートが入ると複数行になるので、長いものは2行で切ってクリックで全文に広げる。一覧の見通しを保ったまま、その場で読める
- **既存の記録は一覧から一括で追記**。ノート未記載のウイスキー・日本酒があれば一覧上部に件数が出て、そこから追記できる。1件ずつ直列に処理するので、Bedrock を呼ぶ Lambda の予約枠を一人で使い切らない

生成は AppSync の `generateTastingNote` ミューテーション（Lambda `tasting-note`）が受ける。カテゴリの判定は画面側だけでなく Lambda 側でも行い、対象外のカテゴリでは Bedrock を呼ばずに落とす。呼び出し1回が課金につながるため、API を直接叩かれたときの歯止めをサーバー側にも置いている。

#### 学習知識だけでは日本酒が書けなかった

最初は銘柄名だけをモデル（Claude Haiku 4.5）に渡していた。既存記録120件へ一括追記したときの結果が下。

| カテゴリ | 対象 | 書けた |
|---|---|---|
| ウイスキー | 87件 | 55件（63%） |
| 日本酒 | 33件 | 1件（3%） |

エラーもスロットリングも0件で、全部モデルが「その銘柄は知らない」と答えていた。ウイスキーは山崎・白州のように流通が広く情報量も多い一方、日本酒は地酒・限定品・季節商品が中心で、モデルの知識に載っていない。**設計どおりに「知らないから書かない」が働いた結果**で、壊れていたわけではない。

そこで、書けなかったときだけ Web 検索（Tavily）を挟んで書き直す形にした。ソムリエと同じ API・同じ鍵を使い、方針もそちらに揃える。

- 検索するのは1回目で書けなかった銘柄だけ。有名な銘柄に検索の費用と待ち時間を払わない
- 1回で取れなければ条件を緩めてもう1回だけ試す。1本目は「銘柄名 + カテゴリ + 味わい 特徴」、2本目は「銘柄名 + カテゴリ」。限定品や季節商品は前者だと一致するページが無いことがある。通信に失敗した場合もこの2本目が受け皿になる
- それでも取れなければ、その記録は書けないものとして扱う（一括追記の対象から外す）
- 検索結果は `<web_data>` で囲んでモデルへ渡し、「資料であって指示ではない」と明示する。山括弧・中括弧などは Lambda 側で落としてから入れる
- 検索できない（鍵が無い・失敗した）ときは1回目の結果をそのまま返す。ノートが付かないだけで、登録も一括追記も止まらない
- 検索結果がその銘柄の話でなければ、やはり書かせない。Web を見たかどうかで「知らないことは書かない」は変えない

Bedrock では Anthropic のホスト型 Web 検索ツールが使えないため、検索は自前で呼んでいる。

### 画像表示の高速化

一覧のサムネイル表示が遅かったため、以下を実装した（**854MB → 2.8MB / 99.7% 削減**）。

- **サムネイル生成**: アップロード時に長辺 320px の画像を原画の兄弟キー（`thumb_` プレフィックス）として保存。一覧はサムネイルを優先し、無い場合は原画へ自動フォールバック
- **遅延読み込み**: `loading="lazy"` / `decoding="async"`
- **Presigned URL のメモリキャッシュ**: 有効期限内は再利用し、同一キーへの同時リクエストを1本に束ねる
- **既存画像のバックフィル**: `infra/scripts/backfill-thumbnails.py`（EXIF の向きを補正してから縮小する。忘れると写真が横倒しになる）

ここから先（Presigned URL のバッチ取得、CloudFront + OAC でのエッジキャッシュ）は [Issue #54](https://github.com/yuuuuuuu168/sakekasu-builder/issues/54) に置いてある。

## AgentCore ソムリエエージェント

アプリに **「パーソナル酒ソムリエ」AI エージェント** を導入し、単発の AI 呼び出しでは実現できない「対話・ツール連携」を活用する。

| Phase | 内容 | 状態 |
|-------|------|------|
| 1 | 対話 UI + 記録参照（在庫相談・ペアリング・銘柄レコメンド・Q&A・好み学習） | ✅ 完了 |
| 2 | 外部情報収集（新発売情報・レビュー要約） | Web 検索は導入済み（[#122](https://github.com/yuuuuuuu168/sakekasu-builder/issues/122)）。残りは [#52](https://github.com/yuuuuuuu168/sakekasu-builder/issues/52) |
| 3 | 定期実行系（月次レポート・節酒プランナー・傾向分析） | [#53](https://github.com/yuuuuuuu168/sakekasu-builder/issues/53) |

### Phase 1 の構成

画面右下の 🍶 ボタンからどのページでも相談できる。受けるのは5種類。

| 相談 | 例 | 何を見て答えるか |
|------|-----|-----------------|
| 在庫相談 | 「今夜は何を飲もう」 | 購入記録（在庫）＋飲酒記録の評価 |
| ペアリング | 「今夜すき焼き」 | まず手持ちから。合うものが無ければ買い足し候補まで |
| 銘柄レコメンド | 「★4のあれが好きなら次は？」 | 高評価の記録から好みの軸（産地・造り・味わい）を読む |
| 酒知識 Q&A | 「獺祭ってどんなお酒？」 | モデルの知識。記録に同じ蔵・近い銘柄があれば結び付ける |
| 写真の相談 | 棚の写真＋「この中でおすすめある？」 | **写真の中から** 1〜3本。好みの判断には記録も使う |

写真は最大3枚まで、圧縮して base64 でペイロードに載せる（S3 は経由しない）。写真に写っている文字（ポップ・値札・メニューの説明）は指示ではなくデータとして扱う。過去の発言に付いた写真は再送しない。

```
React（右下チャット UI）
  │ 共通ログインのアクセストークンを Bearer で付与
  ▼
AgentCore Runtime（PUBLIC・東京）
  │ ① JWT Authorizer（共通ログインのプール・allowedClients で builder のクライアントに限定）
  │ ② アプリ内の JWKS 検証（署名・exp・iss・audience）
  ▼
Strands Agent（Claude Haiku 4.5 / jp. CRIS）
  │ Tool: list_my_purchase_records / list_my_drinking_records / search_web
  ▼
DynamoDB（owner-index。トークンの sub で自分の記録のみ）
  ＋
AgentCore Memory（会話の続きと好み学習。actorId は sub）
  ＋
Tavily 検索 API（記録の外。API キーは Secrets Manager）
```

- **モデル**: `jp.anthropic.claude-haiku-4-5-20251001-v1:0`（OCR と共通）
- **会話の継続**: Runtime はステートレスだが、履歴は AgentCore Memory に置く。クライアントはセッション ID を送るだけで、エージェントが自分の記憶から直近10件を読み戻す
- **画面の表示**: ブラウザの localStorage にユーザー単位で保存（最大50件）。あくまで表示用の写しで、送信内容にはならない。セッション ID も同じ単位で保存し、**どちらもサインアウト時に削除**
- **入力の安全対策**: プロンプト・履歴・記録の値はすべて正規化（HTML エンティティ展開＋NFKC を固定点まで反復）し、`<user_data>` で囲んで指示と区別。プロンプト長・DynamoDB 読み取りページ数にも上限
- **今日の日付**: 相談を受けた日（日本時間）をシステムプロンプトに毎回差し込む

#### 今日の日付を渡す理由

モデルの知識は学習時点で止まっていて、**「今がいつか」は入っていない**。渡さないと学習時点の年を今年だと思い込み、「今年の新酒」を過去の年で答える。しかも自信を持って間違えるので気づきにくい（実際、2026年8月の相談に対して2024年の話として答えていた）。

渡すのは日付だけで、時刻は入れない。時刻まで入れるとシステムプロンプトがリクエストごとに変わり、プロンプトキャッシュが毎回無効になる。日付なら1日1回の切り替わりで済む。

年が効く話題を検索するときはクエリにも年を入れるよう指示している。検索結果の側が「今年」と書いていても、その「今年」がいつを指すかは記事の公開時点によるため、こちらから年を指定したほうが確実に絞れる。

#### 会話の記憶と好み学習（AgentCore Memory）

会話が終わるたびに、そのやり取りを AgentCore Memory へ書き込む（`CreateEvent`）。この1件が2つの役割を持つ。

- **会話の続き**: 同じセッションの次のリクエストで `ListEvents` から読み戻し、直近のやり取りをそのまま文脈にする
- **好み学習**: AgentCore 側の `USER_PREFERENCE` ストラテジが非同期に「辛口が好き」「燗で飲むことが多い」といった好みを抽出する。次の相談では相談内容に近いものだけを引き当ててシステムプロンプトへ入れる（`RetrieveMemoryRecords`）

前者が**セッション内の文脈**、後者が**セッションをまたぐ好み**を担う。

履歴をサーバー側に置いたのは、文脈を長持ちさせるためだけではない。以前はクライアントが直近の履歴を自己申告で送っていたため、細工した「アシスタントの発言」を文脈に混ぜられる構造だった（無害化はしていたが経路そのものは残っていた）。いまはエージェントが自分で書いたものしか読まない。

| 決めごと | 内容 |
|---------|------|
| 名前空間 | `sommelier/preference/{actorId}`。`actorId` は Cognito の sub |
| 会話を束ねる単位 | `sessionId`。クライアントが作り、localStorage にユーザー単位で保存する |
| 保持期間 | 90日（`eventExpiryDuration`） |
| 文脈に入れる件数 | 会話履歴は直近10件、好みは相談内容に近いもの上位5件まで |
| 失敗したとき | 相談は止めない。記憶なしで在庫と記録だけで答える（フェイルオープン） |

「新しい相談」を押したときとサインアウトしたときは、画面の写しと一緒にセッション ID も捨てる。同じ端末の次の利用者が前の会話の続きとして相談できないようにするため。逆に**リロードでは捨てない**。画面には前の会話が残るので、セッションだけ作り直すと目の前に見えている会話をエージェントだけが知らない状態になる。

デバイスをまたいだ会話の同期はこの範囲では実現していない（セッション ID が端末に閉じているため）。会話をまたぐ好みのほうは `actorId` 単位なので、スマホと PC で同じ好みプロファイルが育つ。

安全側の作りは記録の取得と揃えている。記憶は「LLM がユーザー入力から抽出した文章」「ユーザーの発話とそこから誘導された応答」なので、記録と同じ正規化を通してから渡す（好みはさらに `<user_data>` で囲む）。正規化が収束しない文字列は、記録と違って丸ごと捨てる（好みは無くても相談は成立するため）。

記録の取得と違うのは**1行に畳む**ところ。ツール結果は JSON として渡るので改行は文字列の中に収まるが、システムプロンプトは地の文なので改行がそのまま構造になる。山括弧を潰すだけでは `\n# 新しいルール` のような見出しを差し込まれたときに、`<user_data>` の囲みの中にいながら `# セキュリティ` と同じ高さの節に見えてしまう。そのため空白ごと畳んで、箇条書きの1項目から出られないようにしている。

記憶に**書く**ときも、ユーザーの発話とエージェントの応答の両方を無害化してから渡す。ユーザーの発話を無害化しても、そこから誘導された応答の文面までは縛れない。書いたものは次のリクエストで会話履歴として、また好みの抽出を経て次回のシステムプロンプトとして戻ってくるため、読み出し側と二重にかけている。

記憶 ID は CDK が `MEMORY_PREFERENCE_ID` 環境変数としてエージェントへ渡す（`agentcore.json` の `memories[].name` から自動導出）。この環境変数が無ければ記憶は自動的に無効になるので、ローカル開発では何も設定しなくてよい（会話の続きは効かなくなるが、1回ごとの相談は成立する）。

#### Web 検索（Tavily）

記録の中の話は DynamoDB のツールで足りるが、**新酒が出ているか・蔵元はどこか・いま買えるのか**といった記録の外の話は、モデルの学習知識に頼るとうろ覚えのまま断定してしまう。ここが一番ハルシネーションの害が大きいので、Tavily の検索 API をツール（`search_web`）として渡し、必要なときだけモデル自身に調べさせている（[#122](https://github.com/yuuuuuuu168/sakekasu-builder/issues/122)）。

| 決めごと | 内容 |
|---------|------|
| API キー | Secrets Manager（`dev-sakekasu/sommelier/tavily-api-key`）。エージェントに渡すのは**名前だけ** |
| キーの取得 | 初回の検索で1回だけ取ってメモリに保持。失敗したら60秒は再取得しない |
| 件数・深さ | 既定3件・最大5件、`search_depth` は `basic` 固定。要約生成と本文の全文取得は使わない |
| 検索回数 | 1回の相談で3回まで（失敗した検索も1回として数える） |
| 失敗したとき | 相談は止めない。ツールがエラーを返し、モデルは分かる範囲で答える（フェイルソフト） |
| 出典 | 回答に URL を載せる。チャットの吹き出し側でリンクとして描画する |
| 情報源の国 | `country: japan` で日本に寄せる。プロンプト側でも日本語の情報源を優先させる |

情報源を日本に寄せているのは、実機で「獺祭の今年の新酒」を聞いたときに、旭酒造の**台湾サイト**（`dassai.com/tw`）と中華圏の日本酒メディアが出典に出てきたため。日本語で検索しても、地域を縛らないと同じ蔵の海外向けページが上位に来る。扱っている商品も価格も日本と違うので、日本での発売や相場を聞かれているときの根拠にはならない。API 側の国指定とシステムプロンプトの二段構えにしてある。

なお `country` パラメータの仕様は Tavily の公式ドキュメントで裏取りできていない（クラウドセッションからは `docs.tavily.com` へ到達できない）。受け付けられなかった場合に検索そのものが死なないよう、**400 / 422 が返ったら国指定を外して1回だけ取り直し、以降はそのプロセスでは付けない**ようにしている。外したことは警告ログに残るので、そこで気づける。500 やタイムアウトでは取り直さない（失敗のたびに費用と待ち時間が倍になるため）。

検索結果は**外部サイトの本文がそのままモデルの入力に入る**ので、記録やメモよりも疑ってかかる相手になる。扱いは記録と同じ経路（HTML エンティティ展開＋NFKC を固定点まで反復してから山括弧を潰す）を通したうえで、囲みのタグだけ `<web_data>` に分けている。`<user_data>` と同じ印を付けてしまうと、検索でヒットした他人のブログの文章が「このユーザーの好み」として通ってしまうため。

URL だけは無害化を通さない。山括弧を丸括弧に潰した URL はもう開けず、出典として役に立たなくなる。代わりに `web_search.py` 側で **http / https であること・非 ASCII や引用符は percent-encode すること・エンティティ経由で山括弧に戻らないこと・`user@host` の形でないこと**を確かめ、通らないものは結果ごと捨てている（出典を示せない引用は、作り話と見分けが付かない）。

`user@host` を弾くのは、`https://有名な酒屋.jp@attacker.example/...` が「表示は信頼できるドメイン・実際の接続先は別」になるため。出典はそのままリンクになるので、通すと出典自体を偽装できる。同じ判定は描画側（`linkify.tsx`）にも置いている。吹き出しに流れてくるのはモデルが書いた本文で、検索結果の抜粋に載っていた URL を書き写すこともあるため、上流の検証を当てにしない。長さの上限（500文字）も同じ理由で両側に置いている。

キーを読む権限は Runtime ロールに `secretsmanager:GetSecretValue` を1つ、**そのシークレットの ARN だけ**に付ける。テーブル名と同じく `agentcore.json` の `envVars` を唯一の定義元にして、CDK 側はそれを読むだけにしている（設定ドリフト防止）。`TAVILY_API_KEY_SECRET_ID` を消せば権限も付かず、エージェント側も検索ツールを持たないまま動く。

#### Tavily の API キーを登録する（デプロイ前に1回）

キーはリポジトリにも `agentcore.json` にも置かない。[Tavily](https://tavily.com/) でキーを取ってから、先に Secrets Manager へ入れる。

```bash
AWS_PROFILE=sakekasu-builder aws secretsmanager create-secret \
  --name dev-sakekasu/sommelier/tavily-api-key \
  --secret-string 'tvly-xxxxxxxxxxxxxxxxxxxxxxxx' \
  --region ap-northeast-1
```

登録せずにデプロイしても壊れない。キーが読めなければ検索は無効のままで、記録と一般知識だけで相談に答える。

#### 記憶まわりの IAM の線引き

名前空間の条件を付けられるのは、条件キー `bedrock-agentcore:namespace` を受け付ける `ListMemoryRecords` / `RetrieveMemoryRecords` の**2つだけ**。残りの `CreateEvent` `GetEvent` `ListEvents` `DeleteEvent` などは条件キーを持たないので、条件を書いても常に不一致になり全拒否になってしまう。

| | IAM でどこまで守られるか |
|---|---|
| 好みの読み出し（Retrieve / List MemoryRecords） | 名前空間の条件つき。`sommelier/preference/*` の外は引けない |
| それ以外（CreateEvent・会話履歴の `ListEvents`・イベントの削除など） | 条件なし。ただし対象はこの記憶の ARN ただ1つに限られる |

つまり**「本人の棚にしか読み書きしない」を保証しているのは IAM ではなくアプリ側**（`conversation_memory.py` の `actorId` 検証と、`owner_sub` を検証済み JWT からしか取らない作り）。`actorId` は英数字・`-`・`_` だけを通し、区切り文字を含む値では読み書きしない。`sessionId` はクライアントのヘッダー由来なので同じ形式検査を通し、合わなければ会話履歴を引かない。エージェントに記憶を触るツールは持たせていないので、モデルの判断でこの範囲が広がることもない。

### 失敗したときの切り分け

以前はどんな失敗でも「応答の取得に失敗しました」の一文だったため、画面からもログからも原因を絞れなかった。いまは失敗を4種類に分けて扱う（`src/features/sommelier/lib/errors.ts`）。

| 種類 | 画面の文言 | 主な原因 |
|------|-----------|---------|
| `auth` | サインインの有効期限が切れたかも〜 | トークンの取得・更新に失敗、Runtime が 401/403 を返した |
| `network` | 通信に失敗しました〜 | fetch が届かなかった（接続断・CORS 拒否など）、受信途中で切れた |
| `server` | ソムリエが応答できませんでした（HTTP xxx）〜 | Runtime までは届いたが 5xx、またはエージェントがエラーを返した |
| `unknown` | 応答の取得に失敗しました〜 | 上記以外 |

ブラウザのコンソールには `ソムリエへの問い合わせに失敗しました [種類]:` の形で種類が出る。停止ボタンによる中断はエラー扱いせず、受信済みの内容を残して静かに終わる。

Runtime まで届いていたかどうかは、CloudWatch Logs でも確認できる。

```bash
AWS_PROFILE=sakekasu-builder aws logs tail \
  /aws/bedrock-agentcore/runtimes/sommelier_sommelier-Cn5eM865GE-DEFAULT \
  --since 1h --region ap-northeast-1
```

アイドル15分で実行環境が落ちるため、久しぶりの呼び出しは必ず起動ログから始まる。**起動ログすら無ければ、リクエストが Runtime に到達していない**（＝ `auth` か `network`）と判断できる。

### ソムリエの開発・デプロイ

```bash
# ローカル実行（COGNITO_* は LOCAL_DEV=1 と同時に設定不可）
cd sommelier/app/sommelier
AWS_PROFILE=sakekasu-builder PURCHASE_TABLE_NAME=dev-sakekasu-purchase-records \
  LOCAL_DEV=1 LOCAL_DEV_OWNER_SUB=<Cognitoのsub> uv run main.py
# → POST http://localhost:8080/invocations  {"prompt": "...", "history": []}

# テスト（AWS へは出ない。Bedrock も DynamoDB も呼ばない）
cd sommelier/app/sommelier
uv run pytest

# CDK 側（記憶の作成・環境変数・IAM が揃っているかの synth テスト）
cd sommelier/agentcore/cdk && npm ci && npm test
```

#### デプロイ

`sommelier/` 以下を触った PR を main へマージすれば、**自動でデプロイされる**（`.github/workflows/deploy-sommelier.yml`）。infra 側と同じ OIDC の deploy ロールを使い、エージェントのテスト（`pytest`）と CDK の synth テストを通してから `aws-cdk deploy --all` を実行する。

ワークフローを infra 側（`deploy.yml`）と分けているのは、`paths` がワークフロー単位でしか効かないため。1つにまとめると、ソムリエだけの変更で infra のデプロイまで走る。

手で打つのは、ワークフローが使えないとき（Actions の障害、ワークフロー自体の修正中）と、`agentcore` CLI でしかできない操作をするとき（`agentcore add` でのリソース追加など）だけ。

```bash
# 1. main を最新にする
#    デプロイされるのは「手元のファイル」であって main の内容ではない。
#    ブランチが古いまま打つと、古い版を本番へ出すことになる
git switch main && git pull

# 2. デプロイ（--target は aws-targets.json の name）
cd sommelier
AWS_PROFILE=sakekasu-builder agentcore deploy --target dev

# 3. cdk/ の依存が勝手に上がっていないか見る（下記）
git status --short sommelier/agentcore/cdk

# 4. 反映を確認（lastUpdatedAt が今なら出ている）
AWS_PROFILE=sakekasu-builder aws bedrock-agentcore-control list-agent-runtimes \
  --region ap-northeast-1 \
  --query "agentRuntimes[?agentRuntimeName=='sommelier_sommelier'].[agentRuntimeVersion,lastUpdatedAt]" \
  --output text
```

`agentcore deploy` は CLI 内部で `.cli/deployed-state.json` を更新する。ワークフロー側は CDK を直接叩くのでこのファイルを書かないが、記録されているのはリソース ID と `deployHash` で、次に手で `agentcore deploy` を打ったときに「変更あり」と判定されて出し直されるだけ。害はない。

#### agentcore deploy は CDK の依存を勝手に上げる

`agentcore deploy` は本体の処理に入る前に `agentcore/cdk` の依存を最新へ書き換えて `npm install` まで走らせる。**CI が確かめた版と、実際にデプロイされる版が別物になりうる**（2026-08-09 のデプロイでは `@aws/agentcore-cdk` が alpha.20 から alpha.45 へ飛び、`Namespaces` が `NamespaceTemplates` に改名されていた）。

デプロイしたら `package.json` と `package-lock.json` の差分を見て、`npm test` を新しい版で通し直す。テストが落ちたらデプロイ済みのものが落ちているということなので、先に中身を確かめる。この自動更新を止めるなら `agentcore config disableDependencyManagement true`。

ワークフローが `agentcore deploy` ではなく CDK を直接叩いているのはこれが理由で、`npm ci` で lock どおりに入れたものをそのまま出す。

#### `npx cdk` は CDK CLI ではない

`sommelier/agentcore/cdk/package.json` は自分自身の `bin.cdk` として CDK アプリ（`dist/bin/cdk.js`）を宣言している。npx は自パッケージの bin を優先するため、**`npx cdk deploy` は CLI ではなくアプリを引数なしで実行して、何もせず成功する**。CLI を使うときは `npx aws-cdk` と書く。

```bash
npx cdk ls        # 何も出力せず終了コード 0（アプリが動いただけ）
npx aws-cdk ls    # AgentCore-sommelier-dev
```

#### デプロイ後に好み学習が生きているか確かめる

好み学習はフェイルオープンなので、**動いていなくても画面上は「好みを覚えていないだけ」にしか見えない**。抽出はサービス側の非同期処理で、Memory の実行ロールに権限が足りなければ黙って止まる。デプロイしたら数往復会話してから、レコードが増えているか一度だけ確認する。

```bash
MEMORY_ID=$(AWS_PROFILE=sakekasu-builder aws bedrock-agentcore-control list-memories \
  --region ap-northeast-1 --query "memories[?contains(id,'sommelier_preference')].id | [0]" --output text)

AWS_PROFILE=sakekasu-builder aws bedrock-agentcore list-memory-records \
  --region ap-northeast-1 --memory-id "$MEMORY_ID" \
  --namespace "sommelier/preference/<Cognitoのsub>"
```

抽出は非同期だが、2026-08-09 に確かめたかぎりでは会話の1〜2分後にはレコードが入っていた。空のまましばらく変わらないなら、どちら側が止まっているかで切り分ける。イベント自体が入っていないなら書き込み側（`CreateEvent`）の問題で、Runtime のログに「好みの記録に失敗しました」が出ているはず。

イベントはあるのにレコードが増えないなら抽出側の問題。ここで実行ロールを疑いたくなるが、**疑わなくてよい**。L3 コンストラクトが作る Memory の実行ロールには信頼ポリシーだけで権限ポリシーが1つも付いておらず、それでも抽出は動いている（2026-08-09 に実測）。プロンプトもモデルも差し替えていない素の組み込みストラテジは AWS 側の推論で動くため、`memoryExecutionRoleArn` に Bedrock の権限は要らない（[Customize a built-in strategy or create your own strategy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-custom-strategy.html) が権限を要求しているのは、組み込みを上書きした場合と自前ストラテジの場合）。

ストラテジを上書きするよう変えたときは話が別で、そのときは実行ロール（`AgentCore-sommelier-dev` スタックが作る `...MemoryPreferenceExecutionRole...`）に `AmazonBedrockAgentCoreMemoryBedrockModelInferenceExecutionRolePolicy` が要る。

Runtime の ARN はフロントの `src/features/sommelier/config.ts` に持つ（`VITE_SOMMELIER_RUNTIME_ARN` で上書き可）。Runtime を作り直したら更新する。

## 監視とアラート通知

異常を人間が気づく前に Slack へ流す。きっかけは、ソムリエが数時間おかしくなったのに気づけず、原因の切り分けにも時間がかかったこと。

```
CloudWatch アラーム ─┐
外形監視 Lambda ─────┤
カナリア Lambda ─────┼→ SNS → Slack 通知 Lambda → Slack（Incoming Webhook）
新規登録通知 Lambda ─┘
（Cognito トリガー）
```

アラームは**発報だけでなく復旧も通知する**ので、鳴りっぱなしなのか直ったのかが Slack だけで分かる。

### 監視項目（25アラーム）

| 分類 | 監視対象 | 発報条件 |
|------|---------|---------|
| AI・ソムリエ | 認証拒否（`InboundAuthorizationFailure`） | 5分で3回以上。例外の種類ごとに分けて監視 |
| AI・ソムリエ | システムエラー / スロットル | 5分で1回以上 |
| AI・OCR | Lambda エラー | 15分で3回以上 |
| AI・OCR | スロットル | 15分で1回以上 |
| AI・OCR | SLO の達成率（可用性・レイテンシー） | 30日 rolling の達成率が 90% を割ったら |
| サービス | AppSync 5XX | 5分で5回以上 |
| サービス | Lambda エラー（presigned-url / ocr-analyzer / tasting-note） | 15分で5回以上 |
| サービス | DynamoDB スロットル（2テーブル） | 5分で1回以上 |
| サービス | 画像削除の失敗 | 1時間で5回以上 |
| 外形監視 | フロント配信 / ソムリエ Runtime / AppSync | 2回続けて到達不可 |
| 外形監視 | ソムリエとの実会話（カナリア） | 失敗したら即時 |
| 通知経路 | Slack 通知 Lambda のエラー | 1回以上 |
| 通知経路 | 新規登録通知の送信失敗（`SignupNotifyFailCount`） | 5分で1回以上 |
| 監視自体 | 外形監視・カナリアの実行失敗 | 1回以上 |
| 監視自体 | 外形監視・カナリアが動いていない | 実行回数が0（外形監視は1時間、カナリアは12時間） |

監視そのものが動かなくなると異常に気づけないため、**Slack 通知 Lambda と外形監視・カナリアも監視対象**に含めている。「エラーで失敗した」だけでなく「**そもそも動いていない**」も見る。スケジュールが止まるとエラーすら記録されず、静かに監視が消えるため。

既定では「データが無い＝異常なし」として扱うが、欠損そのものに意味がある指標は例外にしている。

- **カナリア**: `MISSING`（状態を保持）。6時間に1度しか計測しないため、既定のままだと直っていないのに次の計測を待つ間に復旧扱いになる
- **実行回数の監視**: `BREACHING`（欠損は異常）。記録が無いことが「動いていない」ことを意味するため

**認証拒否の監視が今回の障害への直接の答え**。実際に障害当時のメトリクスを確認したところ、`UnauthorizedInboundTokenException` が3回記録されていた。これを監視していれば即座に気づけた。

### AWS 側の障害・メンテナンス（AWS Health）

**共通基盤（[sakekasu-integrated_environment](https://github.com/yuuuuuuu168/sakekasu-integrated_environment) の `docs/monitoring.md`）へ移した。** AWS Health はアカウント全体の話で、4 アプリのどれか1つが持つものではない。共通基盤にも同じルール（ap-northeast-1 の `sakekasu-integrated-aws-health` と、us-east-1 から転送する `sakekasu-integrated-health-global`）が入ったので、こちらにも残すと同じ通知が 2 通届く。

外したのは、監視スタックの `dev-sakekasu-aws-health` ルールと、us-east-1 の `sakekasu-dev-health-global` スタック（転送ルール `dev-sakekasu-aws-health-global` とロール `dev-sakekasu-health-forwarder`）。us-east-1 のスタックはアプリから外しても `cdkd deploy --all` では消えないので、手で消す（[docs/cdkd-migration.md](docs/cdkd-migration.md) の「health-global を外した」）。

Slack 通知 Lambda と DevOps Agent の転送 Lambda には、Health イベントを整形するコードが残っている。イベントがもう届かないので動かないが、害は無く、アラームの経路と同じ関数なので手を付けていない。

### 新規ユーザー登録の通知（Issue #66）

**共通ログインへ移ったので役目を終えた。** 共通プールにはセルフサインアップが無い。
通知は旧ユーザープールに付けたまま残してあり、旧プールを外す別 PR で一緒に外す（[docs/shared-login.md](docs/shared-login.md)）。
以下は旧プールでの仕組み。

誰かがサインアップして確認を終えると、Cognito の Post Confirmation トリガーが通知 Lambda（`infra/lambda/signup-notifier/`）を呼び、既存のアラートトピック経由で Slack に「メールアドレス・登録時刻（JST）・ユーザープール」を流す。パスワード再設定の確認でも同じトリガーが呼ばれるため、`triggerSource` でサインアップ確認だけに絞っている。

設計上の注意は2点。

- **通知 Lambda は決して throw しない**。Post Confirmation トリガーの失敗はサインアップの確認そのものをエラーにしてしまうため、SNS 送信の失敗は握りつぶしてログに残す。Cognito がトリガーの完了を5秒しか待たず、その5秒にはコールドスタートも含まれる点を踏まえ、送信は1.5秒で打ち切る。握りつぶした失敗は `SignupNotifyFailCount` メトリクス経由のアラームで拾う
- **アラートトピックは名前規約で参照する**。トピックを作る監視スタックは AuthStack に依存済みのため、オブジェクト参照で受け取ると循環参照になる（画像削除アラームと同じ構図）

### 外形監視の考え方

到達性の確認（5分ごと）は、**認証情報を持たずに**行う。ソムリエ Runtime と AppSync はあえて認証なしで叩き、**401/403 が返ることを正常**とみなす。これで「エンドポイントが生きている」ことと「認証が働いている」ことを、監視側に鍵を持たせずに確認できる。

実際に会話できるかはカナリア（6時間ごと）が見る。こちらは監視用ユーザーでサインインして短い相談を投げ、応答が返るまでを確認する。毎回 LLM を呼ぶため頻度を抑えている。

**カナリアはいま止めてある。** 共通ログインのクライアントはパスワードで直接サインインできず（MFA も必須）、ソムリエは共通プールのトークンしか受け付けなくなったため、旧プールでサインインするカナリアは必ず落ちる。スケジュールを無効にし、カナリアの3つのアラームは通知だけを切ってある。再開の選択肢は [docs/shared-login.md](docs/shared-login.md) の「カナリア」。下の手順と「カナリアを通すための2箇所」は、旧プールで動いていたときのもの。

### デプロイ前の準備

Webhook URL と監視ユーザーのパスワードはリポジトリに置けないため、**先に手動で登録**する。CDK は名前で参照するだけ。

```bash
# 1. Slack の Incoming Webhook URL を登録する
AWS_PROFILE=sakekasu-builder aws ssm put-parameter \
  --name /dev-sakekasu/monitoring/slack-webhook-url \
  --type SecureString \
  --value 'https://hooks.slack.com/services/XXX/YYY/ZZZ' \
  --region ap-northeast-1

# 2. カナリア用の Cognito ユーザーを作る（パスワードは自分で決める）
AWS_PROFILE=sakekasu-builder aws cognito-idp admin-create-user \
  --user-pool-id ap-northeast-1_eZOfInCT4 \
  --username canary@example.com \
  --message-action SUPPRESS \
  --region ap-northeast-1
AWS_PROFILE=sakekasu-builder aws cognito-idp admin-set-user-password \
  --user-pool-id ap-northeast-1_eZOfInCT4 \
  --username canary@example.com \
  --password '<決めたパスワード>' --permanent \
  --region ap-northeast-1

# 3. その認証情報を Secrets Manager に入れる
AWS_PROFILE=sakekasu-builder aws secretsmanager create-secret \
  --name dev-sakekasu/monitoring/canary-user \
  --secret-string '{"username":"canary@example.com","password":"<決めたパスワード>"}' \
  --region ap-northeast-1

# 4. デプロイ
cd infra
AWS_PROFILE=sakekasu-builder npx cdk deploy --all -c env=dev

# 5. 出力された CanaryUserPoolClientId を控え、agentcore.json を2箇所直してから
#    ソムリエを再デプロイする（下の「カナリアを通すための2箇所」を参照）
cd ../sommelier
AWS_PROFILE=sakekasu-builder agentcore deploy --target dev
```

カナリアがサインインするため、**専用の UserPoolClient**（`<env>-sakekasu-canary-client`）を用意している。ブラウザ向けクライアントは SRP のみのままにし、管理者パスワード認証はカナリア専用クライアントだけに持たせる。同じクライアントに両方を持たせると、IAM の足がかりを得た相手が任意の利用者になりすませる余地が広がるため。

カナリア用クライアントは `ADMIN_USER_PASSWORD_AUTH` のみで SRP を持たない。このフローは IAM 認証済みの呼び出し元（＝カナリアの Lambda ロール）からしか使えず、ブラウザからは利用できない。

#### カナリアを通すための2箇所（どちらか一方だけでは 403 になる）

ソムリエの認証は**二段構え**（Runtime の JWT Authorizer + アプリ内の audience 検証）なので、`sommelier/agentcore/agentcore.json` を**2箇所**直す。

```json
// ① Runtime の JWT Authorizer が受け付けるクライアント
"allowedClients": ["3a4unc2dbutrkm2hjn887s1h9m", "<CanaryUserPoolClientId>"]

// ② アプリ内の audience 検証が受け付けるクライアント（カンマ区切り）
{ "name": "COGNITO_APP_CLIENT_ID", "value": "3a4unc2dbutrkm2hjn887s1h9m,<CanaryUserPoolClientId>" }
```

①だけ直すとゲートウェイは通るがアプリ内検証で弾かれる。カナリアが `HTTP 403` を返したときは、まずこの2箇所を疑う（カナリアのログとアラーム本文にもその旨を出している）。

Runtime の ARN とサイト URL は CDK コンテキストで差し替えられる。

```bash
npx cdk deploy sakekasu-dev-monitoring -c env=dev \
  -c sommelierRuntimeArn=arn:aws:bedrock-agentcore:... \
  -c siteUrl=https://example.com
```

### 費用の目安

概算で**月5ドル前後**。内訳は CloudWatch アラーム25件（$0.10/件）とカスタムメトリクス8種（$0.30/種）が大半で、Lambda・SNS は無料枠にほぼ収まる。カナリアの Bedrock 呼び出しは月120回・短い応答のため数円程度。SLO とトレースの費用は Application Signals 側で別立てになる（月数十円から数百円の見込み。[docs/application-signals.md](docs/application-signals.md)）。

## 毎日の利用料金 Slack 通知（Issue #92）

AWS の利用料金を毎日 09:05 JST に Slack へ通知する。**組織全体の合計 → sakekasu-builder** の順で表示し、実際に請求される額だけでなく**クレジットで賄われた分**も載せる（クレジット適用前の利用額・クレジット適用額・請求見込みの3点）。それぞれに**サービス別内訳**（今月・クレジット適用前・Tax は集計から除外）を実サービス名で上位5位まで添え、6位以下は「その他」に合算する。組織全体の合計は全アカウント分を足すため、個別表示していないアカウントの費用も漏れない。

```
EventBridge（毎日 00:05 UTC）→ billing-notifier Lambda → Cost Explorer API
                                        └→ Slack Incoming Webhook
```

### 他のスタックとの違い

アカウント別の内訳（`LINKED_ACCOUNT`）を Cost Explorer で見られるのは **Organization の管理アカウントだけ**のため、このスタック（`sakekasu-billing-notifier`）は他と違い**管理アカウント（<管理アカウント ID>）へデプロイする**。環境（dev/staging/prod）にも紐づかない単一のスタックで、通常の `cdk deploy --all` に混ざらないよう `-c billing=true` を付けたときだけ合成される。

対象アカウントの一覧（表示ラベル含む）は `infra/bin/app.ts` の `targetAccounts` で変更できる。

### 監視

レポートが止まっても気づけるよう、3つのアラーム（レポート Lambda の失敗・1日以上の沈黙・Slack 通知の失敗）を同じスタック内に持つ。通知経路は監視スタックと同じ Slack 通知 Lambda の実装を再利用している。

### デプロイ手順（管理アカウント）

```bash
# 1. 管理アカウントの認証情報で入っていることを確認する
AWS_PROFILE=yuuuuuuuki7749 aws sts get-caller-identity

# 2. （初回のみ）管理アカウントを CDK bootstrap する
cd infra
AWS_PROFILE=yuuuuuuuki7749 npx cdk bootstrap aws://<管理アカウント ID>/ap-northeast-1 -c billing=true

# 3. Slack の Incoming Webhook URL を管理アカウント側に登録する
AWS_PROFILE=yuuuuuuuki7749 aws ssm put-parameter \
  --name /sakekasu-billing/slack-webhook-url \
  --type SecureString \
  --value 'https://hooks.slack.com/services/XXX/YYY/ZZZ' \
  --region ap-northeast-1

# 4. デプロイ
AWS_PROFILE=yuuuuuuuki7749 npx cdk deploy sakekasu-billing-notifier -c billing=true

# 5. 動作確認（手動で1回実行して Slack に届くか見る）
AWS_PROFILE=yuuuuuuuki7749 aws lambda invoke \
  --function-name sakekasu-billing-notifier \
  --region ap-northeast-1 /dev/stdout
```

数値は Cost Explorer の集計途中の概算（UTC 日単位）で、確定額は請求書と一致しないことがある。月初日の実行では「今月累計」が空になるため、前月まるごとを「確定」として通知する。Cost Explorer API は 1 リクエスト $0.01 で、1日3回の呼び出し（アカウント別の今月・昨日、サービス別の今月）なので**月1ドル前後**。

## DevOps Agent による自動インシデント調査（Issue #67）

アラームが鳴ってから調べ始めるまでの時間をなくすため、CloudWatch アラームの発報をそのまま AWS DevOps Agent に渡して調査を始めさせる。エージェントがテレメトリ・ログ・デプロイ履歴を突き合わせ、根本原因と緩和策を専用の Slack チャンネルに投稿する。

```
SNS（dev-sakekasu-alerts）┬→ Slack 通知 Lambda → Slack（既存のアラートチャンネル）
                          └→ 転送 Lambda → DevOps Agent Webhook → 自動調査 → Slack（専用チャンネル）

人 ⇄ Slack（双方向用プライベートチャンネル）⇄ DevOps Agent
```

既存の Slack 通知は変えていない。転送 Lambda は同じトピックをもう1つの購読者として受け取るだけなので、エージェント側が止まってもアラート自体は届く。

Agent Space は運用ツール専用アカウント（`<運用アカウント ID>` / `ops-tooling`）に置き、調査対象はアプリ本体のアカウント（`<アプリのアカウント ID>`）。CDK が作るのはアプリ本体側の2つで、調査用のクロスアカウントロール（読み取り専用）と、アラームを Webhook へ転送する Lambda。Agent Space の作成・Slack 連携・GitHub 連携・Webhook の発行はコンソールでの手作業になる。

エージェントは秒課金なので、投げるものを絞っている。アラームは `ALARM` に変わったときだけ（復旧では投げない）、転送 Lambda 自身の失敗アラームは捨てる。AWS Health は共通基盤へ移したので、このトピックにはもう流れてこない。

調査結果を読んだ先で追加の指示を出したくなるぶんは、双方向用のプライベートチャンネルで受ける。メンションで調査を始めたり、経過や根拠を聞いたりできて、返答は元メッセージのスレッドに積まれる。双方向はプライベートチャンネルでしか有効にできず、有効化には `AIDevOpsChannelAccessPolicy` を付けた IAM ロールが要る。CloudFormation 側にまだ双方向のフィールドが無いため、この設定はコンソールでの手作業になる。

エージェントに渡してある権限は読み取り専用のクロスアカウントロールだけなので、Slack から何を頼んでもアプリ側のリソースは変わらない。

`agentSpaceArn` がコンテキストに入っているときだけスタックが合成される。コンソール作業が済むまでは `cdk deploy --all` に混ざらない。

```bash
cd infra
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-dev-devops-agent -c env=dev \
  -c agentSpaceArn=arn:aws:aidevops:ap-northeast-1:<運用アカウント ID>:agentspace/xxxxxxxx
```

セットアップ手順、優先度の割り当て、カスタムスキルに入れる運用ナレッジ、費用の詳細は [docs/devops-agent.md](docs/devops-agent.md) にまとめてある。

## Application Signals による APM（Issue #86）

既存の監視は「異常が起きたこと」までは知らせてくれるが、そこから先の切り分けはログの突き合わせに頼っていた。リクエスト単位のトレースと、レイテンシー・エラー率・リクエスト数を自動で集めてそこを埋める。

計装が入っているのは OCR（`ocr-analyzer`、2026-08-10）と画像アップロードの入口（`presigned-url`、2026-08-16）の2つ。一度は起動ラッパーとレイヤーの組み合わせを取り違えて関数を止め、切り戻してから1つずつ入れ直した（PR [#110](https://github.com/yuuuuuuu168/sakekasu-builder/pull/110) → [#114](https://github.com/yuuuuuuu168/sakekasu-builder/pull/114)）。アカウント側の設定（サービス検出・Transaction Search）はソムリエの GenAI Observability を入れたときから有効で、アカウントに1つの設定なので CDK では管理していない。

監視系の関数（health-check / slack-notifier / カナリア / signup-notifier）は計装しない。監視の監視は既存のアラームで足りていて、増やすとノイズと費用だけが増えるため。この4つは従来どおり Lambda 標準メトリクス由来のエラー率と実行時間までしか見えない。計装が無かった頃でもエラー率は追えたので、それで既存のバグを1件見つけている（[#115](https://github.com/yuuuuuuu168/sakekasu-builder/issues/115)）。

SLO は OCR に2本置いてある。どちらも30日 rolling で、成功率 90% と「90% が15秒未満」。しきい値は日次の実測（p50/p90/p99）から決めた。割ったらアラームが鳴り、そのしきい値は SLO の目標と同じ定数から取っている。別々に書くと、片方だけ動かしたときに「SLO は未達なのにアラームは鳴らない」が黙って生まれる。

`presigned-url` の SLO はまだ作っていない。計装が後から入ったぶん材料が足りず、SLO は Application Signals の課金対象なので数を絞っている。

計装の対象を絞った理由、デプロイ後の確認手順、しきい値の根拠、費用は [docs/application-signals.md](docs/application-signals.md) にまとめてある。

## 技術スタック

- React 19 + TypeScript 5.9
- Vite 7
- Tailwind CSS v4
- shadcn/ui（@base-ui/react ベース）
- Framer Motion
- AWS CDK（AppSync + DynamoDB）
- Amazon Cognito（4 アプリ共通のユーザープールとマネージドログイン。[docs/shared-login.md](docs/shared-login.md)）
- AWS S3（画像ストレージ）
- Amplify（フロントエンドホスティング）
- Amazon Bedrock AgentCore Runtime + AgentCore Memory + Strands Agents（Python）※ソムリエ
- Amazon Bedrock（Claude Haiku 4.5）※OCR・テイスティングノート・ソムリエ
- react-day-picker（カレンダー）
- Vitest + Testing Library + fast-check（フロントと infra の CDK）、Jest（ソムリエの CDK）、pytest（ソムリエ本体）

## プロジェクト構成

```
src/
  features/
    auth/        # 認証（共通ログインへのリダイレクトとサインアウト）
    purchase/    # 購入登録
    drinking/    # 飲酒登録
    records/     # 記録一覧・検索・フィルタ
    stats/       # 統計ダッシュボード
    calendar/    # カレンダー表示
    image/       # 画像添付・OCR・サムネイル
    tasting/     # テイスティングノートの生成と備考への追記
    specs/       # 詳細スペックの入力と、裏ラベルからの読み取り
    sommelier/   # ソムリエ相談チャット（Runtime 呼び出し）
  components/    # 共通コンポーネント（shadcn/ui, ThemeProvider 等）
infra/
  lib/           # CDK スタック（auth / api / monitoring / billing-notifier /
                 #                devops-agent / github-oidc）
  graphql/       # AppSync GraphQL スキーマ
  lambda/        # Lambda 関数（presigned-url, ocr-analyzer, tasting-note,
                 #              health-check, slack-notifier, sommelier-canary,
                 #              signup-notifier, billing-notifier,
                 #              devops-agent-webhook）
  scripts/       # amplify_outputs.json 生成、サムネイルのバックフィル、
                 # 共通ログインへの移行に伴う持ち主（sub）の付け替え
sommelier/       # AgentCore プロジェクト（ソムリエエージェント）
  app/sommelier/ # Strands Agent 本体（Python）
  agentcore/     # AgentCore 設定と CDK
docs/            # 設計ドキュメント
scripts/         # クラウドセッション用の補助（AWS SSO ログイン、フック）
.claude/         # Claude Code の設定と AI-DLC（使い方は CLAUDE.md）
aidlc/           # AI-DLC のルールと成果物
.github/         # GitHub Actions（test / deploy / deploy-sommelier / cdk-diff）
```

## ドキュメント

| ドキュメント | 内容 |
|------------|------|
| [docs/shared-login.md](docs/shared-login.md) | 共通ログインへの切り替え（変わったこと・旧プールの扱い・カナリア・旧 sub から新 sub へのデータの付け替え手順） |
| [docs/agentcore-phase1-design.md](docs/agentcore-phase1-design.md) | ソムリエ Phase 1 の設計（認証の二段構え・ツール設計・決定事項） |
| [docs/devops-agent.md](docs/devops-agent.md) | DevOps Agent のセットアップ手順・Slack の双方向通信・優先度の割り当て・カスタムスキル・費用 |
| [docs/application-signals.md](docs/application-signals.md) | Application Signals の計装対象・デプロイ後の確認手順・SLO の決め方・費用 |
| [docs/claude-code-web.md](docs/claude-code-web.md) | Claude Code on the web での開発環境（外出先から PR まで） |
| [docs/cdkd-migration.md](docs/cdkd-migration.md) | cdkd（CDK Direct）への移行手順と、残っている作業 |
| [docs/amplify-exit.md](docs/amplify-exit.md) | Amplify Hosting をやめて CDK 側へ寄せるかの検討（実測・速度・コスト・着手の順番） |
| [docs/log-group-import.md](docs/log-group-import.md) | 既存ロググループのスタック取り込み（`logRetention` からの移行） |
| [docs/agent-verify-permission-set.md](docs/agent-verify-permission-set.md) | クラウドセッションから AWS を見るための読み取り専用 Permission Set |
| [CLAUDE.md](CLAUDE.md) | 開発の進め方（ブランチ運用・AI-DLC・AWS 確認の認証フロー） |

## セットアップ

```bash
# フロントエンド
npm install
npm run dev

# インフラ（CDK）※デプロイは Actions 経由。ここでは差分の確認まで
cd infra
npm install
AWS_PROFILE=sakekasu-builder npx cdk diff --context env=dev
```

デプロイ後に AppSync のエンドポイント等が変わったときは、`infra/scripts/generate-outputs.ts` を実行して `amplify_outputs.json` を作り直す。認証の値（共通ログイン）は `infra/cdk.json` の `sharedAuth` から書く。

ローカルの画面（`npm run dev`）も共通ログインでログインする。戻り先として登録してあるのは `http://localhost:5173/` だけなので、ポートを変えるとログインできない。

## デプロイ（CDK）

**バックエンド（CDK）のデプロイは main へのマージ経由のみ。ローカルからの手動 `cdk deploy` は原則禁止**（Issue #94）。

- main に push（= PR マージ）されると GitHub Actions が対象を分けてデプロイする
  - `infra/**` → `.github/workflows/deploy.yml` が `cdk deploy --all`
  - `sommelier/**` → `.github/workflows/deploy-sommelier.yml` が AgentCore スタックを `aws-cdk deploy --all`
- PR を開くと `cdk diff` の結果が自動でコメントされる（`.github/workflows/cdk-diff.yml`。対象は infra のみ）
- 認証はどちらも OIDC（`sakekasu-github-oidc` スタックの deploy ロール）。リポジトリにアクセスキーは置かない

ワークフローを2つに分けているのは、`paths` がワークフロー単位でしか効かないため。1つにまとめると、片方だけの変更でもう片方のデプロイまで走る。

例外として、以下は今までどおり手動デプロイする:

- `sakekasu-billing-notifier`（管理アカウント宛て。`-c billing=true`）
- `sakekasu-github-oidc`（OIDC 連携自体。Actions に自分のロールを触らせないため。`-c github-oidc=true`）

### OIDC 連携の初回セットアップ（1回だけ手動）

```bash
cd infra
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-github-oidc -c github-oidc=true
```

これで OIDC プロバイダーと deploy / diff ロール、それに cdkd 用のデプロイロール（`sakekasu-cdkd-deploy`）が作られ、以後 Actions が動くようになる。

### cdkd（CDK Direct）への移行

CloudFormation を経由しない [cdkd](https://github.com/go-to-k/cdkd) への移行を進めている（[#150](https://github.com/yuuuuuuu168/sakekasu-builder/issues/150)）。いまはロールと依存を用意した段階で、ワークフローはまだ `cdk deploy` のまま。AWS 側の取り込み作業とワークフロー差し替えの手順は [docs/cdkd-migration.md](docs/cdkd-migration.md) にある。

## テスト

```bash
# フロントエンド（Vitest）。src/ に絞るのは、root の vitest が
# infra と sommelier のテストまで拾って import を解決できずに落ちるため
npx vitest run src/

# インフラ（CDK の synth テスト）
cd infra
npm test

# 運用スクリプト（pytest。AWS へは出ない）
uv run --with boto3 --with pytest pytest infra/scripts/tests

# ソムリエ本体（pytest。AWS へは出ない）
cd sommelier/app/sommelier
uv run pytest

# ソムリエの CDK（記憶の作成・環境変数・IAM の synth テスト）
cd sommelier/agentcore/cdk
npm ci && npm test
```

同じものを PR とマージのたびに GitHub Actions が走らせる（`.github/workflows/test.yml`）。フロントは lint と型検査も込みで、系統ごとに別のジョブに分けてある。片方が落ちても、もう片方の結果が残るようにするため。

## デザイン

「和モダン」コンセプト。ダークモード対応、カスタムカラーパレット（`indigo-wa` / `gold-wa` / `dark-bg` / `dark-gold`。`src/index.css` で定義）。
