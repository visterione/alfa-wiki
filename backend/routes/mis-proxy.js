/**
 * Прокси для API МИС Renovatio
 * Позволяет получать данные врачей, расписание, услуги из внешней системы
 */

const express = require('express');
const axios = require('axios');
const qs = require('qs');
const { authenticate } = require('../middleware/auth');
const { syncAndAnnotate } = require('../services/rbEmployeeRegistry');
const medCenters = require('../services/medCenters');
const { resolveBookingDuration, addMinutesToMisDateTime } = require('../services/bookingDurationService');

const router = express.Router();

const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const REQUEST_TIMEOUT = 15000;

const misRequest = async (endpoint, params = {}) => {
  const response = await axios.post(
    `${MIS_BASE_URL}/${endpoint}`,
    qs.stringify({ api_key: MIS_API_KEY, ...params }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: REQUEST_TIMEOUT
    }
  );
  return response.data;
};

function getCategoryChildren(category) {
  return Array.isArray(category?.children) ? category.children : [];
}

function getServiceKey(service) {
  return String(service?.service_id || service?.id || service?.code || service?.sub_code || service?.title || '').trim();
}

function dedupeServices(services) {
  const result = [];
  const seen = new Set();
  for (const service of services) {
    const key = getServiceKey(service);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(service);
  }
  return result;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchCategoryServices(category, clinicId) {
  const params = {
    category_id: category.id,
    show_children: true,
    show_all: 1
  };
  if (clinicId) params.clinic_id = clinicId;

  try {
    const data = await misRequest('getServices', params);
    if (Number(data?.error) === 0 && Array.isArray(data?.data)) return data.data;
  } catch (err) {
    console.warn('⚠️ Не удалось загрузить категорию целиком:', category.id, err.code || err.message);
  }

  const children = getCategoryChildren(category);
  if (!children.length) return [];

  const parts = await mapWithConcurrency(children, 4, child => fetchCategoryServices(child, clinicId));
  return parts.flat();
}

// ═══════════════════════════════════════════════════════════════
// ВРАЧИ
// ═══════════════════════════════════════════════════════════════

// Получить данные врача по ID (с услугами!)
router.post('/doctor-info', authenticate, async (req, res) => {
  try {
    const userId = req.body.userId || req.body.user_id || req.body.id;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId обязателен' });
    }

    console.log('👨‍⚕️ Запрос данных врача:', userId);

    const data = await misRequest('getUsers', {
      user_id: userId,
      role: 'doctor',
      with_services: 1,
      show_all: true
    });

    const errorCode = Number(data?.error);
    const doctorsArray = Array.isArray(data?.data) ? data.data : [];

    if (errorCode !== 0 || doctorsArray.length === 0) {
      return res.json({ success: false, error: 'Врач не найден', data: null });
    }

    const doctor = doctorsArray[0];
    
    res.json({
      success: true,
      data: {
        id: doctor.id,
        name: doctor.name || `${doctor.last_name || ''} ${doctor.first_name || ''} ${doctor.middle_name || ''}`.trim(),
        professions: doctor.professions || doctor.profession || [],
        services: doctor.services || [],
        clinics: doctor.clinics || doctor.clinic || [],
        workPeriod: doctor.work_period,
        internalNumber: doctor.internal_number,
        doctorInfo: doctor.doctor_info
      }
    });
  } catch (err) {
    console.error('❌ Ошибка /mis/doctor-info:', err.message);
    res.status(500).json({ success: false, error: 'Ошибка при запросе данных врача' });
  }
});

