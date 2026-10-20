import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  integerAtLeast,
  noValidation,
  notFutureDate,
  required,
  sakeCategory,
  useFieldValidation,
} from '../formValidation';
import type { FieldValidator } from '../formValidation';

vi.mock('@/lib/dateUtils', () => ({ getTodayString: () => '2026-10-20' }));

afterEach(() => {
  vi.clearAllMocks();
});

describe('required', () => {
  const rule = required('必須です');

  it.each(['', '   ', '\n'])('空白だけなら文言を返す（%j）', (value) => {
    expect(rule(value)).toBe('必須です');
  });

  it('文字があれば通す', () => {
    expect(rule(' 獺祭 ')).toBeUndefined();
  });
});

describe('integerAtLeast', () => {
  const price = integerAtLeast(0, '0以上の整数');

  it.each(['0', '3300', 1200])('下限以上の整数は通す（%j）', (value) => {
    expect(price(value)).toBeUndefined();
  });

  it.each(['', '-1', '1.5', 'abc', 'Infinity'])('それ以外は文言を返す（%j）', (value) => {
    expect(price(value)).toBe('0以上の整数');
  });

  it('optional なら空は通し、空でない誤りは返す', () => {
    const optional = integerAtLeast(0, '0以上の整数', { optional: true });
    expect(optional('')).toBeUndefined();
    expect(optional('  ')).toBeUndefined();
    expect(optional('-1')).toBe('0以上の整数');
  });

  it('下限を変えられる', () => {
    const quantity = integerAtLeast(1, '1以上の整数');
    expect(quantity('0')).toBe('1以上の整数');
    expect(quantity('1')).toBeUndefined();
  });
});

describe('notFutureDate', () => {
  const rule = notFutureDate('日付は必須', '未来の日付は不可');

  it('空なら必須の文言を返す', () => {
    expect(rule('')).toBe('日付は必須');
  });

  it('今日と過去は通す', () => {
    expect(rule('2026-10-20')).toBeUndefined();
    expect(rule('2025-01-01')).toBeUndefined();
  });

  it('明日以降は未来の文言を返す', () => {
    expect(rule('2026-10-21')).toBe('未来の日付は不可');
  });
});

describe('sakeCategory', () => {
  it('既知のカテゴリは通し、それ以外は弾く', () => {
    expect(sakeCategory()('NIHONSHU')).toBeUndefined();
    expect(sakeCategory()('')).toBe('カテゴリは必須です');
    expect(sakeCategory()('nihonshu')).toBe('カテゴリは必須です');
  });
});

describe('useFieldValidation', () => {
  type Form = { name: string; count: string; memo: string };
  type Errors = { name?: string; count?: string };
  const validators: Record<keyof Form, FieldValidator> = {
    name: required('名前は必須'),
    count: integerAtLeast(1, '1以上'),
    memo: noValidation,
  };

  it('validateAll はすべての項目を見て、エラーを状態にも入れる', () => {
    const { result } = renderHook(() => useFieldValidation<Form, Errors>(validators));
    let errors: Errors = {};
    act(() => {
      errors = result.current.validateAll({ name: '', count: '0', memo: '' });
    });
    expect(errors).toEqual({ name: '名前は必須', count: '1以上' });
    expect(result.current.errors).toEqual(errors);
  });

  it('validateField は 1 項目だけを足し引きする', () => {
    const { result } = renderHook(() => useFieldValidation<Form, Errors>(validators));
    act(() => {
      result.current.validateAll({ name: '', count: '0', memo: '' });
    });
    act(() => {
      result.current.validateField('name', '獺祭');
    });
    expect(result.current.errors).toEqual({ count: '1以上' });
  });

  it('isValid はエラーが無いときだけ true を返し、clearErrors で消せる', () => {
    const { result } = renderHook(() => useFieldValidation<Form, Errors>(validators));
    let valid = true;
    act(() => {
      valid = result.current.isValid({ name: '', count: '2', memo: '' });
    });
    expect(valid).toBe(false);
    act(() => {
      valid = result.current.isValid({ name: '獺祭', count: '2', memo: '' });
    });
    expect(valid).toBe(true);
    act(() => {
      result.current.validateAll({ name: '', count: '0', memo: '' });
      result.current.clearErrors();
    });
    expect(result.current.errors).toEqual({});
  });
});
