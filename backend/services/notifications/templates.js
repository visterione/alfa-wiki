'use strict';

/**
 * Шаблоны уведомлений (ver. 7.86).
 *
 * Тексты переехали к нам из МИС вместе с самой отправкой: раз инициатор мы, то и
 * шаблон должен лежать здесь. Подстановки названы по-русски намеренно — их
 * правит администратор колл-центра, а не программист, и `{{имя}}` он наберёт
 * сам, тогда как `{{patient_first_name}}` придётся каждый раз подсматривать.
 */

const { NotifTemplate, MedCenter, sequelize } = require('../../models');

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function firstName(fullName) {
  if (!fullName) return '';
  // В МИС ФИО одной строкой: «Иванов Иван Иванович». Обращаемся по имени —
  // фамилией в уведомлении веет казёнщиной.
  const parts = String(fullName).trim().split(/\s+/);
  return parts.length > 1 ? parts[1] : parts[0];
}

function shortDoctor(fullName) {
  if (!fullName) return '';
  const [last, first, third] = String(fullName).trim().split(/\s+/);
  if (!first) return last || '';
  return `${last} ${first[0]}.${third ? third[0] + '.' : ''}`;
}

function dateWords(date) {
  if (!date) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function timeWords(date) {
  if (!date) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}`;
}

/**
 * Подставляет значения. Неизвестная подстановка остаётся как есть: пусть в
 * сообщении будет видно `{{чтототам}}`, чем молча пустое место — опечатку в
 * шаблоне так замечают сразу.
 */
function render(text, values) {
  const filled = text.replace(/\{\{\s*([а-яa-z_]+)\s*\}\}/gi, (whole, key) => {
    const value = values[key.toLowerCase()];
    return value === undefined || value === null ? whole : String(value);
  });

  // Инициалы врача заканчиваются точкой, и естественно написанный шаблон
  // «врач {{врач}}.» даёт «Петрова М.С..». Схлопываем удвоенную точку здесь, а
  // не заставляем администратора помнить об этом при правке текста. Многоточие
  // не трогаем — оно поставлено осознанно.
  return filled.replace(/(?<!\.)\.\.(?!\.)/g, '.');
}

function valuesFor(snap, extra = {}) {
  return {
    'имя': firstName(snap.patientName),
    'фио': snap.patientName || '',
    'врач': shortDoctor(snap.doctorName),
    'врач_полностью': snap.doctorName || '',
    'дата': dateWords(snap.timeStart),
    'время': timeWords(snap.timeStart),
    'день_недели': snap.timeStart ? WEEKDAYS[snap.timeStart.getDay()] : '',
    'клиника': extra.clinicName || '',
    'адрес': extra.clinicAddress || '',
    'телефон_клиники': extra.clinicPhone || '',
    'старая_дата': extra.previousAt ? dateWords(extra.previousAt) : '',
    'старое_время': extra.previousAt ? timeWords(extra.previousAt) : ''
  };
}

/**
 * Данные клиники. Название берём прямо из визита — МИС отдаёт его готовой
 * строкой, и сопоставлять справочники ради подстановки незачем. Адрес и телефон
 * есть только у нас, поэтому их ищем по имени; не нашли — подстановки останутся
 * пустыми, но уведомление всё равно уйдёт.
 */
async function clinicInfo(snap) {
  const clinicName = snap.clinicName || '';
  if (!clinicName) return {};

  const mc = await MedCenter.findOne({
    where: sequelize.where(
      sequelize.fn('lower', sequelize.col('name')),
      clinicName.trim().toLowerCase()
    )
  });
  if (!mc) return { clinicName };

  const phones = Array.isArray(mc.phones) ? mc.phones : [];
  return {
    clinicName,
    clinicAddress: mc.address || '',
    clinicPhone: phones.length ? (phones[0].value || '') : '',
    medCenterId: mc.id
  };
}

/**
 * Готовит тексты к отправке по событию.
 *
 * @returns {Promise<Array<{text, withConfirm, plannedAt?, dedupKey?}>>}
 *   Обычно одна строка. У записи их может быть несколько: само уведомление и
 *   напоминания, у каждого свой момент отправки.
 */
async function build(event, snap, found = {}) {
  const info = await clinicInfo(snap);
  const values = valuesFor(snap, { ...info, previousAt: found.previousAt });

  const all = await NotifTemplate.findAll({ where: { isActive: true } });
  const forEvent = (name) => all.filter(t =>
    t.event === name && (!t.medCenterId || t.medCenterId === info.medCenterId));

  const out = [];

  for (const template of forEvent(event)) {
    out.push({
      text: render(template.text, values),
      withConfirm: template.withConfirm,
      template
    });
  }

  // Отзыв назначается на «после визита», а не «до»: интервал отсчитывается от
  // момента завершения приёма.
  if (event === 'review') {
    const done = found.completedAt || new Date();
    return out.map(({ template, ...item }) => {
      const after = (template && template.afterMinutes) || 180;
      const plannedAt = new Date(done.getTime() + after * 60000);

      // «Раз в день» — одна просьба на человека за сутки, привязанная к
      // последнему визиту. Ключ без визита в составе, поэтому второй приём в тот
      // же день не заводит вторую строку, а двигает первую.
      const daily = template && template.frequency === 'daily';
      const day = done.toISOString().slice(0, 10);

      return {
        ...item,
        plannedAt,
        moveIfExists: daily,
        dedupKey: daily
          ? `p${snap.patientId || 'none'}:review:${day}`
          : `${snap.apptId}:review:${day}`
      };
    });
  }

  // Запись и перенос дополнительно ставят напоминания: время визита известно,
  // и ждать отдельного события неоткуда — в МИС его попросту не будет.
  if (event === 'created' || event === 'moved') {
    for (const template of forEvent('reminder')) {
      if (!template.beforeMinutes || !snap.timeStart) continue;

      const plannedAt = new Date(snap.timeStart.getTime() - template.beforeMinutes * 60000);
      // Записались за час до приёма — напоминание за сутки уже неактуально.
      if (plannedAt <= new Date()) continue;

      out.push({
        text: render(template.text, values),
        withConfirm: template.withConfirm,
        plannedAt,
        dedupKey: `${snap.apptId}:reminder:${template.beforeMinutes}:${snap.timeStart.toISOString()}`
      });
    }
  }

  return out.map(({ template, ...item }) => item);
}

module.exports = { build, render, valuesFor, firstName, shortDoctor };
