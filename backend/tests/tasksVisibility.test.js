const test = require('node:test');
const assert = require('node:assert/strict');

const vis = require('../services/tasks/visibility');
const teams = require('../services/tasks/teams');

/**
 * Обещание приватности модуля «Задачи» проверяется здесь построчно.
 *
 * Формулировка, данная заказчику: содержимое дел с уровнями «только я» и
 * «занято» не отдаётся ни одному запросу от имени другого пользователя,
 * включая владельца пространства и администратора филиала. Это утверждение,
 * которое легко сломать одной строчкой `if (isAdmin) return true` — ровно так
 * и было устроено в старом календаре.
 */

const OWNER = 'u-owner';
const OTHER = 'u-other';
const ADMIN = { id: 'u-admin', isAdmin: true };
const viewer = id => ({ id, isAdmin: false });

const event = (visibility, extra = {}) => ({
  id: 'e1',
  createdBy: OWNER,
  title: 'Врач',
  description: 'Приём в 14:00',
  location: 'Поликлиника №3',
  visibility,
  sharedWith: [],
  startTime: '2026-08-13T10:00:00.000Z',
  endTime: '2026-08-13T11:00:00.000Z',
  ...extra,
});

test('владелец видит собственное дело целиком, включая «только я»', () => {
  const out = vis.redact(event('private'), viewer(OWNER));
  assert.ok(out, 'своё дело не должно скрываться');
  assert.equal(out.title, 'Врач');
  assert.equal(out.isOpaque, false);
});

test('посторонний не получает «только я» вовсе', () => {
  assert.equal(vis.redact(event('private'), viewer(OTHER)), null);
});

test('администратор тоже не получает «только я»', () => {
  assert.equal(vis.redact(event('private'), ADMIN), null,
    'обход для админа означал бы, что обещание неверно');
});

test('«занято» отдаётся без названия, описания и места', () => {
  const out = vis.redact(event('busy'), viewer(OTHER));
  assert.ok(out);
  assert.equal(out.isOpaque, true);
  assert.equal(out.title, undefined);
  assert.equal(out.description, undefined);
  assert.equal(out.location, undefined);
  assert.equal(out.startTime, '2026-08-13T10:00:00.000Z', 'длительность видна — она и есть занятость');
});

test('администратор на «занято» получает то же обезличенное событие', () => {
  const out = vis.redact(event('busy'), ADMIN);
  assert.equal(out.isOpaque, true);
  assert.equal(out.title, undefined);
});

test('новое поле модели не утекает через обезличенное событие', () => {
  // Белый список полей: если завтра в CalendarEvent появится «diagnosis»,
  // он не должен уехать наружу сам по себе.
  const out = vis.redact(event('busy', { diagnosis: 'секрет', notes: 'ещё секрет' }), viewer(OTHER));
  assert.equal(out.diagnosis, undefined);
  assert.equal(out.notes, undefined);
});

test('«team» раскрывается только тем, кто в общей команде', () => {
  const mates = new Set([OWNER]);
  assert.equal(vis.redact(event('team'), viewer(OTHER), mates).title, 'Врач');
  assert.equal(vis.redact(event('team'), viewer(OTHER), new Set()).isOpaque, true,
    'не сокомандник видит занятость, но не название');
});

test('«shared» раскрывается по явному списку, механизм календаря не сломан', () => {
  const e = event('shared', { sharedWith: [OTHER] });
  assert.equal(vis.redact(e, viewer(OTHER)).title, 'Врач');
  assert.equal(vis.redact(e, viewer('u-third')).isOpaque, true);
});

test('«public» видно всем — это уровень отпуска', () => {
  assert.equal(vis.redact(event('public'), viewer('u-any')).title, 'Врач');
});

test('неизвестный уровень видимости трактуется как «только я»', () => {
  // Опечатка в данных или новое значение из будущей версии не должны
  // приводить к раскрытию: неизвестное — значит закрытое.
  assert.equal(vis.redact(event('team_v2'), viewer(OTHER)), null);
});

