# 設計ドキュメント: 画像からの銘柄名自動取得（AI OCR）

## 概要

本機能は、購入登録・飲酒登録時に添付されたお酒のラベル画像から Amazon Rekognition の DetectText API を使用してテキストを抽出し、銘柄名を自動的にフォームへ入力する機能である。

ユーザーが画像をアップロードした後、「銘柄名を読み取る」ボタンをクリックすると、バックエンドの Lambda 関数が S3 から画像を取得し、Rekognition でテキスト検出を実行する。抽出されたテキスト群から銘柄名として最も適切な文字列を選択し、フロントエンドのフォームに自動入力する。

### 設計判断

1. **Rekognition DetectText を採用**: Bedrock マルチモーダル LLM と比較して、レイテンシが低く（通常1-3秒）、コストが安い。ラベルのテキスト抽出には十分な精度を持つ
2. **ユーザー明示トリガー方式**: 画像選択時の自動実行ではなく、ボタンクリックによる明示的なトリガーを採用。不要な API 呼び出しを防ぎ、ユーザーが画像確認後に実行できる
3. **既存 Lambda パターンの踏襲**: presigned-url Lambda と同じ NodejsFunction パターン（ESM、createRequire バナー）を使用し、一貫性を保つ
4. **銘柄名抽出ヒューリスティック**: Rekognition が返すテキスト行から、容量・度数・製造者名などの非銘柄情報をフィルタリングし、最も大きいフォントサイズ（高い信頼度）のテキストを銘柄名候補として選択する

## アーキテクチャ

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant UI as ImageUploadArea
    participant Hook as useOcrAnalysis
    participant AppSync as AppSync API
    participant Lambda as OCR Lambda
    participant S3 as S3 (画像)
    participant Rekognition as Amazon Rekognition

    User->>UI: 画像を選択・プレビュー表示
    User->>UI: 「銘柄名を読み取る」ボタンをクリック
    UI->>Hook: analyzeSakeLabel(imageKey)
    Hook->>AppSync: analyzeSakeLabel mutation
    AppSync->>Lambda: invoke(imageKey, identity.sub)
    Lambda->>Lambda: imageKey プレフィックスと sub を照合
    Lambda->>S3: GetObject(imageKey)
    S3-->>Lambda: 画像バイナリ
    Lambda->>Rekognition: DetectText(imageBytes)
    Rekognition-->>Lambda: TextDetections[]
    Lambda->>Lambda: Sake_Name_Extractor で銘柄名を抽出
    Lambda-->>AppSync: OcrResult { sakeName, confidence, rawTexts }
    AppSync-->>Hook: OcrResult
    Hook-->>UI: 結果を通知
    UI->>User: 成功メッセージ表示
    UI-->>Form: onOcrResult(sakeName) で銘柄名フィールドに自動入力
```

### コンポーネント構成

```mermaid
graph TD
    subgraph Frontend
        PF[PurchaseForm] --> IUA[ImageUploadArea]
        DF[DrinkingForm] --> IUA
        PF --> useOcr[useOcrAnalysis]
        DF --> useOcr
        useOcr --> GQL[GraphQL Client]
    end

    subgraph Backend CDK
        GQL --> AS[AppSync API]
        AS --> OL[OCR Lambda]
        OL --> S3[S3 Bucket]
        OL --> RK[Amazon Rekognition]
    end
```

## コンポーネントとインターフェース

### 1. GraphQL スキーマ追加

```graphql
# OCR 解析結果型
type OcrResult {
  sakeName: String
  confidence: Float!
  rawTexts: [String!]!
}

# Mutation に追加
type Mutation {
  # ... 既存のミューテーション
  analyzeSakeLabel(imageKey: String!): OcrResult!
}
```

### 2. OCR Lambda 関数 (`infra/lambda/ocr-analyzer/index.ts`)

既存の presigned-url Lambda と同じパターンで実装する。

```typescript
interface AppSyncEvent {
  info: { fieldName: string };
  arguments: { imageKey: string };
  identity: { sub: string };
}

interface OcrResult {
  sakeName: string | null;
  confidence: number;
  rawTexts: string[];
}

