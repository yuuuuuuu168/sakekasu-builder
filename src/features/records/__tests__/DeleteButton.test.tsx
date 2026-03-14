import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeleteButton } from '../components/DeleteButton';

describe('DeleteButton', () => {
  // Validates: Requirement 1.1
  it('ゴミ箱アイコンがレンダリングされる', () => {
    render(<DeleteButton onClick={() => {}} disabled={false} />);
    const button = screen.getByRole('button', { name: '削除' });
    const svg = button.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  // Validates: Requirement 1.2
  it('aria-label="削除" が設定されている', () => {
    render(<DeleteButton onClick={() => {}} disabled={false} />);
    expect(screen.getByRole('button', { name: '削除' })).toBeTruthy();
  });

  // Validates: Requirement 1.3
  it('disabled=true 時にボタンが無効状態である', () => {
    render(<DeleteButton onClick={() => {}} disabled={true} />);
    const button = screen.getByRole('button', { name: '削除' });
    expect(button).toBeDisabled();
  });

  it('クリック時に onClick が呼ばれる', () => {
    const handleClick = vi.fn();
    render(<DeleteButton onClick={handleClick} disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
