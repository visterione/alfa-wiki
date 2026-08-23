/**
 * Что уходит в принтер — ровно те байты, что пришли с сервера.
 *
 * Тест написан по следам поломки, на которую ушёл вечер. В отправку передавали
 * `chunk.toString('base64')` с указанием кодировки, и в Node это работало: там
 * subarray отдаёт Buffer. На устройстве subarray отдаёт обычный Uint8Array, у
 * которого toString аргумент игнорирует и возвращает десятичные значения через
 * запятую — «0,0,0,…». Библиотека разбирала эту строку как base64, выбрасывала
 * запятые, и принтер получал шум. Молча: сокет открывался, байты «уходили»,
 * приложение рапортовало об успехе, лента не двигалась.
 *
 * Поэтому проверяется не «функция не упала», а побайтовое совпадение принятого
 * с исходным заданием.
 */
// Имена с префиксом mock — требование jest: только их разрешено трогать из
// фабрики мока. Buffer здесь глобальный, свой импорт фабрике недоступен.
const mockWritten = [];

jest.mock('react-native-tcp-socket', () => ({
  createConnection: (options, onConnect) => {
    // Поведение библиотеки воспроизводим по её же исходнику: строку она разбирает
    // с указанной кодировкой, байты берёт как есть.
    const socket = {
      write: (data, encoding, cb) => {
        mockWritten.push(
          typeof data === 'string' ? Buffer.from(data, encoding) : Buffer.from(data),
        );
        cb?.();
      },
      on: () => {},
      end: () => {},
      destroy: () => {},
    };
    setImmediate(onConnect);
    return socket;
  },
}));

const {sendPrintJob, parseStatus} = require('../src/services/ptouchPrint');

describe('отправка задания в P-touch', () => {
  beforeEach(() => { mockWritten.length = 0; });

  it('принтер получает ровно те байты, что пришли с сервера', async () => {
    // Кусок настоящего задания: преамбула, растровый режим, пустая строка и
    // печать с подачей. Важны крайние значения — нули и байты со старшим битом.
    const job = Buffer.concat([
      Buffer.alloc(100, 0x00),
      Buffer.from([0x1b, 0x40, 0x1b, 0x69, 0x61, 0x01]),
      Buffer.from([0x5a, 0x5a, 0x5a]),
      Buffer.from([0x47, 0x02, 0x00, 0xff, 0x80]),
      Buffer.from([0x1a]),
    ]);

    const result = await sendPrintJob(job.toString('base64'), {host: '10.0.0.1'});

    const received = Buffer.concat(mockWritten);
    expect(received.length).toBe(job.length);
    expect(received.toString('hex')).toBe(job.toString('hex'));
    expect(result.problems).toEqual([]);
  }, 20000);

  it('задание длиннее одного куска склеивается без потерь и перестановок', async () => {
    // 20 КБ — это три куска по 8192: проверяем и границы, и порядок.
    const job = Buffer.alloc(20000);
    for (let i = 0; i < job.length; i += 1) job[i] = i % 256;

    await sendPrintJob(job.toString('base64'), {host: '10.0.0.1'});

    expect(mockWritten.length).toBeGreaterThan(1);
    expect(Buffer.concat(mockWritten).toString('hex')).toBe(job.toString('hex'));
  }, 20000);
});

describe('разбор статуса принтера', () => {
  it('читает жалобы принтера по флагам ошибок', () => {
    const status = Buffer.alloc(32);
    status[0] = 0x80;
    status[9] = 0x10; // крышка открыта
    status[10] = 24;
    status[18] = 0x02; // произошла ошибка

    const parsed = parseStatus(status);
    expect(parsed.isError).toBe(true);
    expect(parsed.mediaWidthMm).toBe(24);
    expect(parsed.problems).toEqual(['открыта крышка']);
  });

  it('чужие байты в сокете статусом не притворяются', () => {
    expect(parseStatus(Buffer.alloc(32))).toBeNull();
    expect(parseStatus(Buffer.from([0x80, 0x20]))).toBeNull();
  });
});
