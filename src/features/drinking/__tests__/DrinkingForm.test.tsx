import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { format } from 'date-fns';

// sonner の toast をモック
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// useDrinkingStorage をモック
const mockSaveDrinking = vi.fn(async () => ({ success: true }));
vi.mock('@/features/drinking/hooks/useDrinkingStorage', () => ({
  useDrinkingStorage: () => ({
    saveDrinking: mockSaveDrinking,
    isSaving: false,
  }),
}));

import { DrinkingForm } from '../components/DrinkingForm';

describe('DrinkingForm ユニットテスト', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveDrinking.mockResolvedValue({ success: true });
  });

  describe('フォーム初期表示', () => {
    it('全フィールドが存在する', () => {
      render(<DrinkingForm />);

      expect(screen.getByTestId('input-sakeName')).toBeInTheDocument();
      expect(screen.getByTestId('input-placeName')).toBeInTheDocument();
      expect(screen.getByTestId('input-price')).toBeInTheDocument();
      expect(screen.getByTestId('input-drinkingDate')).toBeInTheDocument();
      expect(screen.getByTestId('input-category')).toBeInTheDocument();
      expect(screen.getByTestId('input-drinkingMethod')).toBeInTheDocument();
      expect(screen.getByTestId('input-rating')).toBeInTheDocument();
      expect(screen.getByTestId('input-memo')).toBeInTheDocument();
      expect(screen.getByTestId('submit-button')).toBeInTheDocument();
    });

    it('飲んだ日の初期値が本日の日付で表示される', () => {
      render(<DrinkingForm />);

      const today = format(new Date(), 'yyyy年MM月dd日');
      const dateButton = screen.getByTestId('input-drinkingDate');
      expect(dateButton).toHaveTextContent(today);
    });

    it('登録ボタンのテキストが「🍶 登録する」である', () => {
      render(<DrinkingForm />);

      const submitButton = screen.getByTestId('submit-button');
      expect(submitButton).toHaveTextContent('🍶 登録する');
    });
  });

  describe('星評価UIの初期状態', () => {
    it('星評価が未選択状態（rating-text に "0/5" が表示される）', () => {
      render(<DrinkingForm />);

      const ratingText = screen.getByTestId('rating-text');
      expect(ratingText).toHaveTextContent('0/5');
    });
  });

  describe('保存成功時', () => {
    it('成功メッセージが toast.success で表示される', async () => {
      mockSaveDrinking.mockResolvedValue({ success: true });
      render(<DrinkingForm />);

      // 必須フィールドに有効な値を入力
      fireEvent.change(screen.getByTestId('input-sakeName'), {
        target: { value: '獺祭' },
      });
      fireEvent.change(screen.getByTestId('input-placeName'), {
        target: { value: '居酒屋 花鳥風月' },
      });

      // 飲み方を選択（Select コンポーネント）
      fireEvent.click(screen.getByTestId('input-drinkingMethod'));
      await waitFor(() => {
        const option = screen.getByRole('option', { name: '冷酒' });
        fireEvent.click(option);
      });

      // 星評価を設定（star-2 = 3番目の星 = rating 3）
      fireEvent.click(screen.getByTestId('star-2'));

      // フォーム送信
      fireEvent.click(screen.getByTestId('submit-button'));

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith('登録が完了しました');
      });
    });
  });

  describe('保存失敗時', () => {
    it('エラーメッセージが toast.error で表示される', async () => {
      mockSaveDrinking.mockResolvedValue({
        success: false,
        error: '登録に失敗しました。もう一度お試しください',
      });
      render(<DrinkingForm />);

      // 必須フィールドに有効な値を入力
      fireEvent.change(screen.getByTestId('input-sakeName'), {
        target: { value: '獺祭' },
      });
      fireEvent.change(screen.getByTestId('input-placeName'), {
        target: { value: '居酒屋 花鳥風月' },
      });

      // 飲み方を選択
      fireEvent.click(screen.getByTestId('input-drinkingMethod'));
      await waitFor(() => {
        const option = screen.getByRole('option', { name: '冷酒' });
        fireEvent.click(option);
      });

      // 星評価を設定
      fireEvent.click(screen.getByTestId('star-2'));

      // フォーム送信
      fireEvent.click(screen.getByTestId('submit-button'));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          '登録に失敗しました。もう一度お試しください',
        );
      });
    });
  });
});
