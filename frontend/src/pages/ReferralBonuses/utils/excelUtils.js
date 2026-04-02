import * as XLSX from 'xlsx';

// ═══════════════════════════════════════
// EXCEL UTILITIES
// Ported verbatim from referral-bonuses.html
// ═══════════════════════════════════════

// Парсит дату из строк вида "13.02.2026", "2026-02-13", "13/02/2026"
export function rbParseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  // DD.MM.YYYY или DD/MM/YYYY
  const m1 = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m1) return new Date(parseInt(m1[3]), parseInt(m1[2]) - 1, parseInt(m1[1]));
  // YYYY-MM-DD
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Определяет колонки файла МИС (точные + fuzzy fallback)
// Ported verbatim from referral-bonuses.html rbMapNewColumns
export function rbMapNewColumns(rows) {
  const colMap = {};
  if (!rows.length) return colMap;
  const keys = Object.keys(rows[0]);

  // Точные совпадения для известного формата МИС (приоритет)
  const exactMap = {
    date:         ['Дата оплаты счета', 'Дата выставления счета', 'Дата создания услуги'],
    invoiceType:  ['Тип счета'],
    clinic:       ['Клиника счета'],
    executor:     ['ФИО исполнителя'],
    executorSpec: ['Специальность исполнителя'],
    referrer:     ['ФИО рекомендателя'],
    referrerSpec: ['Специальность рекомендателя'],
    serviceCode:  ['Код услуги'],
    serviceName:  ['Наименование услуги'],
    cabinet:      ['Кабинет'],
    category:     ['Категория услуги'],
    serviceSpec:  ['Специальность услуги'],
    servicePrice: ['Стоимость услуги'],
    qty:          ['Количество'],
    discount:     ['Скидка'],
    totalCost:    ['Итоговая стоимость'],
    patientCard:  ['№ карты пациента'],
    patientName:  ['ФИО пациента', 'Пациент'],
    legalCompanyName: ['Юр. компания', 'Плательщик', 'Наименование плательщика', 'Организация', 'Контрагент'],
    assistant:    ['Ассистент'],
  };
  Object.entries(exactMap).forEach(([field, candidates]) => {
    for (const c of candidates) {
      const found = keys.find(k => k === c);
      if (found) { colMap[field] = found; break; }
    }
  });

  // Нечёткий fallback для нестандартных файлов
  keys.forEach(k => {
    const kl = k.toLowerCase();
    if (!colMap.date         && (kl.includes('дата') || kl.includes('date'))) colMap.date = k;
    if (!colMap.clinic       && kl.includes('клиник')) colMap.clinic = k;
    if (!colMap.executor     && kl.includes('исполнител')) colMap.executor = k;
    if (!colMap.executorSpec && kl.includes('специальност') && kl.includes('исполнител')) colMap.executorSpec = k;
    if (!colMap.referrer     && (kl.includes('рекомендател') || kl.includes('направител'))) colMap.referrer = k;
    if (!colMap.serviceCode  && kl.includes('код') && kl.includes('услуг')) colMap.serviceCode = k;
    if (!colMap.serviceName  && (kl.includes('наименован') || (kl.includes('услуг') && !kl.includes('код') && !kl.includes('стоим') && !kl.includes('специальн') && !kl.includes('катег')))) colMap.serviceName = k;
    if (!colMap.category     && kl.includes('катег') && kl.includes('услуг')) colMap.category = k;
    if (!colMap.serviceSpec  && kl.includes('специальност') && kl.includes('услуг')) colMap.serviceSpec = k;
    if (!colMap.servicePrice && kl.includes('стоим') && kl.includes('услуг') && !kl.includes('себестоим')) colMap.servicePrice = k;
    if (!colMap.qty          && (kl === 'количество' || kl.includes('кол-во') || kl.includes('кол.'))) colMap.qty = k;
    if (!colMap.discount     && kl.includes('скидк')) colMap.discount = k;
    if (!colMap.totalCost    && kl.includes('итогов')) colMap.totalCost = k;
    if (!colMap.cabinet      && (kl === 'кабинет' || kl.includes('кабинет'))) colMap.cabinet = k;
    if (!colMap.patientCard      && kl.includes('карт') && kl.includes('пациент')) colMap.patientCard = k;
    if (!colMap.patientName      && ((kl.includes('фио') && kl.includes('пациент')) || kl === 'пациент')) colMap.patientName = k;
    if (!colMap.legalCompanyName && (kl.includes('плательщик') || kl === 'организация' || kl === 'контрагент')) colMap.legalCompanyName = k;
    if (!colMap.assistant        && (kl === 'ассистент' || (kl.includes('ассист') && !kl.includes('врач')))) colMap.assistant = k;
  });
  // Fallbacks
  if (!colMap.date) colMap.date = keys[0];
  if (!colMap.totalCost && colMap.servicePrice) colMap.totalCost = colMap.servicePrice;
  return colMap;
}

// Reads an Excel file and returns rows as array of objects (using xlsx package)
export function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
