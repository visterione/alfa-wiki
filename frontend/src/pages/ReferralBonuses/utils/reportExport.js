import ExcelJS from 'exceljs';

// ─── Shared style helpers ──────────────────────────────────────────────────────
function _makeStyles() {
  const borderThin = { style: 'thin', color: { argb: 'FFAAAAAA' } };
  return {
    fontTitle:  { name: 'Calibri', size: 14, bold: true },
    fontBold:   { name: 'Calibri', size: 11, bold: true },
    fontNormal: { name: 'Calibri', size: 11 },
    fillHeader: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EEF4' } },
    allBorders: { top: borderThin, bottom: borderThin, left: borderThin, right: borderThin },
  };
}

// ─── Internal: write one clinic sheet into a workbook ─────────────────────────
function _writeOneClinicSheet(wb, sheetName, doctorName, clinicLabel, executorSections, salary, fontTitle, fontBold, fontNormal, fillHeader, allBorders, cashPayments, totalRemainder) {
  const ws = wb.addWorksheet(sheetName);
  ws.columns = Array.from({ length: 6 }, () => ({ width: 8 }));
  ws.properties.outlineLevelRow = 3;
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  const autoWidth = (row, numCols) => {
    for (let c = 1; c <= numCols; c++) {
      const len = String(row.getCell(c).value ?? '').length;
      const col = ws.getColumn(c);
      if (len + 2 > (col.width || 0)) col.width = Math.min(60, len + 2);
    }
  };

  const addSalRow = (label, value, sign, _collapsed = false) => {
    const colorMap = { '+': 'FF166534', '-': 'FFCC0000', '=': 'FF166534', '≡': 'FF1D4ED8' };
    const row = ws.addRow([label, '', '', '', '', parseFloat((value || 0).toFixed(2))]);
    row.getCell(1).font = fontBold;
    row.getCell(6).font = { ...fontBold, color: { argb: colorMap[sign] || 'FF000000' } };
    row.getCell(6).numFmt = '#,##0.00';
    ws.mergeCells(`A${row.number}:E${row.number}`);
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
    return row;
  };

  const addSubHdr = (name, value, clr, lvl, hasChildren = true) => {
    const row = ws.addRow([name, '', '', '', '', parseFloat((value || 0).toFixed(2))]);
    row.getCell(1).font = { ...fontBold, color: { argb: clr } };
    row.getCell(6).font = { ...fontBold, color: { argb: clr } };
    row.getCell(6).numFmt = '#,##0.00';
    row.getCell(6).border = allBorders;
    ws.mergeCells(`A${row.number}:E${row.number}`);
    autoWidth(row, 6);
    row.outlineLevel = lvl;
    row.hidden = true;
    return row;
  };

  // Заголовок
  const titleRow = ws.addRow([`${doctorName} — ${clinicLabel}`]);
  titleRow.getCell(1).font = fontTitle;
  ws.mergeCells(`A${titleRow.number}:F${titleRow.number}`);
  autoWidth(titleRow, 1);
  ws.addRow([]);

  if (salary) {
    const sal = salary;
    ws.addRow([]);
    const salTitleRow = ws.addRow(['Расчётный лист']);
    salTitleRow.getCell(1).font = { ...fontBold, size: 13 };
    salTitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    ws.mergeCells(`A${salTitleRow.number}:F${salTitleRow.number}`);

    // Оклад / выработка
    if ((sal.basePay || 0) > 0 || sal.basePayLabel) {
      const _hasWageChildren = (sal.basePerformedSections || []).length > 0 || (sal.payType === 'hourly' && (sal.hourlyRate || 0) > 0) || (sal.payType === 'normed' && (sal.normServices || []).length > 0);
      addSalRow(sal.basePayLabel || 'Оклад', sal.basePay, '≡', _hasWageChildren);
      if ((sal.basePerformedSections || []).length) {
        addTblHdr(['Код услуги', 'Название услуги', 'Стоимость, руб', 'К-во', 'Бонус', 'Итого, руб'], 1);
        (sal.basePerformedSections || []).forEach(s =>
          addTblRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count || 1, s.bonusLabel || '', parseFloat((s.bonusAmount || 0).toFixed(2))], 1)
        );
      }
      // Почасовой тип: детализация (с fallback для старых записей)
      if (sal.payType === 'hourly') {
        let _xRate = sal.hourlyRate || 0, _xHours = sal.hoursWorked || 0;
        if ((!_xRate || !_xHours) && sal.basePayLabel) {
          const _m = sal.basePayLabel.match(/\((\d+(?:[.,]\d+)?)\s*[₽р][^×x*]*[×x*]\s*(\d+(?:[.,]\d+)?)\s*ч\)/);
          if (_m) { _xRate = parseFloat(_m[1].replace(',', '.')) || 0; _xHours = parseFloat(_m[2].replace(',', '.')) || 0; }
        }
        if (_xRate > 0) {
          addTblHdr(['Ставка, ₽/ч', '', '', 'Часов', '', 'Итого, руб'], 1);
          addTblRow([parseFloat(_xRate.toFixed(2)), '', '', _xHours, '', parseFloat((_xRate * _xHours).toFixed(2))], 1);
        }
      }
      // Нормированный тип: детализация по видам деятельности
      if (sal.payType === 'normed' && (sal.normServices || []).length > 0) {
        addTblHdr(['Деятельность', '', '', 'Часов', 'Ставка, ₽/ч', 'Итого, руб'], 1);
        if ((sal.fixedSalary || 0) > 0) {
          addTblRow(['Оклад', '', '', '', '', parseFloat((sal.fixedSalary || 0).toFixed(2))], 1);
        }
        (sal.normServices || []).forEach(ns => {
          const rate = parseFloat(ns.rate) || 0;
          const hrs  = parseFloat(ns.hours) || 0;
          addTblRow([ns.name || '—', '', '', hrs, rate, parseFloat((rate * hrs).toFixed(2))], 1);
        });
        if ((sal.normPremiumAmount || 0) > 0 && sal.normHoursForPeriod != null) {
          addTblRow(['Премия', '', '', '', '', parseFloat((sal.normPremiumAmount || 0).toFixed(2))], 1);
        }
      }
    }

    // Бонусы за направления
    if ((sal.referralBonuses || 0) > 0) {
      addSalRow('Бонусы за направления', sal.referralBonuses, '+', (sal.referralSections || []).length > 0);
      (sal.referralSections || []).forEach(({ executor, services }) => {
        const execTotal = services.reduce((a, x) => a + x.bonusAmount, 0);
        addSubHdr(executor, execTotal, 'FF166534', 1);
        addTblHdr(['Код услуги', 'Название услуги', 'Стоимость, руб', 'К-во', 'Бонус', 'Итого, руб'], 2);
        services.forEach(s => addTblRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count, s.bonusLabel, s.bonusAmount > 0 ? parseFloat(s.bonusAmount.toFixed(2)) : 0], 2));
      });
    }

    // Выполненные услуги (все роли: Врач, Ассистент, Медсестра, Анестезиолог)
    {
      const _perfDoctor   = sal.performedBonusTotal || 0;
      const _perfAsst     = sal.assistanceIncomeTotal || 0;
      const _perfNurse    = sal.nurseIncomeTotal || 0;
      const _perfAnest    = sal.anesthesiologistIncomeTotal || 0;
      const _perfCombined = _perfDoctor + _perfAsst + _perfNurse + _perfAnest;
      if (_perfCombined !== 0 || (sal.performedSections || []).length > 0) {
        addSalRow('Выполненные услуги', _perfCombined, _perfCombined >= 0 ? '+' : '-', true);

        // Врач
        if (_perfDoctor !== 0 || (sal.performedSections || []).length > 0) {
          addSubHdr('Врач', _perfDoctor, 'FF166534', 1);
          if ((sal.performedSections || []).length) {
            addSubHdr(doctorName, _perfDoctor, 'FF166534', 2);
            addTblHdr(['Код услуги', 'Название услуги', 'Стоимость, руб', 'К-во', 'Бонус', 'Итого, руб'], 3);
            (sal.performedSections || []).forEach(s => {
              const bonusAmt = parseFloat((s.bonusAmount || 0).toFixed(2));
              const row = ws.addRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count || 1, s.bonusLabel || '', bonusAmt]);
              row.eachCell({ includeEmpty: true }, (cell, c) => { if (c <= 6) { cell.font = fontNormal; cell.border = allBorders; } });
              row.getCell(3).numFmt = '#,##0.00';
              row.getCell(4).numFmt = '#,##0';
              row.getCell(6).numFmt = '#,##0.00';
              if (bonusAmt < 0) row.getCell(6).font = { ...fontNormal, color: { argb: 'FFCC0000' } };
              autoWidth(row, 6);
              row.outlineLevel = 3; row.hidden = true;
            });
          }
        }

        // Ассистент
        if (_perfAsst !== 0 || (sal.assistanceIncomeSections || []).length > 0) {
          addSubHdr('Ассистент', _perfAsst, 'FF166534', 1);
          (sal.assistanceIncomeSections || []).forEach(({ execName, total, services }) => {
            addSubHdr(execName, total, 'FF166534', 2);
            if ((services || []).length > 0) {
              addTblHdr(['Код', 'Услуга', 'Стоимость, руб', 'К-во', 'Ставка', 'Итого, руб'], 3);
              services.forEach(s => {
                const r = addTblRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count || 1,
                  s.aValue ? (s.aValueType === 'rub' ? `${s.aValue} ₽` : `${s.aValue}%`) : (s.aPct ? `${s.aPct}%` : '—'),
                  parseFloat((s.income || 0).toFixed(2))], 3);
                r.getCell(4).numFmt = '#,##0';
              });
            }
          });
        }

        // Медсестра
        if (_perfNurse !== 0 || (sal.nurseIncomeSections || []).length > 0) {
          addSubHdr('Медсестра', _perfNurse, 'FF166534', 1);
          (sal.nurseIncomeSections || []).forEach(({ execName, total, services }) => {
            addSubHdr(execName, total, 'FF166534', 2);
            if ((services || []).length > 0) {
              addTblHdr(['Код', 'Услуга', 'Стоимость, руб', 'К-во', 'Ставка', 'Итого, руб'], 3);
              services.forEach(s => {
                const r = addTblRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count || 1,
                  s.aValue ? (s.aValueType === 'rub' ? `${s.aValue} ₽` : `${s.aValue}%`) : '—',
                  parseFloat((s.income || 0).toFixed(2))], 3);
                r.getCell(4).numFmt = '#,##0';
              });
            }
          });
        }

        // Анестезиолог
        if (_perfAnest !== 0 || (sal.anesthesiologistIncomeSections || []).length > 0) {
          const _anestPos = _perfAnest >= 0;
          addSubHdr('Анестезиолог', _perfAnest, _anestPos ? 'FF166534' : 'FFCC0000', 1);
          (sal.anesthesiologistIncomeSections || []).forEach(({ execName, total, services }) => {
            const _secPos = total >= 0;
            addSubHdr(execName, total, _secPos ? 'FF166534' : 'FFCC0000', 2);
            if ((services || []).length > 0) {
              addTblHdr(['Код', 'Услуга', 'К-во', 'Правило', 'Ставка', 'Итого, руб'], 3);
              services.forEach(s => {
                const inc = parseFloat((s.income || 0).toFixed(2));
                const r = ws.addRow([s.code || '—', s.name || '—', s.count || 1,
                  s.ruleContains ? `содержит «${s.ruleContains}»` : '—',
                  s.aValue ? (s.aValueType === 'rub' ? `${s.aValue} ₽` : `${s.aValue}%`) : '—',
                  inc]);
                r.eachCell({ includeEmpty: true }, (cell, c) => { if (c <= 6) { cell.font = fontNormal; cell.border = allBorders; } });
                r.getCell(3).numFmt = '#,##0';
                r.getCell(6).numFmt = '#,##0.00';
                if (inc < 0) r.getCell(6).font = { ...fontNormal, color: { argb: 'FFCC0000' } };
                autoWidth(r, 6);
                r.outlineLevel = 3; r.hidden = true;
              });
            }
          });
        }
      }
    }

    // Дополнительно
    if ((sal.extrasTotal || 0) > 0) {
      addSalRow('Дополнительно', sal.extrasTotal, '+', (sal.extras || []).length > 0);
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
      const xlsHarmfulness = sal.harmfulnessDeduction || 0;
      const xlsDedsTotal = (sal.finalDeductionsTotal || 0) + xlsHarmfulness;
      if (xlsDedsTotal > 0 || xlsTurnoverDeds.length > 0 || (sal.assistancePaidTotal || 0) > 0) {
        const xlsPreFinal = (sal.basePay || 0) + (sal.referralBonuses || 0) + (sal.performedBonusTotal || 0) + (sal.extrasTotal || 0) - (sal.referralCostTotal || 0);
        addSalRow('Взыскания', xlsDedsTotal, '-', !!(xlsAllDeds.length || xlsHarmfulness > 0 || (sal.assistancePaidTotal || 0) > 0));
        if (xlsAllDeds.length || xlsHarmfulness > 0 || (sal.assistancePaidTotal || 0) > 0) {
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
          if (xlsHarmfulness > 0) {
            addTblRow(['Вредность', 'от з/п', '', '', '4%', parseFloat(xlsHarmfulness.toFixed(2))], 1);
          }
          if ((sal.assistancePaidTotal || 0) > 0) {
            addTblRow(['Услуги ассистирования', 'ассистент', '', '', '—', parseFloat((sal.assistancePaidTotal || 0).toFixed(2))], 1);
          }
          if ((sal.anesthesiologistPaidTotal || 0) > 0) {
            addTblRow(['Услуги анестезиолога', 'анестезиолог', '', '', '—', parseFloat((sal.anesthesiologistPaidTotal || 0).toFixed(2))], 1);
          }
          if ((sal.nursePaidTotal || 0) > 0) {
            addTblRow(['Услуги медсестры', 'медсестра', '', '', '—', parseFloat((sal.nursePaidTotal || 0).toFixed(2))], 1);
          }
          if (xlsTurnoverDeds.length) {
            const noteRow = ws.addRow(['', '* Уже учтено при расчёте бонусов за выполненные услуги']);
            noteRow.getCell(2).font = { ...fontNormal, color: { argb: 'FF94A3B8' }, italic: true, size: 10 };
            ws.mergeCells(`B${noteRow.number}:F${noteRow.number}`);
            noteRow.outlineLevel = 1; noteRow.hidden = true;
          }
        }
      }
    }

    // Услуги ассистирования (вычет у основного врача) — отдельная строка на каждого ассистента
    if ((sal.assistanceSections || []).length > 0) {
      (sal.assistanceSections || []).forEach(s => {
        if ((s.total || 0) > 0) addSalRow(`Услуги ассистирования ${s.name}`, s.total, '-');
      });
    } else if ((sal.assistancePaidTotal || 0) > 0) {
      addSalRow('Услуги ассистирования', sal.assistancePaidTotal, '-');
    }

    // Услуги анестезиолога (вычет у основного врача) — отдельная строка на каждого анестезиолога
    if ((sal.anesthesiologistSections || []).length > 0) {
      (sal.anesthesiologistSections || []).forEach(s => {
        if ((s.total || 0) > 0) addSalRow(`Услуги анестезиолога ${s.name}`, s.total, '-');
      });
    } else if ((sal.anesthesiologistPaidTotal || 0) > 0) {
      addSalRow('Услуги анестезиолога', sal.anesthesiologistPaidTotal, '-');
    }

    // Услуги медсестры (вычет у основного врача) — отдельная строка на каждую медсестру
    if ((sal.nurseSections || []).length > 0) {
      (sal.nurseSections || []).forEach(s => {
        if ((s.total || 0) > 0) addSalRow(`Услуги медсестры ${s.name}`, s.total, '-');
      });
    } else if ((sal.nursePaidTotal || 0) > 0) {
      addSalRow('Услуги медсестры', sal.nursePaidTotal, '-');
    }

    // Материалы
    {
      const xlsAllMats = sal.materials || [];
      const xlsTurnoverMats = xlsAllMats.filter(m => m.deductionType !== 'final');
      if ((sal.finalMaterialsTotal || 0) > 0 || xlsTurnoverMats.length > 0) {
        const xlsPreFinal2 = (sal.basePay || 0) + (sal.referralBonuses || 0) + (sal.performedBonusTotal || 0) + (sal.extrasTotal || 0) - (sal.referralCostTotal || 0);
        addSalRow('Материалы-расходники', sal.finalMaterialsTotal, '-', xlsAllMats.length > 0);
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
      addSalRow('Бонусы направителям', sal.referralCostTotal, '-', (executorSections || sal.executorSections || []).length > 0);
      (executorSections || sal.executorSections || []).forEach(({ referrer, services, total }) => {
        addSubHdr(referrer, total, 'FFCC0000', 1);
        addTblHdr(['Код услуги', 'Название услуги', 'Стоимость, руб', 'К-во', 'Бонус', 'К выплате, руб'], 2);
        services.forEach(s => addTblRow([s.code || '—', s.name || '—', parseFloat((s.cost || 0).toFixed(2)), s.count, s.bonusLabel, s.bonusAmount > 0 ? -parseFloat(s.bonusAmount.toFixed(2)) : 0], 2));
      });
    }


    // Итого
    ws.addRow([]);
    const totalRow = ws.addRow(['К выплате', '', '', '', '', parseFloat((sal.finalSalary || 0).toFixed(2))]);
    const totalColor = (sal.finalSalary || 0) >= 0 ? 'FF166534' : 'FFCC0000';
    totalRow.getCell(1).font = { ...fontBold, size: 13, color: { argb: totalColor } };
    totalRow.getCell(6).font = { ...fontBold, size: 13, color: { argb: totalColor } };
    totalRow.getCell(6).numFmt = '#,##0.00';
    totalRow.getCell(6).border = allBorders;
    totalRow.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: (sal.finalSalary || 0) >= 0 ? 'FFD1FAE5' : 'FFFEE2E2' } };
    ws.mergeCells(`A${totalRow.number}:E${totalRow.number}`);
    autoWidth(totalRow, 6);

    // Аванс / тело з/п / доп. выплаты
    const _extraPayments = sal.extraPayments || [];
    const _extraTotal = _extraPayments.reduce((s, ep) => s + (parseFloat(ep.amount) || 0), 0);
    const addPayRow = (label, method, value) => {
      const row = ws.addRow([label, '', '', method ? (method === 'cash' ? 'наличные' : 'карта') : '', '', parseFloat((value || 0).toFixed(2))]);
      row.getCell(1).font = fontNormal;
      row.getCell(4).font = { ...fontNormal, color: { argb: 'FF64748B' } };
      row.getCell(6).font = { ...fontBold, color: { argb: 'FFCC0000' } };
      row.getCell(6).numFmt = '#,##0.00';
      ws.mergeCells(`A${row.number}:C${row.number}`);
      autoWidth(row, 6);
      return row;
    };
    if ((sal.advance || 0) > 0 || (sal.mainPayment || 0) > 0 || _extraTotal > 0) {
      if ((sal.advance || 0) > 0)
        addPayRow('Аванс', sal.paymentMethod, sal.advance);
      if ((sal.mainPayment || 0) > 0)
        addPayRow('Основная ЗП', sal.mainPaymentMethod, sal.mainPayment);
      _extraPayments.forEach(ep => {
        if ((ep.amount || 0) > 0)
          addPayRow(ep.label || 'Доп. выплата', ep.method, ep.amount);
      });
      addSalRow('Остаток к выплате', (sal.finalSalary || 0) - (sal.advance || 0) - (sal.mainPayment || 0) - _extraTotal, '=');
    }

    // Касса
    if (cashPayments?.length) {
      ws.addRow([]);
      const cashTitleRow = ws.addRow(['Касса']);
      cashTitleRow.getCell(1).font = { ...fontBold, size: 13 };
      cashTitleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      ws.mergeCells(`A${cashTitleRow.number}:F${cashTitleRow.number}`);

      const cashHdr = ws.addRow(['Дата', 'Выдал', 'Примечание', '', '', 'Сумма, руб']);
      cashHdr.eachCell({ includeEmpty: true }, (cell, c) => {
        if (c <= 6) { cell.font = fontBold; cell.fill = fillHeader; cell.border = allBorders; cell.alignment = { horizontal: 'center' }; }
      });
      ws.mergeCells(`C${cashHdr.number}:E${cashHdr.number}`);

      let cashTotal = 0;
      for (const p of cashPayments) {
        const amt = parseFloat(p.amount || 0);
        cashTotal += amt;
        const dt = p.issuedAt ? new Date(p.issuedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '';
        const row = ws.addRow([dt, p.financistName || '', p.note || '', '', '', parseFloat(amt.toFixed(2))]);
        row.eachCell({ includeEmpty: true }, (cell, c) => { if (c <= 6) { cell.font = fontNormal; cell.border = allBorders; } });
        ws.mergeCells(`C${row.number}:E${row.number}`);
        row.getCell(6).numFmt = '#,##0.00';
        row.getCell(6).font = { ...fontNormal, color: { argb: 'FF166534' } };
        autoWidth(row, 6);
      }

      const cashTotalRow = ws.addRow(['', 'Итого', '', '', '', parseFloat(cashTotal.toFixed(2))]);
      cashTotalRow.getCell(2).font = { ...fontBold, color: { argb: 'FF166534' } };
      cashTotalRow.getCell(6).font = { ...fontBold, color: { argb: 'FF166534' } };
      cashTotalRow.getCell(6).numFmt = '#,##0.00';
      cashTotalRow.getCell(6).border = allBorders;
      cashTotalRow.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
      ws.mergeCells(`B${cashTotalRow.number}:E${cashTotalRow.number}`);
      autoWidth(cashTotalRow, 6);

      if (totalRemainder != null) {
        ws.addRow([]);
        const netRemainder = totalRemainder - cashTotal;
        const remainderColor = netRemainder < 0 ? 'FFCC0000' : 'FF166534';
        const remainderFill  = netRemainder < 0 ? 'FFFEE2E2' : 'FFD1FAE5';

        const r1 = ws.addRow(['', 'Итого к выплате', '', '', '', parseFloat(totalRemainder.toFixed(2))]);
        r1.getCell(2).font = { ...fontBold }; r1.getCell(6).font = fontBold;
        r1.getCell(6).numFmt = '#,##0.00'; r1.getCell(6).border = allBorders;
        ws.mergeCells(`B${r1.number}:E${r1.number}`);

        const r2 = ws.addRow(['', 'Выдано', '', '', '', parseFloat((-cashTotal).toFixed(2))]);
        r2.getCell(2).font = { ...fontBold, color: { argb: 'FFCC0000' } };
        r2.getCell(6).font = { ...fontBold, color: { argb: 'FFCC0000' } };
        r2.getCell(6).numFmt = '#,##0.00'; r2.getCell(6).border = allBorders;
        ws.mergeCells(`B${r2.number}:E${r2.number}`);

        const r3 = ws.addRow(['', 'Остаток', '', '', '', parseFloat(netRemainder.toFixed(2))]);
        r3.getCell(2).font = { ...fontBold, size: 13, color: { argb: remainderColor } };
        r3.getCell(6).font = { ...fontBold, size: 13, color: { argb: remainderColor } };
        r3.getCell(6).numFmt = '#,##0.00'; r3.getCell(6).border = allBorders;
        r3.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: remainderFill } };
        ws.mergeCells(`B${r3.number}:E${r3.number}`);
        autoWidth(r3, 6);
      }
    }
  }
}

