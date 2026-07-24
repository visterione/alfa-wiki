'use strict';

/**
 * Реестр форм публичного API.
 *
 * Каждая форма: описание полей + шаблон сообщения (файл в forms/) и цель доставки —
 * бот и чат, куда падает заявка. Цель берётся из .env, чтобы боевой и тестовый
 * контуры отличались настройками, а не кодом.
 *
 * Переменные окружения:
 *   PUBLIC_FORMS_BOT_TOKEN                     — токен бота (общий для всех форм)
 *   PUBLIC_FORM_PATIENT_REGISTRATION_CHAT_ID   — чат конкретной формы
 *   PUBLIC_FORM_<FORM_TYPE>_BOT_TOKEN          — необязательное переопределение бота
 *
 * Чтобы добавить форму: создать forms/<имя>.js и добавить его в FORMS ниже.
 */

const patientRegistration = require('./forms/patientRegistration');
const taxDeductionCertificate = require('./forms/taxDeductionCertificate');

const FORMS = [
  patientRegistration,
  taxDeductionCertificate
];

const byType = new Map(FORMS.map(f => [f.formType, f]));

/**
 * @param {string} formType
 * @returns {Object|null} Модуль формы или null, если такой формы нет
 */
function getForm(formType) {
  return byType.get(formType) || null;
}

/**
 * Куда доставлять заявки этой формы.
 * @param {string} formType
 * @returns {{ botToken: string|undefined, chatId: string|undefined }}
 */
function getDeliveryTarget(formType) {
  const envKey = formType.toUpperCase().replace(/-/g, '_');
  return {
    botToken: process.env[`PUBLIC_FORM_${envKey}_BOT_TOKEN`] || process.env.PUBLIC_FORMS_BOT_TOKEN,
    chatId:   process.env[`PUBLIC_FORM_${envKey}_CHAT_ID`]
  };
}

/** @returns {string[]} Все известные типы форм */
function listFormTypes() {
  return [...byType.keys()];
}

/** Право доступа, которое должно быть у клиента API для этой формы */
function scopeFor(formType) {
  return `forms:${formType}`;
}

module.exports = { getForm, getDeliveryTarget, listFormTypes, scopeFor };
