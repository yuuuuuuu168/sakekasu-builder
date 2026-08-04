import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// 画像 URL 取得は在庫連携の対象外なので固定値を返す
vi.mock('@/features/image/hooks/useImageUrl', () => ({
  useImageUrl: () => ({ imageUrl: null, isLoading: false, hasError: false }),
}));

import { RecordCard } from '../components/RecordCard';
import { InventorySummary } from '../components/InventorySummary';
import type { UnifiedRecord } from '../types';
import type { DrinkingStatus } from '@/types/schema';

function purchaseRecord(drinkingStatus: DrinkingStatus = 'NOT_STARTED'): UnifiedRecord {
  return {
    id: 'p-1',
    type: 'purchase',
    sakeName: '山崎 12年',
    price: 12000,
    date: '2026-01-10',
    category: 'WHISKY',
    storeName: '酒屋',
    quantity: 1,
    drinkingStatus,
    imageKeys: [],
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
  };
}

const noop = () => {};

describe('RecordCard 在庫からの飲酒登録', () => {
  it('未開封の購入記録に「これを飲む」ボタンが出る', () => {
    render(
      <RecordCard
        record={purchaseRecord('NOT_STARTED')}
        onDelete={noop}
        isDeleting={false}
        onDrinkFromStock={noop}
      />,
    );

    expect(screen.getByTestId('drink-from-stock')).toBeInTheDocument();
  });

  it('飲みきりの購入記録にはボタンが出ない', () => {
    render(
      <RecordCard
        record={purchaseRecord('FINISHED')}
        onDelete={noop}
        isDeleting={false}
        onDrinkFromStock={noop}
      />,
    );

    expect(screen.queryByTestId('drink-from-stock')).not.toBeInTheDocument();
  });

  it('ボタンを押すと対象の記録が通知される', () => {
    const onDrinkFromStock = vi.fn();
    const record = purchaseRecord('IN_PROGRESS');

    render(
      <RecordCard
        record={record}
        onDelete={noop}
        isDeleting={false}
        onDrinkFromStock={onDrinkFromStock}
      />,
    );

    fireEvent.click(screen.getByTestId('drink-from-stock'));

    expect(onDrinkFromStock).toHaveBeenCalledWith(record);
  });

  it('飲酒記録にはボタンが出ない', () => {
    const drinking: UnifiedRecord = {
      id: 'd-1',
      type: 'drinking',
      sakeName: '山崎 12年',
      price: 1800,
      date: '2026-01-11',
      category: 'WHISKY',
      placeName: 'Bar',
      drinkingMethod: 'ロック',
      rating: 4,
      imageKeys: [],
      createdAt: '2026-01-11T00:00:00.000Z',
      updatedAt: '2026-01-11T00:00:00.000Z',
    };

    render(
      <RecordCard record={drinking} onDelete={noop} isDeleting={false} onDrinkFromStock={noop} />,
    );

    expect(screen.queryByTestId('drink-from-stock')).not.toBeInTheDocument();
  });
});

describe('RecordCard 紐づいた飲酒記録の表示', () => {
  it('件数・平均評価・最新メモが表示される', () => {
    render(
      <RecordCard
        record={purchaseRecord('IN_PROGRESS')}
        onDelete={noop}
        isDeleting={false}
        linkedDrinking={{
          count: 2,
          averageRating: 4.5,
          latestMemo: 'バニラの香りがすごい',
          latestDate: '2026-02-01',
        }}
      />,
    );

    const linked = screen.getByTestId('linked-drinking');
    expect(linked).toHaveTextContent('飲んだ記録 2件');
    expect(screen.getByTestId('linked-drinking-rating')).toHaveTextContent('4.5');
    expect(screen.getByTestId('linked-drinking-memo')).toHaveTextContent('バニラの香りがすごい');
  });

  it('紐づいた記録がなければ表示されない', () => {
    render(<RecordCard record={purchaseRecord()} onDelete={noop} isDeleting={false} />);

    expect(screen.queryByTestId('linked-drinking')).not.toBeInTheDocument();
  });
});

describe('InventorySummary', () => {
  it('在庫があるときにウイスキーと日本酒の本数を表示する', () => {
    render(<InventorySummary records={[purchaseRecord('NOT_STARTED')]} />);

    expect(screen.getByTestId('inventory-summary')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-WHISKY')).toHaveTextContent('ウイスキー1本');
    expect(screen.getByTestId('inventory-NIHONSHU')).toHaveTextContent('日本酒0本');
  });

  it('飲み中があるときは内訳を添える', () => {
    render(<InventorySummary records={[purchaseRecord('IN_PROGRESS')]} />);

    expect(screen.getByTestId('inventory-WHISKY-in-progress')).toHaveTextContent('飲み中 1');
  });

  it('対象カテゴリの在庫がなければ何も表示しない', () => {
    render(<InventorySummary records={[purchaseRecord('FINISHED')]} />);

    expect(screen.queryByTestId('inventory-summary')).not.toBeInTheDocument();
  });
});
