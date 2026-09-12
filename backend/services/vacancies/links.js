'use strict';

/**
 * Публичные адреса раздела и материалы для печати (ver. 8.20).
 *
 * В первом поколении ссылка на анкету была одна на всю сеть. Теперь их столько,
 * сколько медцентров: человек приходит по QR своего филиала и видит только его
 * вакансии. Адрес строится из MedCenter.code — латинского идентификатора,
 * который не меняется при переименовании клиники; название филиала в адрес не
 * годится, иначе напечатанная табличка перестала бы работать после ребрендинга.
 *
 * Базовый адрес берём так же, как публичные карточки оборудования
 * (services/warehouse/qr.js): боевой домен по умолчанию, PUBLIC_BASE_URL — если
 * портал живёт на другом. FRONTEND_URL сюда не годится: в dev-конфиге там
 * localhost:9000, и напечатанный с него QR никуда не приведёт.
 */

const QRCode = require('qrcode');

const DEFAULT_BASE = 'https://wiki.medcentralfa.ru';

function publicBase() {
  return (process.env.PUBLIC_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

/** Список вакансий филиала — то, что открывается по QR. */
function branchUrl(code) {
  return `${publicBase()}/vacancy/${encodeURIComponent(code)}`;
}

/** Персональная ссылка кандидата на его заявку. */
function applicationUrl(token) {
  return `${publicBase()}/vacancy/a/${token}`;
}

/**
 * Материалы для филиала: ссылка и QR в двух видах.
 *
 * PNG — вставить в письмо или в объявление, SVG — напечатать: на бумаге растр
 * с экранными 512 px выглядит мылом, а этот QR именно печатают и вешают в
 * регистратуре. Уровень коррекции Q — как у складских этикеток: распечатку
 * складывают вчетверо и носят в папке.
 */
async function branchMaterials(code) {
  const url = branchUrl(code);
  const [qrPng, qrSvg] = await Promise.all([
    QRCode.toDataURL(url, { errorCorrectionLevel: 'Q', margin: 1, width: 512, type: 'image/png' }),
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'Q', margin: 1, width: 512 })
  ]);

  return {
    url,
    qrPng,
    qrSvg,
    // Признак того, что адрес не настроен и печатать материалы рано.
    baseConfigured: Boolean(process.env.PUBLIC_BASE_URL)
  };
}

module.exports = { publicBase, branchUrl, applicationUrl, branchMaterials, DEFAULT_BASE };
