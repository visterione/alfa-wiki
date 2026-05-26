const XLSX = require('xlsx-js-style');

/**
 * Нормализует RGB цвет для Excel
 * Univer может использовать разные форматы: #RRGGBB, RRGGBB, AARRGGBB
 * Excel ожидает: AARRGGBB или RRGGBB (без #)
 */
function normalizeRgbColor(rgb) {
  if (!rgb) return null;

  // Убираем # если есть
  let color = rgb.replace('#', '').toUpperCase();

  // Если 6 символов (RRGGBB), добавляем альфа FF в начало
  if (color.length === 6) {
    color = 'FF' + color;
  }

  // Если 8 символов и альфа в конце (RRGGBBAA), переставляем в начало (AARRGGBB)
  if (color.length === 8 && !color.startsWith('FF') && !color.startsWith('00')) {
    // Проверим, не инвертирован ли формат
    const alpha = color.slice(6, 8);
    const rgb = color.slice(0, 6);
    color = alpha + rgb;
  }

  console.log('Normalized color:', rgb, '->', color);
  return color;
}

/**
 * Конвертирует Univer стиль в xlsx-js-style формат
 */
function convertUniverStyleToXlsx(univerStyle) {
  if (!univerStyle) return null;

  const xlsxStyle = {};

  // Шрифт
  if (univerStyle.ff || univerStyle.fs || univerStyle.bl || univerStyle.it ||
      univerStyle.ul || univerStyle.st || univerStyle.cl) {
    xlsxStyle.font = {};

    if (univerStyle.ff) xlsxStyle.font.name = univerStyle.ff;
    if (univerStyle.fs) xlsxStyle.font.sz = univerStyle.fs;
    if (univerStyle.bl) xlsxStyle.font.bold = true;
    if (univerStyle.it) xlsxStyle.font.italic = true;
    if (univerStyle.ul && univerStyle.ul.s) xlsxStyle.font.underline = true;
    if (univerStyle.st && univerStyle.st.s) xlsxStyle.font.strike = true;
    if (univerStyle.cl && univerStyle.cl.rgb) {
      const normalizedColor = normalizeRgbColor(univerStyle.cl.rgb);
      if (normalizedColor) {
        xlsxStyle.font.color = { rgb: normalizedColor };
      }
    }
  }

  // Заливка (фон)
  if (univerStyle.bg && univerStyle.bg.rgb) {
    const normalizedColor = normalizeRgbColor(univerStyle.bg.rgb);
    console.log('Converting bg color:', univerStyle.bg.rgb, '->', normalizedColor);
    if (normalizedColor) {
      xlsxStyle.fill = {
        patternType: 'solid',
        fgColor: { rgb: normalizedColor }
      };
    }
  }

  // Границы
  if (univerStyle.bd) {
    xlsxStyle.border = {};
    const borderStyleMap = {
      0: 'none',
      1: 'thin',
      2: 'medium',
      3: 'thick',
      4: 'double'
    };

    if (univerStyle.bd.t) {
      xlsxStyle.border.top = {
        style: borderStyleMap[univerStyle.bd.t.s] || 'thin',
        color: { rgb: univerStyle.bd.t.cl?.rgb || '000000' }
      };
    }
    if (univerStyle.bd.b) {
      xlsxStyle.border.bottom = {
        style: borderStyleMap[univerStyle.bd.b.s] || 'thin',
        color: { rgb: univerStyle.bd.b.cl?.rgb || '000000' }
      };
    }
    if (univerStyle.bd.l) {
      xlsxStyle.border.left = {
        style: borderStyleMap[univerStyle.bd.l.s] || 'thin',
        color: { rgb: univerStyle.bd.l.cl?.rgb || '000000' }
      };
    }
    if (univerStyle.bd.r) {
      xlsxStyle.border.right = {
        style: borderStyleMap[univerStyle.bd.r.s] || 'thin',
        color: { rgb: univerStyle.bd.r.cl?.rgb || '000000' }
      };
    }
  }

  // Выравнивание
  if (univerStyle.ht || univerStyle.vt || univerStyle.tb || univerStyle.tr) {
    xlsxStyle.alignment = {};

    const hAlignMap = { 0: 'left', 1: 'left', 2: 'center', 3: 'right' };
    const vAlignMap = { 0: 'top', 1: 'top', 2: 'center', 3: 'bottom' };

    if (univerStyle.ht !== undefined) {
      xlsxStyle.alignment.horizontal = hAlignMap[univerStyle.ht] || 'left';
    }
    if (univerStyle.vt !== undefined) {
      xlsxStyle.alignment.vertical = vAlignMap[univerStyle.vt] || 'top';
    }

    // Поворот текста (text rotation)
    if (univerStyle.tr && univerStyle.tr.a !== undefined) {
      // Univer хранит угол в градусах, Excel тоже использует градусы
      xlsxStyle.alignment.textRotation = univerStyle.tr.a;
    }

    // Перенос текста (wrap text)
    if (univerStyle.tb && univerStyle.tb.v !== undefined) {
      // tb.v = 1 означает vertical, 2 = overflow, 3 = wrap
      xlsxStyle.alignment.wrapText = univerStyle.tb.v === 3;
    }
  }

  return Object.keys(xlsxStyle).length > 0 ? xlsxStyle : null;
}