export async function handler(event: AppSyncEvent): Promise<OcrResult>
```

**処理フロー:**
1. `identity.sub` と `imageKey` プレフィックスの照合（アクセス制御）
2. S3 から画像を取得（`GetObjectCommand`）
3. Rekognition `DetectText` API で画像内テキストを検出
4. `extractSakeName()` で銘柄名を抽出
5. `OcrResult` を返却

### 3. 銘柄名抽出ロジック (`extractSakeName`)

```typescript
function extractSakeName(textDetections: TextDetection[]): {
  sakeName: string | null;
  confidence: number;
  rawTexts: string[];
}
```

**抽出アルゴリズム:**
1. `Type === 'LINE'` のテキスト検出結果のみを対象とする
2. 以下のパターンに一致するテキストを非銘柄情報として除外:
   - 容量表記: `/\d+\s*(ml|mL|ML|ℓ|リットル)/`
   - アルコール度数: `/\d+\s*[%％度]/`, `/アルコール/`
   - 製造者情報: `/製造|醸造|酒造|株式会社|有限会社|合名会社/`
   - 原材料: `/原材料|米|米こうじ|醸造アルコール/`
   - 保存方法: `/保存|要冷蔵|冷暗所/`
   - 産地表記: `/産|県|市|町|村|都|府|道/` （ただし2文字以下の場合のみ除外しない）
3. 残ったテキストから `Confidence` が最も高いものを銘柄名候補として選択
4. 候補がない場合は `sakeName: null, confidence: 0.0` を返す

### 4. useOcrAnalysis フック (`src/features/image/hooks/useOcrAnalysis.ts`)

```typescript
interface UseOcrAnalysisReturn {
  /** OCR 解析実行 */
  analyzeImage: (imageKey: string) => Promise<OcrResult | null>;
  /** 解析中フラグ */
  isAnalyzing: boolean;
  /** OCR 結果 */
  ocrResult: OcrResult | null;
  /** エラーメッセージ */
  ocrError: string | null;
  /** 状態リセット */
  resetOcr: () => void;
}

export function useOcrAnalysis(): UseOcrAnalysisReturn
```

**エラーハンドリング:**
- ネットワークエラー → `「読み取りに失敗しました。もう一度お試しください」`
- タイムアウト → `「読み取りがタイムアウトしました。もう一度お試しください」`
- 銘柄名未検出（sakeName === null）→ `「銘柄名を読み取れませんでした。手動で入力してください」`

### 5. ImageUploadArea の拡張

既存の `ImageUploadAreaProps` に以下を追加:

```typescript
interface ImageUploadAreaProps {
  // ... 既存のプロパティ
  /** OCR 解析中フラグ */
  isOcrAnalyzing?: boolean;
  /** OCR トリガーボタンのクリックハンドラ */
  onOcrTrigger?: () => void;
  /** OCR 結果メッセージ（成功/エラー） */
  ocrMessage?: { text: string; variant: 'success' | 'error' } | null;
}
```

**UI 変更:**
- プレビュー表示時に「銘柄名を読み取る」ボタンを追加（プレビュー画像の下部）
- 解析中はボタンを無効化し「読み取り中...」+ スピナーを表示
- 解析中は画像削除ボタンも無効化
- 結果メッセージを StatusMessage コンポーネントで表示

### 6. フォーム統合

PurchaseForm と DrinkingForm で `useOcrAnalysis` フックを使用し、OCR 結果を `sakeName` フィールドに反映する。

```typescript
// PurchaseForm / DrinkingForm 内
const { analyzeImage, isAnalyzing, ocrResult, ocrError, resetOcr } = useOcrAnalysis();

const handleOcrTrigger = async () => {
  if (!imageUpload.imageKey) return;
  const result = await analyzeImage(imageUpload.imageKey);
  if (result?.sakeName) {
    handleChange('sakeName', result.sakeName);
  }
};
```

**注意:** OCR を実行するには画像が S3 にアップロード済みである必要がある。`imageKey` は `useImageUpload` の `uploadImage` 実行後に取得できる。そのため、OCR トリガーボタンは画像アップロード完了後にのみ有効化する設計とする。ただし、現在のフォーム送信フローでは画像アップロードはフォーム送信時に行われるため、OCR 用に事前アップロードのフローを追加する必要がある。

**事前アップロードフロー:**
1. ユーザーが画像を選択
2. 画像圧縮完了後、自動的に S3 へアップロード（仮の recordId を使用）
3. アップロード完了後、OCR トリガーボタンが有効化
4. フォーム送信時は既にアップロード済みの imageKey を使用

### 7. CDK インフラ変更 (`infra/lib/api-stack.ts`)

```typescript
// OCR Analyzer Lambda 関数
const ocrAnalyzerFunction = new NodejsFunction(this, 'OcrAnalyzerFunction', {
  functionName: `${props.envName}-sakekasu-ocr-analyzer`,
  runtime: Runtime.NODEJS_20_X,
  entry: path.join(
    path.dirname(url.fileURLToPath(import.meta.url)),
    '../lambda/ocr-analyzer/index.ts',
  ),
  handler: 'handler',
  timeout: cdk.Duration.seconds(30),
  memorySize: 512,
  environment: {
    BUCKET_NAME: this.imageBucket.bucketName,
  },
  bundling: {
    format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
    mainFields: ['module', 'main'],
    banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});

// S3 読み取り権限
this.imageBucket.grantRead(ocrAnalyzerFunction);

// Rekognition DetectText 権限
ocrAnalyzerFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
  actions: ['rekognition:DetectText'],
  resources: ['*'],
}));

