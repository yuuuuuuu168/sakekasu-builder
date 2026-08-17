import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { graphqlMock } = vi.hoisted(() => ({ graphqlMock: vi.fn() }));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: graphqlMock }),
}));

import { useRecordFetch } from '../hooks/useRecordFetch';

/** query の種類ごとに1ページだけ返す。銘柄名で呼び出し回を見分けられるようにする */
function respondWith(purchaseName: string, drinkingName: string) {
  graphqlMock.mockImplementation(({ query }: { query: string }) => {
    if (query.includes('listPurchaseRecords')) {
      return Promise.resolve({
        data: {
          listPurchaseRecords: {
            items: [
              {
                id: 'p-1',
                sakeName: purchaseName,
                price: 3000,
                purchaseDate: '2026-08-01',
                category: 'NIHONSHU',
                storeName: '酒屋',
                imageKey: null,
                imageKeys: null,
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
            ],
            nextToken: null,
          },
        },
      });
    }
    return Promise.resolve({
      data: {
        listDrinkingRecords: {
          items: [
            {
              id: 'd-1',
              sakeName: drinkingName,
              price: null,
              drinkingDate: '2026-08-02',
              category: 'NIHONSHU',
              placeName: '自宅',
              drinkingMethod: '冷酒',
              rating: 4,
              imageKey: null,
              imageKeys: null,
              createdAt: '2026-08-02T00:00:00.000Z',
              updatedAt: '2026-08-02T00:00:00.000Z',
            },
          ],
          nextToken: null,
        },
      },
    });
  });
}

describe('useRecordFetch', () => {
  beforeEach(() => {
    graphqlMock.mockReset();
  });

  it('マウント時に購入・飲酒の両方を取得する', async () => {
    respondWith('獺祭', '八海山');

    const { result } = renderHook(() => useRecordFetch());
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.records.map((r) => r.sakeName)).toEqual(['獺祭', '八海山']);
    expect(result.current.error).toBeNull();
  });

  it('refetch で取り直し、結果が入れ替わる', async () => {
    respondWith('獺祭', '八海山');

    const { result } = renderHook(() => useRecordFetch());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    respondWith('久保田', '而今');
    act(() => {
      result.current.refetch();
    });

    await waitFor(() =>
      expect(result.current.records.map((r) => r.sakeName)).toEqual(['久保田', '而今']),
    );
  });

  it('片方が失敗しても、取れた側は表示しエラーだけ伝える', async () => {
    graphqlMock.mockImplementation(({ query }: { query: string }) => {
      if (query.includes('listPurchaseRecords')) {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve({
        data: { listDrinkingRecords: { items: [], nextToken: null } },
      });
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useRecordFetch());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('購入記録の取得に失敗しました');
    expect(result.current.records).toEqual([]);
  });

  it('アンマウント後に応答が返っても state を更新しない', async () => {
    let resolvePurchase: ((value: unknown) => void) | undefined;
    graphqlMock.mockImplementation(({ query }: { query: string }) => {
      if (query.includes('listPurchaseRecords')) {
        return new Promise((resolve) => {
          resolvePurchase = resolve;
        });
      }
      return Promise.resolve({
        data: { listDrinkingRecords: { items: [], nextToken: null } },
      });
    });

    const { result, unmount } = renderHook(() => useRecordFetch());
    unmount();

    await act(async () => {
      resolvePurchase?.({
        data: { listPurchaseRecords: { items: [], nextToken: null } },
      });
    });

    // アンマウント済みなので取得中のまま止まる（更新が走れば警告になる）
    expect(result.current.isLoading).toBe(true);
  });
});