test('redactAll выбрасывает скрытые события, а не превращает их в null', () => {
  const list = [event('private'), event('busy'), event('public')];
  const out = vis.redactAll(list, viewer(OTHER));
  assert.equal(out.length, 2);
  assert.ok(out.every(Boolean));
});

test('инстанс Sequelize приводится к простому объекту', () => {
  const instance = {
    ...event('public'),
    get: () => ({ ...event('public'), dataValues: 'не должно уехать' }),
  };
  const out = vis.redact(instance, viewer(OTHER));
  assert.equal(out.title, 'Врач');
});

test('«только я» не занимает часов в чужом взгляде', () => {
  // Иначе в чужом дне остаётся необъяснимая разница между суммой видимых
  // блоков и итогом, по которой скрытое дело и восстанавливается.
  assert.equal(vis.countsAsBusyFor(event('private'), viewer(OTHER)), false);
  assert.equal(vis.countsAsBusyFor(event('private'), viewer(OWNER)), true);
  assert.equal(vis.countsAsBusyFor(event('busy'), viewer(OTHER)), true);
});

/* ─────────────────────────── команды ─────────────────────────── */

const team = (over = {}) => ({
  id: 't1',
  name: 'Продукт',
  medCenterId: 'mc1',
  access: teams.ACCESS.ALL,
  isHidden: false,
  members: [{ userId: OWNER, role: 'member' }, { userId: 'u-lead', role: 'lead' }],
  ...over,
});

test('скрытая команда не видна постороннему и не попадает в счётчик закрытых', () => {
  const hidden = team({ id: 't2', isHidden: true, access: teams.ACCESS.INVITE });
  assert.equal(teams.canSeeTeam(hidden, OTHER), false);
  assert.equal(teams.closedTeamCount([hidden], OTHER), 0,
    'счётчик «ещё N закрыто» выдал бы существование скрытой команды');
});

test('скрытая команда не выдаётся и администратору списком', () => {
  const hidden = team({ isHidden: true });
  assert.equal(teams.canSeeTeam(hidden, ADMIN.id, true), false);
});

test('участник скрытой команды её видит', () => {
  const hidden = team({ isHidden: true, members: [{ userId: OTHER, role: 'member' }] });
  assert.equal(teams.canSeeTeam(hidden, OTHER), true);
});

test('команда «по приглашению» видна, но загрузка — нет', () => {
  const t = team({ access: teams.ACCESS.INVITE });
  assert.equal(teams.canSeeTeamLoad(t, OTHER), false);
});

test('смотрящий видит загрузку, но в состав команды не входит', () => {
  const t = team({
    access: teams.ACCESS.INVITE,
    members: [{ userId: OWNER, role: 'member' }, { userId: OTHER, role: 'viewer' }],
  });
  assert.equal(teams.canSeeTeamLoad(t, OTHER), true);
  assert.ok(!teams.memberIds(t).includes(OTHER));
  assert.ok(!teams.peopleInScope([t], OWNER).includes(OTHER));
});

test('область видимости всегда включает самого себя', () => {
  assert.deepEqual(teams.peopleInScope([], 'u-alone'), ['u-alone']);
});

test('сокомандники считаются по участию, а не по праву смотреть', () => {
  const t = team({
    members: [
      { userId: OWNER, role: 'member' },
      { userId: 'u-mate', role: 'member' },
      { userId: OTHER, role: 'viewer' },
    ],
  });
  const mates = teams.teammateIds([t], OWNER);
  assert.ok(mates.has('u-mate'));
  assert.ok(!mates.has(OTHER), 'смотрящий видит часы, но не названия дел');
});

test('норму меняет руководитель общей команды, а не любой коллега', () => {
  const t = team({
    members: [{ userId: 'u-lead', role: 'lead' }, { userId: OWNER, role: 'member' }],
  });
  assert.equal(teams.canEditNorm([t], 'u-lead', OWNER), true);
  assert.equal(teams.canEditNorm([t], OWNER, 'u-lead'), false);
});