// Поиск/список сотрудников — если roles не передан, тянем всех без фильтра по роли
router.post('/doctors', authenticate, async (req, res) => {
  try {
    const { clinic_id, profession_id, show_all, roles } = req.body;

    const baseParams = {
      with_services: 1,
      show_all: show_all !== undefined ? show_all : true
    };
    if (clinic_id) baseParams.clinic_id = clinic_id;
    if (profession_id) baseParams.profession_id = profession_id;

    let results;
    if (Array.isArray(roles) && roles.length > 0) {
      // Параллельные запросы для каждой роли
      console.log('👨‍⚕️ Запрос сотрудников по ролям:', roles);
      results = await Promise.all(
        roles.map(role => misRequest('getUsers', { ...baseParams, role }))
      );
    } else {
      // Все сотрудники без фильтра по роли
      console.log('👨‍⚕️ Запрос всех сотрудников');
      results = [await misRequest('getUsers', baseParams)];
    }

    // Объединяем и дедублируем по id
    const merged = [];
    const seen = new Set();
    for (const r of results) {
      if (r?.error === 0 && Array.isArray(r?.data)) {
        for (const user of r.data) {
          if (!seen.has(user.id)) {
            seen.add(user.id);
            merged.push(user);
          }
        }
      }
    }

    // Только для полноростерного запроса (без фильтра по клинике/ролям) синхронизируем реестр
    // сотрудников и подмешиваем архивных + флаги _isNew. Отфильтрованные вызовы не трогаем,
    // чтобы частичный список не портил снимок и lastSeenAt.
    const isFullRoster = !clinic_id && !(Array.isArray(roles) && roles.length > 0);
    const data = isFullRoster ? await syncAndAnnotate(merged) : merged;

    res.json({ error: 0, data });
  } catch (err) {
    console.error('❌ Ошибка /mis/doctors:', err.message);
    res.status(500).json({
      error: 1,
      data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе врачей' }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// РАСПИСАНИЕ
// ═══════════════════════════════════════════════════════════════

router.post('/schedule', authenticate, async (req, res) => {
  try {
    const { user_id, clinic_id, time_start, time_end, show_busy, show_past, step } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 1, data: { desc: 'user_id обязателен' } });
    }

    console.log('📅 Запрос расписания для врача:', user_id);

    const params = { user_id };
    if (clinic_id) params.clinic_id = clinic_id;
    if (time_start) params.time_start = time_start;
    if (time_end) params.time_end = time_end;
    if (step) params.step = step;
    params.show_busy = show_busy !== undefined ? show_busy : true;
    params.show_past = show_past !== undefined ? show_past : false;

    const data = await misRequest('getSchedule', params);
    res.json(data);
  } catch (err) {
    console.error('❌ Ошибка /mis/schedule:', err.message);
    res.status(500).json({ error: 1, data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе расписания' } });
  }
});

router.post('/schedule-periods', authenticate, async (req, res) => {
  try {
    const { user_id, time_start, time_end, clinic_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 1, data: { desc: 'user_id обязателен' } });
    }

    if (!time_start || !time_end) {
      return res.status(400).json({ error: 1, data: { desc: 'time_start и time_end обязательны (формат: dd.mm.yyyy hh:mm)' } });
    }

    console.log('📆 Запрос периодов расписания для:', user_id);

    const params = { user_id, time_start, time_end };
    if (clinic_id) params.clinic_id = clinic_id;

    const data = await misRequest('getSchedulePeriods', params);
    res.json(data);
  } catch (err) {
    console.error('❌ Ошибка /mis/schedule-periods:', err.message);
    res.status(500).json({ error: 1, data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе периодов' } });
  }
});

// ═══════════════════════════════════════════════════════════════
// СПЕЦИАЛЬНОСТИ И УСЛУГИ
// ═══════════════════════════════════════════════════════════════

router.post('/professions', authenticate, async (req, res) => {
  try {
    console.log('📋 Запрос списка специальностей');
    const data = await misRequest('getProfessions', { without_doctors: false });
    res.json(data);
  } catch (err) {
    console.error('❌ Ошибка /mis/professions:', err.message);
    res.status(500).json({ error: 1, data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе специальностей' } });
  }
});

// Получить услуги по ID - с поддержкой clinic_id для корректных цен
router.post('/services', authenticate, async (req, res) => {
  try {
    const { service_ids, clinic_id, show_all } = req.body;

    // Если нет service_ids - возвращаем пустой массив (НЕ все услуги!)
    if (!service_ids || !Array.isArray(service_ids) || service_ids.length === 0) {
      console.log('🏥 Запрос услуг: пустой список service_ids');
      return res.json({ error: 0, data: [] });
    }

    console.log('🏥 Запрос услуг:', service_ids.length, 'шт.', clinic_id ? 'clinic_id=' + clinic_id : '(без clinic_id)', show_all ? '(включая скрытые)' : '');

    const params = {
      service_id: service_ids.join(',')
    };

    // Передаём clinic_id для получения корректных цен по конкретной клинике
    if (clinic_id) {
      params.clinic_id = clinic_id;
    }

    // Передаём show_all для включения скрытых услуг
    if (show_all) {
      params.show_all = 1;
    }

    const data = await misRequest('getServices', params);

    res.json(data);
  } catch (err) {
    console.error('❌ Ошибка /mis/services:', err.message);
    res.status(500).json({ error: 1, data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе услуг' } });
  }
});

// Получить все услуги через дерево категорий.
// Прямой getServices с большим limit в МИС обрезает прейскурант, поэтому грузим
// по категориям. По запросу можно сохранить дубликаты для сравнения лабораторий.
router.post('/all-services', authenticate, async (req, res) => {
  try {
    const { clinic_id, preserve_duplicates } = req.body;
    console.log('📋 Запрос всех услуг МИС', clinic_id ? `clinic_id=${clinic_id}` : '');

    const categoriesData = await misRequest('getServiceCategories', {});
    if (Number(categoriesData?.error) !== 0 || !Array.isArray(categoriesData?.data)) {
      return res.json({ error: 1, data: [], desc: 'Не удалось получить категории услуг' });
    }

    const chunks = await mapWithConcurrency(
      categoriesData.data,
      4,
      category => fetchCategoryServices(category, clinic_id)
    );
    const services = preserve_duplicates ? chunks.flat() : dedupeServices(chunks.flat());

    console.log(`✅ Загружен полный прейскурант МИС: ${services.length} услуг`);
    res.json({ error: 0, data: services });
  } catch (err) {
    console.error('❌ Ошибка /mis/all-services:', err.message);
    res.status(500).json({ error: 1, data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе всех услуг' } });
  }
});

// Получить список клиник
router.post('/get-clinics', authenticate, async (req, res) => {
  try {
    console.log('🏥 Запрос списка клиник');

    const data = await misRequest('getClinics', {});

    res.json(data);
  } catch (err) {
    console.error('❌ Ошибка /mis/get-clinics:', err.message);
    res.status(500).json({
      error: 1,
      data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе клиник' }
    });
  }
});

// Получить категории услуг (для массовой загрузки)
router.post('/get-service-categories', authenticate, async (req, res) => {
  try {
    console.log('📂 Запрос категорий услуг');

    const data = await misRequest('getServiceCategories', {});

    res.json(data);
  } catch (err) {
    console.error('❌ Ошибка /mis/get-service-categories:', err.message);
    res.status(500).json({
      error: 1,
      data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе категорий' }
    });
  }
});

// Получить услуги по категории (для массовой загрузки)
router.post('/get-services', authenticate, async (req, res) => {
  try {
    const { category_id, show_children, clinic_id } = req.body;

    if (!category_id) {
      return res.status(400).json({
        error: 1,
        data: { desc: 'category_id обязателен' }
      });
    }

    console.log('📋 Запрос услуг по категории:', category_id, show_children ? '(с подкатегориями)' : '');

    const params = {
      category_id: category_id,
      show_children: show_children !== undefined ? show_children : true,
      show_all: 1
    };

    if (clinic_id) {
      params.clinic_id = clinic_id;
    }

    try {
      const data = await misRequest('getServices', params);
      res.json(data);
    } catch (apiErr) {
      // Если ошибка ECONNRESET и запрос был с show_children, попробуем без подкатегорий
      if (apiErr.code === 'ECONNRESET' && params.show_children) {
        console.log('⚠️ ECONNRESET - пробуем без подкатегорий...');
        params.show_children = false;

        try {
          const retryData = await misRequest('getServices', params);
          console.log('✅ Успешно получено без подкатегорий');
          res.json(retryData);
        } catch (retryErr) {
          throw retryErr; // Пробрасываем ошибку дальше
        }
      } else {
        throw apiErr; // Пробрасываем ошибку дальше
      }
    }
  } catch (err) {
    console.error('❌ Ошибка /mis/get-services:', err.message);

    // Более информативное сообщение об ошибке
    let errorDesc = 'Ошибка при запросе услуг по категории';
    if (err.code === 'ECONNRESET') {
      errorDesc = 'Слишком большая категория - МИС не смог обработать запрос. Попробуйте выбрать более конкретную подкатегорию.';
    } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
      errorDesc = 'Превышено время ожидания ответа от МИС. Попробуйте снова или выберите меньшую категорию.';
    }

    res.status(500).json({
      error: 1,
      data: { code: err.code || 'SERVER_ERROR', desc: errorDesc }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// ПОИСК УСЛУГ (для анализов)
// ═══════════════════════════════════════════════════════════════

router.post('/search-mis', authenticate, async (req, res) => {
  try {
    const { term, clinic_id } = req.body;

    if (!term || term.length < 2) {
      return res.json({ success: false, data: [], message: 'Минимум 2 символа для поиска' });
    }

    console.log('🔍 Поиск анализов в МИС:', { term, clinic_id });

    const params = {
      term: term,
      limit: 50,
      show_all: 1
    };

    if (clinic_id) {
      params.clinic_id = clinic_id;
    }

    const data = await misRequest('getServices', params);

    if (!data || data.error !== 0 || !Array.isArray(data.data)) {
      return res.json({ success: false, data: [], message: 'Не удалось получить данные из МИС' });
    }

    // Фильтруем и форматируем результаты
    const services = data.data.map(service => ({
      service_id: service.service_id,
      code: service.code || '',
      oms_code: service.sub_code || '',
      title: service.title,
      price: parseFloat(service.price) || 0,
      cost_price: parseFloat(service.original_price) || 0,
      category: service.category_title || '',
      lab: service.lab || '',
      preparation: service.preparation || ''
    }));

    console.log(`✅ Найдено услуг: ${services.length}`);

    res.json({ success: true, data: services });
  } catch (err) {
    console.error('❌ Ошибка /mis/search-mis:', err.message);
    res.status(500).json({ success: false, error: 'Ошибка при поиске в МИС' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ВИЗИТЫ (APPOINTMENTS)
// ═══════════════════════════════════════════════════════════════

// Реальное создание визита из внутреннего тестового стенда. time_end от браузера
// не принимаем: повторно получаем фактическую длительность и считаем его здесь.
router.post('/create-appointment', authenticate, async (req, res) => {
  try {
    if (!req.user.isAdmin && !req.user.canEditDoctorCards) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'Создавать тестовые визиты могут администраторы и редакторы карточек врачей'
      });
    }
    const doctorId = String(req.body.doctor_id || '').trim();
    const clinicId = String(req.body.clinic_id || '').trim();
    const serviceId = String(req.body.service_id || '').trim();
    const timeStart = String(req.body.time_start || '').trim();
    const patientId = String(req.body.patient_id || '').trim();
    const mobile = String(req.body.mobile || '').trim();

    if (!doctorId || !clinicId || !serviceId || !timeStart) {
      return res.status(400).json({
        success: false,
        error: 'invalid_parameters',
        message: 'doctor_id, clinic_id, service_id и time_start обязательны'
      });
    }
    if (!patientId && !mobile && !(req.body.first_name && req.body.last_name && req.body.third_name && req.body.birth_date)) {
      return res.status(400).json({
        success: false,
        error: 'patient_not_identified',
        message: 'Укажите patient_id, мобильный телефон или полностью ФИО и дату рождения'
      });
    }

    const resolved = await resolveBookingDuration({
      doctor_id: doctorId,
      clinic_id: clinicId,
      service_id: serviceId
    });
    const timeEnd = addMinutesToMisDateTime(timeStart, resolved.duration);
    const testComment = '[Тест онлайн-записи Alfa Wiki]';
    const userComment = String(req.body.comment || '').trim();
    const params = {
      doctor_id: doctorId,
      clinic_id: clinicId,
      time_start: timeStart,
      time_end: timeEnd,
      check_intersection: 1,
      services: JSON.stringify([{ service_id: serviceId, count: 1 }]),
      comment: userComment ? `${testComment} ${userComment}` : testComment
    };

    if (patientId) {
      params.patient_id = patientId;
    } else {
      if (req.body.first_name) params.first_name = String(req.body.first_name).trim();
      if (req.body.last_name) params.last_name = String(req.body.last_name).trim();
      if (req.body.third_name) params.third_name = String(req.body.third_name).trim();
      if (req.body.birth_date) params.birth_date = String(req.body.birth_date).trim();
      if (mobile) params.mobile = mobile;
      if ([1, 2, '1', '2'].includes(req.body.gender)) params.gender = Number(req.body.gender);
      if (req.body.email) params.email = String(req.body.email).trim();
    }
    if (req.body.room) params.room = String(req.body.room).trim();
    if (req.body.confirmation_code) params.confirmation_code = String(req.body.confirmation_code).trim();
    if (req.body.no_sms) params.no_sms = 1;
    if (req.body.no_email) params.no_email = 1;

    const data = await misRequest('createAppointment', params);
    if (data && typeof data === 'object' && 'error' in data && Number(data.error) !== 0) {
      const message = data.data?.desc || data.desc || (typeof data.error === 'string' ? data.error : 'МИС отклонила создание визита');
      return res.status(422).json({ success: false, error: 'mis_rejected', message });
    }

    const rawAppointment = data && typeof data === 'object' && 'data' in data ? data.data : data;
    const appointmentId = rawAppointment && typeof rawAppointment === 'object'
      ? (rawAppointment.appointment_id ?? rawAppointment.id ?? rawAppointment)
      : rawAppointment;
    console.log('✅ Тестовый визит создан:', appointmentId);
    res.status(201).json({
      success: true,
      appointment_id: appointmentId,
      doctor_id: doctorId,
      clinic_id: clinicId,
      service_id: serviceId,
      time_start: timeStart,
      time_end: timeEnd,
      duration: resolved.duration,
      duration_source: resolved.source
    });
  } catch (err) {
    const status = err.status || 500;
    console.error('❌ Ошибка /mis/create-appointment:', err.code || err.message);
    res.status(status).json({
      success: false,
      error: err.code || 'create_appointment_failed',
      message: status >= 500 ? 'Не удалось создать визит в МИС' : err.message
    });
  }
});

// getAppointments v2 — список визитов пациентов
// Фронтенд вызывает порциями (по неделям), поэтому date_from/date_to обязательны
router.post('/appointments', authenticate, async (req, res) => {
  try {
    const {
      date_from, date_to,
      clinic_id, doctor_id, patient_id, room,
      status, status_id, appointment_id,
      number,
    } = req.body;

    if (!date_from || !date_to) {
      return res.status(400).json({
        error: 1,
        data: { desc: 'date_from и date_to обязательны (формат: dd.mm.yyyy hh:mm)' },
      });
    }

    console.log('📅 Запрос визитов:', date_from, '→', date_to,
      clinic_id ? `clinic_id=${clinic_id}` : '');

    const params = { date_from, date_to };
    if (clinic_id)      params.clinic_id      = clinic_id;
    if (doctor_id)      params.doctor_id      = doctor_id;
    if (patient_id)     params.patient_id     = patient_id;
    if (room)           params.room           = room;
    if (status)         params.status         = status;
    if (status_id)      params.status_id      = status_id;
    if (appointment_id) params.appointment_id = appointment_id;
    if (number != null) params.number         = number;

    // Пробуем getAppointmentsV2 (документация называет его "v2"),
    // при 500/ошибке fallback на getAppointments
    let data;
    try {
      data = await misRequest('getAppointmentsV2', params);
    } catch (innerErr) {
      console.warn('⚠️  getAppointmentsV2 не сработал, пробуем getAppointments:',
        innerErr.response?.status, JSON.stringify(innerErr.response?.data)?.slice(0, 200));
      data = await misRequest('getAppointments', params);
    }

    res.json(data);
  } catch (err) {
    const misBody = JSON.stringify(err.response?.data)?.slice(0, 500);
    console.error('❌ Ошибка /mis/appointments:', err.message, misBody ? `| МИС: ${misBody}` : '');
    res.status(500).json({ error: 1, data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе визитов' } });
  }
});

// ═══════════════════════════════════════════════════════════════
// ЗАДОЛЖЕННОСТИ (счета)
// ═══════════════════════════════════════════════════════════════

// Парсинг денежной суммы МИС ("1 200,00" | 1200 | "1200.5") → число
const parseMoney = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// Парсинг даты МИС "dd.mm.yyyy[ hh:mm]" → Date | null
const parseRuDate = (s) => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(s || ''));
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
};

const toRuDate = (d) => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
};

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// Загрузка счетов за окно [from, to] с адаптивным разбиением: если МИС давится
// объёмом (500 / error) — делим окно пополам рекурсивно, пока не пройдёт.
async function fetchInvoicesWindow(baseParams, from, to, depth = 0) {
  try {
    const data = await misRequest('getInvoices', {
      ...baseParams,
      date_from: toRuDate(from),
      date_to: toRuDate(to),
    });
    if (Number(data?.error) === 0) {
      const raw = data?.data;
      return Array.isArray(raw) ? raw : (raw ? [raw] : []);
    }
    throw new Error(`МИС error=${data?.error}`);
  } catch (err) {
    const spanDays = Math.round((dayStart(to) - dayStart(from)) / 86400000);
    if (spanDays <= 0 || depth >= 9) {
      console.warn(`⚠️ Пропуск окна ${toRuDate(from)}–${toRuDate(to)}: ${err.message}`);
      return [];
    }
    const mid = dayStart(addDays(from, Math.floor(spanDays / 2)));
    const [a, b] = await Promise.all([
      fetchInvoicesWindow(baseParams, from, mid, depth + 1),
      fetchInvoicesWindow(baseParams, addDays(mid, 1), to, depth + 1),
    ]);
    return a.concat(b);
  }
}

// Подтягиваем номера карт пациентов (getPatient не возвращается в счетах).
// getPatient принимает несколько id через запятую; бьём пачками по 100.
async function fetchCardNumbers(ids) {
  const map = new Map();
  if (!ids.length) return map;
  const batches = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  const results = await mapWithConcurrency(batches, 3, async (batch) => {
    try {
      const data = await misRequest('getPatient', { id: batch.join(',') });
      return Array.isArray(data?.data) ? data.data : (data?.data ? [data.data] : []);
    } catch (err) {
      console.warn('⚠️ getPatient batch не удался:', err.message);
      return [];
    }
  });
  for (const arr of results) {
    for (const p of arr) {
      if (p && p.patient_id != null) {
        map.set(String(p.patient_id), p.number != null ? String(p.number) : null);
      }
    }
  }
  return map;
}

// Балансы кошельков пациентов (getPatientBalance: id, balance, patient_funds, bonus_funds).
// Принимает несколько patient_id через запятую; бьём пачками по 100.
async function fetchPatientBalances(ids) {
  const map = new Map();
  if (!ids.length) return map;
  const batches = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  const results = await mapWithConcurrency(batches, 3, async (batch) => {
    try {
      const data = await misRequest('getPatientBalance', { patient_id: batch.join(',') });
      return Array.isArray(data?.data) ? data.data : (data?.data ? [data.data] : []);
    } catch (err) {
      console.warn('⚠️ getPatientBalance batch не удался:', err.message);
      return [];
    }
  });
  for (const arr of results) {
    for (const b of arr) {
      if (b && b.id != null) map.set(String(b.id), parseMoney(b.balance));
    }
  }
  return map;
}

// Сводка по должникам: неоплаченные счета (status_code=0), агрегированные по пациенту.
// Снимок «весь долг на конец периода»: date_to = конец периода, date_from = широкий старт.
router.post('/debtors', authenticate, async (req, res) => {
  try {
    const { date_from, date_to, clinic_id, clinic_ids } = req.body;

    const start = parseRuDate(date_from) || new Date(2010, 0, 1);
    const end = parseRuDate(date_to) || new Date();

    // Список клиник: поддержка нескольких (clinic_ids массив/строка) + одиночного clinic_id
    const clinicList = (Array.isArray(clinic_ids) ? clinic_ids : String(clinic_ids ?? clinic_id ?? '').split(','))
      .map(s => String(s).trim()).filter(Boolean);
    // Одна база на «все клиники», либо по одной на каждую выбранную (МИС-фильтр по clinic_id)
    const baseParamsList = clinicList.length
      ? clinicList.map(cid => ({ status: 1, clinic_id: cid }))
      : [{ status: 1 }];

    console.log('💰 Запрос задолженностей:', toRuDate(start), '→', toRuDate(end),
      clinicList.length ? `clinics=${clinicList.join(',')}` : '(все клиники)');

    // Разбиваем период на месяцы — лёгкие месяцы уходят одним запросом,
    // тяжёлые fetchInvoicesWindow делит пополам, пока МИС не переварит.
    const windows = [];
    let cur = dayStart(start);
    const endDay = dayStart(end);
    while (cur <= endDay) {
      const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      windows.push([cur, monthEnd < endDay ? monthEnd : endDay]);
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }

    // Задачи = каждое окно × каждая выбранная клиника
    const tasks = [];
    for (const [f, t] of windows) for (const bp of baseParamsList) tasks.push({ bp, f, t });
    const chunks = await mapWithConcurrency(tasks, 4, (task) => fetchInvoicesWindow(task.bp, task.f, task.t));

    // Дедуп по id счёта (окна не пересекаются, но подстрахуемся)
    const seenInvoice = new Set();
    const invoices = [];
    for (const inv of chunks.flat()) {
      const key = String(inv.id ?? inv.number ?? '');
      if (key && seenInvoice.has(key)) continue;
      if (key) seenInvoice.add(key);
      invoices.push(inv);
    }

    // Только полностью неоплаченные (status_code === 0), не в корзине
    const unpaid = invoices.filter(inv => Number(inv.status_code) === 0 && !inv.is_deleted);

    const byPatient = new Map();
    const byClinic = new Map();
    const byDoctor = new Map();
    const byCompany = new Map();
    for (const inv of unpaid) {
      const pid = String(inv.patient_id || '').trim();
      if (!pid) continue;

      const isCompany = !!inv.company_id;
      const value = parseMoney(inv.value);

      let rec = byPatient.get(pid);
      if (!rec) {
        rec = {
          patient_id: pid,
          patient: inv.patient || '',
          mobile: inv.patient_mobile || '',
          debt_individual: 0,
          debt_company: 0,
          invoices_count: 0,
          companies: new Set(),
        };
        byPatient.set(pid, rec);
      }

      if (isCompany) {
        rec.debt_company += value;
        if (inv.company) rec.companies.add(inv.company);

        // Разбивка по компаниям-плательщикам (ДМС/юр. лица)
        const compKey = String(inv.company_id);
        let cm = byCompany.get(compKey);
        if (!cm) {
          cm = { company_id: compKey, company: inv.company || `Компания ${compKey}`, debt_total: 0, invoices: 0, patients: new Set() };
          byCompany.set(compKey, cm);
        }
        cm.debt_total += value;
        cm.invoices += 1;
        cm.patients.add(pid);
      } else {
        rec.debt_individual += value;
      }
      rec.invoices_count += 1;

      // Разбивка по медцентрам
      const cid = String(inv.clinic_id || '').trim();
      if (cid) {
        let cl = byClinic.get(cid);
        if (!cl) {
          cl = { clinic_id: cid, clinic: inv.clinic || `Клиника ${cid}`, debt_individual: 0, debt_company: 0, patients: new Set() };
          byClinic.set(cid, cl);
        }
        if (isCompany) cl.debt_company += value; else cl.debt_individual += value;
        cl.patients.add(pid);
      }

      // Разбивка по врачам-исполнителям услуг (из services счёта)
      for (const s of (Array.isArray(inv.services) ? inv.services : [])) {
        if (s.is_deleted) continue;
        const sval = parseMoney(s.value);
        if (!sval) continue;
        const did = s.doctor_id != null && s.doctor_id !== '' ? String(s.doctor_id) : 'none';
        let dr = byDoctor.get(did);
        if (!dr) {
          dr = { doctor_id: did === 'none' ? null : did, doctor: s.doctor_name || 'Без исполнителя', debt_individual: 0, debt_company: 0, services: 0, patients: new Set() };
          byDoctor.set(did, dr);
        }
        if (isCompany) dr.debt_company += sval; else dr.debt_individual += sval;
        dr.services += 1;
        dr.patients.add(pid);
      }
    }

    const list = Array.from(byPatient.values()).map(r => ({
      patient_id: r.patient_id,
      card_number: null,
      balance: null,
      patient: r.patient,
      mobile: r.mobile,
      debt_individual: Math.round(r.debt_individual * 100) / 100,
      debt_company: Math.round(r.debt_company * 100) / 100,
      debt_total: Math.round((r.debt_individual + r.debt_company) * 100) / 100,
      invoices_count: r.invoices_count,
      companies: Array.from(r.companies),
    })).sort((a, b) => b.debt_total - a.debt_total);

    // Обогащаем номерами карт и балансами кошельков (параллельно)
    try {
      const patientIds = list.map(r => r.patient_id);
      const [cardMap, balanceMap] = await Promise.all([
        fetchCardNumbers(patientIds),
        fetchPatientBalances(patientIds),
      ]);
      for (const r of list) {
        r.card_number = cardMap.get(r.patient_id) || null;
        r.balance = balanceMap.has(r.patient_id) ? balanceMap.get(r.patient_id) : null;
      }
    } catch (enrichErr) {
      console.warn('⚠️ Не удалось обогатить карты/балансы:', enrichErr.message);
    }

    const totals = list.reduce((acc, r) => {
      acc.debt_individual += r.debt_individual;
      acc.debt_company += r.debt_company;
      acc.debt_total += r.debt_total;
      return acc;
    }, { debt_individual: 0, debt_company: 0, debt_total: 0 });
    totals.debt_individual = Math.round(totals.debt_individual * 100) / 100;
    totals.debt_company = Math.round(totals.debt_company * 100) / 100;
    totals.debt_total = Math.round(totals.debt_total * 100) / 100;
    totals.patients = list.length;
    totals.invoices = unpaid.length;

    const byClinicArr = Array.from(byClinic.values()).map(c => ({
      clinic_id: c.clinic_id,
      clinic: c.clinic,
      debt_individual: Math.round(c.debt_individual * 100) / 100,
      debt_company: Math.round(c.debt_company * 100) / 100,
      debt_total: Math.round((c.debt_individual + c.debt_company) * 100) / 100,
      patients: c.patients.size,
    })).sort((a, b) => b.debt_total - a.debt_total);

    const byDoctorArr = Array.from(byDoctor.values()).map(d => ({
      doctor_id: d.doctor_id,
      doctor: d.doctor,
      debt_individual: Math.round(d.debt_individual * 100) / 100,
      debt_company: Math.round(d.debt_company * 100) / 100,
      debt_total: Math.round((d.debt_individual + d.debt_company) * 100) / 100,
      services: d.services,
      patients: d.patients.size,
    })).sort((a, b) => b.debt_total - a.debt_total);

    const byCompanyArr = Array.from(byCompany.values()).map(c => ({
      company_id: c.company_id,
      company: c.company,
      debt_total: Math.round(c.debt_total * 100) / 100,
      invoices: c.invoices,
      patients: c.patients.size,
    })).sort((a, b) => b.debt_total - a.debt_total);

    // Динамика: бакеты по дням/месяцам/годам в зависимости от длины периода
    const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    const spanDays = Math.round((dayStart(end) - dayStart(start)) / 86400000) + 1;
    const unit = spanDays <= 45 ? 'day' : (spanDays <= 550 ? 'month' : 'year');
    const bkey = (d) => unit === 'day'
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      : unit === 'month'
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        : `${d.getFullYear()}`;
    const blabel = (d) => unit === 'day'
      ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
      : unit === 'month'
        ? `${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
        : `${d.getFullYear()}`;

    const timelineMap = new Map();
    const tcur = dayStart(start);
    const endDay2 = dayStart(end);
    for (let i = 0; tcur <= endDay2 && i < 4000; i++) {
      const k = bkey(tcur);
      if (!timelineMap.has(k)) timelineMap.set(k, { key: k, label: blabel(tcur), debt_individual: 0, debt_company: 0 });
      if (unit === 'day') tcur.setDate(tcur.getDate() + 1);
      else if (unit === 'month') tcur.setMonth(tcur.getMonth() + 1);
      else tcur.setFullYear(tcur.getFullYear() + 1);
    }
    for (const inv of unpaid) {
      const d = parseRuDate(inv.date);
      if (!d) continue;
      const k = bkey(d);
      let b = timelineMap.get(k);
      if (!b) { b = { key: k, label: blabel(d), debt_individual: 0, debt_company: 0 }; timelineMap.set(k, b); }
      if (inv.company_id) b.debt_company += parseMoney(inv.value);
      else b.debt_individual += parseMoney(inv.value);
    }
    const timeline = Array.from(timelineMap.values())
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(b => ({
        label: b.label,
        debt_individual: Math.round(b.debt_individual * 100) / 100,
        debt_company: Math.round(b.debt_company * 100) / 100,
        debt_total: Math.round((b.debt_individual + b.debt_company) * 100) / 100,
      }));

    // Aging: возраст счёта относительно конца периода
    const agingDefs = [
      { label: '0–30 дней', min: 0, max: 30 },
      { label: '31–60 дней', min: 31, max: 60 },
      { label: '61–90 дней', min: 61, max: 90 },
      { label: '90+ дней', min: 91, max: Infinity },
    ];
    const agingAcc = agingDefs.map(d => ({ bucket: d.label, debt_individual: 0, debt_company: 0 }));
    for (const inv of unpaid) {
      const d = parseRuDate(inv.date);
      if (!d) continue;
      const age = Math.max(0, Math.floor((dayStart(end) - dayStart(d)) / 86400000));
      const idx = agingDefs.findIndex(x => age >= x.min && age <= x.max);
      const b = agingAcc[idx >= 0 ? idx : agingDefs.length - 1];
      if (inv.company_id) b.debt_company += parseMoney(inv.value);
      else b.debt_individual += parseMoney(inv.value);
    }
    const aging = agingAcc.map(b => ({
      bucket: b.bucket,
      debt_individual: Math.round(b.debt_individual * 100) / 100,
      debt_company: Math.round(b.debt_company * 100) / 100,
      debt_total: Math.round((b.debt_individual + b.debt_company) * 100) / 100,
    }));

    console.log(`✅ Должников: ${list.length}, счетов: ${unpaid.length}, сумма: ${totals.debt_total}`);
    res.json({ error: 0, data: list, totals, by_clinic: byClinicArr, by_doctor: byDoctorArr, by_company: byCompanyArr, timeline, timeline_unit: unit, aging });
  } catch (err) {
    const misBody = JSON.stringify(err.response?.data)?.slice(0, 500);
    console.error('❌ Ошибка /mis/debtors:', err.message, misBody ? `| МИС: ${misBody}` : '');
    res.status(500).json({ error: 1, data: [], desc: 'Ошибка при запросе задолженностей' });
  }
});

// ═══════════════════════════════════════════════════════════════
// КЛИНИКИ
// ═══════════════════════════════════════════════════════════════

// Список клиник для фронта. id — это clinic_id из МИС (первый в misClinicIds), а не
// UUID справочника: по нему модули сверяют клиники сотрудника, пришедшие из getUsers.
//
// Раньше список был захардкожен прямо здесь, и новый филиал в справочнике до
// зарплатного модуля не доезжал: «Нео» (clinic_id 12) завели в med_centers, а страница
// продолжала знать только про Сукко и красила сотрудников Нео её цветом. Читаем
// справочник — ver. 6.67 для того его и заводил.
//
// includeVirtual: «Направители» (id 8) — служебная группировка зарплатного модуля,
// но выбирать её там нужно наравне с филиалами. АУП отдавать не надо: страница
// добавляет его сама и только тем, у кого есть доступ.
router.get('/clinics', authenticate, async (req, res) => {
  try {
    const rows = await medCenters.list({ includeVirtual: true });
    const data = rows
      .map(r => ({ misId: (r.misClinicIds || [])[0], row: r }))
      .filter(({ misId }) => misId && misId !== 'aup')
      .map(({ misId, row }) => ({
        // Числовые id отдаём числами: так их отдавал прежний хардкод, и часть
        // сравнений на фронте до сих пор нестрогая.
        id: /^\d+$/.test(misId) ? Number(misId) : misId,
        name: row.name,
        code: row.code,
        color: row.color
      }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('❌ Ошибка /mis/clinics:', err.message);
    res.status(500).json({ success: false, error: 'Ошибка загрузки справочника клиник' });
  }
});

module.exports = router;
