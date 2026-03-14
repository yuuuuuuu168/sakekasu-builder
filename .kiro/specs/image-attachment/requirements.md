# 要件ドキュメント: 画像添付機能

## はじめに

「sakekasu-builder.com」の機能6として、購入登録・飲酒登録時にお酒のラベルや外観の写真を添付できる機能を提供する。添付された画像は Amazon S3 に保存し、一覧画面ではサムネイルとして表示する。認証済みユーザーが自身の記録にのみ画像を添付・閲覧できるよう、Cognito 認証と連携したセキュアなアップロード・ダウンロードの仕組みを構築する。

## 用語集

- **Image_Attachment**: 購入記録または飲酒記録に紐づく画像ファイル。お酒のラベルや外観の写真を想定する
- **Image_Upload_Area**: 登録フォーム内に配置される画像アップロード用のUIコンポーネント。ファイル選択とプレビュー表示を提供する
- **Image_Storage**: 画像ファイルを永続化する Amazon S3 バケット。認証済みユーザーのみアクセス可能
- **Presigned_URL**: S3 オブジェクトへの一時的なアクセスを許可する署名付きURL。アップロード用とダウンロード用がある
- **Image_Resolver**: AppSync GraphQL API 上で Presigned_URL の生成を担当するリゾルバー。Lambda 関数をデータソースとして使用する
- **Thumbnail**: 一覧画面で表示する縮小版の画像。元画像をクライアント側でリサイズして表示する
- **Purchase_Registration_Page**: 購入したお酒の情報を入力・登録するためのWebページ
- **Drinking_Registration_Page**: 飲んだお酒の情報を入力・登録するためのWebページ
- **Record_List_Page**: 購入記録と飲酒記録を一覧表示するページ
- **Record_Card**: 一覧ページ内で個々の記録を表示するカードコンポーネント
- **Authenticated_User**: Cognito で認証済みのユーザー
- **Image_Validator**: アップロードされる画像ファイルの形式を検証するコンポーネント
- **Image_Compressor**: 5MBを超える画像ファイルをクライアント側で自動圧縮し、5MB以下に縮小するコンポーネント。Canvas APIを使用してリサイズ・品質調整を行う

## 要件

### 要件1: 画像アップロードUIの表示

**ユーザーストーリー:** ユーザーとして、購入登録・飲酒登録フォームで画像を添付したい。それにより、お酒のラベルや外観を記録に残せる。

#### 受け入れ基準

1. THE Purchase_Registration_Page SHALL フォーム内にImage_Upload_Areaを表示する
2. THE Drinking_Registration_Page SHALL フォーム内にImage_Upload_Areaを表示する
3. THE Image_Upload_Area SHALL ファイル選択ボタンとドラッグ＆ドロップ領域を提供する
4. THE Image_Upload_Area SHALL 「画像を選択またはドラッグ＆ドロップ」という案内テキストを表示する
5. THE Image_Upload_Area SHALL 画像添付を任意項目として扱い、画像なしでも記録を登録できる状態を維持する
6. WHEN Authenticated_Userが画像ファイルを選択またはドロップしたとき, THE Image_Upload_Area SHALL 選択された画像のプレビューをサムネイルサイズで表示する
7. WHEN プレビューが表示されている状態で, THE Image_Upload_Area SHALL プレビュー画像の横に削除ボタン（×アイコン）を表示する
8. WHEN Authenticated_Userがプレビューの削除ボタンをクリックしたとき, THE Image_Upload_Area SHALL プレビューを除去し、画像未選択の初期状態に戻す

### 要件2: 画像ファイルのバリデーションと自動圧縮

**ユーザーストーリー:** ユーザーとして、対応していないファイル形式を選択した場合にエラーを確認し、大きすぎるファイルは自動的に圧縮されてほしい。それにより、ファイルサイズを気にせず画像を添付できる。

#### 受け入れ基準

