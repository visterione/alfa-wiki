const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBadgeOverride, resolveBadge } = require('../utils/resolveChatBadge');
const { DEFAULT_BADGE_COLOR } = require('../utils/chatBadgeIcons');

const role = (name, icon, priority, label = null) =>
  ({ name, chatBadgeIcon: icon, badgePriority: priority, chatBadgeLabel: label });

const clinic = (name, color, sortOrder) => ({ name, color, sortOrder });

test('без ролей с иконкой метки нет', () => {
  assert.equal(resolveBadge({ roles: [role('Регистратор', null, 0)], medCenters: [] }), null);
});

test('иконку даёт роль с наибольшим приоритетом', () => {
  const badge = resolveBadge({
    roles: [role('Врач', 'Stethoscope', 10), role('Руководитель', 'Crown', 50)],
    medCenters: []
  });
  assert.equal(badge.value, 'Crown');
});

test('при равном приоритете выбор не зависит от порядка ролей', () => {
  const roles = [role('Врач', 'Stethoscope', 5), role('Администратор', 'ClipboardList', 5)];
  const forward = resolveBadge({ roles, medCenters: [] });
  const reversed = resolveBadge({ roles: [...roles].reverse(), medCenters: [] });
  assert.equal(forward.value, reversed.value);
  assert.equal(forward.value, 'ClipboardList');
});

test('цвет берётся у клиники с наименьшим sortOrder', () => {
  const badge = resolveBadge({
    roles: [role('Врач', 'Stethoscope', 0)],
    medCenters: [clinic('Кидс', '#ed9121', 2), clinic('Альфа', '#de64a1', 1)]
  });
  assert.equal(badge.color, '#de64a1');
});

test('без клиник цвет по умолчанию', () => {
  const badge = resolveBadge({ roles: [role('Врач', 'Stethoscope', 0)], medCenters: [] });
  assert.equal(badge.color, DEFAULT_BADGE_COLOR);
});

test('override перебивает и иконку, и цвет', () => {
  const badge = resolveBadge({
    chatBadgeOverride: { value: 'Crown', color: '#112233' },
    roles: [role('Врач', 'Stethoscope', 0)],
    medCenters: [clinic('Альфа', '#de64a1', 1)]
  });
  assert.equal(badge.value, 'Crown');
  assert.equal(badge.color, '#112233');
});

test('подпись роли не липнет к вручную выбранной иконке', () => {
  const roles = [role('Врач', 'Stethoscope', 0, 'Врач-терапевт')];

  const auto = resolveBadge({ roles, medCenters: [] });
  assert.equal(auto.label, 'Врач-терапевт');

  const overridden = resolveBadge({ chatBadgeOverride: { value: 'Crown' }, roles, medCenters: [] });
  assert.equal(overridden.label, '');
});

test('своя подпись важнее подписи роли', () => {
  const badge = resolveBadge({
    chatBadgeOverride: { label: 'Главврач' },
    roles: [role('Врач', 'Stethoscope', 0, 'Врач-терапевт')],
    medCenters: []
  });
  assert.equal(badge.label, 'Главврач');
});

test('мусор в override отбрасывается', () => {
  assert.equal(normalizeBadgeOverride({ value: 'НетТакойИконки', color: 'красный' }), null);
  assert.equal(normalizeBadgeOverride(null), null);
  assert.equal(normalizeBadgeOverride({ label: '   ' }), null);
  assert.deepEqual(normalizeBadgeOverride({ value: 'Crown', color: 'красный' }), { value: 'Crown' });
});

test('невалидный цвет клиники не попадает в метку', () => {
  const badge = resolveBadge({
    roles: [role('Врач', 'Stethoscope', 0)],
    medCenters: [clinic('Сломанная', 'rgb(1,2,3)', 1), clinic('Альфа', '#de64a1', 5)]
  });
  assert.equal(badge.color, '#de64a1');
});