/**
 * Конвертирует xlsx стиль в Univer формат
 */
function convertXlsxStyleToUniver(xlsxCell) {
  const univerStyle = {};

  if (!xlsxCell.s) return null;

  const s = xlsxCell.s;

  // Шрифт
  if (s.font) {
    if (s.font.name) univerStyle.ff = s.font.name;
    if (s.font.sz) univerStyle.fs = s.font.sz;
    if (s.font.bold) univerStyle.bl = 1;
    if (s.font.italic) univerStyle.it = 1;
    if (s.font.underline) univerStyle.ul = { s: 1 };
    if (s.font.strike) univerStyle.st = { s: 1 };
    if (s.font.color && s.font.color.rgb) {
      univerStyle.cl = { rgb: s.font.color.rgb };
    }
  }

  // Заливка
  if (s.fill) {
    if (s.fill.fgColor && s.fill.fgColor.rgb) {
      univerStyle.bg = { rgb: s.fill.fgColor.rgb };
    } else if (s.fill.bgColor && s.fill.bgColor.rgb) {
      univerStyle.bg = { rgb: s.fill.bgColor.rgb };
    }
  }

  // Границы
  if (s.border) {
    univerStyle.bd = {};
    const borderStyleMap = {
      'thin': 1,
      'medium': 2,
      'thick': 3,
      'double': 4
    };

    if (s.border.top) {
      univerStyle.bd.t = {
        s: borderStyleMap[s.border.top.style] || 1,
        cl: { rgb: s.border.top.color?.rgb || '000000' }
      };
    }
    if (s.border.bottom) {
      univerStyle.bd.b = {
        s: borderStyleMap[s.border.bottom.style] || 1,
        cl: { rgb: s.border.bottom.color?.rgb || '000000' }
      };
    }
    if (s.border.left) {
      univerStyle.bd.l = {
        s: borderStyleMap[s.border.left.style] || 1,
        cl: { rgb: s.border.left.color?.rgb || '000000' }
      };
    }
    if (s.border.right) {
      univerStyle.bd.r = {
        s: borderStyleMap[s.border.right.style] || 1,
        cl: { rgb: s.border.right.color?.rgb || '000000' }
      };
    }
  }

  // Выравнивание
  if (s.alignment) {
    const hAlignMap = { 'left': 1, 'center': 2, 'right': 3 };
    const vAlignMap = { 'top': 1, 'center': 2, 'bottom': 3 };

    if (s.alignment.horizontal) {
      univerStyle.ht = hAlignMap[s.alignment.horizontal] || 1;
    }
    if (s.alignment.vertical) {
      univerStyle.vt = vAlignMap[s.alignment.vertical] || 1;
    }

    // Поворот текста
    if (s.alignment.textRotation !== undefined) {
      univerStyle.tr = { a: s.alignment.textRotation };
    }

    // Перенос текста
    if (s.alignment.wrapText) {
      univerStyle.tb = { v: 3 }; // 3 = wrap
    }
  }

  return Object.keys(univerStyle).length > 0 ? univerStyle : null;
}

/**
 * Строит массив групп из карты outlineLevel { rowIndex: level }.
 * Смежные индексы с level >= L образуют группу уровня L.
 */
function buildGroupsFromOutlineLevels(levels) {
  if (!levels || Object.keys(levels).length === 0) return [];
  const levelNums = Object.values(levels).map(Number).filter(n => n > 0);
  if (!levelNums.length) return [];

  const maxLevel = Math.max(...levelNums);
  const indices = Object.keys(levels).map(Number).sort((a, b) => a - b);
  const maxIndex = indices[indices.length - 1];
  const groups = [];

  for (let lv = 1; lv <= maxLevel; lv++) {
    let start = null;
    for (let i = 0; i <= maxIndex + 1; i++) {
      const rowLv = Number(levels[i] || 0);
      if (rowLv >= lv) {
        if (start === null) start = i;
      } else {
        if (start !== null) {
          groups.push({ start, end: i - 1, level: lv, collapsed: false });
          start = null;
        }
      }
    }
    if (start !== null) groups.push({ start, end: maxIndex, level: lv, collapsed: false });
  }

  return groups;
}

/**
 * Конвертирует Excel Workbook в формат Univer
 */
