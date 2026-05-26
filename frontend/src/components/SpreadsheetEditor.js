import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Upload, Download, ArrowUp, ArrowDown } from 'lucide-react';
import { pages } from '../services/api';
import toast from 'react-hot-toast';
import './SpreadsheetEditor.css';

// Русские названия функций
import { RUSSIAN_FORMULA_MAP, RUSSIAN_FORMULA_DESCRIPTIONS } from '../utils/russianFormulas';

// Univer imports
import { createUniver } from '@univerjs/presets';
import { LocaleType, mergeLocales } from '@univerjs/core';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter';
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting';
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation';
import { UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace';
import { UniverSheetsHyperLinkPreset } from '@univerjs/preset-sheets-hyper-link';
import { UniverSheetsNotePreset } from '@univerjs/preset-sheets-note';
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort';
import { UniverSheetsTablePreset } from '@univerjs/preset-sheets-table';

// Локализации
import UniverPresetSheetsCoreRuRU from '@univerjs/preset-sheets-core/locales/ru-RU';
import UniverPresetSheetsFilterRuRU from '@univerjs/preset-sheets-filter/locales/ru-RU';
import UniverPresetSheetsConditionalFormattingRuRU from '@univerjs/preset-sheets-conditional-formatting/locales/ru-RU';
import UniverPresetSheetsDataValidationRuRU from '@univerjs/preset-sheets-data-validation/locales/ru-RU';
import UniverPresetSheetsFindReplaceRuRU from '@univerjs/preset-sheets-find-replace/locales/ru-RU';
import UniverPresetSheetsHyperLinkRuRU from '@univerjs/preset-sheets-hyper-link/locales/ru-RU';
import UniverPresetSheetsNoteRuRU from '@univerjs/preset-sheets-note/locales/ru-RU';
import UniverPresetSheetsSortRuRU from '@univerjs/preset-sheets-sort/locales/ru-RU';
import UniverPresetSheetsTableRuRU from '@univerjs/preset-sheets-table/locales/ru-RU';

// Univer styles
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-filter/lib/index.css';
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css';
import '@univerjs/preset-sheets-data-validation/lib/index.css';
import '@univerjs/preset-sheets-find-replace/lib/index.css';
import '@univerjs/preset-sheets-hyper-link/lib/index.css';
import '@univerjs/preset-sheets-note/lib/index.css';
import '@univerjs/preset-sheets-sort/lib/index.css';
import '@univerjs/preset-sheets-table/lib/index.css';

// Простые ссылки на ячейку другого листа ('Лист'!A1, Sheet!$A$1 и т.п.)
const CROSS_SHEET_SIMPLE_REF = /^'?[^!'()=+\-*/,;:[\]]+?'?!\$?[A-Za-z]+\$?\d+$/;

// "B2" / "$B$2" → { row, col } (0-based)
function parseCellAddress(addr) {
  const s = addr.replace(/\$/g, '');
  const m = s.match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  return { row: parseInt(m[2], 10) - 1, col: col - 1 };
}

// "'Лист'!B2" → { sheetName, row, col }
function parseCrossSheetRef(raw) {
  const m = raw.match(/^'?([^!']+?)'?!\$?([A-Za-z]+\$?\d+)$/);
  if (!m) return null;
  const addr = parseCellAddress(m[2]);
  return addr ? { sheetName: m[1], ...addr } : null;
}

