'use strict';

/**
 * Переход с GetLoyalty (ver. 8.80): что сборщик меняет в его синхронизации.
 *
 * Два механизма. Первый — сопоставление: отзыв от GetLoyalty, который парсер
 * уже завёл карточкой, не становится второй карточкой, а дописывает ей свой
 * externalId. Второй — отключение по площадкам: когда площадка отлажена у
 * парсера, её отзывы из GetLoyalty больше не берутся вовсе. Отключены все
 * площадки — GetLoyalty можно выключать целиком, не теряя ничего.
 *
 * Список отключённых общий на сеть, а не на доску: площадка переезжает к
 * парсеру сразу для всех медцентров, и держать это в девяти местах значило бы
 * однажды забыть одно.
 */

const { Op } = require('sequelize');
const { Review, Setting } = require('../../models');
const { pickCounterpart, DATE_WINDOW_DAYS } = require('./match');

const SETTING_KEY = 'reviews.getloyalty.excludedPlatforms';

async function excludedPlatforms() {
  const row = await Setting.findByPk(SETTING_KEY);
  return Array.isArray(row?.value) ? row.value : [];
}

async function setExcludedPlatforms(names) {
  const value = [...new Set((names || []).map(String).filter(Boolean))];
  await Setting.upsert({
    key: SETTING_KEY,
    value,
    description: 'Площадки, отзывы которых больше не берутся из GetLoyalty: их собирает Альфа Парсер (ver. 8.80)',
  });
  return value;
}

function shiftDate(date, days) {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Ключи парсера, которые можно вычитать из ссылки GetLoyalty. Работает только
 * для ПроДокторов: GetLoyalty даёт ссылку на отзыв в кабинете клиники
 * (…/lpu-rates/rate/7563417/?lpu=23159), а в ней родной номер. У отзывов о
 * клинике путь …/ratelpu/…, и номера у них свои, поэтому вид входит в ключ.
 */
function exactKeysFromUrl(url) {
  const m = /prodoctorov\.ru\/cabinet\/lpu-rates\/(rate|ratelpu)\/(\d+)/.exec(url || '');
  if (!m) return [];
  return [`prodoctorov:${m[1]}:${m[2]}`];
}

/**
 * Карточка парсера, которая и есть этот отзыв GetLoyalty. Кандидаты — только
 * карточки без externalId: у уже сопоставленной пара есть.
 */
async function findCollectorCounterpart({ boardId, platformId, date, text, rating, doctorName, externalUrl }) {
  const keys = exactKeysFromUrl(externalUrl);
  if (keys.length) {
    const exact = await Review.findOne({
      where: { sourceKey: { [Op.in]: keys }, boardId, externalId: null },
      paranoid: false,
    });
    if (exact) return exact;
  }

  const candidates = await Review.findAll({
    where: {
      boardId,
      platformId,
      sourceKey: { [Op.ne]: null },
      externalId: null,
      reviewDate: {
        [Op.between]: [shiftDate(date, -DATE_WINDOW_DAYS), shiftDate(date, DATE_WINDOW_DAYS)],
      },
    },
    attributes: ['id', 'reviewDate', 'reviewText', 'rating', 'doctorName', 'externalUrl', 'syncMeta'],
    paranoid: false,
  });
  return pickCounterpart({ date, text, rating, doctor: doctorName }, candidates);
}

module.exports = { excludedPlatforms, setExcludedPlatforms, findCollectorCounterpart, exactKeysFromUrl, SETTING_KEY };
