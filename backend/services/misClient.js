/**
 * Тонкий клиент к API МИС Renovatio.
 * Вынесен из routes/mis-proxy.js, чтобы переиспользовать в клиентских ботах.
 */
const axios = require('axios');
const qs = require('qs');

const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const REQUEST_TIMEOUT = 15000;

async function misRequest(endpoint, params = {}) {
  const response = await axios.post(
    `${MIS_BASE_URL}/${endpoint}`,
    qs.stringify({ api_key: MIS_API_KEY, ...params }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: REQUEST_TIMEOUT
    }
  );
  return response.data;
}

/**
 * Нормализует телефон к 11 цифрам РФ (7XXXXXXXXXX).
 * Поиск в МИС терпим к формату, но нормализуем для детерминированности и хранения.
 */
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
  if (digits.length === 10) digits = '7' + digits;
  return digits;
}

/**
 * Ищет пациентов по мобильному телефону.
 * Ответ МИС: { error, data }, где data — null | объект | массив объектов.
 * Возвращает всегда массив (по одному номеру может быть несколько карт — семьи).
 */
async function getPatientsByPhone(mobile) {
  const res = await misRequest('getPatient', { mobile: normalizePhone(mobile) });
  const data = res && typeof res === 'object' && 'data' in res ? res.data : res;
  if (data == null) return [];
  return Array.isArray(data) ? data : [data];
}

/**
 * Карточки пациентов по их идентификаторам, пачкой (ver. 8.08).
 *
 * getPatient принимает id списком через запятую, и это важно: согласие на
 * сообщения (send_sms) проверяется у каждого адресата, а у рекламной рассылки
 * адресатов тысячи. Сотня карточек одним запросом возвращается за полсекунды —
 * поштучно это была бы сотня запросов.
 *
 * Несуществующий id МИС молча пропускает: в ответе просто нет такой карточки.
 * Поэтому сверять надо по тому, что вернулось, а не по длине ответа.
 */
async function getPatientsByIds(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean);
  if (!list.length) return [];

  const res = await misRequest('getPatient', { id: list.join(',') });
  const data = res && typeof res === 'object' && 'data' in res ? res.data : res;
  if (data == null) return [];
  return Array.isArray(data) ? data : [data];
}

/**
 * Телефон в том виде, в каком его ждёт МИС: «+7 (XXX) XXX-XX-XX».
 * Публичное API форм хранит его как «+7XXXXXXXXXX».
 */
function formatMobile(raw) {
  const d = normalizePhone(raw);
  if (d.length !== 11) return String(raw || '');
  return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
}

/**
 * Заводит пациента в МИС.
 *
 * Метод принимает только ФИО, дату рождения, пол и контакты — паспорт и адрес,
 * которые собирает анкета с сайта, ему передать нечем. Их дозаполняют в МИС
 * руками по тексту заявки в чате.
 *
 * @param {Object} p
 * @param {string} p.lastName
 * @param {string} p.firstName
 * @param {string} [p.middleName]
 * @param {string} [p.birthDate]  ISO ГГГГ-ММ-ДД
 * @param {'male'|'female'} [p.gender]
 * @param {string} [p.phone]
 * @param {string} [p.email]
 * @returns {Promise<Object>} карточка пациента: { patient_id, number, ... }
 */
async function createPatient(p) {
  const params = {
    last_name:  p.lastName,
    first_name: p.firstName
  };

  if (p.middleName) params.third_name = p.middleName;
  if (p.birthDate) {
    const [y, m, d] = String(p.birthDate).split('-');
    params.birth_date = `${d}.${m}.${y}`;
  }
  if (p.gender) params.gender = p.gender === 'female' ? 2 : 1;
  if (p.phone) params.mobile = formatMobile(p.phone);
  if (p.email) params.email = p.email;

  const res = await misRequest('createPatient', params);

  // МИС отвечает { error, data }; при отказе текст ошибки лежит в error
  if (res && typeof res === 'object' && res.error) {
    throw new Error(typeof res.error === 'string' ? res.error : 'МИС отклонила создание пациента');
  }

  const data = res && typeof res === 'object' && 'data' in res ? res.data : res;
  if (!data || !data.patient_id) {
    throw new Error('МИС не вернула карточку пациента');
  }
  return data;
}

