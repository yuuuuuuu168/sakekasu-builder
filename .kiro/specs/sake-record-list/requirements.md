# Requirements Document

## Introduction

sakekasu-builder.com の「購入・飲酒記録の一覧ページ」機能の要件定義。機能1（購入登録）と機能2（飲酒登録）で登録されたデータを統合的に閲覧・検索・フィルタリングできるページを提供する。ユーザーが過去の記録を振り返り、自分の飲酒傾向を把握できるようにする。

## Glossary

- **Record_List_Page**: 購入記録と飲酒記録を一覧表示するページ
- **Purchase_Record**: 購入したお酒の記録（銘柄名、購入店舗、価格、購入日、カテゴリ、メモ）
- **Drinking_Record**: 飲んだお酒の記録（銘柄名、飲んだ場所、価格、飲んだ日、カテゴリ、飲み方、評価、メモ）
- **Record_Card**: 一覧ページ上で個々の記録を表示するUIコンポーネント
- **Category_Filter**: カテゴリ（日本酒、ビール、ワイン、ウイスキー、焼酎、その他）による絞り込み機能
- **Record_Type_Filter**: 記録種別（購入記録・飲酒記録）による絞り込み機能
- **Sort_Control**: 記録の並び替えを制御するUIコンポーネント
- **Sake_Category**: お酒のカテゴリ（NIHONSHU, BEER, WINE, WHISKY, SHOCHU, OTHER）

## Requirements

### Requirement 1: 記録一覧の表示

**User Story:** As a ユーザー, I want 購入記録と飲酒記録を一覧で閲覧したい, so that 過去に何を買い、何を飲んだかを振り返ることができる

#### Acceptance Criteria

1. WHEN Record_List_Page にアクセスした時, THE Record_List_Page SHALL Purchase_Record と Drinking_Record を統合して日付の新しい順に一覧表示する
2. THE Record_Card SHALL Purchase_Record の場合は銘柄名、購入店舗、価格、購入日、カテゴリを表示する
3. THE Record_Card SHALL Drinking_Record の場合は銘柄名、飲んだ場所、価格、飲んだ日、カテゴリ、飲み方、評価を表示する
4. THE Record_Card SHALL 記録種別（購入 or 飲酒）を視覚的に区別できるラベルまたはアイコンを表示する
5. WHEN 記録が0件の場合, THE Record_List_Page SHALL 「記録がありません」というメッセージを表示する

### Requirement 2: 記録種別フィルタリング

**User Story:** As a ユーザー, I want 購入記録と飲酒記録を種別で絞り込みたい, so that 見たい種類の記録だけを確認できる

#### Acceptance Criteria

1. THE Record_Type_Filter SHALL 「すべて」「購入記録」「飲酒記録」の3つの選択肢を提供する
2. WHEN Record_Type_Filter で「購入記録」を選択した時, THE Record_List_Page SHALL Purchase_Record のみを表示する
3. WHEN Record_Type_Filter で「飲酒記録」を選択した時, THE Record_List_Page SHALL Drinking_Record のみを表示する
4. WHEN Record_Type_Filter で「すべて」を選択した時, THE Record_List_Page SHALL Purchase_Record と Drinking_Record の両方を表示する
5. THE Record_Type_Filter SHALL 初期状態で「すべて」を選択済みにする

### Requirement 3: カテゴリフィルタリング

**User Story:** As a ユーザー, I want カテゴリでお酒の記録を絞り込みたい, so that 特定の種類のお酒の記録だけを確認できる

#### Acceptance Criteria

1. THE Category_Filter SHALL Sake_Category の全6種類（日本酒、ビール、ワイン、ウイスキー、焼酎、その他）と「すべて」の選択肢を提供する
2. WHEN Category_Filter で特定のカテゴリを選択した時, THE Record_List_Page SHALL 選択されたカテゴリに一致する記録のみを表示する
3. WHEN Category_Filter で「すべて」を選択した時, THE Record_List_Page SHALL 全カテゴリの記録を表示する
4. THE Category_Filter SHALL Record_Type_Filter と組み合わせて使用できる（AND条件）
5. WHEN フィルタ条件に一致する記録が0件の場合, THE Record_List_Page SHALL 「条件に一致する記録がありません」というメッセージを表示する

### Requirement 4: 並び替え

**User Story:** As a ユーザー, I want 記録を日付や価格で並び替えたい, so that 目的に応じた順序で記録を確認できる

#### Acceptance Criteria

1. THE Sort_Control SHALL 「日付（新しい順）」「日付（古い順）」「価格（高い順）」「価格（低い順）」の4つの並び替えオプションを提供する
2. WHEN Sort_Control で「日付（新しい順）」を選択した時, THE Record_List_Page SHALL 記録を日付の降順で表示する（Purchase_Record は purchaseDate、Drinking_Record は drinkingDate を使用）
3. WHEN Sort_Control で「日付（古い順）」を選択した時, THE Record_List_Page SHALL 記録を日付の昇順で表示する
4. WHEN Sort_Control で「価格（高い順）」を選択した時, THE Record_List_Page SHALL 記録を価格の降順で表示する（価格が未設定の記録は末尾に配置する）
5. WHEN Sort_Control で「価格（低い順）」を選択した時, THE Record_List_Page SHALL 記録を価格の昇順で表示する（価格が未設定の記録は末尾に配置する）
6. THE Sort_Control SHALL 初期状態で「日付（新しい順）」を選択済みにする

### Requirement 5: データ取得

**User Story:** As a ユーザー, I want ページを開いた時に最新の記録を確認したい, so that 登録した内容がすぐに反映されている

#### Acceptance Criteria

1. WHEN Record_List_Page にアクセスした時, THE Record_List_Page SHALL AWS Amplify Data API を使用して Purchase_Record と Drinking_Record を取得する
2. WHILE データ取得中, THE Record_List_Page SHALL ローディング状態を表示する
3. IF データ取得に失敗した場合, THEN THE Record_List_Page SHALL エラーメッセージを表示し、再取得ボタンを提供する

### Requirement 6: レスポンシブ表示

**User Story:** As a ユーザー, I want スマートフォンでも一覧を快適に閲覧したい, so that 外出先でも記録を確認できる

#### Acceptance Criteria

1. THE Record_List_Page SHALL モバイル画面（幅640px未満）ではカード型のリストレイアウトで記録を表示する
2. THE Record_List_Page SHALL デスクトップ画面（幅640px以上）ではより情報量の多いレイアウトで記録を表示する
3. THE Category_Filter と Record_Type_Filter SHALL モバイル画面でも操作可能なサイズで表示する
