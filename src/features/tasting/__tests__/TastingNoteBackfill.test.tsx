/**
 * 一括追記バナーの表示条件のテスト。
 *
 * 押しても何も起きない状態のバナーを画面に残さないことを見る。
 * 調べても書けなかった記録は対象から外れるので、それしか残っていなければ
 * バナーごと消える。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { UnifiedRecord } from '@/features/records/types';
import { saveSkippedKeys, skipKey } from '../lib/skippedStorage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: vi.fn() }),
}));

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'user-1' } }),
}));

import { TastingNoteBackfill } from '../components/TastingNoteBackfill';

function record(overrides: Partial<UnifiedRecord> = {}): UnifiedRecord {
  return {
    id: 'p-1',
    type: 'purchase',
    sakeName: '山崎 12年',
    price: 12000,
    date: '2026-01-10',
    category: 'WHISKY',
    imageKeys: [],
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('TastingNoteBackfill', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('未記載の記録があれば件数と追記ボタンを出す', () => {
    render(<TastingNoteBackfill records={[record()]} onMemoUpdated={vi.fn()} />);

    expect(screen.getByTestId('tasting-note-backfill')).toBeInTheDocument();
    expect(screen.getByTestId('tasting-note-backfill-button')).toBeEnabled();
  });

  // ここが今回の主眼。0件のバナーは画面の無駄になる
  it('書けなかった記録しか残っていなければ何も出さない', () => {
    saveSkippedKeys('user-1', [skipKey('p-1', '山崎 12年')]);

    render(<TastingNoteBackfill records={[record()]} onMemoUpdated={vi.fn()} />);

    expect(screen.queryByTestId('tasting-note-backfill')).not.toBeInTheDocument();
  });

  it('対象がまったく無ければ何も出さない', () => {
    render(
      <TastingNoteBackfill records={[record({ category: 'BEER' })]} onMemoUpdated={vi.fn()} />,
    );

    expect(screen.queryByTestId('tasting-note-backfill')).not.toBeInTheDocument();
  });

  // 件数が実際の未記載数と食い違って見えるので、外している分は添える
  it('対象が残っているときは、外している件数を添える', () => {
    saveSkippedKeys('user-1', [skipKey('p-2', '白州')]);

    render(
      <TastingNoteBackfill
        records={[record(), record({ id: 'p-2', sakeName: '白州' })]}
        onMemoUpdated={vi.fn()}
      />,
    );

    expect(screen.getByTestId('tasting-note-backfill-skipped')).toHaveTextContent(
      '調べても書けなかった 1件を除く',
    );
  });
});
