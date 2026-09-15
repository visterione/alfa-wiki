'use strict';

/**
 * Разбор набора быстрых данных колл-центра (ver. 8.32).
 *
 * Набор приходит от страницы целиком и целиком же перезаписывает то, что лежит
 * в базе. Поэтому ошибка в разборе стоит дороже обычного: она не портит одну
 * запись, а уносит весь справочник, которым пользуется смена.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanTabs, cleanSnippets } = require('../routes/call-center');

const tabIds = new Set(['tab-prep']);

test('карточка без своей вкладки выбрасывается', () => {
  // Иначе она осела бы в базе, не показавшись ни на одной вкладке, и искать её
  // пришлось бы запросом, когда кто-нибудь заметит пропажу.
  const out = cleanSnippets([
    { id: 'sn-1', tabId: 'tab-prep', title: 'УЗИ', items: [{ kind: 'text', value: 'натощак' }] },
    { id: 'sn-2', tabId: 'tab-которой-нет', title: 'Сирота', items: [{ kind: 'text', value: 'текст' }] }
  ], tabIds);
  assert.deepEqual(out.map(s => s.id), ['sn-1']);
});

test('карточка без единого заполненного поля не сохраняется', () => {
  const out = cleanSnippets([
    { id: 'sn-1', tabId: 'tab-prep', title: 'Пустая', items: [{ kind: 'text', value: '   ' }] }
  ], tabIds);
  assert.equal(out.length, 0);
});

test('повторный идентификатор берётся один раз', () => {
  // upsert по одному ключу дважды в одной транзакции — это тихая потеря одной
  // из двух карточек; пусть лучше решение примет разбор.
  const out = cleanSnippets([
    { id: 'sn-1', tabId: 'tab-prep', title: 'Первая', items: [{ kind: 'text', value: 'а' }] },
    { id: 'sn-1', tabId: 'tab-prep', title: 'Вторая', items: [{ kind: 'text', value: 'б' }] }
  ], tabIds);
  assert.deepEqual(out.map(s => s.title), ['Первая']);
});

test('неизвестный вид поля становится текстом, а не поводом отказать', () => {
  const [snippet] = cleanSnippets([
    { id: 'sn-1', tabId: 'tab-prep', title: 'УЗИ', items: [{ kind: 'какой-то', value: 'значение' }] }
  ], tabIds);
  assert.equal(snippet.items[0].kind, 'text');
});

test('вкладка без названия не заводится', () => {
  const out = cleanTabs([
    { id: 'tab-prep', title: 'Подготовки' },
    { id: 'tab-empty', title: '   ' }
  ]);
  assert.deepEqual(out.map(t => t.id), ['tab-prep']);
});

test('порядок восстанавливается, если страница его не прислала', () => {
  // Без этого все записи легли бы с sortOrder = 0 и разошлись бы по экрану в
  // случайном порядке при следующем чтении.
  const out = cleanTabs([{ id: 'a', title: 'А' }, { id: 'b', title: 'Б' }]);
  assert.deepEqual(out.map(t => t.sortOrder), [1, 2]);
});