// Гарантируем что пустые ячейки-источники хранят v:"" (пустая строка),
// тогда межлистовая ссылка вернёт "" вместо 0. Формулы НЕ трогаем —
// в строке формул пользователь видит обычный вид типа ='Вызов'!B2.
//
// Дополнительно заполняем весь диапазон строк referenced-колонок значением v:"".
// Это покрывает перетягивание формул: новая строка уже имеет v:"" в Univer,
// поэтому ссылка сразу возвращает "" без перезагрузки страницы.
function fixEmptySourceCells(workbookData) {
  if (!workbookData?.sheets) return workbookData;

  const byName = {};
  for (const sheet of Object.values(workbookData.sheets)) {
    if (sheet?.name) byName[sheet.name] = sheet;
  }

  // Шаг 1: сканируем формулы → исправляем конкретные ячейки-источники,
  // попутно собираем какие колонки каждого листа-источника используются.
  const refCols = {}; // sheetName → Set<col>

  for (const sheet of Object.values(workbookData.sheets)) {
    if (!sheet?.cellData) continue;
    for (const rowData of Object.values(sheet.cellData)) {
      if (!rowData) continue;
      for (const cell of Object.values(rowData)) {
        if (!cell?.f) continue;
        const raw = (cell.f.startsWith('=') ? cell.f.slice(1) : cell.f).trim();
        if (!CROSS_SHEET_SIMPLE_REF.test(raw)) continue;

        const ref = parseCrossSheetRef(raw);
        if (!ref) continue;

        if (!refCols[ref.sheetName]) refCols[ref.sheetName] = new Set();
        refCols[ref.sheetName].add(ref.col);

        const srcSheet = byName[ref.sheetName];
        if (!srcSheet) continue;
        if (!srcSheet.cellData) srcSheet.cellData = {};
        if (!srcSheet.cellData[ref.row]) srcSheet.cellData[ref.row] = {};
        const src = srcSheet.cellData[ref.row][ref.col];
        if (!src || src.v === null || src.v === undefined) {
          srcSheet.cellData[ref.row][ref.col] = { ...(src || {}), v: '', t: 1 };
        }

        // Сбрасываем устаревший кеш v:0 у ячейки-назначения
        if (cell.v === 0 || cell.v === null) {
          delete cell.v;
          delete cell.t;
        }
      }
    }
  }

  // Шаг 2: для каждой referenced-колонки заполняем весь диапазон строк листа-источника.
  // После этого перетягивание формулы в любую строку в пределах данных листа
  // сразу возвращает "" — Univer уже видит v:"" в источнике.
  for (const [sheetName, cols] of Object.entries(refCols)) {
    const sheet = byName[sheetName];
    if (!sheet?.cellData) continue;

    let maxRow = 0;
    for (const rowStr of Object.keys(sheet.cellData)) {
      const r = Number(rowStr);
      if (!isNaN(r) && r > maxRow) maxRow = r;
    }

    for (let r = 0; r <= maxRow; r++) {
      if (!sheet.cellData[r]) sheet.cellData[r] = {};
      for (const col of cols) {
        const cell = sheet.cellData[r][col];
        if (!cell || cell.v === null || cell.v === undefined) {
          sheet.cellData[r][col] = { ...(cell || {}), v: '', t: 1 };
        }
      }
    }
  }

  return workbookData;
}

