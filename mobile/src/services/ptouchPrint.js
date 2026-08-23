/**
 * Отправка готового задания печати в Brother P-touch по вайфаю.
 *
 * Телефон здесь ничего не верстает и не растеризует: задание целиком приходит с
 * сервера (backend/services/warehouse/ptouchRaster.js), а этот модуль открывает
 * TCP на 9100 и выкладывает байты как есть. У этих принтеров сетевая печать так
 * и устроена — порт-монитор шлёт поток без обёрток.
 *
 * Почему не через официальный SDK Brother: его обёртка под React Native в
 * версии 1.0.3 не умеет ленточные P-touch на iOS — мост создаёт настройки
 * печати только для серий RJ, PJ и TD, а на «PT-E550W» отвечает «Invalid or
 * wrong Printer Model». Печать через сокет обходится вовсе без нативного
 * модуля Brother и работает на обеих платформах одинаково.
 *
 * AirPrint здесь не при чём и никогда не заработает: P-touch не анонсирует себя
 * как AirPrint-принтер, поэтому «нет устройств поблизости» — это не настройка,
 * которую забыли включить.
 */
import TcpSocket from 'react-native-tcp-socket';
// buffer тот же самый, что внутри react-native-tcp-socket: в package.json он
// прибит к одной версии с ним намеренно. Две копии дали бы два разных класса
// Buffer, и байты из сокета перестали бы быть теми же байтами, что мы шлём.
import {Buffer} from 'buffer';

export const PRINTER_PORT = 9100;

// Режем поток на куски: у принтера буфер на страницу, и он тормозит приём, пока
// печатает. Сокет с обратным давлением справится и сам, но кусками видно, куда
// доехала отправка, — на пачке в полсотни этикеток это единственный признак
// жизни, который можно показать человеку.
const CHUNK_BYTES = 8192;

// Сколько держать соединение после того, как всё отправлено.
//
// Было 2.5 секунды — и печати не происходило вовсе. Принтер к этому моменту ещё
// не успевал разложить страницу, а закрытие сокета выбрасывало задание. Восемь
// секунд с запасом покрывают самую длинную этикетку.
const SETTLE_MS = 8000;

/**
 * Разбор 32-байтного статуса.
 *
 * Разбор есть, а рассчитывать на него нельзя. Спросить статус у PT-E550W нечем —
 * команду «ESC i S» эта модель не поддерживает, — а по документации она должна
 * слать статусы сама во время печати. На живом принтере не шлёт: ни при удачной
 * печати, ни при какой. Поэтому молчание здесь считается нормой, а разбор
 * оставлен на случай, когда принтер всё-таки заговорит: тогда его жалобу видно
 * дословно, а не «что-то пошло не так».
 */
export function parseStatus(buf) {
  if (!buf || buf.length < 32 || buf[0] !== 0x80) return null;
  const error1 = buf[8];
  const error2 = buf[9];
  const problems = [];
  if (error1 & 0x01) problems.push('в принтере нет ленты');
  if (error1 & 0x04) problems.push('заклинил нож');
  if (error1 & 0x08) problems.push('садятся батареи');
  if (error1 & 0x40) problems.push('не тот блок питания');
  if (error2 & 0x01) problems.push('заправлена не та лента');
  if (error2 & 0x10) problems.push('открыта крышка');
  if (error2 & 0x20) problems.push('принтер перегрелся');

  return {
    mediaWidthMm: buf[10],
    problems,
    isError: buf[18] === 0x02 || problems.length > 0,
    isDone: buf[18] === 0x01,
  };
}

/** Проверка связи: принтер либо принимает соединение на 9100, либо нет. */
export function checkPrinter({host, port = PRINTER_PORT, timeoutMs = 6000}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      if (err) reject(err); else resolve(true);
    };

    const timer = setTimeout(
      () => finish(new Error('Принтер не ответил. Проверьте адрес и что телефон в одной сети с ним.')),
      timeoutMs,
    );
    const socket = TcpSocket.createConnection({host, port}, () => finish(null));
    socket.on('error', e => finish(new Error(`Не удалось подключиться: ${e.message}`)));
  });
}

