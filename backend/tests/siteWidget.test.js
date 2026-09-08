'use strict';

/**
 * Проверка значений виджета связи (ver. 8.06).
 *
 * Проверяем именно то, ради чего логика вынесена из маршрута: всё это уезжает
 * на публичный сайт клиники, и ошибка здесь стоит дороже обычной. Ссылка канала
 * подставляется в href на чужой странице — адрес с не-https схемой означал бы
 * выполнение кода в origin клиники руками администратора вики.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const widget = require('../services/siteWidget');

test('ссылка канала принимается только по https', () => {
  assert.throws(
    () => widget.normalizeChannels([{ type: 'telegram', value: 'javascript:alert(1)' }]),
    /https/
  );
  assert.throws(
    () => widget.normalizeChannels([{ type: 'telegram', value: 'http://t.me/bot' }]),
    /https/
  );
  assert.throws(
    () => widget.normalizeChannels([{ type: 'max', value: 'не ссылка' }]),
    /не похожа на адрес/
  );

  const [channel] = widget.normalizeChannels([{ type: 'telegram', value: 'https://t.me/alfa_bot' }]);
  assert.equal(channel.value, 'https://t.me/alfa_bot');
});

test('неизвестный канал не проходит молча', () => {
  assert.throws(() => widget.normalizeChannels([{ type: 'whatsapp', value: 'https://wa.me/1' }]), /Неизвестный канал/);
});

test('порядок каналов сохраняется — он же порядок кнопок', () => {
  const channels = widget.normalizeChannels([
    { type: 'phone', value: '8 (861) 333-22-11' },
    { type: 'telegram', value: 'https://t.me/alfa_bot' },
    { type: 'max', value: 'https://max.ru/alfa_bot' }
  ]);

  assert.deepEqual(channels.map(c => c.type), ['phone', 'telegram', 'max']);
});

test('восьмёрка в начале номера приводится к +7', () => {
  const [phone] = widget.normalizeChannels([{ type: 'phone', value: '8 (900) 123-45-67' }]);
  assert.equal(phone.value, '+79001234567');
  // Своей подписи нет — подставляется человеческая, а не пустая строка
  assert.equal(phone.label, 'Позвонить');
});

test('в номере должны быть цифры, а не буквы', () => {
  assert.throws(() => widget.normalizeChannels([{ type: 'phone', value: 'позвоните нам' }]), /не похоже на телефонный номер/);
});

test('подпись под названием — своя у каждого канала', () => {
  const [own, empty] = widget.normalizeChannels([
    { type: 'telegram', value: 'https://t.me/a', note: '  Отвечаем до 20:00  ' },
    { type: 'phone', value: '+79000000000' }
  ]);

  assert.equal(own.note, 'Отвечаем до 20:00');
  // Не указана — значит второй строки на кнопке не будет вовсе
  assert.equal(empty.note, '');
});

test('канал включён, пока явно не выключен', () => {
  const [on] = widget.normalizeChannels([{ type: 'telegram', value: 'https://t.me/a' }]);
  const [off] = widget.normalizeChannels([{ type: 'telegram', value: 'https://t.me/a', enabled: false }]);
  assert.equal(on.enabled, true);
  assert.equal(off.enabled, false);
});

test('оформление: цвет только #rrggbb, угол только свой', () => {
  assert.throws(() => widget.normalizeAppearance({ color: 'red' }), /#rrggbb/);
  assert.throws(() => widget.normalizeAppearance({ position: 'top' }), /right/);
  assert.throws(() => widget.normalizeAppearance({ bottomOffset: 900 }), /от 0 до 300/);

  const appearance = widget.normalizeAppearance({ color: '#1A73E8', position: 'left', bottomOffset: 40 });
  assert.equal(appearance.color, '#1a73e8');
  assert.equal(appearance.position, 'left');
  assert.equal(appearance.bottomOffset, 40);
  // Незаданное берётся по умолчанию, а не пропадает
  assert.equal(appearance.title, widget.DEFAULT_APPEARANCE.title);
});

test('белый список адресов сравнивается по origin, а не по строке', () => {
  const site = { allowedOrigins: widget.normalizeOrigins(['medcentralfa.ru', 'https://www.medcentralfa.ru/']) };

  assert.equal(widget.originAllowed(site, 'https://medcentralfa.ru'), true);
  assert.equal(widget.originAllowed(site, 'https://www.medcentralfa.ru'), true);
  assert.equal(widget.originAllowed(site, 'https://чужой-сайт.рф'), false);
  // Не браузер — заголовка Origin нет, отличить нечем и отказывать не за что
  assert.equal(widget.originAllowed(site, undefined), true);
});

test('пустой белый список означает «где угодно»', () => {
  assert.equal(widget.originAllowed({ allowedOrigins: [] }, 'https://откуда-угодно.рф'), true);
});

test('наружу уходит только то, что и так видно на сайте', () => {
  const view = widget.publicView({
    id: 'внутренний-id',
    key: 'w0123456789abcdef01',
    name: 'Сайт Альфа-Анапа',
    medCenterId: 'филиал',
    allowedOrigins: ['https://medcentralfa.ru'],
    appearance: { color: '#2f6fed' },
    channels: [
      { type: 'telegram', enabled: true, label: 'Telegram', note: 'Ответим за минуту', value: 'https://t.me/a' },
      { type: 'max', enabled: false, label: 'MAX', value: 'https://max.ru/a' }
    ],
    updatedAt: new Date('2026-09-08T10:00:00Z')
  });

  assert.deepEqual(Object.keys(view).sort(), [
    'bottomOffset', 'buttonLabel', 'channels', 'color', 'greeting', 'key', 'position', 'title', 'updatedAt'
  ]);
  // Выключенный канал на сайт не уезжает вовсе — не «приезжает и прячется»
  assert.deepEqual(view.channels.map(c => c.type), ['telegram']);
});