const SpreadsheetEditor = forwardRef(({
  content,
  onChange,
  pageId,
  readOnly = false,
  fullHeight = false
}, ref) => {
  const containerRef = useRef(null);
  const univerAPIRef = useRef(null);
  const workbookRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const contentRef = useRef(content);
  const initializedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  // Обновляем ref при изменении onChange и content
  useEffect(() => {
    onChangeRef.current = onChange;
    contentRef.current = content;
  }, [onChange, content]);

  // Регистрация русских названий функций
  const registerRussianFormulas = (univerAPI) => {
    try {
      const formulaEngine = univerAPI.getFormula();

      if (!formulaEngine || !formulaEngine.registerFunction) {
        console.warn('Formula engine not available for Russian functions registration');
        return;
      }

      // Хелпер для извлечения числовых значений из аргументов (включая массивы)
      const flattenArgs = (args) => {
        const result = [];
        for (const arg of args) {
          if (Array.isArray(arg)) {
            // Двумерный массив (диапазон ячеек)
            for (const row of arg) {
              if (Array.isArray(row)) {
                for (const cell of row) {
                  if (cell !== null && cell !== undefined && cell !== '') {
                    result.push(cell);
                  }
                }
              } else if (row !== null && row !== undefined && row !== '') {
                result.push(row);
              }
            }
          } else if (arg !== null && arg !== undefined && arg !== '') {
            result.push(arg);
          }
        }
        return result;
      };

      const getNumbers = (args) => {
        return flattenArgs(args)
          .map(v => typeof v === 'number' ? v : parseFloat(v))
          .filter(v => !isNaN(v));
      };

      // Реализации основных функций
      const russianFunctions = {
        // === МАТЕМАТИЧЕСКИЕ ===
        'СУММ': {
          fn: (...args) => getNumbers(args).reduce((a, b) => a + b, 0),
          desc: 'Суммирует все числа в диапазоне'
        },
        'ПРОИЗВЕД': {
          fn: (...args) => {
            const nums = getNumbers(args);
            return nums.length ? nums.reduce((a, b) => a * b, 1) : 0;
          },
          desc: 'Перемножает все числа'
        },
        'КОРЕНЬ': {
          fn: (num) => Math.sqrt(Number(num) || 0),
          desc: 'Возвращает квадратный корень числа'
        },
        'СТЕПЕНЬ': {
          fn: (base, exp) => Math.pow(Number(base) || 0, Number(exp) || 0),
          desc: 'Возводит число в степень'
        },
        'ОСТАТ': {
          fn: (num, divisor) => (Number(num) || 0) % (Number(divisor) || 1),
          desc: 'Возвращает остаток от деления'
        },
        'ЧАСТНОЕ': {
          fn: (num, divisor) => Math.trunc((Number(num) || 0) / (Number(divisor) || 1)),
          desc: 'Возвращает целую часть от деления'
        },
        'ЦЕЛОЕ': {
          fn: (num) => Math.floor(Number(num) || 0),
          desc: 'Округляет число до ближайшего меньшего целого'
        },
        'ОТБР': {
          fn: (num, digits = 0) => {
            const d = Math.pow(10, Number(digits) || 0);
            return Math.trunc((Number(num) || 0) * d) / d;
          },
          desc: 'Усекает число до указанного количества знаков'
        },
        'ЗНАК': {
          fn: (num) => Math.sign(Number(num) || 0),
          desc: 'Возвращает знак числа'
        },
        'ОКРУГЛ': {
          fn: (num, digits = 0) => {
            const d = Math.pow(10, Number(digits) || 0);
            return Math.round((Number(num) || 0) * d) / d;
          },
          desc: 'Округляет число до указанного количества знаков'
        },
        'ОКРУГЛВВЕРХ': {
          fn: (num, digits = 0) => {
            const d = Math.pow(10, Number(digits) || 0);
            return Math.ceil((Number(num) || 0) * d) / d;
          },
          desc: 'Округляет число вверх'
        },
        'ОКРУГЛВНИЗ': {
          fn: (num, digits = 0) => {
            const d = Math.pow(10, Number(digits) || 0);
            return Math.floor((Number(num) || 0) * d) / d;
          },
          desc: 'Округляет число вниз'
        },
        'ЧЁТН': {
          fn: (num) => {
            const n = Math.ceil(Math.abs(Number(num) || 0));
            const result = n % 2 === 0 ? n : n + 1;
            return (Number(num) || 0) < 0 ? -result : result;
          },
          desc: 'Округляет до ближайшего чётного'
        },
        'НЕЧЁТ': {
          fn: (num) => {
            const n = Math.ceil(Math.abs(Number(num) || 0));
            const result = n % 2 === 1 ? n : n + 1;
            return (Number(num) || 0) < 0 ? -result : result;
          },
          desc: 'Округляет до ближайшего нечётного'
        },
        'ПИ': {
          fn: () => Math.PI,
          desc: 'Возвращает число Пи'
        },
        'СЛЧИС': {
          fn: () => Math.random(),
          desc: 'Возвращает случайное число от 0 до 1'
        },
        'СЛУЧМЕЖДУ': {
          fn: (min, max) => {
            const minN = Math.ceil(Number(min) || 0);
            const maxN = Math.floor(Number(max) || 0);
            return Math.floor(Math.random() * (maxN - minN + 1)) + minN;
          },
          desc: 'Возвращает случайное целое число в диапазоне'
        },

        // === СТАТИСТИЧЕСКИЕ ===
        'СРЗНАЧ': {
          fn: (...args) => {
            const nums = getNumbers(args);
            return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
          },
          desc: 'Вычисляет среднее арифметическое'
        },
        'СЧЁТ': {
          fn: (...args) => getNumbers(args).length,
          desc: 'Подсчитывает количество чисел'
        },
        'СЧЕТ': {
          fn: (...args) => getNumbers(args).length,
          desc: 'Подсчитывает количество чисел'
        },
        'СЧЁТЗ': {
          fn: (...args) => flattenArgs(args).length,
          desc: 'Подсчитывает непустые ячейки'
        },
        'СЧЕТЗ': {
          fn: (...args) => flattenArgs(args).length,
          desc: 'Подсчитывает непустые ячейки'
        },
        'МАКС': {
          fn: (...args) => {
            const nums = getNumbers(args);
            return nums.length ? Math.max(...nums) : 0;
          },
          desc: 'Возвращает максимальное значение'
        },
        'МИН': {
          fn: (...args) => {
            const nums = getNumbers(args);
            return nums.length ? Math.min(...nums) : 0;
          },
          desc: 'Возвращает минимальное значение'
        },
        'МЕДИАНА': {
          fn: (...args) => {
            const nums = getNumbers(args).sort((a, b) => a - b);
            if (!nums.length) return 0;
            const mid = Math.floor(nums.length / 2);
            return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
          },
          desc: 'Возвращает медиану'
        },
        'НАИБОЛЬШИЙ': {
          fn: (range, k) => {
            const nums = getNumbers([range]).sort((a, b) => b - a);
            const idx = (Number(k) || 1) - 1;
            return nums[idx] !== undefined ? nums[idx] : 0;
          },
          desc: 'Возвращает k-е наибольшее значение'
        },
        'НАИМЕНЬШИЙ': {
          fn: (range, k) => {
            const nums = getNumbers([range]).sort((a, b) => a - b);
            const idx = (Number(k) || 1) - 1;
            return nums[idx] !== undefined ? nums[idx] : 0;
          },
          desc: 'Возвращает k-е наименьшее значение'
        },

        // === ЛОГИЧЕСКИЕ ===
        'ЕСЛИ': {
          fn: (condition, valueIfTrue, valueIfFalse = false) => {
            return condition ? valueIfTrue : valueIfFalse;
          },
          desc: 'Проверяет условие и возвращает значение'
        },
        'И': {
          fn: (...args) => flattenArgs(args).every(v => Boolean(v)),
          desc: 'Возвращает ИСТИНА, если все аргументы истинны'
        },
        'ИЛИ': {
          fn: (...args) => flattenArgs(args).some(v => Boolean(v)),
          desc: 'Возвращает ИСТИНА, если хотя бы один аргумент истинен'
        },
        'НЕ': {
          fn: (value) => !value,
          desc: 'Меняет логическое значение на противоположное'
        },
        'ИСКЛИЛИ': {
          fn: (...args) => {
            const values = flattenArgs(args).map(v => Boolean(v));
            return values.filter(v => v).length % 2 === 1;
          },
          desc: 'Исключающее ИЛИ'
        },
        'ИСТИНА': {
          fn: () => true,
          desc: 'Возвращает логическое значение ИСТИНА'
        },
        'ЛОЖЬ': {
          fn: () => false,
          desc: 'Возвращает логическое значение ЛОЖЬ'
        },
        'ЕСЛИОШИБКА': {
          fn: (value, valueIfError) => {
            // В контексте Univer ошибки приходят как специальные объекты
            if (value instanceof Error || value === '#ERROR!' || value === '#VALUE!' ||
                value === '#REF!' || value === '#NAME?' || value === '#DIV/0!' ||
                value === '#N/A' || value === '#NULL!') {
              return valueIfError;
            }
            return value;
          },
          desc: 'Возвращает значение, если нет ошибки'
        },

        // === ТЕКСТОВЫЕ ===
        'СЦЕПИТЬ': {
          fn: (...args) => flattenArgs(args).join(''),
          desc: 'Объединяет текстовые строки'
        },
        'СЦЕП': {
          fn: (...args) => flattenArgs(args).join(''),
          desc: 'Объединяет текстовые строки'
        },
        'ЛЕВСИМВ': {
          fn: (text, numChars = 1) => String(text || '').substring(0, Number(numChars) || 1),
          desc: 'Возвращает символы с начала строки'
        },
        'ПРАВСИМВ': {
          fn: (text, numChars = 1) => {
            const s = String(text || '');
            const n = Number(numChars) || 1;
            return s.substring(s.length - n);
          },
          desc: 'Возвращает символы с конца строки'
        },
        'ПСТР': {
          fn: (text, start, numChars) => {
            const s = String(text || '');
            const startIdx = (Number(start) || 1) - 1;
            return s.substring(startIdx, startIdx + (Number(numChars) || 1));
          },
          desc: 'Возвращает часть строки'
        },
        'ДЛСТР': {
          fn: (text) => String(text || '').length,
          desc: 'Возвращает длину строки'
        },
        'ПРОПИСН': {
          fn: (text) => String(text || '').toUpperCase(),
          desc: 'Преобразует в верхний регистр'
        },
        'СТРОЧН': {
          fn: (text) => String(text || '').toLowerCase(),
          desc: 'Преобразует в нижний регистр'
        },
        'ПРОПНАЧ': {
          fn: (text) => String(text || '').replace(/\b\w/g, c => c.toUpperCase()),
          desc: 'Делает первую букву каждого слова заглавной'
        },
        'СЖПРОБЕЛЫ': {
          fn: (text) => String(text || '').trim().replace(/\s+/g, ' '),
          desc: 'Удаляет лишние пробелы'
        },
        'НАЙТИ': {
          fn: (findText, withinText, startNum = 1) => {
            const idx = String(withinText || '').indexOf(String(findText || ''), (Number(startNum) || 1) - 1);
            return idx >= 0 ? idx + 1 : '#VALUE!';
          },
          desc: 'Находит позицию подстроки (с учётом регистра)'
        },
        'ПОИСК': {
          fn: (findText, withinText, startNum = 1) => {
            const idx = String(withinText || '').toLowerCase()
              .indexOf(String(findText || '').toLowerCase(), (Number(startNum) || 1) - 1);
            return idx >= 0 ? idx + 1 : '#VALUE!';
          },
          desc: 'Находит позицию подстроки (без учёта регистра)'
        },
        'ЗАМЕНИТЬ': {
          fn: (oldText, startNum, numChars, newText) => {
            const s = String(oldText || '');
            const start = (Number(startNum) || 1) - 1;
            const len = Number(numChars) || 0;
            return s.substring(0, start) + String(newText || '') + s.substring(start + len);
          },
          desc: 'Заменяет часть строки'
        },
        'ПОДСТАВИТЬ': {
          fn: (text, oldText, newText, instanceNum) => {
            const s = String(text || '');
            const old = String(oldText || '');
            const newS = String(newText || '');
            if (instanceNum) {
              let count = 0;
              return s.replace(new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), (match) => {
                count++;
                return count === Number(instanceNum) ? newS : match;
              });
            }
            return s.split(old).join(newS);
          },
          desc: 'Заменяет все вхождения подстроки'
        },
        'ПОВТОР': {
          fn: (text, times) => String(text || '').repeat(Number(times) || 0),
          desc: 'Повторяет текст указанное число раз'
        },
        'ТЕКСТ': {
          fn: (value, format) => {
            // Упрощённая реализация форматирования
            const num = Number(value);
            if (isNaN(num)) return String(value || '');
            const fmt = String(format || '');
            if (fmt.includes('%')) return (num * 100).toFixed(fmt.split('.')[1]?.length || 0) + '%';
            if (fmt.includes('.')) {
              const decimals = fmt.split('.')[1]?.replace(/[^0#]/g, '').length || 0;
              return num.toFixed(decimals);
            }
            return String(num);
          },
          desc: 'Форматирует число как текст'
        },
        'ЗНАЧЕН': {
          fn: (text) => {
            const num = parseFloat(String(text || '').replace(/[^\d.-]/g, ''));
            return isNaN(num) ? '#VALUE!' : num;
          },
          desc: 'Преобразует текст в число'
        },
        'Т': {
          fn: (value) => typeof value === 'string' ? value : '',
          desc: 'Возвращает текст, если аргумент - текст'
        },
        'Ч': {
          fn: (value) => {
            const num = Number(value);
            return isNaN(num) ? 0 : num;
          },
          desc: 'Преобразует значение в число'
        },

        // === ДАТА И ВРЕМЯ ===
        'СЕГОДНЯ': {
          fn: () => {
            const now = new Date();
            // Excel serial date (days since 1900-01-01)
            return Math.floor((now - new Date(1899, 11, 30)) / 86400000);
          },
          desc: 'Возвращает текущую дату'
        },
        'ТДАТА': {
          fn: () => {
            const now = new Date();
            return (now - new Date(1899, 11, 30)) / 86400000;
          },
          desc: 'Возвращает текущую дату и время'
        },
        'ГОД': {
          fn: (dateValue) => {
            const d = new Date(1899, 11, 30 + Number(dateValue));
            return d.getFullYear();
          },
          desc: 'Возвращает год из даты'
        },
        'МЕСЯЦ': {
          fn: (dateValue) => {
            const d = new Date(1899, 11, 30 + Number(dateValue));
            return d.getMonth() + 1;
          },
          desc: 'Возвращает месяц из даты'
        },
        'ДЕНЬ': {
          fn: (dateValue) => {
            const d = new Date(1899, 11, 30 + Number(dateValue));
            return d.getDate();
          },
          desc: 'Возвращает день из даты'
        },
        'ДАТА': {
          fn: (year, month, day) => {
            const d = new Date(Number(year), Number(month) - 1, Number(day));
            return Math.floor((d - new Date(1899, 11, 30)) / 86400000);
          },
          desc: 'Создаёт дату из компонентов'
        },
        'ЧАС': {
          fn: (timeValue) => {
            const fraction = Number(timeValue) % 1;
            return Math.floor(fraction * 24);
          },
          desc: 'Возвращает час из времени'
        },
        'МИНУТЫ': {
          fn: (timeValue) => {
            const fraction = Number(timeValue) % 1;
            return Math.floor((fraction * 24 * 60) % 60);
          },
          desc: 'Возвращает минуты из времени'
        },
        'СЕКУНДЫ': {
          fn: (timeValue) => {
            const fraction = Number(timeValue) % 1;
            return Math.floor((fraction * 24 * 60 * 60) % 60);
          },
          desc: 'Возвращает секунды из времени'
        },
        'ДЕНЬНЕД': {
          fn: (dateValue, returnType = 1) => {
            const d = new Date(1899, 11, 30 + Number(dateValue));
            const day = d.getDay();
            if (returnType === 1) return day + 1; // Воскресенье = 1
            if (returnType === 2) return day === 0 ? 7 : day; // Понедельник = 1
            return day === 0 ? 7 : day;
          },
          desc: 'Возвращает день недели'
        },

        // === ИНФОРМАЦИОННЫЕ ===
        'ЕПУСТО': {
          fn: (value) => value === null || value === undefined || value === '',
          desc: 'Проверяет, пуста ли ячейка'
        },
        'ЕЧИСЛО': {
          fn: (value) => typeof value === 'number' && !isNaN(value),
          desc: 'Проверяет, является ли значение числом'
        },
        'ЕТЕКСТ': {
          fn: (value) => typeof value === 'string',
          desc: 'Проверяет, является ли значение текстом'
        },
        'ЕЛОГИЧ': {
          fn: (value) => typeof value === 'boolean',
          desc: 'Проверяет, является ли значение логическим'
        },
        'ЕОШИБКА': {
          fn: (value) => {
            return value instanceof Error || String(value).startsWith('#');
          },
          desc: 'Проверяет наличие ошибки'
        },
        'НД': {
          fn: () => '#N/A',
          desc: 'Возвращает ошибку #Н/Д'
        },
        'ТИП': {
          fn: (value) => {
            if (typeof value === 'number') return 1;
            if (typeof value === 'string') return 2;
            if (typeof value === 'boolean') return 4;
            if (String(value).startsWith('#')) return 16;
            if (Array.isArray(value)) return 64;
            return 0;
          },
          desc: 'Возвращает тип значения'
        }
      };

      // Регистрируем реализованные функции
      for (const [name, { fn, desc }] of Object.entries(russianFunctions)) {
        try {
          formulaEngine.registerFunction(name, fn, desc);
        } catch (err) {
          // Функция уже существует или ошибка регистрации
        }
      }
    } catch (error) {
      console.warn('Could not register Russian formulas:', error);
    }
  };

  // Конвертация данных Luckysheet → Univer (для обратной совместимости)
  const convertLuckysheetToUniver = (luckysheetData) => {
    try {
      const parsed = typeof luckysheetData === 'string'
        ? JSON.parse(luckysheetData)
        : luckysheetData;

      // Проверяем, это уже Univer формат?
      if (parsed && parsed.id && parsed.sheets && !Array.isArray(parsed)) {
        return fixEmptySourceCells(parsed);
      }

      // Конвертируем Luckysheet → Univer
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid format');
      }

      const sheets = {};
      parsed.forEach((sheet, index) => {
        const sheetId = sheet.index || `sheet${index}`;
        const cellData = {};

        // Конвертируем celldata[] в cellData{}
        if (sheet.celldata && Array.isArray(sheet.celldata)) {
          sheet.celldata.forEach(cell => {
            const row = cell.r;
            const col = cell.c;

            if (!cellData[row]) {
              cellData[row] = {};
            }

            cellData[row][col] = {
              v: cell.v?.v,
              t: cell.v?.ct?.t === 's' ? 1 :
                 cell.v?.ct?.t === 'n' ? 2 : 0,
              ...(cell.v?.f && { f: cell.v.f })
            };
          });
        }

        sheets[sheetId] = {
          id: sheetId,
          name: sheet.name || `Sheet${index + 1}`,
          tabColor: '',
          hidden: 0,
          rowCount: sheet.row || 1000,
          columnCount: sheet.column || 26,
          zoomRatio: sheet.zoomRatio || 1,
          scrollTop: sheet.scrollTop || 0,
          scrollLeft: sheet.scrollLeft || 0,
          defaultColumnWidth: 88,
          defaultRowHeight: 24,
          status: parseInt(sheet.status) || 0,
          cellData,
          rowData: {},
          columnData: {},
          mergeData: [],
          rowHeader: {
            width: 46,
            hidden: 0
          },
          columnHeader: {
            height: 20,
            hidden: 0
          }
        };
      });

      return fixEmptySourceCells({
        id: 'workbook',
        name: 'Workbook',
        appVersion: '0.1.0',
        locale: LocaleType.RU_RU,
        styles: {},
        sheets,
        sheetOrder: Object.keys(sheets)
      });
    } catch (error) {
      console.error('Error converting Luckysheet to Univer:', error);
      return null;
    }
  };

  // Инициализация Univer (newContentOverride — для реинита без перезагрузки страницы)
  const initializeUniver = (newContentOverride) => {
    if (!containerRef.current) return;

    // Очистка предыдущего экземпляра
    if (univerAPIRef.current) {
      try {
        univerAPIRef.current.dispose();
      } catch (error) {
        // ignore dispose errors
      }
      univerAPIRef.current = null;
      workbookRef.current = null;
    }

    // Подготовка данных
    let workbookData;

    const dataToLoad = newContentOverride !== undefined ? newContentOverride : content;
    if (dataToLoad && dataToLoad.trim().length > 0) {
      workbookData = convertLuckysheetToUniver(dataToLoad);
    }

    if (!workbookData) {
      // Дефолтная рабочая книга
      workbookData = {
        id: 'workbook',
        name: 'Workbook',
        appVersion: '0.1.0',
        locale: LocaleType.RU_RU,
        styles: {},
        sheets: {
          'sheet-01': {
            id: 'sheet-01',
            name: 'Лист1',
            tabColor: '',
            hidden: 0,
            rowCount: 1000,
            columnCount: 26,
            zoomRatio: 1,
            scrollTop: 0,
            scrollLeft: 0,
            defaultColumnWidth: 88,
            defaultRowHeight: 24,
            cellData: {},
            rowData: {},
            columnData: {},
            mergeData: [],
            rowHeader: {
              width: 46,
              hidden: 0
            },
            columnHeader: {
              height: 20,
              hidden: 0
            }
          }
        },
        sheetOrder: ['sheet-01']
      };
    }

    try {
      const { univerAPI } = createUniver({
        locale: LocaleType.RU_RU,
        locales: {
          [LocaleType.RU_RU]: mergeLocales(
            UniverPresetSheetsCoreRuRU,
            UniverPresetSheetsFilterRuRU,
            UniverPresetSheetsConditionalFormattingRuRU,
            UniverPresetSheetsDataValidationRuRU,
            UniverPresetSheetsFindReplaceRuRU,
            UniverPresetSheetsHyperLinkRuRU,
            UniverPresetSheetsNoteRuRU,
            UniverPresetSheetsSortRuRU,
            UniverPresetSheetsTableRuRU
          )
        },
        presets: [
          UniverSheetsCorePreset({
            container: containerRef.current
          }),
          UniverSheetsFilterPreset(),
          UniverSheetsConditionalFormattingPreset(),
          UniverSheetsDataValidationPreset(),
          UniverSheetsFindReplacePreset(),
          UniverSheetsHyperLinkPreset(),
          UniverSheetsNotePreset(),
          UniverSheetsSortPreset(),
          UniverSheetsTablePreset()
        ]
      });

      univerAPIRef.current = univerAPI;

      const workbook = univerAPI.createUniverSheet(workbookData);
      workbookRef.current = workbook;

      // Регистрация русских названий функций
      registerRussianFormulas(univerAPI);

      // Настройка read-only режима
      if (readOnly) {
        setTimeout(() => {
          try {
            const permission = workbook.getWorkbookPermission();
            if (permission && permission.setReadOnly) {
              permission.setReadOnly();
            }
          } catch (err) {
            // read-only mode not available
          }
        }, 500);
      }

      // Подписка на изменения (для автосохранения)
      if (!readOnly) {
        univerAPI.addEvent(univerAPI.Event.CommandExecuted, (command) => {
          // Пропускаем операции просмотра: выделение, скролл, зум (type === 1 = OPERATION)
          if (command?.type === 1) return;
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = setTimeout(() => saveData(), 8000);
        });
      }

      initializedRef.current = true;
      setIsReady(true);

    } catch (error) {
      console.error('❌ Error initializing Univer:', error);
      toast.error('Ошибка инициализации таблицы: ' + error.message);
    }
  };

  // Инициализация при монтировании
  useEffect(() => {
    if (initializedRef.current) return;

    let rafId;
    let timerId;

    rafId = requestAnimationFrame(() => {
      timerId = setTimeout(() => {
        if (!containerRef.current) return;
        initializeUniver();
      }, 100);
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      if (univerAPIRef.current) {
        try {
          univerAPIRef.current.dispose();
        } catch (error) {
          console.error('Error disposing Univer:', error);
        }
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      initializedRef.current = false;
      setIsReady(false);
    };
  }, []);

  // Функция сохранения данных
  const saveData = () => {
    if (readOnly) return null;

    try {
      if (!workbookRef.current) return null;

      const snapshot = workbookRef.current.getSnapshot();

      // Фиксируем пустые ячейки-источники перед сохранением, чтобы при следующей
      // загрузке ссылки на них возвращали "" вместо 0.
      fixEmptySourceCells(snapshot);

      const jsonData = JSON.stringify(snapshot);

      if (onChangeRef.current) {
        onChangeRef.current(jsonData);
      }

      contentRef.current = jsonData;

      return jsonData;
    } catch (error) {
      console.error('Error saving data:', error);
      toast.error('Ошибка сохранения данных');
      return null;
    }
  };

  // Экспозиция методов для родительского компонента
  useImperativeHandle(ref, () => ({
    forceSave: () => {
      return new Promise((resolve) => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }

        const savedData = saveData();

        setTimeout(() => {
          resolve(savedData);
        }, 100);
      });
    },
    getData: () => {
      if (readOnly) return contentRef.current;
      try {
        if (!workbookRef.current) return contentRef.current;
        const snapshot = workbookRef.current.getSnapshot();
        return JSON.stringify(snapshot);
      } catch (error) {
        console.error('Error getting data:', error);
        return contentRef.current;
      }
    }
  }), [readOnly]);

  // Навигация по таблице — скролл через встроенную команду Univer
  const scrollToRow = useCallback((row) => {
    if (!univerAPIRef.current) return;
    univerAPIRef.current.executeCommand('sheet.command.scroll-to-cell', {
      range: { startRow: row, endRow: row, startColumn: 0, endColumn: 0 },
      forceTop: true,
      forceLeft: true
    });
  }, []);

  const navigateToTop = useCallback(() => {
    if (!isReady) return;
    scrollToRow(0);
  }, [isReady, scrollToRow]);

  const navigateToBottom = useCallback(() => {
    if (!isReady || !workbookRef.current) return;
    try {
      const sheet = workbookRef.current.getActiveSheet?.();
      if (!sheet) return;

      let lastRow = 0;

      // Пробуем встроенный API Univer
      if (typeof sheet.getLastRow === 'function') {
        lastRow = sheet.getLastRow();
      } else {
        // Fallback: ищем максимальный индекс строки в снапшоте
        const snapshot = workbookRef.current.getSnapshot();
        const sheetId = sheet.getSheetId?.();
        const cellData = (sheetId ? snapshot?.sheets?.[sheetId] : Object.values(snapshot?.sheets || {})[0])?.cellData || {};
        const rows = Object.keys(cellData)
          .map(Number)
          .filter(r => !isNaN(r) && Object.keys(cellData[r] || {}).length > 0);
        if (rows.length > 0) lastRow = Math.max(...rows);
      }

      scrollToRow(lastRow);
    } catch (e) {
      console.warn('Navigate to bottom:', e);
    }
  }, [isReady, scrollToRow]);

  // Импорт Excel файла
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast.error('Поддерживаются только файлы Excel (.xlsx, .xls)');
      return;
    }

    if (!pageId) {
      toast.error('Сначала сохраните страницу');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const { data } = await pages.importXlsx(pageId, formData);
      const newContent = JSON.stringify(data.data);

      // Обновляем content в родительском компоненте
      onChange?.(newContent);

      toast.success('Файл импортирован');

      // Реинициализируем Univer на месте — без перезагрузки страницы
      contentRef.current = newContent;
      initializedRef.current = false;
      setIsReady(false);
      initializeUniver(newContent);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка импорта файла');
      console.error(error);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Экспорт в Excel
  const handleExport = async () => {
    if (!pageId) {
      toast.error('Сначала сохраните страницу');
      return;
    }

    setExporting(true);
    try {
      // Сохраняем текущие изменения
      saveData();

      // Небольшая задержка для сохранения
      await new Promise(resolve => setTimeout(resolve, 500));

      // Запрос на экспорт
      const response = await pages.exportXlsx(pageId);

      // Создаем blob и скачиваем
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `spreadsheet_${Date.now()}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success('Файл экспортирован');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка экспорта файла');
      console.error(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="spreadsheet-editor">
      {!readOnly && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={handleFileImport}
        />
      )}
      <div
        className={readOnly ? 'univer-container readonly' : 'univer-container'}
        style={{
          width: '100%',
          height: fullHeight ? '100%' : (readOnly ? '700px' : 'calc(100vh - 300px)'),
          minHeight: fullHeight ? '0' : '500px',
          position: 'relative'
        }}
      >
        {/* Отдельный контейнер для Univer - React не будет трогать его содержимое */}
        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: '100%',
            position: 'absolute',
            top: 0,
            left: 0
          }}
        />
        {/* Кнопки импорта/экспорта — над футером Univer, слева */}
        {!readOnly && (
          <div className="spreadsheet-io-buttons">
            <button
              className="spreadsheet-io-btn"
              onClick={handleImportClick}
              disabled={uploading}
              title="Импорт Excel (.xlsx)"
            >
              {uploading ? <div className="loading-spinner-small" /> : <Upload size={13} />}
              Импорт
            </button>
            <button
              className="spreadsheet-io-btn"
              onClick={handleExport}
              disabled={exporting}
              title="Экспорт в Excel"
            >
              {exporting ? <div className="loading-spinner-small" /> : <Download size={13} />}
              Экспорт
            </button>
          </div>
        )}
        {/* Кнопки навигации — над футером Univer (зум/листы), справа */}
        {isReady && (
          <div className="spreadsheet-nav-buttons">
            <button
              className="spreadsheet-nav-btn"
              onClick={navigateToTop}
              title="В начало таблицы"
            >
              <ArrowUp size={13} />
            </button>
            <button
              className="spreadsheet-nav-btn"
              onClick={navigateToBottom}
              title="К последней записи"
            >
              <ArrowDown size={13} />
            </button>
          </div>
        )}
        {/* Loading overlay - рендерится отдельно */}
        {!isReady && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fff',
            zIndex: 1000,
            pointerEvents: 'none'
          }}>
            <div style={{ textAlign: 'center', color: '#666', pointerEvents: 'auto' }}>
              <div className="loading-spinner-small" style={{
                margin: '0 auto 16px',
                width: '32px',
                height: '32px'
              }} />
              <p>Загрузка таблицы...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

SpreadsheetEditor.displayName = 'SpreadsheetEditor';

export default SpreadsheetEditor;
