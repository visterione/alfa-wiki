'use strict';

/**
 * Обработчики кнопок под сообщениями бота.
 *
 * Кнопки описывает сама форма (services/public/forms/*.js → buildActions), а что
 * происходит по нажатию — знает этот файл. Разделение нужно, чтобы форма не тянула
 * за собой МИС и её ошибки: форма только объявляет «здесь должна быть кнопка
 * «Создать пациента»», а как её выполнить — дело сервера.
 *
 * Формат кнопки описан в migrations/ver. 6.51 message-actions.sql.
 *
 * kind: 'link' обработчика не имеет — такая кнопка выполняется на клиенте
 * (переход на страницу), сервер только отмечает, что её нажали.
 */

const { Submission } = require('../models');
const misClient = require('./misClient');

/**
 * @typedef {Object} ActionContext
 * @property {Object} action Кнопка из message.actions
 * @property {Object} user   Кто нажал (req.user)
 */

const HANDLERS = {
  /**
   * Заводит пациента в МИС по анкете с сайта.
   * @param {ActionContext} ctx
   * @returns {Promise<string>} строка результата — её увидят все в чате
   */
  'mis-create-patient': async ({ action }) => {
    const p = await loadPayload(action.submissionId);

    // Когда анкету заполнял представитель, основной блок — его, а пациент это
    // ребёнок. Контакты в анкете одни на двоих, поэтому берём их как есть.
    const forChild = p.applicantType && p.applicantType !== 'self';

    const patient = await misClient.createPatient({
      lastName:   forChild ? p.childLastName   : p.lastName,
      firstName:  forChild ? p.childFirstName  : p.firstName,
      middleName: forChild ? p.childMiddleName : p.middleName,
      birthDate:  forChild ? p.childBirthDate  : p.birthDate,
      gender:     forChild ? p.childGender     : p.gender,
      phone:      p.phone,
      email:      p.email
    });

    // Номер карты — то, по чему пациента ищут в МИС; id полезен только техподдержке
    return patient.number
      ? `карта №${patient.number}`
      : `ID ${patient.patient_id}`;
  }
};

/**
 * Достаёт payload заявки, на которую ссылается кнопка.
 * @param {string} submissionId
 * @returns {Promise<Object>}
 */
async function loadPayload(submissionId) {
  if (!submissionId) throw new Error('кнопка не привязана к заявке');

  const submission = await Submission.findByPk(submissionId);
  if (!submission) throw new Error('заявка не найдена — возможно, её удалили');

  return submission.payload || {};
}

/**
 * Выполняет кнопку.
 *
 * @param {Object} action Кнопка из message.actions
 * @param {Object} user   Кто нажал
 * @returns {Promise<string|null>} строка результата для показа в чате
 * @throws {Error} с текстом, который можно показать сотруднику
 */
async function runAction(action, user) {
  // Переход на страницу клиент делает сам — серверу остаётся только отметка
  if (action.kind === 'link') return null;

  const handler = HANDLERS[action.id];
  if (!handler) throw new Error(`неизвестное действие: ${action.id}`);

  return handler({ action, user });
}

module.exports = { runAction, HANDLERS };
