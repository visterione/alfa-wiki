/**
 * Автозакрытие обращений открытой линии после тишины (ver. 9.23).
 *
 * Раз в десять минут: срок задаётся в часах, и точнее он не нужен — закрыть
 * разговор через восемь часов или через восемь часов и десять минут, пациенту
 * всё равно. Чаще — лишние запросы, реже — обращения висят заметно дольше
 * обещанного в настройке.
 *
 * Сокет нужен, чтобы закрытое пропало у операторов с экрана сразу, а не со
 * следующим опросом. Поэтому запуск — функцией из server.js, а не простым
 * require, как у соседних задач.
 */

const cron = require('node-cron');
const openLine = require('../services/openLine');

let running = false;

function start(io) {
  cron.schedule('*/10 * * * *', async () => {
    // Проход может затянуться (сотни обращений после долгого простоя) —
    // второй поверх первого закрывал бы те же строки дважды.
    if (running) return;
    running = true;
    try {
      let total = 0;
      for (;;) {
        const { closed, more } = await openLine.autoCloseIdle(io);
        total += closed;
        if (!more || !closed) break;
      }
      if (total) console.log(`[open-line] автозакрытие после тишины: ${total}`);
    } catch (err) {
      console.error('[open-line] автозакрытие:', err.message);
    } finally {
      running = false;
    }
  }, { scheduled: true, timezone: 'Europe/Moscow' });

  console.log('✅ Cron автозакрытия обращений открытой линии (каждые 10 минут)');
}

module.exports = { start };
