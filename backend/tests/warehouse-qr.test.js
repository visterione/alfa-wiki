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

const labelOrganization = {
  orgName: 'Медицинский центр «Альфа»',
  orgAddress: 'ул. Владимирская, 93',
};

for (const [size, width, height] of [
  ['24x45', '24mm', '45mm'],
  ['20x80', '20mm', '80mm'],
  ['24x80', '24mm', '80mm'],
  ['44x25', '44mm', '25mm'],
]) {
  test(`этикетка кабинета печатается в формате ${size}`, async () => {
    const svg = await roomDoorCardSvg(room, { size, ...labelOrganization });
    const dimensions = svg.match(/<svg[^>]*width="([^"]+)" height="([^"]+)"/).slice(1);

    assert.deepEqual(dimensions, [width, height]);
    assert.match(svg, /312а\/2/);
    assert.match(svg, /Главный корпус/);
    assert.match(svg, /3 этаж/);
    const text = visibleText(svg);
    assert.match(text, /Медицинский центр «Альфа»/);
    assert.match(text, /ул\. Владимирская, 93/);
    assert.equal(text.trim().endsWith('ул. Владимирская, 93'), true);
    assert.match(svg, /АЛЬФА ВИКИ/);
    assert.match(svg, /СКЛАД/);
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

test('компактная этикетка кабинета 24x45 используется по умолчанию', async () => {
  const svg = await roomDoorCardSvg(room, labelOrganization);
  assert.match(svg, /width="24mm" height="45mm"/);
  const text = visibleText(svg);
  assert.ok(text.indexOf('Главный корпус') < text.indexOf('312а/2'));
  assert.ok(text.indexOf('3 этаж') < text.indexOf('312а/2'));
  assert.ok(text.indexOf('312а/2') < text.indexOf('КАБИНЕТ'));
  assert.match(svg, /<svg x="3" y="18\.5" width="18" height="18"/);
  assert.match(svg, /<line x1="1\.5" y1="38\.5" x2="22\.5" y2="38\.5"/);
});

for (const size of ['80x20', '80x24', '44x25']) {
  test(`этикетка оборудования ${size} использует только чёрный цвет`, async () => {
    const svg = await assetLabelSvg(asset, { size, ...labelOrganization });
    assertMonochrome(svg);
    const text = visibleText(svg);
    assert.match(text, /^АЛЬФА ВИКИ: СКЛАД МЦ-2026-0001/);
    assert.doesNotMatch(svg, /Каб\. 312|Медицинский центр|Владимирская|Model 1|Производитель 1|Диагностика<\/text>/);
    if (size === '80x20' || size === '80x24') {
      assert.match(svg, /<svg x="1\.5" y="1\.5"/);
      assert.match(svg, /<text x="(?:49\.25|51\.25)"/);
    }
  });
}

test('книжный размер оборудования заменяется альбомным 80x24', async () => {
  const svg = await assetLabelSvg(asset, { size: '24x80', ...labelOrganization });
  assert.match(svg, /width="80mm" height="24mm"/);
});

test('PNG Brother формируется в точном размере 80x24 при 180 dpi', async () => {
  const svg = await assetLabelSvg(asset, { size: '80x24' });
  const png = await labelPng(svg, '80x24');
  assert.deepEqual([...png.subarray(1, 4)], [80, 78, 71]);
  assert.equal(png.readUInt32BE(16), 567);
  assert.equal(png.readUInt32BE(20), 170);
});

test('PNG кабинета формируется в точном размере 24x45 при 180 dpi', async () => {
  const svg = await roomDoorCardSvg(room, labelOrganization);
  const png = await labelPng(svg, '24x45');
  assert.equal(png.readUInt32BE(16), 170);
  assert.equal(png.readUInt32BE(20), 319);
});

test('PNG TDP-225 формируется в точном размере 44x25 при 203 dpi', async () => {
  const svg = await assetLabelSvg(asset, { size: '44x25' });
  const png = await labelPng(svg, '44x25');
  assert.equal(png.readUInt32BE(16), 352);
  assert.equal(png.readUInt32BE(20), 200);
});

test('ZPL-профиль оборудования относится только к TDP-225 44x25', () => {
  const zpl = assetLabelZpl(asset, labelOrganization);

  assert.match(zpl, /\^PW352/);
  assert.match(zpl, /\^LL200/);
  assert.match(zpl, /АЛЬФА ВИКИ: СКЛАД/);
  assert.doesNotMatch(zpl, /Каб\. 312|Медицинский центр|Владимирская|Model 1|Производитель 1|Диагностика/);
  assert.doesNotMatch(zpl, /\^PW464|\^LL320/);
});

test('дверная ZPL-этикетка TDP-225 имеет размер 44x25', () => {
  const zpl = roomDoorCardZpl(room, labelOrganization);

  assert.match(zpl, /\^PW352/);
  assert.match(zpl, /\^LL200/);
  assert.match(zpl, /КАБИНЕТ/);
  assert.match(zpl, /АЛЬФА ВИКИ/);
  assert.match(zpl, /СКЛАД/);
  assert.match(zpl, /Главный корпус/);
  assert.match(zpl, /3 этаж/);
  assert.match(zpl, /ул\. Владимирская, 93/);
});
