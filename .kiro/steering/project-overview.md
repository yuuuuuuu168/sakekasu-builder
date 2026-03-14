---
inclusion: always
---

# sakekasu-builder.com プロジェクト概要

## サービス概要
酒飲みのための記録・管理Webサイト（sakekasu-builder.com）。日本酒・ウイスキー・焼酎などのバリエーションが多く「何を飲んだか」「何を買ったか」を忘れがちな問題を解決する。

## 計画している機能一覧

| # | 機能 | 状態 | spec |
|---|------|------|------|
| 1 | 購入したお酒を登録するページ | ✅ 実装済み | #[[file:.kiro/specs/sake-purchase-registration/requirements.md]] |
| 2 | 飲んだお酒を登録するページ | 未着手 | - |
| 3 | 購入・飲酒記録の一覧ページ | 未着手 | - |
| 4 | 写真からおすすめ提案（AI） | 未着手 | - |

### 機能1: 購入したお酒の登録
- 銘柄名、購入店舗、価格、購入日、カテゴリ、メモを登録
- カテゴリ: 日本酒、ビール、ワイン、ウイスキー、焼酎、その他

### 機能2: 飲んだお酒の登録
- どこで、いくらで、どんな銘柄を飲んだか + 好みの評価を登録

### 機能3: 一覧表示
- 機能1・2の登録内容を一覧で閲覧

### 機能4: おすすめ提案
- 過去の好みデータをもとに、居酒屋メニュー等の写真からおすすめ銘柄を提案

## 技術スタック

- **フレームワーク**: React 19 + TypeScript 5.9
- **ビルドツール**: Vite 7
- **スタイリング**: Tailwind CSS v4（`@theme` ディレクティブ、`@import "tailwindcss"` 方式、tailwind.config.js 不使用）
- **UIコンポーネント**: shadcn/ui（@base-ui/react ベース）
- **アニメーション**: Framer Motion
- **バックエンド**: AWS Amplify Gen 2（Data: AppSync + DynamoDB）
- **認証**: 現在は apiKey（将来的にCognito移行予定）
- **テスト**: Vitest + Testing Library + fast-check（プロパティベーステスト）
- **フォント**: Geist Variable

## プロジェクト構成

```
src/
  features/          # 機能ごとのディレクトリ
    purchase/        # 購入登録機能
      components/    # UI コンポーネント
      hooks/         # カスタムフック
      __tests__/     # テスト（unit + property）
      types.ts       # 型定義
  components/        # 共通コンポーネント
    ui/              # shadcn/ui コンポーネント
    ThemeProvider.tsx # ダークモード
    ThemeToggle.tsx   # テーマ切替
  lib/               # ユーティリティ
amplify/
  data/resource.ts   # Amplify Data スキーマ
  backend.ts         # Amplify バックエンド設定
```

## デザインテーマ
- 「和モダン」コンセプト
- ダークモード対応（next-themes）
- カスタムカラーパレット（sake-gold, sake-red, sake-navy 等）

## 開発ルール
- 新機能は `src/features/{feature-name}/` に配置
- テストは `__tests__/` に unit テストと property テスト（fast-check）を配置
- Amplify のモックは `src/__mocks__/` に配置し、`vite.config.ts` の test.alias で解決
- コンポーネントは shadcn/ui をベースに構築
- 日本語UIを基本とする
