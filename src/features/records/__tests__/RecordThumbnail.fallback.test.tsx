import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecordCard } from '../components/RecordCard';
import type { UnifiedRecord } from '../types';

/** useImageUrl をキーごとの挙動を制御できるモックに差し替える */
const urlByKey = new Map<string, string>();
const failingKeys = new Set<string>();
const requestedKeys: string[] = [];

vi.mock('@/features/image/hooks/useImageUrl', () => ({
  useImageUrl: (key: string | null | undefined) => {
    if (!key) return { imageUrl: null, isLoading: false, hasError: false };
    requestedKeys.push(key);
    if (failingKeys.has(key)) {
      return { imageUrl: null, isLoading: false, hasError: true };
    }
    return {
      imageUrl: urlByKey.get(key) ?? `https://example.com/${key}`,
      isLoading: false,
      hasError: false,
    };
  },
}));

const record: UnifiedRecord = {
  id: 'purchase-001',
  type: 'purchase',
  sakeName: '獺祭',
  price: 3000,
  date: '2026-08-01',
  category: 'NIHONSHU',
  storeName: '酒屋',
  imageKeys: ['user123/purchase/rec-001/label.jpg'],
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

const defaultProps = { onDelete: vi.fn(), isDeleting: false };

describe('一覧サムネイルのサムネ優先とフォールバック', () => {
  beforeEach(() => {
    urlByKey.clear();
    failingKeys.clear();
    requestedKeys.length = 0;
  });

  it('まずサムネイルキーの URL を要求する', () => {
    render(<RecordCard record={record} {...defaultProps} />);

    expect(requestedKeys[0]).toBe('user123/purchase/rec-001/thumb_label.jpg');
    const img = screen.getByRole('img', { name: /獺祭の画像/ });
    expect(img.getAttribute('src')).toContain('thumb_label.jpg');
  });

  it('画像に loading="lazy" が指定されている', () => {
    render(<RecordCard record={record} {...defaultProps} />);
    const img = screen.getByRole('img', { name: /獺祭の画像/ });
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('サムネイルの読み込みに失敗したら原画にフォールバックする', async () => {
    render(<RecordCard record={record} {...defaultProps} />);

    const img = screen.getByRole('img', { name: /獺祭の画像/ });
    fireEvent.error(img);

    await waitFor(() => {
      const current = screen.getByRole('img', { name: /獺祭の画像/ });
      expect(current.getAttribute('src')).toContain(
        'user123/purchase/rec-001/label.jpg',
      );
    });
    // 原画のキーが要求されていること（thumb_ が付かない）
    expect(requestedKeys).toContain('user123/purchase/rec-001/label.jpg');
  });

  it('原画も失敗したらプレースホルダーを表示する', async () => {
    render(<RecordCard record={record} {...defaultProps} />);

    fireEvent.error(screen.getByRole('img', { name: /獺祭の画像/ }));
    await waitFor(() => {
      expect(
        screen.getByRole('img', { name: /獺祭の画像/ }).getAttribute('src'),
      ).toContain('label.jpg');
    });
    fireEvent.error(screen.getByRole('img', { name: /獺祭の画像/ }));

    await waitFor(() => {
      expect(screen.getByTestId('image-placeholder')).toBeTruthy();
    });
  });

  it('サムネイルの URL 取得自体が失敗した場合も原画へフォールバックする', () => {
    failingKeys.add('user123/purchase/rec-001/thumb_label.jpg');

    render(<RecordCard record={record} {...defaultProps} />);

    // URL 取得がエラーでもプレースホルダーで終わらせず原画を試すこと
    expect(requestedKeys).toContain('user123/purchase/rec-001/label.jpg');
  });
});
