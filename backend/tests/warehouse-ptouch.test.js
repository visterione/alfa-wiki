const test = require('node:test');
const assert = require('node:assert/strict');

const { assetLabelSvg, roomDoorCardSvg, labelPng } = require('../services/warehouse/qr');
const {
  PRINT_PINS,
  RASTER_BYTES,
  packBits,
  labelRasterLines,
  buildPrintJob,
} = require('../services/warehouse/ptouchRaster');

const asset = {
  id: 1,
  inventoryNumber: 'МЦ04-000123',
  name: 'Аппарат ультразвуковой диагностики Mindray DC-70',
  publicToken: 'a'.repeat(24),
};

const room = {
  id: 7,
  number: '312а/2',
  name: 'Кабинет ультразвуковой диагностики',
  department: { name: 'Диагностика' },
};

test('сжатие повторяет пример из документации Brother', () => {
  const line = Buffer.from([
    ...Array(20).fill(0x00),
    0x22, 0x22, 0x23, 0xba, 0xbf, 0xa2, 0x22, 0x2b,
  ]);
  assert.deepEqual(
    [...packBits(line)],
    [0xed, 0x00, 0xff, 0x22, 0x05, 0x23, 0xba, 0xbf, 0xa2, 0x22, 0x2b],
  );
});

test('строка, которая от сжатия только распухла, уходит литералом', () => {
  // Строка без единого повтора: PackBits на ней даёт 17 байт вместо 16, и
  // документация велит слать её целиком. На QR-коде такие строки — обычное дело.
  const line = Buffer.from(Array.from({ length: RASTER_BYTES }, (_, i) => i * 17));
  const packed = packBits(line);
  assert.equal(packed.length, RASTER_BYTES + 1);
  assert.equal(packed[0], RASTER_BYTES - 1);
  assert.deepEqual([...packed.subarray(1)], [...line]);
});

test('этикетка 80x24 раскладывается в 567 строк по 16 байт', async () => {
  const png = await labelPng(await assetLabelSvg(asset), '80x24');
  const lines = await labelRasterLines(png);

  // 80 мм при 180 dpi — 567 растровых строк; каждая накрывает 128 точек головки.
  assert.equal(lines.length, 567);
  assert.ok(lines.every(line => line.length === RASTER_BYTES));
  assert.equal(RASTER_BYTES * 8, PRINT_PINS);
  // Пустая этикетка была бы ошибкой вёрстки: где-то должен быть QR и номер.
  assert.ok(lines.some(line => line.some(byte => byte !== 0)));
});

test('поворот на 270° даёт ту же этикетку вверх ногами', async () => {
  const png = await labelPng(await roomDoorCardSvg(room), '80x24');
  const straight = await labelRasterLines(png, { rotate: 90 });
  const upside = await labelRasterLines(png, { rotate: 270 });

  assert.equal(straight.length, upside.length);
  // Перевёрнутая этикетка — та же самая, прочитанная с конца и с зеркалом по
  // ширине ленты. Если это перестанет выполняться, значит вырезается не средняя
  // полоса ленты, и печать съедет к краю.
  const flipped = Buffer.from(upside[upside.length - 1]);
  const reversed = Buffer.alloc(RASTER_BYTES);
  for (let pin = 0; pin < PRINT_PINS; pin += 1) {
    if (!(flipped[pin >> 3] & (0x80 >> (pin & 7)))) continue;
    const mirroredPin = PRINT_PINS - 1 - pin;
    reversed[mirroredPin >> 3] |= 0x80 >> (mirroredPin & 7);
  }
  assert.deepEqual([...reversed], [...straight[0]]);
});

test('зеркало переставляет точки, а не роняет их', async () => {
  const png = await labelPng(await assetLabelSvg(asset), '80x24');
  const plain = await labelRasterLines(png, { mirror: false });
  const mirrored = await labelRasterLines(png, { mirror: true });

  const dots = lines => lines.reduce(
    (sum, line) => sum + line.reduce((acc, byte) => acc + byte.toString(2).replace(/0/g, '').length, 0),
    0,
  );
  assert.equal(dots(plain), dots(mirrored));
  // Сравнивать первую строку нельзя: это край рамки, он симметричен и в зеркале
  // совпадает сам с собой. Расходиться должна этикетка целиком.
  assert.notDeepEqual(plain.map(line => [...line]), mirrored.map(line => [...line]));
});

test('задание начинается сбросом и заканчивается печатью с подачей', async () => {
  const png = await labelPng(await assetLabelSvg(asset), '80x24');
  const lines = await labelRasterLines(png);
  const job = buildPrintJob([lines, lines]);

  assert.deepEqual([...job.subarray(0, 100)], Array(100).fill(0));
  assert.deepEqual([...job.subarray(100, 102)], [0x1b, 0x40]);
  // Растровый режим и сведения о ленте — перед каждой страницей, а не один раз
  // на задание: принтер теряет часть настроек между этикетками.
  assert.equal(job.toString('latin1').split('\x1bia\x01').length - 1, 2);
  // 1Bh 69h 7Ah, флаг 84h, тип ленты 00h, ширина 24 мм
  assert.ok(job.includes(Buffer.from([0x1b, 0x69, 0x7a, 0x84, 0x00, 24, 0x00])));
  // Автообрез и «не сцеплять этикетки»
  assert.ok(job.includes(Buffer.from([0x1b, 0x69, 0x4d, 0x40])));
  assert.ok(job.includes(Buffer.from([0x1b, 0x69, 0x4b, 0x08])));
  // Поле подачи — 2 мм, это ровно 14 точек: меньше принтер не отдаёт.
  assert.ok(job.includes(Buffer.from([0x1b, 0x69, 0x64, 14, 0x00])));

  assert.equal(job[job.length - 1], 0x1a);
  // Промежуточная страница закрыта обычной печатью. Искать 0Ch по всему заданию
  // бесполезно — тот же байт встречается внутри растра, поэтому смотрим ровно в
  // стык страниц: перед вторым переключением в растровый режим.
  const secondPage = job.indexOf(Buffer.from([0x1b, 0x69, 0x61, 0x01]),
    job.indexOf(Buffer.from([0x1b, 0x69, 0x61, 0x01])) + 1);
  assert.equal(job[secondPage - 1], 0x0c);
});

test('число растровых строк в задании совпадает с длиной этикетки', async () => {
  const png = await labelPng(await assetLabelSvg(asset), '80x24');
  const lines = await labelRasterLines(png);
  const job = buildPrintJob([lines]);
  const at = job.indexOf(Buffer.from([0x1b, 0x69, 0x7a]));

  assert.equal(job.readUInt32LE(at + 7), lines.length);
  assert.equal(job[at + 11], 0x00); // первая страница задания
});