1. THE Image_Validator SHALL 許可するファイル形式を JPEG（image/jpeg）と PNG（image/png）に限定する
2. WHEN Authenticated_Userが許可されていないファイル形式を選択したとき, THE Image_Validator SHALL 「JPEG または PNG 形式の画像を選択してください」というエラーメッセージを表示する
3. WHEN バリデーションエラーが発生したとき, THE Image_Upload_Area SHALL エラーの原因となったファイルを受け付けず、プレビューを表示しない
4. WHEN Authenticated_Userが5MBを超えるJPEGまたはPNG画像を選択したとき, THE Image_Compressor SHALL クライアント側で画像を自動圧縮し、ファイルサイズを5MB以下に縮小する
5. WHILE Image_Compressorが圧縮処理を実行中, THE Image_Upload_Area SHALL 「画像を圧縮中...」という進捗メッセージを表示する
6. WHEN Image_Compressorが圧縮を完了したとき, THE Image_Upload_Area SHALL 圧縮後の画像でプレビューを表示し、「画像を圧縮しました（元: {元サイズ}MB → {圧縮後サイズ}MB）」という通知メッセージを表示する
7. THE Image_Compressor SHALL 圧縮時に画像の品質を段階的に下げ、5MB以下になる最大の品質レベルを選択する
8. THE Image_Compressor SHALL 圧縮後の画像形式をJPEG（image/jpeg）として出力する
9. IF Image_Compressorが品質を最低レベルまで下げても5MB以下にならない場合, THEN THE Image_Compressor SHALL 画像の解像度を縮小して5MB以下に収める
10. IF Image_Compressorによる圧縮処理が失敗した場合, THEN THE Image_Upload_Area SHALL 「画像の圧縮に失敗しました。5MB以下の画像を選択してください」というエラーメッセージを表示する

### 要件3: 画像のアップロードと記録への紐づけ

**ユーザーストーリー:** ユーザーとして、画像付きで記録を登録したい。それにより、後から画像と一緒に記録を振り返ることができる。

#### 受け入れ基準

1. WHEN Authenticated_Userが画像付きで登録ボタンを押したとき, THE Purchase_Registration_Page SHALL Image_Resolverからアップロード用Presigned_URLを取得し、画像ファイルをImage_Storageにアップロードする
2. WHEN Authenticated_Userが画像付きで登録ボタンを押したとき, THE Drinking_Registration_Page SHALL Image_Resolverからアップロード用Presigned_URLを取得し、画像ファイルをImage_Storageにアップロードする
3. WHEN 画像のアップロードが成功したとき, THE Purchase_Registration_Page SHALL 画像のS3キーをPurchase_Recordの imageKey フィールドに含めて保存する
4. WHEN 画像のアップロードが成功したとき, THE Drinking_Registration_Page SHALL 画像のS3キーをDrinking_Recordの imageKey フィールドに含めて保存する
5. WHEN Authenticated_Userが画像なしで登録ボタンを押したとき, THE Purchase_Registration_Page SHALL imageKey を null として記録を保存する
6. WHEN Authenticated_Userが画像なしで登録ボタンを押したとき, THE Drinking_Registration_Page SHALL imageKey を null として記録を保存する
7. WHILE 画像アップロード中, THE Image_Upload_Area SHALL アップロード進捗を示すプログレスインジケーターを表示する
8. IF 画像のアップロードが失敗した場合, THEN THE Purchase_Registration_Page SHALL 「画像のアップロードに失敗しました。もう一度お試しください」というエラーメッセージを表示し、入力内容を保持する
9. IF 画像のアップロードが失敗した場合, THEN THE Drinking_Registration_Page SHALL 「画像のアップロードに失敗しました。もう一度お試しください」というエラーメッセージを表示し、入力内容を保持する

### 要件4: 一覧画面でのサムネイル表示

**ユーザーストーリー:** ユーザーとして、一覧画面で記録に添付された画像をサムネイルで確認したい。それにより、視覚的にどのお酒の記録かを素早く判別できる。

#### 受け入れ基準

1. WHEN Record_CardにimageKeyが設定された記録を表示するとき, THE Record_Card SHALL Image_Resolverからダウンロード用Presigned_URLを取得し、Thumbnailを表示する
2. WHEN Record_CardにimageKeyがnullの記録を表示するとき, THE Record_Card SHALL デフォルトのプレースホルダーアイコンを表示する
3. THE Thumbnail SHALL 幅80px、高さ80pxの正方形にトリミングして表示する（object-fit: cover）
4. WHILE Thumbnail画像の読み込み中, THE Record_Card SHALL スケルトンローダーを表示する
5. IF Thumbnail画像の読み込みに失敗した場合, THEN THE Record_Card SHALL デフォルトのプレースホルダーアイコンにフォールバックする
6. WHEN Authenticated_UserがThumbnailをクリックしたとき, THE Record_List_Page SHALL 元サイズの画像をモーダルで表示する

