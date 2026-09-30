'use strict';

/**
 * Выгрузка услуг из веб-МИС (ver. 9.12).
 *
 * С МИС здесь никто не разговаривает — проверяется то, что можно сломать,
 * не заметив: нарезка периода (потерянный день — это недоплаченная зарплата),
 * разбор формы входа (на нём держится вход с кодом) и склейка (разъехавшиеся
 * колонки всплыли бы только в расчёте).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');

const client = require('../services/misWeb/client');
const exporter = require('../services/misWeb/servicesExport');

test('период режется по календарным месяцам без дыр и нахлёстов', () => {
  const ranges = exporter.planRanges('2026-07-15', '2026-09-10');
  assert.deepEqual(ranges, [
    { dateFrom: '2026-07-15', dateTo: '2026-07-31' },
    { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
    { dateFrom: '2026-09-01', dateTo: '2026-09-10' },
  ]);
});

test('месяц внутри одного месяца остаётся одним отрезком', () => {
  assert.deepEqual(exporter.planRanges('2026-02-01', '2026-02-28'), [
    { dateFrom: '2026-02-01', dateTo: '2026-02-28' },
  ]);
});

test('деление пополам покрывает отрезок целиком', () => {
  const [a, b] = exporter.halve({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
  assert.equal(a.dateFrom, '2026-08-01');
  assert.equal(b.dateTo, '2026-08-31');
  // Следующий день после конца первой половины — начало второй.
  const next = new Date(`${a.dateTo}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  assert.equal(next.toISOString().slice(0, 10), b.dateFrom);
});

test('один день пополам не делится', () => {
  assert.equal(exporter.halve({ dateFrom: '2026-08-05', dateTo: '2026-08-05' }), null);
});

test('целый месяц называется по-человечески, остальное — датами', () => {
  assert.equal(exporter.defaultLabel('2026-09-01', '2026-09-30'), 'Сентябрь 2026');
  assert.equal(exporter.defaultLabel('2026-02-01', '2026-02-28'), 'Февраль 2026');
  assert.equal(exporter.defaultLabel('2026-09-01', '2026-09-29'), '01.09.2026 – 29.09.2026');
});

// Снимок настоящей формы входа МИС (токен заменён).
const LOGIN_PAGE = `
<form class="form-horizontal" autocomplete="off" id="login-form" action="/site/login" method="post">
<input type="hidden" value="TOKEN==" name="YII_CSRF_TOKEN" />
  <fieldset>
    <input class="form-control input-lg" autocomplete="newpassword" name="LoginForm[username]" id="LoginForm_username" placeholder="Логин" type="text" />
    <input style="display:none" type="password">
    <input class="form-control input-lg" autocomplete="newpassword" name="LoginForm[password]" id="LoginForm_password" placeholder="Пароль" type="password" />
    <input class="btn btn-success btn-lg btn-block text-center" type="submit" name="yt0" value="Войти" />
  </fieldset>
</form>`;

// Форма кода собрана по записи настоящего входа: те же имена полей.
const CODE_PAGE = `
<form id="login-form" action="/site/login" method="post">
<input type="hidden" value="T2" name="YII_CSRF_TOKEN" />
<input name="LoginForm[code]" id="LoginForm_code" type="text" />
<input type="hidden" value="user" name="LoginForm[username]" />
<input type="hidden" value="p&amp;ss" name="LoginForm[password]" />
<input type="hidden" value="59" name="LoginForm[timeToResendCode]" />
<div class="errorMessage">Код введен неверно, либо истекло время его доступности</div>
<input type="submit" name="yt0" value="Войти" />
</form>`;

test('форма входа: поля отдельно, кнопка отдельно', () => {
  const f = client.parseLoginForm(LOGIN_PAGE);
  assert.deepEqual(f.fields, { YII_CSRF_TOKEN: 'TOKEN==', 'LoginForm[username]': '', 'LoginForm[password]': '' });
  assert.deepEqual(f.submit, { name: 'yt0', value: 'Войти' });
  assert.equal(f.hasCode, false);
});

test('форма кода узнаётся, скрытые поля раскодированы', () => {
  const f = client.parseLoginForm(CODE_PAGE);
  assert.equal(f.hasCode, true);
  assert.equal(f.fields['LoginForm[password]'], 'p&ss');
  assert.equal(f.fields['LoginForm[timeToResendCode]'], '59');
  assert.equal(client.extractLoginError(CODE_PAGE), 'Код введен неверно, либо истекло время его доступности');
});

test('страница без формы входа — не форма', () => {
  assert.equal(client.parseLoginForm('<html><body>Касса</body></html>'), null);
});

test('куки: новые добавляются, стёртые PHP уходят', () => {
  const jar = new client.CookieJar();
  jar.absorb(['PHPSESSID=abc; path=/; HttpOnly', 'YII_CSRF_TOKEN=t1; path=/']);
  jar.absorb('YII_CSRF_TOKEN=deleted; expires=Thu, 01-Jan-1970 00:00:01 GMT');
  assert.deepEqual(jar.toJSON(), { PHPSESSID: 'abc' });
  assert.equal(new client.CookieJar(jar.toJSON()).header(), 'PHPSESSID=abc');
});

test('даты для МИС — дд.мм.гггг', () => {
  assert.equal(client.toMisDate('2026-09-05'), '05.09.2026');
});

async function writeXlsx(file, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Worksheet');
  rows.forEach(r => ws.addRow(r));
  await wb.xlsx.writeFile(file);
}

async function readXlsx(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out = [];
  wb.worksheets[0].eachRow(r => out.push(r.values.slice(1)));
  return out;
}

test('склейка: одна шапка, строки подряд в порядке файлов', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-merge-test-'));
  try {
    const head = ['№ счета', 'Клиника счета', 'Итоговая стоимость'];
    await writeXlsx(path.join(dir, 'a.xlsx'), [head, [1, 'Альфа', 350], [2, 'Альфа', 2150]]);
    await writeXlsx(path.join(dir, 'b.xlsx'), [head]); // клиника без услуг за период
    await writeXlsx(path.join(dir, 'c.xlsx'), [head, [3, '3К', 2800]]);
    const out = path.join(dir, 'out.xlsx');

    const r = await exporter.mergeXlsx(['a', 'b', 'c'].map(n => path.join(dir, `${n}.xlsx`)), out);
    assert.equal(r.rows, 3);
    assert.deepEqual(await readXlsx(out), [head, [1, 'Альфа', 350], [2, 'Альфа', 2150], [3, '3К', 2800]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('склейка отказывается от файлов с разной шапкой', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-merge-test-'));
  try {
    await writeXlsx(path.join(dir, 'a.xlsx'), [['№ счета', 'Сумма'], [1, 10]]);
    await writeXlsx(path.join(dir, 'b.xlsx'), [['Сумма', '№ счета'], [20, 2]]);
    await assert.rejects(
      exporter.mergeXlsx([path.join(dir, 'a.xlsx'), path.join(dir, 'b.xlsx')], path.join(dir, 'out.xlsx')),
      /не совпадает/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
