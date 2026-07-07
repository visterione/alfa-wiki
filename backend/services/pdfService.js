const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const { DECISION_CATEGORIES } = require('../config/reviewStatuses');

// Маппинг действий для истории
const ACTION_LABELS = {
  'created': 'Создан',
  'status_change': 'Изменен статус',
  'comment': 'Комментарий',
  'file_upload': 'Загружен файл',
  'assignment': 'Назначение',
  'finalized': 'Финализирован'
};

// События встроенных таблиц-отчётов (терапия, гинекология, скорая): action='updated', тип — в metadata.event
const REPORT_SOURCES = ['therapy', 'gynecology', 'ambulance'];
const REPORT_EVENT_LABELS = {
  create: 'Добавление записи',
  update: 'Редактирование записи',
  delete: 'Удаление записи',
  import: 'Импорт данных',
  export: 'Экспорт данных',
  clear:  'Удаление всех данных'
};

function resolveHistoryActionLabel(entry, actionLabels) {
  if (REPORT_SOURCES.includes(entry.metadata?.source) && REPORT_EVENT_LABELS[entry.metadata.event]) {
    return REPORT_EVENT_LABELS[entry.metadata.event];
  }
  return actionLabels[entry.action] || entry.action;
}

/**
 * Генерация PDF отчета по отзыву
 */
