// Feature: ocr-tool-use-confidence（Issue #60）: 低確信の項目を「要確認」表示にする
// Feature: 詳細スペックの自動抽出（Issue #88）: スペック項目の「要確認」は入力欄側に出す

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { OcrResult, OcrFieldConfidence } from '@/features/image/hooks/useOcrAnalysis';
import type { UseImageUploadReturn } from '@/features/image/hooks/useImageUpload';
import { SPEC_FIELD_NAMES } from '@/features/specs/types';

// useOcrAnalysis をモック（テストごとに ocrResult を差し替える）
let mockOcrResult: OcrResult | null = null;
vi.mock('@/features/image/hooks/useOcrAnalysis', () => ({
  useOcrAnalysis: () => ({
    analyzeImage: vi.fn(),
    isAnalyzing: false,
    ocrResult: mockOcrResult,
    ocrError: null,
    resetOcr: vi.fn(),
  }),
}));

import { useOcrTrigger } from '@/features/image/hooks/useOcrTrigger';

const imageUploadStub = {
  imageFiles: [],
  isCompressing: false,
  isUploading: false,
  preUploadImages: vi.fn(async () => []),
} as unknown as UseImageUploadReturn;

/** 全項目 0 のスペック確信度（テストで上書きしたものだけ効くようにする） */
function specConfidence(overrides: Partial<OcrFieldConfidence> = {}): OcrFieldConfidence {
  return {
    sakeName: 0.95,
    category: 0.9,
    ...(Object.fromEntries(SPEC_FIELD_NAMES.map((field) => [field, 0])) as Omit<
      OcrFieldConfidence,
      'sakeName' | 'category'
    >),
    region: 0.8,
    alcoholPercentage: 0.85,
    ...overrides,
  };
}

/** 詳細スペックの項目をすべて null にしたもの（テストごとに必要な項目だけ入れる） */
const EMPTY_SPECS = Object.fromEntries(
  SPEC_FIELD_NAMES.map((field) => [field, null]),
) as Pick<OcrResult, (typeof SPEC_FIELD_NAMES)[number]>;

function buildResult(overrides: Partial<OcrResult>): OcrResult {
  return {
    ...EMPTY_SPECS,
    sakeName: '獺祭',
    category: 'NIHONSHU',
    region: '山口県',
    alcoholPercentage: 16,
    confidence: 0.95,
    fieldConfidence: specConfidence(),
    ...overrides,
  };
}

function renderOcrMessage() {
  const { result } = renderHook(() => useOcrTrigger(imageUploadStub, 'purchase', vi.fn()));
  return result.current.ocrMessage;
}

describe('useOcrTrigger: 確信度による「要確認」表示', () => {
  beforeEach(() => {
    mockOcrResult = null;
  });

  it('銘柄名・カテゴリの確信度が高い場合は「要確認」が付かない', () => {
    mockOcrResult = buildResult({});

    const message = renderOcrMessage();

    expect(message?.text).toBe('銘柄名を読み取りました: 獺祭（日本酒 / 詳細スペック2件）');
    expect(message?.text).not.toContain('要確認');
  });

  it('カテゴリの確信度が低い場合は「（要確認）」が付く', () => {
    mockOcrResult = buildResult({ fieldConfidence: specConfidence({ category: 0.5 }) });

    const message = renderOcrMessage();

    expect(message?.text).toBe(
      '銘柄名を読み取りました: 獺祭（日本酒（要確認） / 詳細スペック2件）',
    );
  });

  it('銘柄名の確信度が低い場合は銘柄名にも「（要確認）」が付く', () => {
    mockOcrResult = buildResult({ fieldConfidence: specConfidence({ sakeName: 0.4 }) });

    const message = renderOcrMessage();

    expect(message?.text).toContain('獺祭（要確認）');
  });

  it('fieldConfidence がない旧形式レスポンスでは「要確認」を付けない', () => {
    mockOcrResult = buildResult({
      fieldConfidence: undefined as unknown as OcrResult['fieldConfidence'],
    });

    const message = renderOcrMessage();

    expect(message?.text).toBe('銘柄名を読み取りました: 獺祭（日本酒 / 詳細スペック2件）');
  });

  it('確信度がちょうど 0.7 の場合は「要確認」を付けない（境界値）', () => {
    mockOcrResult = buildResult({
      fieldConfidence: specConfidence({ sakeName: 0.7, category: 0.7 }),
    });

    const message = renderOcrMessage();

    expect(message?.text).not.toContain('要確認');
  });

  it('読み取れた詳細スペックの件数がメッセージに出る', () => {
    mockOcrResult = buildResult({
      brewery: '旭酒造株式会社',
      ricePolishingRatio: 23,
      fieldConfidence: specConfidence({ brewery: 0.9, ricePolishingRatio: 0.9 }),
    });

    const message = renderOcrMessage();

    expect(message?.text).toContain('詳細スペック4件');
  });

  it('詳細スペックが1つも読み取れなければ件数は出さない', () => {
    mockOcrResult = buildResult({ region: null, alcoholPercentage: null });

    const message = renderOcrMessage();

    expect(message?.text).toBe('銘柄名を読み取りました: 獺祭（日本酒）');
  });
});
