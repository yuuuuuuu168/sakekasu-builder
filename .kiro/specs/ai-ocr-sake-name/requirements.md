# 要件ドキュメント: 画像からの銘柄名自動取得（AI OCR）

## はじめに

「sakekasu-builder.com」の機能10として、購入登録・飲酒登録時に添付されたお酒のラベル画像から AI（OCR）を使って銘柄名を自動抽出し、フォームの銘柄名フィールドに反映する機能を提供する。ユーザーはラベル写真を撮影・選択するだけで銘柄名の入力が自動化され、登録の手間を大幅に軽減できる。既存の画像添付機能（機能6）の Image_Upload_Area コンポーネントと連携し、画像選択時に OCR 解析を自動実行する。

## 用語集

- **OCR_Analyzer**: 画像からテキストを抽出する AI/OCR 処理を実行する Lambda 関数。Amazon Rekognition の DetectText API または Amazon Bedrock のマルチモーダル LLM を使用する
- **Sake_Name_Extractor**: OCR_Analyzer が抽出した生テキストから銘柄名を特定・整形するロジック。日本語のお酒ラベルに特化した抽出処理を行う
- **OCR_Result**: OCR_Analyzer が返す解析結果。抽出された銘柄名候補と信頼度スコアを含む
- **OCR_Trigger_Button**: Image_Upload_Area 内のプレビュー表示時に表示される「銘柄名を読み取る」ボタン。ユーザーが明示的に OCR 解析を開始するためのUI要素
- **Sake_Name_Field**: 購入登録・飲酒登録フォーム内の銘柄名入力フィールド（sakeName）
- **Image_Upload_Area**: 既存の画像アップロード用UIコンポーネント。ファイル選択・プレビュー表示・ドラッグ＆ドロップを提供する
- **Purchase_Registration_Page**: 購入したお酒の情報を入力・登録するためのWebページ
- **Drinking_Registration_Page**: 飲んだお酒の情報を入力・登録するためのWebページ
- **Authenticated_User**: Cognito で認証済みのユーザー
- **Confidence_Score**: OCR_Analyzer が銘柄名候補に付与する信頼度（0.0〜1.0）。値が高いほど抽出結果の確度が高い
- **API_Stack**: AWS CDK で構築するバックエンドインフラストラクチャ。AppSync GraphQL API、Lambda 関数、IAM ロール等を管理する

## 要件

### 要件1: OCR 解析トリガーUIの表示

**ユーザーストーリー:** ユーザーとして、画像をアップロードした後に銘柄名の自動読み取りを実行したい。それにより、手入力の手間を省ける。

#### 受け入れ基準

1. WHEN Authenticated_User が画像を選択しプレビューが表示されたとき, THE Image_Upload_Area SHALL プレビュー画像の下部に OCR_Trigger_Button を表示する
2. THE OCR_Trigger_Button SHALL 「銘柄名を読み取る」というラベルテキストを表示する
3. WHEN Authenticated_User が OCR_Trigger_Button をクリックしたとき, THE Image_Upload_Area SHALL OCR 解析処理を開始する
4. WHILE OCR 解析処理が実行中, THE OCR_Trigger_Button SHALL 無効化状態となり「読み取り中...」というラベルテキストとスピナーアイコンを表示する
5. WHILE OCR 解析処理が実行中, THE Image_Upload_Area SHALL 画像の削除ボタンを無効化する
6. WHEN 画像が未選択の状態, THE Image_Upload_Area SHALL OCR_Trigger_Button を表示しない

### 要件2: OCR 解析 API の提供

**ユーザーストーリー:** 開発者として、画像から銘柄名を抽出する API を提供したい。それにより、フロントエンドから OCR 解析を呼び出せる。

#### 受け入れ基準

1. THE API_Stack SHALL GraphQL スキーマに画像から銘柄名を抽出するミューテーション（analyzeSakeLabel）を追加する
2. THE analyzeSakeLabel ミューテーション SHALL 引数として imageKey（String!）を受け取る
3. THE analyzeSakeLabel ミューテーション SHALL OCR_Result 型（sakeName: String, confidence: Float, rawTexts: [String]）を返す
4. THE OCR_Analyzer SHALL imageKey を使用して Image_Storage（S3）から画像を取得し、OCR 解析を実行する
5. THE OCR_Analyzer SHALL Authenticated_User の sub と imageKey のプレフィックスを照合し、他ユーザーの画像へのアクセスを防止する
6. THE OCR_Analyzer SHALL Lambda 関数として実装し、Image_Storage への読み取り権限と OCR サービスへのアクセス権限を付与する

### 要件3: 銘柄名の抽出ロジック

**ユーザーストーリー:** 開発者として、OCR で読み取ったテキストからお酒の銘柄名を正確に特定したい。それにより、ユーザーに有用な自動入力結果を提供できる。

#### 受け入れ基準

