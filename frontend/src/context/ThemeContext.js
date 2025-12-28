import React, { createContext, useContext, useState, useEffect } from 'react';
import { settings } from '../services/api';

const ThemeContext = createContext({
  theme: { siteName: 'Alfa Wiki', primaryColor: '#007AFF', logo: null },
  updateTheme: () => {},
  reloadTheme: () => {}
});

function lightenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return '#' + (
    0x1000000 +
    (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
    (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
    (B < 255 ? (B < 1 ? 0 : B) : 255)
  ).toString(16).slice(1);
}

function darkenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) - amt;
  const G = (num >> 8 & 0x00FF) - amt;
  const B = (num & 0x0000FF) - amt;
  return '#' + (
    0x1000000 +
    (R > 0 ? R : 0) * 0x10000 +
    (G > 0 ? G : 0) * 0x100 +
    (B > 0 ? B : 0)
  ).toString(16).slice(1);
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState({
    siteName: 'Alfa Wiki',
    primaryColor: '#007AFF',
    logo: null
  });

  useEffect(() => {
    // Сначала загружаем из localStorage
    const cached = localStorage.getItem('theme');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setTheme(parsed);
        applyTheme(parsed);
      } catch (e) {
        console.error('Failed to parse cached theme:', e);
      }
    } else {
      applyTheme(theme);
    }
    
    // Затем загружаем с сервера
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return; // Не загружаем если не авторизован
      
      const { data } = await settings.list();
      const newTheme = {
        siteName: data.siteName || 'Alfa Wiki',
        primaryColor: data.primaryColor || '#007AFF',
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
    const root = document.documentElement;
    const primary = themeData.primaryColor || '#007AFF';
    
    root.style.setProperty('--primary', primary);
    root.style.setProperty('--primary-hover', darkenColor(primary, 15));
    root.style.setProperty('--primary-light', lightenColor(primary, 45));

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