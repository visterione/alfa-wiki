/**
 * Прокси для API МИС Renovatio
 * Позволяет получать данные врачей, расписание, услуги из внешней системы
 */

const express = require('express');
const axios = require('axios');
const qs = require('qs');
const { authenticate } = require('../middleware/auth');

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

    res.json({ error: 0, data: merged });
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

// Получить все услуги (без фильтра по категории или врачу)
// Используется для глобального списка при назначении бонусов
router.post('/all-services', authenticate, async (req, res) => {
  try {
    const { clinic_id } = req.body;
    console.log('📋 Запрос всех услуг МИС', clinic_id ? `clinic_id=${clinic_id}` : '');

    const params = { show_all: 1, limit: 5000 };
    if (clinic_id) params.clinic_id = clinic_id;

    const data = await misRequest('getServices', params);
    res.json(data);
  } catch (err) {
    console.error('❌ Ошибка /mis/all-services:', err.message);
    res.status(500).json({ error: 1, data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе всех услуг' } });
  }
});

// Получить список клиник
router.post('/get-clinics', authenticate, async (req, res) => {
  try {
    console.log('🏥 Запрос списка клиник');

    const data = await misRequest('getClinics', {
      show_all: 1
    });

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
// КЛИНИКИ
// ═══════════════════════════════════════════════════════════════

router.get('/clinics', authenticate, (req, res) => {
  // ID соответствуют реальным clinic_id из МИС (как в doctor-card.html)
  res.json({
    success: true,
    data: [
      { id: 2, name: 'Альфа', code: 'А', color: '#de64a1' },
      { id: 3, name: 'Кидс', code: 'К', color: '#ed9121' },
      { id: 1, name: 'Проф', code: 'П', color: '#9999ff' },
      { id: 6, name: 'Линия', code: 'Л', color: '#e2d1bb' },
      { id: 4, name: '3К', code: '3К', color: '#800080' },
      { id: 7, name: 'Смайл', code: 'С', color: '#999999' }
    ]
  });
});

module.exports = router;