// AppSync Lambda データソース + リゾルバー
const ocrDataSource = this.graphqlApi.addLambdaDataSource(
  'OcrAnalyzerDataSource',
  ocrAnalyzerFunction,
);

ocrDataSource.createResolver('AnalyzeSakeLabelResolver', {
  typeName: 'Mutation',
  fieldName: 'analyzeSakeLabel',
});
```

## データモデル

### OcrResult 型

| フィールド | 型 | 説明 |
|---|---|---|
| sakeName | String \| null | 抽出された銘柄名。検出できなかった場合は null |
| confidence | Float | 信頼度スコア（0.0〜1.0）。sakeName が null の場合は 0.0 |
| rawTexts | [String] | Rekognition が検出した全テキスト行のリスト |

### Rekognition TextDetection（参考: AWS SDK レスポンス）

| フィールド | 型 | 説明 |
|---|---|---|
| DetectedText | string | 検出されたテキスト文字列 |
| Type | 'LINE' \| 'WORD' | テキストの種類（行 or 単語） |
| Confidence | number | 検出信頼度（0-100） |
| Geometry | object | テキストの位置情報（BoundingBox 等） |

### フロントエンド状態管理

```typescript
// useOcrAnalysis の内部状態
interface OcrState {
  isAnalyzing: boolean;
  ocrResult: OcrResult | null;
  ocrError: string | null;
}

