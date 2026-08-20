const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assetLabelSvg,
  assetLabelZpl,
  roomDoorCardSvg,
  roomDoorCardZpl,
  labelPng,
} = require('../services/warehouse/qr');

function assertMonochrome(svg) {
  const colors = [...svg.matchAll(/#[0-9a-f]{3,8}/gi)].map(match => {
    const color = match[0].toLowerCase();
    return color === '#000000' ? '#000' : color === '#ffffff' ? '#fff' : color;
  });
  assert.ok(colors.length > 0);
  assert.deepEqual([...new Set(colors)].sort(), ['#000', '#fff']);
}

function visibleText(svg) {
  return [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)]
    .map(match => match[1])
    .join(' ');
}

const room = {
  id: 7,
  number: '312а/2',
  name: 'Кабинет ультразвуковой диагностики',
  department: { name: 'Диагностика' },
  floor: { number: 3, building: { name: 'Главный корпус', address: 'ул. Владимирская, 93' } },
};

for (const [size, width, height] of [
  ['80x24', '80mm', '24mm'],
  ['44x25', '44mm', '25mm'],
]) {
  test(`этикетка кабинета печатается в формате ${size}`, async () => {
    const svg = await roomDoorCardSvg(room, { size });
    const dimensions = svg.match(/<svg[^>]*width="([^"]+)" height="([^"]+)"/).slice(1);

    assert.deepEqual(dimensions, [width, height]);
    assert.match(svg, /312а\/2/);
    const text = visibleText(svg);
    assert.doesNotMatch(text, /Главный корпус|3 этаж/);
    assert.ok(text.indexOf('312а/2') < text.indexOf('КАБИНЕТ'));
    // На двери остаются только номер и слово «КАБИНЕТ». Шапка и реквизиты
    // медцентра убраны: они отбирали высоту у номера, а сообщали то, что и так
    // известно всякому, кто стоит перед этой дверью.
    assert.doesNotMatch(text, /АЛЬФА ВИКИ|СКЛАД/);
    assert.doesNotMatch(text, /Медицинский центр|Владимирская/);
    assert.doesNotMatch(svg, /<line/);
    assert.doesNotMatch(svg, /авторизац|потребуется вход|Оборудование кабинета/i);
    assertMonochrome(svg);
  });
}

const asset = {
  inventoryNumber: 'МЦ-2026-0001',
  publicToken: 'test-token',
  name: 'Аппарат ультразвуковой диагностический стационарный экспертного класса',
  model: 'Model 1',
  manufacturer: 'Производитель 1',
  serialNumber: 'SN-1',
  room: {
    number: '312',
    name: 'Кабинет ультразвуковой диагностики',
    department: { name: 'Диагностика' },
  },
  nextMaintenanceDate: '2026-12-01',
};

test('альбомная этикетка кабинета 80x24 используется по умолчанию', async () => {
  const svg = await roomDoorCardSvg(room);
  assert.match(svg, /width="80mm" height="24mm"/);
  const text = visibleText(svg);
  assert.doesNotMatch(text, /Главный корпус|3 этаж/);
  assert.ok(text.indexOf('312а/2') < text.indexOf('КАБИНЕТ'));
  assert.match(svg, /<svg x="1\.4" y="4\.65" width="14\.7" height="14\.7"/);
});

test('содержимое держится в печатаемой полосе ленты', async () => {
  // Ради этого всё и затевалось: на ленте 24 мм запечатывается около 17-18 мм
  // посередине, и всё, что выходит за полосу, физически не печатается — на
  // этикетке пропадали шапка сверху и наименование снизу. Сама этикетка при
  // этом остаётся во всю ширину ленты, внутрь уходит только содержимое.
  for (const [size, tape, band] of [['80x24', 24, 17.5]]) {
    const top = (tape - band) / 2;
    const bottom = tape - top;
    for (const svg of [
      await assetLabelSvg(asset, { size }),
      await roomDoorCardSvg(room, { size }),
    ]) {
      assert.match(svg, new RegExp(`height="${tape}mm"`));

      // Базовые линии текста: вся строка должна лежать внутри полосы, поэтому
      // сверху проверяем с поправкой на кегль — базовая линия ниже верха букв.
      for (const [, fontSize, y] of svg.matchAll(/font-size="([\d.]+)"[^>]*\by="([\d.]+)"|\by="([\d.]+)"[^>]*font-size="([\d.]+)"/g)) {
        if (y === undefined) continue;
        assert.ok(Number(y) <= bottom, `${size}: строка на ${y} мм ниже полосы (${bottom})`);
        assert.ok(Number(y) - Number(fontSize) >= top - 0.5, `${size}: строка на ${y} мм выше полосы (${top})`);
      }

      // Код: квадрат целиком внутри полосы.
      const [, qrY, qrSize] = svg.match(/<svg x="[\d.]+" y="([\d.]+)" width="([\d.]+)"/);
      assert.ok(Number(qrY) >= top, `${size}: QR начинается на ${qrY} мм, выше полосы`);
      assert.ok(Number(qrY) + Number(qrSize) <= bottom, `${size}: QR не помещается в полосу`);
    }
  }
});

