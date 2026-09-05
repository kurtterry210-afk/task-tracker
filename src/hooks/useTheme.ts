import { useEffect, useState } from 'react';

const STORAGE_KEY = 'task-tracker-theme';
const DARK_CLASS = 'dark';

type Theme = 'light' | 'dark';

interface UseThemeReturn {
  isDark: boolean;
  toggleTheme: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

/**
 * 暗黑模式管理钩子
 * 
 * 功能：
 * - localStorage 持久化主题设置
 * - 自动在 <html> 元素添加/移除 'dark' class
 * - 优先使用已保存的主题，否则根据系统偏好初始化
 * 
 * @returns {UseThemeReturn} 主题状态和控制函数
 * 
 * @example
 * ```tsx
 * function App() {
 *   const { isDark, toggleTheme } = useTheme();
 *   
 *   return (
 *     <button onClick={toggleTheme}>
 *       {isDark ? '🌙' : '☀️'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useTheme(): UseThemeReturn {
  // 初始化主题：优先从 localStorage 读取，否则使用系统偏好
  const [theme, setThemeState] = useState<Theme>(() => {
    // 1. 检查 localStorage
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }

    // 2. 使用系统偏好
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }

    return 'light';
  });

  // 同步主题到 DOM 和 localStorage
  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'dark') {
      root.classList.add(DARK_CLASS);
    } else {
      root.classList.remove(DARK_CLASS);
    }

    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // 监听系统主题变化（仅在用户未手动设置时生效）
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      // 只有当 localStorage 中没有保存主题时，才跟随系统
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setThemeState(e.matches ? 'dark' : 'light');
      }
    };

    // 现代浏览器使用 addEventListener
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return {
    isDark: theme === 'dark',
    theme,
    toggleTheme,
    setTheme,
  };
}