// useImageUpload に追加する状態
interface ImageUploadState {
  // ... 既存の状態
  imageKey: string | null;  // S3 アップロード後の imageKey（OCR 用）
}
```


## 正当性プロパティ（Correctness Properties）

*プロパティとは、システムの全ての有効な実行において成り立つべき特性や振る舞いのことである。人間が読める仕様と機械的に検証可能な正当性保証の橋渡しとなる形式的な記述である。*

### Property 1: アクセス制御 — imageKey プレフィックス不一致時の拒否

*任意の* ユーザー sub と imageKey のペアに対して、imageKey のプレフィックスが sub と一致しない場合、OCR_Analyzer は「Unauthorized: cannot access other user's images」エラーを返し、S3 からの画像取得および Rekognition の呼び出しを実行しないこと。

**Validates: Requirements 2.5, 7.2, 7.3, 7.4**

### Property 2: Confidence スコアの範囲不変条件

*任意の* TextDetection リストを extractSakeName に入力した場合、返される confidence 値は 0.0 以上 1.0 以下の範囲内であること。

**Validates: Requirements 3.2**

### Property 3: 最高 Confidence 候補の選択

*任意の* 複数の銘柄名候補を含む TextDetection リストに対して、extractSakeName が返す sakeName は、非銘柄情報を除外した後の候補の中で最も高い Confidence を持つテキストであること。

**Validates: Requirements 3.3**

### Property 4: 非銘柄情報のフィルタリング

*任意の* 容量表記（例: "720ml"）、アルコール度数（例: "15%"）、製造者名（例: "○○酒造株式会社"）などの非銘柄パターンに一致するテキストを含む TextDetection リストに対して、extractSakeName はそれらのテキストを銘柄名候補として選択しないこと。

**Validates: Requirements 3.4**

### Property 5: rawTexts の完全性

*任意の* TextDetection リストに対して、extractSakeName が返す rawTexts フィールドは、入力された全ての LINE タイプのテキスト検出結果の DetectedText を含むこと。

**Validates: Requirements 3.6**

### Property 6: エラー時のフォーム値保持

*任意の* フォーム状態（sakeName フィールドに任意の文字列が入力された状態）において、OCR 解析がエラー（ネットワークエラー、タイムアウト、銘柄名未検出）で終了した場合、sakeName フィールドの値は変更されないこと。

**Validates: Requirements 5.5**

## エラーハンドリング

### バックエンド（OCR Lambda）

| エラー種別 | 原因 | レスポンス |
|---|---|---|
| 認証エラー | imageKey プレフィックスと sub の不一致 | `Error: "Unauthorized: cannot access other user's images"` |
| S3 取得エラー | 画像が存在しない、またはアクセス権限不足 | `Error: "Failed to retrieve image from storage"` |
| Rekognition エラー | 画像フォーマット不正、サービスエラー | `Error: "OCR analysis failed"` |
| テキスト未検出 | 画像内にテキストが存在しない | 正常レスポンス: `{ sakeName: null, confidence: 0.0, rawTexts: [] }` |

### フロントエンド（useOcrAnalysis）

| 状態 | メッセージ | variant |
|---|---|---|
| 銘柄名未検出 | 「銘柄名を読み取れませんでした。手動で入力してください」 | error |
| ネットワークエラー | 「読み取りに失敗しました。もう一度お試しください」 | error |
| タイムアウト | 「読み取りがタイムアウトしました。もう一度お試しください」 | error |
| 成功 | 「銘柄名を読み取りました: {銘柄名}」 | success |

### エラー回復

- 全てのエラー状態で OCR_Trigger_Button は再度クリック可能な状態に戻る
- エラー発生時に Sake_Name_Field の既存値は保持される
- ユーザーはいつでも手動入力に切り替え可能

## テスト戦略

### テストフレームワーク

- **ユニットテスト**: Vitest + Testing Library
- **プロパティベーステスト**: Vitest + fast-check
- プロパティテストは最低100イテレーション実行

### プロパティベーステスト

各プロパティテストは設計ドキュメントのプロパティを参照するコメントタグを付与する。

タグ形式: `Feature: ai-ocr-sake-name, Property {number}: {property_text}`

各正当性プロパティは単一のプロパティベーステストで実装する。

| テスト | 対象 | 内容 |
|---|---|---|
| Property 1 テスト | `validateImageKeyAccess()` | ランダムな sub/imageKey ペアを生成し、プレフィックス不一致時にエラーが返ることを検証 |
| Property 2 テスト | `extractSakeName()` | ランダムな TextDetection リストを生成し、confidence が 0.0〜1.0 の範囲内であることを検証 |
| Property 3 テスト | `extractSakeName()` | 複数候補を含むランダムな TextDetection リストを生成し、最高 Confidence の候補が選択されることを検証 |
| Property 4 テスト | `extractSakeName()` | 非銘柄パターン（容量、度数、製造者名等）を含むランダムな TextDetection リストを生成し、それらが銘柄名として選択されないことを検証 |
| Property 5 テスト | `extractSakeName()` | ランダムな TextDetection リストを生成し、rawTexts が全 LINE テキストを含むことを検証 |
| Property 6 テスト | `useOcrAnalysis` フック | ランダムな既存 sakeName 値とエラー種別を生成し、エラー後も値が保持されることを検証 |

### ユニットテスト

| テスト | 対象 | 内容 |
|---|---|---|
| OCR ボタン表示 | ImageUploadArea | 画像選択時に OCR ボタンが表示されること |
| OCR ボタン非表示 | ImageUploadArea | 画像未選択時に OCR ボタンが非表示であること |
| 解析中 UI 状態 | ImageUploadArea | isOcrAnalyzing=true 時にボタン無効化・ラベル変更・削除ボタン無効化 |
| 成功メッセージ | ImageUploadArea | OCR 成功時に「銘柄名を読み取りました: {銘柄名}」が表示されること |
| エラーメッセージ | ImageUploadArea | 各エラー種別で適切なメッセージが表示されること |
| フォーム自動入力 | PurchaseForm | OCR 結果が sakeName フィールドに反映されること |
| フォーム自動入力 | DrinkingForm | OCR 結果が sakeName フィールドに反映されること |
| 既存値上書き | PurchaseForm/DrinkingForm | 既存の sakeName が OCR 結果で上書きされること |
| 手動編集可能 | PurchaseForm/DrinkingForm | OCR 結果反映後も sakeName フィールドが編集可能であること |
| 空テキスト検出 | extractSakeName | テキスト未検出時に sakeName=null, confidence=0.0 を返すこと |
| GraphQL ミューテーション | useOcrAnalysis | analyzeSakeLabel ミューテーションが正しく呼び出されること |

### テストファイル配置

```
src/features/image/__tests__/
  extractSakeName.test.ts          # extractSakeName のユニット + プロパティテスト
  useOcrAnalysis.test.ts           # useOcrAnalysis フックのテスト
  ImageUploadArea.ocr.test.tsx     # OCR 関連の UI テスト
infra/lambda/ocr-analyzer/__tests__/
  validateAccess.test.ts           # アクセス制御のプロパティテスト
```
