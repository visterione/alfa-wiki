import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Upload, Download, ArrowUp, ArrowDown } from 'lucide-react';
import { pages } from '../services/api';
import toast from 'react-hot-toast';
import './SpreadsheetEditor.css';
import './SpreadsheetGrouping.css';

// Русские названия функций
import { RUSSIAN_FORMULA_MAP, RUSSIAN_FORMULA_DESCRIPTIONS } from '../utils/russianFormulas';

// Grouping
import {
  RowGroupPanel,
  ColGroupPanel,
  buildGroupsFromOutlineLevels,
  findNewGroupLevel,
  getOutlineLevelsFromGroups,
  UNIVER_COL_HEADER_HEIGHT,
  UNIVER_ROW_HEADER_WIDTH,
  GROUP_LEVEL_WIDTH,
  GROUP_LEVEL_HEIGHT,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_COL_WIDTH,
} from './SpreadsheetGrouping';

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

// Простые ссылки на ячейку другого листа
const CROSS_SHEET_SIMPLE_REF = /^'?[^!'()=+\-*/,;:[\]]+?'?!\$?[A-Za-z]+\$?\d+$/;

function parseCellAddress(addr) {
  const s = addr.replace(/\$/g, '');
  const m = s.match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  return { row: parseInt(m[2], 10) - 1, col: col - 1 };
}

function parseCrossSheetRef(raw) {
  const m = raw.match(/^'?([^!']+?)'?!\$?([A-Za-z]+\$?\d+)$/);
  if (!m) return null;
  const addr = parseCellAddress(m[2]);
  return addr ? { sheetName: m[1], ...addr } : null;
}

function fixEmptySourceCells(workbookData) {
  if (!workbookData?.sheets) return workbookData;

  const byName = {};
  for (const sheet of Object.values(workbookData.sheets)) {
    if (sheet?.name) byName[sheet.name] = sheet;
  }

  const refCols = {};

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

        if (cell.v === 0 || cell.v === null) {
          delete cell.v;
          delete cell.t;
        }
      }
    }
  }

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

// ─── Grouping data helpers ────────────────────────────────────────────────────

/**
 * Extract groups for all sheets from a snapshot.
 * rowGroups/colGroups fields are custom fields we persist alongside Univer data.
 */
function extractGroupsFromSnapshot(snapshot) {
  const rowGroups = {};
  const colGroups = {};
  if (!snapshot?.sheets) return { rowGroups, colGroups };
  for (const [sheetId, sheet] of Object.entries(snapshot.sheets)) {
    if (sheet?.rowGroupsData?.length > 0) rowGroups[sheetId] = sheet.rowGroupsData;
    if (sheet?.colGroupsData?.length > 0) colGroups[sheetId] = sheet.colGroupsData;
  }
  return { rowGroups, colGroups };
}

/**
 * Get rowData and columnData objects for the active sheet from the snapshot.
 */
