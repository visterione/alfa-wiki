const test = require('node:test');
const assert = require('node:assert/strict');

const formSchema = require('../services/vacancies/formSchema');
const processSchema = require('../services/vacancies/processSchema');

/**
 * Возврат работы кандидату с шага проверки (ver. 8.38).
 *
 * Юрист смотрит присланные документы и просит переделать — то же, что умеет
 * главврач на решении, но посреди процесса. Проверяются два правила, на которых
 * всё держится: возвращать можно только назад по цепочке, и вместе с шагом
 * откатывается вся выросшая из него ветка.
 */

/** Анкета с двумя этапами — без неё шаг дозаполнения не пройдёт проверку. */
function twoStageForm() {
  const { errors, form } = formSchema.validateForm({
    blocks: [
      { key: 'main', title: 'Основное', fields: [{ key: 'fio', label: 'ФИО', type: 'text', role: 'fullName', required: true }] },
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

/** Цепочка заказчика: решение → документы от кандидата → проверка юристом. */
function chain(extra = {}) {
  return [
    { key: 'decision', title: 'Согласование анкеты', kind: 'decision', after: [], slaHours: 24, checklist: 'Анкета согласована' },
    { key: 'docs', title: 'Дозаполнение анкеты', kind: 'form_extra', after: ['decision'], slaHours: 48, checklist: 'Документы присланы' },
    { key: 'legal', title: 'Проверка документов', kind: 'manual', after: ['docs'], slaHours: 8, checklist: 'Документы проверены', ...extra },
    { key: 'order', title: 'Приказ о приёме', kind: 'manual', after: ['legal'], slaHours: 8, checklist: 'Приказ подписан' }
  ];
}

test('шаг проверки умеет возвращать работу на шаг, от которого зависит', () => {
  const { errors, process } = processSchema.validateProcess(
    { steps: chain({ returnTo: 'docs' }) }, twoStageForm()
  );
  assert.deepEqual(errors, []);
  assert.equal(processSchema.getStep(process, 'legal').returnTo, 'docs');
});

test('вернуть вперёд нельзя: работа оттуда не придёт обратно', () => {
  const { errors } = processSchema.validateProcess(
    { steps: chain({ returnTo: 'order' }) }, twoStageForm()
  );
  assert.ok(errors.some(e => e.includes('не зависит от')), errors.join('; '));
});

test('возвращать умеет только отметка исполнителя', () => {
  const steps = chain();
  steps[1].returnTo = 'decision'; // шаг дозаполнения закрывает кандидат
  const { errors } = processSchema.validateProcess({ steps }, twoStageForm());
  assert.ok(errors.some(e => e.includes('возвращать работу назад умеет только')), errors.join('; '));
});

test('вместе с шагом откатывается вся выросшая из него ветка', () => {
  const { process } = processSchema.validateProcess(
    { steps: chain({ returnTo: 'docs' }) }, twoStageForm()
  );

  // Возврат на 'docs' снимает и проверку, и приказ: они сделаны по документам,
  // которых больше нет.
  const back = processSchema.descendantsOf(process.steps, 'docs');
  assert.deepEqual([...back].sort(), ['legal', 'order']);

  // А решение по анкете остаётся закрытым — оно было раньше.
  assert.ok(!back.has('decision'));
});

test('шаги параллельной ветки возврат не трогает', () => {
  const steps = chain({ returnTo: 'docs' });
  steps.push({ key: 'site', title: 'Карточка на сайте', kind: 'manual', after: ['decision'], slaHours: 40, checklist: 'Карточка опубликована' });

  const { errors, process } = processSchema.validateProcess({ steps }, twoStageForm());
  assert.deepEqual(errors, []);
  assert.ok(!processSchema.descendantsOf(process.steps, 'docs').has('site'));
});
