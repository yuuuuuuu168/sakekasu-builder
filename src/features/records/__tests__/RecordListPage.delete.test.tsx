import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

// 絞り込み条件の保存先を決めるためにサインイン中のユーザーを参照する
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'test-user' } }),
}));

// 楽観的更新は useRecordList が持つため、取得層だけをモックして本物のフックを動かす
const mockUseRecordFetch = vi.fn();
vi.mock('../hooks/useRecordFetch', () => ({
  useRecordFetch: (...args: unknown[]) => mockUseRecordFetch(...args),
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
  imageKeys: [],
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
  imageKeys: [],
  createdAt: '2025-02-20T19:00:00.000Z',
  updatedAt: '2025-02-20T19:00:00.000Z',
};

const testRecords = [purchaseRecord, drinkingRecord];

/** 指定した銘柄のカードにある削除ボタンを押す（並び順に依存しないようにする） */
function clickDeleteButtonOf(sakeName: string) {
  const card = screen
    .getAllByTestId('record-card')
    .find((el) => within(el).queryByText(sakeName) !== null);
  if (!card) throw new Error(`card not found: ${sakeName}`);
  fireEvent.click(within(card).getByRole('button', { name: '削除' }));
}

// --- Tests ---

describe('RecordListPage 削除統合テスト', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // records は参照が変わると再同期が走るため、同じ配列を返し続ける
    mockUseRecordFetch.mockReturnValue({
      records: testRecords,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockGraphql.mockResolvedValue({ data: {} });
  });

  // Validates: Requirement 3.2
  it('削除成功時に記録が一覧から除去される', async () => {
    render(<RecordListPage />);

    // 2件の記録が表示されていることを確認
    const cards = screen.getAllByTestId('record-card');
    expect(cards).toHaveLength(2);
    expect(screen.getByText('獺祭 純米大吟醸')).toBeInTheDocument();

    // 購入記録の削除ボタンをクリック
    clickDeleteButtonOf('獺祭 純米大吟醸');

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
    clickDeleteButtonOf('獺祭 純米大吟醸');

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
    clickDeleteButtonOf('獺祭 純米大吟醸');

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
