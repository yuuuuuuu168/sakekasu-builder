# 実装計画: 記録の削除機能

## 概要

既存の一覧ページ（RecordListPage）に削除機能を追加する。バックエンドAPIは実装済みのため、フロントエンドのUI・ロジック実装が中心。DeleteButton、ConfirmDialog、useDeleteRecordフックを新規作成し、既存のRecordCard・RecordListPageを拡張する。Framer Motionによる削除アニメーションとsonnerによるエラー通知も実装する。

## タスク

- [x] 1. DeleteButton コンポーネントの作成
  - [x] 1.1 `src/features/records/components/DeleteButton.tsx` を作成する
    - lucide-react の `Trash2` アイコンを使用したゴミ箱ボタンを実装
    - `aria-label="削除"` でアクセシビリティ対応
    - `disabled` props で無効状態（グレーアウト + クリック不可）を制御
    - インターフェース: `DeleteButtonProps { onClick: () => void; disabled: boolean; }`
    - _要件: 1.1, 1.2, 1.3_

  - [x] 1.2 DeleteButton のユニットテストを作成する
    - `src/features/records/__tests__/DeleteButton.test.tsx` を作成
    - ゴミ箱アイコンがレンダリングされること（要件 1.1）
    - `aria-label="削除"` が設定されていること（要件 1.2）
    - `disabled=true` 時にボタンが無効状態であること（要件 1.3）
    - クリック時に `onClick` が呼ばれること
    - _要件: 1.1, 1.2, 1.3_

- [x] 2. ConfirmDialog コンポーネントの作成
  - [x] 2.1 `src/features/records/components/ConfirmDialog.tsx` を作成する
    - 削除確認用モーダルダイアログを実装
    - props: `open`, `onOpenChange`, `sakeName`, `recordType`, `isDeleting`, `onConfirm`
    - 銘柄名と記録種別（「購入」/「飲酒」）を含む確認メッセージを表示
    - 「削除する」ボタンと「キャンセル」ボタンを配置
    - Escape キーでダイアログを閉じる
    - 背景スクロール無効化 + フォーカストラップ
    - `isDeleting` 時は「削除する」ボタンにローディングインジケーター表示 + disabled
    - _要件: 2.1, 2.2, 2.3, 2.4, 2.5, 4.3_

  - [x] 2.2 ConfirmDialog のユニットテストを作成する
    - `src/features/records/__tests__/ConfirmDialog.test.tsx` を作成
    - 銘柄名と記録種別が確認メッセージに含まれること（要件 2.1）
    - 「削除する」「キャンセル」ボタンが表示されること（要件 2.2）
    - キャンセルクリックで `onOpenChange(false)` が呼ばれ、`onConfirm` が呼ばれないこと（要件 2.3）
    - Escape キーで `onOpenChange(false)` が呼ばれること（要件 2.4）
    - `isDeleting=true` 時に「削除する」ボタンが disabled でローディング表示されること（要件 4.3）
    - _要件: 2.1, 2.2, 2.3, 2.4, 4.3_

  - [x] 2.3 ConfirmDialog のプロパティベーステストを作成する（Property 1）
    - `src/features/records/__tests__/delete.property.test.tsx` を作成
    - **Property 1: 確認ダイアログに銘柄名と記録種別が含まれる**
    - 任意の空でない銘柄名と記録種別に対して、表示テキストにその銘柄名と種別ラベルが含まれることを検証
    - fast-check で最低100回のイテレーション
    - **検証対象: 要件 2.1**

