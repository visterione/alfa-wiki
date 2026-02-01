import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Upload, Download } from 'lucide-react';
import { pages } from '../services/api';
import toast from 'react-hot-toast';
import './SpreadsheetEditor.css';

// Univer imports
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverPresetSheetsCoreRuRU from '@univerjs/preset-sheets-core/locales/ru-RU';

// Univer styles
import '@univerjs/preset-sheets-core/lib/index.css';

const SpreadsheetEditor = forwardRef(({
  content,
  onChange,
  pageId,
  readOnly = false
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

  // Конвертация данных Luckysheet → Univer (для обратной совместимости)
  const convertLuckysheetToUniver = (luckysheetData) => {
    try {
      const parsed = typeof luckysheetData === 'string'
        ? JSON.parse(luckysheetData)
        : luckysheetData;

      // Проверяем, это уже Univer формат?
      if (parsed && parsed.id && parsed.sheets && !Array.isArray(parsed)) {
        return parsed;
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

      return {
        id: 'workbook',
        name: 'Workbook',
        appVersion: '0.1.0',
        locale: LocaleType.RU_RU,
        styles: {},
        sheets,
        sheetOrder: Object.keys(sheets)
      };
    } catch (error) {
      console.error('Error converting Luckysheet to Univer:', error);
      return null;
    }
  };

  // Инициализация Univer
  const initializeUniver = () => {
    console.log('initializeUniver() called');

    if (!containerRef.current) {
      console.error('Container not found');
      return;
    }

    // Очистка предыдущего экземпляра
    if (univerAPIRef.current) {
      try {
        console.log('Disposing previous Univer instance...');
        univerAPIRef.current.dispose();
      } catch (error) {
        console.warn('Error disposing previous instance:', error);
      }
      univerAPIRef.current = null;
      workbookRef.current = null;
    }

    // Подготовка данных
    let workbookData;

    if (content && content.trim().length > 0) {
      workbookData = convertLuckysheetToUniver(content);
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
      console.log('Creating Univer instance with locale:', LocaleType.RU_RU);
      console.log('Workbook data:', workbookData);

      const { univerAPI } = createUniver({
        locale: LocaleType.RU_RU,
        locales: {
          [LocaleType.RU_RU]: mergeLocales(
            UniverPresetSheetsCoreRuRU
          )
        },
        presets: [
          UniverSheetsCorePreset({
            container: containerRef.current
          })
        ]
      });

      console.log('✅ createUniver completed');
      univerAPIRef.current = univerAPI;

      // Создаем workbook с данными
      console.log('Creating workbook...');
      const workbook = univerAPI.createUniverSheet(workbookData);
      workbookRef.current = workbook;

      console.log('✅ Univer instance and workbook created successfully');

      // Настройка read-only режима
      if (readOnly) {
        setTimeout(() => {
          try {
            const permission = workbook.getWorkbookPermission();
            if (permission && permission.setReadOnly) {
              permission.setReadOnly();
              console.log('✅ Read-only mode enabled');
            }
          } catch (err) {
            console.warn('Could not set read-only mode:', err);
          }
        }, 500);
      }

      // Подписка на изменения (для автосохранения)
      if (!readOnly) {
        univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => {
          if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
          }
          saveTimeoutRef.current = setTimeout(() => {
            saveData();
          }, 2000);
        });
      }

      initializedRef.current = true;
      setIsReady(true);
      console.log('=== Univer initialization complete ===');

    } catch (error) {
      console.error('❌ Error initializing Univer:', error);
      toast.error('Ошибка инициализации таблицы: ' + error.message);
    }
  };

  // Инициализация при монтировании
  useEffect(() => {
    if (initializedRef.current) {
      console.log('Already initialized, skipping');
      return;
    }

    console.log('=== Starting Univer initialization ===');
    console.log('readOnly:', readOnly);
    console.log('content length:', content?.length);

    // Используем requestAnimationFrame для гарантии что DOM полностью отрендерился
    let rafId;
    let timerId;

    rafId = requestAnimationFrame(() => {
      timerId = setTimeout(() => {
        console.log('After RAF: containerRef.current exists:', !!containerRef.current);
        if (!containerRef.current) {
          console.error('⚠️ Container not found after RAF!');
          return;
        }
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
      console.log('⚠️ COMPONENT UNMOUNTING - Cleaning up Univer...');
      console.trace('Unmount stack trace');
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
      if (!workbookRef.current) {
        console.error('Workbook not initialized');
        return null;
      }

      const snapshot = workbookRef.current.getSnapshot();
      console.log('saveData: Got snapshot from Univer');

      const jsonData = JSON.stringify(snapshot);
      console.log('saveData: JSON length:', jsonData?.length);

      if (onChangeRef.current) {
        console.log('saveData: Calling onChange callback');
        onChangeRef.current(jsonData);
      } else {
        console.warn('saveData: onChange callback is not defined');
      }

      contentRef.current = jsonData;
      console.log('saveData: Updated contentRef');

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

      // Обновляем content
      onChange?.(JSON.stringify(data.data));

      toast.success('Файл импортирован');

      // Перезагрузка страницы для применения изменений
      setTimeout(() => window.location.reload(), 1000);
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
        <div className="spreadsheet-toolbar">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleImportClick}
            disabled={uploading}
            title="Импорт Excel файла"
          >
            {uploading ? (
              <div className="loading-spinner-small" />
            ) : (
              <Upload size={16} />
            )}
            Импорт Excel
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            hidden
            onChange={handleFileImport}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExport}
            disabled={exporting}
            title="Экспорт в Excel"
          >
            {exporting ? (
              <div className="loading-spinner-small" />
            ) : (
              <Download size={16} />
            )}
            Экспорт Excel
          </button>
        </div>
      )}
      <div
        className={readOnly ? 'univer-container readonly' : 'univer-container'}
        style={{
          width: '100%',
          height: readOnly ? '700px' : 'calc(100vh - 300px)',
          minHeight: '500px',
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
