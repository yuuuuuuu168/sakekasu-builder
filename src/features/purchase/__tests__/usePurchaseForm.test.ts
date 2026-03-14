import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePurchaseForm, getInitialFormData } from '@/features/purchase/hooks/usePurchaseForm';

// Mock useFormValidation
const mockValidateField = vi.fn();
const mockIsValid = vi.fn();
const mockClearErrors = vi.fn();
const mockErrors = {};

vi.mock('@/features/purchase/hooks/useFormValidation', () => ({
  useFormValidation: () => ({
    errors: mockErrors,
    validateField: mockValidateField,
    validateAll: vi.fn(),
    isValid: mockIsValid,
    clearErrors: mockClearErrors,
  }),
}));

// Mock usePurchaseStorage
const mockSavePurchase = vi.fn();
let mockIsSaving = false;

vi.mock('@/features/purchase/hooks/usePurchaseStorage', () => ({
  usePurchaseStorage: () => ({
    savePurchase: mockSavePurchase,
    isSaving: mockIsSaving,
  }),
}));

function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

describe('getInitialFormData', () => {
  it('デフォルトのフォームデータを返す', () => {
    const data = getInitialFormData();
    expect(data.sakeName).toBe('');
    expect(data.storeName).toBe('');
    expect(data.price).toBe('');
    expect(data.purchaseDate).toBe(getTodayString());
    expect(data.category).toBe('NIHONSHU');
    expect(data.memo).toBe('');
  });
});

describe('usePurchaseForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSaving = false;
  });

  it('初期状態が正しい', () => {
    const { result } = renderHook(() => usePurchaseForm());
    expect(result.current.formData.sakeName).toBe('');
    expect(result.current.formData.storeName).toBe('');
    expect(result.current.formData.price).toBe('');
    expect(result.current.formData.purchaseDate).toBe(getTodayString());
    expect(result.current.formData.category).toBe('NIHONSHU');
    expect(result.current.formData.memo).toBe('');
    expect(result.current.submitResult).toBeNull();
  });

  it('handleChangeでフォームデータを更新する', () => {
    const { result } = renderHook(() => usePurchaseForm());
    act(() => {
      result.current.handleChange('sakeName', '獺祭');
    });
    expect(result.current.formData.sakeName).toBe('獺祭');
  });

  it('handleBlurでvalidateFieldを呼び出す', () => {
    const { result } = renderHook(() => usePurchaseForm());
    act(() => {
      result.current.handleChange('sakeName', '獺祭');
    });
    act(() => {
      result.current.handleBlur('sakeName');
    });
    expect(mockValidateField).toHaveBeenCalledWith('sakeName', '獺祭');
  });

  it('handleSubmit: バリデーション失敗時は保存しない', async () => {
    mockIsValid.mockReturnValue(false);
    const { result } = renderHook(() => usePurchaseForm());
    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(mockIsValid).toHaveBeenCalled();
    expect(mockSavePurchase).not.toHaveBeenCalled();
  });

  it('handleSubmit: 保存成功時にフォームをリセットする', async () => {
    mockIsValid.mockReturnValue(true);
    mockSavePurchase.mockResolvedValue({ success: true });
    const { result } = renderHook(() => usePurchaseForm());

    act(() => {
      result.current.handleChange('sakeName', '獺祭');
      result.current.handleChange('storeName', '酒のやまや');
      result.current.handleChange('price', '3000');
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.formData.sakeName).toBe('');
    expect(result.current.formData.storeName).toBe('');
    expect(result.current.formData.price).toBe('');
    expect(result.current.formData.purchaseDate).toBe(getTodayString());
    expect(result.current.formData.category).toBe('NIHONSHU');
    expect(result.current.formData.memo).toBe('');
    expect(mockClearErrors).toHaveBeenCalled();
    expect(result.current.submitResult).toEqual({ success: true });
  });

  it('handleSubmit: 保存失敗時に入力を保持する', async () => {
    mockIsValid.mockReturnValue(true);
    const errorResult = { success: false, error: '登録に失敗しました。もう一度お試しください' };
    mockSavePurchase.mockResolvedValue(errorResult);
    const { result } = renderHook(() => usePurchaseForm());

    act(() => {
      result.current.handleChange('sakeName', '獺祭');
      result.current.handleChange('storeName', '酒のやまや');
      result.current.handleChange('price', '3000');
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.formData.sakeName).toBe('獺祭');
    expect(result.current.formData.storeName).toBe('酒のやまや');
    expect(result.current.formData.price).toBe('3000');
    expect(mockClearErrors).not.toHaveBeenCalled();
    expect(result.current.submitResult).toEqual(errorResult);
  });
});
