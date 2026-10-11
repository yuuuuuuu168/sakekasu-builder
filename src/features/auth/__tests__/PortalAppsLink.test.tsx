import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { PortalAppsLink } from '../components/PortalAppsLink';

describe('PortalAppsLink', () => {
  it('4 アプリの入口の一覧へ、同じタブで移るリンクを出す', () => {
    render(<PortalAppsLink />);
    const link = screen.getByRole('link', { name: 'アプリ一覧' });
    expect(link).toHaveAttribute('href', 'https://sakekasu-builder.com/apps');
    expect(link).not.toHaveAttribute('target');
  });
});