async function generateReviewPdf(review, board, history) {
  return new Promise((resolve, reject) => {
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const uploadDir = path.join(__dirname, '..', 'uploads', 'reviews', yearMonth);

      // Создаем директорию если не существует
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filename = `review-${review.id}.pdf`;
      const filePath = path.join(uploadDir, filename);
      const relativePath = `uploads/reviews/${yearMonth}/${filename}`;

      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        info: {
          Title: `Отчет по отзыву - ${review.patientName}`,
          Author: board.name,
          Subject: 'Отчет по отзыву',
          CreationDate: now
        }
      });

      // Регистрируем шрифты с поддержкой кириллицы
      const fontsDir = path.join(__dirname, '..', 'fonts');
      doc.registerFont('DejaVu', path.join(fontsDir, 'DejaVuSans.ttf'));
      doc.registerFont('DejaVu-Bold', path.join(fontsDir, 'DejaVuSans-Bold.ttf'));

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Заголовок
      doc.fontSize(20).font('DejaVu-Bold').text(board.name, { align: 'center' });
      doc.fontSize(12).font('DejaVu').text('Отчет по отзыву', { align: 'center' });
      doc.fontSize(10).text(`Сформирован: ${now.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}`, { align: 'center' });

      doc.moveDown(2);

      // Разделитель
      doc.strokeColor('#e5e7eb').lineWidth(1)
        .moveTo(50, doc.y).lineTo(545, doc.y).stroke();

      doc.moveDown(1);

      // Информация об отзыве
      doc.fontSize(14).font('DejaVu-Bold').text('Информация об отзыве');
      doc.moveDown(0.5);

      doc.fontSize(11).font('DejaVu');

      // Таблица с данными
      const infoY = doc.y;
      const leftCol = 50;
      const rightCol = 170;

      const infoRows = [
        ['Пациент:', review.patientName],
        ['Дата отзыва:', new Date(review.reviewDate).toLocaleDateString('ru-RU')],
        ['Площадка:', review.platform?.name || 'Неизвестно'],
        ['Врач:', review.doctorName || '—'],
        ['Оценка:', `${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} (${review.rating}/5)`]
      ];

      let currentY = infoY;
      infoRows.forEach(([label, value]) => {
        doc.font('DejaVu-Bold').text(label, leftCol, currentY);
        doc.font('DejaVu').text(value, rightCol, currentY);
        currentY += 18;
      });

      doc.y = currentY + 10;

      // Текст отзыва
      doc.fontSize(14).font('DejaVu-Bold').text('Текст отзыва');
      doc.moveDown(0.5);
      doc.fontSize(11).font('DejaVu');

      // Рамка для текста отзыва
      const textStartY = doc.y;
      doc.rect(50, textStartY, 495, 100).stroke('#e5e7eb');
      doc.text(review.reviewText, 60, textStartY + 10, {
        width: 475,
        height: 80,
        ellipsis: true
      });

      doc.y = textStartY + 110;
      doc.moveDown(1);

      // Дополнительная информация (если есть)
      if (review.additionalInfo) {
        doc.fontSize(14).font('DejaVu-Bold').text('Дополнительная информация');
        doc.moveDown(0.5);
        doc.fontSize(11).font('DejaVu').text(review.additionalInfo, {
          width: 495
        });
        doc.moveDown(1);
      }

      // Принятое решение
      if (review.decisionCategory) {
        doc.strokeColor('#e5e7eb').lineWidth(1)
          .moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1);

        doc.fontSize(14).font('DejaVu-Bold').text('Принятое решение');
        doc.moveDown(0.5);

        const categoryLabel = DECISION_CATEGORIES.find(c => c.id === review.decisionCategory)?.label
          || review.decisionCategory;

        doc.fontSize(11).font('DejaVu-Bold').text('Категория: ', { continued: true });
        doc.font('DejaVu').text(categoryLabel);

        if (review.decisionDescription) {
          doc.moveDown(0.5);
          doc.font('DejaVu-Bold').text('Описание:');
          doc.font('DejaVu').text(review.decisionDescription, {
            width: 495
          });
        }

        doc.moveDown(1);
      }

      // История обработки
      doc.strokeColor('#e5e7eb').lineWidth(1)
        .moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(1);

      doc.fontSize(14).font('DejaVu-Bold').text('История обработки');
      doc.moveDown(0.5);

      if (history && history.length > 0) {
        doc.fontSize(10).font('DejaVu');

        history.forEach((entry, index) => {
          // Проверяем, нужна ли новая страница
          if (doc.y > 700) {
            doc.addPage();
          }

          const date = new Date(entry.createdAt).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

          const userName = entry.user?.displayName || entry.user?.username || 'Система';
          const actionLabel = resolveHistoryActionLabel(entry, ACTION_LABELS);

          // Дата и пользователь
          doc.font('DejaVu-Bold').text(`${date}`, { continued: true });
          doc.font('DejaVu').text(` — ${userName}: ${actionLabel}`);

          // Детали действия
          if (entry.oldValue && entry.newValue) {
            doc.fillColor('#6b7280').text(`   ${entry.oldValue} → ${entry.newValue}`, { indent: 20 });
            doc.fillColor('#000000');
          }

          if (entry.comment) {
            doc.fillColor('#374151').text(`   ${entry.comment}`, { indent: 20 });
            doc.fillColor('#000000');
          }

          if (entry.attachments && entry.attachments.length > 0) {
            const fileNames = entry.attachments.map(a => a.filename).join(', ');
            doc.fillColor('#6b7280').text(`   Файлы: ${fileNames}`, { indent: 20 });
            doc.fillColor('#000000');
          }

          doc.moveDown(0.3);
        });
      } else {
        doc.fontSize(10).font('DejaVu').fillColor('#6b7280')
          .text('История обработки пуста');
        doc.fillColor('#000000');
      }

      // Финализация документа
      doc.end();

      stream.on('finish', () => {
        resolve(relativePath);
      });

      stream.on('error', (error) => {
        reject(error);
      });

    } catch (error) {
      reject(error);
    }
  });
}

// ─── Diff-утилиты для PDF ────────────────────────────────────────────────────

// Пословный diff через LCS: возвращает токены {v, t}  (t: -1=удалено, 0=без изм., 1=добавлено)
function getDiffTokens(oldText, newText) {
  const tok = s => (s.match(/\S+|\s+/g) || []);
  const A = tok(oldText), B = tok(newText);
  if (A.length > 400 || B.length > 400) return null;
  const m = A.length, n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = A[i-1] === B[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i-1] === B[j-1]) { result.unshift({ v: A[i-1], t: 0 }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { result.unshift({ v: B[j-1], t: 1 }); j--; }
    else { result.unshift({ v: A[i-1], t: -1 }); i--; }
  }
  return result;
}

