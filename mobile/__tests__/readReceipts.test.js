/**
 * Время просмотра сообщения (ver. 8.26).
 *
 * Вся суть журнала прочтений — в одном правиле: увидел человек сообщение
 * тогда, когда впервые открыл чат уже после его отправки. Ошибиться в нём
 * легко (отдать последнюю отметку вместо первой подходящей), а заметить
 * ошибку на глаз почти нельзя: галочка в обоих случаях одна и та же, врёт
 * только подпись со временем.
 *
 * Те же правила в вебе — frontend/src/utils/readReceipts.js.
 */
import {readTimeFor, readersOf, appendMark} from '../src/utils/readReceipts';

const at = iso => new Date(iso).toISOString();

describe('readTimeFor', () => {
  const marks = [at('2026-09-14T09:00:00Z'), at('2026-09-14T12:00:00Z'), at('2026-09-14T18:00:00Z')];

  it('отдаёт первую отметку после отправки, а не последнюю', () => {
    expect(readTimeFor(marks, at('2026-09-14T10:30:00Z'))).toBe(marks[1]);
  });

  it('сообщение, отправленное ровно в момент открытия чата, считается прочитанным', () => {
    expect(readTimeFor(marks, marks[0])).toBe(marks[0]);
  });

  it('молчит, если после сообщения чат ни разу не открывали', () => {
    expect(readTimeFor(marks, at('2026-09-14T20:00:00Z'))).toBeNull();
    expect(readTimeFor([], at('2026-09-14T10:00:00Z'))).toBeNull();
  });
});

describe('readersOf', () => {
  const members = [
    {userId: 'a', displayName: 'Анна', marks: [at('2026-09-14T12:00:00Z')]},
    {userId: 'b', displayName: 'Борис', marks: [at('2026-09-14T09:00:00Z')]},
    {userId: 'v', displayName: 'Вера', marks: [at('2026-09-14T11:00:00Z')]},
  ];
  const message = {createdAt: at('2026-09-14T10:00:00Z')};

  it('возвращает только прочитавших и по порядку просмотра', () => {
    expect(readersOf(members, message).map(r => r.displayName)).toEqual(['Вера', 'Анна']);
  });

  it('у каждого — своё время просмотра', () => {
    expect(readersOf(members, message)[0].at).toBe(at('2026-09-14T11:00:00Z'));
  });
});

describe('appendMark', () => {
  const members = [{userId: 'a', displayName: 'Анна', marks: [at('2026-09-14T09:00:00Z')]}];

  it('дописывает отметку известному участнику, не трогая старые', () => {
    const next = appendMark(members, {id: 'a'}, at('2026-09-14T12:00:00Z'));
    expect(next[0].marks).toEqual([at('2026-09-14T09:00:00Z'), at('2026-09-14T12:00:00Z')]);
  });

  it('заводит участника, которого не было в журнале — он мог войти в группу позже', () => {
    const next = appendMark(members, {id: 'b', displayName: 'Борис'}, at('2026-09-14T12:00:00Z'));
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      userId: 'b',
      displayName: 'Борис',
      avatar: null,
      marks: [at('2026-09-14T12:00:00Z')],
    });
  });

  it('не меняет журнал, если событие пришло без отправителя', () => {
    expect(appendMark(members, {}, at('2026-09-14T12:00:00Z'))).toBe(members);
  });
});
