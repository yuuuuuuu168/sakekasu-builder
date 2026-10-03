import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'sakekasu-theme';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** サーバー側では OS 設定を読めないので light 固定 */
function getServerTheme(): 'light' | 'dark' {
  return 'light';
}

/** OS のダークモード設定の変更を購読する */
function subscribeSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  // OS 設定は外部の状態なので購読して読む。解決後のテーマを state に持つと
  // effect 内での setState が要るうえ、theme と二重管理になるため導出で済ませる
  const systemTheme = useSyncExternalStore(subscribeSystemTheme, getSystemTheme, getServerTheme);
  const resolvedTheme = theme === 'system' ? systemTheme : theme;

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  };

  // effect の役割は DOM（React の外）への反映だけに絞る
  // .dark は Tailwind の dark: 用、data-theme は共通テーマ（theme/sakekasu-theme.css）用。
  // 共通テーマは data-theme が無いと OS の設定に従うので、ライトを選んだときも明示する
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Provider と対で使うフックなので同じファイルに置く（AuthContext と同じ判断）
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