// ─── Build single-doctor workbook (returns ExcelJS.Workbook) ──────────────────
// reportData: { doctor: {name, ...}, clinicReports: [{clinicLabel, executorSections, salary}], periodLabel }
// cashPayments: optional array of cash payment records to append to the last clinic sheet
export function buildSingleWorkbook(reportData, cashPayments) {
  const { doctor, clinicReports } = reportData;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'alfa-wiki';
  if (!clinicReports?.length) return wb;

  const { fontTitle, fontBold, fontNormal, fillHeader, allBorders } = _makeStyles();
  const doctorName = typeof doctor === 'string' ? doctor : (doctor?.name || 'Врач');

  const totalRemainder = cashPayments?.length
    ? clinicReports.reduce((s, cr) => {
        const sal = cr.salary || {};
        const extraTot = (sal.extraPayments || []).reduce((es, ep) => es + (parseFloat(ep.amount) || 0), 0);
        return s + parseFloat(sal.finalSalary || 0) - parseFloat(sal.advance || 0) - parseFloat(sal.mainPayment || 0) - extraTot;
      }, 0)
    : null;

  for (let i = 0; i < clinicReports.length; i++) {
    const { clinicLabel, executorSections, salary } = clinicReports[i];
    const sheetName = (clinicLabel || 'Клиника').substring(0, 31);
    const isLast = i === clinicReports.length - 1;
    _writeOneClinicSheet(wb, sheetName, doctorName, clinicLabel || 'Клиника', executorSections, salary, fontTitle, fontBold, fontNormal, fillHeader, allBorders, isLast ? cashPayments : undefined, isLast ? totalRemainder : undefined);
  }
  return wb;
}

