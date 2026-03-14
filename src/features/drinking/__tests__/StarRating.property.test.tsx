import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as fc from 'fast-check';
import { StarRating } from '../components/StarRating';

// Feature: sake-drinking-registration, Property 12: 星評価UIの表示状態
// **Validates: Requirements 6.2, 6.3**
describe('Property 12: 星評価UIの表示状態', () => {
  it('1〜5の評価値に対して、正しい数の星が塗りつぶされ、テキストが表示される', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (rating) => {
        const { unmount } = render(<StarRating value={rating} onChange={vi.fn()} />);

        // Check each star's fill state
        for (let i = 0; i < 5; i++) {
          const star = screen.getByTestId(`star-${i}`);
          const svgStar = star.querySelector('svg');
          if (i < rating) {
            // Filled star should have fill="currentColor"
            expect(svgStar?.getAttribute('fill')).not.toBe('none');
          } else {
            // Empty star should have fill="none"
            expect(svgStar?.getAttribute('fill')).toBe('none');
          }
        }

        // Check rating text
        expect(screen.getByTestId('rating-text').textContent).toBe(`${rating}/5`);

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
