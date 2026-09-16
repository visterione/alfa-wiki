const test = require('node:test');
const assert = require('node:assert/strict');

const formSchema = require('../services/vacancies/formSchema');
const processSchema = require('../services/vacancies/processSchema');

/**
 * Два этапа анкеты (ver. 8.37).
 *
 * Паспорт, военный билет и трудовую спрашивают у того, кому уже дали зелёный
 * свет. Проверяется здесь не «поле stage сохранилось», а три утверждения, ради
 * которых этапы и заводились.
 */

/** Анкета из двух этапов: имя спрашиваем сразу, документы — после решения. */
function twoStageForm() {
  const { errors, form } = formSchema.validateForm({
    blocks: [
      { key: 'main', title: 'Основное', fields: [{ key: 'fullName', label: 'ФИО', type: 'text', role: 'fullName', required: true }] },
      { key: 'docs', title: 'Документы', fields: [{ key: 'pasport', label: 'Паспорт', type: 'files', required: true }] }
    ],
    steps: [
      { key: 'about', title: 'О себе', blocks: ['main'] },
      { key: 'hire', title: 'Трудоустройство', blocks: ['docs'], stage: 'after' }
    ]
  });
  assert.deepEqual(errors, []);
  return form;
}

test('обязательное поле второго этапа не мешает отправить первый', () => {
  const form = twoStageForm();

  const first = formSchema.validateAnswers(
    formSchema.formOfStage(form, 'initial'),
    { fullName: 'Иванова Мария Петровна' },
    { partial: false }
  );
  assert.deepEqual(first.errors, []);

  // А во втором этапе то же поле по-прежнему обязательно.
  const second = formSchema.validateAnswers(formSchema.formOfStage(form, 'after'), {}, { partial: false });
  assert.equal(second.errors.length, 1);
  assert.match(second.errors[0].message, /Паспорт/);
});

test('этап несёт свои блоки и только их', () => {
  const form = twoStageForm();

  assert.deepEqual(formSchema.formOfStage(form, 'initial').blocks.map(b => b.key), ['main']);
  assert.deepEqual(formSchema.formOfStage(form, 'after').blocks.map(b => b.key), ['docs']);
  assert.equal(formSchema.hasStage(form, 'after'), true);

  // Снимок при этом не тронут: карточка заявки показывает анкету целиком.
  assert.equal(form.blocks.length, 2);
});

test('анкета целиком «после согласования» не принимается', () => {
  const { errors } = formSchema.validateForm({
    blocks: [{ key: 'main', title: 'Основное', fields: [{ key: 'fullName', label: 'ФИО', type: 'text', role: 'fullName' }] }],
    steps: [{ key: 'about', title: 'О себе', blocks: ['main'], stage: 'after' }]
  });
  assert.ok(errors.some(e => /нечего заполнять/.test(e)), errors.join(' | '));
});

test('ФИО и специальность на втором этапе не пропускаются', () => {
  // Иначе заявка до согласования безымянна, а услуги подтягивать не по чему.
  const { errors } = formSchema.validateForm({
    blocks: [
      { key: 'main', title: 'Основное', fields: [{ key: 'q', label: 'Откуда узнали', type: 'text' }] },
      { key: 'who', title: 'Кто вы', fields: [{ key: 'fullName', label: 'ФИО', type: 'text', role: 'fullName' }] }
    ],
    steps: [
      { key: 'first', title: 'Первый', blocks: ['main'] },
      { key: 'late', title: 'Потом', blocks: ['who'], stage: 'after' }
    ]
  });
  assert.ok(errors.some(e => /после согласования/.test(e)), errors.join(' | '));
});

test('шаг «Дозаполнение» без второго этапа в анкете не сохраняется', () => {
  const oneStage = formSchema.validateForm({
    blocks: [{ key: 'main', title: 'Основное', fields: [{ key: 'fullName', label: 'ФИО', type: 'text', role: 'fullName' }] }],
    steps: [{ key: 'about', title: 'О себе', blocks: ['main'] }]
  }).form;

  const process = {
    steps: [
      { key: 'decision', title: 'Решение', kind: 'decision', scope: 'branch', after: [], slaHours: 24, checklist: 'Согласовано' },
      { key: 'extra', title: 'Документы', kind: 'form_extra', scope: 'candidate', after: ['decision'], slaHours: 48, checklist: 'Документы получены' }
    ]
  };

  const bad = processSchema.validateProcess(process, oneStage);
  assert.ok(bad.errors.some(e => /нечего показывать/.test(e)), bad.errors.join(' | '));

  const good = processSchema.validateProcess(process, twoStageForm());
  assert.deepEqual(good.errors, []);
});

test('исполнителя внутри клиники у шага дозаполнения нет', () => {
  // Закрывает его сам кандидат, как и выбор услуг: в список назначений он
  // попадать не должен, иначе «Открыть набор» потребует ему исполнителя.
  const steps = [
    { key: 'decision', title: 'Решение', kind: 'decision', scope: 'branch', after: [] },
    { key: 'extra', title: 'Документы', kind: 'form_extra', scope: 'candidate', after: ['decision'] }
  ];
  assert.deepEqual(processSchema.assignableSteps({ steps }).map(s => s.key), ['decision']);
});
