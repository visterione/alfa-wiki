'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const max = require('../services/messengers/max');
const telegram = require('../services/messengers/telegram');

// ── Общий вид каналов ─────────────────────────────────────────────────────

test('оба канала выглядят одинаково снаружи', () => {
  // Разговор с пациентом, открытая линия и каскад уведомлений написаны против
  // этого набора и не должны знать, чей код исполняется.
  for (const method of ['sendText', 'answerCallback', 'parseUpdate', 'getMe', 'getUpdates', 'cursorOf']) {
    assert.equal(typeof telegram[method], 'function', `telegram.${method}`);
    assert.equal(typeof max[method], 'function', `max.${method}`);
  }
});

test('курсор поштучный только там, где платформа это умеет', () => {
  assert.equal(telegram.cursorOf({ update_id: 17 }), 17);
  // У MAX маркер один на пачку — канал честно возвращает пусто, и процесс
  // забора двигает курсор после разбора всей пачки.
  assert.equal(max.cursorOf({}), null);
});

// ── Разбор обновлений MAX ─────────────────────────────────────────────────

test('запуск бота приходит отдельным событием, а не командой в тексте', () => {
  const update = max.parseUpdate({
    update_type: 'bot_started',
    user: { user_id: 5551, first_name: 'Иван', username: 'ivan' }
  });

  assert.equal(update.type, 'command');
  assert.equal(update.command, '/start');
  assert.equal(update.externalUserId, '5551');
  // Писать пациенту можно по его же идентификатору — отдельного чата нет.
  assert.equal(update.chatId, '5551');
  assert.equal(update.from.firstName, 'Иван');
});

test('обычное сообщение', () => {
  const update = max.parseUpdate({
    update_type: 'message_created',
    message: {
      sender: { user_id: 777, first_name: 'Пётр' },
      body: { mid: 'mid-1', text: 'Здравствуйте, можно перенести приём?' }
    }
  });

  assert.equal(update.type, 'text');
  assert.equal(update.text, 'Здравствуйте, можно перенести приём?');
  assert.equal(update.externalUserId, '777');
  assert.equal(update.externalMessageId, 'mid-1');
});

test('телефон достаётся из карточки VCARD', () => {
  // Готового поля с номером MAX не присылает — только карточку строкой.
  const update = max.parseUpdate({
    update_type: 'message_created',
    message: {
      sender: { user_id: 777 },
      body: {
        mid: 'mid-2',
        attachments: [{
          type: 'contact',
          payload: {
            vcf_info: 'BEGIN:VCARD\nVERSION:3.0\nFN:Пётр\nTEL;TYPE=CELL:+7 (999) 123-45-67\nEND:VCARD'
          }
        }]
      }
    }
  });

  assert.equal(update.type, 'contact');
  assert.equal(update.phone, '+7 (999) 123-45-67');
});

test('если карточки нет, номер ищется в данных аккаунта', () => {
  const update = max.parseUpdate({
    update_type: 'message_created',
    message: {
      sender: { user_id: 777 },
      body: { mid: 'mid-3', attachments: [{ type: 'contact', payload: { max_info: { phone: '79990000000' } } }] }
    }
  });
  assert.equal(update.phone, '79990000000');
});

test('вложение приходит готовой ссылкой', () => {
  const update = max.parseUpdate({
    update_type: 'message_created',
    message: {
      sender: { user_id: 777 },
      body: {
        mid: 'mid-4',
        text: 'вот направление',
        attachments: [{ type: 'image', payload: { url: 'https://cdn.max.ru/a.jpg' } }]
      }
    }
  });

  assert.equal(update.type, 'media');
  assert.equal(update.media.kind, 'photo');
  assert.equal(update.media.url, 'https://cdn.max.ru/a.jpg');
  assert.equal(update.text, 'вот направление');
});

test('нажатие кнопки', () => {
  const update = max.parseUpdate({
    update_type: 'message_callback',
    callback: { callback_id: 'cb-1', payload: 'confirm:3917571', user: { user_id: 777 } }
  });

  assert.equal(update.type, 'button');
  assert.equal(update.data, 'confirm:3917571');
  assert.equal(update.callbackId, 'cb-1');
});

test('неинтересные события отбрасываются', () => {
  assert.equal(max.parseUpdate({ update_type: 'bot_added' }), null);
  assert.equal(max.parseUpdate({ update_type: 'message_created', message: { sender: {}, body: {} } }), null);
});
