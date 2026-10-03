'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const iconv = require('iconv-lite');

const {
  parseSpendReport, parsePayments, parsePayerForm, invoiceNumberFrom, CookieJar, ruDate
} = require('../services/imobisCabinet');
const { recommend, weekStart, daysToNextMonday, prevMonthStart } = require('../services/imobisBilling');

// ── Подсказка суммы ───────────────────────────────────────────────────────

test('в понедельник счёт покрывает 11 дней с запасом 20% за вычетом остатка', () => {
  // Неделя до следующего счёта плюс 4 дня, пока бухгалтерия его оплачивает.
  // Четыре дня вместо одиннадцати — ошибка, ради которой формула и записана.
  const r = recommend({ balance: 3000, avgDaily: 1125, today: '2026-09-28' });
  assert.equal(r.horizon, 11);
  assert.equal(r.need, 14850);
  assert.equal(r.amount, 12000); // 11 850, округлено вверх до тысячи
});

test('в четверг горизонт короче — до оплаты понедельничного счёта', () => {
  assert.equal(recommend({ balance: 0, avgDaily: 1000, today: '2026-10-01' }).horizon, 8);
});

test('неоплаченный счёт недели уже в пути и вычитается', () => {
  const r = recommend({ balance: 3000, avgDaily: 1125, unpaid: 12000, today: '2026-09-28' });
  assert.equal(r.amount, 0);
});

test('без расхода или остатка подсказки нет, а не ноль', () => {
  assert.equal(recommend({ balance: 5000, avgDaily: null, today: '2026-09-28' }), null);
  assert.equal(recommend({ balance: null, avgDaily: 900, today: '2026-09-28' }), null);
});

test('неделя начинается с понедельника, и воскресенье — её последний день', () => {
  assert.equal(weekStart('2026-09-28'), '2026-09-28');
  assert.equal(weekStart('2026-10-04'), '2026-09-28');
  assert.equal(daysToNextMonday('2026-10-04'), 1);
  assert.equal(daysToNextMonday('2026-09-28'), 7);
  assert.equal(prevMonthStart('2026-01-15'), '2025-12-01');
});

// ── Краткий отчёт ─────────────────────────────────────────────────────────

const HEAD = 'Логин;"ID операции";"Тип операции";"Название операции";"Сендер SMS/Viber";"Текст SMS/Viber";'
  + '"Время старта";"Время завершения";Страна;Оператор/канал/сервис;"Стоимость, руб";"Тариф, руб.";Кол-во';

test('отчёт складывается по дням, копейки через запятую', () => {
  const csv = [
    HEAD,
    'ns1;1;API/SMPP;"Трафик за 01.09.2026";Alfa;;"01.09.2026 00:00:00";"01.09.2026 23:59:59";Россия;МТС;858,28;9,98;86',
    'ns1;1;API/SMPP;"Трафик за 01.09.2026";Alfa;;"01.09.2026 00:00:00";"01.09.2026 23:59:59";Россия;TELE2;133;9,50;14',
    'ns1;2;API/SMPP;"Трафик за 02.09.2026";Alfa;;"02.09.2026 00:00:00";"02.09.2026 23:59:59";Россия;МТС;10,5;9,98;1'
  ].join('\r\n');
  // Кодировку проверяем по-настоящему: кабинет отдаёт windows-1251.
  const decoded = iconv.decode(iconv.encode(csv, 'win1251'), 'win1251');
  const days = parseSpendReport(decoded);

  assert.deepEqual(Object.keys(days), ['2026-09-01', '2026-09-02']);
  assert.equal(days['2026-09-01'].cost, 991.28);
  assert.equal(days['2026-09-01'].messages, 100);
  assert.deepEqual(days['2026-09-01'].operators['МТС'], { cost: 858.28, messages: 86 });
  assert.equal(days['2026-09-02'].cost, 10.5);
});

test('точка с запятой и кавычки внутри названия рассылки не сдвигают столбцы', () => {
  const csv = [
    HEAD,
    'ns1;3;Рассылка;"Акция; ""осень""";Alfa;"Текст; с точкой";"05.09.2026 10:00:00";"05.09.2026 11:00:00";Россия;МТС;100;10;10'
  ].join('\n');
  assert.equal(parseSpendReport(csv)['2026-09-05'].cost, 100);
});

test('отчёт без нужных столбцов — внятная ошибка, а не пустой график', () => {
  assert.throws(() => parseSpendReport('Логин;Что-то\nns1;1'), /Время старта/);
});

// ── Счета ─────────────────────────────────────────────────────────────────

test('список платежей: номер, дата и статус оплаты', () => {
  const xml = `<content><![CDATA[<table><tr><th>платеж №</th></tr>
    <tr><td width="12%"><a href="/bookkeeping/payments_co?process=stat&number=27B/ns459923">27B/ns459923</span></td>
        <td align="center">2026-09-28</td><td align="center"><b style="color:green;">Оплачен</b></td></tr>
    <tr><td><a href="/bookkeeping/payments_co?process=stat&number=29B/ns459923">29B</a></td>
        <td>2026-10-03</td><td>Не оплачен</td></tr></table>]]></content>`;
  const rows = parsePayments(xml);
  assert.deepEqual(rows.map(r => [r.number, r.date, r.paid]), [
    ['27B/ns459923', '2026-09-28', true],
    ['29B/ns459923', '2026-10-03', false]
  ]);
});

test('форма плательщика: id, имя, почта и умолчания автоплатежа', () => {
  const html = `<select id="payerId" name="payment_payer_id"><option class="payer-status-active" value="24063" offer="1">ООО «Альфа»</option></select>
    <input type="hidden" id="rowpayer-24063-email" value="medcentr-alfa@yandex.ru">
    <input type="number" id="autopayAmount" name="autopay_amount" min="100" value="500.00">
    <input type="text" id="autopayExpireMonth" name="autopay_expire_month" placeholder="ММ" value="10">`;
  const form = parsePayerForm(html);
  assert.deepEqual(form.payers, [{ id: '24063', name: 'ООО «Альфа»', email: 'medcentr-alfa@yandex.ru' }]);
  assert.equal(form.autopayAmount, '500.00');
  assert.equal(form.autopayExpireMonth, '10');
});

test('номер счёта берётся из адреса последнего шага', () => {
  assert.equal(
    invoiceNumberFrom('https://sms.imobis.ru/bookkeeping/payments_co?process=new&step=4&number=28B/ns459923'),
    '28B/ns459923'
  );
  assert.equal(invoiceNumberFrom('https://sms.imobis.ru/bookkeeping/payments_co'), null);
});

test('cookie домена видна поддоменам, хост-онли — только своему хосту', () => {
  // Ровно на этом кабинет и путал аккаунты в браузере: сессия sms.imobis.ru
  // живёт отдельно от auth.imobis.ru.
  const jar = new CookieJar();
  jar.store('sms.imobis.ru', ['PHPSESSID=a; path=/', 'shared=1; Domain=.imobis.ru']);
  assert.equal(jar.header('sms.imobis.ru'), 'PHPSESSID=a; shared=1');
  assert.equal(jar.header('auth.imobis.ru'), 'shared=1');
  jar.store('sms.imobis.ru', ['PHPSESSID=deleted; Max-Age=0']);
  assert.equal(jar.header('sms.imobis.ru'), 'shared=1');
});

test('даты для форм кабинета — ДД.ММ.ГГГГ', () => {
  assert.equal(ruDate('2026-09-01'), '01.09.2026');
});
