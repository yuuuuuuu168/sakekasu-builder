// ラベル読み取りの結果をフォームへ入れる規則（購入・飲酒で共通）。
// 自動実行は入力済みの値を上書きせず、手動の再読み取りは上書きする

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { OcrDetectedInfo, OcrDetectedOptions } from '../hooks/useOcrTrigger';
import type { UseImageUploadReturn } from '../hooks/useImageUpload';

const captured = vi.hoisted(() => ({
  onDetected: null as null | ((info: OcrDetectedInfo, options: OcrDetectedOptions) => void),
  resetOcr: vi.fn(),
}));

vi.mock('../hooks/useOcrTrigger', () => ({
  useOcrTrigger: (
    _imageUpload: unknown,
    _recordType: unknown,
    onDetected: (info: OcrDetectedInfo, options: OcrDetectedOptions) => void,
  ) => {
    captured.onDetected = onDetected;
    return {
      handleOcrTrigger: vi.fn(),
      isAnalyzing: false,
      ocrMessage: null,
      resetOcr: captured.resetOcr,
      hasAnalyzed: false,
    };
  },
}));

import { useRecordOcr } from '../hooks/useRecordOcr';

const info = (overrides: Partial<OcrDetectedInfo> = {}): OcrDetectedInfo =>
  ({
    sakeName: '獺祭',
    category: 'NIHONSHU',
    specs: {},
    lowConfidenceSpecFields: [],
    ...overrides,
  }) as OcrDetectedInfo;

function setup(sakeName = '') {
  const setSakeName = vi.fn();
  const setCategory = vi.fn();
  const applyOcrResult = vi.fn();
  const { result } = renderHook(() =>
    useRecordOcr({
      imageUpload: {} as UseImageUploadReturn,
      recordType: 'purchase',
      sakeName,
      setSakeName,
      setCategory,
      specs: { applyOcrResult },
    }),
  );
  return { result, setSakeName, setCategory, applyOcrResult };
}

describe('useRecordOcr', () => {
  beforeEach(() => {
    captured.onDetected = null;
    captured.resetOcr.mockReset();
  });

  it('自動実行では、空の銘柄名とカテゴリを埋め、スペックは上書きせずに入れる', () => {
    const { setSakeName, setCategory, applyOcrResult } = setup('');
    act(() => captured.onDetected!(info(), { isAuto: true }));
    expect(setSakeName).toHaveBeenCalledWith('獺祭');
    expect(setCategory).toHaveBeenCalledWith('NIHONSHU');
    expect(applyOcrResult).toHaveBeenCalledWith({}, [], { overwrite: false });
  });

  it('自動実行では、入力済みの銘柄名を上書きしない', () => {
    const { setSakeName } = setup('久保田');
    act(() => captured.onDetected!(info(), { isAuto: true }));
    expect(setSakeName).not.toHaveBeenCalled();
  });

  it('カテゴリを手で選んだ後の自動実行では、カテゴリを上書きしない', () => {
    const { result, setCategory } = setup('');
    act(() => result.current.selectCategory('WINE'));
    expect(setCategory).toHaveBeenLastCalledWith('WINE');
    setCategory.mockClear();

    act(() => captured.onDetected!(info(), { isAuto: true }));
    expect(setCategory).not.toHaveBeenCalled();
  });

  it('手動の再読み取りは、入力済みの値も上書きする', () => {
    const { result, setSakeName, setCategory, applyOcrResult } = setup('久保田');
    act(() => result.current.selectCategory('WINE'));
    act(() => captured.onDetected!(info(), { isAuto: false }));
    expect(setSakeName).toHaveBeenCalledWith('獺祭');
    expect(setCategory).toHaveBeenLastCalledWith('NIHONSHU');
    expect(applyOcrResult).toHaveBeenCalledWith({}, [], { overwrite: true });
  });

  it('登録後の resetAfterSubmit で、手で選んだ記録と解析済みの管理を戻す', () => {
    const { result, setCategory } = setup('');
    act(() => result.current.selectCategory('WINE'));
    act(() => result.current.resetAfterSubmit());
    expect(captured.resetOcr).toHaveBeenCalled();

    setCategory.mockClear();
    act(() => captured.onDetected!(info(), { isAuto: true }));
    expect(setCategory).toHaveBeenCalledWith('NIHONSHU');
  });

  it('カテゴリが読み取れなかったときは触らない', () => {
    const { setCategory } = setup('');
    act(() => captured.onDetected!(info({ category: null }), { isAuto: false }));
    expect(setCategory).not.toHaveBeenCalled();
  });
});
