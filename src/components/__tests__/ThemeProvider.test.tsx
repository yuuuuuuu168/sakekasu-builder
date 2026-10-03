import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../ThemeProvider';

/** OS のダークモード設定を差し替えて、変更イベントも流せるようにする */
function stubMatchMedia(initialDark: boolean) {
  const listeners = new Set<() => void>();
  let dark = initialDark;

  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    media: query,
    get matches() {
      return dark;
    },
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;

  return {
    setDark(next: boolean) {
      dark = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={() => setTheme('light')}>
        light にする
      </button>
    </div>
  );
}

const originalMatchMedia = window.matchMedia;

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('保存が無ければ system 扱いで、OS の設定を解決結果にする', () => {
    stubMatchMedia(true);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('system のあいだは OS 設定の変更に追随する', () => {
    const media = stubMatchMedia(false);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved').textContent).toBe('light');

    act(() => media.setDark(true));

    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('明示的に選んだテーマは OS 設定より優先し、保存もする', () => {
    const media = stubMatchMedia(true);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'light にする' }));

    expect(screen.getByTestId('resolved').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    // 共通テーマは data-theme が無いと OS（ここではダーク）に従うので、ライトも明示する
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('sakekasu-theme')).toBe('light');

    // OS 側が変わっても、選んだテーマのまま
    act(() => media.setDark(false));
    expect(screen.getByTestId('resolved').textContent).toBe('light');
  });

  it('保存済みのテーマを初期値に使う', () => {
    stubMatchMedia(false);
    localStorage.setItem('sakekasu-theme', 'dark');

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
