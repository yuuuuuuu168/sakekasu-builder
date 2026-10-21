# 酒カス (sakekasu-builder.com)

日本酒・ウイスキー・焼酎など、「何を飲んだか」「何を買ったか」を忘れがちな酒飲みのための記録・管理 Web アプリ。

## 機能

ここに載っているものはすべて実装済み。

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
| 詳細スペックの記録 | 蔵元・産地・度数・容量・精米歩合・日本酒度・酸度・アミノ酸度・酒米・酵母・特定名称・紹介文。全項目任意で、フォームでは折りたたみ（[60ff478](https://github.com/yuuuuuuu168/sakekasu-builder/commit/60ff4784d9d18a9661fa48a47b150263f08041f6)） |

### 見つける・振り返る

| 機能 | 補足 |
|------|------|
| 購入・飲酒記録の一覧表示 | |
| 検索・フィルタ | キーワード横断検索（蔵元・産地・酒米・酵母も対象）・評価フィルタ・価格帯フィルタ・日付範囲フィルタ・条件の保持・表記ゆれ吸収 |
| 在庫本数サマリー | 一覧上部にウイスキー・日本酒の在庫本数を表示 |
| 統計ダッシュボード | 月別飲酒量・カテゴリ別支出・お気に入り TOP |
| カレンダー表示 | 飲んだ日・買った日をドットで可視化（[ba52551](https://github.com/yuuuuuuu168/sakekasu-builder/commit/ba5255112b3ef6b0e90ff95864fd26705cd63a9f)） |
| リピート判定リマインド | 購入時に同じ銘柄の過去評価を出す |

### AI

| 機能 | 補足 |
|------|------|
| ラベル画像の OCR | 銘柄名・カテゴリに加え、裏ラベルの詳細スペック12項目を抽出。項目ごとの確信度つきで、低確信の項目は入力欄に「要確認」を出す（[60ff478](https://github.com/yuuuuuuu168/sakekasu-builder/commit/60ff4784d9d18a9661fa48a47b150263f08041f6)）。既存の記録は一覧から、付いている写真をまとめて読み取れる |
| テイスティングノートの自動記載 | 購入登録の時点で備考に書き足す。ウイスキーは飲み方も。知らない銘柄は Tavily で調べてから書く。既存の記録は一覧から一括で追記できる |
| 写真1枚で購入登録 | 画像を選ぶと自動で OCR が走る。価格・店名は手入力（[c57a1f9](https://github.com/yuuuuuuu168/sakekasu-builder/commit/c57a1f94031622a95e1f354d478ba0d498530c7c)） |
| ソムリエ相談 | 在庫相談・ペアリング・銘柄レコメンド・酒知識 Q&A（[ca3759a](https://github.com/yuuuuuuu168/sakekasu-builder/commit/ca3759abb71702f8a20d9e1bac110e977e247246)） |
| ソムリエへの写真添付 | 店の棚や品書きの写真から、好みに合う1〜3本を選んでもらう（[b619fa4](https://github.com/yuuuuuuu168/sakekasu-builder/commit/b619fa43f927320dedf15de8c9276590284a7a31)） |
| 好み学習 | AgentCore Memory。セッションをまたいで好みが育つ |
| 会話の記憶 | AgentCore Memory。履歴はサーバー側に持ち、クライアントからは送らない（[010fd59](https://github.com/yuuuuuuu168/sakekasu-builder/commit/010fd5969fb60a71e3513f109757fbdb39132dda)） |
| ソムリエの Web 検索 | 新酒の発売・蔵元・相場など記録の外の話は Tavily で調べて出典つきで答える（[52a7b94](https://github.com/yuuuuuuu168/sakekasu-builder/commit/52a7b947258ff425b17139245761c8c5cb886118)） |

### アカウント・セキュリティ

| 機能 | 補足 |
|------|------|
| 共通ログイン | 4 アプリで共有する Cognito のマネージドログインへリダイレクト（Authorization code + PKCE）。ユーザーは管理者が共通ログイン側で作る。手順と経緯は [docs/shared-login.md](docs/shared-login.md) |
| MFA（TOTP） | 必須。登録も入力も共通ログインの画面で行う |
| データ保護 | DynamoDB の PITR・削除保護、S3 バージョニング |

### 運用・基盤

| 機能 | 補足 |
|------|------|
| 監視とアラート通知 | 22アラーム（AI・サービス正常性・外形監視・SLO）を、共通基盤のトピック経由で Slack と DevOps Agent へ |
| 毎日の AWS 利用料金 Slack 通知 | 組織合計・上位サービス内訳・クレジット込み。管理アカウントへデプロイ（[52c4ee7](https://github.com/yuuuuuuu168/sakekasu-builder/commit/52c4ee7aa89f69eee5dfca2ee02279a1f8df87d4)） |
| DevOps Agent による自動インシデント調査 | アラーム → 調査 → 専用 Slack チャンネル。プライベートチャンネルではメンションで調査の開始や照会もできる。コンソール側の設定あり（[6360410](https://github.com/yuuuuuuu168/sakekasu-builder/commit/63604109ac4cba7a3413623b056d606c55d16c84)） |
| Application Signals による APM | OCR と画像アップロードの2関数を計装。OCR には SLO を2本置き、割ったらアラーム（[#11](https://github.com/yuuuuuuu168/sakekasu-builder/issues/11)） |
| デプロイの自動化 | main へのマージで GitHub Actions がデプロイ（OIDC 認証、[3f8e0ef](https://github.com/yuuuuuuu168/sakekasu-builder/commit/3f8e0efe765e660089e05b04623164acbb487895)）。infra は [cdkd](https://github.com/go-to-k/cdkd)、ソムリエは CDK、画面は S3 への同期で、対象ごとにワークフローを分ける |
| 配信 | S3 + CloudFront（OAC）で `sake.sakekasu-builder.com` から配信する。画面は `deploy-site.yml` が同期する |
| 一覧画面の画像表示高速化 | サムネイル生成・Presigned URL キャッシュ・遅延読み込み |
| PR ごとのテスト・lint・型検査 | GitHub Actions がフロント・infra・ソムリエの3系統を並べて走らせる |

## こだわりポイント

### 検索・フィルタ強化

記録が増えても目当ての1本に辿り着けるよう、一覧の絞り込みを広げた。バックエンドの変更はなく、フロントのみで完結する。

- **キーワード横断検索**: 酒名だけでなく、店名・場所名・飲み方・メモも検索対象にした。酒名は従来どおり曖昧検索（各文字が順番に出現すればヒット）で、うろ覚えや部分入力から辿れる。それ以外の項目は部分一致にしている。メモまで曖昧検索にすると、離れた位置の文字が拾われて無関係な記録が大量に混ざるため
- **表記ゆれの吸収**: 「アラン」「あらん」「ｱﾗﾝ」「Allan」「Arran」のどれで打っても同じ記録に辿り着く（詳細は下記）
- **評価フィルタ**: 「★4以上」のように星数のしきい値で絞る。評価を持つのは飲酒記録だけなので、選ぶと記録種別も自動で飲酒記録に切り替わる（飲みきりステータスを選ぶと購入記録に切り替わるのと同じ挙動）
- **価格帯フィルタ**: 「1,000円未満」「10,000円以上」など5つの帯で絞る（[ec693c7](https://github.com/yuuuuuuu168/sakekasu-builder/commit/ec693c71525baef18f04762c3b242c311d30b70c)）。帯どうしは重ならず隙間もない（`min` 以上 `max` 未満）ので、どの金額もちょうど1つの帯に入る。価格が未入力の記録は、価格帯を選んだ時点で外す。金額の分からない記録が「3,000円以上」に混ざると絞り込んだ意味が無くなるため
- **日付範囲フィルタ**: 今月・直近3ヶ月・今年・カスタム範囲（[ec693c7](https://github.com/yuuuuuuu168/sakekasu-builder/commit/ec693c71525baef18f04762c3b242c311d30b70c)）。カスタム範囲は片側だけの指定も許して「この日以降すべて」を出せるようにし、開始日に `max`・終了日に `min` を渡して逆転した範囲を選べないようにしてある
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

本数2以上の購入記録は、1本飲んでも残りが在庫に残る（[ae856df](https://github.com/yuuuuuuu168/sakekasu-builder/commit/ae856df02000b1508c30ba2f3e3aacb3bc2f6aff)）。

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
- **既存の記録は一覧から一括で追記**。ノート未記載のウイスキー・日本酒があれば一覧上部に件数が出て、そこから追記できる。1件ずつ直列に処理する

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
- 検索結果は資料として、指示とは分けてモデルへ渡す
- 検索できない（鍵が無い・失敗した）ときは1回目の結果をそのまま返す。ノートが付かないだけで、登録も一括追記も止まらない
- 検索結果がその銘柄の話でなければ、やはり書かせない。Web を見たかどうかで「知らないことは書かない」は変えない

Bedrock では Anthropic のホスト型 Web 検索ツールが使えないため、検索は自前で呼んでいる。

### 画像表示の高速化

一覧のサムネイル表示が遅かったため、以下を実装した（**854MB → 2.8MB / 99.7% 削減**）。

- **サムネイル生成**: アップロード時に長辺 320px の画像を原画の兄弟キー（`thumb_` プレフィックス）として保存。一覧はサムネイルを優先し、無い場合は原画へ自動フォールバック
- **遅延読み込み**: `loading="lazy"` / `decoding="async"`
- **Presigned URL のメモリキャッシュ**: 有効期限内は再利用し、同一キーへの同時リクエストを1本に束ねる
- **既存画像のバックフィル**: 仕組みの導入前に上げた画像のサムネイルは、2026-08 に一度きりのスクリプトで作って済ませた（スクリプトは git の履歴にある。EXIF の向きを補正してから縮小しないと写真が横倒しになる）

## AgentCore ソムリエエージェント

アプリに **「パーソナル酒ソムリエ」AI エージェント** を導入し、単発の AI 呼び出しでは実現できない「対話・ツール連携」を活用する。

### 構成

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
- **入力の安全対策**: プロンプト・記録の値など外部から来る文字列は、指示と区別してモデルへ渡す
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

履歴をサーバー側に置いているので、エージェントは自分で書いたものだけを文脈として読む。

| 決めごと | 内容 |
|---------|------|
| 名前空間 | `sommelier/preference/{actorId}`。`actorId` は Cognito の sub |
| 会話を束ねる単位 | `sessionId`。クライアントが作り、localStorage にユーザー単位で保存する |
| 保持期間 | 90日（`eventExpiryDuration`） |
| 文脈に入れる件数 | 会話履歴は直近10件、好みは相談内容に近いもの上位5件まで |
| 失敗したとき | 相談は止めない。記憶なしで在庫と記録だけで答える（フェイルオープン） |

「新しい相談」を押したときとサインアウトしたときは、画面の写しと一緒にセッション ID も捨てる。同じ端末の次の利用者が前の会話の続きとして相談できないようにするため。逆に**リロードでは捨てない**。画面には前の会話が残るので、セッションだけ作り直すと目の前に見えている会話をエージェントだけが知らない状態になる。

好みは `actorId` 単位なので、スマホと PC で同じ好みプロファイルが育つ。

記憶はユーザー入力に由来する文章なので、記録と同じく指示と区別してからモデルへ渡す。

記憶 ID は CDK が `MEMORY_PREFERENCE_ID` 環境変数としてエージェントへ渡す（`agentcore.json` の `memories[].name` から自動導出）。この環境変数が無ければ記憶は自動的に無効になるので、ローカル開発では何も設定しなくてよい（会話の続きは効かなくなるが、1回ごとの相談は成立する）。

#### Web 検索（Tavily）

記録の中の話は DynamoDB のツールで足りるが、**新酒が出ているか・蔵元はどこか・いま買えるのか**といった記録の外の話は、モデルの学習知識に頼るとうろ覚えのまま断定してしまう。ここが一番ハルシネーションの害が大きいので、Tavily の検索 API をツール（`search_web`）として渡し、必要なときだけモデル自身に調べさせている（[52a7b94](https://github.com/yuuuuuuu168/sakekasu-builder/commit/52a7b947258ff425b17139245761c8c5cb886118)）。

| 決めごと | 内容 |
|---------|------|
| API キー | Secrets Manager。エージェントに渡すのは**シークレットの名前だけ** |
| キーの取得 | 初回の検索で1回だけ取ってメモリに保持。失敗したら60秒は再取得しない |
| 件数・深さ | 既定3件・最大5件、`search_depth` は `basic` 固定。要約生成と本文の全文取得は使わない |
| 失敗したとき | 相談は止めない。ツールがエラーを返し、モデルは分かる範囲で答える（フェイルソフト） |
| 出典 | 回答に URL を載せる。チャットの吹き出し側でリンクとして描画する |
| 情報源の国 | `country: japan` で日本に寄せる。プロンプト側でも日本語の情報源を優先させる |

情報源を日本に寄せているのは、実機で「獺祭の今年の新酒」を聞いたときに、旭酒造の**台湾サイト**（`dassai.com/tw`）と中華圏の日本酒メディアが出典に出てきたため。日本語で検索しても、地域を縛らないと同じ蔵の海外向けページが上位に来る。扱っている商品も価格も日本と違うので、日本での発売や相場を聞かれているときの根拠にはならない。API 側の国指定とシステムプロンプトの二段構えにしてある。

なお `country` パラメータの仕様は Tavily の公式ドキュメントで裏取りできていない（クラウドセッションからは `docs.tavily.com` へ到達できない）。受け付けられなかった場合に検索そのものが死なないよう、**400 / 422 が返ったら国指定を外して1回だけ取り直し、以降はそのプロセスでは付けない**ようにしている。外したことは警告ログに残るので、そこで気づける。500 やタイムアウトでは取り直さない（失敗のたびに費用と待ち時間が倍になるため）。

検索結果は外部サイトの本文なので、記録やメモとは別の印を付けて指示と分けてモデルへ渡す。他人のブログの文章が「このユーザーの好み」として扱われないようにするため。出典の URL は形式を確かめ、通らないものは結果ごと捨てる（出典を示せない引用は、作り話と見分けが付かない）。

キーを読む権限は Runtime ロールに `secretsmanager:GetSecretValue` を1つ、**そのシークレットの ARN だけ**に付ける。テーブル名と同じく `agentcore.json` の `envVars` を唯一の定義元にして、CDK 側はそれを読むだけにしている（設定ドリフト防止）。`TAVILY_API_KEY_SECRET_ID` を消せば権限も付かず、エージェント側も検索ツールを持たないまま動く。

キーはデプロイ前に1回、Secrets Manager へ手で登録する（[docs/operations.md](docs/operations.md)）。登録せずにデプロイしても壊れない。キーが読めなければ検索は無効のままで、記録と一般知識だけで相談に答える。

### 失敗したときの切り分け

以前はどんな失敗でも「応答の取得に失敗しました」の一文だったため、画面からもログからも原因を絞れなかった。いまは失敗を4種類に分けて扱う（`src/features/sommelier/lib/errors.ts`）。

| 種類 | 画面の文言 | 主な原因 |
|------|-----------|---------|
| `auth` | サインインの有効期限が切れたかも〜 | トークンの取得・更新に失敗、Runtime が 401/403 を返した |
| `network` | 通信に失敗しました〜 | fetch が届かなかった（接続断・CORS 拒否など）、受信途中で切れた |
| `server` | ソムリエが応答できませんでした（HTTP xxx）〜 | Runtime までは届いたが 5xx、またはエージェントがエラーを返した |
| `unknown` | 応答の取得に失敗しました〜 | 上記以外 |

ブラウザのコンソールには `ソムリエへの問い合わせに失敗しました [種類]:` の形で種類が出る。停止ボタンによる中断はエラー扱いせず、受信済みの内容を残して静かに終わる。

Runtime まで届いていたかどうかは、CloudWatch Logs でも確認できる（[docs/operations.md](docs/operations.md)）。

### ソムリエの開発・デプロイ

```bash
# ローカル実行（COGNITO_* は LOCAL_DEV=1 と同時に設定不可）
cd sommelier/app/sommelier
AWS_PROFILE=<アプリ用のプロファイル> PURCHASE_TABLE_NAME=dev-sakekasu-purchase-records \
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

手で打つのは、ワークフローが使えないとき（Actions の障害、ワークフロー自体の修正中）と、`agentcore` CLI でしかできない操作をするときだけ。手順と、`agentcore deploy` の落とし穴（CDK の依存を勝手に上げる・`npx cdk` が CLI ではない）、デプロイ後に好み学習が生きているかの確かめ方は [docs/operations.md](docs/operations.md) にある。

Runtime の ARN はフロントの `src/features/sommelier/config.ts` に持つ（`VITE_SOMMELIER_RUNTIME_ARN` で上書き可）。Runtime を作り直したら更新する。

## 監視とアラート通知

異常を人間が気づく前に Slack へ流す。きっかけは、ソムリエが数時間おかしくなったのに気づけず、原因の切り分けにも時間がかかったこと。

```
CloudWatch アラーム ─┐
外形監視 Lambda ─────┴→ SNS（共通基盤の sakekasu-integrated-alerts）┬→ Slack 通知 Lambda → Slack（Incoming Webhook）
                                                                  └→ 転送 Lambda → DevOps Agent（自動調査）
```

送り先のトピックと、その先の Slack 通知・DevOps Agent への転送は共通基盤
（[sakekasu-integrated_environment](https://github.com/yuuuuuuu168/sakekasu-integrated_environment) の `docs/monitoring.md`）が持つ。
4 アプリのアラームが同じ経路を通る。builder が以前持っていた自分のトピック（`dev-sakekasu-alerts`）と
Slack 通知 Lambda（`sakekasu-builder-dev-slack-notifier`）は、送り先を移したあとに消した（2026-10）。

アラームは**発報だけでなく復旧も通知する**ので、鳴りっぱなしなのか直ったのかが Slack だけで分かる。

### 監視項目（22アラーム）

| 分類 | 監視対象 | 発報条件 |
|------|---------|---------|
| AI・ソムリエ | 認証拒否（`InboundAuthorizationFailure`） | 5分で3回以上。例外の種類ごとに分けて監視 |
| AI・ソムリエ | システムエラー / スロットル | 5分で1回以上 |
| AI・OCR | Lambda エラー | 15分で3回以上 |
| AI・OCR | スロットル | 15分で1回以上 |
| AI・OCR | SLO の達成率（可用性・レイテンシー） | 30日 rolling の達成率が 90% を割ったら |
| AI・OCR / ノート | Claude API から Bedrock へのやり直し（`[llm] fallback`） | 1時間で3回以上 |
| サービス | AppSync 5XX | 5分で5回以上 |
| サービス | Lambda エラー（presigned-url / ocr-analyzer / tasting-note） | 15分で5回以上 |
| サービス | DynamoDB スロットル（2テーブル） | 5分で1回以上 |
| サービス | 画像削除の失敗 | 1時間で5回以上 |
| 外形監視 | ソムリエ Runtime / AppSync（サイトそのものは共通基盤が見る） | 2回続けて到達不可 |
| 監視自体 | 外形監視の実行失敗 | 1回以上 |
| 監視自体 | 外形監視が動いていない | 1時間の実行回数が0 |

監視そのものが動かなくなると異常に気づけないため、**外形監視も監視対象**に含めている。通知の経路（Slack 通知と DevOps Agent への転送）の失敗は、共通基盤が監視している。「エラーで失敗した」だけでなく「**そもそも動いていない**」も見る。スケジュールが止まるとエラーすら記録されず、静かに監視が消えるため。

既定では「データが無い＝異常なし」として扱うが、欠損そのものに意味がある指標は例外にしている。

- **SLO の達成率**: `MISSING`（状態を保持）。30日 rolling で動きが遅く、値が途切れたときに既定のままだと、未達のまま復旧扱いになる
- **実行回数の監視**: `BREACHING`（欠損は異常）。記録が無いことが「動いていない」ことを意味するため

**認証拒否の監視が今回の障害への直接の答え**。実際に障害当時のメトリクスを確認したところ、`UnauthorizedInboundTokenException` が3回記録されていた。これを監視していれば即座に気づけた。

AWS Health の通知は共通基盤（[sakekasu-integrated_environment](https://github.com/yuuuuuuu168/sakekasu-integrated_environment) の `docs/monitoring.md`）が持つ。
アカウント全体の話で、4 アプリのどれか1つが持つものではないため。

### 外形監視の考え方

到達性の確認（5分ごと）は、**認証情報を持たずに**行う。ソムリエ Runtime と AppSync はあえて認証なしで叩き、**401/403 が返ることを正常**とみなす。これで「エンドポイントが生きている」ことと「認証が働いている」ことを、監視側に鍵を持たせずに確認できる。

### デプロイ前の準備

監視スタックのデプロイ前に手で登録するものは無い。Slack の Webhook URL は共通基盤が持ち、builder は持たない。

デプロイは main へのマージで `deploy.yml` が cdkd で行う（下の「デプロイ（CDK）」）。

Runtime の ARN は CDK コンテキスト（`sommelierRuntimeArn`）で差し替えられる。
サイト（`sake.sakekasu-builder.com`）の外形監視はこのリポジトリでは持たず、共通基盤（sakekasu-integrated_environment）の `healthChecks` の `builder` が見る。
`infra/cdk.json` の context に書いてマージする。監視スタックは cdkd の管理下なので、手元から `cdk deploy` は打たない
（CloudFormation のスタックが別に作られ、リソースが二重になる）。

### 費用の目安

概算で**月5ドル前後**。内訳は CloudWatch アラーム22件（$0.10/件）とカスタムメトリクス（$0.30/種）が大半で、Lambda・SNS は無料枠にほぼ収まる。SLO とトレースの費用は Application Signals 側で別立てになる（月数十円から数百円の見込み。[docs/application-signals.md](docs/application-signals.md)）。

## 毎日の利用料金 Slack 通知（Issue #92）

AWS の利用料金を毎日 09:05 JST に Slack へ通知する。**組織全体の合計 → sakekasu-builder** の順で表示し、実際に請求される額だけでなく**クレジットで賄われた分**も載せる（クレジット適用前の利用額・クレジット適用額・請求見込みの3点）。それぞれに**サービス別内訳**（今月・クレジット適用前・Tax は集計から除外）を実サービス名で上位5位まで添え、6位以下は「その他」に合算する。組織全体の合計は全アカウント分を足すため、個別表示していないアカウントの費用も漏れない。

```
EventBridge（毎日 00:05 UTC）→ billing-notifier Lambda → Cost Explorer API
                                        └→ Slack Incoming Webhook
```

### 他のスタックとの違い

アカウント別の内訳（`LINKED_ACCOUNT`）を Cost Explorer で見られるのは **Organization の管理アカウントだけ**のため、このスタック（`sakekasu-billing-notifier`）は他と違い**管理アカウントへデプロイする**。管理アカウントの ID はリポジトリに書かず、`-c billingAccount`（または環境変数 `BILLING_ACCOUNT_ID`）で渡す。環境（dev/staging/prod）にも紐づかない単一のスタックで、通常の `cdkd deploy --all` に混ざらないよう `-c billing=true` を付けたときだけ合成される。

対象アカウントの一覧（表示ラベル含む）は `infra/bin/app.ts` の `targetAccounts` で変更できる。

### 監視

レポートが止まっても気づけるよう、3つのアラーム（レポート Lambda の失敗・1日以上の沈黙・Slack 通知の失敗）を同じスタック内に持つ。通知経路は監視スタックと同じ Slack 通知 Lambda の実装を再利用している。

### デプロイ手順（管理アカウント）

Actions の対象外で、管理アカウントへ手でデプロイする。手順は [docs/operations.md](docs/operations.md) にある。

数値は Cost Explorer の集計途中の概算（UTC 日単位）で、確定額は請求書と一致しないことがある。月初日の実行では「今月累計」が空になるため、前月まるごとを「確定」として通知する。Cost Explorer API は 1 リクエスト $0.01 で、1日3回の呼び出し（アカウント別の今月・昨日、サービス別の今月）なので**月1ドル前後**。

## DevOps Agent による自動インシデント調査（Issue #67）

アラームが鳴ってから調べ始めるまでの時間をなくすため、CloudWatch アラームの発報をそのまま AWS DevOps Agent に渡して調査を始めさせる。エージェントがテレメトリ・ログ・デプロイ履歴を突き合わせ、根本原因と緩和策を専用の Slack チャンネルに投稿する。

```
SNS（共通基盤の sakekasu-integrated-alerts）┬→ Slack 通知 Lambda → Slack（既存のアラートチャンネル）
                                            └→ 転送 Lambda → DevOps Agent Webhook → 自動調査 → Slack（専用チャンネル）

人 ⇄ Slack（双方向用プライベートチャンネル）⇄ DevOps Agent
```

転送 Lambda は Slack 通知と同じトピックをもう1つの購読者として受け取るだけなので、エージェント側が止まってもアラート自体は届く。

転送 Lambda は以前このリポジトリにあり、builder のトピックだけを購読していた。kakeibo・learning・reinvent のアラームも調査に回すため、共通基盤へ移した（2026-10）。
builder のアラームも共通トピックへ送るようにしたので、調査に回る範囲は前と変わらない。

Agent Space は運用ツール専用アカウント（`ops-tooling`）に置き、調査対象はアプリ本体のアカウント（`<アプリのアカウント ID>`）。このリポジトリの CDK が作るのは、調査用のクロスアカウントロール（読み取り専用）だけ。Agent Space の作成・Slack 連携・GitHub 連携・Webhook の発行はコンソールでの手作業になる。

エージェントは秒課金なので、投げるものを絞っている。アラームは `ALARM` に変わったときだけ（復旧では投げない）、AWS Health は障害（`issue`）だけ、転送 Lambda 自身の失敗アラームは捨てる。判定は共通基盤の `infra/lambda/devops-agent-webhook` にある。

調査結果を読んだ先で追加の指示を出したくなるぶんは、双方向用のプライベートチャンネルで受ける。メンションで調査を始めたり、経過や根拠を聞いたりできて、返答は元メッセージのスレッドに積まれる。双方向はプライベートチャンネルでしか有効にできず、有効化には `AIDevOpsChannelAccessPolicy` を付けた IAM ロールが要る。CloudFormation 側に双方向のフィールドが無いため、この設定はコンソールでの手作業になる。

エージェントに渡してある権限は読み取り専用のクロスアカウントロールだけなので、Slack から何を頼んでもアプリ側のリソースは変わらない。

`agentSpaceArn` があるときだけスタックが合成される。ARN は運用ツール用アカウントの ID を含むので `cdk.json` には書かず、Actions では secret `AGENT_SPACE_ARN`、手元では `-c agentSpaceArn` か環境変数 `AGENT_SPACE_ARN` で渡す（[docs/devops-agent.md](docs/devops-agent.md)）。

デプロイはほかの infra のスタックと同じく、main へのマージで `deploy.yml` が cdkd で行う（secret の `AGENT_SPACE_ARN` を渡す）。

セットアップ手順、優先度の割り当て、カスタムスキルに入れる運用ナレッジ、費用の詳細は [docs/devops-agent.md](docs/devops-agent.md) にまとめてある。

## Application Signals による APM（Issue #86）

既存の監視は「異常が起きたこと」までは知らせてくれるが、そこから先の切り分けはログの突き合わせに頼っていた。リクエスト単位のトレースと、レイテンシー・エラー率・リクエスト数を自動で集めてそこを埋める。

計装が入っているのは OCR（`ocr-analyzer`）と画像アップロードの入口（`presigned-url`）の2つ。アカウント側の設定（サービス検出・Transaction Search）はソムリエの GenAI Observability を入れたときから有効で、アカウントに1つの設定なので CDK では管理していない。

外形監視の関数（health-check）は計装しない。監視の監視は既存のアラームで足りていて、増やすとノイズと費用だけが増えるため。この関数は従来どおり Lambda 標準メトリクス由来のエラー率と実行時間までしか見えない。計装が無かった頃でもエラー率は追えたので、それで既存のバグを1件見つけている（[51be30d](https://github.com/yuuuuuuu168/sakekasu-builder/commit/51be30d1a106bc1251501bbb7a831b555f0ca3f8)）。

SLO は OCR に2本置いてある。どちらも30日 rolling で、成功率 90% と「90% が15秒未満」。しきい値は日次の実測（p50/p90/p99）から決めた。割ったらアラームが鳴り、そのしきい値は SLO の目標と同じ定数から取っている。別々に書くと、片方だけ動かしたときに「SLO は未達なのにアラームは鳴らない」が黙って生まれる。

計装の対象を絞った理由、デプロイ後の確認手順、しきい値の根拠、費用は [docs/application-signals.md](docs/application-signals.md) にまとめてある。

## 構成

| スタック | アカウント / リージョン | デプロイ | 中身 |
|---|---|---|---|
| `sakekasu-dev-api` | アプリ / ap-northeast-1 | cdkd（deploy.yml） | AppSync、DynamoDB 2 本、画像の S3、Lambda 3 本 |
| `sakekasu-dev-monitoring` | アプリ / ap-northeast-1 | cdkd（deploy.yml） | アラーム、SLO、外形監視（送り先は共通基盤の SNS） |
| `sakekasu-dev-devops-agent` | アプリ / ap-northeast-1 | cdkd（deploy.yml） | DevOps Agent が読みに来るクロスアカウントロール |
| `sakekasu-dev-site-dns` | アプリ / ap-northeast-1 | cdkd（deploy.yml） | `sake.sakekasu-builder.com` のゾーン |
| `sakekasu-dev-site` | アプリ / us-east-1 | cdkd（deploy.yml） | 画面の S3、CloudFront、Route 53 レコード |
| `AgentCore-sommelier-dev` | アプリ / ap-northeast-1 | CDK（deploy-sommelier.yml） | ソムリエの AgentCore Runtime と Memory |
| `sakekasu-github-oidc` | アプリ / ap-northeast-1 | CloudFormation（手動） | OIDC プロバイダーと Actions 用のロール |
| `sakekasu-billing-notifier` | 管理 / ap-northeast-1 | CloudFormation（手動） | 毎日の利用料金の通知 |

## 技術スタック

- React 19 + TypeScript 5.9
- Vite 7
- Tailwind CSS v4
- shadcn/ui（@base-ui/react ベース）
- Framer Motion
- AWS CDK + [cdkd](https://github.com/go-to-k/cdkd)（AppSync + DynamoDB）
- Amazon Cognito（4 アプリ共通のユーザープールとマネージドログイン。[docs/shared-login.md](docs/shared-login.md)）
- AWS S3（画像ストレージ）
- S3 + CloudFront + Route 53（フロントエンドの配信。[docs/sake-subdomain.md](docs/sake-subdomain.md)）。`aws-amplify` はライブラリとして認証と GraphQL のクライアントに使う
- Amazon Bedrock AgentCore Runtime + AgentCore Memory + Strands Agents（Python）※ソムリエ
- Claude API（Claude Haiku 5.5。API キーなしの Workload Identity Federation）※OCR・テイスティングノート・ソムリエ。失敗したら Amazon Bedrock（Claude Haiku 4.5）でやり直す（[docs/claude-api.md](docs/claude-api.md)）
- Tavily ※テイスティングノートとソムリエの Web 検索
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
  lib/           # CDK スタック（api / monitoring / site / site-dns /
                 #   billing-notifier / devops-agent / github-oidc）と
                 #   ガードレール・Permissions Boundary
  graphql/       # AppSync GraphQL スキーマ
  lambda/        # Lambda 関数（presigned-url, ocr-analyzer, tasting-note,
                 #              health-check, billing-notifier,
                 #              slack-notifier（料金通知の送り出し）, shared）
  scripts/       # amplify_outputs.json 生成、CI の補助（lockfile の検査、diff のコメント）
sommelier/       # AgentCore プロジェクト（ソムリエエージェント）
  app/sommelier/ # Strands Agent 本体（Python）
  agentcore/     # AgentCore 設定と CDK
docs/            # 設計ドキュメント
theme/           # 共通テーマ（sakekasu-template から同期）
scripts/         # クラウドセッション用の補助（AWS SSO ログイン、フック）
.claude/         # Claude Code の設定と AI-DLC（使い方は CLAUDE.md）
aidlc/           # AI-DLC のルールと成果物
.github/         # GitHub Actions（test / cdk-diff / deploy / deploy-sommelier /
                 #   deploy-site / claude-review / claude-hooks）
```

## ドキュメント

| ドキュメント | 内容 |
|------------|------|
| [docs/claude-api.md](docs/claude-api.md) | Claude API への切り替え（ID 連携・Bedrock へのフォールバック・環境変数・IAM の差分・有効にする手順） |
| [docs/shared-login.md](docs/shared-login.md) | 共通ログインへの切り替え（変わったこと・旧プールを外す手順・カナリア・旧 sub から新 sub へのデータの付け替えの記録） |
| [docs/devops-agent.md](docs/devops-agent.md) | DevOps Agent のセットアップ手順・Slack の双方向通信・優先度の割り当て・カスタムスキル・費用 |
| [docs/application-signals.md](docs/application-signals.md) | Application Signals の計装対象・デプロイ後の確認手順・SLO の決め方・費用 |
| [docs/claude-code-web.md](docs/claude-code-web.md) | Claude Code on the web での開発環境（外出先から PR まで） |
| [docs/cdkd-migration.md](docs/cdkd-migration.md) | cdkd（CDK Direct）への移行の手順と記録 |
| [docs/log-group-import.md](docs/log-group-import.md) | 既存ロググループのスタック取り込み（`logRetention` からの移行） |
| [docs/sake-subdomain.md](docs/sake-subdomain.md) | `sake.sakekasu-builder.com` への移行（S3 + CloudFront での配信とサブドメインの委任）の手順と記録 |
| [docs/agent-verify-permission-set.md](docs/agent-verify-permission-set.md) | クラウドセッションから AWS を見るための読み取り専用 Permission Set |
| [docs/operations.md](docs/operations.md) | 手で打つ運用手順（ソムリエの手動デプロイと確認・利用料金通知のデプロイ・OIDC の初回セットアップ） |
| [docs/npm-audit.md](docs/npm-audit.md) | npm audit への対応の記録（本番に入る依存の見分け方・依存の更新） |
| [CLAUDE.md](CLAUDE.md) | 開発の進め方（ブランチ運用・AI-DLC・AWS 確認の認証フロー） |

## セットアップ

```bash
# フロントエンド
npm install
npm run dev

# インフラ（CDK）※デプロイは Actions 経由。ここでは差分の確認まで
cd infra
npm install
AWS_PROFILE=<アプリ用のプロファイル> npx cdkd diff --all -c env=dev
```

デプロイ後に AppSync のエンドポイント等が変わったときは、`infra/scripts/generate-outputs.ts` を実行して `amplify_outputs.json` を作り直す。認証の値（共通ログイン）は `infra/cdk.json` の `sharedAuth` から書く。

手元の画面からソムリエを使うときは、Runtime の ARN を `.env.local` に `VITE_SOMMELIER_RUNTIME_ARN=<ARN>` で置く。ARN はアカウント ID を含むのでリポジトリには書いていない（本番のビルドでは `deploy-site.yml` が組み立てる）。値は agentcore CLI がローカルに書く `sommelier/agentcore/.cli/deployed-state.json` の `runtimeArn` と同じ。

ローカルの画面（`npm run dev`）も共通ログインでログインする。戻り先として登録してあるのは `http://localhost:5173/` だけなので、ポートを変えるとログインできない。

## デプロイ（CDK）

**デプロイは main へのマージ経由のみ。ローカルからの手動 `cdk deploy` / `cdkd deploy` は原則禁止**（Issue #94）。
infra のスタックは [cdkd](https://github.com/go-to-k/cdkd) の管理下にあり、`cdk deploy` を打つと CloudFormation のスタックが別に作られてリソースが二重になる。

- main に push（= PR マージ）されると GitHub Actions が対象を分けてデプロイする
  - `infra/**` → `.github/workflows/deploy.yml` が `cdkd deploy --all`（状態は S3 の `cdkd-state-<アカウント ID>`）
  - `sommelier/**` → `.github/workflows/deploy-sommelier.yml` が AgentCore スタックを `aws-cdk deploy --all`
  - 画面 → `.github/workflows/deploy-site.yml` がビルドして S3 へ同期
- PR を開くと `cdkd diff` の結果が自動でコメントされる（`.github/workflows/cdk-diff.yml`。対象は infra のみ。フォークと Dependabot の PR では走らない）
- 認証は OIDC（`sakekasu-github-oidc` スタックのロール）。リポジトリにアクセスキーは置かない

ワークフローを分けているのは、`paths` がワークフロー単位でしか効かないため。1つにまとめると、片方だけの変更でもう片方のデプロイまで走る。

### アカウント ID の渡し方

公開リポジトリなので、AWS アカウント ID はリポジトリに書かない（[#32](https://github.com/yuuuuuuu168/sakekasu-builder/pull/32)）。`infra/__tests__/no-account-ids.test.ts` が、ダミー以外の 12 桁の数字が入ると落ちる。

| 使う場所 | 渡し方 |
| --- | --- |
| Actions（deploy / cdk-diff / deploy-site / deploy-sommelier） | リポジトリの secret `AWS_ACCOUNT_ID`（Settings → Secrets and variables → Actions） |
| CDK（`infra/`、`sommelier/agentcore/cdk/`） | `CDK_DEFAULT_ACCOUNT`。手元の `cdkd diff` などでは認証情報から入る |
| 証明書（`infra/cdk.json`） | `siteCertificateId` に ID だけを置き、ARN はアカウントと組み合わせて作る |
| 画面のソムリエ | ビルド時の `VITE_SOMMELIER_RUNTIME_ARN`（`deploy-site.yml` が secret から組み立てる） |
| AWS 確認用の verify プロファイル | クラウド環境の Environment variables の `SSO_ACCOUNT_ID`（`scripts/aws-verify.conf`） |
| `sakekasu-billing-notifier` | `-c appAccount` か環境変数 `APP_ACCOUNT_ID` |

例外として、以下は今までどおり手動デプロイする:

- `sakekasu-billing-notifier`（管理アカウント宛て。`-c billing=true`）
- `sakekasu-github-oidc`（OIDC 連携自体。Actions に自分のロールを触らせないため。`-c github-oidc=true`）

手順は [docs/operations.md](docs/operations.md) にある。

### cdkd（CDK Direct）

infra のデプロイは CloudFormation を経由しない [cdkd](https://github.com/go-to-k/cdkd) で行う。移行の手順と記録は [docs/cdkd-migration.md](docs/cdkd-migration.md) にある。

## テスト

```bash
# フロントエンド（Vitest）。src/ に絞るのは、root の vitest が
# infra と sommelier のテストまで拾って import を解決できずに落ちるため
npx vitest run src/

# インフラ（CDK の synth テスト）
cd infra
npm test

# ソムリエ本体（pytest。AWS へは出ない）
cd sommelier/app/sommelier
uv run pytest

# ソムリエの CDK（記憶の作成・環境変数・IAM の synth テスト）
cd sommelier/agentcore/cdk
npm ci && npm test
```

同じものを PR のたびに GitHub Actions が走らせる（`.github/workflows/test.yml`）。マージ後は deploy 系のワークフローがデプロイの前に同じテストを通す。フロントは lint と型検査も込みで、系統ごとに別のジョブに分けてある。片方が落ちても、もう片方の結果が残るようにするため。

## デザイン

「和モダン」コンセプト。ダークモード対応、カスタムカラーパレット（`indigo-wa` / `gold-wa` / `dark-bg` / `dark-gold`。`src/index.css` で定義）。

## Claude Code（クラウド環境）

claude.ai/code のクラウドセッションで開発する。セッションは GitHub へ push と PR 作成まで行い、マージは人が行う。
AWS へは読み取り専用の SSO（`verify` / `verify-org` / `verify-ops`。3 アカウントとも Permission Set `AgentVerifyAccess`）だけで入り、
変更操作は `PreToolUse` フックでも止める。AI-DLC v2 のフックとスキルも入れてある（[.claude/CLAUDE.md](.claude/CLAUDE.md)）。
フック・MCP・環境の作り方は [docs/claude-code-web.md](docs/claude-code-web.md)、運用ルールは [CLAUDE.md](CLAUDE.md) にある。
