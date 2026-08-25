'use strict';

/**
 * Подтверждение шагов чтением из «Реновации».
 *
 * Публичное API МИС на запись сотрудников не умеет: в нём есть createPatient,
 * createAppointment, createInvoice, createPayment — и ни одного метода, который
 * заводил бы пользователя, привязывал ему услуги или строил расписание. Значит,
 * эти действия всё равно делаются руками в самом МИС, и портал их не выполняет.
 *
 * Но верить галочке «сделал» там, где можно спросить систему, незачем. Поэтому
 * шаги с verify:'mis' закрываются так: исполнитель нажимает «готово», а портал
 * идёт в МИС и проверяет, что это правда. Не подтвердилось — задача остаётся
 * открытой с понятным объяснением, что именно не нашлось.
 */

const { misRequest } = require('../misClient');
const { MedCenter } = require('../../models');

/** ФИО в МИС и в анкете набирают по-разному: лишние пробелы, «ё», регистр. */
function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е');
}

/** clinic_id филиала. Медцентру в портале может соответствовать несколько клиник МИС. */
async function clinicIdsFor(medCenterId) {
  if (!medCenterId) return [];
  const mc = await MedCenter.findByPk(medCenterId, { attributes: ['misClinicIds'] });
  return (mc?.misClinicIds || []).filter(Boolean);
}

function misData(response) {
  if (!response || Number(response.error) !== 0) return null;
  const { data } = response;
  if (!data) return null;
  return Array.isArray(data) ? data : [data];
}

/**
 * Ищет только что заведённого врача. Сопоставляем по ФИО в пределах филиала и
 * специальности — по e-mail нельзя, его в карточке сотрудника может не быть.
 *
 * Возвращает id только при однозначном совпадении: два «Иванова И. И.» в одном
 * филиале — повод показать человеку выбор, а не угадывать.
 *
 * @returns {Promise<{ ok: boolean, misUserId?: string, reason?: string, candidates?: Array }>}
 */
async function findDoctor(app) {
  const clinicIds = await clinicIdsFor(app.medCenterId);
  const professionIds = (app.professions || []).map(p => p.id).filter(Boolean);

  const params = {};
  if (clinicIds.length) params.clinic_id = clinicIds.join(',');
  if (professionIds.length) params.profession_id = professionIds.join(',');

  let rows;
  try {
    rows = misData(await misRequest('getUsers', params));
  } catch (error) {
    return { ok: false, reason: `МИС не ответила: ${error.message}` };
  }
  if (!rows) return { ok: false, reason: 'МИС вернула пустой ответ' };

  const wanted = normalizeName(app.fullName);
  const matches = rows.filter(row => normalizeName(row.name) === wanted);

  if (matches.length === 1) {
    return { ok: true, misUserId: String(matches[0].id) };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: 'В МИС нашлось несколько сотрудников с таким ФИО — выберите нужного вручную',
      candidates: matches.map(m => ({ id: String(m.id), name: m.name, professions: m.profession || [] }))
    };
  }
  return {
    ok: false,
    reason: 'В МИС не нашлось сотрудника с таким ФИО в этом филиале и специальности'
  };
}

// Справочник специальностей меняется раз в год, а нужен на каждый список
// сотрудников: getUsers отдаёт специальности идентификаторами, и без перевода
// в списке выбора стояло бы «37, 2».
const PROFESSIONS_TTL_MS = 30 * 60 * 1000;
let professionsCache = { at: 0, map: new Map() };

async function professionNames() {
  if (Date.now() - professionsCache.at < PROFESSIONS_TTL_MS && professionsCache.map.size) {
    return professionsCache.map;
  }
  try {
    const rows = misData(await misRequest('getProfessions', { without_doctors: true }));
    if (rows) {
      professionsCache = {
        at: Date.now(),
        map: new Map(rows.map(row => [String(row.id), row.name]))
      };
    }
  } catch (error) {
    console.warn('[onboarding/mis] Справочник специальностей недоступен:', error.message);
  }
  return professionsCache.map;
}

