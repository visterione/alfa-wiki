'use strict';

/**
 * Справочник карточек пациентов МИС — ради префиксного поиска ФИО.
 *
 * Публичное API ищет только по точной фамилии («Курочк» — ноль, «Курочкин» —
 * 52 карточки), а медсестре нужно набрать три буквы и увидеть варианты. Поэтому
 * карточки лежат у нас: выгружаются пачками по месяцам создания и потом
 * догружаются по дате изменения.
 *
 * Из карточки берём только то, без чего не выбрать пациента: ФИО, дату
 * рождения, номер карты. Телефон, адрес и медицинская часть остаются в МИС.
 */

const axios = require('axios');
const qs = require('qs');

const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const MIS_TIMEOUT = 180000;

async function misRequest(endpoint, params) {
  const resp = await axios.post(
    `${MIS_BASE_URL}/${endpoint}`,
    qs.stringify({ api_key: MIS_API_KEY, ...params }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: MIS_TIMEOUT }
  );
  return resp.data;
}

function rowsOf(data) {
  const raw = data && data.data;
  return Array.isArray(raw) ? raw : (raw ? [raw] : []);
}

function toRecord(p) {
  return {
    patient_id: String(p.patient_id),
    number: p.number != null ? String(p.number) : null,
    last_name: p.last_name || '',
    first_name: p.first_name || '',
    third_name: p.third_name || '',
    birth_date: p.birth_date || null,
    mis_updated: p.date_updated || p.date_created || null,
    synced_at: new Date()
  };
}

/**
 * Сохранение пачкой. Карточку могли поменять в МИС — обновляем по первичному
 * ключу, а не пропускаем: фамилию исправляют, и справочник должен это увидеть.
 */
async function saveBatch(rows) {
  if (!rows.length) return 0;
  const { MisPatient } = require('../models');
  await MisPatient.bulkCreate(rows, {
    updateOnDuplicate: ['number', 'last_name', 'first_name', 'third_name', 'birth_date', 'mis_updated', 'synced_at']
  });
  return rows.length;
}

const ruDate = (d) => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
};

/**
 * Выгрузка по месяцам создания карточек. Месяц — удачный шаг: за него приходит
 * около шести тысяч записей и восьми мегабайт, что МИС отдаёт секунд за
 * двадцать. Год одним запросом он уже не тянет.
 */
async function syncCreatedMonth(year, month, onProgress) {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0);
  const data = await misRequest('getPatient', {
    date_created_from: ruDate(from),
    date_created_to: ruDate(to)
  });
  const rows = rowsOf(data).map(toRecord);
  await saveBatch(rows);
  if (onProgress) onProgress(year, month, rows.length);
  return rows.length;
}

/**
 * Догрузка изменений: карточки, тронутые за последние дни. Сюда попадают и
 * новые — у них date_updated проставляется при создании.
 */
async function syncUpdatedSince(days = 3) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const data = await misRequest('getPatient', {
    date_updated_from: ruDate(from),
    date_updated_to: ruDate(to)
  });
  const rows = rowsOf(data).map(toRecord);
  await saveBatch(rows);
  return rows.length;
}

/**
 * Поиск карточки по тому, что набирает медсестра. Три случая, которые надо
 * различать, потому что вводят по-разному:
 *
 *   «111111»            — номер карты;
 *   «Курочкин»          — фамилия;
 *   «Курочкин В А»      — фамилия с инициалами, они же «В.А.», «Валерий А».
 *
 * Всё — по началу слова: набрал три буквы, увидел варианты. Ради этого
 * справочник и держится локально, публичное API так не умеет.
 */
async function search(query, limit = 40) {
  const raw = String(query || '').trim();
  if (raw.length < 2) return [];

  const { sequelize } = require('../models');
  const norm = (v) => String(v).toLowerCase().replace(/ё/g, 'е');
  const like = (v) => norm(v).replace(/[%_\\]/g, ch => '\\' + ch) + '%';

  // Номер карты набирают цифрами — по ним ФИО не ищут никогда
  if (/^\d+$/.test(raw)) {
    const rows = await sequelize.query(`
      SELECT patient_id, number, last_name, first_name, third_name, birth_date
      FROM mis_patients
      WHERE number LIKE :prefix
      ORDER BY length(number), number
      LIMIT :limit
    `, { replacements: { prefix: raw + '%', limit }, type: sequelize.QueryTypes.SELECT });
    return rows.map(toItem);
  }

  // Инициалы отделяем от фамилии: точки и пробелы равнозначны, «В.А.» и «В А»
  // должны работать одинаково
  const parts = raw.split(/[\s.]+/).filter(Boolean);
  const [surname, second, third] = parts;

  const where = ["LOWER(REPLACE(last_name, 'ё', 'е')) LIKE :surname"];
  const replacements = { surname: like(surname), limit };

  if (second) {
    where.push("LOWER(REPLACE(first_name, 'ё', 'е')) LIKE :second");
    replacements.second = like(second);
  }
  if (third) {
    where.push("LOWER(REPLACE(third_name, 'ё', 'е')) LIKE :third");
    replacements.third = like(third);
  }

  const rows = await sequelize.query(`
    SELECT patient_id, number, last_name, first_name, third_name, birth_date
    FROM mis_patients
    WHERE ${where.join(' AND ')}
    ORDER BY last_name, first_name, third_name
    LIMIT :limit
  `, { replacements, type: sequelize.QueryTypes.SELECT });

  // По одному слову ищем ещё и по имени: медсестра иногда начинает с него,
  // но только если по фамилии ничего не нашлось — иначе список замусорится
  if (!rows.length && parts.length === 1) {
    const byFirst = await sequelize.query(`
      SELECT patient_id, number, last_name, first_name, third_name, birth_date
      FROM mis_patients
      WHERE LOWER(REPLACE(first_name, 'ё', 'е')) LIKE :surname
      ORDER BY last_name, first_name
      LIMIT :limit
    `, { replacements: { surname: like(surname), limit }, type: sequelize.QueryTypes.SELECT });
    return byFirst.map(toItem);
  }

  return rows.map(toItem);
}

function toItem(r) {
  const name = [r.last_name, r.first_name, r.third_name].filter(Boolean).join(' ');
  const card = r.number ? String(r.number) : '';
  return {
    patientId: String(r.patient_id),
    name,
    birthDate: r.birth_date || '',
    cardNumber: card,
    // Строка списка целиком собирается здесь, чтобы формат был один на всех:
    // «№111111 Стеценко Виталий Витальевич (01.01.1999)»
    label: (card ? '№' + card + ' ' : '') + name + (r.birth_date ? ' (' + r.birth_date + ')' : '')
  };
}

async function count() {
  const { MisPatient } = require('../models');
  return MisPatient.count();
}

module.exports = {
  syncCreatedMonth,
  syncUpdatedSince,
  search,
  count
};