// Рендер строки с пословной подсветкой (filtered tokens, continued-mode)
function renderInlineDiffLine(doc, tokens, excludeType, signChar, signColor, x, width) {
  const toks = tokens.filter(t => t.t !== excludeType);
  if (!toks.length) return;
  doc.fontSize(8).font('DejaVu').fillColor(signColor)
    .text(signChar + ' ', x, doc.y, { continued: true, width });
  toks.forEach((tok, idx) => {
    const isLast = idx === toks.length - 1;
    if (tok.t !== 0) {
      doc.font('DejaVu-Bold').fillColor(excludeType === 1 ? '#dc2626' : '#16a34a')
        .text(tok.v, { continued: !isLast });
    } else {
      doc.font('DejaVu').fillColor('#374151').text(tok.v, { continued: !isLast });
    }
  });
  doc.font('DejaVu').fillColor('#000000');
}

// Рендер массива changes из entry.metadata.changes в PDFDocument
function renderChangesInPdf(doc, changes, leftMargin) {
  leftMargin = leftMargin || 65;
  const pageW = 545;
  const contentW = pageW - leftMargin;

  for (const c of changes) {
    if (doc.y > 700) doc.addPage();

    // Контекст (serviceContext)
    if (c.field === 'serviceContext' && c.to !== undefined) {
      doc.fontSize(8).font('DejaVu').fillColor('#6b7280')
        .text(c.label + ': ' + String(c.to).slice(0, 100), leftMargin, doc.y, { width: contentW });
      doc.fillColor('#000000');
      continue;
    }

    // Неизменённое поле — серым
    if (c.unchanged !== undefined) {
      doc.fontSize(8).font('DejaVu').fillColor('#6b7280')
        .text(c.label + ': ' + String(c.unchanged).slice(0, 100), leftMargin, doc.y, { width: contentW });
      doc.fillColor('#000000');
      continue;
    }

    // Построчный diff
    if (c.addedLines || c.removedLines) {
      const rCount = c.removedLines ? c.removedLines.length : 0;
      const aCount = c.addedLines ? c.addedLines.length : 0;
      const statStr = [rCount > 0 ? '-' + rCount : '', aCount > 0 ? '+' + aCount : ''].filter(Boolean).join(' ');
      doc.fontSize(8).font('DejaVu-Bold').fillColor('#374151')
        .text(c.label + (statStr ? ': ' + statStr : ''), leftMargin, doc.y, { width: contentW });

      const inlineTokens = (rCount === 1 && aCount === 1)
        ? getDiffTokens(c.removedLines[0], c.addedLines[0]) : null;

      if (inlineTokens) {
        if (doc.y > 700) doc.addPage();
        renderInlineDiffLine(doc, inlineTokens, 1, '−', '#dc2626', leftMargin + 8, contentW - 8);
        if (doc.y > 700) doc.addPage();
        renderInlineDiffLine(doc, inlineTokens, -1, '+', '#16a34a', leftMargin + 8, contentW - 8);
      } else {
        if (c.removedLines) {
          for (const line of c.removedLines) {
            if (doc.y > 700) doc.addPage();
            doc.fontSize(8).font('DejaVu').fillColor('#dc2626')
              .text('− ' + String(line).slice(0, 250), leftMargin + 8, doc.y, { width: contentW - 8 });
          }
        }
        if (c.addedLines) {
          for (const line of c.addedLines) {
            if (doc.y > 700) doc.addPage();
            doc.fontSize(8).font('DejaVu').fillColor('#16a34a')
              .text('+ ' + String(line).slice(0, 250), leftMargin + 8, doc.y, { width: contentW - 8 });
          }
        }
      }
      doc.fillColor('#000000');
      continue;
    }

    // Ячейки таблицы (spreadsheet)
    if (c.changedCells && c.changedCells.length > 0) {
      doc.fontSize(8).font('DejaVu-Bold').fillColor('#374151')
        .text((c.label || 'Таблица') + ':', leftMargin, doc.y, { width: contentW });
      for (const cell of c.changedCells) {
        if (doc.y > 700) doc.addPage();
        doc.font('DejaVu-Bold').fillColor('#374151')
          .text(cell.cell + ': ', leftMargin + 8, doc.y, { continued: true, width: contentW - 8 });
        if (cell.from !== '') {
          doc.font('DejaVu').fillColor('#dc2626')
            .text('\u00ab' + String(cell.from).slice(0, 40) + '\u00bb ', { continued: true });
          doc.fillColor('#9ca3af').text('\u2192 ', { continued: true });
        }
        if (cell.to !== '') {
          doc.font('DejaVu').fillColor('#16a34a')
            .text('\u00ab' + String(cell.to).slice(0, 40) + '\u00bb', { continued: false });
        } else {
          doc.fillColor('#dc2626').text('\u0443\u0434\u0430\u043b\u0435\u043d\u043e', { continued: false });
        }
      }
      doc.fillColor('#000000');
      continue;
    }

    // Скалярное поле: было → стало
    if (c.from !== undefined && c.to !== undefined) {
      doc.fontSize(8).font('DejaVu-Bold').fillColor('#374151')
        .text(c.label + ': ', leftMargin, doc.y, { continued: true, width: contentW });
      doc.font('DejaVu').fillColor('#dc2626')
        .text('\u00ab' + String(c.from).slice(0, 60) + '\u00bb ', { continued: true });
      doc.fillColor('#9ca3af').text('\u2192 ', { continued: true });
      doc.fillColor('#16a34a')
        .text('\u00ab' + String(c.to).slice(0, 60) + '\u00bb', { continued: false });
      doc.fillColor('#000000');
      continue;
    }

    // Только to (добавлено)
    if (c.from === undefined && c.to !== undefined && c.field !== 'content') {
      doc.fontSize(8).font('DejaVu-Bold').fillColor('#374151')
        .text(c.label + ': ', leftMargin, doc.y, { continued: true, width: contentW });
      doc.font('DejaVu').fillColor('#16a34a')
        .text('\u00ab' + String(c.to).slice(0, 60) + '\u00bb', { continued: false });
      doc.fillColor('#000000');
      continue;
    }

    // Только from (удалено)
    if (c.to === undefined && c.from !== undefined && c.field !== 'content') {
      doc.fontSize(8).font('DejaVu-Bold').fillColor('#374151')
        .text(c.label + ': ', leftMargin, doc.y, { continued: true, width: contentW });
      doc.font('DejaVu').fillColor('#dc2626')
        .text('\u00ab' + String(c.from).slice(0, 60) + '\u00bb', { continued: false });
      doc.fillColor('#000000');
      continue;
    }

    // Просто метка
    if (c.label) {
      doc.fontSize(8).font('DejaVu').fillColor('#6b7280')
        .text(c.label, leftMargin, doc.y, { width: contentW });
      doc.fillColor('#000000');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Генерация PDF отчета по истории изменений страницы
 */
async function generatePageHistoryPdf(page, history) {
  return new Promise((resolve, reject) => {
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const uploadDir = path.join(__dirname, '..', 'uploads', 'page-history', yearMonth);

      // Создаем директорию если не существует
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filename = `page-history-${page.id}-${Date.now()}.pdf`;
      const filePath = path.join(uploadDir, filename);
      const relativePath = `uploads/page-history/${yearMonth}/${filename}`;

      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        info: {
          Title: `Журнал изменений - ${page.title}`,
          Author: 'Alfa Wiki',
          Subject: 'Журнал изменений страницы',
          CreationDate: now
        }
      });

      // Регистрируем шрифты с поддержкой кириллицы
      const fontsDir = path.join(__dirname, '..', 'fonts');
      doc.registerFont('DejaVu', path.join(fontsDir, 'DejaVuSans.ttf'));
      doc.registerFont('DejaVu-Bold', path.join(fontsDir, 'DejaVuSans-Bold.ttf'));

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Заголовок
      doc.fontSize(20).font('DejaVu-Bold').text('Журнал изменений', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(14).font('DejaVu').text(page.title, { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(10).text(`Сформирован: ${now.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}`, { align: 'center' });

      doc.moveDown(2);

      // Разделитель
      doc.strokeColor('#e5e7eb').lineWidth(1)
        .moveTo(50, doc.y).lineTo(545, doc.y).stroke();

      doc.moveDown(1);

      // Действия для отображения
      const ACTION_LABELS = {
        'created': 'Создание',
        'updated': 'Редактирование',
        'published': 'Публикация',
        'unpublished': 'Снятие публикации'
      };

      if (history && history.length > 0) {
        doc.fontSize(14).font('DejaVu-Bold').text('История изменений');
        doc.moveDown(0.5);
        doc.fontSize(10).font('DejaVu');

        // Сортируем историю в хронологическом порядке (старые события первыми)
        const sortedHistory = [...history].reverse();

        sortedHistory.forEach((entry, index) => {
          // Проверяем, нужна ли новая страница
          if (doc.y > 700) {
            doc.addPage();
          }

          const date = new Date(entry.createdAt).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

          const userName = entry.user?.displayName || entry.user?.username || 'Система';
          const actionLabel = resolveHistoryActionLabel(entry, ACTION_LABELS);

          // Иконка действия (символ)
          let actionIcon = '•';
          if (entry.action === 'created') actionIcon = '+';
          if (entry.action === 'published') actionIcon = '✓';
          if (entry.action === 'unpublished') actionIcon = '✕';

          // Дата и пользователь
          doc.font('DejaVu-Bold').fillColor('#1e40af').text(`${actionIcon} ${date}`, { continued: false });
          doc.fillColor('#000000');
          doc.font('DejaVu').text(`   ${userName}`, { indent: 15 });
          doc.font('DejaVu-Bold').text(`   ${actionLabel}`, { indent: 15 });

          // Детальные изменения (если есть структурированный diff)
          if (entry.metadata && entry.metadata.changes && entry.metadata.changes.length > 0) {
            renderChangesInPdf(doc, entry.metadata.changes, 65);
          } else if (entry.changesSummary) {
            doc.fillColor('#374151').font('DejaVu').text(`   ${entry.changesSummary}`, {
              indent: 15,
              width: 480
            });
            doc.fillColor('#000000');
          }

          doc.moveDown(0.5);

          // Разделитель между записями (для всех кроме последней)
          if (index < sortedHistory.length - 1) {
            doc.strokeColor('#f3f4f6').lineWidth(0.5)
              .moveTo(65, doc.y).lineTo(545, doc.y).stroke();
            doc.moveDown(0.5);
          }
        });
      } else {
        doc.fontSize(10).font('DejaVu').fillColor('#6b7280')
          .text('История изменений пуста');
        doc.fillColor('#000000');
      }

      // Футер на последней странице
      doc.moveDown(2);
      doc.strokeColor('#e5e7eb').lineWidth(1)
        .moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(8).font('DejaVu').fillColor('#9ca3af')
        .text(`Всего записей в истории: ${history.length}`, { align: 'center' });

      // Финализация документа
      doc.end();

      stream.on('finish', () => {
        resolve(relativePath);
      });

      stream.on('error', (error) => {
        reject(error);
      });

    } catch (error) {
      reject(error);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Отчёт по аккредитациям (реестр-срез)
// ─────────────────────────────────────────────────────────────────────────────

// Цвета медцентров (в тон чипам на странице)
const ACC_MC_COLORS = {
  'Альфа': '#be185d', 'Кидс': '#c2410c', 'Проф': '#6d28d9', '3К': '#a21caf',
  'Смайл': '#4b5563', 'Линия': '#92400e', 'Сукко': '#047857', 'ИП Микаелян': '#0369a1'
};
const ACC_MC_ORDER = ['Альфа', 'Кидс', 'Проф', 'Линия', 'Смайл', '3К', 'Сукко', 'ИП Микаелян'];

function accDaysLeft(ds) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(ds) - today) / 86400000);
}
function accFormatDate(ds) {
  const d = new Date(ds);
  return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
}
function accStatus(ds) {
  const d = accDaysLeft(ds);
  if (d < 0) return { label: 'Просрочено', color: '#dc2626' };
  if (d <= 30) return { label: '≤30 дней', color: '#b45309' };
  if (d <= 90) return { label: '≤90 дней', color: '#a16207' };
  return { label: 'Действует', color: '#16a34a' };
}
function accSeriesNumber(it) {
  return [it.series, it.number].map(x => (x == null ? '' : String(x)).trim()).filter(Boolean).join(' ');
}

/**
 * Генерация PDF-отчёта по аккредитациям. Пишет прямо в переданный поток (res).
 * @param {WritableStream} stream  куда писать PDF (обычно res)
 * @param {Object} opts
 *   items            [{ mc, fullName, specialty, series, number, expirationDate }]
 *   from, to         границы периода (строки YYYY-MM-DD) или null
 *   statusLabel      человекочитаемое название статус-фильтра
 *   groupByMedCenter группировать ли по медцентрам
 *   generatedBy      ФИО/логин сформировавшего
 */
function generateAccreditationsReportPdf(stream, opts) {
  return new Promise((resolve, reject) => {
    try {
      const { items = [], from, to, statusLabel, groupByMedCenter = true, generatedBy } = opts;
      const now = new Date();

      const doc = new PDFDocument({
        margin: 40, size: 'A4', layout: 'landscape',
        info: { Title: 'Аккредитационный отчёт', Author: 'Alfa Wiki', Subject: 'Отчёт по аккредитациям', CreationDate: now }
      });

      const fontsDir = path.join(__dirname, '..', 'fonts');
      doc.registerFont('DejaVu', path.join(fontsDir, 'DejaVuSans.ttf'));
      doc.registerFont('DejaVu-Bold', path.join(fontsDir, 'DejaVuSans-Bold.ttf'));

      doc.pipe(stream);

      // Геометрия (landscape A4: 842 x 595, поля 40)
      const LEFT = 40, RIGHT = 802, BOTTOM = 555;

      // Колонки. В режиме без группировки добавляем «Медцентр».
      const cols = groupByMedCenter
        ? [
            { key: 'idx',  title: '№',             w: 30,  align: 'left' },
            { key: 'name', title: 'ФИО',           w: 230, align: 'left' },
            { key: 'spec', title: 'Специальность', w: 242, align: 'left' },
            { key: 'sn',   title: 'Серия/№',       w: 113, align: 'left' },
            { key: 'date', title: 'Срок',          w: 72,  align: 'left' },
            { key: 'stat', title: 'Статус',        w: 75,  align: 'left' }
          ]
        : [
            { key: 'idx',  title: '№',             w: 30,  align: 'left' },
            { key: 'mc',   title: 'Медцентр',      w: 90,  align: 'left' },
            { key: 'name', title: 'ФИО',           w: 195, align: 'left' },
            { key: 'spec', title: 'Специальность', w: 188, align: 'left' },
            { key: 'sn',   title: 'Серия/№',       w: 110, align: 'left' },
            { key: 'date', title: 'Срок',          w: 72,  align: 'left' },
            { key: 'stat', title: 'Статус',        w: 75,  align: 'left' }
          ];
      // x-координаты колонок
      let cx = LEFT;
      cols.forEach(c => { c.x = cx; cx += c.w; });

      const cellTxt = (cells, c) => String(cells[c.key] == null ? '' : cells[c.key]);

      // Универсальный рендер строки таблицы с полной сеткой (все границы).
      function renderRow(cells, opts) {
        opts = opts || {};
        const isHeader = !!opts.header;
        doc.font(isHeader ? 'DejaVu-Bold' : 'DejaVu').fontSize(isHeader ? 9 : 8.5);

        // высота строки = по самой высокой ячейке (с учётом переноса) + вертикальные отступы
        let rowH = 0;
        cols.forEach(c => {
          const h = doc.heightOfString(cellTxt(cells, c), { width: c.w - 6 });
          if (h > rowH) rowH = h;
        });
        rowH = Math.max(rowH, isHeader ? 13 : 12) + 6;

        if (!isHeader && doc.y + rowH > BOTTOM) { doc.addPage(); drawTableHeader(); }

        const y = doc.y;

        // фон шапки
        if (isHeader) { doc.save(); doc.rect(LEFT, y, RIGHT - LEFT, rowH).fill('#f1f5f9'); doc.restore(); }

        // границы всех ячеек (вертикальные + горизонтальные)
        doc.lineWidth(0.6).strokeColor('#94a3b8');
        cols.forEach(c => doc.rect(c.x, y, c.w, rowH).stroke());

        // текст
        cols.forEach(c => {
          if (isHeader) doc.font('DejaVu-Bold').fillColor('#1f2937');
          else if (c.key === 'stat') doc.font('DejaVu-Bold').fillColor(opts.statusColor || '#374151');
          else doc.font('DejaVu').fillColor('#374151');
          doc.text(cellTxt(cells, c), c.x + 3, y + 3, { width: c.w - 6, align: c.align });
        });

        doc.fillColor('#000000');
        doc.y = y + rowH;
      }

      function drawTableHeader() {
        const headerCells = {};
        cols.forEach(c => { headerCells[c.key] = c.title; });
        renderRow(headerCells, { header: true });
      }

      // ── Шапка документа ──
      doc.fontSize(16).font('DejaVu-Bold').fillColor('#1f2937').text('Аккредитационный отчёт', LEFT, doc.y, { align: 'left' });
      doc.moveDown(0.3);
      if (from || to) {
        doc.fontSize(10).font('DejaVu').fillColor('#6b7280')
          .text('Период (срок действия): ' + (from ? accFormatDate(from) : '…') + ' – ' + (to ? accFormatDate(to) : '…'), { width: RIGHT - LEFT });
        doc.moveDown(0.6);
      }
      doc.fillColor('#000000');

      if (!items.length) {
        doc.fontSize(11).font('DejaVu').fillColor('#6b7280').text('Нет данных по выбранным фильтрам');
        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
        return;
      }

      if (groupByMedCenter) {
        // группируем по медцентру
        const groups = {};
        items.forEach(it => { (groups[it.mc] = groups[it.mc] || []).push(it); });
        const names = Object.keys(groups).sort((a, b) => {
          const ia = ACC_MC_ORDER.indexOf(a), ib = ACC_MC_ORDER.indexOf(b);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
        names.forEach(name => {
          const rows = groups[name].slice().sort((a, b) => new Date(a.expirationDate) - new Date(b.expirationDate));
          // заголовок секции
          if (doc.y + 40 > BOTTOM) doc.addPage();
          doc.moveDown(0.3);
          doc.fontSize(12).font('DejaVu-Bold').fillColor(ACC_MC_COLORS[name] || '#1f2937')
            .text(name + '  (' + rows.length + ')', LEFT, doc.y);
          doc.fillColor('#000000').moveDown(0.2);
          drawTableHeader();
          rows.forEach((it, i) => {
            const st = accStatus(it.expirationDate);
            renderRow({ idx: i + 1, name: it.fullName, spec: it.specialty, sn: accSeriesNumber(it), date: accFormatDate(it.expirationDate), stat: st.label }, { statusColor: st.color });
          });
          doc.moveDown(0.4);
        });
      } else {
        // единая таблица, сортировка: медцентр → дата
        const rows = items.slice().sort((a, b) => {
          const ia = ACC_MC_ORDER.indexOf(a.mc), ib = ACC_MC_ORDER.indexOf(b.mc);
          if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
          return new Date(a.expirationDate) - new Date(b.expirationDate);
        });
        drawTableHeader();
        rows.forEach((it, i) => {
          const st = accStatus(it.expirationDate);
          renderRow({ idx: i + 1, mc: it.mc, name: it.fullName, spec: it.specialty, sn: accSeriesNumber(it), date: accFormatDate(it.expirationDate), stat: st.label }, { statusColor: st.color });
        });
      }

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  generateReviewPdf,
  generatePageHistoryPdf,
  generateAccreditationsReportPdf
};
