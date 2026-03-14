# 要件ドキュメント: 飲んだお酒の登録

## はじめに

「sakekasu-builder.com」の機能2として、ユーザーが飲んだお酒の情報を登録できるページを提供する。ユーザーはどこで、いくらで、どんな銘柄のお酒を飲んだか、そしてどれくらい好みだったかを記録できる。この飲酒記録は将来の「おすすめ提案」機能のベースデータとしても活用される。既存の購入登録機能（sake-purchase-registration）と同じ技術スタック・設計パターンを踏襲する。

## 用語集

- **Drinking_Registration_Page**: 飲んだお酒の情報を入力・登録するためのWebページ。AWS Amplifyでホスティングされる
- **Drinking_Record**: 1回の飲酒体験に対応するデータレコード。銘柄名、飲んだ場所、価格、飲んだ日、カテゴリ、飲み方、提供形態、評価、メモを含む
- **User**: sakekasu-builder.comにアクセスし、お酒の飲酒情報を登録する利用者
- **Sake_Category**: お酒の種類を分類するための区分（日本酒、ビール、ワイン、ウイスキー、焼酎、その他）。既存の購入登録機能と共有する列挙型
- **Serving_Style**: お酒の提供形態を分類するための区分（グラス、一合、ボトル、缶、その他）
- **Drinking_Method**: お酒の飲み方を分類するための区分。Sake_Categoryに応じて選択肢が動的に変わる。各カテゴリの選択肢は以下の通り:
  - 日本酒: 冷酒、常温、ぬる燗、熱燗、その他
  - ビール: 生、瓶、缶、その他
  - ワイン: そのまま、その他
  - ウイスキー: ストレート、ロック、水割り、ハイボール、トワイスアップ、ミスト、その他
  - 焼酎: ストレート、ロック、水割り、お湯割り、ソーダ割り、その他
  - その他: その他
- **Rating**: 飲んだお酒に対するユーザーの好みの評価。1から5の整数値で表現する（1: 好みでない 〜 5: とても好み）
- **Form_Validator**: 登録フォームの入力値を検証するコンポーネント
- **Drinking_Storage**: Drinking_Recordを永続化し、取得するためのAWSマネージドデータストア（Amazon DynamoDB）
- **Amplify_App**: AWS Amplify上でホスティングされるsakekasu-builder.comのWebアプリケーション

## 要件

### 要件1: 飲酒情報の入力フォーム表示

**ユーザーストーリー:** ユーザーとして、飲んだお酒の情報を入力するフォームを表示したい。それにより、飲酒体験の詳細を正確に記録できる。

#### 受け入れ基準

1. WHEN Userが飲酒登録ページにアクセスしたとき, THE Drinking_Registration_Page SHALL 以下の入力フィールドを含むフォームを表示する: 銘柄名（必須）、飲んだ場所（必須）、価格（任意）、飲んだ日（必須）、Sake_Category（必須）、Drinking_Method（必須）、Serving_Style（必須）、Rating（必須）、メモ（任意）
2. THE Drinking_Registration_Page SHALL 飲んだ日フィールドの初期値として当日の日付を設定する
3. THE Drinking_Registration_Page SHALL Sake_Categoryフィールドを選択式（日本酒、ビール、ワイン、ウイスキー、焼酎、その他）で提供する
4. WHEN UserがSake_Categoryを選択したとき, THE Drinking_Registration_Page SHALL Drinking_Methodフィールドの選択肢を選択されたカテゴリに対応する飲み方リストに動的に更新する
5. WHEN UserがSake_Categoryを変更したとき, THE Drinking_Registration_Page SHALL Drinking_Methodの選択値をリセットする
6. THE Drinking_Registration_Page SHALL Serving_Styleフィールドを選択式（グラス、一合、ボトル、缶、その他）で提供する
7. THE Drinking_Registration_Page SHALL Ratingフィールドを1から5の星評価UIで提供する

### 要件2: 入力値のバリデーション

**ユーザーストーリー:** ユーザーとして、入力内容に不備がある場合にエラーを確認したい。それにより、正しい情報を登録できる。

#### 受け入れ基準

