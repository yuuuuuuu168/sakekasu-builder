import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import * as fc from 'fast-check';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { deletePurchaseRecord, deleteDrinkingRecord } from '@/graphql/mutations';
import type { UnifiedRecord, RecordType } from '../types';
import type { SakeCategory } from '../../purchase/types';

// --- Arbitrary generators ---

const arbSakeName = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

const arbRecordType = fc.constantFrom('purchase' as const, 'drinking' as const);

const recordTypeLabel: Record<'purchase' | 'drinking', string> = {
  purchase: '購入',
  drinking: '飲酒',
};

// --- Property Tests ---

/**
 * **Validates: Requirements 2.1**
 */
describe('Feature: record-deletion, Property 1: 確認ダイアログに銘柄名と記録種別が含まれる', () => {
  it('任意の空でない銘柄名と記録種別に対して、表示テキストにその銘柄名と種別ラベルが含まれる', async () => {
    // Property test with DOM rendering needs a longer timeout when running with the full suite
    await fc.assert(
      fc.asyncProperty(arbSakeName, arbRecordType, async (sakeName, recordType) => {
        cleanup();

        render(
          <ConfirmDialog
            open={true}
            onOpenChange={vi.fn()}
            sakeName={sakeName}
            recordType={recordType}
            isDeleting={false}
            onConfirm={vi.fn()}
          />
        );

        await waitFor(() => {
          const dialog = screen.getByRole('dialog');
          const textContent = dialog.textContent ?? '';
          expect(textContent).toContain(sakeName);
          expect(textContent).toContain(recordTypeLabel[recordType]);
        });

        cleanup();
      }),
      { numRuns: 100 }
    );
  }, 30000);
});


// --- Arbitrary generators for UnifiedRecord ---

const arbCategory: fc.Arbitrary<SakeCategory> = fc.constantFrom(
  'NIHONSHU' as const,
  'BEER' as const,
  'WINE' as const,
  'WHISKY' as const,
  'SHOCHU' as const,
  'OTHER' as const,
);

const arbISODate = fc
  .integer({ min: 0, max: 3650 })
  .map((days) => {
    const d = new Date(2020, 0, 1 + days);
    return d.toISOString().slice(0, 10);
  });

const arbISODateTime = fc
  .integer({ min: 0, max: 3650 })
  .map((days) => {
    const d = new Date(2020, 0, 1 + days);
    return d.toISOString();
  });

const arbUnifiedRecord: fc.Arbitrary<UnifiedRecord> = fc.record({
  id: fc.uuid(),
  type: arbRecordType,
  sakeName: arbSakeName,
  price: fc.oneof(fc.integer({ min: 0, max: 100000 }), fc.constant(null)),
  date: arbISODate,
  category: arbCategory,
  memo: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
  storeName: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  placeName: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  drinkingMethod: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  rating: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
  createdAt: arbISODateTime,
  updatedAt: arbISODateTime,
});

// --- Property 2 ---