1. THE Sake_Name_Extractor SHALL OCR で抽出されたテキスト群から日本語の銘柄名として最も適切な文字列を選択する
2. THE Sake_Name_Extractor SHALL 抽出した銘柄名候補に Confidence_Score を付与する
3. WHEN 複数の銘柄名候補が検出されたとき, THE Sake_Name_Extractor SHALL Confidence_Score が最も高い候補を第一候補として返す
4. THE Sake_Name_Extractor SHALL ラベル上の製造者名、容量表記、アルコール度数などの非銘柄情報を銘柄名候補から除外する
5. IF OCR で読み取り可能なテキストが検出されなかった場合, THEN THE Sake_Name_Extractor SHALL sakeName を null、confidence を 0.0 として返す
6. THE Sake_Name_Extractor SHALL 抽出した全テキストを rawTexts フィールドに含めて返す

### 要件4: フォームへの銘柄名自動入力

**ユーザーストーリー:** ユーザーとして、OCR で読み取られた銘柄名がフォームに自動入力されてほしい。それにより、手入力なしで銘柄名を登録できる。

#### 受け入れ基準

1. WHEN OCR 解析が成功し sakeName が null でないとき, THE Purchase_Registration_Page SHALL Sake_Name_Field に抽出された銘柄名を自動入力する
2. WHEN OCR 解析が成功し sakeName が null でないとき, THE Drinking_Registration_Page SHALL Sake_Name_Field に抽出された銘柄名を自動入力する
3. WHEN OCR 解析結果が Sake_Name_Field に反映されたとき, THE Image_Upload_Area SHALL 「銘柄名を読み取りました: {銘柄名}」という成功メッセージを表示する
4. WHEN Sake_Name_Field に既に値が入力されている状態で OCR 解析が成功したとき, THE Purchase_Registration_Page SHALL 既存の値を OCR 結果で上書きする
5. WHEN Sake_Name_Field に既に値が入力されている状態で OCR 解析が成功したとき, THE Drinking_Registration_Page SHALL 既存の値を OCR 結果で上書きする
6. WHEN OCR 解析結果が反映された後, THE Authenticated_User SHALL Sake_Name_Field の値を手動で編集できる状態を維持する

### 要件5: OCR 解析のエラーハンドリング

**ユーザーストーリー:** ユーザーとして、OCR 解析が失敗した場合にわかりやすいエラーメッセージを確認したい。それにより、手入力に切り替える判断ができる。

#### 受け入れ基準

1. IF OCR_Analyzer が銘柄名を検出できなかった場合（sakeName が null）, THEN THE Image_Upload_Area SHALL 「銘柄名を読み取れませんでした。手動で入力してください」というメッセージを表示する
2. IF OCR_Analyzer への API 呼び出しがネットワークエラーで失敗した場合, THEN THE Image_Upload_Area SHALL 「読み取りに失敗しました。もう一度お試しください」というエラーメッセージを表示する
3. IF OCR_Analyzer への API 呼び出しがタイムアウトした場合, THEN THE Image_Upload_Area SHALL 「読み取りがタイムアウトしました。もう一度お試しください」というエラーメッセージを表示する
4. WHEN OCR 解析でエラーが発生したとき, THE OCR_Trigger_Button SHALL 再度クリック可能な状態に戻る
5. WHEN OCR 解析でエラーが発生したとき, THE Sake_Name_Field SHALL 既存の入力値を保持し変更しない

### 要件6: OCR 解析用 Lambda 関数のインフラ構築

**ユーザーストーリー:** 開発者として、OCR 解析を実行する Lambda 関数を CDK で構築したい。それにより、セキュアで拡張可能な OCR バックエンドを提供できる。

#### 受け入れ基準

1. THE API_Stack SHALL OCR_Analyzer 用の Lambda 関数を作成し、Image_Storage（S3）への読み取り権限を付与する
2. THE API_Stack SHALL OCR_Analyzer Lambda 関数に Amazon Rekognition DetectText API の呼び出し権限を付与する
3. THE API_Stack SHALL OCR_Analyzer Lambda 関数のタイムアウトを30秒に設定する
4. THE API_Stack SHALL OCR_Analyzer Lambda 関数のメモリサイズを512MBに設定する
5. THE API_Stack SHALL AppSync の analyzeSakeLabel ミューテーションのリゾルバーとして OCR_Analyzer Lambda 関数を設定する
6. THE OCR_Analyzer Lambda 関数 SHALL 環境変数として BUCKET_NAME を受け取る

### 要件7: OCR 解析のアクセス制御

**ユーザーストーリー:** 開発者として、OCR 解析が認証済みユーザーの自身の画像に対してのみ実行されることを保証したい。それにより、他ユーザーの画像データへの不正アクセスを防止できる。

#### 受け入れ基準

1. THE analyzeSakeLabel ミューテーション SHALL Cognito 認証が必要なフィールドとして設定する
2. THE OCR_Analyzer SHALL リクエストに含まれる Authenticated_User の sub と imageKey のプレフィックスを照合する
3. IF imageKey のプレフィックスが Authenticated_User の sub と一致しない場合, THEN THE OCR_Analyzer SHALL 「Unauthorized: cannot access other user's images」というエラーを返す
4. THE OCR_Analyzer SHALL 認証情報の検証に失敗した場合、画像の取得や OCR 処理を実行しない
