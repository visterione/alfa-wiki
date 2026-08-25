'use strict';

const test = require('node:test');
const assert = require('node:assert');

const proc = require('../services/onboarding/process');
const validation = require('../services/onboarding/validation');
const projection = require('../services/onboarding/projection');

// Стадия на параллельном шаге не описывается одним хранимым статусом: после
// создания учётки одновременно живут четыре ветки. Проверяем, что стадия
// выводится из задач, а не из поля.
test('стадия после создания учётки выводится из закрытых задач', () => {
  const app = { status: proc.STATUS.MIS_CREATED };

  assert.equal(proc.stageOf(app, []).label, 'Запуск / выбор услуг');

  const picked = [{ stepKey: proc.DOCTOR_STEP, completedAt: new Date() }];
  assert.equal(proc.stageOf(app, picked).label, 'Услуги у бухгалтера');

  const accounted = [...picked, { stepKey: 'services_mis', completedAt: new Date() }];
  assert.equal(proc.stageOf(app, accounted).label, 'Выгрузка в колл-центр');
});

test('до создания учётки стадия совпадает со статусом заявки', () => {
  const app = { status: proc.STATUS.SUBMITTED };
  assert.equal(proc.stageOf(app, []).label, 'На согласовании');
});

// Чек-лист из ТЗ: запуск разрешён только когда закрыты все пункты, включая
// выбор услуг врачом — он не входит в STEPS, но в чек-листе обязан быть.
test('чек-лист включает выбор услуг врачом и не пускает запуск раньше времени', () => {
  const items = proc.checklistOf([]);
  assert.ok(items.some(i => i.key === proc.DOCTOR_STEP), 'нет пункта про выбор услуг');
  assert.equal(proc.isReadyToLaunch([]), false);

  const allDone = items.map(i => ({ stepKey: i.key, completedAt: new Date() }));
  assert.equal(proc.isReadyToLaunch(allDone), true);

  const missingBadge = allDone.filter(t => t.stepKey !== 'badge');
  assert.equal(proc.isReadyToLaunch(missingBadge), false);
});

test('параллельный запуск стартует четырьмя ветками после учётки в МИС', () => {
  const next = proc.stepsAfter('mis_account').map(s => s.key).sort();
  assert.deepEqual(next, ['badge', 'schedule', 'website']);
  // Четвёртая ветка — врач, у неё нет исполнителя внутри клиники, поэтому в
  // STEPS её нет и открывает её движок отдельно.
  assert.equal(proc.DOCTOR_STEP, 'services_pick');
});

// Форма публичная: в JSONB не должно попадать ничего, чего нет в схеме.
test('черновик очищается по схеме и отбрасывает посторонние ключи', () => {
  const form = validation.sanitize({
    fullName: '  Иванов  Иван   Иванович ',
    experienceTotal: '12,5',
    isAdmin: true,
    education: [{ year: '2010', institution: 'МГУ', specialty: 'Лечебное дело', city: 'Москва' }]
  });

  assert.equal(form.fullName, 'Иванов Иван Иванович');
  assert.equal(form.experienceTotal, 12.5);
  assert.equal('isAdmin' in form, false);
  assert.equal(form.education.length, 1);
});

test('пустые строки повторяемого блока не сохраняются', () => {
  const form = validation.sanitize({ education: [{}, { year: '', institution: '' }] });
  assert.deepEqual(form.education, []);
});

test('отправка без диплома и согласий не проходит', () => {
  const app = { medCenterId: 'mc', professions: [{ id: '1', name: 'Терапевт' }], consents: {} };
  const form = validation.sanitize({
    fullName: 'Иванов Иван', birthDate: '1980-01-01', phone: '+7 (900) 000-00-00',
    startDate: '2026-09-01', experienceTotal: 10, experienceSpecialty: 8,
    scheduleDays: [1, 3, 5], scheduleTime: { from: '09:00', to: '18:00' }, appointmentMinutes: 30,
    education: [{ year: 2005, institution: 'МГУ', specialty: 'Лечебное дело' }]
  });

  const withoutDocs = validation.validateForSubmit(app, form, []);
  assert.equal(withoutDocs.ok, false);
  assert.ok(withoutDocs.errors.some(e => e.field === 'diploma'));
  assert.ok(withoutDocs.errors.some(e => e.field === 'pd'));

  const ready = validation.validateForSubmit(
    { ...app, consents: { pd: { acceptedAt: 'now' }, image: { acceptedAt: 'now' } } },
    form,
    [{ kind: 'diploma' }, { kind: 'photo' }, { kind: 'certificate' }]
  );
  assert.deepEqual(ready.errors, []);
});