function convertXlsxToUniver(workbook) {
  const sheets = {};
  const sheetOrder = [];
  const styles = {};
  let styleCounter = 0;

  workbook.SheetNames.forEach((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

    const sheetId = `sheet-${index}`;
    sheetOrder.push(sheetId);

    const cellData = {};
    const mergeData = [];

    // Обработка ячеек
    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = worksheet[cellAddress];

        if (cell) {
          if (!cellData[row]) {
            cellData[row] = {};
          }

          // Определяем тип ячейки
          let cellType = 0;
          if (cell.t === 's') cellType = 1;
          else if (cell.t === 'n') cellType = 2;
          else if (cell.t === 'b') cellType = 3;
          else if (cell.t === 'e') cellType = 4;

          const univerCell = {
            v: cell.v,
            t: cellType
          };

          // Формула — xlsx хранит без =, Univer ожидает с =
          if (cell.f) {
            univerCell.f = '=' + cell.f;
          }

          // Стиль
          const univerStyle = convertXlsxStyleToUniver(cell);
          if (univerStyle) {
            // Добавляем числовой формат если есть
            if (cell.z) {
              univerStyle.n = { pattern: cell.z };
            }

            const styleId = `style-${styleCounter++}`;
            styles[styleId] = univerStyle;
            univerCell.s = styleId;
          } else if (cell.z) {
            // Если стиля нет, но есть числовой формат
            const styleId = `style-${styleCounter++}`;
            styles[styleId] = { n: { pattern: cell.z } };
            univerCell.s = styleId;
          }

          cellData[row][col] = univerCell;
        }
      }
    }

    // Обработка объединенных ячеек
    if (worksheet['!merges']) {
      worksheet['!merges'].forEach(merge => {
        mergeData.push({
          startRow: merge.s.r,
          endRow: merge.e.r,
          startColumn: merge.s.c,
          endColumn: merge.e.c
        });
      });
    }

    // Обработка размеров и группировки столбцов
    const columnData = {};
    const colOutlineLevels = {};
    if (worksheet['!cols']) {
      worksheet['!cols'].forEach((col, index) => {
        if (!col) return;
        const entry = {};
        if (col.width) entry.w = Math.round(col.width * 8.43);
        if (col.hidden) entry.hd = 1;
        if (Object.keys(entry).length) columnData[index] = entry;
        if (col.outlineLevel > 0) colOutlineLevels[index] = col.outlineLevel;
      });
    }

    // Обработка размеров и группировки строк
    const rowData = {};
    const rowOutlineLevels = {};
    if (worksheet['!rows']) {
      worksheet['!rows'].forEach((row, index) => {
        if (!row) return;
        const entry = {};
        if (row.height || row.hpt) entry.h = row.height || row.hpt;
        if (row.hidden) entry.hd = 1;
        if (Object.keys(entry).length) rowData[index] = entry;
        if (row.outlineLevel > 0) rowOutlineLevels[index] = row.outlineLevel;
      });
    }

    const rowGroupsData = buildGroupsFromOutlineLevels(rowOutlineLevels);
    const colGroupsData = buildGroupsFromOutlineLevels(colOutlineLevels);

    // Применяем hd:1 для свёрнутых групп при первоначальной загрузке
    // (Excel хранит collapsed state в row.hidden, мы уже обработали выше)

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
      rowData,
      columnData,
      mergeData,
      rowHeader: { width: 46, hidden: 0 },
      columnHeader: { height: 20, hidden: 0 },
      ...(rowGroupsData.length > 0 && { rowGroupsData }),
      ...(colGroupsData.length > 0 && { colGroupsData }),
    };
  });

  return {
    id: 'workbook',
    name: workbook.Props?.Title || 'Workbook',
    appVersion: '0.1.0',
    locale: 'ru-RU',
    styles,
    sheets,
    sheetOrder
  };
}

/**
 * Конвертирует Univer данные в Excel Workbook
 */