1. WHEN Userが必須フィールド（銘柄名、飲んだ場所、飲んだ日、Sake_Category、Drinking_Method、Serving_Style、Rating）を空のまま登録を試みたとき, THE Form_Validator SHALL 該当フィールドの横にエラーメッセージを表示する
2. WHEN Userが価格フィールドに数値以外の値を入力したとき, THE Form_Validator SHALL 「価格は0以上の数値で入力してください」というエラーメッセージを表示する
3. WHEN Userが価格フィールドに負の値を入力したとき, THE Form_Validator SHALL 「価格は0以上の数値で入力してください」というエラーメッセージを表示する
4. WHEN Userが未来の日付を飲んだ日に入力したとき, THE Form_Validator SHALL 「飲んだ日は本日以前の日付を入力してください」というエラーメッセージを表示する
5. WHEN Userが1から5の範囲外の値をRatingに設定しようとしたとき, THE Form_Validator SHALL Ratingの値を1から5の範囲内に制限する
6. WHEN 全ての必須フィールドが正しく入力されているとき, THE Form_Validator SHALL 登録ボタンを有効にする

### 要件3: 飲酒情報の登録

**ユーザーストーリー:** ユーザーとして、入力した飲酒情報を保存したい。それにより、後から飲酒履歴を振り返ることができる。

#### 受け入れ基準

1. WHEN Userが有効な入力内容で登録ボタンを押したとき, THE Drinking_Registration_Page SHALL Drinking_Recordを生成しDrinking_Storageに保存リクエストを送信する
2. WHEN Drinking_Recordの保存が成功したとき, THE Drinking_Registration_Page SHALL 「登録が完了しました」という成功メッセージを表示する
3. WHEN Drinking_Recordの保存が成功したとき, THE Drinking_Registration_Page SHALL フォームの入力内容を初期状態にリセットする
4. IF Drinking_Storageへの保存リクエストが失敗した場合（ネットワークエラーやサービス障害を含む）, THEN THE Drinking_Registration_Page SHALL 「登録に失敗しました。もう一度お試しください」というエラーメッセージを表示する
5. IF Drinking_Storageへの保存リクエストが失敗した場合, THEN THE Drinking_Registration_Page SHALL 入力内容を保持し、Userが再送信できる状態を維持する

### 要件4: 飲酒記録のデータ構造

**ユーザーストーリー:** 開発者として、飲酒記録のデータ構造を明確にしたい。それにより、一覧表示機能やおすすめ提案機能との連携を円滑に行える。

#### 受け入れ基準

1. THE Drinking_Record SHALL 以下のフィールドを持つ: 一意のID、銘柄名（文字列）、飲んだ場所（文字列）、価格（0以上の整数、null許可）、飲んだ日（日付）、Sake_Category（列挙型）、Drinking_Method（文字列）、Serving_Style（列挙型）、Rating（1から5の整数）、メモ（文字列、空文字許可）、登録日時（タイムスタンプ）
2. THE Drinking_Storage SHALL Drinking_Recordを登録日時の降順で取得できる機能を提供する
3. FOR ALL 有効なDrinking_Record, Drinking_Storageに保存した後に取得した結果は元のDrinking_Recordと同等の内容を持つ（ラウンドトリップ特性）

### 要件5: 連続登録のサポート

**ユーザーストーリー:** ユーザーとして、複数のお酒を続けて登録したい。それにより、飲み会で複数の銘柄を飲んだ際に効率よく記録できる。

#### 受け入れ基準

1. WHEN Drinking_Recordの保存が成功したとき, THE Drinking_Registration_Page SHALL フォームをリセットした状態で同じページに留まり、続けて新しい飲酒情報を入力できる状態にする
2. WHEN Userが連続して登録を行うとき, THE Drinking_Registration_Page SHALL 各登録ごとに成功メッセージを表示する
3. WHEN Drinking_Recordの保存が成功しフォームがリセットされたとき, THE Drinking_Registration_Page SHALL 飲んだ場所の値を前回の入力値で保持する

### 要件6: 星評価UIの操作性

**ユーザーストーリー:** ユーザーとして、直感的に好みの評価を入力したい。それにより、素早く正確に好みを記録できる。

#### 受け入れ基準

1. THE Drinking_Registration_Page SHALL Ratingフィールドを5つの星アイコンで表示し、タップまたはクリックで評価値を設定できるUIを提供する
2. WHEN Userが星アイコンをクリックしたとき, THE Drinking_Registration_Page SHALL クリックされた星までを塗りつぶし状態で表示し、残りを空の状態で表示する
3. THE Drinking_Registration_Page SHALL 現在選択されているRatingの数値（1〜5）を星アイコンの近くにテキストで表示する
4. THE Drinking_Registration_Page SHALL Ratingフィールドの初期値を未選択状態とする