// Срез анкеты фильтруется на сервере: скрытие в интерфейсе обходится открытием
// ответа запроса.
test('маркетолог по бейджу не видит паспортных данных, главврач видит всё', () => {
  const app = {
    id: 'a', number: 1, status: 'submitted', medCenterId: 'mc',
    professions: [{ id: '1', name: 'Терапевт' }],
    fullName: 'Иванов Иван', phone: '+79000000000', email: 'i@example.com',
    form: { snils: '123-456', inn: '7700', badgeName: 'И. И. Иванов', bio: 'текст', photo: null },
    consents: {}
  };

  const badge = projection.project(app, 'badge', []);
  assert.equal(badge.form.badgeName, 'И. И. Иванов');
  assert.equal('snils' in badge.form, false);
  assert.equal('inn' in badge.form, false);
  assert.equal(badge.email, undefined);

  const chief = projection.project(app, '*', []);
  assert.equal(chief.form.snils, '123-456');
  assert.equal(chief.email, 'i@example.com');
});

test('сканы документов доступны только тому, кто согласовывает допуск', () => {
  assert.equal(projection.canSeeDocuments('*'), true);
  assert.equal(projection.canSeeDocuments('badge'), false);
  assert.equal(projection.canSeeDocuments('mis_account'), false);
});

// Дни приёма и время перестали быть свободным текстом: расписание по ним строит
// старший регистратор, и «пн-пт кроме второй среды» превращалось в переписку с
// врачом вместо работы.
test('дни недели и интервал приёма нормализуются, мусор отбрасывается', () => {
  const form = validation.sanitize({
    scheduleDays: [5, 1, 3, 1, 99],
    scheduleTime: { from: '09:00', to: '15:30' }
  });

  assert.deepEqual(form.scheduleDays, [1, 3, 5], 'дубли и лишние номера убираются, порядок по неделе');
  assert.deepEqual(form.scheduleTime, { from: '09:00', to: '15:30' });

  assert.equal(validation.sanitize({ scheduleTime: { from: '25:00', to: '15:00' } }).scheduleTime, null);
  assert.equal(validation.sanitize({ scheduleDays: 'пн-пт' }).scheduleDays, null);
});

// Один и тот же номер врачи пишут пятью способами. Сравнивать и звонить нужно
// по одному виду, поэтому в анкете лежат цифры, а маску рисует форма.
test('телефон приводится к 11 цифрам с семёркой', () => {
  const variants = ['8 (900) 111-22-33', '+7 900 111 22 33', '79001112233', '9001112233'];
  for (const value of variants) {
    assert.equal(validation.sanitize({ phone: value }).phone, '79001112233', value);
  }
});

test('неполный телефон не пропускается при отправке', () => {
  const app = {
    medCenterId: 'mc',
    professions: [{ id: '1', name: 'Терапевт' }],
    consents: { pd: { acceptedAt: 'now' }, image: { acceptedAt: 'now' } }
  };
  const errors = validation
    .validateForSubmit(app, validation.sanitize({ phone: '900111' }), [{ kind: 'diploma' }])
    .errors;

  assert.ok(errors.some(e => e.field === 'phone' && /не полностью/.test(e.message)));
});

// Шаги анкеты обязаны покрывать все блоки: забытый в группировке блок просто
// исчезает из формы, и человек не может её отправить, не понимая почему.
test('каждый блок анкеты попадает ровно в один шаг', () => {
  const schema = require('../services/onboarding/formSchema');
  const used = schema.STEPS.flatMap(step => step.blocks);
  const known = schema.BLOCKS.map(block => block.key);

  assert.deepEqual([...used].sort(), [...known].sort());
  assert.equal(new Set(used).size, used.length, 'блок не должен встречаться дважды');
});

// МИС понимает несколько profession_id через запятую как «И», а не «ИЛИ». На
// враче с двумя специальностями это давало «услуг не нашлось» там, где их
// десятки, поэтому запрос обязан идти по одной специальности за раз.
test('услуги запрашиваются по каждой специальности отдельно и схлопываются', async () => {
  const calls = [];
  const misVerify = withMisStub(calls, (method, params) => {
    if (method === 'getServices') {
      const id = params.profession_id;
      return id === '2'
        ? [{ service_id: 1, title: 'Приём аллерголога' }, { service_id: 9, title: 'Общая' }]
        : [{ service_id: 5, title: 'Спирография' }, { service_id: 9, title: 'Общая' }];
    }
    return [];
  });

  const result = await misVerify.servicesForApplication({
    medCenterId: null,
    professions: [{ id: '2' }, { id: '37' }]
  });

  const professionParams = calls
    .filter(call => call.method === 'getServices')
    .map(call => call.params.profession_id);

  assert.deepEqual(professionParams, ['2', '37'], 'по одному запросу на специальность');
  assert.equal(result.services.length, 3, 'общая услуга не задвоилась');
  assert.deepEqual(
    result.services.find(service => service.serviceId === '9').specialties.map(item => item.id),
    ['2', '37'],
    'общая услуга сохраняет обе специальности для группировки в анкете'
  );
});

