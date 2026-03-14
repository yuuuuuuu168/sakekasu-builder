import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { UnifiedRecord } from '../types';

// --- Mocks ---

const mockGraphql = vi.fn();

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({
    graphql: (...args: unknown[]) => mockGraphql(...args),
  }),
}));

const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: vi.fn(),
  },
}));

vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

// Mock useRecordList to provide controlled test data
const mockUseRecordList = vi.fn();
vi.mock('../hooks/useRecordList', () => ({
  useRecordList: (...args: unknown[]) => mockUseRecordList(...args),
}));

// Import after mocks
import { RecordListPage } from '../components/RecordListPage';

// --- Test data ---

const purchaseRecord: UnifiedRecord = {
  id: 'purchase-001',
  type: 'purchase',
  sakeName: '獺祭 純米大吟醸',
  price: 5500,
  date: '2025-01-15',
  category: 'NIHONSHU',
  memo: '',
  storeName: '酒のやまや',
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
  memo: '',
  placeName: 'Bar MOON',
  drinkingMethod: 'ロック',
  rating: 4,
  createdAt: '2025-02-20T19:00:00.000Z',
  updatedAt: '2025-02-20T19:00:00.000Z',
};

const testRecords = [purchaseRecord, drinkingRecord];

const baseMockReturn = {
  records: testRecords,
  isLoading: false,
  error: null,
  recordType: 'all' as const,
  category: 'all' as const,
  sortOption: 'date-desc' as const,
  searchQuery: '',
  hasActiveFilter: false,
  setRecordType: vi.fn(),
  setCategory: vi.fn(),
  setSortOption: vi.fn(),
  setSearchQuery: vi.fn(),
  resetFilters: vi.fn(),
  refetch: vi.fn(),
};

// --- Tests ---

describe('RecordListPage 削除統合テスト', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRecordList.mockReturnValue({ ...baseMockReturn, records: testRecords });
    mockGraphql.mockResolvedValue({ data: {} });
  });

  // Validates: Requirement 3.2
  it('削除成功時に記録が一覧から除去される', async () => {
    render(<RecordListPage />);

    // 2件の記録が表示されていることを確認
    const cards = screen.getAllByTestId('record-card');
    expect(cards).toHaveLength(2);
    expect(screen.getByText('獺祭 純米大吟醸')).toBeInTheDocument();

    // 最初の記録の削除ボタンをクリック
    const deleteButtons = screen.getAllByRole('button', { name: '削除' });
    fireEvent.click(deleteButtons[0]);

    // 確認ダイアログが表示される
    await waitFor(() => {
      expect(screen.getByText(/「獺祭 純米大吟醸」の購入記録を削除しますか/)).toBeInTheDocument();
    });

    // 「削除する」ボタンをクリック
    const confirmButton = screen.getByRole('button', { name: '削除する' });
    fireEvent.click(confirmButton);

    // 楽観的UI更新で記録が除去される
    await waitFor(() => {
      expect(screen.queryByText('獺祭 純米大吟醸')).not.toBeInTheDocument();
    });

    // 残りの記録は表示されている
    expect(screen.getByText('山崎 12年')).toBeInTheDocument();
  });

  // Validates: Requirement 4.1
  it('削除失敗時にエラートーストが表示される', async () => {
    mockGraphql.mockRejectedValue(new Error('Network error'));

    render(<RecordListPage />);

    // 削除ボタンをクリック
    const deleteButtons = screen.getAllByRole('button', { name: '削除' });
    fireEvent.click(deleteButtons[0]);

    // 確認ダイアログで「削除する」をクリック
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '削除する' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    // エラートーストが表示される
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        '削除に失敗しました。もう一度お試しください。',
      );
    });
  });

  // Validates: Requirement 4.2
  it('削除失敗時に記録が一覧に復元される', async () => {
    mockGraphql.mockRejectedValue(new Error('Server error'));

    render(<RecordListPage />);

    // 2件表示されていることを確認
    expect(screen.getAllByTestId('record-card')).toHaveLength(2);
    expect(screen.getByText('獺祭 純米大吟醸')).toBeInTheDocument();

    // 削除ボタンをクリック
    const deleteButtons = screen.getAllByRole('button', { name: '削除' });
    fireEvent.click(deleteButtons[0]);

    // 確認ダイアログで「削除する」をクリック
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '削除する' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    // 失敗後、記録が復元されて再び表示される
    await waitFor(() => {
      expect(screen.getByText('獺祭 純米大吟醸')).toBeInTheDocument();
      expect(screen.getByText('山崎 12年')).toBeInTheDocument();
    });
  });
});
