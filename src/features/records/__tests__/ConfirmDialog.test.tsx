import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmDialog } from '../components/ConfirmDialog';

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  sakeName: '獺祭 純米大吟醸',
  recordType: 'purchase' as const,
  isDeleting: false,
  onConfirm: vi.fn(),
};

function renderDialog(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  // Reset mocks for each render
  props.onOpenChange = overrides.onOpenChange ?? vi.fn();
  props.onConfirm = overrides.onConfirm ?? vi.fn();
  return { ...render(<ConfirmDialog {...props} />), props };
}

describe('ConfirmDialog', () => {
  // Validates: Requirement 2.1
  it('銘柄名と記録種別（購入）が確認メッセージに含まれる', async () => {
    renderDialog({ sakeName: '獺祭 純米大吟醸', recordType: 'purchase' });
    await waitFor(() => {
      expect(screen.getByText(/獺祭 純米大吟醸/)).toBeTruthy();
      expect(screen.getByText(/購入/)).toBeTruthy();
    });
  });

  // Validates: Requirement 2.1
  it('銘柄名と記録種別（飲酒）が確認メッセージに含まれる', async () => {
    renderDialog({ sakeName: '山崎 12年', recordType: 'drinking' });
    await waitFor(() => {
      expect(screen.getByText(/山崎 12年/)).toBeTruthy();
      expect(screen.getByText(/飲酒/)).toBeTruthy();
    });
  });

  // Validates: Requirement 2.2
  it('「削除する」と「キャンセル」ボタンが表示される', async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '削除する' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
    });
  });

  // Validates: Requirement 2.3
  it('キャンセルクリックで onOpenChange(false) が呼ばれ、onConfirm は呼ばれない', async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    renderDialog({ onOpenChange, onConfirm });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // Validates: Requirement 2.4
  it('Escape キーで onOpenChange(false) が呼ばれる', async () => {
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  // Validates: Requirement 4.3
  it('isDeleting=true 時に「削除する」ボタンが disabled でローディング表示される', async () => {
    renderDialog({ isDeleting: true });

    await waitFor(() => {
      const deleteButton = screen.getByRole('button', { name: /削除する/ });
      expect(deleteButton).toBeDisabled();
    });

    // Loader2 アイコン（SVG with animate-spin）が表示されていることを確認
    const deleteButton = screen.getByRole('button', { name: /削除する/ });
    const spinner = deleteButton.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });
});