### 要件5: S3バケットのインフラ構築

**ユーザーストーリー:** 開発者として、画像を安全に保存するためのS3バケットをCDKで構築したい。それにより、認証済みユーザーのみが画像にアクセスできる。

#### 受け入れ基準

1. THE API_Stack SHALL Image_Storage用のS3バケットを作成し、バケット名に環境名プレフィックスを付与する
2. THE Image_Storage SHALL パブリックアクセスを全てブロックする設定を適用する
3. THE Image_Storage SHALL CORS設定でsakekasu-builder.comのオリジンからのPUT・GETリクエストを許可する
4. THE Image_Storage SHALL 画像オブジェクトのキーを `{owner}/{recordType}/{recordId}/{filename}` の形式で格納する
5. THE Image_Storage SHALL 開発環境ではRemovalPolicy.DESTROY、本番環境ではRemovalPolicy.RETAINの削除ポリシーを適用する
6. THE Image_Storage SHALL サーバーサイド暗号化（SSE-S3）を有効にする

### 要件6: Presigned URLの生成API

**ユーザーストーリー:** 開発者として、セキュアな画像アップロード・ダウンロードの仕組みを提供したい。それにより、認証済みユーザーのみが自身の画像にアクセスできる。

#### 受け入れ基準

1. THE API_Stack SHALL GraphQLスキーマにアップロード用Presigned_URLを生成するミューテーション（generateUploadUrl）を追加する
2. THE API_Stack SHALL GraphQLスキーマにダウンロード用Presigned_URLを生成するクエリ（getDownloadUrl）を追加する
3. THE Image_Resolver SHALL アップロード用Presigned_URLの有効期限を300秒（5分）に設定する
4. THE Image_Resolver SHALL ダウンロード用Presigned_URLの有効期限を3600秒（1時間）に設定する
5. THE Image_Resolver SHALL Presigned_URL生成時にAuthenticated_Userのサブジェクト（sub）をS3キーのプレフィックスとして使用し、他ユーザーの画像へのアクセスを防止する
6. THE Image_Resolver SHALL アップロード用Presigned_URLのContent-Typeをimage/jpegまたはimage/pngに制限する
7. THE Image_Resolver SHALL Lambda関数として実装し、API_StackからImage_Storageへの読み書き権限を付与する

### 要件7: GraphQLスキーマの拡張

**ユーザーストーリー:** 開発者として、既存のデータモデルに画像情報を追加したい。それにより、記録と画像の紐づけをGraphQL APIで管理できる。

#### 受け入れ基準

1. THE API_Stack SHALL PurchaseRecord型にimageKeyフィールド（任意・文字列）を追加する
2. THE API_Stack SHALL DrinkingRecord型にimageKeyフィールド（任意・文字列）を追加する
3. THE API_Stack SHALL CreatePurchaseRecordInputにimageKeyフィールド（任意・文字列）を追加する
4. THE API_Stack SHALL CreateDrinkingRecordInputにimageKeyフィールド（任意・文字列）を追加する
5. THE API_Stack SHALL 既存の記録（imageKeyがnull）との後方互換性を維持する
6. FOR ALL 有効なPurchase_Record, imageKeyを含めてPurchase_Storageに保存した後に取得した結果は元のPurchase_Recordと同等のimageKey値を持つ（ラウンドトリップ特性）
7. FOR ALL 有効なDrinking_Record, imageKeyを含めてDrinking_Storageに保存した後に取得した結果は元のDrinking_Recordと同等のimageKey値を持つ（ラウンドトリップ特性）

### 要件8: 画像の削除連動

**ユーザーストーリー:** ユーザーとして、記録を削除したときに添付画像も一緒に削除されてほしい。それにより、不要な画像がストレージに残らない。

#### 受け入れ基準

1. WHEN Authenticated_Userが画像付きのPurchase_Recordを削除したとき, THE API_Stack SHALL 対応するImage_Storage上の画像オブジェクトも削除する
2. WHEN Authenticated_Userが画像付きのDrinking_Recordを削除したとき, THE API_Stack SHALL 対応するImage_Storage上の画像オブジェクトも削除する
3. IF Image_Storageからの画像削除が失敗した場合, THEN THE API_Stack SHALL 記録の削除自体は成功として扱い、画像削除の失敗をログに記録する
4. WHEN imageKeyがnullの記録を削除したとき, THE API_Stack SHALL 画像削除処理をスキップする
