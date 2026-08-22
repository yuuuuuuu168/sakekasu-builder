import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the useRecordList hook
vi.mock('../hooks/useRecordList', () => ({
  useRecordList: vi.fn(),
}));

// Mock ThemeToggle to avoid ThemeProvider dependency
vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

// 一括追記のバナーは「書けなかった記録」をユーザーごとに控えるため認証を見る。
// このテストは AuthProvider を張らないので差し替える
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'user-1' } }),
}));

import { RecordListPage } from '../components/RecordListPage';
import { useRecordList } from '../hooks/useRecordList';

const mockUseRecordList = vi.mocked(useRecordList);

const baseMockReturn = {
  records: [],
  allRecords: [],
  drinkingStatusFilter: 'all' as const,
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
  setDrinkingStatusFilter: vi.fn(),
  resetFilters: vi.fn(),
  refetch: vi.fn(),
  removeRecord: vi.fn(),
  restoreRecord: vi.fn(),
  patchRecord: vi.fn(),
};

describe('RecordListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Validates: Requirement 5.2
  it('ローディング中にLoadingStateが表示される', () => {
    mockUseRecordList.mockReturnValue({
      ...baseMockReturn,
      isLoading: true,
    });

    render(<RecordListPage />);

    // LoadingState はスケルトンUI（animate-pulse）を表示する
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // Validates: Requirement 5.3
  it('エラー時にエラーメッセージと再取得ボタンが表示される', () => {
    mockUseRecordList.mockReturnValue({
      ...baseMockReturn,
      error: 'データの取得に失敗しました',
    });

    render(<RecordListPage />);

    expect(screen.getByText('データの取得に失敗しました')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再取得' })).toBeTruthy();
  });

  // Validates: Requirement 1.5
  it('記録が0件でフィルタなしの場合「記録がありません」が表示される', () => {
    mockUseRecordList.mockReturnValue({
      ...baseMockReturn,
      records: [],
      recordType: 'all',
      category: 'all',
    });

    render(<RecordListPage />);

    expect(screen.getByText('記録がありません')).toBeTruthy();
  });

  // Validates: Requirement 3.5 (via 1.5)
  it('記録が0件でフィルタありの場合「条件に一致する記録がありません」が表示される', () => {
    mockUseRecordList.mockReturnValue({
      ...baseMockReturn,
      records: [],
      recordType: 'purchase',
      category: 'all',
      hasActiveFilter: true,
    });

    render(<RecordListPage />);

    expect(screen.getByText('条件に一致する記録がありません')).toBeTruthy();
  });
});
