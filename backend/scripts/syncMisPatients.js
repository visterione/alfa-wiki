'use strict';

/**
 * Наполнение справочника карточек МИС (ver. 7.81).
 *
 * Зачем он вообще нужен: публичное API ищет пациента только по точной фамилии,
 * а в подсказке порционного требования надо набрать три буквы и увидеть
 * варианты. Своя копия ФИО закрывает это одним индексом по префиксу.
 *
 * Запуск из каталога backend:
 *   node scripts/syncMisPatients.js --full            все карточки, помесячно
 *   node scripts/syncMisPatients.js --full --from 2015
 *   node scripts/syncMisPatients.js --days 3          догрузить изменения
 *
 * Полная выгрузка идёт десятки минут: месяц — около шести тысяч карточек и
 * восьми мегабайт ответа. Прерывать не страшно, запись идёт по месяцам, и
 * повторный запуск просто перезапишет уже загруженное.
 */

require('dotenv').config();

const directory = require('../services/misPatientDirectory');
const { sequelize } = require('../models');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// Пустые месяцы в начале истории — норма: клиника открылась не в 2005-м.
// Останавливаться на них нельзя, но и ползти с самого начала тоже незачем.
const DEFAULT_FROM_YEAR = 2008;

async function full() {
  const fromYear = Number(valueOf('--from', DEFAULT_FROM_YEAR));
  const now = new Date();
  const toYear = now.getFullYear();

  console.log(`Полная выгрузка карточек МИС: ${fromYear}–${toYear}`);
  let total = 0;
  const started = Date.now();

  for (let year = fromYear; year <= toYear; year++) {
    let yearTotal = 0;
    for (let month = 1; month <= 12; month++) {
      if (year === toYear && month > now.getMonth() + 1) break;
      let n = 0;
      try {
        n = await directory.syncCreatedMonth(year, month);
      } catch (err) {
        console.warn(`  ${String(month).padStart(2, '0')}.${year}: не удалось — ${err.message}`);
        continue;
      }
      yearTotal += n;
      total += n;
      if (n) process.stdout.write(`  ${String(month).padStart(2, '0')}.${year}: ${n}\n`);
    }
    if (yearTotal) console.log(`${year}: ${yearTotal} карточек, всего ${total}`);
  }

  const inBase = await directory.count();
  console.log(`Готово за ${Math.round((Date.now() - started) / 1000)} с. Загружено ${total}, в справочнике ${inBase}`);
}

async function incremental() {
  const days = Number(valueOf('--days', 3));
  const n = await directory.syncUpdatedSince(days);
  const inBase = await directory.count();
  console.log(`Изменения за ${days} дн.: ${n} карточек. В справочнике ${inBase}`);
}

(async () => {
  try {
    if (has('--full')) await full();
    else await incremental();
  } catch (err) {
    console.error('ОШИБКА:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
