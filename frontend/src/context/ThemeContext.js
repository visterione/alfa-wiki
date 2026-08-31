import React, { createContext, useContext, useState, useEffect } from 'react';
import { settings } from '../services/api';

/**
 * Брендирование портала: название и логотип.
 *
 * Раньше здесь жил ещё и основной цвет — общий для всех сотрудников и
 * настраиваемый только администратором. С ver. 7.60 цвет стал личным выбором
 * каждого и переехал в AppearanceContext, где синхронизируется с мобильным
 * приложением. Глобальной настройки цвета больше нет: два источника правды на
 * один --primary неизбежно спорили бы между собой.
 */

const ThemeContext = createContext({
  theme: { siteName: 'Alfa Wiki', logo: null },
  updateTheme: () => {},
  reloadTheme: () => {}
});

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState({ siteName: 'Alfa Wiki', logo: null });

  useEffect(() => {
    // Сначала из localStorage — название вкладки не должно моргать
    const cached = localStorage.getItem('theme');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setTheme(parsed);
        applyTheme(parsed);
      } catch (e) {
        console.error('Failed to parse cached theme:', e);
      }
    }

    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const { data } = await settings.list();
      const newTheme = {
        siteName: data.siteName || 'Alfa Wiki',
        logo: data.logo || null
      };
      setTheme(newTheme);
      applyTheme(newTheme);
      localStorage.setItem('theme', JSON.stringify(newTheme));
    } catch (e) {
      console.error('Failed to load theme:', e);
    }
  };

  const applyTheme = (themeData) => {
    document.title = themeData.siteName || 'Alfa Wiki';
  };

  const updateTheme = (newTheme) => {
    setTheme(newTheme);
    applyTheme(newTheme);
    localStorage.setItem('theme', JSON.stringify(newTheme));
  };

  return (
    <ThemeContext.Provider value={{ theme, updateTheme, reloadTheme: loadTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  return useContext(ThemeContext);
};
