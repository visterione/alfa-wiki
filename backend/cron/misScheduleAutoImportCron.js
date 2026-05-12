/**
 * Автоматический импорт расписания из МИС для всех сотрудников с ролью "Врач"
 * Запускается дважды в месяц:
 *   — 14-го числа в 03:00 МСК → импорт дней 1–14
 *   — 28-го числа в 03:00 МСК → импорт полного месяца
 */

const cron   = require('node-cron');
const axios  = require('axios');
const qs     = require('qs');
const { importForUser } = require('../services/misScheduleImport');

const MIS_API_KEY  = process.env.MIS_API_KEY  || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';

async function fetchAllDoctors() {
  const response = await axios.post(
    `${MIS_BASE_URL}/getUsers`,
    qs.stringify({ api_key: MIS_API_KEY, role: 'doctor', show_all: true }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
  );
  return response.data;
}

async function runAutoImport(endDay = null) {
  const now   = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const label = endDay ? `1–${endDay}` : 'весь месяц';

  console.log(`[MIS Auto Import] Старт: месяц=${month}, диапазон=${label}`);

  let data;
  try {
    data = await fetchAllDoctors();
  } catch (err) {
    console.error('[MIS Auto Import] Не удалось получить список врачей из МИС:', err.message);
    return;
  }

  if (Number(data?.error) !== 0 || !Array.isArray(data?.data)) {
    console.error('[MIS Auto Import] МИС вернул ошибку при получении врачей:', data);
    return;
  }

  // Оставляем только сотрудников с ролью "Врач"
  const doctors = data.data.filter(d => {
    const roles = d.role_titles
      ? String(d.role_titles).split(',').map(s => s.trim())
      : (Array.isArray(d.role_names) ? d.role_names : []);
    return roles.includes('Врач');
  });

  console.log(`[MIS Auto Import] Врачей для импорта: ${doctors.length}`);

  let success = 0;
  let errors  = 0;
  for (const doctor of doctors) {
    try {
      await importForUser(String(doctor.id), month, endDay);
      success++;
    } catch (err) {
      console.error(`[MIS Auto Import] Ошибка для user=${doctor.id} (${doctor.name || ''}):`, err.message);
      errors++;
    }
  }

  console.log(`[MIS Auto Import] Завершено: успех=${success}, ошибок=${errors}, месяц=${month}, диапазон=${label}`);
}

// 14-го в 03:00 МСК — импорт дней 1–14
cron.schedule('0 3 14 * *', async () => {
  console.log('[MIS Auto Import] Запуск: полмесяца (1–14)');
  await runAutoImport(14);
}, { timezone: 'Europe/Moscow' });

// Последний день месяца в 03:00 МСК — импорт полного месяца
// node-cron не поддерживает "L", поэтому запускаемся с 28-го и проверяем внутри
cron.schedule('0 3 28,29,30,31 * *', async () => {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (now.getDate() !== daysInMonth) return; // не последний день — пропускаем
  console.log('[MIS Auto Import] Запуск: полный месяц (последний день месяца)');
  await runAutoImport(null);
}, { timezone: 'Europe/Moscow' });

console.log('✅ Cron автоимпорта расписания из МИС инициализирован (14-е и последний день месяца в 03:00 МСК)');
