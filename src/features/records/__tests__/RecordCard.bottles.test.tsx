import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// 画像 URL 取得は本数の表示に関係しないので固定値を返す
vi.mock('@/features/image/hooks/useImageUrl', () => ({
  useImageUrl: () => ({ imageUrl: null, isLoading: false, hasError: false }),
}));

import { RecordCard } from '../components/RecordCard';
import type { UnifiedRecord } from '../types';

function purchase(overrides: Partial<UnifiedRecord> = {}): UnifiedRecord {
  return {
    id: 'p-1',
    type: 'purchase',
    sakeName: '獺祭',
    price: 3000,
    date: '2026-01-10',
    category: 'NIHONSHU',
    storeName: '酒屋',
    quantity: 3,
    remainingQuantity: 3,
    drinkingStatus: 'NOT_STARTED',
    imageKeys: [],
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

const deleteProps = { onDelete: vi.fn(), isDeleting: false };

describe('RecordCard のまとめ買い表示（Issue #159）', () => {
  it('飲み中でも開封は1本ぶんで、残りは未開封として内訳に出る', () => {
    render(
      <RecordCard record={purchase({ drinkingStatus: 'IN_PROGRESS' })} {...deleteProps} />,
    );

    expect(screen.getByTestId('bottle-breakdown').textContent).toBe('飲み中 1本 / 未開封 2本');
  });

  it('1本だけの記録には内訳を出さない', () => {
    render(
      <RecordCard
        record={purchase({ quantity: 1, remainingQuantity: 1, drinkingStatus: 'IN_PROGRESS' })}
        {...deleteProps}
      />,
    );

    expect(screen.queryByTestId('bottle-breakdown')).not.toBeInTheDocument();
  });

  it('飲んで減ったぶんは残り本数として出る', () => {
    render(<RecordCard record={purchase({ remainingQuantity: 2 })} {...deleteProps} />);

    expect(screen.getByTestId('quantity').textContent).toContain('3本');
    expect(screen.getByTestId('remaining-quantity').textContent).toContain('2本');
  });

  it('購入本数のまま残っていれば残り本数は出さない', () => {
    render(<RecordCard record={purchase()} {...deleteProps} />);

    expect(screen.queryByTestId('remaining-quantity')).not.toBeInTheDocument();
  });
});

describe('RecordCard の飲みきり操作', () => {
  it('残り2本以上ならダイアログで本数を聞いてから飲みきる', () => {
    const onDrinkingStatusChange = vi.fn();
    const record = purchase({ drinkingStatus: 'IN_PROGRESS' });
    render(
      <RecordCard record={record} {...deleteProps} onDrinkingStatusChange={onDrinkingStatusChange} />,
    );

    fireEvent.click(screen.getByTestId('drinking-status'));

    // 本数を聞く前に減らしてはいけない
    expect(onDrinkingStatusChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('finish-bottles-input'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('finish-bottles-confirm'));

    expect(onDrinkingStatusChange).toHaveBeenCalledWith(record, 'FINISHED', 2);
  });

  it('残り1本ならダイアログを出さずにそのまま飲みきる', () => {
    const onDrinkingStatusChange = vi.fn();
    const record = purchase({ remainingQuantity: 1, drinkingStatus: 'IN_PROGRESS' });
    render(
      <RecordCard record={record} {...deleteProps} onDrinkingStatusChange={onDrinkingStatusChange} />,
    );

    fireEvent.click(screen.getByTestId('drinking-status'));

    expect(screen.queryByTestId('finish-bottles-dialog')).not.toBeInTheDocument();
    expect(onDrinkingStatusChange).toHaveBeenCalledWith(record, 'FINISHED');
  });

  it('残り本数を超える入力では確定できない', () => {
    const record = purchase({ remainingQuantity: 2, drinkingStatus: 'IN_PROGRESS' });
    render(<RecordCard record={record} {...deleteProps} onDrinkingStatusChange={vi.fn()} />);

    fireEvent.click(screen.getByTestId('drinking-status'));
    fireEvent.change(screen.getByTestId('finish-bottles-input'), { target: { value: '3' } });

    expect(screen.getByTestId('finish-bottles-confirm')).toBeDisabled();
  });

  it('開き直すと本数の入力は1本に戻る', () => {
    const record = purchase({ drinkingStatus: 'IN_PROGRESS' });
    render(<RecordCard record={record} {...deleteProps} onDrinkingStatusChange={vi.fn()} />);

    fireEvent.click(screen.getByTestId('drinking-status'));
    fireEvent.change(screen.getByTestId('finish-bottles-input'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('キャンセル'));

    fireEvent.click(screen.getByTestId('drinking-status'));
    expect(screen.getByTestId('finish-bottles-input')).toHaveValue(1);
  });

  it('開封操作ではダイアログを出さない', () => {
    const onDrinkingStatusChange = vi.fn();
    const record = purchase();
    render(
      <RecordCard record={record} {...deleteProps} onDrinkingStatusChange={onDrinkingStatusChange} />,
    );

    fireEvent.click(screen.getByTestId('drinking-status'));

    expect(screen.queryByTestId('finish-bottles-dialog')).not.toBeInTheDocument();
    expect(onDrinkingStatusChange).toHaveBeenCalledWith(record, 'IN_PROGRESS');
  });
});
