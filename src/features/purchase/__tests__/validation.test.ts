import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFormValidation } from '@/features/purchase/hooks/useFormValidation';
import type { PurchaseFormData } from '@/features/purchase/types';

function validFormData(): PurchaseFormData {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return {
    sakeName: '獺祭',
    storeName: '酒のやまや',
    price: '3000',
    purchaseDate: `${yyyy}-${mm}-${dd}`,
    category: 'NIHONSHU',
    memo: '',
  };
}

describe('useFormValidation', () => {
  describe('validateField', () => {
    it('銘柄名が空の場合エラーを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('sakeName', '');
      });
      expect(error).toBe('銘柄名は必須です');
      expect(result.current.errors.sakeName).toBe('銘柄名は必須です');
    });

    it('銘柄名が空白のみの場合エラーを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('sakeName', '   ');
      });
      expect(error).toBe('銘柄名は必須です');
    });

    it('銘柄名が有効な場合undefinedを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('sakeName', '獺祭');
      });
      expect(error).toBeUndefined();
      expect(result.current.errors.sakeName).toBeUndefined();
    });

    it('店舗名が空の場合エラーを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('storeName', '');
      });
      expect(error).toBe('購入店舗名は必須です');
    });

    it('価格が空の場合エラーを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('price', '');
      });
      expect(error).toBe('価格は0以上の数値で入力してください');
    });

    it('価格が非数値の場合エラーを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('price', 'abc');
      });
      expect(error).toBe('価格は0以上の数値で入力してください');
    });

    it('価格が負の値の場合エラーを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('price', '-100');
      });
      expect(error).toBe('価格は0以上の数値で入力してください');
    });

    it('価格が小数の場合エラーを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('price', '10.5');
      });
      expect(error).toBe('価格は0以上の数値で入力してください');
    });

    it('価格が0の場合は有効', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('price', '0');
      });
      expect(error).toBeUndefined();
    });

    it('価格が正の整数の場合は有効', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('price', '5000');
      });
      expect(error).toBeUndefined();
    });

    it('購入日が空の場合エラーを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('purchaseDate', '');
      });
      expect(error).toBe('購入日は必須です');
    });

    it('購入日が未来の場合エラーを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('purchaseDate', '2099-12-31');
      });
      expect(error).toBe('購入日は本日以前の日付を入力してください');
    });

    it('購入日が本日の場合は有効', () => {
      const { result } = renderHook(() => useFormValidation());
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('purchaseDate', `${yyyy}-${mm}-${dd}`);
      });
      expect(error).toBeUndefined();
    });

    it('カテゴリが空の場合エラーを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('category', '');
      });
      expect(error).toBe('カテゴリは必須です');
    });

    it('カテゴリが無効な値の場合エラーを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('category', 'INVALID');
      });
      expect(error).toBe('カテゴリは必須です');
    });

    it('カテゴリが有効な値の場合undefinedを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('category', 'BEER');
      });
      expect(error).toBeUndefined();
    });

    it('メモは常に有効', () => {
      const { result } = renderHook(() => useFormValidation());
      let error: string | undefined;
      act(() => {
        error = result.current.validateField('memo', '');
      });
      expect(error).toBeUndefined();
    });
  });

  describe('validateAll', () => {
    it('全フィールドが有効な場合、空のエラーオブジェクトを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let errors: Record<string, string | undefined> = {};
      act(() => {
        errors = result.current.validateAll(validFormData());
      });
      expect(Object.keys(errors).length).toBe(0);
    });

    it('複数フィールドが無効な場合、全てのエラーを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let errors: Record<string, string | undefined> = {};
      act(() => {
        errors = result.current.validateAll({
          sakeName: '',
          storeName: '',
          price: '',
          purchaseDate: '',
          category: '' as PurchaseFormData['category'],
          memo: '',
        });
      });
      expect(errors.sakeName).toBeDefined();
      expect(errors.storeName).toBeDefined();
      expect(errors.price).toBeDefined();
      expect(errors.purchaseDate).toBeDefined();
      expect(errors.category).toBeDefined();
    });
  });

  describe('isValid', () => {
    it('全フィールドが有効な場合trueを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      let valid = false;
      act(() => {
        valid = result.current.isValid(validFormData());
      });
      expect(valid).toBe(true);
    });

    it('無効なフィールドがある場合falseを返す', () => {
      const { result } = renderHook(() => useFormValidation());
      const data = validFormData();
      data.sakeName = '';
      let valid = true;
      act(() => {
        valid = result.current.isValid(data);
      });
      expect(valid).toBe(false);
    });
  });

  describe('clearErrors', () => {
    it('エラーをクリアする', () => {
      const { result } = renderHook(() => useFormValidation());
      act(() => {
        result.current.validateField('sakeName', '');
      });
      expect(result.current.errors.sakeName).toBeDefined();
      act(() => {
        result.current.clearErrors();
      });
      expect(Object.keys(result.current.errors).length).toBe(0);
    });
  });
});
