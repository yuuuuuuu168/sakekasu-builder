// Feature: ocr-tool-use-confidence（Issue #60）: 低確信の項目を「要確認」表示にする

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { OcrResult } from '@/features/image/hooks/useOcrAnalysis';
import type { UseImageUploadReturn } from '@/features/image/hooks/useImageUpload';

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

function buildResult(overrides: Partial<OcrResult>): OcrResult {
  return {
    sakeName: '獺祭',
    category: 'NIHONSHU',
    region: '山口県',
    alcoholPercentage: 16,
    confidence: 0.95,
    fieldConfidence: {
      sakeName: 0.95,
      category: 0.9,
      region: 0.8,
      alcoholPercentage: 0.85,
    },
    ...overrides,
  };
}

function renderOcrMessage() {
  const { result } = renderHook(() =>
    useOcrTrigger(imageUploadStub, 'purchase', vi.fn()),
  );
  return result.current.ocrMessage;
}

describe('useOcrTrigger: 確信度による「要確認」表示', () => {
  beforeEach(() => {
    mockOcrResult = null;
  });

  it('全項目の確信度が高い場合は「要確認」が付かない', () => {
    mockOcrResult = buildResult({});

    const message = renderOcrMessage();

    expect(message?.text).toBe('銘柄名を読み取りました: 獺祭（日本酒 / 山口県 / 16%）');
    expect(message?.text).not.toContain('要確認');
  });

  it('確信度 0.7 未満の項目に「（要確認）」が付く', () => {
    mockOcrResult = buildResult({
      fieldConfidence: {
        sakeName: 0.95,
        category: 0.9,
        region: 0.5,
        alcoholPercentage: 0.3,
      },
    });

    const message = renderOcrMessage();

    expect(message?.text).toBe(
      '銘柄名を読み取りました: 獺祭（日本酒 / 山口県（要確認） / 16%（要確認））',
    );
  });

  it('銘柄名の確信度が低い場合は銘柄名にも「（要確認）」が付く', () => {
    mockOcrResult = buildResult({
      fieldConfidence: {
        sakeName: 0.4,
        category: 0.9,
        region: 0.8,
        alcoholPercentage: 0.85,
      },
    });

    const message = renderOcrMessage();

    expect(message?.text).toContain('獺祭（要確認）');
  });

  it('fieldConfidence がない旧形式レスポンスでは「要確認」を付けない', () => {
    mockOcrResult = buildResult({
      fieldConfidence: undefined as unknown as OcrResult['fieldConfidence'],
    });

    const message = renderOcrMessage();

    expect(message?.text).toBe('銘柄名を読み取りました: 獺祭（日本酒 / 山口県 / 16%）');
  });

  it('確信度がちょうど 0.7 の場合は「要確認」を付けない（境界値）', () => {
    mockOcrResult = buildResult({
      fieldConfidence: {
        sakeName: 0.7,
        category: 0.7,
        region: 0.7,
        alcoholPercentage: 0.7,
      },
    });

    const message = renderOcrMessage();

    expect(message?.text).not.toContain('要確認');
  });
});
