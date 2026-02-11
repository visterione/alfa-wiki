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
          const actionLabel = ACTION_LABELS[entry.action] || entry.action;

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
          const actionLabel = ACTION_LABELS[entry.action] || entry.action;

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

          // Описание изменений (если есть)
          if (entry.changesSummary) {
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

module.exports = {
  generateReviewPdf,
  generatePageHistoryPdf
};
