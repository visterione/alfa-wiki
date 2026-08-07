'use strict';

/**
 * Отчёт по файлу импорта прайса в МИС.
 *
 * CSV уходит в МИС, а этот отчёт — людям: что именно подорожает и на сколько,
 * а внизу — позиции, которые в файл не попали и которые придётся править
 * руками. Считает всё страница сравнения: у неё в руках прейскурант МИС и
 * цены листа, и отчёт обязан совпадать с файлом строка в строку — поэтому
 * здесь только вёрстка, без собственных расчётов.
 *
 * PDF собирается тем же pdfkit и теми же шрифтами DejaVu, что и остальные
 * отчёты вики: своих шрифтов с кириллицей у pdfkit нет.
 */

const PDFDocument = require('pdfkit');
const path = require('path');

// Разряды пробелом, копейки — только когда они есть: в прайсе лаборатории
// круглых цен большинство, и «325.00» рядом с «325» читается хуже
function money(value) {
  const number = Math.round((parseFloat(value) || 0) * 100) / 100;
  const text = number % 1 === 0 ? String(number) : number.toFixed(2);
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function signedMoney(value) {
  const number = Math.round((parseFloat(value) || 0) * 100) / 100;
  return (number > 0 ? '+' : number < 0 ? '−' : '') + money(Math.abs(number));
}

function formatDateTime(date) {
  return date.toLocaleDateString('ru-RU', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function generateMisImportPdf(stream, data) {
  return new Promise((resolve, reject) => {
    try {
      const {
        comparisonName = '',
        target = '',
        source = '',
        rule = '',
        rounding = '',
        rows = [],
        skipped = {},
        generatedBy = null
      } = data;

      const now = new Date();
      const doc = new PDFDocument({
        margin: 40, size: 'A4',
        info: {
          Title: 'Изменение прайса ' + target,
          Author: 'Alfa Wiki',
          Subject: 'Отчёт по файлу импорта прайса в МИС',
          CreationDate: now
        }
      });

      const fontsDir = path.join(__dirname, '..', 'fonts');
      doc.registerFont('DejaVu', path.join(fontsDir, 'DejaVuSans.ttf'));
      doc.registerFont('DejaVu-Bold', path.join(fontsDir, 'DejaVuSans-Bold.ttf'));
      doc.pipe(stream);

      // Портретная A4: 595 × 842 при полях 40
      const LEFT = 40, RIGHT = 555, BOTTOM = 790;

      /**
       * Таблица рисуется одним и тем же кодом для основного списка и для
       * разделов внизу: колонки у них разные, а поведение одинаковое —
       * перенос длинных названий, сетка, повтор шапки на новой странице.
       */
      function table(cols) {
        let cx = LEFT;
        cols.forEach(c => { c.x = cx; cx += c.w; });
        const width = cx - LEFT;

        function row(cells, opts) {
          opts = opts || {};
          const isHeader = !!opts.header;
          doc.font(isHeader ? 'DejaVu-Bold' : 'DejaVu').fontSize(isHeader ? 9 : 8.5);

          let rowH = 0;
          cols.forEach(c => {
            const text = String(cells[c.key] == null ? '' : cells[c.key]);
            const h = doc.heightOfString(text, { width: c.w - 6 });
            if (h > rowH) rowH = h;
          });
          rowH = Math.max(rowH, isHeader ? 13 : 12) + 6;

          if (!isHeader && doc.y + rowH > BOTTOM) { doc.addPage(); header(); }

          const y = doc.y;
          if (isHeader) { doc.save(); doc.rect(LEFT, y, width, rowH).fill('#f1f5f9'); doc.restore(); }

          doc.lineWidth(0.6).strokeColor('#94a3b8');
          cols.forEach(c => doc.rect(c.x, y, c.w, rowH).stroke());

          cols.forEach(c => {
            const color = isHeader ? '#1f2937' : (opts.colors && opts.colors[c.key]) || '#374151';
            doc.font(isHeader || (opts.bold && opts.bold[c.key]) ? 'DejaVu-Bold' : 'DejaVu')
              .fillColor(color)
              .text(String(cells[c.key] == null ? '' : cells[c.key]), c.x + 3, y + 3,
                { width: c.w - 6, align: c.align || 'left' });
          });

          doc.fillColor('#000000');
          doc.y = y + rowH;
        }

        function header() {
          const cells = {};
          cols.forEach(c => { cells[c.key] = c.title; });
          row(cells, { header: true });
        }

        return { row, header };
      }

      function sectionTitle(text, color) {
        if (doc.y + 60 > BOTTOM) doc.addPage();
        doc.moveDown(0.8);
        doc.fontSize(12).font('DejaVu-Bold').fillColor(color || '#1f2937').text(text, LEFT, doc.y);
        doc.fillColor('#000000').moveDown(0.2);
      }

      function note(text) {
        doc.fontSize(9).font('DejaVu').fillColor('#6b7280')
          .text(text, LEFT, doc.y, { width: RIGHT - LEFT });
        doc.fillColor('#000000').moveDown(0.4);
      }

      // ── Шапка документа ──
      doc.fontSize(16).font('DejaVu-Bold').fillColor('#1f2937')
        .text('Изменение прайса: ' + target, LEFT, doc.y, { width: RIGHT - LEFT });
      doc.moveDown(0.3);

      const subtitle = ['Цены взяты из колонки «' + source + '»'];
      if (rule) subtitle.push(rule);
      if (rounding) subtitle.push('округление ' + rounding);
      doc.fontSize(10).font('DejaVu').fillColor('#374151')
        .text(subtitle.join(' · '), LEFT, doc.y, { width: RIGHT - LEFT });

      doc.fontSize(9).fillColor('#6b7280').text(
        (comparisonName ? 'Лист «' + comparisonName + '» · ' : '') +
        'сформирован ' + formatDateTime(now) +
        (generatedBy ? ' · ' + generatedBy : ''),
        LEFT, doc.y + 3, { width: RIGHT - LEFT }
      );
      doc.fillColor('#000000').moveDown(0.9);

      // ── Сводка ──
      // Итоговые суммы считаем от того, что реально уйдёт в МИС: у части
      // услуг прежней цены на листе может не быть, и в «было» они не входят
      let sumWas = 0, sumNow = 0, up = 0, down = 0, same = 0;
      rows.forEach(r => {
        const was = parseFloat(r.was);
        const price = parseFloat(r.price) || 0;
        sumNow += price;
        if (was > 0) {
          sumWas += was;
          if (price > was) up++; else if (price < was) down++; else same++;
        }
      });

      const summary = [
        'Услуг в файле: ' + rows.length,
        'дороже: ' + up,
        'дешевле: ' + down,
        'без изменений: ' + same
      ];
      doc.fontSize(10).font('DejaVu-Bold').fillColor('#1f2937')
        .text(summary.join('   ·   '), LEFT, doc.y, { width: RIGHT - LEFT });
      if (sumWas > 0) {
        const growth = Math.round((sumNow / sumWas) * 100 - 100);
        doc.fontSize(9).font('DejaVu').fillColor('#6b7280').text(
          'Сумма прайса по этим услугам: ' + money(sumWas) + ' → ' + money(sumNow) + ' ₽' +
          ' (' + (growth > 0 ? '+' : '') + growth + '%)',
          LEFT, doc.y + 3, { width: RIGHT - LEFT }
        );
      }
      doc.fillColor('#000000').moveDown(0.8);

      // ── Что меняем ──
      if (!rows.length) {
        note('В файл не вошла ни одна услуга.');
      } else {
        const main = table([
          { key: 'idx',   title: '№',        w: 26 },
          { key: 'code',  title: 'Артикул',  w: 78 },
          { key: 'title', title: 'Услуга',   w: 231 },
          { key: 'was',   title: 'Было, ₽',  w: 60, align: 'right' },
          { key: 'now',   title: 'Станет, ₽', w: 60, align: 'right' },
          { key: 'diff',  title: 'Разница',  w: 60, align: 'right' }
        ]);
        main.header();
        rows.forEach((r, i) => {
          const was = parseFloat(r.was);
          const price = parseFloat(r.price) || 0;
          const diff = was > 0 ? price - was : null;
          main.row({
            idx: i + 1,
            code: r.code || '',
            title: r.title || '',
            was: was > 0 ? money(was) : '—',
            now: money(price),
            diff: diff == null ? '—' : signedMoney(diff)
          }, {
            bold: { now: true, diff: true },
            colors: {
              now: '#16a34a',
              diff: diff == null ? '#9ca3af' : diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : '#6b7280'
            }
          });
        });
      }

      // ── Что придётся править руками ──
      const ambiguous = skipped.ambiguous || [];
      const noSource = skipped.noSource || [];
      const noArticle = skipped.noArticle || [];

      if (ambiguous.length) {
        sectionTitle('Править вручную: несколько артикулов — ' + ambiguous.length, '#b45309');
        note('У этих кодов 804н в лаборатории «' + target + '» заведено больше одной услуги — ' +
          'обычная и, например, профосмотровая, с разными ценами. Какую из них поднимать, ' +
          'решает человек, поэтому в файл они не вошли: поправьте их в МИС по артикулам ниже.');

        const t = table([
          { key: 'code',  title: 'Код 804н', w: 85 },
          { key: 'title', title: 'Услуга на листе', w: 180 },
          { key: 'refs',  title: 'Артикулы в МИС', w: 250 }
        ]);
        t.header();
        ambiguous.forEach(item => {
          t.row({
            code: item.code || '—',
            title: item.title || '',
            refs: (item.refs || []).map(ref => {
              const parts = [ref.code];
              if (ref.price) parts.push(money(ref.price) + ' ₽');
              if (ref.title) parts.push(ref.title);
              if (ref.categoryPath) parts.push(ref.categoryPath);
              return parts.join(' · ');
            }).join('\n')
          }, { bold: { code: true } });
        });
      }

      function plainList(title, why, items, color) {
        if (!items.length) return;
        sectionTitle(title + ' — ' + items.length, color);
        note(why);
        const t = table([
          { key: 'idx',   title: '№',        w: 26 },
          { key: 'code',  title: 'Код 804н', w: 85 },
          { key: 'title', title: 'Услуга',   w: 404 }
        ]);
        t.header();
        items.forEach((item, i) => {
          t.row({ idx: i + 1, code: item.code || '—', title: item.title || '' });
        });
      }

      plainList(
        'Не изменены: нет цены в колонке «' + source + '»',
        'Брать новую цену неоткуда — в колонке-источнике у этих услуг пусто.',
        noSource, '#1f2937'
      );

      plainList(
        'Не изменены: нет в прайсе «' + target + '»',
        'Этих услуг мы не оказываем: артикула этой лаборатории в МИС у них нет, ' +
        'обновлять в прейскуранте нечего.',
        noArticle, '#1f2937'
      );

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { generateMisImportPdf };