function convertUniverToXlsx(univerData) {
  const workbook = XLSX.utils.book_new();

  if (univerData.name) {
    workbook.Props = {
      Title: univerData.name
    };
  }

  const sheetOrder = univerData.sheetOrder || Object.keys(univerData.sheets || {});

  sheetOrder.forEach(sheetId => {
    const sheet = univerData.sheets[sheetId];
    if (!sheet) return;

    const worksheet = {};
    const range = { s: { r: Infinity, c: Infinity }, e: { r: 0, c: 0 } };

    // Обработка ячеек
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

            // Создаем ячейку
            const excelCell = {
              v: cell.v !== undefined && cell.v !== null ? cell.v : ''
            };

            // Тип
            if (cell.v === undefined || cell.v === null || cell.v === '') {
              // Пустая ячейка - используем строковый тип
              excelCell.t = 's';
            } else if (cell.t === 1) {
              excelCell.t = 's';
            } else if (cell.t === 2) {
              excelCell.t = 'n';
            } else if (cell.t === 3) {
              excelCell.t = 'b';
            } else if (cell.t === 4) {
              excelCell.t = 'e';
            } else {
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

            // Формула — Univer хранит с =, xlsx ожидает без =
            if (cell.f) {
              excelCell.f = cell.f.startsWith('=') ? cell.f.slice(1) : cell.f;
            }

            // Стиль
            if (cell.s && univerData.styles && univerData.styles[cell.s]) {
              const xlsxStyle = convertUniverStyleToXlsx(univerData.styles[cell.s]);
              if (xlsxStyle) {
                excelCell.s = xlsxStyle;
              }

              // Числовой формат (например, процентный)
              const univerStyle = univerData.styles[cell.s];
              if (univerStyle.n && univerStyle.n.pattern) {
                excelCell.z = univerStyle.n.pattern;
              }
            }

            worksheet[cellAddress] = excelCell;
          });
        }
      });
    }

    // Если лист пустой
    if (range.s.r === Infinity || range.s.c === Infinity) {
      range.s = { r: 0, c: 0 };
      range.e = { r: 0, c: 0 };
    }

    worksheet['!ref'] = XLSX.utils.encode_range(range);

    // Объединенные ячейки
    if (sheet.mergeData && sheet.mergeData.length > 0) {
      worksheet['!merges'] = sheet.mergeData.map(merge => ({
        s: { r: merge.startRow, c: merge.startColumn },
        e: { r: merge.endRow, c: merge.endColumn }
      }));
    }

    // Вычисляем outlineLevel для строк из групп
    const rowOutlineLevels = {};
    const rowGroupsCollapsed = {};
    if (sheet.rowGroupsData && sheet.rowGroupsData.length > 0) {
      for (const g of sheet.rowGroupsData) {
        for (let r = g.start; r <= g.end; r++) {
          rowOutlineLevels[r] = Math.max(rowOutlineLevels[r] || 0, g.level);
        }
        if (g.collapsed) {
          for (let r = g.start; r <= g.end; r++) rowGroupsCollapsed[r] = true;
        }
      }
    }

    // Вычисляем outlineLevel для столбцов
    const colOutlineLevels = {};
    const colGroupsCollapsed = {};
    if (sheet.colGroupsData && sheet.colGroupsData.length > 0) {
      for (const g of sheet.colGroupsData) {
        for (let c = g.start; c <= g.end; c++) {
          colOutlineLevels[c] = Math.max(colOutlineLevels[c] || 0, g.level);
        }
        if (g.collapsed) {
          for (let c = g.start; c <= g.end; c++) colGroupsCollapsed[c] = true;
        }
      }
    }

    // Ширина столбцов
    const maxColIdx = Math.max(
      ...Object.keys(sheet.columnData || {}).map(Number),
      ...Object.keys(colOutlineLevels).map(Number),
      -1
    );
    if (maxColIdx >= 0) {
      worksheet['!cols'] = [];
      for (let ci = 0; ci <= maxColIdx; ci++) {
        const col = sheet.columnData?.[ci];
        const entry = {};
        if (col?.w) entry.width = col.w / 8.43;
        if (col?.hd) entry.hidden = true;
        if (colOutlineLevels[ci]) entry.outlineLevel = colOutlineLevels[ci];
        if (colGroupsCollapsed[ci]) entry.hidden = true;
        if (Object.keys(entry).length) worksheet['!cols'][ci] = entry;
      }
    }

    // Высота строк
    const maxRowIdx = Math.max(
      ...Object.keys(sheet.rowData || {}).map(Number),
      ...Object.keys(rowOutlineLevels).map(Number),
      -1
    );
    if (maxRowIdx >= 0) {
      worksheet['!rows'] = [];
      for (let ri = 0; ri <= maxRowIdx; ri++) {
        const row = sheet.rowData?.[ri];
        const entry = {};
        if (row?.h) entry.hpt = row.h;
        if (row?.hd) entry.hidden = true;
        if (rowOutlineLevels[ri]) entry.outlineLevel = rowOutlineLevels[ri];
        if (rowGroupsCollapsed[ri]) entry.hidden = true;
        if (Object.keys(entry).length) worksheet['!rows'][ri] = entry;
      }
    }

    // Устанавливаем флаги outline для листа
    if (Object.keys(rowOutlineLevels).length > 0 || Object.keys(colOutlineLevels).length > 0) {
      if (!worksheet['!sheetPr']) worksheet['!sheetPr'] = {};
      worksheet['!sheetPr'].outlinePr = { summaryBelow: true, summaryRight: true };
    }

    const sheetName = sheet.name || `Sheet${workbook.SheetNames.length + 1}`;
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  });

  return workbook;
}

module.exports = {
  convertXlsxToUniver,
  convertUniverToXlsx
};
