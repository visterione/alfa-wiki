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

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Заголовок
      doc.fontSize(20).font('Helvetica-Bold').text(board.name, { align: 'center' });
      doc.fontSize(12).font('Helvetica').text('Отчет по отзыву', { align: 'center' });
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
      doc.fontSize(14).font('Helvetica-Bold').text('Информация об отзыве');
      doc.moveDown(0.5);

      doc.fontSize(11).font('Helvetica');

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
        doc.font('Helvetica-Bold').text(label, leftCol, currentY);
        doc.font('Helvetica').text(value, rightCol, currentY);
        currentY += 18;
      });

      doc.y = currentY + 10;

      // Текст отзыва
      doc.fontSize(14).font('Helvetica-Bold').text('Текст отзыва');
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica');

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
        doc.fontSize(14).font('Helvetica-Bold').text('Дополнительная информация');
        doc.moveDown(0.5);
        doc.fontSize(11).font('Helvetica').text(review.additionalInfo, {
          width: 495
        });
        doc.moveDown(1);
      }

      // Принятое решение
      if (review.decisionCategory) {
        doc.strokeColor('#e5e7eb').lineWidth(1)
          .moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1);

        doc.fontSize(14).font('Helvetica-Bold').text('Принятое решение');
        doc.moveDown(0.5);

        const categoryLabel = DECISION_CATEGORIES.find(c => c.id === review.decisionCategory)?.label
          || review.decisionCategory;

        doc.fontSize(11).font('Helvetica-Bold').text('Категория: ', { continued: true });
        doc.font('Helvetica').text(categoryLabel);

        if (review.decisionDescription) {
          doc.moveDown(0.5);
          doc.font('Helvetica-Bold').text('Описание:');
          doc.font('Helvetica').text(review.decisionDescription, {
            width: 495
          });
        }

        doc.moveDown(1);
      }

      // История обработки
      doc.strokeColor('#e5e7eb').lineWidth(1)
        .moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(1);

      doc.fontSize(14).font('Helvetica-Bold').text('История обработки');
      doc.moveDown(0.5);

      if (history && history.length > 0) {
        doc.fontSize(10).font('Helvetica');

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
          doc.font('Helvetica-Bold').text(`${date}`, { continued: true });
          doc.font('Helvetica').text(` — ${userName}: ${actionLabel}`);

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
        doc.fontSize(10).font('Helvetica').fillColor('#6b7280')
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

module.exports = {
  generateReviewPdf
};