- [x] 3. useDeleteRecord カスタムフックの作成
  - [x] 3.1 `src/features/records/hooks/useDeleteRecord.ts` を作成する
    - `deleteRecord(id, type)` メソッドと `isDeleting` 状態を返すフック
    - `type` に応じて `deletePurchaseRecord` / `deleteDrinkingRecord` ミューテーションを呼び分け
    - 楽観的UI更新: ミューテーション実行前に `onOptimisticRemove(id)` を呼び出し
    - 成功時: `onSuccess()` でダイアログを閉じる
    - 失敗時: `onRollback(record)` で記録を復元 + `toast.error("削除に失敗しました。もう一度お試しください。")` でエラー通知
    - sonner パッケージを使用（未インストールの場合はインストール）
    - _要件: 3.1, 3.2, 3.3, 4.1, 4.2_

  - [x] 3.2 useDeleteRecord のプロパティベーステストを作成する（Property 2）
    - `src/features/records/__tests__/delete.property.test.tsx` に追加
    - **Property 2: 記録種別に応じた適切なミューテーション選択**
    - 任意の UnifiedRecord に対して、`type` が `'purchase'` なら `deletePurchaseRecord`、`'drinking'` なら `deleteDrinkingRecord` が呼ばれることを検証
    - fast-check で最低100回のイテレーション
    - **検証対象: 要件 3.1**

  - [x] 3.3 削除成功・失敗時のプロパティベーステストを作成する（Property 3, 4）
    - `src/features/records/__tests__/delete.property.test.tsx` に追加
    - **Property 3: 削除成功時の一覧からの除去**
    - 任意の記録リストから1件削除成功後、その id が一覧に含まれず長さが1減ることを検証
    - **Property 4: 削除失敗時の記録復元**
    - 任意の記録リストから1件の削除が失敗した場合、ロールバック後の一覧が元と同一であることを検証
    - fast-check で各最低100回のイテレーション
    - **検証対象: 要件 3.2, 4.2**

- [x] 4. チェックポイント - 新規コンポーネントとフックの確認
  - すべてのテストが通ることを確認し、不明点があればユーザーに質問する。

- [x] 5. RecordCard の拡張と削除アニメーション
  - [x] 5.1 `src/features/records/components/RecordCard.tsx` に DeleteButton を統合する
    - RecordCardProps に `onDelete` と `isDeleting` を追加
    - カードヘッダー部分に DeleteButton を配置
    - 削除ボタンクリック時に ConfirmDialog を表示する状態管理を追加
    - ConfirmDialog の「削除する」で `onDelete(record.id, record.type)` を呼び出し
    - Framer Motion の `motion.div` でカードをラップし、フェードアウト + スライドアウトの exit アニメーションを設定
    - _要件: 1.1, 1.3, 2.1, 2.2, 2.3, 2.4, 5.1, 5.2_

  - [x] 5.2 RecordCard 削除統合のユニットテストを作成する
    - `src/features/records/__tests__/RecordCard.test.tsx` に削除関連テストを追加
    - DeleteButton がレンダリングされること（要件 1.1）
    - 削除ボタンクリックで ConfirmDialog が表示されること（要件 2.1）
    - _要件: 1.1, 2.1_

- [x] 6. RecordListPage の拡張
  - [x] 6.1 `src/features/records/components/RecordListPage.tsx` に削除機能を統合する
    - `useDeleteRecord` フックを統合
    - `useRecordFetch` の records をローカル state にコピーし、楽観的な除去・復元を管理
    - Framer Motion の `AnimatePresence` で記録カードリストをラップ
    - 各 RecordCard に `layout` プロパティを付与し、削除後の再配置アニメーションを実現
    - RecordCard に `onDelete` と `isDeleting` props を渡す
    - _要件: 3.1, 3.2, 3.3, 4.1, 4.2, 5.1, 5.2, 5.3_

  - [x] 6.2 RecordListPage 削除統合テストを作成する
    - `src/features/records/__tests__/RecordListPage.delete.test.tsx` を作成
    - 削除成功時に記録が一覧から除去されること（要件 3.2）
    - 削除失敗時にエラートーストが表示されること（要件 4.1）
    - 削除失敗時に記録が復元されること（要件 4.2）
    - _要件: 3.2, 4.1, 4.2_

- [x] 7. 最終チェックポイント - 全体の動作確認
  - すべてのテストが通ることを確認し、不明点があればユーザーに質問する。

## 備考

- `*` マーク付きのタスクはオプションであり、MVP実装時にはスキップ可能
- 各タスクは具体的な要件番号を参照しトレーサビリティを確保
- チェックポイントで段階的に動作を検証
- プロパティベーステストは設計ドキュメントの正当性プロパティに対応
- ユニットテストは具体的なシナリオとエッジケースを検証
- バックエンドAPI（GraphQL ミューテーション・リゾルバー）は実装済みのため、フロントエンド実装のみ
