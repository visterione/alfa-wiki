const XLSX = require('xlsx');

/**
 * Конвертирует Excel Workbook в формат Luckysheet
 * @param {Object} workbook - XLSX workbook объект
 * @returns {Array} Массив листов в формате Luckysheet
 */
function convertXlsxToLuckysheet(workbook) {
  const luckysheetData = [];

  workbook.SheetNames.forEach((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

    // Создаем массив celldata для Luckysheet
    const celldata = [];

    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = worksheet[cellAddress];

        if (cell) {
          // Определяем тип ячейки
          let cellType = 'g'; // general
          if (cell.t === 's') cellType = 's'; // string
          else if (cell.t === 'n') cellType = 'n'; // number
          else if (cell.t === 'b') cellType = 'b'; // boolean
          else if (cell.t === 'd') cellType = 'd'; // date

          // Формат ячейки Luckysheet
          const luckyCell = {
            r: row,
            c: col,
            v: {
              v: cell.v, // значение
              ct: { fa: 'General', t: cellType }, // формат
              m: cell.w || String(cell.v), // отображаемое значение
            }
          };

          // Добавляем формулу если есть
          if (cell.f) {
            luckyCell.v.f = cell.f;
          }

          celldata.push(luckyCell);
        }
      }
    }

    // Лист в формате Luckysheet
    luckysheetData.push({
      name: sheetName,
      index: index.toString(),
      status: index === 0 ? '1' : '0', // активный лист
      order: index.toString(),
      celldata: celldata,
      row: range.e.r + 1,
      column: range.e.c + 1,
      config: {},
      scrollLeft: 0,
      scrollTop: 0,
      zoomRatio: 1
    });
  });

  return luckysheetData;
}

/**
 * Конвертирует Luckysheet данные в Excel Workbook
 * @param {Array} luckysheetData - Массив листов Luckysheet
 * @returns {Object} XLSX workbook объект
 */
function convertLuckysheetToXlsx(luckysheetData) {
  const workbook = XLSX.utils.book_new();

  luckysheetData.forEach(sheet => {
    // Определяем размер листа
    const maxRow = sheet.row || 100;
    const maxCol = sheet.column || 26;

    // Создаем пустой лист
    const worksheet = {};
    const range = { s: { r: maxRow, c: maxCol }, e: { r: 0, c: 0 } };

    // Заполняем данными из celldata
    if (sheet.celldata && Array.isArray(sheet.celldata)) {
      sheet.celldata.forEach(cell => {
        const r = cell.r;
        const c = cell.c;

        if (!cell.v) return;

        const cellAddress = XLSX.utils.encode_cell({ r, c });

        // Обновляем range
        if (r < range.s.r) range.s.r = r;
        if (r > range.e.r) range.e.r = r;
        if (c < range.s.c) range.s.c = c;
        if (c > range.e.c) range.e.c = c;

        // Создаем ячейку Excel
        const excelCell = {
          v: cell.v.v,
          t: cell.v.ct?.t || 'g'
        };

        // Тип ячейки
        if (typeof cell.v.v === 'number') {
          excelCell.t = 'n';
        } else if (typeof cell.v.v === 'string') {
          excelCell.t = 's';
        } else if (typeof cell.v.v === 'boolean') {
          excelCell.t = 'b';
        }

        // Формула
        if (cell.v.f) {
          excelCell.f = cell.v.f;
        }

        // Отображаемое значение
        if (cell.v.m) {
          excelCell.w = cell.v.m;
        }

        worksheet[cellAddress] = excelCell;
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
  convertXlsxToLuckysheet,
  convertLuckysheetToXlsx
};
