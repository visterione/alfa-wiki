/**
 * Модуль «Маркетинг» (ver. 8.22) — вкладка «Акции».
 *
 * Акции живут в МИС, а не у нас. До 8.22 портал вёл собственную таблицу
 * promotions: маркетолог заводил карточку на вики-странице, а потом руками
 * повторял ту же акцию в Renovatio. Два списка разошлись предсказуемо — в
 * нашей таблице лежало 14 карточек, в МИС на тот же день 44, и совпадали они
 * только формулировками вроде «Инвалиды».
 *
 * Поэтому здесь нет своего хранилища: getPromos отдаёт все поля, которые
 * принимает createPromo (документация от 08.10.2025 обещала шесть, на деле
 * приходит два десятка), и промежуточной копии заводить незачем.
 *
 * Чего в API МИС нет — так это изменения и удаления акции. Заведённая акция
 * правится только в интерфейсе Renovatio. Отсюда осторожность формы: ошибку
 * отсюда нельзя отменить нажатием «удалить».
 */

const express = require('express');
const { authenticate, requireMarketing, marketingLevel } = require('../middleware/auth');
const { misRequest } = require('../services/misClient');
const medCenters = require('../services/medCenters');

const router = express.Router();

/**
 * dd.mm.yyyy → yyyy-mm-dd. МИС отдаёт и принимает первое, фронтенд и сравнение
 * дат работают со вторым.
 */
function misDateToIso(value) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** yyyy-mm-dd → dd.mm.yyyy для отправки в МИС. */
function isoToMisDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function todayIso() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Действует ли акция сегодня.
 *
 * МИС не гасит акции по истечении срока — у всех, включая прошлогодние,
 * status = true, и на момент перехода почти половина списка (19 из 44) была
 * просрочена. Так что срок считаем сами, а МИС о нём не спрашиваем.
 */
function promoStatus(dateFrom, dateTo) {
  const today = todayIso();
  if (dateTo && dateTo < today) return 'expired';
  if (dateFrom && dateFrom > today) return 'future';
  return 'active';
}

/** Массив из того, что МИС кладёт в поля-списки: массив, строка через запятую или null. */
function toList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value === null || value === undefined || value === '') return [];
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Медцентры, которым можно завести акцию.
 *
 * Виртуальные группировки («АУП», «Направители») отпадают сами, а ИП Микаелян —
 * служебная клиника-заглушка: её misClinicIds это псевдо-id «ip», клиники с
 * таким номером в МИС нет и акция туда не заведётся. Отбор по числовому id, а
 * не по списку имён: новый филиал так попадёт в список сам.
 */