function getSheetMeta(snapshot, sheetId) {
  const sheet = snapshot?.sheets?.[sheetId];
  return {
    rowData: sheet?.rowData || {},
    colData: sheet?.columnData || {},
  };
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

  // ─── Grouping state ────────────────────────────────────────────────────────
  const [activeSheetId, setActiveSheetId] = useState(null);
  const [rowGroups, setRowGroups] = useState([]);
  const [colGroups, setColGroups] = useState([]);
  const [scrollState, setScrollState] = useState({
    sheetViewStartRow: 0,
    sheetViewStartColumn: 0,
    offsetY: 0,
    offsetX: 0,
  });
  const [rowData, setRowData] = useState({});
  const [colData, setColData] = useState({});
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // Refs for group data (used in save/commands without needing re-render)
  const allRowGroupsRef = useRef({});  // { sheetId: groups[] }
  const allColGroupsRef = useRef({});
  // Ref to always-current grouping action callbacks (used by Univer menu items registered once at init)
  const groupActionsRef = useRef({});
  const activeSheetIdRef = useRef(null);
  const rowDataRef = useRef({});
  const colDataRef = useRef({});

  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    onChangeRef.current = onChange;
    contentRef.current = content;
  }, [onChange, content]);

  // Track the Univer canvas wrapper size for group panel height calculations
  const univerWrapperRef = useRef(null);
  useEffect(() => {
    const target = containerRef.current?.parentElement;
    if (!target) return;
    univerWrapperRef.current = target;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    ro.observe(target);
    return () => ro.disconnect();
  }, [isReady]);

  // ─── Russian formulas registration ────────────────────────────────────────
  const registerRussianFormulas = (univerAPI) => {
    try {
      const formulaEngine = univerAPI.getFormula();
      if (!formulaEngine || !formulaEngine.registerFunction) return;

      const flattenArgs = (args) => {
        const result = [];
        for (const arg of args) {
          if (Array.isArray(arg)) {
            for (const row of arg) {
              if (Array.isArray(row)) {
                for (const cell of row) {
                  if (cell !== null && cell !== undefined && cell !== '') result.push(cell);
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

      const getNumbers = (args) =>
        flattenArgs(args).map(v => typeof v === 'number' ? v : parseFloat(v)).filter(v => !isNaN(v));

      const russianFunctions = {
        'СУММ': { fn: (...args) => getNumbers(args).reduce((a, b) => a + b, 0), desc: 'Суммирует числа' },
        'ПРОИЗВЕД': { fn: (...args) => { const n = getNumbers(args); return n.length ? n.reduce((a, b) => a * b, 1) : 0; }, desc: 'Перемножает числа' },
        'КОРЕНЬ': { fn: (n) => Math.sqrt(Number(n) || 0), desc: 'Квадратный корень' },
        'СТЕПЕНЬ': { fn: (b, e) => Math.pow(Number(b) || 0, Number(e) || 0), desc: 'Возводит в степень' },
        'ОСТАТ': { fn: (n, d) => (Number(n) || 0) % (Number(d) || 1), desc: 'Остаток от деления' },
        'ЧАСТНОЕ': { fn: (n, d) => Math.trunc((Number(n) || 0) / (Number(d) || 1)), desc: 'Целая часть от деления' },
        'ЦЕЛОЕ': { fn: (n) => Math.floor(Number(n) || 0), desc: 'Округление вниз' },
        'ОТБР': { fn: (n, d = 0) => { const p = Math.pow(10, Number(d) || 0); return Math.trunc((Number(n) || 0) * p) / p; }, desc: 'Усечение' },
        'ЗНАК': { fn: (n) => Math.sign(Number(n) || 0), desc: 'Знак числа' },
        'ОКРУГЛ': { fn: (n, d = 0) => { const p = Math.pow(10, Number(d) || 0); return Math.round((Number(n) || 0) * p) / p; }, desc: 'Округление' },
        'ОКРУГЛВВЕРХ': { fn: (n, d = 0) => { const p = Math.pow(10, Number(d) || 0); return Math.ceil((Number(n) || 0) * p) / p; }, desc: 'Округление вверх' },
        'ОКРУГЛВНИЗ': { fn: (n, d = 0) => { const p = Math.pow(10, Number(d) || 0); return Math.floor((Number(n) || 0) * p) / p; }, desc: 'Округление вниз' },
        'ЧЁТН': { fn: (n) => { const v = Math.ceil(Math.abs(Number(n) || 0)); const r = v % 2 === 0 ? v : v + 1; return (Number(n) || 0) < 0 ? -r : r; }, desc: 'До чётного' },
        'НЕЧЁТ': { fn: (n) => { const v = Math.ceil(Math.abs(Number(n) || 0)); const r = v % 2 === 1 ? v : v + 1; return (Number(n) || 0) < 0 ? -r : r; }, desc: 'До нечётного' },
        'ПИ': { fn: () => Math.PI, desc: 'Число Пи' },
        'СЛЧИС': { fn: () => Math.random(), desc: 'Случайное 0..1' },
        'СЛУЧМЕЖДУ': { fn: (mn, mx) => Math.floor(Math.random() * (Math.floor(Number(mx)) - Math.ceil(Number(mn)) + 1)) + Math.ceil(Number(mn)), desc: 'Случайное целое' },
        'СРЗНАЧ': { fn: (...args) => { const n = getNumbers(args); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0; }, desc: 'Среднее' },
        'СЧЁТ': { fn: (...args) => getNumbers(args).length, desc: 'Кол-во чисел' },
        'СЧЕТ': { fn: (...args) => getNumbers(args).length, desc: 'Кол-во чисел' },
        'СЧЁТЗ': { fn: (...args) => flattenArgs(args).length, desc: 'Непустые ячейки' },
        'СЧЕТЗ': { fn: (...args) => flattenArgs(args).length, desc: 'Непустые ячейки' },
        'МАКС': { fn: (...args) => { const n = getNumbers(args); return n.length ? Math.max(...n) : 0; }, desc: 'Максимум' },
        'МИН': { fn: (...args) => { const n = getNumbers(args); return n.length ? Math.min(...n) : 0; }, desc: 'Минимум' },
        'МЕДИАНА': { fn: (...args) => { const n = getNumbers(args).sort((a, b) => a - b); if (!n.length) return 0; const m = Math.floor(n.length / 2); return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; }, desc: 'Медиана' },
        'НАИБОЛЬШИЙ': { fn: (r, k) => { const n = getNumbers([r]).sort((a, b) => b - a); return n[(Number(k) || 1) - 1] ?? 0; }, desc: 'k-е наибольшее' },
        'НАИМЕНЬШИЙ': { fn: (r, k) => { const n = getNumbers([r]).sort((a, b) => a - b); return n[(Number(k) || 1) - 1] ?? 0; }, desc: 'k-е наименьшее' },
        'ЕСЛИ': { fn: (c, t, f = false) => c ? t : f, desc: 'Условие' },
        'И': { fn: (...args) => flattenArgs(args).every(v => Boolean(v)), desc: 'Логическое И' },
        'ИЛИ': { fn: (...args) => flattenArgs(args).some(v => Boolean(v)), desc: 'Логическое ИЛИ' },
        'НЕ': { fn: (v) => !v, desc: 'Логическое НЕ' },
        'ИСКЛИЛИ': { fn: (...args) => flattenArgs(args).map(v => Boolean(v)).filter(v => v).length % 2 === 1, desc: 'Исключающее ИЛИ' },
        'ИСТИНА': { fn: () => true, desc: 'ИСТИНА' },
        'ЛОЖЬ': { fn: () => false, desc: 'ЛОЖЬ' },
        'ЕСЛИОШИБКА': { fn: (v, e) => { if (v instanceof Error || String(v).startsWith('#')) return e; return v; }, desc: 'Если ошибка' },
        'СЦЕПИТЬ': { fn: (...args) => flattenArgs(args).join(''), desc: 'Объединение текста' },
        'СЦЕП': { fn: (...args) => flattenArgs(args).join(''), desc: 'Объединение текста' },
        'ЛЕВСИМВ': { fn: (t, n = 1) => String(t || '').substring(0, Number(n) || 1), desc: 'Левые символы' },
        'ПРАВСИМВ': { fn: (t, n = 1) => { const s = String(t || ''); return s.substring(s.length - (Number(n) || 1)); }, desc: 'Правые символы' },
        'ПСТР': { fn: (t, s, n) => { const str = String(t || ''); return str.substring((Number(s) || 1) - 1, (Number(s) || 1) - 1 + (Number(n) || 1)); }, desc: 'Часть строки' },
        'ДЛСТР': { fn: (t) => String(t || '').length, desc: 'Длина строки' },
        'ПРОПИСН': { fn: (t) => String(t || '').toUpperCase(), desc: 'Верхний регистр' },
        'СТРОЧН': { fn: (t) => String(t || '').toLowerCase(), desc: 'Нижний регистр' },
        'ПРОПНАЧ': { fn: (t) => String(t || '').replace(/\b\w/g, c => c.toUpperCase()), desc: 'Начало с заглавной' },
        'СЖПРОБЕЛЫ': { fn: (t) => String(t || '').trim().replace(/\s+/g, ' '), desc: 'Убрать пробелы' },
        'НАЙТИ': { fn: (f, w, s = 1) => { const i = String(w || '').indexOf(String(f || ''), (Number(s) || 1) - 1); return i >= 0 ? i + 1 : '#VALUE!'; }, desc: 'Позиция подстроки' },
        'ПОИСК': { fn: (f, w, s = 1) => { const i = String(w || '').toLowerCase().indexOf(String(f || '').toLowerCase(), (Number(s) || 1) - 1); return i >= 0 ? i + 1 : '#VALUE!'; }, desc: 'Поиск подстроки' },
        'ЗАМЕНИТЬ': { fn: (o, s, n, nw) => { const str = String(o || ''); const si = (Number(s) || 1) - 1; return str.substring(0, si) + String(nw || '') + str.substring(si + (Number(n) || 0)); }, desc: 'Замена части строки' },
        'ПОДСТАВИТЬ': { fn: (t, o, nw, i) => { const s = String(t || ''), ov = String(o || ''), nv = String(nw || ''); if (i) { let c = 0; return s.replace(new RegExp(ov.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), m => ++c === Number(i) ? nv : m); } return s.split(ov).join(nv); }, desc: 'Подстановка' },
        'ПОВТОР': { fn: (t, n) => String(t || '').repeat(Number(n) || 0), desc: 'Повтор текста' },
        'ТЕКСТ': { fn: (v, f) => { const n = Number(v); if (isNaN(n)) return String(v || ''); const fmt = String(f || ''); if (fmt.includes('%')) return (n * 100).toFixed(fmt.split('.')[1]?.length || 0) + '%'; if (fmt.includes('.')) return n.toFixed(fmt.split('.')[1]?.replace(/[^0#]/g, '').length || 0); return String(n); }, desc: 'Формат числа как текст' },
        'ЗНАЧЕН': { fn: (t) => { const n = parseFloat(String(t || '').replace(/[^\d.-]/g, '')); return isNaN(n) ? '#VALUE!' : n; }, desc: 'Текст в число' },
        'Т': { fn: (v) => typeof v === 'string' ? v : '', desc: 'Текстовое значение' },
        'Ч': { fn: (v) => { const n = Number(v); return isNaN(n) ? 0 : n; }, desc: 'Числовое значение' },
        'СЕГОДНЯ': { fn: () => Math.floor((new Date() - new Date(1899, 11, 30)) / 86400000), desc: 'Текущая дата' },
        'ТДАТА': { fn: () => (new Date() - new Date(1899, 11, 30)) / 86400000, desc: 'Дата и время' },
        'ГОД': { fn: (d) => new Date(1899, 11, 30 + Number(d)).getFullYear(), desc: 'Год' },
        'МЕСЯЦ': { fn: (d) => new Date(1899, 11, 30 + Number(d)).getMonth() + 1, desc: 'Месяц' },
        'ДЕНЬ': { fn: (d) => new Date(1899, 11, 30 + Number(d)).getDate(), desc: 'День' },
        'ДАТА': { fn: (y, m, d) => Math.floor((new Date(Number(y), Number(m) - 1, Number(d)) - new Date(1899, 11, 30)) / 86400000), desc: 'Дата' },
        'ЧАС': { fn: (t) => Math.floor((Number(t) % 1) * 24), desc: 'Час' },
        'МИНУТЫ': { fn: (t) => Math.floor(((Number(t) % 1) * 24 * 60) % 60), desc: 'Минуты' },
        'СЕКУНДЫ': { fn: (t) => Math.floor(((Number(t) % 1) * 24 * 60 * 60) % 60), desc: 'Секунды' },
        'ДЕНЬНЕД': { fn: (d, r = 1) => { const day = new Date(1899, 11, 30 + Number(d)).getDay(); if (r === 2) return day === 0 ? 7 : day; return day + 1; }, desc: 'День недели' },
        'ЕПУСТО': { fn: (v) => v === null || v === undefined || v === '', desc: 'Пусто?' },
        'ЕЧИСЛО': { fn: (v) => typeof v === 'number' && !isNaN(v), desc: 'Число?' },
        'ЕТЕКСТ': { fn: (v) => typeof v === 'string', desc: 'Текст?' },
        'ЕЛОГИЧ': { fn: (v) => typeof v === 'boolean', desc: 'Логическое?' },
        'ЕОШИБКА': { fn: (v) => v instanceof Error || String(v).startsWith('#'), desc: 'Ошибка?' },
        'НД': { fn: () => '#N/A', desc: 'Ошибка #Н/Д' },
        'ТИП': { fn: (v) => { if (typeof v === 'number') return 1; if (typeof v === 'string') return 2; if (typeof v === 'boolean') return 4; if (String(v).startsWith('#')) return 16; if (Array.isArray(v)) return 64; return 0; }, desc: 'Тип значения' },
      };

      for (const [name, { fn, desc }] of Object.entries(russianFunctions)) {
        try { formulaEngine.registerFunction(name, fn, desc); } catch (e) { /* already registered */ }
      }
    } catch (error) {
      console.warn('Could not register Russian formulas:', error);
    }
  };

  // ─── Univer ↔ Luckysheet conversion ──────────────────────────────────────
  const convertLuckysheetToUniver = (luckysheetData) => {
    try {
      const parsed = typeof luckysheetData === 'string' ? JSON.parse(luckysheetData) : luckysheetData;

      if (parsed && parsed.id && parsed.sheets && !Array.isArray(parsed)) {
        return fixEmptySourceCells(parsed);
      }

      if (!Array.isArray(parsed)) throw new Error('Invalid format');

      const sheets = {};
      parsed.forEach((sheet, index) => {
        const sheetId = sheet.index || `sheet${index}`;
        const cellData = {};

        if (sheet.celldata && Array.isArray(sheet.celldata)) {
          sheet.celldata.forEach(cell => {
            if (!cellData[cell.r]) cellData[cell.r] = {};
            cellData[cell.r][cell.c] = {
              v: cell.v?.v,
              t: cell.v?.ct?.t === 's' ? 1 : cell.v?.ct?.t === 'n' ? 2 : 0,
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
          rowHeader: { width: 46, hidden: 0 },
          columnHeader: { height: 20, hidden: 0 }
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

  // ─── Grouping: apply hidden state from groups on load ────────────────────
  /**
   * After loading data, apply hd:1 flags for collapsed groups so Univer
   * renders hidden rows/cols correctly without issuing commands.
   */
  function applyGroupHiddenToSnapshot(snapshot) {
    if (!snapshot?.sheets) return snapshot;
    for (const [, sheet] of Object.entries(snapshot.sheets)) {
      const rowG = sheet.rowGroupsData || [];
      const colG = sheet.colGroupsData || [];

      // Reset hd for all rows/cols first (snapshot may be stale)
      // Then re-apply per collapsed groups
      // We only set hd:1 for rows/cols that should be hidden.
      // We don't clear existing hd:1 (they could be manually hidden rows).

      for (const g of rowG) {
        if (!g.collapsed) continue;
        if (!sheet.rowData) sheet.rowData = {};
        for (let r = g.start; r <= g.end; r++) {
          sheet.rowData[r] = { ...(sheet.rowData[r] || {}), hd: 1 };
        }
      }
      for (const g of colG) {
        if (!g.collapsed) continue;
        if (!sheet.columnData) sheet.columnData = {};
        for (let c = g.start; c <= g.end; c++) {
          sheet.columnData[c] = { ...(sheet.columnData[c] || {}), hd: 1 };
        }
      }
    }
    return snapshot;
  }

  // ─── Initialize Univer ───────────────────────────────────────────────────
  const initializeUniver = (newContentOverride) => {
    if (!containerRef.current) return;

    if (univerAPIRef.current) {
      try { univerAPIRef.current.dispose(); } catch (e) { /* ignore */ }
      univerAPIRef.current = null;
      workbookRef.current = null;
    }

    const dataToLoad = newContentOverride !== undefined ? newContentOverride : content;
    let workbookData;

    if (dataToLoad && dataToLoad.trim().length > 0) {
      workbookData = convertLuckysheetToUniver(dataToLoad);
    }

    if (!workbookData) {
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
            rowHeader: { width: 46, hidden: 0 },
            columnHeader: { height: 20, hidden: 0 }
          }
        },
        sheetOrder: ['sheet-01']
      };
    }

    // Apply hidden state from groups before loading into Univer
    applyGroupHiddenToSnapshot(workbookData);

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
          UniverSheetsCorePreset({ container: containerRef.current }),
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

      registerRussianFormulas(univerAPI);

      if (readOnly) {
        setTimeout(() => {
          try {
            const perm = workbook.getWorkbookPermission?.();
            if (perm?.setReadOnly) perm.setReadOnly();
          } catch (e) { /* ignore */ }
        }, 500);
      }

      // ── Load groups into state ──
      const { rowGroups: rg, colGroups: cg } = extractGroupsFromSnapshot(workbookData);
      allRowGroupsRef.current = rg;
      allColGroupsRef.current = cg;

      const sheet = workbook.getActiveSheet?.();
      const sheetId = sheet?.getSheetId?.() || Object.keys(workbookData.sheets)[0];
      activeSheetIdRef.current = sheetId;
      setActiveSheetId(sheetId);
      setRowGroups(rg[sheetId] || []);
      setColGroups(cg[sheetId] || []);

      // Load rowData/colData for panels
      const snap = workbook.getSnapshot?.() || workbookData;
      const { rowData: rd, colData: cd } = getSheetMeta(snap, sheetId);
      rowDataRef.current = rd;
      colDataRef.current = cd;
      setRowData(rd);
      setColData(cd);

      // ── Univer event subscriptions ──
      univerAPI.addEvent(univerAPI.Event.CommandExecuted, (command) => {
        // Auto-save (skip view operations)
        if (command?.type !== 1) {
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
          if (!readOnly) saveTimeoutRef.current = setTimeout(() => saveData(), 8000);
          // Update rowData/colData from snapshot on data changes
          try {
            const s = workbookRef.current?.getSnapshot?.();
            const sid = activeSheetIdRef.current;
            if (s && sid) {
              const { rowData: rd2, colData: cd2 } = getSheetMeta(s, sid);
              rowDataRef.current = rd2;
              colDataRef.current = cd2;
              setRowData({ ...rd2 });
              setColData({ ...cd2 });
            }
          } catch (e) { /* ignore */ }
        }

        // Scroll tracking
        if (command?.id === 'sheet.operation.set-scroll') {
          const p = command.params || {};
          setScrollState({
            sheetViewStartRow: p.sheetViewStartRow ?? 0,
            sheetViewStartColumn: p.sheetViewStartColumn ?? 0,
            offsetY: p.offsetY ?? 0,
            offsetX: p.offsetX ?? 0,
          });
        }
      });

      // Sheet switch
      univerAPI.addEvent(univerAPI.Event.ActiveSheetChanged, (params) => {
        const newSheetId = params?.activeSheet?.getSheetId?.();
        if (!newSheetId) return;
        activeSheetIdRef.current = newSheetId;
        setActiveSheetId(newSheetId);
        setRowGroups(allRowGroupsRef.current[newSheetId] || []);
        setColGroups(allColGroupsRef.current[newSheetId] || []);
        // Reset scroll state
        setScrollState({ sheetViewStartRow: 0, sheetViewStartColumn: 0, offsetY: 0, offsetX: 0 });
        // Update rowData/colData
        try {
          const s = workbookRef.current?.getSnapshot?.();
          if (s) {
            const { rowData: rd2, colData: cd2 } = getSheetMeta(s, newSheetId);
            rowDataRef.current = rd2;
            colDataRef.current = cd2;
            setRowData({ ...rd2 });
            setColData({ ...cd2 });
          }
        } catch (e) { /* ignore */ }
      });

      // ── Register grouping items in Univer's native context menu (edit mode only) ──
      if (!readOnly) {
        try {
          univerAPI.createSubmenu({ id: 'alfa-grouping', title: 'Группировка', order: 0 })
            .addSubmenu(
              univerAPI.createMenu({
                id: 'alfa-group-rows',
                title: '↕ Сгруппировать строки',
                action: () => groupActionsRef.current.handleGroupRows?.(),
              })
            )
            .addSubmenu(
              univerAPI.createMenu({
                id: 'alfa-group-cols',
                title: '↔ Сгруппировать столбцы',
                action: () => groupActionsRef.current.handleGroupCols?.(),
              })
            )
            .addSeparator()
            .addSubmenu(
              univerAPI.createMenu({
                id: 'alfa-ungroup-rows',
                title: '✕ Разгруппировать строки',
                action: () => groupActionsRef.current.handleUngroupRows?.(),
              })
            )
            .addSubmenu(
              univerAPI.createMenu({
                id: 'alfa-ungroup-cols',
                title: '✕ Разгруппировать столбцы',
                action: () => groupActionsRef.current.handleUngroupCols?.(),
              })
            )
            .appendTo('contextMenu.others');
        } catch (menuErr) {
          console.warn('Could not register grouping context menu:', menuErr);
        }
      }

      initializedRef.current = true;
      setIsReady(true);
    } catch (error) {
      console.error('❌ Error initializing Univer:', error);
      toast.error('Ошибка инициализации таблицы: ' + error.message);
    }
  };

  useEffect(() => {
    if (initializedRef.current) return;
    let rafId, timerId;
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

  useEffect(() => {
    return () => {
      if (univerAPIRef.current) {
        try { univerAPIRef.current.dispose(); } catch (e) { /* ignore */ }
      }
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      initializedRef.current = false;
      setIsReady(false);
    };
  }, []);

  // ─── Save ────────────────────────────────────────────────────────────────
  const saveData = useCallback(() => {
    if (readOnly) return null;
    try {
      if (!workbookRef.current) return null;
      const snapshot = workbookRef.current.getSnapshot();

      // Inject group data into snapshot before saving
      for (const [sheetId, groups] of Object.entries(allRowGroupsRef.current)) {
        if (snapshot.sheets[sheetId]) snapshot.sheets[sheetId].rowGroupsData = groups;
      }
      for (const [sheetId, groups] of Object.entries(allColGroupsRef.current)) {
        if (snapshot.sheets[sheetId]) snapshot.sheets[sheetId].colGroupsData = groups;
      }

      fixEmptySourceCells(snapshot);

      const jsonData = JSON.stringify(snapshot);
      if (onChangeRef.current) onChangeRef.current(jsonData);
      contentRef.current = jsonData;
      return jsonData;
    } catch (error) {
      console.error('Error saving data:', error);
      toast.error('Ошибка сохранения данных');
      return null;
    }
  }, [readOnly]);

  useImperativeHandle(ref, () => ({
    forceSave: () => new Promise((resolve) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      const saved = saveData();
      setTimeout(() => resolve(saved), 100);
    }),
    getData: () => {
      if (readOnly) return contentRef.current;
      try {
        if (!workbookRef.current) return contentRef.current;
        const snapshot = workbookRef.current.getSnapshot();
        for (const [sid, groups] of Object.entries(allRowGroupsRef.current)) {
          if (snapshot.sheets[sid]) snapshot.sheets[sid].rowGroupsData = groups;
        }
        for (const [sid, groups] of Object.entries(allColGroupsRef.current)) {
          if (snapshot.sheets[sid]) snapshot.sheets[sid].colGroupsData = groups;
        }
        return JSON.stringify(snapshot);
      } catch (e) {
        return contentRef.current;
      }
    }
  }), [readOnly, saveData]);

  // ─── Navigation ──────────────────────────────────────────────────────────
  const scrollToRow = useCallback((row) => {
    if (!univerAPIRef.current) return;
    univerAPIRef.current.executeCommand('sheet.command.scroll-to-cell', {
      range: { startRow: row, endRow: row, startColumn: 0, endColumn: 0 },
      forceTop: true, forceLeft: true
    });
  }, []);

  const navigateToTop = useCallback(() => { if (isReady) scrollToRow(0); }, [isReady, scrollToRow]);

  const navigateToBottom = useCallback(() => {
    if (!isReady || !workbookRef.current) return;
    try {
      const sheet = workbookRef.current.getActiveSheet?.();
      let lastRow = 0;
      if (typeof sheet?.getLastRow === 'function') {
        lastRow = sheet.getLastRow();
      } else {
        const snap = workbookRef.current.getSnapshot();
        const sid = sheet?.getSheetId?.();
        const cd = (sid ? snap?.sheets?.[sid] : Object.values(snap?.sheets || {})[0])?.cellData || {};
        const rows = Object.keys(cd).map(Number).filter(r => !isNaN(r) && Object.keys(cd[r] || {}).length > 0);
        if (rows.length) lastRow = Math.max(...rows);
      }
      scrollToRow(lastRow);
    } catch (e) { /* ignore */ }
  }, [isReady, scrollToRow]);

  // ─── Grouping operations ──────────────────────────────────────────────────

  /** Get current selection range from Univer */
  const getSelection = useCallback(() => {
    try {
      const workbook = workbookRef.current;
      if (!workbook) return null;
      const sheet = workbook.getActiveSheet?.();
      if (!sheet) return null;
      const sel = sheet.getSelection?.();
      if (!sel) return null;
      const range = sel.getActiveRange?.();
      if (!range) return null;
      return {
        startRow: range.getRow?.() ?? 0,
        endRow: range.getLastRow?.() ?? 0,
        startColumn: range.getColumn?.() ?? 0,
        endColumn: range.getLastColumn?.() ?? 0,
      };
    } catch (e) {
      return null;
    }
  }, []);

  /** Execute Univer command to hide a range of rows */
  const hideRows = useCallback(async (start, end) => {
    if (!univerAPIRef.current || !workbookRef.current) return;
    const workbook = workbookRef.current;
    const sheet = workbook.getActiveSheet?.();
    if (!sheet) return;
    try {
      await univerAPIRef.current.executeCommand('sheet.command.set-rows-hidden', {
        unitId: workbook.getId?.(),
        subUnitId: sheet.getSheetId?.(),
        ranges: [{ startRow: start, endRow: end, startColumn: 0, endColumn: 9999 }]
      });
    } catch (e) {
      console.warn('set-rows-hidden failed:', e);
    }
  }, []);

  /** Execute Univer command to show a range of rows */
  const showRows = useCallback(async (start, end) => {
    if (!univerAPIRef.current || !workbookRef.current) return;
    const workbook = workbookRef.current;
    const sheet = workbook.getActiveSheet?.();
    if (!sheet) return;
    try {
      await univerAPIRef.current.executeCommand('sheet.command.set-specific-rows-visible', {
        unitId: workbook.getId?.(),
        subUnitId: sheet.getSheetId?.(),
        ranges: [{ startRow: start, endRow: end, startColumn: 0, endColumn: 9999 }]
      });
    } catch (e) {
      console.warn('set-specific-rows-visible failed:', e);
    }
  }, []);

  /** Execute Univer command to hide a range of columns */
  const hideCols = useCallback(async (start, end) => {
    if (!univerAPIRef.current || !workbookRef.current) return;
    const workbook = workbookRef.current;
    const sheet = workbook.getActiveSheet?.();
    if (!sheet) return;
    try {
      await univerAPIRef.current.executeCommand('sheet.command.set-col-hidden', {
        unitId: workbook.getId?.(),
        subUnitId: sheet.getSheetId?.(),
        ranges: [{ startRow: 0, endRow: 9999, startColumn: start, endColumn: end }]
      });
    } catch (e) {
      console.warn('set-col-hidden failed:', e);
    }
  }, []);

  /** Execute Univer command to show a range of columns */
  const showCols = useCallback(async (start, end) => {
    if (!univerAPIRef.current || !workbookRef.current) return;
    const workbook = workbookRef.current;
    const sheet = workbook.getActiveSheet?.();
    if (!sheet) return;
    try {
      await univerAPIRef.current.executeCommand('sheet.command.set-col-visible-on-cols', {
        unitId: workbook.getId?.(),
        subUnitId: sheet.getSheetId?.(),
        ranges: [{ startRow: 0, endRow: 9999, startColumn: start, endColumn: end }]
      });
    } catch (e) {
      console.warn('set-col-visible-on-cols failed:', e);
    }
  }, []);

  /** Save updated groups to all-groups refs and trigger debounced save */
  const persistGroups = useCallback((newRowGroups, newColGroups, sheetId) => {
    const sid = sheetId || activeSheetIdRef.current;
    if (!sid) return;

    const updatedRG = { ...allRowGroupsRef.current };
    const updatedCG = { ...allColGroupsRef.current };

    if (newRowGroups !== undefined) {
      if (newRowGroups.length > 0) updatedRG[sid] = newRowGroups;
      else delete updatedRG[sid];
    }
    if (newColGroups !== undefined) {
      if (newColGroups.length > 0) updatedCG[sid] = newColGroups;
      else delete updatedCG[sid];
    }

    allRowGroupsRef.current = updatedRG;
    allColGroupsRef.current = updatedCG;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveData(), 2000);
  }, [saveData]);

  /** Group selected rows */
  const handleGroupRows = useCallback(() => {
    const sel = getSelection();
    if (!sel) { toast.error('Выберите строки для группировки'); return; }
    const { startRow, endRow } = sel;
    if (startRow === endRow && startRow === 0) { toast.error('Выберите несколько строк'); return; }

    const level = findNewGroupLevel(rowGroups, startRow, endRow);
    const newGroup = { start: startRow, end: endRow, level, collapsed: false };
    const newGroups = [...rowGroups, newGroup].sort((a, b) => a.level - b.level || a.start - b.start);

    setRowGroups(newGroups);
    persistGroups(newGroups, undefined);
    toast.success(`Строки ${startRow + 1}–${endRow + 1} сгруппированы (уровень ${level})`);
  }, [rowGroups, getSelection, persistGroups]);

  /** Group selected columns */
  const handleGroupCols = useCallback(() => {
    const sel = getSelection();
    if (!sel) { toast.error('Выберите столбцы для группировки'); return; }
    const { startColumn, endColumn } = sel;

    const level = findNewGroupLevel(colGroups, startColumn, endColumn);
    const newGroup = { start: startColumn, end: endColumn, level, collapsed: false };
    const newGroups = [...colGroups, newGroup].sort((a, b) => a.level - b.level || a.start - b.start);

    setColGroups(newGroups);
    persistGroups(undefined, newGroups);
    toast.success(`Столбцы сгруппированы (уровень ${level})`);
  }, [colGroups, getSelection, persistGroups]);

  /** Remove grouping for selected rows */
  const handleUngroupRows = useCallback(async () => {
    const sel = getSelection();
    if (!sel) { toast.error('Выберите строки для разгруппировки'); return; }
    const { startRow, endRow } = sel;

    // Remove groups that exactly match or are fully contained in selection
    const removedGroups = rowGroups.filter(g => g.start >= startRow && g.end <= endRow);
    const newGroups = rowGroups.filter(g => !(g.start >= startRow && g.end <= endRow));

    // Show rows hidden by removed groups (if no other group hides them)
    for (const g of removedGroups) {
      if (g.collapsed) {
        await showRows(g.start, g.end);
        // Re-collapse any remaining groups that still hide rows in this range
        for (const other of newGroups) {
          if (other.collapsed && other.start >= g.start && other.end <= g.end) {
            await hideRows(other.start, other.end);
          }
        }
      }
    }

    setRowGroups(newGroups);
    persistGroups(newGroups, undefined);
    toast.success('Группировка строк удалена');
  }, [rowGroups, getSelection, persistGroups, showRows, hideRows]);

  /** Remove grouping for selected columns */
  const handleUngroupCols = useCallback(async () => {
    const sel = getSelection();
    if (!sel) { toast.error('Выберите столбцы для разгруппировки'); return; }
    const { startColumn, endColumn } = sel;

    const removedGroups = colGroups.filter(g => g.start >= startColumn && g.end <= endColumn);
    const newGroups = colGroups.filter(g => !(g.start >= startColumn && g.end <= endColumn));

    for (const g of removedGroups) {
      if (g.collapsed) {
        await showCols(g.start, g.end);
        for (const other of newGroups) {
          if (other.collapsed && other.start >= g.start && other.end <= g.end) {
            await hideCols(other.start, other.end);
          }
        }
      }
    }

    setColGroups(newGroups);
    persistGroups(undefined, newGroups);
    toast.success('Группировка столбцов удалена');
  }, [colGroups, getSelection, persistGroups, showCols, hideCols]);

  /** Toggle collapse/expand of a row group */
  const handleToggleRowGroup = useCallback(async (groupIndex) => {
    const group = rowGroups[groupIndex];
    if (!group) return;
    const newCollapsed = !group.collapsed;

    if (newCollapsed) {
      await hideRows(group.start, group.end);
    } else {
      await showRows(group.start, group.end);
      // Re-collapse any nested groups that should stay collapsed
      for (const other of rowGroups) {
        if (other !== group && other.collapsed &&
            other.start >= group.start && other.end <= group.end) {
          await hideRows(other.start, other.end);
        }
      }
    }

    const newGroups = rowGroups.map((g, i) => i === groupIndex ? { ...g, collapsed: newCollapsed } : g);
    setRowGroups(newGroups);
    persistGroups(newGroups, undefined);

    // Update rowData after hide/show
    setTimeout(() => {
      try {
        const s = workbookRef.current?.getSnapshot?.();
        const sid = activeSheetIdRef.current;
        if (s && sid) {
          const { rowData: rd } = getSheetMeta(s, sid);
          rowDataRef.current = rd;
          setRowData({ ...rd });
        }
      } catch (e) { /* ignore */ }
    }, 100);
  }, [rowGroups, hideRows, showRows, persistGroups]);

  /** Toggle collapse/expand of a column group */
  const handleToggleColGroup = useCallback(async (groupIndex) => {
    const group = colGroups[groupIndex];
    if (!group) return;
    const newCollapsed = !group.collapsed;

    if (newCollapsed) {
      await hideCols(group.start, group.end);
    } else {
      await showCols(group.start, group.end);
      for (const other of colGroups) {
        if (other !== group && other.collapsed &&
            other.start >= group.start && other.end <= group.end) {
          await hideCols(other.start, other.end);
        }
      }
    }

    const newGroups = colGroups.map((g, i) => i === groupIndex ? { ...g, collapsed: newCollapsed } : g);
    setColGroups(newGroups);
    persistGroups(undefined, newGroups);

    setTimeout(() => {
      try {
        const s = workbookRef.current?.getSnapshot?.();
        const sid = activeSheetIdRef.current;
        if (s && sid) {
          const { colData: cd } = getSheetMeta(s, sid);
          colDataRef.current = cd;
          setColData({ ...cd });
        }
      } catch (e) { /* ignore */ }
    }, 100);
  }, [colGroups, hideCols, showCols, persistGroups]);

  /**
   * Collapse/expand to a target level (like Excel's 1/2/3 buttons).
   * Clicking level N: expand all levels < N, collapse all levels >= N.
   * (In our model, smaller level number = outer group)
   */
  const handleLevelClick = useCallback(async (targetLevel, axis) => {
    const groups = axis === 'row' ? rowGroups : colGroups;
    const updatedGroups = [...groups];

    for (let i = 0; i < updatedGroups.length; i++) {
      const g = updatedGroups[i];
      const shouldCollapse = g.level >= targetLevel;
      if (g.collapsed === shouldCollapse) continue;

      updatedGroups[i] = { ...g, collapsed: shouldCollapse };
      if (shouldCollapse) {
        if (axis === 'row') await hideRows(g.start, g.end);
        else await hideCols(g.start, g.end);
      } else {
        if (axis === 'row') await showRows(g.start, g.end);
        else await showCols(g.start, g.end);
      }
    }

    // Re-collapse groups that should stay hidden (nested within still-collapsed parents)
    for (let i = 0; i < updatedGroups.length; i++) {
      const g = updatedGroups[i];
      if (!g.collapsed) continue;
      for (let j = 0; j < updatedGroups.length; j++) {
        if (i === j) continue;
        const other = updatedGroups[j];
        if (!other.collapsed && other.start >= g.start && other.end <= g.end) {
          // nested group inside an expanded parent — leave as collapsed
        }
      }
    }

    if (axis === 'row') {
      setRowGroups(updatedGroups);
      persistGroups(updatedGroups, undefined);
      setTimeout(() => {
        try {
          const s = workbookRef.current?.getSnapshot?.();
          const sid = activeSheetIdRef.current;
          if (s && sid) { const { rowData: rd } = getSheetMeta(s, sid); rowDataRef.current = rd; setRowData({ ...rd }); }
        } catch (e) { /* ignore */ }
      }, 150);
    } else {
      setColGroups(updatedGroups);
      persistGroups(undefined, updatedGroups);
      setTimeout(() => {
        try {
          const s = workbookRef.current?.getSnapshot?.();
          const sid = activeSheetIdRef.current;
          if (s && sid) { const { colData: cd } = getSheetMeta(s, sid); colDataRef.current = cd; setColData({ ...cd }); }
        } catch (e) { /* ignore */ }
      }, 150);
    }
  }, [rowGroups, colGroups, hideRows, showRows, hideCols, showCols, persistGroups]);

  // Keep groupActionsRef in sync so Univer's registered menu items always call the current handlers
  useEffect(() => {
    groupActionsRef.current = { handleGroupRows, handleGroupCols, handleUngroupRows, handleUngroupCols };
  }, [handleGroupRows, handleGroupCols, handleUngroupRows, handleUngroupCols]);

  // ─── Import / Export ──────────────────────────────────────────────────────
  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast.error('Поддерживаются только файлы Excel (.xlsx, .xls)'); return;
    }
    if (!pageId) { toast.error('Сначала сохраните страницу'); return; }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await pages.importXlsx(pageId, formData);
      const newContent = JSON.stringify(data.data);
      onChange?.(newContent);
      toast.success('Файл импортирован');
      contentRef.current = newContent;
      initializedRef.current = false;
      setIsReady(false);
      initializeUniver(newContent);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка импорта файла');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExport = async () => {
    if (!pageId) { toast.error('Сначала сохраните страницу'); return; }
    setExporting(true);
    try {
      saveData();
      await new Promise(r => setTimeout(r, 500));
      const response = await pages.exportXlsx(pageId);
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `spreadsheet_${Date.now()}.xlsx`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('Файл экспортирован');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка экспорта файла');
    } finally {
      setExporting(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const hasRowGroups = rowGroups.length > 0;
  const hasColGroups = colGroups.length > 0;
  const maxRowLevel = hasRowGroups ? Math.max(...rowGroups.map(g => g.level)) : 0;
  const maxColLevel = hasColGroups ? Math.max(...colGroups.map(g => g.level)) : 0;
  const rowPanelWidth = maxRowLevel * GROUP_LEVEL_WIDTH;
  const colPanelHeight = maxColLevel * GROUP_LEVEL_HEIGHT;

  const outerHeight = fullHeight ? '100%' : (readOnly ? '700px' : 'calc(100vh - 300px)');
  const outerMinHeight = fullHeight ? '0' : '500px';

  return (
    <div className="spreadsheet-editor">
      {!readOnly && (
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden onChange={handleFileImport} />
      )}

      {/*
        Outer flex-column wrapper — replaces the old single "univer-container" div.
        Row group panel sits LEFT of Univer; col group panel sits ABOVE.
        Univer fills remaining flex space and auto-resizes via internal ResizeObserver.
      */}
      <div
        className={readOnly ? 'univer-container readonly' : 'univer-container'}
        style={{
          width: '100%',
          height: outerHeight,
          minHeight: outerMinHeight,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        {/* ── Col group panel row (top) ── */}
        {hasColGroups && isReady && (
          <div style={{ display: 'flex', flexShrink: 0 }}>
            {/* Corner: aligns with row-group-panel + Univer row header */}
            {hasRowGroups && (
              <div
                className="sg-corner"
                style={{ width: rowPanelWidth, height: colPanelHeight, flexShrink: 0 }}
              />
            )}
            <ColGroupPanel
              groups={colGroups}
              scrollState={scrollState}
              colData={colData}
              panelWidth="100%"
              onToggle={handleToggleColGroup}
              onLevelClick={handleLevelClick}
            />
          </div>
        )}

        {/* ── Main row: [row group panel] + [Univer] ── */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Row group panel */}
          {hasRowGroups && isReady && (
            <RowGroupPanel
              groups={rowGroups}
              scrollState={scrollState}
              rowData={rowData}
              panelHeight={containerSize.h - (hasColGroups ? colPanelHeight : 0) || 600}
              onToggle={handleToggleRowGroup}
              onLevelClick={handleLevelClick}
            />
          )}

          {/* Univer canvas wrapper */}
          <div
            style={{ flex: 1, position: 'relative', minWidth: 0 }}
          >
            <div
              ref={containerRef}
              style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
            />

            {/* Import/Export buttons */}
            {!readOnly && (
              <div className="spreadsheet-io-buttons">
                <button className="spreadsheet-io-btn" onClick={handleImportClick} disabled={uploading} title="Импорт Excel (.xlsx)">
                  {uploading ? <div className="loading-spinner-small" /> : <Upload size={13} />}
                  Импорт
                </button>
                <button className="spreadsheet-io-btn" onClick={handleExport} disabled={exporting} title="Экспорт в Excel">
                  {exporting ? <div className="loading-spinner-small" /> : <Download size={13} />}
                  Экспорт
                </button>
              </div>
            )}

            {/* Navigation buttons */}
            {isReady && (
              <div className="spreadsheet-nav-buttons">
                <button className="spreadsheet-nav-btn" onClick={navigateToTop} title="В начало">
                  <ArrowUp size={13} />
                </button>
                <button className="spreadsheet-nav-btn" onClick={navigateToBottom} title="К последней записи">
                  <ArrowDown size={13} />
                </button>
              </div>
            )}

            {/* Loading overlay */}
            {!isReady && (
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--n-0)', zIndex: 1000, pointerEvents: 'none'
              }}>
                <div style={{ textAlign: 'center', color: 'var(--n-600)', pointerEvents: 'auto' }}>
                  <div className="loading-spinner-small" style={{ margin: '0 auto 16px', width: '32px', height: '32px' }} />
                  <p>Загрузка таблицы...</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

SpreadsheetEditor.displayName = 'SpreadsheetEditor';
export default SpreadsheetEditor;