// Mock for capturing graphql calls
const mockGraphql = vi.fn().mockResolvedValue({ data: {} });

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({
    graphql: (...args: unknown[]) => mockGraphql(...args),
  }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

/**
 * **Validates: Requirements 3.1**
 */
describe('Feature: record-deletion, Property 2: 記録種別に応じた適切なミューテーション選択', () => {
  beforeEach(() => {
    mockGraphql.mockClear();
    mockGraphql.mockResolvedValue({ data: {} });
  });

  it('任意の UnifiedRecord に対して、type が purchase なら deletePurchaseRecord、drinking なら deleteDrinkingRecord が呼ばれる', async () => {
    // Dynamic import to pick up the mocked module
    const { useDeleteRecord } = await import('../hooks/useDeleteRecord');

    await fc.assert(
      fc.asyncProperty(arbUnifiedRecord, async (record) => {
        mockGraphql.mockClear();
        mockGraphql.mockResolvedValue({ data: {} });

        const onOptimisticRemove = vi.fn();
        const onRollback = vi.fn();
        const onSuccess = vi.fn();

        const records = [record];

        const { result } = renderHook(() =>
          useDeleteRecord(records, onOptimisticRemove, onRollback, onSuccess),
        );

        await act(async () => {
          await result.current.deleteRecord(record.id, record.type);
        });

        expect(mockGraphql).toHaveBeenCalledTimes(1);

        const expectedMutation =
          record.type === 'purchase' ? deletePurchaseRecord : deleteDrinkingRecord;

        expect(mockGraphql).toHaveBeenCalledWith({
          query: expectedMutation,
          variables: { id: record.id },
        });
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 3 ---

/**
 * **Validates: Requirements 3.2**
 */
describe('Feature: record-deletion, Property 3: 削除成功時の一覧からの除去', () => {
  beforeEach(() => {
    mockGraphql.mockClear();
    mockGraphql.mockResolvedValue({ data: {} });
  });

  it('任意の記録リストから1件削除成功後、その id が一覧に含まれず長さが1減る', async () => {
    const { useDeleteRecord } = await import('../hooks/useDeleteRecord');

    const arbRecordListAndIndex = fc
      .array(arbUnifiedRecord, { minLength: 1, maxLength: 20 })
      .chain((records) => {
        // Ensure unique IDs
        const uniqueRecords = records.reduce<UnifiedRecord[]>((acc, r) => {
          if (!acc.some((existing) => existing.id === r.id)) {
            acc.push(r);
          }
          return acc;
        }, []);
        if (uniqueRecords.length === 0) return fc.constant(null);
        return fc.integer({ min: 0, max: uniqueRecords.length - 1 }).map((idx) => ({
          records: uniqueRecords,
          targetIndex: idx,
        }));
      })
      .filter((v): v is { records: UnifiedRecord[]; targetIndex: number } => v !== null);

    await fc.assert(
      fc.asyncProperty(arbRecordListAndIndex, async ({ records, targetIndex }) => {
        mockGraphql.mockClear();
        mockGraphql.mockResolvedValue({ data: {} });

        const originalLength = records.length;
        const targetRecord = records[targetIndex];
        let localList = [...records];

        const onOptimisticRemove = (id: string) => {
          localList = localList.filter((r) => r.id !== id);
        };
        const onRollback = vi.fn();
        const onSuccess = vi.fn();

        const { result } = renderHook(() =>
          useDeleteRecord(records, onOptimisticRemove, onRollback, onSuccess),
        );

        await act(async () => {
          await result.current.deleteRecord(targetRecord.id, targetRecord.type);
        });

        // The deleted record's id should not be in the list
        expect(localList.some((r) => r.id === targetRecord.id)).toBe(false);
        // The list length should be 1 less
        expect(localList.length).toBe(originalLength - 1);
        // onRollback should NOT have been called (success case)
        expect(onRollback).not.toHaveBeenCalled();
        // onSuccess should have been called
        expect(onSuccess).toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 4 ---

/**
 * **Validates: Requirements 4.2**
 */
describe('Feature: record-deletion, Property 4: 削除失敗時の記録復元', () => {
  beforeEach(() => {
    mockGraphql.mockClear();
  });

  it('任意の記録リストから1件の削除が失敗した場合、ロールバック後の一覧が元と同一である', async () => {
    const { useDeleteRecord } = await import('../hooks/useDeleteRecord');

    const arbRecordListAndIndex = fc
      .array(arbUnifiedRecord, { minLength: 1, maxLength: 20 })
      .chain((records) => {
        const uniqueRecords = records.reduce<UnifiedRecord[]>((acc, r) => {
          if (!acc.some((existing) => existing.id === r.id)) {
            acc.push(r);
          }
          return acc;
        }, []);
        if (uniqueRecords.length === 0) return fc.constant(null);
        return fc.integer({ min: 0, max: uniqueRecords.length - 1 }).map((idx) => ({
          records: uniqueRecords,
          targetIndex: idx,
        }));
      })
      .filter((v): v is { records: UnifiedRecord[]; targetIndex: number } => v !== null);

    await fc.assert(
      fc.asyncProperty(arbRecordListAndIndex, async ({ records, targetIndex }) => {
        mockGraphql.mockClear();
        mockGraphql.mockRejectedValue(new Error('Network error'));

        const originalList = [...records];
        const targetRecord = records[targetIndex];
        let localList = [...records];

        const onOptimisticRemove = (id: string) => {
          localList = localList.filter((r) => r.id !== id);
        };
        const onRollback = (record: UnifiedRecord) => {
          localList.push(record);
        };
        const onSuccess = vi.fn();

        const { result } = renderHook(() =>
          useDeleteRecord(records, onOptimisticRemove, onRollback, onSuccess),
        );

        await act(async () => {
          await result.current.deleteRecord(targetRecord.id, targetRecord.type);
        });

        // After rollback, the list should have the same length as the original
        expect(localList.length).toBe(originalList.length);
        // After rollback, the list should contain all original record ids
        const originalIds = originalList.map((r) => r.id).sort();
        const currentIds = localList.map((r) => r.id).sort();
        expect(currentIds).toEqual(originalIds);
        // onSuccess should NOT have been called (failure case)
        expect(onSuccess).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});

