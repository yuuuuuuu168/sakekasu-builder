# 要件ドキュメント: 購入したお酒の登録

## はじめに

「sakekasu-builder.com」における最初の機能として、ユーザーが購入したお酒の情報を登録できるページを提供する。ユーザーはどこで、いくらで、どんな銘柄のお酒を購入したかを記録し、自身の購入履歴を管理できるようにする。本アプリケーションはAWS Amplifyを利用してホスティングされるクラウドWebアプリケーションであり、バックエンドのデータストアにはAWSのマネージドサービスを活用する。

## 用語集

- **Purchase_Registration_Page**: 購入したお酒の情報を入力・登録するためのWebページ。AWS Amplifyでホスティングされる
- **Purchase_Record**: 1回の購入に対応するデータレコード。銘柄名、購入店舗、購入価格、購入日、カテゴリ、メモを含む
- **User**: sakekasu-builder.comにアクセスし、お酒の購入情報を登録する利用者
- **Sake_Category**: お酒の種類を分類するための区分（例: 日本酒、ビール、ワイン、ウイスキー、焼酎、その他）
- **Form_Validator**: 登録フォームの入力値を検証するコンポーネント
- **Purchase_Storage**: Purchase_Recordを永続化し、取得するためのAWSマネージドデータストア（例: Amazon DynamoDB）
- **Amplify_App**: AWS Amplify上でホスティングされるsakekasu-builder.comのWebアプリケーション

## 要件

### 要件1: 購入情報の入力フォーム表示

**ユーザーストーリー:** ユーザーとして、購入したお酒の情報を入力するフォームを表示したい。それにより、購入の詳細を正確に記録できる。

#### 受け入れ基準

1. WHEN Userが購入登録ページにアクセスしたとき, THE Purchase_Registration_Page SHALL 以下の入力フィールドを含むフォームを表示する: 銘柄名（必須）、購入店舗名（必須）、購入価格（必須）、購入日（必須）、Sake_Category（必須）、メモ（任意）
2. THE Purchase_Registration_Page SHALL 購入日フィールドの初期値として当日の日付を設定する
3. THE Purchase_Registration_Page SHALL Sake_Categoryフィールドを選択式（日本酒、ビール、ウイスキー、焼酎、その他）で提供する

### 要件2: 入力値のバリデーション

**ユーザーストーリー:** ユーザーとして、入力内容に不備がある場合にエラーを確認したい。それにより、正しい情報を登録できる。

#### 受け入れ基準

1. WHEN Userが必須フィールドを空のまま登録を試みたとき, THE Form_Validator SHALL 該当フィールドの横にエラーメッセージを表示する
2. WHEN Userが購入価格に数値以外の値を入力したとき, THE Form_Validator SHALL 「価格は0以上の数値で入力してください」というエラーメッセージを表示する
3. WHEN Userが購入価格に負の値を入力したとき, THE Form_Validator SHALL 「価格は0以上の数値で入力してください」というエラーメッセージを表示する
4. WHEN Userが未来の日付を購入日に入力したとき, THE Form_Validator SHALL 「購入日は本日以前の日付を入力してください」というエラーメッセージを表示する
5. WHEN 全ての必須フィールドが正しく入力されているとき, THE Form_Validator SHALL 登録ボタンを有効にする

### 要件3: 購入情報の登録

**ユーザーストーリー:** ユーザーとして、入力した購入情報を保存したい。それにより、後から購入履歴を振り返ることができる。

#### 受け入れ基準

1. WHEN Userが有効な入力内容で登録ボタンを押したとき, THE Purchase_Registration_Page SHALL Purchase_Recordを生成しPurchase_Storageに保存リクエストを送信する
2. WHEN Purchase_Recordの保存が成功したとき, THE Purchase_Registration_Page SHALL 「登録が完了しました」という成功メッセージを表示する
3. WHEN Purchase_Recordの保存が成功したとき, THE Purchase_Registration_Page SHALL フォームの入力内容を初期状態にリセットする
4. IF Purchase_Storageへの保存リクエストが失敗した場合（ネットワークエラーやサービス障害を含む）, THEN THE Purchase_Registration_Page SHALL 「登録に失敗しました。もう一度お試しください」というエラーメッセージを表示する
5. IF Purchase_Storageへの保存リクエストが失敗した場合, THEN THE Purchase_Registration_Page SHALL 入力内容を保持し、Userが再送信できる状態を維持する

### 要件4: 購入記録のデータ構造

**ユーザーストーリー:** 開発者として、購入記録のデータ構造を明確にしたい。それにより、一覧表示機能や他の機能との連携を円滑に行える。

#### 受け入れ基準

1. THE Purchase_Record SHALL 以下のフィールドを持つ: 一意のID、銘柄名（文字列）、購入店舗名（文字列）、購入価格（0以上の整数）、購入日（日付）、Sake_Category（列挙型）、メモ（文字列、空文字許可）、登録日時（タイムスタンプ）
2. THE Purchase_Storage SHALL Purchase_Recordを登録日時の降順で取得できる機能を提供する
3. FOR ALL 有効なPurchase_Record, Purchase_Storageに保存した後に取得した結果は元のPurchase_Recordと同等の内容を持つ（ラウンドトリップ特性）

### 要件5: 連続登録のサポート

**ユーザーストーリー:** ユーザーとして、複数のお酒を続けて登録したい。それにより、まとめ買いした際に効率よく記録できる。

#### 受け入れ基準

1. WHEN Purchase_Recordの保存が成功したとき, THE Purchase_Registration_Page SHALL フォームをリセットした状態で同じページに留まり、続けて新しい購入情報を入力できる状態にする
2. WHEN Userが連続して登録を行うとき, THE Purchase_Registration_Page SHALL 各登録ごとに成功メッセージを表示する
