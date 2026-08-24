/**
 * 写真からの一括読み取りバナーのテスト。
 *
 * 今できることが無ければ何も出さない、という約束を主に見る。
 * 押しても何も起きないバナーが画面に残ると、その都度「押してみて確かめる」
 * ことになる
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { SpecBackfill } from '../components/SpecBackfill';
import { pickSakeSpecs } from '../lib/sakeSpecs';
import type { UnifiedRecord } from '@/features/records/types';

const { mockGraphql } = vi.hoisted(() => ({ mockGraphql: vi.fn() }));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphql }),
}));

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'user-1' } }),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

function record(overrides: Partial<UnifiedRecord> = {}): UnifiedRecord {
  return {
    id: 'p-1',
    type: 'purchase',
    sakeName: '獺祭 純米大吟醸',
    price: 3300,
    date: '2026-01-10',
    category: 'NIHONSHU',
    imageKeys: ['sub-1/purchase/p-1/front.jpg'],
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('SpecBackfill', () => {
  beforeEach(() => {
    mockGraphql.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    localStorage.clear();
  });

  it('対象があれば件数を出す', () => {
    render(<SpecBackfill records={[record()]} onSpecsUpdated={vi.fn()} />);

    expect(screen.getByTestId('spec-backfill')).toHaveTextContent('1件あります');
  });

  it('スペックが入っている記録には、読み直しの案内だけを出す', () => {
    render(
      <SpecBackfill
        records={[record({ specs: pickSakeSpecs({ brewery: '旭酒造株式会社' }) })]}
        onSpecsUpdated={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('spec-backfill-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('spec-backfill-reread-button')).toBeInTheDocument();
  });

  it('読み直しを済ませた版では何も出さない（用が済んだら消える）', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: {
        analyzeSakeLabel: {
          sakeName: '獺祭',
          brewery: '旭酒造株式会社',
          fieldConfidence: { brewery: 0.95 },
        },
      },
    });
    mockGraphql.mockResolvedValueOnce({ data: { updatePurchaseRecord: { id: 'p-1' } } });

    const { container } = render(
      <SpecBackfill
        records={[record({ specs: pickSakeSpecs({ brewery: '誤った蔵元' }) })]}
        onSpecsUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('spec-backfill-reread-button'));
    fireEvent.click(await screen.findByTestId('spec-backfill-reread-confirm'));

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('読み直しは確認を挟む（手で入れた値まで消えるため）', () => {
    render(
      <SpecBackfill
        records={[record({ specs: pickSakeSpecs({ brewery: '旭酒造株式会社' }) })]}
        onSpecsUpdated={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('spec-backfill-confirm')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('spec-backfill-reread-button'));

    expect(screen.getByTestId('spec-backfill-confirm')).toHaveTextContent(
      '手で入力した値も消えます',
    );
    expect(mockGraphql).not.toHaveBeenCalled();
  });

  it('写真の無い記録だけなら何も出さない', () => {
    const { container } = render(
      <SpecBackfill records={[record({ imageKeys: [] })]} onSpecsUpdated={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('押すと読み取って結果を知らせる', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: {
        analyzeSakeLabel: {
          sakeName: '獺祭',
          brewery: '旭酒造株式会社',
          fieldConfidence: { brewery: 0.95 },
        },
      },
    });
    mockGraphql.mockResolvedValueOnce({ data: { updatePurchaseRecord: { id: 'p-1' } } });
    const onSpecsUpdated = vi.fn();

    render(<SpecBackfill records={[record()]} onSpecsUpdated={onSpecsUpdated} />);
    fireEvent.click(screen.getByTestId('spec-backfill-button'));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith('1件に書き込みました');
    });
    expect(onSpecsUpdated).toHaveBeenCalled();
  });

  it('1件も読めなければエラーとして知らせる', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: { analyzeSakeLabel: { sakeName: null, brewery: null, fieldConfidence: {} } },
    });

    render(<SpecBackfill records={[record()]} onSpecsUpdated={vi.fn()} />);
    fireEvent.click(screen.getByTestId('spec-backfill-button'));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        '写真から詳細スペックを読み取れる記録がありませんでした',
      );
    });
  });

  it('読めなかった記録があれば、除いている件数を添える', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: { analyzeSakeLabel: { sakeName: null, brewery: null, fieldConfidence: {} } },
    });
    mockGraphql.mockResolvedValueOnce({
      data: {
        analyzeSakeLabel: {
          sakeName: '獺祭',
          brewery: '旭酒造株式会社',
          fieldConfidence: { brewery: 0.95 },
        },
      },
    });
    mockGraphql.mockResolvedValueOnce({ data: { updatePurchaseRecord: { id: 'p-2' } } });

    render(
      <SpecBackfill
        records={[record(), record({ id: 'p-2', imageKeys: ['sub-1/purchase/p-2/front.jpg'] })]}
        onSpecsUpdated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('spec-backfill-button'));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        '1件に書き込みました（1件は読み取れませんでした）',
      );
    });

    // 書き込めた記録は対象から外れないが（一覧の再取得を待つため）、
    // 読めなかった記録は控えられて件数に出る
    await waitFor(() => {
      expect(screen.getByTestId('spec-backfill-skipped')).toHaveTextContent('1件を除く');
    });
  });
});
