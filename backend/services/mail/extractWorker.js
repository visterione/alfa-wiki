'use strict';

/**
 * Поток разбора вложений (ver. 9.11).
 *
 * Живёт ровно один файл: получает его в workerData, отдаёт текст сообщением и
 * завершается. Если разбор зависнет или выест память, extract.js завершит поток
 * снаружи — поэтому здесь нет ни тайм-аутов, ни собственных ловушек.
 */

const { parentPort, workerData } = require('worker_threads');
const { extractInProcess } = require('./extract');

// Старый pdf-parse выпускает поздние отказы на повреждённых шрифтах уже после
// того, как вернул результат. Здесь они никому не мешают: ответ отправлен, и
// поток всё равно будет завершён.
process.on('unhandledRejection', () => {});

extractInProcess(Buffer.from(workerData.buffer), workerData.mimeType, workerData.filename)
  .then((text) => parentPort.postMessage(text))
  .catch(() => parentPort.postMessage(null));
