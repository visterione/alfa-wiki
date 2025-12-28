import React, { createContext, useContext, useState, useEffect } from 'react';
import { settings } from '../services/api';

const ThemeContext = createContext({
  theme: { siteName: 'Alfa Wiki', primaryColor: '#007AFF', logo: null },
  updateTheme: () => {},
  reloadTheme: () => {}
});

// Функция для получения HSL значений из hex
function hexToHSL(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
      default: h = 0;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

// Функция для преобразования HSL в hex
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (0 <= h && h < 60) { r = c; g = x; b = 0; }
  else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
  else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
  else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
  else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
  else if (300 <= h && h < 360) { r = c; g = 0; b = x; }

  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Создаём светлый оттенок того же цвета (не бирюзовый!)
function createLightVariant(hex) {
  const { h, s } = hexToHSL(hex);
  // Сохраняем тон (hue), уменьшаем насыщенность и увеличиваем яркость
  // Это даёт мягкий пастельный оттенок того же цвета
  return hslToHex(h, Math.min(s, 40), 95);
}

// Создаём более тёмный оттенок для hover
function createDarkVariant(hex) {
  const { h, s, l } = hexToHSL(hex);
  return hslToHex(h, s, Math.max(l - 10, 20));
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
      if (!token) return;
      
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
    
    // Основной цвет
    root.style.setProperty('--primary', primary);
    
    // Тёмный вариант для hover (того же оттенка)
    root.style.setProperty('--primary-hover', createDarkVariant(primary));
    
    // Светлый вариант для выделений (того же оттенка, НЕ бирюзовый!)
    root.style.setProperty('--primary-light', createLightVariant(primary));

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