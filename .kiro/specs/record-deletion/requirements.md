# 要件ドキュメント: 記録の削除機能

## はじめに

購入記録・飲酒記録を一覧画面から個別に削除できる機能。誤登録や不要な記録を整理するために使用する。バックエンド側の削除API（AppSync GraphQL ミューテーション `deletePurchaseRecord` / `deleteDrinkingRecord`）は既に実装済みであり、本機能はフロントエンド側のUI・ロジック実装が主な対象となる。

## 用語集

- **RecordListPage**: 購入記録・飲酒記録を一覧表示するページコンポーネント
- **RecordCard**: 一覧ページ内で個々の記録を表示するカードコンポーネント
- **DeleteButton**: RecordCard 内に配置される削除操作を開始するボタン
- **ConfirmDialog**: 削除実行前にユーザーへ確認を求めるモーダルダイアログ
- **DeleteMutation**: AppSync GraphQL の `deletePurchaseRecord` または `deleteDrinkingRecord` ミューテーション
- **UnifiedRecord**: 購入記録と飲酒記録を統一的に扱う型（`type` フィールドで種別を判別）

## 要件

### 要件 1: 削除ボタンの表示

**ユーザーストーリー:** ユーザーとして、各記録カードに削除ボタンが表示されることで、どの記録を削除できるか視覚的に把握したい。

#### 受け入れ基準

1. THE RecordCard SHALL 各記録カード内にゴミ箱アイコンの DeleteButton を表示する
2. THE DeleteButton SHALL ボタンの目的を示す「削除」のアクセシブルラベル（aria-label）を持つ
3. WHILE 削除処理が実行中である場合、THE DeleteButton SHALL 無効状態（disabled）で表示する

### 要件 2: 削除確認ダイアログ

**ユーザーストーリー:** ユーザーとして、削除前に確認ダイアログが表示されることで、誤って記録を削除することを防ぎたい。

#### 受け入れ基準

1. WHEN ユーザーが DeleteButton をクリックした場合、THE ConfirmDialog SHALL 削除対象の銘柄名と記録種別（購入 or 飲酒）を含む確認メッセージを表示する
2. THE ConfirmDialog SHALL 「削除する」ボタンと「キャンセル」ボタンを表示する
3. WHEN ユーザーが「キャンセル」ボタンをクリックした場合、THE ConfirmDialog SHALL ダイアログを閉じ、記録を削除せずに元の状態を維持する
4. THE ConfirmDialog SHALL Escape キーの押下でダイアログを閉じる機能を提供する
5. WHEN ConfirmDialog が表示された場合、THE ConfirmDialog SHALL 背景のスクロールを無効化し、ダイアログ内にフォーカスをトラップする

### 要件 3: 削除処理の実行

**ユーザーストーリー:** ユーザーとして、確認後に記録が削除され、一覧が即座に更新されることで、スムーズに記録を整理したい。

#### 受け入れ基準

1. WHEN ユーザーが ConfirmDialog の「削除する」ボタンをクリックした場合、THE RecordListPage SHALL 対象記録の `type` に応じて適切な DeleteMutation（`deletePurchaseRecord` または `deleteDrinkingRecord`）を実行する
2. WHEN DeleteMutation が成功した場合、THE RecordListPage SHALL 削除された記録を一覧から即座に除去する（楽観的UI更新）
3. WHEN DeleteMutation が成功した場合、THE ConfirmDialog SHALL 自動的に閉じる

### 要件 4: 削除エラーハンドリング

**ユーザーストーリー:** ユーザーとして、削除に失敗した場合にエラーメッセージが表示されることで、状況を把握し再試行できるようにしたい。

#### 受け入れ基準

1. IF DeleteMutation がネットワークエラーまたはサーバーエラーで失敗した場合、THEN THE RecordListPage SHALL 「削除に失敗しました。もう一度お試しください。」というエラーメッセージをトースト通知で表示する
2. IF DeleteMutation が失敗した場合、THEN THE RecordListPage SHALL 楽観的に除去した記録を一覧に復元する
3. WHILE 削除処理が実行中である場合、THE ConfirmDialog SHALL 「削除する」ボタンにローディングインジケーターを表示し、ボタンを無効状態にする

### 要件 5: 削除時のアニメーション

**ユーザーストーリー:** ユーザーとして、記録が削除される際にスムーズなアニメーションが表示されることで、操作の結果を直感的に理解したい。

#### 受け入れ基準

1. WHEN 記録が一覧から除去される場合、THE RecordCard SHALL フェードアウトとスライドアウトのアニメーションを伴って消える
2. THE RecordCard SHALL アニメーションに Framer Motion を使用する
3. WHEN アニメーションが完了した場合、THE RecordListPage SHALL 残りの記録カードの位置を滑らかに再配置する
