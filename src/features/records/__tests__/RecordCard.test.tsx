import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecordCard } from '../components/RecordCard';
import type { UnifiedRecord } from '../types';

const noopDelete = vi.fn();
const defaultDeleteProps = { onDelete: noopDelete, isDeleting: false };

// --- 具体的なテストデータ ---

const purchaseRecord: UnifiedRecord = {
  id: 'purchase-001',
  type: 'purchase',
  sakeName: '獺祭 純米大吟醸 磨き三割九分',
  price: 5500,
  date: '2025-01-15',
  category: 'NIHONSHU',
  memo: '正月用に購入',
  storeName: '酒のやまや 仙台店',
  createdAt: '2025-01-15T10:00:00.000Z',
  updatedAt: '2025-01-15T10:00:00.000Z',
};

const drinkingRecord: UnifiedRecord = {
  id: 'drinking-001',
  type: 'drinking',
  sakeName: '山崎 12年',
  price: 1800,
  date: '2025-02-20',
  category: 'WHISKY',
  memo: '友人と飲み会',
  placeName: 'Bar MOON 渋谷',
  drinkingMethod: 'ロック',
  rating: 4,
  createdAt: '2025-02-20T19:00:00.000Z',
  updatedAt: '2025-02-20T19:00:00.000Z',
};

const drinkingRecordNoPrice: UnifiedRecord = {
  id: 'drinking-002',
  type: 'drinking',
  sakeName: 'エビスビール',
  price: null,
  date: '2025-03-10',
  category: 'BEER',
  placeName: '自宅',
  drinkingMethod: 'そのまま',
  rating: 3,
  createdAt: '2025-03-10T20:00:00.000Z',
  updatedAt: '2025-03-10T20:00:00.000Z',
};

const purchaseRecordNoPrice: UnifiedRecord = {
  id: 'purchase-002',
  type: 'purchase',
  sakeName: '黒霧島',
  price: null,
  date: '2025-04-01',
  category: 'SHOCHU',
  storeName: 'コンビニ',
  createdAt: '2025-04-01T12:00:00.000Z',
  updatedAt: '2025-04-01T12:00:00.000Z',
};

// --- テスト ---

describe('RecordCard', () => {
  // Validates: Requirements 1.2, 1.4
  it('購入記録の全フィールドが正しく表示される', () => {
    render(<RecordCard record={purchaseRecord} {...defaultDeleteProps} />);

    expect(screen.getByTestId('sake-name').textContent).toBe('獺祭 純米大吟醸 磨き三割九分');
    expect(screen.getByTestId('record-type-label').textContent).toBe('購入');
    expect(screen.getByTestId('record-date').textContent).toBe('2025-01-15');
    expect(screen.getByTestId('category-label').textContent).toBe('日本酒');
    expect(screen.getByTestId('store-name').textContent).toContain('酒のやまや 仙台店');
    expect(screen.getByTestId('price').textContent).toContain('5,500');
  });

  // Validates: Requirements 1.3, 1.4
  it('飲酒記録の全フィールドが正しく表示される', () => {
    render(<RecordCard record={drinkingRecord} {...defaultDeleteProps} />);

    expect(screen.getByTestId('sake-name').textContent).toBe('山崎 12年');
    expect(screen.getByTestId('record-type-label').textContent).toBe('飲酒');
    expect(screen.getByTestId('record-date').textContent).toBe('2025-02-20');
    expect(screen.getByTestId('category-label').textContent).toBe('ウイスキー');
    expect(screen.getByTestId('place-name').textContent).toContain('Bar MOON 渋谷');
    expect(screen.getByTestId('price').textContent).toContain('1,800');
    expect(screen.getByTestId('drinking-method').textContent).toContain('ロック');
    expect(screen.getByTestId('rating')).toBeTruthy();
    // 4つ星 = ★★★★☆
    expect(screen.getByTestId('rating').textContent).toContain('★★★★☆');
  });

  // Validates: Requirement 1.4
  it('購入記録の種別ラベルが「購入」と表示される', () => {
    render(<RecordCard record={purchaseRecord} {...defaultDeleteProps} />);
    expect(screen.getByTestId('record-type-label').textContent).toBe('購入');
  });

  // Validates: Requirement 1.4
  it('飲酒記録の種別ラベルが「飲酒」と表示される', () => {
    render(<RecordCard record={drinkingRecord} {...defaultDeleteProps} />);
    expect(screen.getByTestId('record-type-label').textContent).toBe('飲酒');
  });

  // Validates: Requirements 1.2, 1.3
  it('価格がnullの場合は価格が表示されない', () => {
    render(<RecordCard record={drinkingRecordNoPrice} {...defaultDeleteProps} />);
    expect(screen.queryByTestId('price')).toBeNull();
  });

  it('購入記録で価格がnullの場合も価格が表示されない', () => {
    render(<RecordCard record={purchaseRecordNoPrice} {...defaultDeleteProps} />);
    expect(screen.queryByTestId('price')).toBeNull();
  });

  // Validates: Requirements 1.2, 1.3
  it('カテゴリラベルが正しい日本語テキストで表示される', () => {
    const categories: Array<{ category: UnifiedRecord['category']; label: string }> = [
      { category: 'NIHONSHU', label: '日本酒' },
      { category: 'BEER', label: 'ビール' },
      { category: 'WINE', label: 'ワイン' },
      { category: 'WHISKY', label: 'ウイスキー' },
      { category: 'SHOCHU', label: '焼酎' },
      { category: 'OTHER', label: 'その他' },
    ];

    for (const { category, label } of categories) {
      const record: UnifiedRecord = { ...purchaseRecord, id: `cat-${category}`, category };
      const { unmount } = render(<RecordCard record={record} {...defaultDeleteProps} />);
      expect(screen.getByTestId('category-label').textContent).toBe(label);
      unmount();
    }
  });

  // --- 削除機能の統合テスト ---

  // Validates: Requirement 1.1
  it('DeleteButton がカード内にレンダリングされる', () => {
    render(<RecordCard record={purchaseRecord} {...defaultDeleteProps} />);
    const deleteButton = screen.getByRole('button', { name: '削除' });
    expect(deleteButton).toBeTruthy();
  });

  // Validates: Requirement 2.1
  it('削除ボタンクリックで ConfirmDialog が表示される', async () => {
    render(<RecordCard record={purchaseRecord} {...defaultDeleteProps} />);
    const deleteButton = screen.getByRole('button', { name: '削除' });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(
        screen.getByText(/「獺祭 純米大吟醸 磨き三割九分」の購入記録を削除しますか/)
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: '削除する' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
    });
  });
});