/**
 * Сотрудники филиала из МИС — чтобы выбрать врача руками, когда автоматическая
 * сверка его не нашла.
 *
 * Без этого шаг «создать учётку» превращался в тупик: МИС отвечает «не нашлось»,
 * задача остаётся открытой, и сделать с ней нечего. А не находится она сплошь и
 * рядом по бытовым причинам — фамилия записана с другой буквой, специальность
 * поставили не ту, сотрудник заведён в соседнюю клинику.
 *
 * Специальностью не фильтруем: если админ МИС ошибся именно в ней, фильтр
 * спрячет нужного человека ровно тогда, когда он нужнее всего.
 */
async function searchDoctors(app, query = '') {
  const clinicIds = await clinicIdsFor(app.medCenterId);
  const params = {};
  if (clinicIds.length) params.clinic_id = clinicIds.join(',');

  let rows;
  try {
    rows = misData(await misRequest('getUsers', params));
  } catch (error) {
    return { ok: false, reason: `МИС не ответила: ${error.message}` };
  }
  if (!rows) return { ok: true, users: [] };

  const names = await professionNames();
  const needle = normalizeName(query);
  const users = rows
    .filter(row => !needle || normalizeName(row.name).includes(needle))
    .map(row => ({
      id: String(row.id),
      name: row.name,
      professions: (row.profession || [])
        .map(p => names.get(String(p?.id ?? p)) || null)
        .filter(Boolean)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .slice(0, 60);

  return { ok: true, users };
}

/**
 * Сверяет услуги врача в МИС с тем, что он отметил в анкете.
 *
 * Услуги, вписанные врачом текстом (isCustom), в сверку не входят: их ещё нет в
 * прайсе, заведение новой позиции — отдельный процесс с ценообразованием, и
 * запуск врача он не блокирует.
 */
async function verifyServices(app, choices = []) {
  if (!app.misUserId) return { ok: false, reason: 'У заявки ещё нет doctor_id из МИС' };

  const expected = choices.filter(c => !c.isCustom && c.serviceId);
  if (!expected.length) return { ok: true, missing: [] };

  const clinicIds = await clinicIdsFor(app.medCenterId);
  const params = { user_id: app.misUserId };
  if (clinicIds.length) params.clinic_id = clinicIds[0];

  let rows;
  try {
    rows = misData(await misRequest('getServices', params));
  } catch (error) {
    return { ok: false, reason: `МИС не ответила: ${error.message}` };
  }
  if (!rows) return { ok: false, reason: 'МИС не вернула услуг по этому врачу' };

  const inMis = new Set(rows.map(r => String(r.service_id ?? r.id)));
  const missing = expected.filter(c => !inMis.has(String(c.serviceId)));

  if (missing.length) {
    return {
      ok: false,
      reason: `В МИС не хватает ${missing.length} из ${expected.length} отмеченных услуг`,
      missing: missing.map(c => ({ serviceId: c.serviceId, code: c.code, title: c.title }))
    };
  }
  return { ok: true, missing: [] };
}

/**
 * Есть ли у врача расписание. Смотрим вперёд на месяц от даты выхода: слоты
 * заводят заранее, и на «сегодня» их может не быть просто потому, что врач ещё
 * не вышел.
 */
async function verifySchedule(app) {
  if (!app.misUserId) return { ok: false, reason: 'У заявки ещё нет doctor_id из МИС' };

  const from = app.startDate ? new Date(app.startDate) : new Date();
  if (from < new Date()) from.setTime(Date.now());
  const to = new Date(from);
  to.setDate(to.getDate() + 30);

  const clinicIds = await clinicIdsFor(app.medCenterId);
  const params = {
    user_id: app.misUserId,
    time_start: formatMisDate(from),
    time_end: formatMisDate(to)
  };
  if (clinicIds.length) params.clinic_id = clinicIds[0];

  let rows;
  try {
    rows = misData(await misRequest('getSchedulePeriods', params));
  } catch (error) {
    return { ok: false, reason: `МИС не ответила: ${error.message}` };
  }

  if (!rows || !rows.length) {
    return { ok: false, reason: 'В МИС нет расписания на ближайший месяц от даты выхода' };
  }
  return { ok: true, periods: rows.length };
}

/** МИС ждёт даты в формате dd.mm.yyyy hh:mm. */
function formatMisDate(date) {
  const p = n => String(n).padStart(2, '0');
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/**
 * Услуги, доступные врачу по его специальностям и филиалу. Отсюда строится
 * страница выбора: getServices принимает profession_id и clinic_id, поэтому
 * набор и цены получаются ровно те, что действуют в этом филиале.
 */
async function servicesForApplication(app) {
  const clinicIds = await clinicIdsFor(app.medCenterId);
  const professionIds = (app.professions || []).map(p => p.id).filter(Boolean);
  if (!professionIds.length) return { ok: false, reason: 'В анкете не выбрана специальность' };

  const params = { profession_id: professionIds.join(',') };
  if (clinicIds.length) params.clinic_id = clinicIds[0];

  let rows;
  try {
    rows = misData(await misRequest('getServices', params));
  } catch (error) {
    return { ok: false, reason: `МИС не ответила: ${error.message}` };
  }
  if (!rows) return { ok: true, services: [] };

  // Специальностей может быть несколько, и одна услуга попадает в выдачу по
  // каждой из них — схлопываем по service_id.
  const seen = new Map();
  for (const row of rows) {
    const id = String(row.service_id ?? row.id);
    if (!id || seen.has(id)) continue;
    seen.set(id, {
      serviceId: id,
      code: row.code || row.sub_code || null,
      title: row.title || row.name || 'Без названия',
      category: row.category_title || row.category || null,
      price: row.price != null ? Number(row.price) : null,
      duration: row.duration != null ? Number(row.duration) : null
    });
  }

  return { ok: true, services: [...seen.values()] };
}

/**
 * Итоговая карточка врача для колл-центра.
 *
 * Собирается из МИС, а не из анкеты: записывать пациентов можно только на то,
 * что реально заведено в системе. Анкета к этому моменту месячной давности и
 * могла разойтись с тем, что в итоге настроили.
 */
async function doctorExport(app) {
  if (!app.misUserId) return { ok: false, reason: 'У заявки ещё нет doctor_id из МИС' };

  const clinicIds = await clinicIdsFor(app.medCenterId);
  const result = { misUserId: app.misUserId, doctor: null, services: [], schedule: [] };

  try {
    const users = misData(await misRequest('getUsers', { user_id: app.misUserId, with_services: 1 }));
    result.doctor = users?.[0] || null;
  } catch (error) {
    return { ok: false, reason: `МИС не ответила: ${error.message}` };
  }

  try {
    const params = { user_id: app.misUserId };
    if (clinicIds.length) params.clinic_id = clinicIds[0];
    const services = misData(await misRequest('getServices', params));
    result.services = (services || []).map(s => ({
      serviceId: String(s.service_id ?? s.id),
      code: s.code || s.sub_code || null,
      title: s.title || s.name,
      price: s.price != null ? Number(s.price) : null,
      duration: s.duration != null ? Number(s.duration) : null
    }));
  } catch (error) {
    console.warn('[onboarding/mis] Услуги для выгрузки не получены:', error.message);
  }

  try {
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + 30);
    const params = {
      user_id: app.misUserId,
      time_start: formatMisDate(from),
      time_end: formatMisDate(to)
    };
    if (clinicIds.length) params.clinic_id = clinicIds[0];
    result.schedule = misData(await misRequest('getSchedulePeriods', params)) || [];
  } catch (error) {
    console.warn('[onboarding/mis] Расписание для выгрузки не получено:', error.message);
  }

  return { ok: true, ...result };
}

module.exports = {
  findDoctor,
  searchDoctors,
  doctorExport,
  verifyServices,
  verifySchedule,
  servicesForApplication,
  clinicIdsFor,
  normalizeName
};
