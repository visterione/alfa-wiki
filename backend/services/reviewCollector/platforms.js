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
  sberhealth:  { key: 'sberhealth',  label: 'СберЗдоровье', reviewPlatform: 'DocDoc',       canReply: true,  collected: false },
  doctu:       { key: 'doctu',       label: 'ДокТу',        reviewPlatform: 'Докту',        canReply: false, collected: false },
};

// collected: false — адаптера в парсере ещё нет (вход с капчей ждёт
// удалённого входа). Такую площадку нельзя отключить в GetLoyalty: её
// отзывы перестали бы приходить совсем. Флаг снимается, когда адаптер готов.

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
/** Имена справочника, которые уже собирает парсер — их можно снимать с GetLoyalty. */
function collectedPlatformNames() {
  const names = list().filter(p => p.collected !== false).map(p => p.reviewPlatform);
  return [...new Set([...names, ...Object.values(SUB_PLATFORMS)])];
}

function reviewPlatformNames(platformKey) {
  const base = PLATFORMS[platformKey]?.reviewPlatform;
  if (!base) return [];
  return platformKey === '2gis' ? [base, ...Object.values(SUB_PLATFORMS)] : [base];
}

module.exports = { PLATFORMS, get, list, reviewPlatformName, reviewPlatformNames, collectedPlatformNames };