test('пустой каталог филиала повторно запрашивается по сети', async () => {
  const calls = [];
  const misVerify = withMisStub(calls, (method, params) => {
    if (method !== 'getServices') return [];
    if (params.clinic_id) return [];
    return [{ service_id: 15, title: 'Сетевая услуга', category_title: 'Приёмы' }];
  }, { misClinicIds: ['6'] });

  const result = await misVerify.servicesForApplication({
    medCenterId: 'mc',
    professions: [{ id: '2', name: 'Аллерголог' }]
  });

  const serviceCalls = calls.filter(call => call.method === 'getServices');
  assert.deepEqual(serviceCalls.map(call => call.params), [
    { profession_id: '2', clinic_id: '6' },
    { profession_id: '2' }
  ]);
  assert.equal(result.services[0].title, 'Сетевая услуга');
});

// В справочнике медцентров у АУП стоит «aup», у ИП Микаелян — «ip». МИС на
// такой clinic_id отвечает ошибкой, а мы разбирали её как «никого не нашлось».
test('нечисловые id клиник в запрос к МИС не уходят', async () => {
  const calls = [];
  const misVerify = withMisStub(calls, () => [], { misClinicIds: ['aup'] });

  await misVerify.searchDoctors({ medCenterId: 'mc' }, '');
  const call = calls.find(c => c.method === 'getUsers');

  assert.ok(call, 'запрос к МИС всё же уходит');
  assert.equal('clinic_id' in call.params, false, 'clinic_id со значением «aup» не передаётся');
});

test('ручной поиск сотрудника запрашивает полный ростер всей сети', async () => {
  const calls = [];
  const misVerify = withMisStub(calls, (method) => method === 'getUsers'
    ? [{ id: 77, name: 'Бакшеева Ольга Михайловна', profession: [] }]
    : [], { misClinicIds: ['2'] });

  const result = await misVerify.searchDoctors({ medCenterId: 'mc' }, 'Бакшеева');
  const call = calls.find(c => c.method === 'getUsers');

  assert.equal(call.params.show_all, 1);
  assert.equal('clinic_id' in call.params, false, 'по фамилии ищем и за пределами выбранного филиала');
  assert.equal(result.users[0].name, 'Бакшеева Ольга Михайловна');
});

test('автоматическая сверка по ФИО тоже запрашивает полный ростер', async () => {
  const calls = [];
  const misVerify = withMisStub(calls, (method) => method === 'getUsers'
    ? [{ id: 77, name: 'Бакшеева Ольга Михайловна', profession: [] }]
    : [], { misClinicIds: ['2'] });

  const result = await misVerify.findDoctor({
    medCenterId: 'mc',
    fullName: 'Бакшеева Ольга Михайловна',
    professions: []
  });
  const call = calls.find(c => c.method === 'getUsers');

  assert.equal(call.params.show_all, 1);
  assert.equal(result.ok, true);
  assert.equal(result.misUserId, '77');
});

/**
 * Подменяет misClient и модели, чтобы проверить, что именно уходит в МИС.
 * Своего http сюда не пускаем: тест про формирование параметров, а не про сеть.
 */
function withMisStub(calls, handler, medCenter = { misClinicIds: [] }) {
  const clientPath = require.resolve('../services/misClient');
  const modelsPath = require.resolve('../models');
  const verifyPath = require.resolve('../services/onboarding/misVerify');

  const originals = { client: require.cache[clientPath], models: require.cache[modelsPath] };

  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: {
      misRequest: async (method, params) => {
        calls.push({ method, params });
        return { error: 0, data: handler(method, params) };
      }
    }
  };
  require.cache[modelsPath] = {
    id: modelsPath,
    filename: modelsPath,
    loaded: true,
    exports: { MedCenter: { findByPk: async () => medCenter } }
  };
  delete require.cache[verifyPath];

  const misVerify = require('../services/onboarding/misVerify');

  // Возвращаем кэш на место сразу: модуль уже захватил подменённые зависимости,
  // а остальным тестам нужны настоящие.
  delete require.cache[verifyPath];
  if (originals.client) require.cache[clientPath] = originals.client;
  else delete require.cache[clientPath];
  if (originals.models) require.cache[modelsPath] = originals.models;
  else delete require.cache[modelsPath];

  return misVerify;
}
