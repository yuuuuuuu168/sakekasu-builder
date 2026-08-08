import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the useRecordFetch hook
vi.mock('@/features/records/hooks/useRecordFetch', () => ({
  useRecordFetch: vi.fn(),
}));

// Mock ThemeToggle to avoid ThemeProvider dependency
vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

import { CalendarPage } from '../components/CalendarPage';
import { useRecordFetch } from '@/features/records/hooks/useRecordFetch';
import type { UnifiedRecord } from '@/features/records/types';

const mockUseRecordFetch = vi.mocked(useRecordFetch);

function makeRecord(overrides: Partial<UnifiedRecord> & Pick<UnifiedRecord, 'id' | 'type' | 'date'>): UnifiedRecord {
  return {
    sakeName: 'テスト酒',
    price: null,
    category: 'NIHONSHU',
    imageKeys: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const baseMockReturn = {
  records: [] as UnifiedRecord[],
  isLoading: false,
  error: null,
  refetch: vi.fn(),
};

describe('CalendarPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 「今日」を 2026-08-08 に固定してカレンダーの表示月を安定させる
    vi.useFakeTimers({ now: new Date(2026, 7, 8, 12, 0, 0), toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ローディング中にLoadingStateが表示される', () => {
    mockUseRecordFetch.mockReturnValue({ ...baseMockReturn, isLoading: true });

    render(<CalendarPage />);

    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('エラー時にエラーメッセージと再取得ボタンが表示される', () => {
    mockUseRecordFetch.mockReturnValue({
      ...baseMockReturn,
      error: 'データの取得に失敗しました',
    });

    render(<CalendarPage />);

    expect(screen.getByText('データの取得に失敗しました')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再取得' })).toBeTruthy();
  });

  it('今月の飲んだ日数・買った日数がサマリーに表示される', () => {
    mockUseRecordFetch.mockReturnValue({
      ...baseMockReturn,
      records: [
        makeRecord({ id: '1', type: 'drinking', date: '2026-08-01' }),
        makeRecord({ id: '2', type: 'drinking', date: '2026-08-05' }),
        makeRecord({ id: '3', type: 'purchase', date: '2026-08-03' }),
        makeRecord({ id: '4', type: 'drinking', date: '2026-07-20' }), // 前月 → 対象外
      ],
    });

    render(<CalendarPage />);

    expect(screen.getByText('🍶 8月に飲んだ日')).toBeTruthy();
    expect(screen.getByText('🛒 8月に買った日')).toBeTruthy();
    // 飲んだ日: 2日 / 買った日: 1日（同月内のユニーク日数）
    expect(screen.getByTestId('summary-drinking-days').textContent).toBe('2日');
    expect(screen.getByTestId('summary-purchase-days').textContent).toBe('1日');
  });

  it('初期表示では今日の記録が一覧に表示される', () => {
    mockUseRecordFetch.mockReturnValue({
      ...baseMockReturn,
      records: [
        makeRecord({ id: '1', type: 'drinking', date: '2026-08-08', sakeName: '獺祭 純米大吟醸45', rating: 5 }),
        makeRecord({ id: '2', type: 'purchase', date: '2026-08-08', sakeName: '八海山 特別本醸造', price: 1500 }),
        makeRecord({ id: '3', type: 'drinking', date: '2026-08-01', sakeName: '別日の酒' }),
      ],
    });

    render(<CalendarPage />);

    expect(screen.getByText('8月8日（土）の記録')).toBeTruthy();
    expect(screen.getByText('獺祭 純米大吟醸45')).toBeTruthy();
    expect(screen.getByText('八海山 特別本醸造')).toBeTruthy();
    expect(screen.getByText('★5')).toBeTruthy();
    expect(screen.getByText('¥1,500')).toBeTruthy();
    expect(screen.queryByText('別日の酒')).toBeNull();
  });

  it('選択日に記録がない場合はメッセージが表示される', () => {
    mockUseRecordFetch.mockReturnValue({
      ...baseMockReturn,
      records: [makeRecord({ id: '1', type: 'drinking', date: '2026-08-01' })],
    });

    render(<CalendarPage />);

    expect(screen.getByText('この日の記録はありません')).toBeTruthy();
  });
});
