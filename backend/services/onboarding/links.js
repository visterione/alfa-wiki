'use strict';

/**
 * Публичные адреса модуля и материалы для рассылки.
 *
 * Ссылка на анкету одна и постоянная: её отправляют сразу нескольким врачам,
 * вешают в вакансию и печатают QR для собеседования. Поэтому она не хранится
 * нигде в базе — это просто адрес, и собирается он здесь.
 *
 * Базовый адрес берём так же, как публичные карточки оборудования
 * (services/warehouse/qr.js): боевой домен по умолчанию, PUBLIC_BASE_URL —
 * если портал живёт на другом. FRONTEND_URL сюда не годится: в dev-конфиге там
 * localhost:9000, и напечатанный с него QR никуда не приведёт.
 */

const QRCode = require('qrcode');

const DEFAULT_BASE = 'https://wiki.medcentralfa.ru';

function publicBase() {
  return (process.env.PUBLIC_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

/** Постоянная публичная ссылка на анкету. */
function anketaUrl() {
  return `${publicBase()}/anketa`;
}

/**
 * Материалы для рассылки: ссылка и QR в двух видах.
 *
 * PNG — вставить в письмо или в объявление, SVG — напечатать: на бумаге растр
 * с экранными 512 px выглядит мылом, а QR на собеседовании именно печатают.
 * Уровень коррекции Q — как у складских этикеток: распечатку складывают вчетверо
 * и носят в папке.
 */
async function anketaMaterials() {
  const url = anketaUrl();
  const [qrPng, qrSvg] = await Promise.all([
    QRCode.toDataURL(url, { errorCorrectionLevel: 'Q', margin: 1, width: 512, type: 'image/png' }),
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'Q', margin: 1, width: 512 })
  ]);

  return {
    url,
    qrPng,
    qrSvg,
    // Признак того, что адрес не настроен и материалы печатать рано.
    baseConfigured: Boolean(process.env.PUBLIC_BASE_URL)
  };
}

module.exports = { publicBase, anketaUrl, anketaMaterials, DEFAULT_BASE };
