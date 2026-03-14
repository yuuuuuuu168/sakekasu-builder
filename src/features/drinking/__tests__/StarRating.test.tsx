import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StarRating } from '../components/StarRating';

describe('StarRating', () => {
  // Requirements: 6.4 - 初期値は未選択状態
  it('初期状態（value=0）で全ての星が空の状態で表示される', () => {
    render(<StarRating value={0} onChange={vi.fn()} />);
    for (let i = 0; i < 5; i++) {
      const star = screen.getByTestId(`star-${i}`);
      const svgStar = star.querySelector('svg');
      expect(svgStar?.getAttribute('fill')).toBe('none');
    }
  });

  // Requirements: 6.1 - タップまたはクリックで評価値を設定
  it('クリックで評価値が設定される', () => {
    const onChange = vi.fn();
    render(<StarRating value={0} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('star-2')); // Click 3rd star (0-based index)
    expect(onChange).toHaveBeenCalledWith(3);
  });

  // Requirements: 6.2, 6.3 - 星の塗りつぶし状態と数値テキスト表示
  it('数値テキストが正しく表示される', () => {
    render(<StarRating value={4} onChange={vi.fn()} />);
    expect(screen.getByTestId('rating-text').textContent).toBe('4/5');
  });

  // Requirements: 6.3, 6.4 - 未選択時のテキスト表示
  it('value=0の場合、テキストに"0/5"が表示される', () => {
    render(<StarRating value={0} onChange={vi.fn()} />);
    expect(screen.getByTestId('rating-text').textContent).toBe('0/5');
  });
});
