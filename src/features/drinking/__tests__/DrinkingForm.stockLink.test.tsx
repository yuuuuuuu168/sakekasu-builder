import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// sonner の toast をモック
const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: vi.fn(),
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

// 購入記録のステータス更新をモック
const mockMarkPurchaseAsInProgress = vi.fn(async () => true);
vi.mock('@/features/purchase/lib/purchaseStatus', () => ({
  markPurchaseAsInProgress: (...args: unknown[]) => mockMarkPurchaseAsInProgress(...args),
}));

import { DrinkingForm } from '../components/DrinkingForm';
import type { StockDrinkDraft } from '../types';

const whiskyDraft: StockDrinkDraft = {
  purchaseRecordId: 'purchase-001',
  sakeName: '山崎 12年',
  category: 'WHISKY',
  drinkingStatus: 'NOT_STARTED',
};

// 送信を伴うテストでは、飲み方の選択が不要なカテゴリを使って Select 操作を避ける
const beerDraft: StockDrinkDraft = {
  purchaseRecordId: 'purchase-002',
  sakeName: 'よなよなエール',
  category: 'BEER',
  drinkingStatus: 'NOT_STARTED',
};

/** 評価を入れてフォームを送信する */
function rateAndSubmit() {
  // star-3 = 4番目の星 = rating 4
  fireEvent.click(screen.getByTestId('star-3'));
  fireEvent.click(screen.getByTestId('submit-button'));
}

describe('DrinkingForm 在庫との紐づけ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveDrinking.mockResolvedValue({ success: true });
    mockMarkPurchaseAsInProgress.mockResolvedValue(true);
  });

  it('銘柄名とカテゴリが在庫から引き継がれ、紐づけバナーが出る', () => {
    render(<DrinkingForm stockDraft={whiskyDraft} />);

    expect(screen.getByTestId('stock-link-banner')).toHaveTextContent('山崎 12年');
    expect(screen.getByTestId('input-sakeName')).toHaveValue('山崎 12年');
    expect(screen.getByTestId('input-placeName')).toHaveValue('自宅');
    // ウイスキーは飲み方の選択が必要なカテゴリ
    expect(screen.getByTestId('input-drinkingMethod')).toBeInTheDocument();
  });

  it('紐づけありで登録すると purchaseRecordId が送信される', async () => {
    render(<DrinkingForm stockDraft={beerDraft} />);

    rateAndSubmit();

    await waitFor(() => {
      expect(mockSaveDrinking).toHaveBeenCalledWith(
        expect.objectContaining({ sakeName: 'よなよなエール', category: 'BEER' }),
        expect.objectContaining({ purchaseRecordId: 'purchase-002' }),
      );
    });
  });

  it('未開封の在庫から登録すると購入記録が飲み中に更新される', async () => {
    const onStockDraftClear = vi.fn();
    render(<DrinkingForm stockDraft={beerDraft} onStockDraftClear={onStockDraftClear} />);

    rateAndSubmit();

    await waitFor(() => {
      expect(mockMarkPurchaseAsInProgress).toHaveBeenCalledWith('purchase-002');
    });
    expect(onStockDraftClear).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        '登録が完了しました。在庫を「飲み中」に更新しました',
      );
    });
  });

  it('すでに飲み中の在庫ではステータスを更新しない', async () => {
    render(<DrinkingForm stockDraft={{ ...beerDraft, drinkingStatus: 'IN_PROGRESS' }} />);

    rateAndSubmit();

    await waitFor(() => {
      expect(mockSaveDrinking).toHaveBeenCalled();
    });
    expect(mockMarkPurchaseAsInProgress).not.toHaveBeenCalled();
  });

  it('紐づけがない場合は purchaseRecordId が null で送られる', async () => {
    render(<DrinkingForm />);

    expect(screen.queryByTestId('stock-link-banner')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('input-sakeName'), { target: { value: '獺祭' } });
    fireEvent.change(screen.getByTestId('input-placeName'), { target: { value: '居酒屋' } });
    fireEvent.click(screen.getByTestId('input-drinkingMethod'));
    fireEvent.click(await screen.findByRole('option', { name: '冷酒' }));
    rateAndSubmit();

    await waitFor(() => {
      expect(mockSaveDrinking).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ purchaseRecordId: null }),
      );
    });
    expect(mockMarkPurchaseAsInProgress).not.toHaveBeenCalled();
  });

  it('紐づけ解除ボタンで解除が通知される', () => {
    const onStockDraftClear = vi.fn();
    render(<DrinkingForm stockDraft={whiskyDraft} onStockDraftClear={onStockDraftClear} />);

    fireEvent.click(screen.getByTestId('stock-link-clear'));

    expect(onStockDraftClear).toHaveBeenCalled();
  });
});