// ─── Build bulk workbook (returns ExcelJS.Workbook) ───────────────────────────
// bulkResults: [{doctor, clinicReports, periodLabel, dateFrom, dateTo}]
export function buildBulkWorkbook(bulkResults) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'alfa-wiki';
  const { fontTitle, fontBold, fontNormal, fillHeader, allBorders } = _makeStyles();

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

  const usedSheetNames = new Set(['Сводка']);
  const makeSheetName = (base) => {
    const truncated = base.substring(0, 31);
    if (!usedSheetNames.has(truncated)) {
      usedSheetNames.add(truncated);
      return truncated;
    }
    for (let i = 2; i < 1000; i++) {
      const suffix = ` (${i})`;
      const candidate = base.substring(0, 31 - suffix.length) + suffix;
      if (!usedSheetNames.has(candidate)) {
        usedSheetNames.add(candidate);
        return candidate;
      }
    }
    return truncated;
  };

  for (const r of bulkResults) {
    if (r.error || !r.clinicReports?.length) continue;
    const doctorName = r.doctor?.name || 'Врач';
    const parts = doctorName.trim().split(/\s+/);
    const lastName = parts[0] || doctorName;
    const initials = parts.slice(1).map(p => p[0]).filter(Boolean).join('').toUpperCase();
    const nameTag = initials ? `${lastName} ${initials}` : lastName;
    for (const { clinicLabel, executorSections, salary } of r.clinicReports) {
      const sheetLabel = `${nameTag} - ${clinicLabel || 'Клиника'}`;
      const sheetName = makeSheetName(sheetLabel);
      _writeOneClinicSheet(wb, sheetName, doctorName, clinicLabel || 'Клиника', executorSections, salary, fontTitle, fontBold, fontNormal, fillHeader, allBorders);
    }
  }

  return wb;
}

// ─── Helper: convert workbook to base64 string ────────────────────────────────
export async function workbookToBase64(wb) {
  const buf = await wb.xlsx.writeBuffer();
  const uint8 = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
  return btoa(binary);
}

// ─── Export single report to Excel (download) ─────────────────────────────────
export async function exportReport(reportData) {
  const { doctor, clinicReports } = reportData;
  if (!clinicReports?.length) return;

  const wb = buildSingleWorkbook(reportData);
  const doctorName = typeof doctor === 'string' ? doctor : (doctor?.name || 'Врач');
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

// ─── Export bulk report to Excel (download) ───────────────────────────────────
export async function exportBulkReport(bulkResults) {
  const wb = buildBulkWorkbook(bulkResults);
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
