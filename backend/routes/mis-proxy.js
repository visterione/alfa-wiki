/**
 * Прокси для API МИС Renovatio
 * Позволяет получать данные врачей, расписание, услуги из внешней системы
 */

const express = require('express');
const axios = require('axios');
const qs = require('qs');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// API ключ МИС Renovatio (можно вынести в .env)
const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';

// Таймаут для запросов
const REQUEST_TIMEOUT = 15000;

// Helper для POST запросов к МИС
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

// Получить данные врача по ID
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
      with_services: 1
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
        professions: doctor.professions || [],
        services: doctor.services || [],
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

// Получить расписание врача
router.post('/schedule', authenticate, async (req, res) => {
  try {
    const { user_id, clinic_id, date_start, date_end } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 1, data: { desc: 'user_id обязателен' } });
    }

    console.log('📅 Запрос расписания для врача:', user_id);

    const params = { user_id };
    if (clinic_id) params.clinic_id = clinic_id;
    if (date_start) params.date_start = date_start;
    if (date_end) params.date_end = date_end;

    const data = await misRequest('getSchedule', params);

    res.json(data);
  } catch (err) {
    console.error('❌ Ошибка /mis/schedule:', err.message);
    res.status(500).json({
      error: 1,
      data: { code: 'SERVER_ERROR', desc: 'Ошибка при запросе расписания' }
    });
  }
});

// Получить периоды расписания
router.post('/schedule-periods', authenticate, async (req, res) => {
  try {
    const { user_id, clinic_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 1, data: { desc: 'user_id обязателен' } });
    }

    console.log('📆 Запрос периодов расписания:', user_id);

    const params = { user_id };
    if (clinic_id) params.clinic_id = clinic_id;

    const data = await misRequest('getSchedulePeriods', params);

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

// Получить услуги по ID
router.post('/services', authenticate, async (req, res) => {
  try {
    const { service_ids } = req.body;

    if (!service_ids || !Array.isArray(service_ids) || service_ids.length === 0) {
      return res.json({ error: 0, data: [] });
    }

    console.log('🏥 Запрос услуг:', service_ids.length, 'шт.');

    const data = await misRequest('getServices', {
      service_ids: service_ids.join(',')
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

// Справочник клиник (статический, т.к. в МИС может не быть endpoint)
router.get('/clinics', authenticate, (req, res) => {
  res.json({
    success: true,
    data: [
      { id: 1, name: 'Альфа', code: 'А', color: '#4a90e2' },
      { id: 2, name: 'Кидс', code: 'К', color: '#50c878' },
      { id: 3, name: 'Проф', code: 'П', color: '#9b59b6' },
      { id: 4, name: 'Линия', code: 'Л', color: '#e74c3c' },
      { id: 5, name: 'Смайл', code: 'С', color: '#f39c12' },
      { id: 6, name: '3К', code: '3К', color: '#1abc9c' }
    ]
  });
});

module.exports = router;