async function promoClinics() {
  const rows = await medCenters.list();
  return rows
    .filter(mc => mc.servesPatients)
    .map(mc => {
      const misId = (mc.misClinicIds || []).find(id => /^\d+$/.test(String(id)));
      return misId ? { id: mc.id, name: mc.name, color: mc.color, clinicId: String(misId) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** Карточка акции в том виде, в каком её ждёт фронтенд. */
async function shapePromo(raw) {
  const dateFrom = misDateToIso(raw.date_from);
  const dateTo = misDateToIso(raw.date_to);
  // clinic_id = null означает «все клиники»: так заведены персональные скидки.
  const mc = raw.clinic_id === null || raw.clinic_id === undefined
    ? null
    : await medCenters.byMisId(String(raw.clinic_id));

  return {
    id: String(raw.id),
    title: raw.title || '',
    link: raw.link || null,
    image: raw.image || null,
    shortDesc: raw.short_desc || null,
    desc: raw.desc || null,
    clinicId: raw.clinic_id === null || raw.clinic_id === undefined ? null : String(raw.clinic_id),
    medCenterName: mc ? mc.name : null,
    medCenterColor: mc ? mc.color : null,
    discount: raw.discount === null || raw.discount === '' ? null : Number(raw.discount),
    absDiscount: raw.abs_discount === null || raw.abs_discount === '' ? null : Number(raw.abs_discount),
    dateFrom,
    dateTo,
    timeFrom: raw.time_from || null,
    timeTo: raw.time_to || null,
    weekDays: toList(raw.week_days).map(Number).filter(n => n >= 1 && n <= 7),
    services: toList(raw.services),
    serviceCategories: toList(raw.service_categories),
    ageFrom: raw.age_from === null || raw.age_from === '' ? null : Number(raw.age_from),
    ageTo: raw.age_to === null || raw.age_to === '' ? null : Number(raw.age_to),
    gender: raw.gender === null || raw.gender === '' ? null : Number(raw.gender),
    status: promoStatus(dateFrom, dateTo)
  };
}

// GET /api/marketing/promos — список акций из МИС
router.get('/promos', authenticate, requireMarketing('promotions', 'read'), async (req, res) => {
  try {
    const data = await misRequest('getPromos', {});
    if (Number(data?.error) !== 0 || !Array.isArray(data?.data)) {
      return res.status(502).json({ error: 'МИС не вернул список акций' });
    }
    const promos = [];
    for (const raw of data.data) promos.push(await shapePromo(raw));
    res.json({
      promos,
      canEdit: marketingLevel(req.user, 'promotions') === 'edit'
    });
  } catch (err) {
    console.error('GET /api/marketing/promos error:', err.message);
    res.status(502).json({ error: 'МИС недоступен' });
  }
});

// GET /api/marketing/promo-clinics — медцентры, доступные для выбора в форме
router.get('/promo-clinics', authenticate, requireMarketing('promotions', 'read'), async (_req, res) => {
  try {
    res.json(await promoClinics());
  } catch (err) {
    console.error('GET /api/marketing/promo-clinics error:', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/marketing/promos — завести акцию в МИС
router.post('/promos', authenticate, requireMarketing('promotions', 'edit'), async (req, res) => {
  const {
    title, link, shortDesc, desc, clinicId,
    discount, absDiscount, dateFrom, dateTo, timeFrom, timeTo,
    weekDays, services, serviceCategories, ageFrom, ageTo, gender
  } = req.body;

  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'Название акции обязательно' });
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return res.status(400).json({ error: 'Дата начала позже даты окончания' });
  }
  if (discount != null && absDiscount != null) {
    return res.status(400).json({ error: 'Скидка задаётся либо в процентах, либо в рублях' });
  }
  if (discount != null && (Number(discount) < 0 || Number(discount) > 100)) {
    return res.status(400).json({ error: 'Скидка в процентах должна быть от 0 до 100' });
  }

  // Клиника проверяется по справочнику, а не берётся из тела как есть: в МИС
  // акцию нельзя ни исправить, ни удалить, и промах мимо филиала пришлось бы
  // разгребать руками в Renovatio.
  if (clinicId != null && clinicId !== '') {
    const allowed = await promoClinics();
    if (!allowed.some(c => c.clinicId === String(clinicId))) {
      return res.status(400).json({ error: 'Неизвестный медцентр' });
    }
  }

  const params = { title: String(title).trim() };
  const put = (key, value) => { if (value !== null && value !== undefined && value !== '') params[key] = value; };

  put('link', link && String(link).trim());
  put('short_desc', shortDesc && String(shortDesc).trim());
  put('desc', desc && String(desc).trim());
  // Пустой clinic_id — это «все клиники», и в МИС он передаётся отсутствием параметра.
  put('clinic_id', clinicId);
  put('discount', discount);
  put('abs_discount', absDiscount);
  put('date_from', isoToMisDate(dateFrom));
  put('date_to', isoToMisDate(dateTo));
  put('time_from', timeFrom);
  put('time_to', timeTo);
  // Дни недели МИС отдаёт массивом, а принимает строкой через запятую.
  put('week_days', Array.isArray(weekDays) && weekDays.length ? weekDays.join(',') : null);
  put('services', Array.isArray(services) && services.length ? services.join(',') : null);
  put('service_categories', Array.isArray(serviceCategories) && serviceCategories.length ? serviceCategories.join(',') : null);
  put('age_from', ageFrom);
  put('age_to', ageTo);
  put('gender', gender);

  try {
    const data = await misRequest('createPromo', params);
    if (Number(data?.error) !== 0) {
      const reason = data?.data?.desc || data?.desc || 'МИС отклонил акцию';
      console.error('createPromo отклонён:', JSON.stringify(data));
      return res.status(400).json({ error: reason });
    }
    const created = data?.data;
    const id = created && typeof created === 'object' ? created.id : created;
    console.log(`🎯 Акция заведена в МИС: id=${id} «${params.title}» (${req.user.username})`);
    res.status(201).json({ id: id != null ? String(id) : null });
  } catch (err) {
    console.error('POST /api/marketing/promos error:', err.message);
    res.status(502).json({ error: 'МИС недоступен, акция не заведена' });
  }
});

module.exports = router;
