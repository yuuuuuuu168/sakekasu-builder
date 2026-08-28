import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

// --- Mocks ---

// 本物の AuthProvider を動かしたいので、その下の Amplify だけを差し替える
const USER_ID = 'cognito-sub-123';
vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: () => Promise.resolve({ userId: USER_ID }),
  fetchUserAttributes: () => Promise.resolve({ email: 'a@example.com' }),
  signIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
}));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: vi.fn() }),
}));

vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

const mockUseRecordFetch = vi.fn();
vi.mock('../hooks/useRecordFetch', () => ({
  useRecordFetch: () => mockUseRecordFetch(),
}));

// Import after mocks
import { AuthProvider } from '@/features/auth/AuthContext';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { RecordListPage } from '../components/RecordListPage';
import { saveFilterState, loadFilterState, DEFAULT_FILTER_STATE } from '../lib/filterStorage';
import type { PersistedFilterState } from '../lib/filterStorage';

const storedState: PersistedFilterState = {
  recordType: 'drinking',
  category: 'WHISKY',
  searchQuery: '山崎',
  drinkingStatus: 'all',
  rating: 4,
  priceRange: 'all',
  dateRange: 'all',
  customDateFrom: '',
  customDateTo: '',
  sortOption: 'rating-desc',
};

/** 実アプリと同じ入れ子（AuthProvider > AuthGuard > 一覧）でレンダーする */
function renderInApp() {
  return render(
    <AuthProvider>
      <AuthGuard>
        <RecordListPage />
      </AuthGuard>
    </AuthProvider>,
  );
}

describe('絞り込み条件の永続化（認証込みの統合）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUseRecordFetch.mockReturnValue({
      records: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  // AuthGuard は認証確定まで children を描画しない。
  // つまり一覧のマウント時点で userId は確定しており、空IDで初期化されることはない
  it('保存済みの条件がサインイン後の一覧に復元される', async () => {
    saveFilterState(USER_ID, storedState);

    renderInApp();

    // 認証解決までは一覧自体が描画されない
    expect(screen.queryByTestId('filter-record-type')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('filter-record-type')).toBeInTheDocument();
    });

    // 評価は詳細フィルタ側。条件が入っているので開いた状態で復元される
    expect(screen.getByTestId('filter-advanced-count')).toHaveTextContent('1');
    expect(screen.getByTestId('filter-rating')).toHaveTextContent('★4以上');
    expect(screen.getByTestId('filter-record-type')).toHaveTextContent('飲酒記録');
    expect(screen.getByTestId('filter-category')).toHaveTextContent('ウイスキー');
    expect(screen.getByTestId('sort-option')).toHaveTextContent('評価（高い順）');
    expect(screen.getByTestId('filter-search')).toHaveValue('山崎');
  });

  it('認証が解決しても保存済みの条件が既定値で上書きされない', async () => {
    saveFilterState(USER_ID, storedState);

    renderInApp();

    await waitFor(() => {
      expect(screen.getByTestId('filter-record-type')).toBeInTheDocument();
    });

    // 認証解決に伴う再レンダーと保存 effect を最後まで流し切ってから確かめる。
    // ここを待たないと、上書きが起きる前に検証が通ってしまう
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadFilterState(USER_ID)).toEqual(storedState);
  });

  it('空のユーザーIDでは保存しない（別ユーザーの領域を汚さない）', async () => {
    renderInApp();

    await waitFor(() => {
      expect(screen.getByTestId('filter-record-type')).toBeInTheDocument();
    });

    expect(localStorage.getItem('sakekasu:record-filters:')).toBeNull();
  });

  it('保存が無ければ既定の条件で表示する', async () => {
    renderInApp();

    await waitFor(() => {
      expect(screen.getByTestId('filter-record-type')).toBeInTheDocument();
    });

    expect(loadFilterState(USER_ID)).toEqual(DEFAULT_FILTER_STATE);

    // 効いている詳細条件が無ければ畳まれたまま。開いて中身を確かめる
    expect(screen.queryByTestId('filter-advanced-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('filter-advanced-count')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('filter-advanced-toggle'));
    expect(screen.getByTestId('filter-rating')).toHaveTextContent('すべて');
  });
});
