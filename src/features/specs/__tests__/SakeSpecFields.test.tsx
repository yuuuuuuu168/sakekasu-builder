// Feature: 詳細スペック項目の記録対応（Issue #87）: 折りたたみ入力欄

import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SakeSpecFields } from '../components/SakeSpecFields';
import { createEmptySpecFormData } from '../lib/sakeSpecs';
import type { SakeSpecFormData, SpecValidationErrors } from '../types';

function renderFields(
  overrides: {
    specs?: Partial<SakeSpecFormData>;
    errors?: SpecValidationErrors;
    category?: 'NIHONSHU' | 'WHISKY';
    lowConfidenceFields?: ('brewery' | 'region')[];
  } = {},
) {
  const onChange = vi.fn();
  const onBlur = vi.fn();
  render(
    <SakeSpecFields
      specs={{ ...createEmptySpecFormData(), ...overrides.specs }}
      errors={overrides.errors ?? {}}
      category={overrides.category ?? 'NIHONSHU'}
      onChange={onChange}
      onBlur={onBlur}
      lowConfidenceFields={overrides.lowConfidenceFields}
    />,
  );
  return { onChange, onBlur };
}

describe('SakeSpecFields', () => {
  it('入力が無ければ折りたたまれている（銘柄名だけ書く人の邪魔をしない）', () => {
    renderFields();

    expect(screen.getByTestId('spec-accordion-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('input-spec-brewery')).not.toBeInTheDocument();
  });

  it('トグルを押すと入力欄が出る', () => {
    renderFields();

    fireEvent.click(screen.getByTestId('spec-accordion-toggle'));

    expect(screen.getByTestId('input-spec-brewery')).toBeInTheDocument();
  });

  it('入力済みの項目があれば開いた状態で出す（編集・OCR 反映後）', () => {
    renderFields({ specs: { brewery: '旭酒造株式会社' } });

    expect(screen.getByTestId('spec-accordion-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('spec-filled-count')).toHaveTextContent('1件入力済み');
  });

  it('入力エラーがあれば開いた状態で出す（直す場所が見えるように）', () => {
    renderFields({ errors: { acidity: '酸度は0.1〜20の範囲で入力してください' } });

    expect(screen.getByTestId('spec-accordion-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('error-spec-acidity')).toBeInTheDocument();
  });

  it('日本酒以外では日本酒向けの項目を出さない', () => {
    renderFields({ category: 'WHISKY', specs: { brewery: '蒸留所' } });

    expect(screen.getByTestId('input-spec-brewery')).toBeInTheDocument();
    expect(screen.queryByTestId('input-spec-ricePolishingRatio')).not.toBeInTheDocument();
  });

  it('確信度の低い項目には「要確認」が付く', () => {
    renderFields({ specs: { region: '山口県' }, lowConfidenceFields: ['region'] });

    expect(screen.getByTestId('spec-low-confidence-region')).toHaveTextContent('要確認');
    expect(screen.queryByTestId('spec-low-confidence-brewery')).not.toBeInTheDocument();
  });

  it('入力と blur が親に伝わる', () => {
    const { onChange, onBlur } = renderFields({ specs: { brewery: '旭酒造株式会社' } });

    const input = screen.getByTestId('input-spec-riceVariety');
    fireEvent.change(input, { target: { value: '山田錦' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith('riceVariety', '山田錦');
    expect(onBlur).toHaveBeenCalledWith('riceVariety');
  });
});
