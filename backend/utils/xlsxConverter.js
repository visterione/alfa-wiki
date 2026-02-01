const XLSX = require('xlsx');

/**
 * Конвертирует Excel Workbook в формат Univer
 * @param {Object} workbook - XLSX workbook объект
 * @returns {Object} Объект в формате IWorkbookData для Univer
 */
function convertXlsxToUniver(workbook) {
  const sheets = {};
  const sheetOrder = [];

  workbook.SheetNames.forEach((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

    const sheetId = `sheet-${index}`;
    sheetOrder.push(sheetId);

    // Создаем объект cellData для Univer (двумерная матрица)
    const cellData = {};

    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = worksheet[cellAddress];

        if (cell) {
          // Инициализируем строку если не существует
          if (!cellData[row]) {
            cellData[row] = {};
          }

          // Определяем тип ячейки Univer
          // 0 = general, 1 = string, 2 = number, 3 = boolean, 4 = error
          let cellType = 0; // general
          if (cell.t === 's') cellType = 1; // string
          else if (cell.t === 'n') cellType = 2; // number
          else if (cell.t === 'b') cellType = 3; // boolean
          else if (cell.t === 'e') cellType = 4; // error

          // Формат ячейки Univer
          const univerCell = {
            v: cell.v, // значение
            t: cellType // тип
          };

          // Добавляем формулу если есть
          if (cell.f) {
            univerCell.f = cell.f;
          }

          cellData[row][col] = univerCell;
        }
      }
    }

    // Лист в формате Univer
    sheets[sheetId] = {
      id: sheetId,
      name: sheetName,
      tabColor: '',
      hidden: 0,
      rowCount: Math.max(range.e.r + 1, 1000),
      columnCount: Math.max(range.e.c + 1, 26),
      zoomRatio: 1,
      scrollTop: 0,
      scrollLeft: 0,
      defaultColumnWidth: 88,
      defaultRowHeight: 24,
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

  // Возвращаем полную структуру IWorkbookData
  return {
    id: 'workbook',
    name: workbook.Props?.Title || 'Workbook',
    appVersion: '0.1.0',
    locale: 'ru-RU',
    styles: {},
    sheets,
    sheetOrder
  };
}

/**
 * Конвертирует Univer данные в Excel Workbook
 * @param {Object} univerData - Объект в формате IWorkbookData
 * @returns {Object} XLSX workbook объект
 */
function convertUniverToXlsx(univerData) {
  const workbook = XLSX.utils.book_new();

  // Устанавливаем метаданные
  if (univerData.name) {
    workbook.Props = {
      Title: univerData.name
    };
  }

  // Используем sheetOrder для правильного порядка листов
  const sheetOrder = univerData.sheetOrder || Object.keys(univerData.sheets || {});

  sheetOrder.forEach(sheetId => {
    const sheet = univerData.sheets[sheetId];
    if (!sheet) return;

    // Определяем размер листа
    const maxRow = sheet.rowCount || 1000;
    const maxCol = sheet.columnCount || 26;

    // Создаем пустой лист
    const worksheet = {};
    const range = { s: { r: maxRow, c: maxCol }, e: { r: 0, c: 0 } };

    // Заполняем данными из cellData
    if (sheet.cellData && typeof sheet.cellData === 'object') {
      Object.keys(sheet.cellData).forEach(rowKey => {
        const row = parseInt(rowKey);
        const rowData = sheet.cellData[rowKey];

        if (typeof rowData === 'object') {
          Object.keys(rowData).forEach(colKey => {
            const col = parseInt(colKey);
            const cell = rowData[colKey];

            if (!cell) return;

            const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });

            // Обновляем range
            if (row < range.s.r) range.s.r = row;
            if (row > range.e.r) range.e.r = row;
            if (col < range.s.c) range.s.c = col;
            if (col > range.e.c) range.e.c = col;

            // Создаем ячейку Excel
            const excelCell = {
              v: cell.v
            };

            // Определяем тип ячейки
            // Univer: 0 = general, 1 = string, 2 = number, 3 = boolean, 4 = error
            if (cell.t === 1) {
              excelCell.t = 's'; // string
            } else if (cell.t === 2) {
              excelCell.t = 'n'; // number
            } else if (cell.t === 3) {
              excelCell.t = 'b'; // boolean
            } else if (cell.t === 4) {
              excelCell.t = 'e'; // error
            } else {
              // Определяем тип по значению
              if (typeof cell.v === 'number') {
                excelCell.t = 'n';
              } else if (typeof cell.v === 'string') {
                excelCell.t = 's';
              } else if (typeof cell.v === 'boolean') {
                excelCell.t = 'b';
              } else {
                excelCell.t = 's';
              }
            }

            // Формула
            if (cell.f) {
              excelCell.f = cell.f;
            }

            worksheet[cellAddress] = excelCell;
          });
        }
      });
    }

    // Если лист пустой, устанавливаем минимальный range
    if (range.s.r > range.e.r || range.s.c > range.e.c) {
      range.s = { r: 0, c: 0 };
      range.e = { r: 0, c: 0 };
    }

    worksheet['!ref'] = XLSX.utils.encode_range(range);

    // Добавляем лист в workbook
    const sheetName = sheet.name || `Sheet${workbook.SheetNames.length + 1}`;
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  });

  return workbook;
}

module.exports = {
  convertXlsxToUniver,
  convertUniverToXlsx
};
