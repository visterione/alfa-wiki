/**
 * Прокси для API МИС Renovatio v3
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

// Helper для POST запросов к МИС
const misRequest = async (endpoint, params = {}) => {
  console.log(`🔗 MIS Request: ${endpoint}`, JSON.stringify(params));
  
  try {
    const response = await axios.post(
      `${MIS_BASE_URL}/${endpoint}`,
      qs.stringify({ api_key: MIS_API_KEY, ...params }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: REQUEST_TIMEOUT
      }
    );
    
    console.log(`📥 MIS Response ${endpoint}:`, JSON.stringify(response.data).substring(0, 500));
    return response.data;
  } catch (error) {
    console.error(`❌ MIS Error ${endpoint}:`, error.message);
    throw error;
  }
};

// ═══════════════════════════════════════════════════════════════
// ВРАЧИ
// ═══════════════════════════════════════════════════════════════

// Получить данные врача по ID (включая услуги)
router.post('/doctor-info', authenticate, async (req, res) => {
  try {
    const userId = req.body.userId || req.body.user_id || req.body.id;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId обязателен' });
    }

    console.log('👨‍⚕️ Запрос данных врача:', userId);

    // Запрашиваем с with_services: 1 чтобы получить список услуг
    const data = await misRequest('getUsers', {
      user_id: userId,
      role: 'doctor',
      with_services: 1
    });

    const errorCode = Number(data?.error);
    const doctorsArray = Array.isArray(data?.data) ? data.data : [];

    if (errorCode !== 0 || doctorsArray.length === 0) {
      console.log('⚠️ Врач не найден:', userId);
      return res.json({ success: false, error: 'Врач не найден', data: null });
    }

    const doctor = doctorsArray[0];
    
    // Логируем для отладки
    console.log('👨‍⚕️ Doctor data:', {
      id: doctor.id,
      name: doctor.name,
      services: doctor.services,
      servicesCount: doctor.services ? doctor.services.length : 0
    });
    
    res.json({
      success: true,
      data: {
        id: doctor.id,
        name: doctor.name || `${doctor.last_name || ''} ${doctor.first_name || ''} ${doctor.middle_name || ''}`.trim(),
        professions: doctor.professions || [],
        services: doctor.services || [],  // Массив ID услуг
        clinics: doctor.clinics || [],
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

// Поиск/список врачей
router.post('/doctors', authenticate, async (req, res) => {
  try {
    const { clinic_id, profession_id } = req.body;

    console.log('👨‍⚕️ Запрос списка врачей');

    const params = {
      role: 'doctor',
      show_all: true
    };

    if (clinic_id) params.clinic_id = clinic_id;
    if (profession_id) params.profession_id = profession_id;

    const data = await misRequest('getUsers', params);
    res.json(data);
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

// Получить записи на приём (занятые слоты)
router.post('/schedule', authenticate, async (req, res) => {
  try {
    const { user_id, clinic_id, date_start, date_end } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 1, data: { desc: 'user_id обязателен' } });
    }

    console.log('📅 Запрос записей для врача:', user_id, 'даты:', date_start, '-', date_end);

    const params = { user_id };
    if (clinic_id) params.clinic_id = clinic_id;
    if (date_start) params.date_start = date_start;
    if (date_end) params.date_end = date_end;

    const data = await misRequest('getSchedule', params);
    
    console.log('📅 Записи врача:', JSON.stringify(data).substring(0, 1000));
    
    res.json(data);
  } catch (err) {
    console.error('❌ Ошибка /mis/schedule:', err.message);
    res.status(500).json({
      error: 1,
      data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе расписания' }
    });
  }
});

// Получить периоды работы врача (рабочее время)
router.post('/schedule-periods', authenticate, async (req, res) => {
  try {
    const { user_id, clinic_id, date_start, date_end } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 1, data: { desc: 'user_id обязателен' } });
    }

    console.log('📆 Запрос периодов работы врача:', user_id);

    const params = { user_id };
    if (clinic_id) params.clinic_id = clinic_id;
    if (date_start) params.date_start = date_start;
    if (date_end) params.date_end = date_end;

    const data = await misRequest('getSchedulePeriods', params);
    
    console.log('📆 Периоды работы:', JSON.stringify(data).substring(0, 1000));
    
    res.json(data);
  } catch (err) {
    console.error('❌ Ошибка /mis/schedule-periods:', err.message);
    res.status(500).json({
      error: 1,
      data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе периодов' }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// СПЕЦИАЛЬНОСТИ И УСЛУГИ
// ═══════════════════════════════════════════════════════════════

// Список специальностей
router.post('/professions', authenticate, async (req, res) => {
  try {
    console.log('📋 Запрос списка специальностей');

    const data = await misRequest('getProfessions', {
      without_doctors: false
    });

    res.json(data);
  } catch (err) {
    console.error('❌ Ошибка /mis/professions:', err.message);
    res.status(500).json({
      error: 1,
      data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе специальностей' }
    });
  }
});

// Получить услуги по списку ID
router.post('/services', authenticate, async (req, res) => {
  try {
    const { service_ids } = req.body;

    // Проверяем что переданы ID услуг
    if (!service_ids || !Array.isArray(service_ids) || service_ids.length === 0) {
      console.log('⚠️ /mis/services: Пустой список service_ids');
      return res.json({ error: 0, data: [] });
    }

    console.log('🏥 Запрос услуг. Количество ID:', service_ids.length);
    console.log('🏥 Service IDs:', service_ids.slice(0, 10), service_ids.length > 10 ? '...' : '');

    // Формируем строку ID через запятую
    const idsString = service_ids.join(',');
    
    const data = await misRequest('getServices', {
      service_ids: idsString
    });

    console.log('🏥 Ответ getServices:', {
      error: data.error,
      dataType: typeof data.data,
      isArray: Array.isArray(data.data),
      count: Array.isArray(data.data) ? data.data.length : (data.data ? 1 : 0)
    });

    res.json(data);
  } catch (err) {
    console.error('❌ Ошибка /mis/services:', err.message);
    res.status(500).json({
      error: 1,
      data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе услуг' }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// КЛИНИКИ
// ═══════════════════════════════════════════════════════════════

router.get('/clinics', authenticate, (req, res) => {
  res.json({
    success: true,
    data: [
      { id: 1, name: 'Альфа', code: 'А', color: '#FF80AB' },
      { id: 2, name: 'Кидс', code: 'К', color: '#FFA726' },
      { id: 3, name: 'Проф', code: 'П', color: '#7E57C2' },
      { id: 4, name: 'Линия', code: 'Л', color: '#C5E1A5' },
      { id: 5, name: '3К', code: '3К', color: '#BA68C8' },
      { id: 6, name: 'Смайл', code: 'С', color: '#555555' }
    ]
  });
});

module.exports = router;