/**
 * 記録カードの詳細スペック表示のテスト（Issue #87）。
 *
 * 一覧を占領しないよう、既定では件数だけを出してクリックで開く。
 * 値を持たない記録では何も出さない。
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecordSpecs } from '../components/RecordSpecs';
import { pickSakeSpecs } from '@/features/specs/lib/sakeSpecs';

describe('RecordSpecs', () => {
  it('詳細スペックを持たない記録では何も出さない', () => {
    const { container } = render(<RecordSpecs specs={pickSakeSpecs({})} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('項目自体が無かった頃の記録（undefined）でも何も出さない', () => {
    const { container } = render(<RecordSpecs specs={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('値のある項目の件数を出し、クリックで中身が開く', () => {
    render(
      <RecordSpecs
        specs={pickSakeSpecs({ brewery: '旭酒造株式会社', ricePolishingRatio: 23 })}
      />,
    );

    const toggle = screen.getByTestId('record-specs-toggle');
    expect(toggle).toHaveTextContent('詳細スペック 2件');
    expect(screen.queryByTestId('record-specs-list')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(screen.getByTestId('record-spec-brewery')).toHaveTextContent('旭酒造株式会社');
    expect(screen.getByTestId('record-spec-ricePolishingRatio')).toHaveTextContent('23%');
  });

  it('紹介文は他の項目とは分けて出す', () => {
    render(
      <RecordSpecs specs={pickSakeSpecs({ labelDescription: '洗練された香りと透明感のある味わい。' })} />,
    );

    fireEvent.click(screen.getByTestId('record-specs-toggle'));

    expect(screen.getByTestId('record-spec-labelDescription')).toHaveTextContent(
      '洗練された香りと透明感のある味わい。',
    );
  });
});
