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
const mockMarkPurchaseAsInProgress = vi.fn(async () => 'opened');
vi.mock('@/features/purchase/lib/purchaseStatus', () => ({
  markPurchaseAsInProgress: (...args: unknown[]) => mockMarkPurchaseAsInProgress(...args),
}));

import { DrinkingForm } from '../components/DrinkingForm';
import type { StockDrinkDraft } from '../types';

const whiskyDraft: StockDrinkDraft = {
  purchaseRecordId: 'purchase-001',
  sakeName: '山崎 12年',
  category: 'WHISKY',
};

// 送信を伴うテストでは、飲み方の選択が不要なカテゴリを使って Select 操作を避ける
const beerDraft: StockDrinkDraft = {
  purchaseRecordId: 'purchase-002',
  sakeName: 'よなよなエール',
  category: 'BEER',
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
    mockMarkPurchaseAsInProgress.mockResolvedValue('opened');
  });

  it('銘柄名とカテゴリが在庫から引き継がれ、紐づけバナーが出る', () => {
    render(<DrinkingForm stockDraft={whiskyDraft} />);

    expect(screen.getByTestId('stock-link-banner')).toHaveTextContent('山崎 12年');
    expect(screen.getByTestId('input-sakeName')).toHaveValue('山崎 12年');
    expect(screen.getByTestId('input-placeName')).toHaveValue('自宅');
    // ウイスキーは飲み方の選択が必要なカテゴリ
    expect(screen.getByTestId('input-drinkingMethod')).toBeInTheDocument();
  });

  it('在庫に入力済みの詳細スペックを引き継ぐ（Issue #87）', () => {
    render(
      <DrinkingForm
        stockDraft={{
          ...whiskyDraft,
          specs: {
            brewery: 'サントリー',
            region: '大阪府',
            alcoholPercentage: 43,
            volumeMl: null,
            specificName: null,
            ricePolishingRatio: null,
            sakeMeterValue: null,
            acidity: null,
            aminoAcidity: null,
            riceVariety: null,
            yeast: null,
            labelDescription: null,
          },
        }}
      />,
    );

    expect(screen.getByTestId('input-spec-brewery')).toHaveValue('サントリー');
    expect(screen.getByTestId('input-spec-alcoholPercentage')).toHaveValue(43);
    // ウイスキーなので日本酒向けの項目は出さない
    expect(screen.queryByTestId('input-spec-ricePolishingRatio')).not.toBeInTheDocument();
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

  it('すでに開封済みだった場合はステータス更新の文言を出さない', async () => {
    // 未開封かどうかはサーバ側の条件式が判定する。変更なしなら unchanged が返る
    mockMarkPurchaseAsInProgress.mockResolvedValue('unchanged');
    render(<DrinkingForm stockDraft={beerDraft} />);

    rateAndSubmit();

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith('登録が完了しました');
    });
  });

  it('在庫ステータスの更新に失敗しても登録自体は成功として扱う', async () => {
    mockMarkPurchaseAsInProgress.mockResolvedValue('failed');
    render(<DrinkingForm stockDraft={beerDraft} />);

    rateAndSubmit();

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        '登録は完了しましたが、在庫のステータス更新に失敗しました',
      );
    });
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

  it('連打しても登録は1回しか走らない', async () => {
    // 在庫ステータス更新の途中でボタンが復活しないことを確かめる
    let resolveMark: (v: string) => void = () => {};
    mockMarkPurchaseAsInProgress.mockImplementation(
      () => new Promise((resolve) => { resolveMark = resolve; }),
    );

    render(<DrinkingForm stockDraft={beerDraft} />);

    fireEvent.click(screen.getByTestId('star-3'));
    fireEvent.click(screen.getByTestId('submit-button'));

    await waitFor(() => {
      expect(mockMarkPurchaseAsInProgress).toHaveBeenCalledTimes(1);
    });

    // 在庫ステータス更新の完了を待たずに再送信を試みる
    fireEvent.click(screen.getByTestId('submit-button'));
    fireEvent.submit(screen.getByTestId('drinking-form'));

    resolveMark('opened');

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalled();
    });
    expect(mockSaveDrinking).toHaveBeenCalledTimes(1);
    expect(mockMarkPurchaseAsInProgress).toHaveBeenCalledTimes(1);
  });

  it('紐づけ解除ボタンで解除が通知される', () => {
    const onStockDraftClear = vi.fn();
    render(<DrinkingForm stockDraft={whiskyDraft} onStockDraftClear={onStockDraftClear} />);

    fireEvent.click(screen.getByTestId('stock-link-clear'));

    expect(onStockDraftClear).toHaveBeenCalled();
  });
});