for (const size of ['80x24', '44x25']) {
  test(`этикетка оборудования ${size} использует только чёрный цвет`, async () => {
    const svg = await assetLabelSvg(asset, { size });
    assertMonochrome(svg);
    const text = visibleText(svg);
    // Шапки на этикетке больше нет: первым идёт инвентарный номер, ради
    // которого её и читают.
    assert.doesNotMatch(text, /АЛЬФА ВИКИ|СКЛАД/);
    assert.match(text, /^МЦ-2026-0001/);
    assert.doesNotMatch(svg, /Каб\. 312|Медицинский центр|Владимирская|Model 1|Производитель 1|Диагностика<\/text>/);
    if (size === '80x24') {
      // Код занимает всю печатаемую полосу ленты и стоит по её центру.
      assert.match(svg, /<svg x="1\.4" y="4\.65" width="14\.7" height="14\.7"/);
    }
  });
}

test('длинное наименование печатается целиком, а не обрезком', async () => {
  // Инвентарный номер держит свой кегль, наименование подстраивается под
  // оставшуюся высоту. Обрезанное многоточием название бесполезно: по нему вещь
  // на полке не опознать, а ради этого этикетку и читают.
  const names = [
    'Стол',
    'Видеокамера IP TRASSIR TR-D3121IR1, 1080р, 2,8мм, белый',
    'Аппарат ультразвуковой диагностический стационарный экспертного класса',
    'Комплекс аппаратно-программный для ультразвуковой диагностики Mindray DC-70 Exp '
      + 'с тремя датчиками и тележкой',
  ];

  // Оба размера: у ленты и у высечки свои профили, и параметр, забытый в одном
  // из них, обнуляет там наименование целиком.
  for (const [size, bottom] of [['80x24', 20.75], ['44x25', 23.5]]) {
    for (const name of names) {
      const svg = await assetLabelSvg({ ...asset, name }, { size });
      const rows = [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map(m => m[1]);
      // Собираем обратно: перенос длинного слова добавляет дефис на конце строки.
      const printed = rows.slice(1).join(' ').replace(/- /g, '-');
      assert.equal(printed, name, `${size}: «${name}» напечаталось как «${printed}»`);
      assert.doesNotMatch(printed, /…/);

      // Номер не мельчает вслед за наименованием и остаётся первой строкой.
      assert.equal(rows[0], asset.inventoryNumber);
      assert.doesNotMatch(svg, /font-size="(?:undefined|NaN)"/);

      const baselines = [...svg.matchAll(/<text[^>]*\sy="([\d.]+)"/g)].map(m => Number(m[1]));
      assert.ok(Math.max(...baselines) <= bottom, `${size}: строка ниже поля печати`);
    }
  }
  // На ленте кегль номера задан жёстко и от длины наименования не зависит.
  assert.match(await assetLabelSvg(asset, { size: '80x24' }), /font-size="5\.2"/);
});

test('книжный размер оборудования заменяется альбомным 80x24', async () => {
  const svg = await assetLabelSvg(asset, { size: '24x80' });
  assert.match(svg, /width="80mm" height="24mm"/);
});

test('повёрнутый файл — та же страница, положенная на бок', async () => {
  // Лента подаётся узкой стороной вперёд, и драйвер ждёт стоячую страницу
  // 24 × 80. Разворачиваем сами, чтобы он не разворачивал как придётся.
  const svg = await assetLabelSvg(asset, { size: '80x24' });
  const turned = await labelPng(svg, '80x24', { rotate: 90 });
  assert.equal(turned.readUInt32BE(16), 170);
  assert.equal(turned.readUInt32BE(20), 567);
});

test('PNG Brother формируется в точном размере 80x24 при 180 dpi', async () => {
  const svg = await assetLabelSvg(asset, { size: '80x24' });
  const png = await labelPng(svg, '80x24');
  assert.deepEqual([...png.subarray(1, 4)], [80, 78, 71]);
  assert.equal(png.readUInt32BE(16), 567);
  assert.equal(png.readUInt32BE(20), 170);
});

test('PNG кабинета формируется в точном размере 80x24 при 180 dpi', async () => {
  const svg = await roomDoorCardSvg(room);
  const png = await labelPng(svg, '80x24');
  assert.equal(png.readUInt32BE(16), 567);
  assert.equal(png.readUInt32BE(20), 170);
});

test('PNG TDP-225 формируется в точном размере 44x25 при 203 dpi', async () => {
  const svg = await assetLabelSvg(asset, { size: '44x25' });
  const png = await labelPng(svg, '44x25');
  assert.equal(png.readUInt32BE(16), 352);
  assert.equal(png.readUInt32BE(20), 200);
});

test('ZPL-профиль оборудования относится только к TDP-225 44x25', () => {
  const zpl = assetLabelZpl(asset);

  assert.match(zpl, /\^PW352/);
  assert.match(zpl, /\^LL200/);
  assert.match(zpl, /АЛЬФА ВИКИ: СКЛАД/);
  assert.doesNotMatch(zpl, /Каб\. 312|Медицинский центр|Владимирская|Model 1|Производитель 1|Диагностика/);
  assert.doesNotMatch(zpl, /\^PW464|\^LL320/);
});

test('дверная ZPL-этикетка TDP-225 имеет размер 44x25', () => {
  const zpl = roomDoorCardZpl(room);

  assert.match(zpl, /\^PW352/);
  assert.match(zpl, /\^LL200/);
  assert.match(zpl, /КАБИНЕТ/);
  assert.match(zpl, /312а\/2/);
  // Состав тот же, что у картинки: без шапки и без реквизитов медцентра.
  assert.doesNotMatch(zpl, /АЛЬФА ВИКИ|СКЛАД/);
  assert.doesNotMatch(zpl, /Главный корпус|3 этаж|Владимирская/);
});
