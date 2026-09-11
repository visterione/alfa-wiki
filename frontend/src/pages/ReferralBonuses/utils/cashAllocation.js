/**
 * Раскладывает выдачи из кассы по строкам сводки (строка = медцентр в записи).
 *
 * До ver. 8.18 выдача знала только врача и период, поэтому сводка вычитала её
 * из общего остатка врача и печатала одну и ту же сумму в строке каждого
 * медцентра. Теперь у выдачи есть свой медцентр, и она попадает только в его
 * строку.
 *
 * Выдачи до ver. 8.18 медцентра не знают: до появления начислений по нескольким
 * медцентрам это была просто выплата врачу за период, и считалась она верно.
 * Такие выдачи так и остаются выплатой по врачу целиком — их складывают в
 * unassigned и показывают один раз, на первой строке записи, а не повторяют
 * одинаковой суммой в строке каждого медцентра.
 *
 * Выдача медцентра, отфильтрованного из выборки, не показывается нигде: иначе
 * она осела бы на чужой строке и итог по видимым строкам перестал бы сходиться.
 *
 * @param rows          строки сводки в порядке отображения: { key, rec, cr }
 * @param cashByRecord  { [salaryRecordId]: CashPayment[] }
 * @returns Map: rowKey → { assigned, unassigned }
 */
export function allocateCashByRow(rows, cashByRecord = {}) {
  const result = new Map();
  const rowKeyByRecordClinic = new Map(); // `${recId}|${clinicId}` → rowKey
  const firstRowOfRecord = new Map();     // recId → rowKey

  (rows || []).forEach(row => {
    result.set(row.key, { assigned: [], unassigned: [] });
    if (!firstRowOfRecord.has(row.rec.id)) firstRowOfRecord.set(row.rec.id, row.key);
    const clinicId = row.cr?.clinicId;
    if (clinicId != null) {
      const mapKey = `${row.rec.id}|${String(clinicId)}`;
      if (!rowKeyByRecordClinic.has(mapKey)) rowKeyByRecordClinic.set(mapKey, row.key);
    }
  });

  const seenRecords = new Set();
  (rows || []).forEach(row => {
    if (seenRecords.has(row.rec.id)) return;
    seenRecords.add(row.rec.id);
    // Медцентры записи целиком — по ним отличаем выдачу отфильтрованной клиники
    // (её скрываем) от выдачи, медцентра у которой нет вовсе (её показываем).
    const recordClinicIds = new Set(
      (row.rec.reportData?.clinicReports || []).map(cr => String(cr.clinicId))
    );
    (cashByRecord[row.rec.id] || []).forEach(payment => {
      const clinicId = payment.clinicId;
      const known = clinicId != null && clinicId !== '' && recordClinicIds.has(String(clinicId));
      // Медцентра нет вовсе (старая выдача) — считаем её выплатой по врачу за период.
      if (!known) {
        const target = result.get(firstRowOfRecord.get(row.rec.id));
        if (target) target.unassigned.push(payment);
        return;
      }
      const target = result.get(rowKeyByRecordClinic.get(`${row.rec.id}|${String(clinicId)}`));
      // Медцентр выдачи отобран фильтром — в видимых строках её быть не должно,
      // иначе сумма осела бы на чужой клинике.
      if (target) target.assigned.push(payment);
    });
  });

  return result;
}

export function sumCash(payments) {
  return (payments || []).reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
}