/**
 * Чем мы представляемся МИС. Одно значение на все методы записи: различать
 * источники по филиалам и каналам заказчик решил не заводить, пока не проверено,
 * не перезаписывает ли source исходную атрибуцию визита.
 */
const confirmSource = () => process.env.MIS_CONFIRM_SOURCE || 'Альфа-Вики';

/**
 * МИС на успешную запись отвечает true, но в зависимости от метода — то булевым,
 * то строкой, то единицей, то всё это внутри { data }.
 */
function acceptedByMis(res) {
  const value = res && typeof res === 'object' && 'data' in res ? res.data : res;
  return value === true || value === 'true' || value === 1 || value === '1';
}

/**
 * Добавляет категорию пациенту. МИС возвращает true при успехе.
 */
async function addPatientCategory(patientId, categoryId) {
  const res = await misRequest('addPatientCategory', {
    patient_id: patientId,
    category_id: categoryId
  });
  return acceptedByMis(res);
}

/**
 * Подтверждение визита пациентом. Единственный метод, которым мы пишем в МИС по
 * уведомлениям: человек нажал кнопку в боте — отметка должна оказаться там же,
 * где её ждёт администратор, а не только у нас.
 *
 * confirm_status по умолчанию 1 («подтверждён»); source называем собой, чтобы в
 * МИС было видно, откуда пришло подтверждение.
 */
async function confirmAppointment(appointmentId, confirmStatus = 1) {
  const res = await misRequest('confirmAppointment', {
    appointment_id: appointmentId,
    confirm_status: confirmStatus,
    source: confirmSource()
  });
  return acceptedByMis(res);
}

/**
 * Отмена визита пациентом (ver. 8.33). Второй — и последний — метод, которым мы
 * пишем в МИС по уведомлениям.
 *
 * Комментарий не обязателен по документации, но обязателен по смыслу: в карточке
 * администратор видит сам факт отмены и не видит, чьих он рук. Без пояснения
 * отмена, сделанная пациентом из бота, выглядит как отмена, сделанная кем-то из
 * своих, и разбираться в этом приходится звонком.
 *
 * is_handled намеренно не передаём. Отменённый визит должен остаться
 * необработанным и попасть колл-центру на перезвон: переспрашивать «вы уверены»
 * мы не стали сознательно, и звонок — единственное, что возвращает приём,
 * отменённый по ошибке.
 */
async function cancelAppointment(appointmentId, comment = null) {
  const params = {
    appointment_id: appointmentId,
    source: confirmSource()
  };
  if (comment) params.comment = comment;

  const res = await misRequest('cancelAppointment', params);
  return acceptedByMis(res);
}

/**
 * Статус визита: upcoming (предстоящий), completed (завершён), refused (отменён).
 *
 * Спрашивается перед отменой по кнопке (ver. 8.33). Кнопка под сообщением живёт
 * вечно, а напоминание приходит за сутки до приёма — нажать «Отменить» можно и
 * назавтра после визита, пролистав переписку. Один запрос здесь дешевле, чем
 * потом объяснять, почему состоявшийся приём числится отменённым.
 *
 * Метод принимает несколько идентификаторов через запятую, и на один отвечает
 * то массивом, то объектом — разбираем оба вида. Угадывать форму ответа по
 * одному удачному запросу мы в этом API уже пробовали.
 */
async function checkAppointmentStatus(appointmentId) {
  const res = await misRequest('checkAppointmentStatus', { appointment_id: appointmentId });
  const data = res && typeof res === 'object' && 'data' in res ? res.data : res;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;

  return {
    status: row.status || null,
    isMoved: row.is_moved === true || row.is_moved === 'true'
  };
}

module.exports = {
  misRequest,
  normalizePhone,
  formatMobile,
  getPatientsByPhone,
  getPatientsByIds,
  createPatient,
  addPatientCategory,
  confirmAppointment,
  cancelAppointment,
  checkAppointmentStatus,
  MIS_API_KEY,
  MIS_BASE_URL
};
