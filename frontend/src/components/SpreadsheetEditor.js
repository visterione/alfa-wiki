import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Upload, Download } from 'lucide-react';
import { pages } from '../services/api';
import toast from 'react-hot-toast';
import './SpreadsheetEditor.css';

// Luckysheet загружается как UMD модуль через <script> в index.html
// Доступен как window.luckysheet
// jQuery предоставляется глобально через webpack ProvidePlugin

const SpreadsheetEditor = forwardRef(({
  content,
  onChange,
  pageId,
  readOnly = false
}, ref) => {
  const containerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const [initialized, setInitialized] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [isLuckysheetReady, setIsLuckysheetReady] = useState(false);
  const fileInputRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  // Обновляем ref при изменении onChange
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Ожидание загрузки Luckysheet
  useEffect(() => {
    const checkLuckysheet = () => {
      console.log('Checking Luckysheet:', {
        luckysheet: !!window.luckysheet,
        create: typeof window.luckysheet?.create,
        jQuery: !!window.$
      });

      if (window.luckysheet && typeof window.luckysheet.create === 'function') {
        console.log('✅ Luckysheet loaded successfully');
        setIsLuckysheetReady(true);
        return true;
      }
      return false;
    };

    if (checkLuckysheet()) {
      return;
    }

    // Проверяем каждые 200ms до 10 секунд
    let attempts = 0;
    const maxAttempts = 50;
    const interval = setInterval(() => {
      attempts++;
      if (checkLuckysheet()) {
        clearInterval(interval);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        console.error('❌ Luckysheet failed to load. State:', {
          luckysheet: window.luckysheet,
          jQuery: window.$,
          attempts
        });
        toast.error('Не удалось загрузить таблицу. Проверьте консоль и обновите страницу.');
      }
    }, 200);

    return () => clearInterval(interval);
  }, []);

  // Инициализация Luckysheet
  useEffect(() => {
    if (!containerRef.current || initialized || !isLuckysheetReady) return;

    let data;
    try {
      data = content ? JSON.parse(content) : [
        {
          name: 'Sheet1',
          index: '0',
          status: '1',
          order: '0',
          celldata: [],
          row: 84,
          column: 60,
          config: {},
          scrollLeft: 0,
          scrollTop: 0,
          zoomRatio: 1
        }
      ];
    } catch (error) {
      console.error('Error parsing content:', error);
      data = [
        {
          name: 'Sheet1',
          index: '0',
          status: '1',
          order: '0',
          celldata: [],
          row: 84,
          column: 60,
          config: {},
          scrollLeft: 0,
          scrollTop: 0,
          zoomRatio: 1
        }
      ];
    }

    try {
      const options = {
        container: 'luckysheet-container',
        data,
        title: 'Таблица',
        lang: 'en',
        showtoolbar: !readOnly,
        showinfobar: false,
        showsheetbar: true,
        showstatisticBar: false,
        enableAddRow: !readOnly,
        enableAddCol: !readOnly,
        userInfo: false,
        showConfigWindowResize: false,
        forceCalculation: false,
        allowEdit: !readOnly,
        showtoolbarConfig: {
          undoRedo: true,
          paintFormat: true,
          font: true,
          fontSize: true,
          bold: true,
          italic: true,
          strikethrough: true,
          underline: true,
          textColor: true,
          fillColor: true,
          border: true,
          mergeCell: true,
          horizontalAlignMode: true,
          verticalAlignMode: true,
          textWrapMode: true
        },
        hook: {
          cellUpdated: function(r, c, oldValue, newValue, isRefresh) {
            if (!readOnly && !isRefresh) {
              // Сохраняем изменения с задержкой
              if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
              }
              saveTimeoutRef.current = setTimeout(() => {
                saveData();
              }, 2000);
            }
          }
        }
      };

      window.luckysheet.create(options);
      setInitialized(true);
    } catch (error) {
      console.error('Error initializing Luckysheet:', error);
      toast.error('Ошибка инициализации таблицы');
    }

    return () => {
      // Очистка при размонтировании
      try {
        if (window.luckysheet) {
          window.luckysheet.destroy();
        }
      } catch (error) {
        console.error('Error destroying Luckysheet:', error);
      }

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      setInitialized(false);
    };
  }, [content, readOnly, isLuckysheetReady]);

  // Функция сохранения данных
  const saveData = () => {
    if (readOnly) return;

    try {
      const allSheets = window.luckysheet.getAllSheets();
      const jsonData = JSON.stringify(allSheets);
      onChangeRef.current?.(jsonData);
    } catch (error) {
      console.error('Error saving data:', error);
      toast.error('Ошибка сохранения данных');
    }
  };

  // Экспозиция метода для принудительного сохранения (вызывается из PageEditor)
  useImperativeHandle(ref, () => ({
    forceSave: () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveData();
    }
  }), [readOnly]);

  // Пересчет размеров после инициализации
  useEffect(() => {
    if (!initialized || !window.luckysheet) return;

    // Для режима просмотра нужна большая задержка чтобы DOM успел отрендериться
    const delay = readOnly ? 500 : 300;

    const timer = setTimeout(() => {
      try {
        window.luckysheet.resize();
        console.log('Luckysheet resized (readOnly:', readOnly, ')');

        // Дополнительный resize для режима просмотра
        if (readOnly) {
          setTimeout(() => {
            try {
              window.luckysheet.resize();
              console.log('Luckysheet double resized for readonly mode');
            } catch (error) {
              console.error('Error in double resize:', error);
            }
          }, 200);
        }
      } catch (error) {
        console.error('Error resizing Luckysheet:', error);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [initialized, readOnly]);

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

      // Перезагружаем Luckysheet с новыми данными
      if (window.luckysheet) {
        window.luckysheet.destroy();
      }
      setInitialized(false);

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

  // Показываем индикатор загрузки пока Luckysheet не загружен
  if (!isLuckysheetReady) {
    return (
      <div className="spreadsheet-editor">
        <div style={{
          padding: '40px',
          textAlign: 'center',
          color: '#666'
        }}>
          <div className="loading-spinner-small" style={{
            margin: '0 auto 16px',
            width: '32px',
            height: '32px'
          }} />
          <p>Загрузка таблицы...</p>
        </div>
      </div>
    );
  }

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
        id="luckysheet-container"
        ref={containerRef}
        className={readOnly ? 'readonly' : ''}
        style={{
          width: '100%',
          height: readOnly ? '700px' : 'calc(100vh - 300px)',
          minHeight: '500px'
        }}
      />
    </div>
  );
});

SpreadsheetEditor.displayName = 'SpreadsheetEditor';

export default SpreadsheetEditor;