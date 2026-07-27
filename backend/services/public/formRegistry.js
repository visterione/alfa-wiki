'use strict';

/**
 * Реестр форм публичного API.
 *
 * Здесь только описание формы: поля, проверки и шаблон сообщения (файл в forms/).
 * Куда доставлять — не знает и знать не должен: маршрут задаётся тем, в какие чаты
 * добавлен бот, см. services/public/subscriptionService.js.
 *
 * Чтобы добавить форму:
 *   1. создать forms/<имя>.js и добавить его в FORMS ниже;
 *   2. в админке отметить форму нужному боту («Боты» → бот → Формы);
 *   3. в админке выдать право forms:<имя> нужному ключу («Интеграции»).
 * Ключ разработчику при этом не меняется, .env трогать не нужно.
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
 * Формы со всеми их описаниями — для админки и команды /forms.
 * @returns {Array<{ formType: string, title: string }>}
 */
function listForms() {
  return FORMS.map(f => ({ formType: f.formType, title: f.title }));
}

/** @returns {string[]} Все известные типы форм */
function listFormTypes() {
  return [...byType.keys()];
}

/** Право доступа, которое должно быть у клиента API для этой формы */
function scopeFor(formType) {
  return `forms:${formType}`;
}

module.exports = { getForm, listForms, listFormTypes, scopeFor };
