/**
 * Выгрузка сотрудников из МИС Renovatio (метод getUsers) в Excel.
 *
 * Два набора:
 *   1) Роль "Сотрудник call-центра" (call_center, id 5) — все клиники
 *   2) Роль "Администратор" (manager, id 14) и клиника Альфа(2) / Альфа Kids(3) / Альфа Линия(6)
 *
 * Колонки: ФИО | Моб. телефон (79xxxxxxxxx) | Эл. почта | Логин (генерируется i.ivanov)
 *
 * Запуск:  node scripts/export-mis-staff.js
 */
const axios = require('axios');
const qs    = require('qs');
const path  = require('path');
const XLSX  = require('xlsx-js-style');

const MIS_API_KEY  = process.env.MIS_API_KEY  || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';

const ROLE_CALL_CENTER = '5';
const ROLE_ADMIN       = '14';                  // manager
const ADMIN_CLINICS    = new Set(['2', '3', '6']); // Альфа, Альфа Kids, Альфа Линия

async function misRequest(endpoint, params = {}) {
  const r = await axios.post(
    `${MIS_BASE_URL}/${endpoint}`,
    qs.stringify({ api_key: MIS_API_KEY, ...params }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
  );
  return r.data;
}

// ── Телефон → 79xxxxxxxxx ──────────────────────────────────────────────────────
function normalizePhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  else if (d.length === 11 && d[0] === '7') { /* ok */ }
  else if (d.length === 10) d = '7' + d;
  return d;
}

function getMobile(user) {
  const contacts = Array.isArray(user.contacts) ? user.contacts : [];
  const mobiles = contacts.filter(c => c && c.type === 'mobile' && c.value);
  if (!mobiles.length) return '';
  const main = mobiles.find(c => c.is_main) || mobiles[0];
  return normalizePhone(main.value);
}

function getEmail(user) {
  if (user.email && String(user.email).trim()) return String(user.email).trim();
  const contacts = Array.isArray(user.contacts) ? user.contacts : [];
  const em = contacts.find(c => c && c.type === 'email' && c.value);
  return em ? String(em.value).trim() : '';
}

// ── Транслитерация и логин ─────────────────────────────────────────────────────
const TRANSLIT = {
  а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i', й:'y',
  к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f',
  х:'kh', ц:'ts', ч:'ch', ш:'sh', щ:'shch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya'
};
function translit(str) {
  return String(str).toLowerCase().split('').map(ch => {
    if (TRANSLIT[ch] !== undefined) return TRANSLIT[ch];
    if (/[a-z0-9]/.test(ch)) return ch;
    return ''; // выкидываем пробелы, дефисы, точки и пр.
  }).join('');
}
// "Иванов Иван Петрович" -> "i.ivanov"  (первая буква имени + фамилия)
function makeLogin(fullName) {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const surname = translit(parts[0]);
  if (parts.length === 1) return surname;
  const firstLetter = translit(parts[1].charAt(0)); // первая буква имени (с учётом ё→e, ю→yu, я→ya)
  return firstLetter ? `${firstLetter}.${surname}` : surname;
}

// ── Сборка строки ──────────────────────────────────────────────────────────────
function toRow(user) {
  return {
    fio:   String(user.name || '').trim(),
    phone: getMobile(user),
    email: getEmail(user),
    login: makeLogin(user.name || ''),
  };
}

(async () => {
  const resp = await misRequest('getUsers', { show_all: 1 });
  if (resp.error !== 0 || !Array.isArray(resp.data)) {
    console.error('Ошибка getUsers:', resp);
    process.exit(1);
  }
  const all = resp.data.filter(u => !u.is_deleted);

  const callCenter = all.filter(u => (u.role || []).map(String).includes(ROLE_CALL_CENTER));
  const admins = all.filter(u => {
    const roles   = (u.role || []).map(String);
    const clinics = (u.clinic || []).map(String);
    return roles.includes(ROLE_ADMIN) && clinics.some(c => ADMIN_CLINICS.has(c));
  });

  const sortFio = (a, b) => (a.name || '').localeCompare(b.name || '', 'ru');
  callCenter.sort(sortFio);
  admins.sort(sortFio);

  console.log(`Call-центр: ${callCenter.length}, Администраторы (Альфа/Kids/Линия): ${admins.length}`);

  const wb = XLSX.utils.book_new();

  const headerStyle = {
    font:      { bold: true, color: { rgb: 'FFFFFF' } },
    fill:      { fgColor: { rgb: '4472C4' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border:    { bottom: { style: 'thin', color: { rgb: '999999' } } },
  };
  const HEADERS = ['Полное ФИО', 'Моб. телефон', 'Эл. почта', 'Логин (МИС)'];

  function buildSheet(users) {
    const rows = users.map(toRow);
    const aoa = [HEADERS, ...rows.map(r => [r.fio, r.phone, r.email, r.login])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 34 }, { wch: 16 }, { wch: 32 }, { wch: 22 }];
    // стиль заголовка
    HEADERS.forEach((_, c) => {
      const ref = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[ref]) ws[ref].s = headerStyle;
    });
    // телефон и логин — как текст, чтобы 79... не превращался в число и не терял формат
    for (let r = 1; r <= rows.length; r++) {
      ['B', 'D'].forEach(col => {
        const ref = `${col}${r + 1}`;
        if (ws[ref]) ws[ref].t = 's';
      });
    }
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: 3 } }) };
    return ws;
  }

  // Объединяем оба набора в один лист, убирая дубли по id сотрудника
  const byId = new Map();
  [...callCenter, ...admins].forEach(u => { if (!byId.has(u.id)) byId.set(u.id, u); });
  const combined = [...byId.values()].sort(sortFio);
  console.log(`Всего на листе (без дублей по id): ${combined.length}`);

  XLSX.utils.book_append_sheet(wb, buildSheet(combined), 'Сотрудники');

  const outPath = path.join(__dirname, '..', '..', 'Сотрудники_МИС.xlsx');
  XLSX.writeFile(wb, outPath);
  console.log('Файл сохранён:', outPath);
})().catch(e => { console.error(e.message); process.exit(1); });