/**
 * Отправляет задание печати и ждёт, пока принтер его переварит.
 *
 * `job` — base64 из ручки `.prn`. Именно base64, а не байты: строка приезжает
 * такой с сервера, лежит такой в состоянии экрана и в таком же виде уходит в
 * сокет — лишних перекладываний в память на пачке в несколько мегабайт лучше не
 * делать.
 */
export function sendPrintJob(job, {host, port = PRINTER_PORT, onProgress, timeoutMs = 60000}) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(job, 'base64');
    let settled = false;
    let sent = 0;
    let settleTimer = null;
    let answered = false;
    const problems = new Set();

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(settleTimer);
      // Закрываем сокет по-человечески, через FIN. Раньше здесь стоял destroy(),
      // то есть RST посреди разговора: принтер вправе выбросить всё, что успел
      // принять, и задание пропадало целиком, ничего не напечатав.
      try { socket.end(); } catch {}
      if (err) reject(err); else resolve(value);
    };

    const done = () => finish(null, {problems: [...problems], answered});

    const timer = setTimeout(
      () => finish(new Error('Принтер не ответил за отведённое время. Задание осталось в телефоне — попробуйте ещё раз.')),
      timeoutMs,
    );

    const socket = TcpSocket.createConnection({host, port}, () => {
      const writeNext = () => {
        if (settled) return;
        if (sent >= payload.length) {
          // Всё ушло. Дальше только слушаем: принтер печатает и в это время
          // может пожаловаться на ленту или крышку.
          settleTimer = setTimeout(done, SETTLE_MS);
          return;
        }
        const chunk = payload.subarray(sent, sent + CHUNK_BYTES);
        sent += chunk.length;
        onProgress?.(Math.min(1, sent / payload.length));
        // Отдаём именно байты, а не строку. Здесь стояло
        // `chunk.toString('base64')` с указанием кодировки — и это тихо ломало
        // всю печать: на устройстве subarray возвращает обычный Uint8Array, а не
        // Buffer, у которого toString аргумент игнорирует и отдаёт десятичные
        // значения через запятую («0,0,0,…»). Библиотека разбирала эту строку
        // как base64, выбрасывала запятые, и в принтер уходил шум. В Node тот же
        // код работает — там subarray отдаёт Buffer, — поэтому с компьютера
        // печаталось, а с телефона нет.
        socket.write(chunk, null, (err) => {
          if (err) return finish(new Error(`Обрыв при отправке: ${err.message}`));
          writeNext();
        });
      };
      writeNext();
    });

    socket.on('data', (chunk) => {
      // Статусы приходят пакетами по 32 байта и могут склеиться в один приём.
      for (let at = 0; at + 32 <= chunk.length; at += 32) {
        const status = parseStatus(chunk.subarray(at, at + 32));
        if (!status) continue;
        answered = true;
        if (status.problems.length) status.problems.forEach(p => problems.add(p));
        if (status.isError) {
          return finish(new Error(
            status.problems.length
              ? `Принтер остановился: ${[...problems].join(', ')}`
              : 'Принтер сообщил об ошибке печати',
          ));
        }
      }
      // Пока принтер разговаривает, задание ещё живо — отодвигаем тишину.
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(done, SETTLE_MS);
      }
    });

    socket.on('error', e => finish(new Error(`Связь с принтером оборвалась: ${e.message}`)));
    socket.on('close', () => {
      // Принтер закрывает соединение сам после задания — это нормальный конец,
      // но только если мы успели всё отправить.
      if (sent >= payload.length) done();
      else finish(new Error('Принтер закрыл соединение, не приняв задание целиком'));
    });
  });
}
