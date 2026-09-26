'use strict';

/**
 * Площадки, с которыми работает Альфа Парсер (ver. 8.80).
 *
 * reviewPlatform — имя в справочнике review_platforms. Оно то же, под которым
 * отзывы приезжали из GetLoyalty: иначе карточки одной площадки разъехались бы
 * по двум строкам фильтра, а сопоставление с архивом искало бы не там. Отсюда
 * «DocDoc» у СберЗдоровья — так площадку называл GetLoyalty.
 *
 * canReply — подтверждено разведкой кабинетов в сентябре 2026. У ДокТу ответ
 * платный и у сети отключён, поэтому только чтение. Google заказчик решил не
 * подключать вовсе: отзывов там единицы.
 */

const PLATFORMS = {
  prodoctorov: { key: 'prodoctorov', label: 'ПроДокторов',  reviewPlatform: 'ПроДокторов',  canReply: true },
  // Пароля у учётки сети нет: в Яндекс ID входят ссылкой из письма (ver. 8.81)
  yandex:      { key: 'yandex',      label: 'Яндекс',       reviewPlatform: 'Яндекс Карты', canReply: true, passwordless: true },
  '2gis':      { key: '2gis',        label: '2ГИС',         reviewPlatform: '2ГИС',         canReply: true },
  napopravku:  { key: 'napopravku',  label: 'НаПоправку',   reviewPlatform: 'НаПоправку',   canReply: true },
  sberhealth:  { key: 'sberhealth',  label: 'СберЗдоровье', reviewPlatform: 'DocDoc',       canReply: true },
  doctu:       { key: 'doctu',       label: 'ДокТу',        reviewPlatform: 'Докту',        canReply: false },
};

// Жалоба на отзыв (ver. 8.85). Причины — ровно те, что предлагает кабинет
// площадки (подсмотрены в его скриптах в сентябре 2026). Отдельным полем
// причину принимает только 2ГИС и только «не наш клиент»; остальные
// площадки получают причину первой фразой текста — так делает и сам кабинет
// ПроДокторов. Файлов не принимает ни одна из площадок.
//
// НаПоправку и СберЗдоровье кнопки жалобы не имеют вовсе — ни в кабинете,
// ни на странице отзыва (проверено вместе с заказчиком). У ДокТу жалоба
// бесплатная, в отличие от ответа.
const COMPLAINTS = {
  prodoctorov: {
    reasons: [
      { id: 'untrue', label: 'Пациент написал неправду' },
      { id: 'not_patient', label: 'Это не наш пациент' },
      { id: 'other', label: 'Другое' },
    ],
    note: 'ПроДокторов запросит у пациента подтверждающие документы. Пациент не узнает ни причины, ни комментария.',
  },
  yandex: {
    reasons: [],
    note: 'Яндекс принимает жалобу одним текстом — опишите, какое правило нарушено.',
  },
  '2gis': {
    reasons: [
      { id: 'not_client', label: 'Такого клиента у нас не было' },
      { id: 'stop_words', label: 'В отзыве оскорбления или мат' },
      { id: 'others_opinion', label: 'Отзыв написан с чужих слов' },
      { id: 'ex_staff', label: 'Отзыв бывшего работника' },
      { id: 'no_buy', label: 'Клиент сам отказался от услуги' },
      { id: 'other', label: 'Нарушены другие правила' },
    ],
    note: 'Для «такого клиента не было» 2ГИС советует сначала попросить в официальном ответе дату визита: у автора 4 дня, чтобы её назвать.',
  },
  doctu: {
    reasons: [
      { id: 'abuse', label: 'Оскорбления или нецензурная лексика' },
      { id: 'wrong_target', label: 'Отзыв о другом враче или клинике' },
      { id: 'not_practicing', label: 'Врач не ведёт приём' },
      { id: 'not_working_here', label: 'Врач не работает в клинике' },
      { id: 'rating_mismatch', label: 'Рейтинг не соответствует содержанию' },
      { id: 'ads', label: 'Реклама или ссылки на сторонние сайты' },
      { id: 'other', label: 'Другое' },
    ],
    note: 'Пока жалоба в работе у ДокТу, вторую на тот же отзыв он не примет.',
  },
};

function complaintConfig(platformKey) {
  return COMPLAINTS[platformKey] || null;
}

// Отзыв может прийти из «соседнего» каталога той же площадки: в ленте 2ГИС
// лежат и отзывы Флямпа. GetLoyalty держал их отдельной площадкой — держим и мы.
const SUB_PLATFORMS = {
  flamp: 'Фламп',
};

function get(key) {
  return PLATFORMS[key] || null;
}

function list() {
  return Object.values(PLATFORMS);
}

function reviewPlatformName(platformKey, subPlatform) {
  if (subPlatform && SUB_PLATFORMS[subPlatform]) return SUB_PLATFORMS[subPlatform];
  return PLATFORMS[platformKey]?.reviewPlatform || null;
}

/** Все имена справочника, под которыми могут лежать отзывы этой площадки. */
function reviewPlatformNames(platformKey) {
  const base = PLATFORMS[platformKey]?.reviewPlatform;
  if (!base) return [];
  return platformKey === '2gis' ? [base, ...Object.values(SUB_PLATFORMS)] : [base];
}

module.exports = { PLATFORMS, get, list, reviewPlatformName, reviewPlatformNames, complaintConfig };
