import ExcelJS from 'exceljs';

// ─── Export single report to Excel ────────────────────────────────────────────
// reportData: { doctor: {id, name, ...}, clinicReports: [...], periodLabel }
export async function exportReport(reportData) {
  const { doctor, clinicReports } = reportData;
  if (!clinicReports?.length) return;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'alfa-wiki';

  const fontTitle  = { name: 'Calibri', size: 14, bold: true };
  const fontBold   = { name: 'Calibri', size: 11, bold: true };
  const fontNormal = { name: 'Calibri', size: 11 };
  const fillHeader = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF4' } };
  const borderThin = { style: 'thin', color: { argb: 'FFAAAAAA' } };
  const allBorders = { top: borderThin, bottom: borderThin, left: borderThin, right: borderThin };

  const doctorName = typeof doctor === 'string' ? doctor : (doctor?.name || 'Врач');

  for (const { clinicId, clinicLabel, executorSections, salary } of clinicReports) {
    const safeName = (clinicLabel || 'Клиника').substring(0, 31);
    const ws = wb.addWorksheet(safeName);
    ws.columns = Array.from({ length: 6 }, () => ({ width: 8 }));
    ws.properties.outlineLevelRow = 2;

    const autoWidth = (row, numCols) => {
      for (let c = 1; c <= numCols; c++) {
        const len = String(row.getCell(c).value ?? '').length;
        const col = ws.getColumn(c);
        if (len + 2 > (col.width || 0)) col.width = Math.min(60, len + 2);
      }
    };

    const addSalRow = (label, value, sign) => {
      const colorMap = { '+': 'FF166534', '-': 'FFCC0000', '=': 'FF166534', '≡': 'FF1D4ED8' };
      const row = ws.addRow([sign, label, '', '', '', parseFloat((value || 0).toFixed(2))]);
      row.getCell(1).font = { ...fontBold, color: { argb: colorMap[sign] || 'FF000000' } };
      row.getCell(2).font = fontNormal;
      row.getCell(6).font = { ...fontBold, color: { argb: colorMap[sign] || 'FF000000' } };
      row.getCell(6).numFmt = '#,##0.00';
      ws.mergeCells(`B${row.number}:E${row.number}`);
      autoWidth(row, 6);
      return row;
    };

    const addTblHdr = (labels, lvl) => {
      const row = ws.addRow(labels);
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        if (c <= 6) { cell.font = fontBold; cell.fill = fillHeader; cell.border = allBorders; cell.alignment = { horizontal: 'center' }; }
      });
      autoWidth(row, 6);
      row.outlineLevel = lvl;
      row.hidden = true;
    };

    const addTblRow = (vals, lvl) => {
      const row = ws.addRow(vals);
      row.eachCell({ includeEmpty: true }, (cell, c) => { if (c <= 6) { cell.font = fontNormal; cell.border = allBorders; } });
      row.getCell(3).numFmt = '#,##0.00';
      row.getCell(6).numFmt = '#,##0.00';
      autoWidth(row, 6);
      row.outlineLevel = lvl;
      row.hidden = true;
    };

    const addSubHdr = (name, value, clr, lvl) => {
      const row = ws.addRow(['', name, '', '', '', parseFloat((value || 0).toFixed(2))]);
      row.getCell(2).font = { ...fontBold, color: { argb: clr } };
      row.getCell(6).font = { ...fontBold, color: { argb: clr } };
      row.getCell(6).numFmt = '#,##0.00';
      row.getCell(6).border = allBorders;
      ws.mergeCells(`B${row.number}:E${row.number}`);
      autoWidth(row, 6);
      row.outlineLevel = lvl;
      row.hidden = true;
    };

    // Заголовок
    const titleRow = ws.addRow([`${doctorName} — ${safeName}`]);
    titleRow.getCell(1).font = fontTitle;
    ws.mergeCells(`A${titleRow.number}:F${titleRow.number}`);
    autoWidth(titleRow, 1);
    ws.addRow([]);

    if (salary) {
      const sal = salary;
      ws.addRow([]);
      const salTitleRow = ws.addRow(['Расчёт зарплаты']);
      salTitleRow.getCell(1).font = { ...fontBold, size: 13 };
      salTitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
      ws.mergeCells(`A${salTitleRow.number}:F${salTitleRow.number}`);

      // Оклад / выработка
      if ((sal.basePay || 0) > 0 || sal.basePayLabel) {
        addSalRow(sal.basePayLabel || 'Оклад', sal.basePay, '≡');
        if ((sal.basePerformedSections || []).length) {
          addTblHdr(['Код услуги', 'Название услуги', 'Стоимость, руб', 'К-во', 'Бонус', 'Итого, руб'], 1);
          (sal.basePerformedSections || []).forEach(s =>
            addTblRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count || 1, s.bonusLabel || '', parseFloat((s.bonusAmount || 0).toFixed(2))], 1)
          );
        }
      }

      // Бонусы за направления
      if ((sal.referralBonuses || 0) > 0) {
        addSalRow('Бонусы за направления', sal.referralBonuses, '+');
        (sal.referralSections || []).forEach(({ executor, services }) => {
          const execTotal = services.reduce((a, x) => a + x.bonusAmount, 0);
          addSubHdr(executor, execTotal, 'FF166534', 1);
          addTblHdr(['Код услуги', 'Название услуги', 'Стоимость, руб', 'К-во', 'Бонус', 'Итого, руб'], 2);
          services.forEach(s => addTblRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count, s.bonusLabel, s.bonusAmount > 0 ? parseFloat(s.bonusAmount.toFixed(2)) : 0], 2));
        });
      }

      // Бонусы за выполненные услуги
      if ((sal.performedBonusTotal || 0) > 0) {
        addSalRow('Бонусы за выполненные услуги', sal.performedBonusTotal, '+');
        if ((sal.performedSections || []).length) {
          addTblHdr(['Код услуги', 'Название услуги', 'Стоимость, руб', 'К-во', 'Бонус', 'Итого, руб'], 1);
          (sal.performedSections || []).forEach(s => {
            const bonusAmt = parseFloat((s.bonusAmount || 0).toFixed(2));
            const row = ws.addRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count || 1, s.bonusLabel || '', bonusAmt]);
            row.eachCell({ includeEmpty: true }, (cell, c) => { if (c <= 6) { cell.font = fontNormal; cell.border = allBorders; } });
            row.getCell(3).numFmt = '#,##0.00';
            row.getCell(6).numFmt = '#,##0.00';
            if (bonusAmt < 0) row.getCell(6).font = { ...fontNormal, color: { argb: 'FFCC0000' } };
            autoWidth(row, 6);
            row.outlineLevel = 1;
            row.hidden = true;
          });
        }
      }

      // Дополнительно
      if ((sal.extrasTotal || 0) > 0) {
        addSalRow('Дополнительно', sal.extrasTotal, '+');
        if ((sal.extras || []).length) {
          addTblHdr(['Наименование', '', '', 'Кол-во ч', 'Ставка, руб', 'Итого, руб'], 1);
          (sal.extras || []).forEach(e => {
            const hrs = parseFloat(e.hours) || 0;
            addTblRow([
              e.name, '', '',
              hrs > 0 ? hrs : '',
              parseFloat(e.amount).toFixed(2),
              hrs > 0 ? parseFloat((parseFloat(e.amount) * hrs).toFixed(2)) : parseFloat(parseFloat(e.amount).toFixed(2))
            ], 1);
          });
        }
      }

      // Расходники / штрафы
      {
        const xlsAllDeds = sal.deductions || [];
        const xlsTurnoverDeds = xlsAllDeds.filter(d => d.deductionType !== 'final');
        if ((sal.finalDeductionsTotal || 0) > 0 || xlsTurnoverDeds.length > 0) {
          const xlsPreFinal = (sal.basePay || 0) + (sal.referralBonuses || 0) + (sal.performedBonusTotal || 0) + (sal.extrasTotal || 0) - (sal.referralCostTotal || 0);
          addSalRow('Расходники / штрафы / взыскания (от з/п)', sal.finalDeductionsTotal, '-');
          if (xlsAllDeds.length) {
            addTblHdr(['Наименование', 'База', '', '', 'Значение', 'Итого, руб'], 1);
            xlsAllDeds.forEach(d => {
              const v = parseFloat(d.value) || 0;
              const isTurnover = d.deductionType !== 'final';
              const base = isTurnover ? (sal.performedServicesSum || 0) : xlsPreFinal;
              const computed = d.valueType === 'percent' ? parseFloat((base * v / 100).toFixed(2)) : v;
              const row = ws.addRow([d.name + (isTurnover ? '*' : ''), isTurnover ? 'от оборота' : 'от з/п', '', '', d.valueType === 'percent' ? `${v}%` : `${v.toFixed(2)} ₽`, computed]);
              row.eachCell({ includeEmpty: true }, (cell, c) => {
                if (c <= 6) { cell.font = isTurnover ? { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true } : fontNormal; cell.border = allBorders; }
              });
              row.getCell(6).numFmt = '#,##0.00';
              if (isTurnover) row.getCell(6).font = { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true };
              autoWidth(row, 6); row.outlineLevel = 1; row.hidden = true;
            });
            if (xlsTurnoverDeds.length) {
              const noteRow = ws.addRow(['', '* Уже учтено при расчёте бонусов за выполненные услуги']);
              noteRow.getCell(2).font = { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true, size: 10 };
              ws.mergeCells(`B${noteRow.number}:F${noteRow.number}`);
              noteRow.outlineLevel = 1; noteRow.hidden = true;
            }
          }
        }
      }

      // Услуги ассистирования (вычет у основного врача)
      if ((sal.assistancePaidTotal || 0) > 0) {
        addSalRow('Услуги ассистирования', sal.assistancePaidTotal, '-');
      }

      // Материалы
      {
        const xlsAllMats = sal.materials || [];
        const xlsTurnoverMats = xlsAllMats.filter(m => m.deductionType !== 'final');
        if ((sal.finalMaterialsTotal || 0) > 0 || xlsTurnoverMats.length > 0) {
          const xlsPreFinal2 = (sal.basePay || 0) + (sal.referralBonuses || 0) + (sal.performedBonusTotal || 0) + (sal.extrasTotal || 0) - (sal.referralCostTotal || 0);
          addSalRow('Материалы (от з/п)', sal.finalMaterialsTotal, '-');
          if (xlsAllMats.length) {
            addTblHdr(['Наименование', 'База', '', '', 'Значение', 'Итого, руб'], 1);
            xlsAllMats.forEach(m => {
              const v = parseFloat(m.value) || 0;
              const isTurnover = m.deductionType !== 'final';
              const base = isTurnover ? (sal.performedServicesSum || 0) : xlsPreFinal2;
              const computed = m.valueType === 'percent' ? parseFloat((base * v / 100).toFixed(2)) : v;
              const row = ws.addRow([m.name + (isTurnover ? '*' : ''), isTurnover ? 'от оборота' : 'от з/п', '', '', m.valueType === 'percent' ? `${v}%` : `${v.toFixed(2)} ₽`, computed]);
              row.eachCell({ includeEmpty: true }, (cell, c) => {
                if (c <= 6) { cell.font = isTurnover ? { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true } : fontNormal; cell.border = allBorders; }
              });
              row.getCell(6).numFmt = '#,##0.00';
              if (isTurnover) row.getCell(6).font = { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true };
              autoWidth(row, 6); row.outlineLevel = 1; row.hidden = true;
            });
            if (xlsTurnoverMats.length) {
              const noteRow = ws.addRow(['', '* Уже учтено при расчёте бонусов за выполненные услуги']);
              noteRow.getCell(2).font = { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true, size: 10 };
              ws.mergeCells(`B${noteRow.number}:F${noteRow.number}`);
              noteRow.outlineLevel = 1; noteRow.hidden = true;
            }
          }
        }
      }

      // Бонусы направителям
      if ((sal.referralCostTotal || 0) > 0) {
        addSalRow('Бонусы направителям', sal.referralCostTotal, '-');
        (executorSections || sal.executorSections || []).forEach(({ referrer, services, total }) => {
          addSubHdr(referrer, total, 'FFCC0000', 1);
          addTblHdr(['Код услуги', 'Название услуги', 'Стоимость, руб', 'К-во', 'Бонус', 'К выплате, руб'], 2);
          services.forEach(s => addTblRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count, s.bonusLabel, s.bonusAmount > 0 ? -parseFloat(s.bonusAmount.toFixed(2)) : 0], 2));
        });
      }

      // Ассистирование (доход врача-ассистента)
      if ((sal.assistanceIncomeTotal || 0) > 0) {
        addSalRow('Ассистирование', sal.assistanceIncomeTotal, '+');
      }

      // Итого
      ws.addRow([]);
      const totalRow = ws.addRow(['=', 'К выплате', '', '', '', parseFloat((sal.finalSalary || 0).toFixed(2))]);
      const totalColor = (sal.finalSalary || 0) >= 0 ? 'FF166534' : 'FFCC0000';
      totalRow.getCell(1).font = { ...fontBold, size: 13, color: { argb: totalColor } };
      totalRow.getCell(2).font = { ...fontBold, size: 13, color: { argb: totalColor } };
      totalRow.getCell(6).font = { ...fontBold, size: 13, color: { argb: totalColor } };
      totalRow.getCell(6).numFmt = '#,##0.00';
      totalRow.getCell(6).border = allBorders;
      totalRow.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: (sal.finalSalary || 0) >= 0 ? 'FFD1FAE5' : 'FFFEE2E2' } };
      ws.mergeCells(`B${totalRow.number}:E${totalRow.number}`);
      autoWidth(totalRow, 6);

      // Аванс / тело з/п
      if ((sal.advance || 0) > 0 || (sal.mainPayment || 0) > 0) {
        if ((sal.advance || 0) > 0)
          addSalRow(`Аванс (${sal.paymentMethod === 'cash' ? 'наличные' : 'карта'})`, sal.advance, '-');
        if ((sal.mainPayment || 0) > 0)
          addSalRow(`Тело з/п (${sal.mainPaymentMethod === 'cash' ? 'наличные' : 'карта'})`, sal.mainPayment, '-');
        addSalRow('Остаток к выплате', (sal.finalSalary || 0) - (sal.advance || 0) - (sal.mainPayment || 0), '=');
      }
    }
  }

  // Скачать файл
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
  a.href = url;
  a.download = `Бонусы_${doctorName.split(' ')[0]}_${date}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Internal: write one doctor's clinic reports into a workbook ───────────────
function _writeClinicSheets(wb, clinicReports, doctorName, fontTitle, fontBold, fontNormal, fillHeader, allBorders) {
  const borderThin = { style: 'thin', color: { argb: 'FFAAAAAA' } };
  const bord = allBorders;

  for (const { clinicLabel, executorSections, salary } of clinicReports) {
    // Worksheet name: "Фамилия - Клиника", trimmed to 31 chars
    const lastName = doctorName.split(' ')[0] || doctorName;
    const sheetLabel = `${lastName} - ${clinicLabel || 'Клиника'}`;
    const safeName = sheetLabel.substring(0, 31);
    const ws = wb.addWorksheet(safeName);
    ws.columns = Array.from({ length: 6 }, () => ({ width: 8 }));
    ws.properties.outlineLevelRow = 2;

    const autoWidth = (row, numCols) => {
      for (let c = 1; c <= numCols; c++) {
        const len = String(row.getCell(c).value ?? '').length;
        const col = ws.getColumn(c);
        if (len + 2 > (col.width || 0)) col.width = Math.min(60, len + 2);
      }
    };

    const addSalRow = (label, value, sign) => {
      const colorMap = { '+': 'FF166534', '-': 'FFCC0000', '=': 'FF166534', '≡': 'FF1D4ED8' };
      const row = ws.addRow([sign, label, '', '', '', parseFloat((value || 0).toFixed(2))]);
      row.getCell(1).font = { ...fontBold, color: { argb: colorMap[sign] || 'FF000000' } };
      row.getCell(2).font = fontNormal;
      row.getCell(6).font = { ...fontBold, color: { argb: colorMap[sign] || 'FF000000' } };
      row.getCell(6).numFmt = '#,##0.00';
      ws.mergeCells(`B${row.number}:E${row.number}`);
      autoWidth(row, 6);
      return row;
    };

    const addTblHdr = (labels, lvl) => {
      const row = ws.addRow(labels);
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        if (c <= 6) { cell.font = fontBold; cell.fill = fillHeader; cell.border = bord; cell.alignment = { horizontal: 'center' }; }
      });
      autoWidth(row, 6);
      row.outlineLevel = lvl; row.hidden = true;
    };

    const addTblRow = (vals, lvl) => {
      const row = ws.addRow(vals);
      row.eachCell({ includeEmpty: true }, (cell, c) => { if (c <= 6) { cell.font = fontNormal; cell.border = bord; } });
      row.getCell(3).numFmt = '#,##0.00';
      row.getCell(6).numFmt = '#,##0.00';
      autoWidth(row, 6);
      row.outlineLevel = lvl; row.hidden = true;
    };

    const addSubHdr = (name, value, clr, lvl) => {
      const row = ws.addRow(['', name, '', '', '', parseFloat((value || 0).toFixed(2))]);
      row.getCell(2).font = { ...fontBold, color: { argb: clr } };
      row.getCell(6).font = { ...fontBold, color: { argb: clr } };
      row.getCell(6).numFmt = '#,##0.00';
      row.getCell(6).border = bord;
      ws.mergeCells(`B${row.number}:E${row.number}`);
      autoWidth(row, 6);
      row.outlineLevel = lvl; row.hidden = true;
    };

    // Title
    const titleRow = ws.addRow([`${doctorName} — ${clinicLabel}`]);
    titleRow.getCell(1).font = fontTitle;
    ws.mergeCells(`A${titleRow.number}:F${titleRow.number}`);
    autoWidth(titleRow, 1);
    ws.addRow([]);

    if (salary) {
      const sal = salary;
      ws.addRow([]);
      const salTitleRow = ws.addRow(['Расчёт зарплаты']);
      salTitleRow.getCell(1).font = { ...fontBold, size: 13 };
      salTitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
      ws.mergeCells(`A${salTitleRow.number}:F${salTitleRow.number}`);

      if ((sal.basePay || 0) > 0 || sal.basePayLabel) {
        addSalRow(sal.basePayLabel || 'Оклад', sal.basePay, '≡');
        if ((sal.basePerformedSections || []).length) {
          addTblHdr(['Код услуги', 'Название услуги', 'Стоимость, руб', 'К-во', 'Бонус', 'Итого, руб'], 1);
          (sal.basePerformedSections || []).forEach(s =>
            addTblRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count || 1, s.bonusLabel || '', parseFloat((s.bonusAmount || 0).toFixed(2))], 1)
          );
        }
      }

      if ((sal.referralBonuses || 0) > 0) {
        addSalRow('Бонусы за направления', sal.referralBonuses, '+');
        (sal.referralSections || []).forEach(({ executor, services }) => {
          const execTotal = services.reduce((a, x) => a + x.bonusAmount, 0);
          addSubHdr(executor, execTotal, 'FF166534', 1);
          addTblHdr(['Код услуги', 'Название услуги', 'Стоимость, руб', 'К-во', 'Бонус', 'Итого, руб'], 2);
          services.forEach(s => addTblRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count, s.bonusLabel, s.bonusAmount > 0 ? parseFloat(s.bonusAmount.toFixed(2)) : 0], 2));
        });
      }

      if ((sal.performedBonusTotal || 0) > 0) {
        addSalRow('Бонусы за выполненные услуги', sal.performedBonusTotal, '+');
        if ((sal.performedSections || []).length) {
          addTblHdr(['Код услуги', 'Название услуги', 'Стоимость, руб', 'К-во', 'Бонус', 'Итого, руб'], 1);
          (sal.performedSections || []).forEach(s => {
            const bonusAmt = parseFloat((s.bonusAmount || 0).toFixed(2));
            const row = ws.addRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count || 1, s.bonusLabel || '', bonusAmt]);
            row.eachCell({ includeEmpty: true }, (cell, c) => { if (c <= 6) { cell.font = fontNormal; cell.border = bord; } });
            row.getCell(3).numFmt = '#,##0.00'; row.getCell(6).numFmt = '#,##0.00';
            if (bonusAmt < 0) row.getCell(6).font = { ...fontNormal, color: { argb: 'FFCC0000' } };
            autoWidth(row, 6);
            row.outlineLevel = 1; row.hidden = true;
          });
        }
      }

      if ((sal.extrasTotal || 0) > 0) {
        addSalRow('Дополнительно', sal.extrasTotal, '+');
        if ((sal.extras || []).length) {
          addTblHdr(['Наименование', '', '', 'Кол-во ч', 'Ставка, руб', 'Итого, руб'], 1);
          (sal.extras || []).forEach(e => {
            const hrs = parseFloat(e.hours) || 0;
            addTblRow([e.name, '', '', hrs > 0 ? hrs : '', parseFloat(e.amount).toFixed(2),
              hrs > 0 ? parseFloat((parseFloat(e.amount) * hrs).toFixed(2)) : parseFloat(parseFloat(e.amount).toFixed(2))], 1);
          });
        }
      }

      {
        const xlsAllDeds = sal.deductions || [];
        const xlsTurnoverDeds = xlsAllDeds.filter(d => d.deductionType !== 'final');
        if ((sal.finalDeductionsTotal || 0) > 0 || xlsTurnoverDeds.length > 0) {
          const xlsPreFinal = (sal.basePay || 0) + (sal.referralBonuses || 0) + (sal.performedBonusTotal || 0) + (sal.extrasTotal || 0) - (sal.referralCostTotal || 0);
          addSalRow('Расходники / штрафы / взыскания (от з/п)', sal.finalDeductionsTotal, '-');
          if (xlsAllDeds.length) {
            addTblHdr(['Наименование', 'База', '', '', 'Значение', 'Итого, руб'], 1);
            xlsAllDeds.forEach(d => {
              const v = parseFloat(d.value) || 0;
              const isTurnover = d.deductionType !== 'final';
              const base = isTurnover ? (sal.performedServicesSum || 0) : xlsPreFinal;
              const computed = d.valueType === 'percent' ? parseFloat((base * v / 100).toFixed(2)) : v;
              const row = ws.addRow([d.name + (isTurnover ? '*' : ''), isTurnover ? 'от оборота' : 'от з/п', '', '', d.valueType === 'percent' ? `${v}%` : `${v.toFixed(2)} ₽`, computed]);
              row.eachCell({ includeEmpty: true }, (cell, c) => {
                if (c <= 6) { cell.font = isTurnover ? { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true } : fontNormal; cell.border = bord; }
              });
              row.getCell(6).numFmt = '#,##0.00';
              if (isTurnover) row.getCell(6).font = { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true };
              autoWidth(row, 6); row.outlineLevel = 1; row.hidden = true;
            });
            if (xlsTurnoverDeds.length) {
              const noteRow = ws.addRow(['', '* Уже учтено при расчёте бонусов за выполненные услуги']);
              noteRow.getCell(2).font = { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true, size: 10 };
              ws.mergeCells(`B${noteRow.number}:F${noteRow.number}`);
              noteRow.outlineLevel = 1; noteRow.hidden = true;
            }
          }
        }
      }

      // Услуги ассистирования (вычет у основного врача)
      if ((sal.assistancePaidTotal || 0) > 0) {
        addSalRow('Услуги ассистирования', sal.assistancePaidTotal, '-');
      }

      {
        const xlsAllMats = sal.materials || [];
        const xlsTurnoverMats = xlsAllMats.filter(m => m.deductionType !== 'final');
        if ((sal.finalMaterialsTotal || 0) > 0 || xlsTurnoverMats.length > 0) {
          addSalRow('Материалы (от з/п)', sal.finalMaterialsTotal, '-');
          if (xlsAllMats.length) {
            addTblHdr(['Наименование', 'База', '', '', 'Значение', 'Итого, руб'], 1);
            const xlsPreFinal2 = (sal.basePay || 0) + (sal.referralBonuses || 0) + (sal.performedBonusTotal || 0) + (sal.extrasTotal || 0) - (sal.referralCostTotal || 0);
            xlsAllMats.forEach(m => {
              const v = parseFloat(m.value) || 0;
              const isTurnover = m.deductionType !== 'final';
              const base = isTurnover ? (sal.performedServicesSum || 0) : xlsPreFinal2;
              const computed = m.valueType === 'percent' ? parseFloat((base * v / 100).toFixed(2)) : v;
              const row = ws.addRow([m.name + (isTurnover ? '*' : ''), isTurnover ? 'от оборота' : 'от з/п', '', '', m.valueType === 'percent' ? `${v}%` : `${v.toFixed(2)} ₽`, computed]);
              row.eachCell({ includeEmpty: true }, (cell, c) => {
                if (c <= 6) { cell.font = isTurnover ? { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true } : fontNormal; cell.border = bord; }
              });
              row.getCell(6).numFmt = '#,##0.00';
              if (isTurnover) row.getCell(6).font = { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true };
              autoWidth(row, 6); row.outlineLevel = 1; row.hidden = true;
            });
            if (xlsTurnoverMats.length) {
              const noteRow = ws.addRow(['', '* Уже учтено при расчёте бонусов за выполненные услуги']);
              noteRow.getCell(2).font = { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true, size: 10 };
              ws.mergeCells(`B${noteRow.number}:F${noteRow.number}`);
              noteRow.outlineLevel = 1; noteRow.hidden = true;
            }
          }
        }
      }

      if ((sal.referralCostTotal || 0) > 0) {
        addSalRow('Бонусы направителям', sal.referralCostTotal, '-');
        (executorSections || sal.executorSections || []).forEach(({ referrer, services, total }) => {
          addSubHdr(referrer, total, 'FFCC0000', 1);
          addTblHdr(['Код услуги', 'Название услуги', 'Стоимость, руб', 'К-во', 'Бонус', 'К выплате, руб'], 2);
          services.forEach(s => addTblRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count, s.bonusLabel, s.bonusAmount > 0 ? -parseFloat(s.bonusAmount.toFixed(2)) : 0], 2));
        });
      }

      // Ассистирование (доход врача-ассистента)
      if ((sal.assistanceIncomeTotal || 0) > 0) {
        addSalRow('Ассистирование', sal.assistanceIncomeTotal, '+');
      }

      ws.addRow([]);
      const totalRow = ws.addRow(['=', 'К выплате', '', '', '', parseFloat((sal.finalSalary || 0).toFixed(2))]);
      const totalColor = (sal.finalSalary || 0) >= 0 ? 'FF166534' : 'FFCC0000';
      totalRow.getCell(1).font = { ...fontBold, size: 13, color: { argb: totalColor } };
      totalRow.getCell(2).font = { ...fontBold, size: 13, color: { argb: totalColor } };
      totalRow.getCell(6).font = { ...fontBold, size: 13, color: { argb: totalColor } };
      totalRow.getCell(6).numFmt = '#,##0.00';
      totalRow.getCell(6).border = bord;
      totalRow.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: (sal.finalSalary || 0) >= 0 ? 'FFD1FAE5' : 'FFFEE2E2' } };
      ws.mergeCells(`B${totalRow.number}:E${totalRow.number}`);
      autoWidth(totalRow, 6);

      if ((sal.advance || 0) > 0 || (sal.mainPayment || 0) > 0) {
        if ((sal.advance || 0) > 0)
          addSalRow(`Аванс (${sal.paymentMethod === 'cash' ? 'наличные' : 'карта'})`, sal.advance, '-');
        if ((sal.mainPayment || 0) > 0)
          addSalRow(`Тело з/п (${sal.mainPaymentMethod === 'cash' ? 'наличные' : 'карта'})`, sal.mainPayment, '-');
        addSalRow('Остаток к выплате', (sal.finalSalary || 0) - (sal.advance || 0) - (sal.mainPayment || 0), '=');
      }
    }
  }
}

// ─── Export bulk report to Excel (one sheet per clinic per doctor) ─────────────
// bulkResults: [{doctor, clinicReports, periodLabel, dateFrom, dateTo}]
export async function exportBulkReport(bulkResults, { dateFrom, dateTo } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'alfa-wiki';

  const fontTitle  = { name: 'Calibri', size: 14, bold: true };
  const fontBold   = { name: 'Calibri', size: 11, bold: true };
  const fontNormal = { name: 'Calibri', size: 11 };
  const fillHeader = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF4' } };
  const borderThin = { style: 'thin', color: { argb: 'FFAAAAAA' } };
  const allBorders = { top: borderThin, bottom: borderThin, left: borderThin, right: borderThin };

  // Summary sheet
  const summaryWs = wb.addWorksheet('Сводка');
  summaryWs.columns = [{ width: 40 }, { width: 20 }, { width: 20 }, { width: 20 }];
  const hdr = summaryWs.addRow(['Врач', 'Клиника', 'К выплате, руб', 'Период']);
  hdr.eachCell({ includeEmpty: true }, (cell, c) => {
    if (c <= 4) { cell.font = fontBold; cell.fill = fillHeader; cell.border = allBorders; cell.alignment = { horizontal: 'center' }; }
  });

  for (const r of bulkResults) {
    if (r.error || !r.clinicReports?.length) {
      const eRow = summaryWs.addRow([r.doctor?.name || '—', 'Ошибка: ' + (r.error || 'нет данных'), '', r.periodLabel || '']);
      eRow.getCell(2).font = { ...fontNormal, color: { argb: 'FFCC0000' } };
      continue;
    }
    const doctorName = r.doctor?.name || 'Врач';
    r.clinicReports.forEach(cr => {
      const row = summaryWs.addRow([doctorName, cr.clinicLabel || '—', parseFloat((cr.salary?.finalSalary || 0).toFixed(2)), r.periodLabel || '']);
      row.eachCell({ includeEmpty: true }, (cell, c) => { if (c <= 4) { cell.font = fontNormal; cell.border = allBorders; } });
      row.getCell(3).numFmt = '#,##0.00';
      row.getCell(3).font = { ...fontNormal, color: { argb: (cr.salary?.finalSalary || 0) >= 0 ? 'FF166534' : 'FFCC0000' } };
    });
  }

  // Per-doctor clinic sheets
  for (const r of bulkResults) {
    if (r.error || !r.clinicReports?.length) continue;
    const doctorName = r.doctor?.name || 'Врач';
    _writeClinicSheets(wb, r.clinicReports, doctorName, fontTitle, fontBold, fontNormal, fillHeader, allBorders);
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
  a.href = url;
  a.download = `Сводный_отчёт_${date}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
