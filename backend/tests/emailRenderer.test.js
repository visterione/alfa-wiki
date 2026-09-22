'use strict';

/**
 * Проверки рендерера писем (ver. 8.43).
 *
 * Тесты здесь не про «функция вернула строку», а про конкретные правила, из-за
 * нарушения которых письмо ломается у получателя. Каждое из них уже стоило
 * кому-то рассылки — Outlook без VML показывает кнопку текстом, относительный
 * путь к картинке не видит ни один клиент, а удалённый подвал уносит с собой
 * отписку и вместе с ней доставляемость всего домена.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const renderer = require('../services/emailRenderer');

const doc = (blocks, settings = {}) => ({ version: 1, settings, blocks });

test('письмо собирается таблицами и с обязательными мета-тегами', () => {
  const { html } = renderer.render(doc([{ type: 'text', html: '<p>Привет</p>' }]), { subject: 'Тема' });

  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /role="presentation"/);
  assert.match(html, /x-apple-disable-message-reformatting/);
  // Ghost-таблица для Outlook: без неё письмо в нём разъезжается по ширине окна.
  assert.match(html, /<!--\[if mso\]><table role="presentation" width="600"/);
  assert.match(html, /<title>Тема<\/title>/);
});

test('блок отписки даёт ссылку на подстановку адреса', () => {
  const { html } = renderer.render(doc([{ type: 'unsubscribe', html: '<p>Вы получили это письмо…</p>' }]));
  assert.match(html, /href="\{\{unsubscribe_url\}\}"/);
  assert.match(html, />Отписаться от рассылки<\/a>/);
  assert.match(html, /Вы получили это письмо…/);
});

test('подпись ссылки любая, но пустая подменяется умолчанием', () => {
  const custom = renderer.render(doc([{ type: 'unsubscribe', linkText: 'Больше не присылать' }])).html;
  assert.match(custom, />Больше не присылать<\/a>/);

  // Отписка без текста — это отписка, которую не найдут.
  const empty = renderer.render(doc([{ type: 'unsubscribe', linkText: '   ' }])).html;
  assert.match(empty, />Отписаться от рассылки<\/a>/);
});

test('без блока отписки письмо собирается, но проверка предупреждает', () => {
  // Блок необязателен — так решил отправитель. Запрещать нельзя, промолчать тоже.
  const { html, warnings } = renderer.render(doc([{ type: 'text', html: '<p>Текст</p>' }]));
  assert.doesNotMatch(html, /unsubscribe_url/);
  assert.ok(warnings.some(w => w.includes('нет блока отписки')));
});

test('блок отписки оформляется как остальные', () => {
  const { html } = renderer.render(doc([{
    type: 'unsubscribe',
    html: '<p>МЦ «Альфа Линия»</p>',
    linkText: 'Отписаться',
    color: '#FFFFFF',
    linkColor: '#64D2FF',
    fontSize: 11,
    align: 'left',
    background: '#1C1C1E',
  }]));

  assert.match(html, /bgcolor="#1C1C1E"/);
  assert.match(html, /color:#FFFFFF/);
  assert.match(html, /color:#64D2FF/);
  assert.match(html, /font-size:11px/);
  assert.match(html, /text-align:left/);
});

test('картинка получает абсолютный адрес, ширину атрибутом и display:block', () => {
  const { html } = renderer.render(
    doc([{ type: 'image', src: '/uploads/2026-09/promo.png', alt: 'Акция', width: 100 }]),
    { baseUrl: 'https://wiki.example.ru' }
  );

  assert.match(html, /src="https:\/\/wiki\.example\.ru\/uploads\/2026-09\/promo\.png"/);
  assert.match(html, /width="552"/);           // 600 минус боковые поля карточки
  assert.match(html, /display:block/);
  assert.match(html, /alt="Акция"/);
});

test('кнопка едет с VML-дублем для Outlook и обычной ссылкой для остальных', () => {
  const { html } = renderer.render(doc([
    { type: 'button', text: 'Записаться', href: 'https://alfa.ru/zapis' }
  ]));

  assert.match(html, /<!--\[if mso\]><v:roundrect/);
  assert.match(html, /<!--\[if !mso\]><!--><a href="https:\/\/alfa\.ru\/zapis"/);
  assert.match(html, /Записаться/);
});

test('опасные ссылки не доезжают до письма', () => {
  const { html } = renderer.render(doc([
    { type: 'button', text: 'Жми', href: 'javascript:alert(1)' },
    { type: 'image', src: '/uploads/a.png', href: 'data:text/html,<script>' }
  ]));

  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /data:text\/html/i);
});

test('адрес без схемы дополняется до https, а не выбрасывается', () => {
  assert.equal(renderer.safeUrl('alfa-clinic.ru/akcii'), 'https://alfa-clinic.ru/akcii');
  assert.equal(renderer.safeUrl('   '), '');
  assert.equal(renderer.safeUrl('{{unsubscribe_url}}'), '{{unsubscribe_url}}');
});

test('разметка текста чистится по белому списку', () => {
  const { html } = renderer.render(doc([{
    type: 'text',
    html: '<p>Текст<script>alert(1)</script></p><iframe src="x"></iframe><p onclick="hack()">Ещё</p>'
  }]));

  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<iframe/i);
  assert.doesNotMatch(html, /onclick/i);
  assert.match(html, /Текст/);
  assert.match(html, /Ещё/);
});

test('ссылка в тексте получает фирменный цвет инлайном', () => {
  const { html } = renderer.render(doc(
    [{ type: 'text', html: '<p><a href="https://alfa.ru">тут</a></p>' }],
    { linkColor: '#FF3B30' }
  ));
  assert.match(html, /color:#FF3B30;text-decoration:underline/);
});

test('колонки складываются в столбик на телефоне и делят ширину по долям', () => {
  const { html } = renderer.render(doc([{
    type: 'columns',
    gap: 16,
    // Поля были у блока «Колонки» первой версии — после переноса в секцию они
    // становятся полями секции, и ширина колонок остаётся прежней.
    padding: { top: 8, right: 24, bottom: 8, left: 24 },
    columns: [
      { width: 50, blocks: [{ type: 'text', html: '<p>Слева</p>' }] },
      { width: 50, blocks: [{ type: 'text', html: '<p>Справа</p>' }] }
    ]
  }]));

  // 600 минус боковые поля секции (48), минус промежуток (16), пополам
  assert.match(html, /class="aw-col[^"]*" width="268"/);
  assert.match(html, /\.aw-col \{ display:block !important/);
  assert.match(html, /Слева/);
  assert.match(html, /Справа/);
});

test('неизвестный тип блока молча пропускается, а не валит письмо', () => {
  const { html } = renderer.render(doc([
    { type: 'карусель-3d', foo: 1 },
    { type: 'text', html: '<p>Живой блок</p>' }
  ]));
  assert.match(html, /Живой блок/);
});

test('замечания называют пустое превью, картинку без alt и отсутствие отправителя', () => {
  const { warnings } = renderer.render(doc([
    { type: 'image', src: '/uploads/a.png' }
  ]));

  assert.ok(warnings.some(w => w.includes('превью')));
  assert.ok(warnings.some(w => w.includes('alt')));
  assert.ok(warnings.some(w => w.includes('нет блока отписки')));
});

test('заполненные настройки снимают соответствующие замечания', () => {
  const { warnings } = renderer.render(
    doc(
      [{ type: 'text', html: '<p>Текст</p>' }, { type: 'unsubscribe' }],
      { preheader: 'Скидка 20% на анализы' }
    ),
    { subject: 'Скидка 20%' }
  );

  assert.deepEqual(warnings, []);
});

test('перевес письма замечается до отправки, а не после', () => {
  const heavy = doc([{ type: 'html', code: 'х'.repeat(120 * 1024) }]);
  const { warnings } = renderer.render(heavy);
  assert.ok(warnings.some(w => w.includes('102 КБ')));
});

test('в письмо подставляется только адрес отписки', () => {
  const html = '<p>Текст <a href="{{unsubscribe_url}}">выход</a></p>';
  const out = renderer.personalize(html, {
    unsubscribe_url: 'https://wiki.example.ru/api/email-optout/abc.def',
  });
  assert.match(out, /href="https:\/\/wiki\.example\.ru\/api\/email-optout\/abc\.def"/);
});

test('фигурные скобки в тексте письма остаются текстом', () => {
  // Персонализацию убрали, поэтому {{что-то}} — это то, что написал человек, а
  // не подстановка. Съедать его нельзя: раньше оно молча превращалось в пустоту.
  const out = renderer.personalize(
    '<p>Скидка {{20}}% и {{name}}</p>',
    { unsubscribe_url: '#' },
  );
  assert.match(out, /\{\{name\}\}/);
});


// ── Фирменные блоки и метки перехода (ver. 8.43) ───────────────────────

test('карточка акции собирает картинку, цену и кнопку в один блок', () => {
  const { html } = renderer.render(doc([{
    type: 'promo',
    src: '/uploads/promo.jpg',
    title: 'Скидка на УЗИ',
    text: 'До конца месяца',
    oldPrice: '2 400 ₽',
    price: '1 900 ₽',
    buttonText: 'Записаться',
    buttonHref: 'https://alfa.ru/uzi',
  }]), { baseUrl: 'https://wiki.example.ru' });

  assert.match(html, /Скидка на УЗИ/);
  assert.match(html, /<s>2 400 ₽<\/s>/);
  assert.match(html, /1 900 ₽/);
  assert.match(html, /https:\/\/alfa\.ru\/uzi/);
  assert.match(html, /src="https:\/\/wiki\.example\.ru\/uploads\/promo\.jpg"/);
});

test('список услуг держит цену в своей колонке и не складывается на телефоне', () => {
  const { html } = renderer.render(doc([{
    type: 'services',
    items: [
      { name: 'Приём терапевта', note: 'первичный', price: '1 200 ₽' },
      { name: 'Общий анализ крови', price: '450 ₽' },
    ],
  }]));

  assert.match(html, /Приём терапевта/);
  assert.match(html, /первичный/);
  // Ширина ячейки цены задана числом, класса для складывания у неё нет: класс
  // aw-col есть у колонок секции, но не у ячеек внутри самого блока.
  assert.match(html, /width="110"/);
  const table = html.slice(html.indexOf('Приём терапевта') - 400, html.indexOf('450 ₽'));
  assert.doesNotMatch(table, /class="aw-col"/);
});

test('соцсети едут надписями, а не картинками', () => {
  const { html } = renderer.render(doc([{
    type: 'social',
    items: [
      { network: 'telegram', href: 'https://t.me/alfa' },
      { network: 'vk', href: 'https://vk.com/alfa' },
      { network: 'whatsapp', href: '' },
    ],
  }]));

  assert.match(html, /Telegram/);
  assert.match(html, /ВКонтакте/);
  // Пустая ссылка выбрасывается, а не рисуется мёртвой плашкой.
  assert.doesNotMatch(html, /WhatsApp/);
  assert.doesNotMatch(html, /<img/);
});

test('телефон в контактах кликабелен, а из номера вычищается всё лишнее', () => {
  const { html } = renderer.render(doc([{
    type: 'contacts',
    address: 'Курск, ул. Ленина, 1',
    phone: '+7 (4712) 77-77-77',
    hours: 'Пн–Сб, 8:00–20:00',
  }]));

  assert.match(html, /href="tel:\+74712777777"/);
  assert.match(html, /Пн–Сб, 8:00–20:00/);
});

test('метки перехода навешиваются на кнопки, ссылки в тексте и соцсети', () => {
  const { html } = renderer.render(doc(
    [
      { type: 'button', text: 'Записаться', href: 'https://alfa.ru/zapis' },
      { type: 'text', html: '<p><a href="https://alfa.ru/price">цены</a></p>' },
      { type: 'social', items: [{ network: 'telegram', href: 'https://t.me/alfa' }] },
    ],
    { utm: { source: 'email', medium: 'newsletter', campaign: 'sentyabr' } }
  ));

  // Амперсанд в href пишется сущностью — это требование HTML, а не оплошность:
  // почтовые клиенты разбирают &amp; обратно в &.
  assert.match(html, /alfa\.ru\/zapis\?utm_source=email&amp;utm_medium=newsletter&amp;utm_campaign=sentyabr/);
  assert.match(html, /alfa\.ru\/price\?utm_source=email/);
  assert.match(html, /t\.me\/alfa\?utm_source=email/);
});

test('метки не портят адрес отписки, mailto и уже размеченные ссылки', () => {
  const { html } = renderer.render(doc(
    [
      { type: 'button', text: 'Своя метка', href: 'https://alfa.ru/a?utm_source=vk' },
      { type: 'button', text: 'Почта', href: 'mailto:info@alfa.ru' },
    ],
    { utm: { source: 'email' } }
  ));

  assert.match(html, /alfa\.ru\/a\?utm_source=vk"/);
  assert.match(html, /mailto:info@alfa\.ru"/);
  // Адрес отписки метку не получает: она бы уехала внутрь токена.
  const un = renderer.render(doc([{ type: 'unsubscribe' }], { utm: { source: 'email' } })).html;
  assert.match(un, /href="\{\{unsubscribe_url\}\}"/);
});

test('якорь остаётся в конце адреса, а не тонет между метками', () => {
  const { html } = renderer.render(doc(
    [{ type: 'button', text: 'К ценам', href: 'https://alfa.ru/price#uzi' }],
    { utm: { source: 'email' } }
  ));
  assert.match(html, /alfa\.ru\/price\?utm_source=email#uzi/);
});

test('замечания ловят http, кнопку без ссылки и пустую тему', () => {
  const { warnings } = renderer.render(doc([
    { type: 'button', text: 'Жми', href: '' },
    { type: 'promo', title: 'Акция', buttonText: 'Купить', buttonHref: '' },
    { type: 'text', html: '<p><a href="http://alfa.ru">небезопасно</a></p>' },
  ]));

  assert.ok(warnings.some(w => w.includes('Кнопок без ссылки: 2')));
  assert.ok(warnings.some(w => w.includes('http')));
  assert.ok(warnings.some(w => w.includes('тема')));
});

// ── Дизайнерские возможности (ver. 8.43) ────────────────────────────────────

test('градиент фона едет с запасным сплошным цветом для Outlook', () => {
  const { html } = renderer.render(doc([{
    type: 'text',
    html: '<p>Текст</p>',
    background: '#0A84FF',
    gradient: { from: '#0A84FF', to: '#5856D6', angle: 135 },
  }]));

  assert.match(html, /bgcolor="#0A84FF"/);
  assert.match(html, /background-image:linear-gradient\(135deg, #0A84FF 0%, #5856D6 100%\)/);
  // Сплошной цвет объявлен ДО градиента: клиент, не знающий второго свойства,
  // остаётся на первом, а не показывает прозрачную дыру.
  assert.ok(html.indexOf('background:#0A84FF') < html.indexOf('background-image:linear-gradient'));
});

test('кнопка с градиентом получает настоящую заливку и в Outlook', () => {
  const { html } = renderer.render(doc([{
    type: 'button',
    text: 'Записаться',
    href: 'https://alfa.ru',
    bg: '#0A84FF',
    gradient: { from: '#0A84FF', to: '#5856D6', angle: 90 },
  }]));

  // CSS 90° (слева направо) — это VML 270°.
  assert.match(html, /<v:fill type="gradient" color="#0A84FF" color2="#5856D6" angle="270"\/>/);
  assert.match(html, /linear-gradient\(90deg/);
});

test('карточка оборачивает блок, а не растягивает рамку на всё письмо', () => {
  const { html } = renderer.render(doc([{
    type: 'text',
    html: '<p>В рамке</p>',
    background: '#F2F2F7',
    card: { background: '#FFFFFF', radius: 16, borderWidth: 1, borderColor: '#E5E5EA', shadow: true, padding: 20 },
  }]));

  assert.match(html, /border-radius:16px/);
  assert.match(html, /border:1px solid #E5E5EA/);
  assert.match(html, /box-shadow/);
  // Полоса во всю ширину остаётся на ячейке блока, карточка живёт внутри неё.
  assert.match(html, /bgcolor="#F2F2F7"/);
});

test('баннер держится на трёх способах сразу и знает свою высоту', () => {
  const { html } = renderer.render(doc([{
    type: 'hero',
    src: '/uploads/hero.jpg',
    height: 300,
    title: 'Открыли новый центр',
    buttonText: 'Записаться',
    buttonHref: 'https://alfa.ru',
  }]), { baseUrl: 'https://wiki.example.ru' });

  assert.match(html, /background="https:\/\/wiki\.example\.ru\/uploads\/hero\.jpg"/);
  assert.match(html, /background-image:linear-gradient\(rgba\(0,0,0,0\.35\), rgba\(0,0,0,0\.35\)\), url\('https:\/\/wiki\.example\.ru\/uploads\/hero\.jpg'\)/);
  assert.match(html, /<v:fill type="frame" src="https:\/\/wiki\.example\.ru\/uploads\/hero\.jpg"/);
  assert.match(html, /height:300px/);
  // Прямоугольник для Outlook шириной ровно с полосу под баннером: у блока
  // здесь свои боковые поля по 24px, значит 600 − 48. Пока тут было «плюс 48»
  // от старой общей карточки, прямоугольник вылезал за письмо.
  assert.match(html, /<v:rect[^>]*style="width:552px;height:300px;"/);
});

test('затемнение баннера лежит слоем в фоне, а не внутри ячейки', () => {
  // Слой внутри занял бы высоту текста, и сверху с фотографией осталась бы
  // светлая полоса — ровно это и было видно на первом же собранном письме.
  const { html } = renderer.render(doc([{ type: 'hero', src: '/uploads/h.jpg', overlay: 0, title: 'Без затемнения' }]));
  assert.doesNotMatch(html, /rgba\(0,0,0/);
});

test('градиент кнопки не заливает полосу блока за ней', () => {
  const { html } = renderer.render(doc([{
    type: 'button', text: 'Жми', href: 'https://alfa.ru',
    gradient: { from: '#0A84FF', to: '#5856D6', angle: 90 },
  }]));

  // Градиент должен встретиться только внутри кнопки: в CSS-заливке ссылки и в
  // VML-дубле. Ячейка блока остаётся без фона.
  const cellStart = html.indexOf('<tr><td align="center"');
  const cell = html.slice(cellStart, cellStart + 120);
  assert.doesNotMatch(cell, /linear-gradient/);
  assert.match(html, /linear-gradient\(90deg/);
});

test('обтекание задаётся align, а на телефоне снимается медиазапросом', () => {
  const { html } = renderer.render(doc([{
    type: 'textimage',
    src: '/uploads/doc.jpg',
    alt: 'Врач',
    side: 'right',
    imageWidth: 180,
    html: '<p>Текст вокруг картинки.</p>',
  }]), { baseUrl: 'https://wiki.example.ru' });

  assert.match(html, /align="right"/);
  assert.match(html, /float:right/);
  assert.match(html, /class="aw-wrap-img"/);
  assert.match(html, /\.aw-wrap-img \{ float:none !important/);
  // Распорка в конце, иначе следующий блок заползёт под картинку.
  assert.match(html, /clear:both/);
});

test('пункты с иконками работают на эмодзи без единой картинки', () => {
  const { html } = renderer.render(doc([{
    type: 'iconlist',
    items: [
      { emoji: '🩺', title: 'Приём без очереди', text: 'По предварительной записи' },
      { emoji: '🧪', title: 'Анализы за сутки' },
    ],
  }]));

  assert.match(html, /🩺/);
  assert.match(html, /Приём без очереди/);
  assert.match(html, /Анализы за сутки/);
  assert.doesNotMatch(html, /<img/);
});

test('иконка-картинка вытесняет эмодзи, а сам эмодзи уезжает в alt', () => {
  const { html } = renderer.render(doc([{
    type: 'iconlist',
    items: [{ emoji: '🩺', image: '/uploads/icon.png', title: 'Приём' }],
  }]), { baseUrl: 'https://wiki.example.ru' });

  assert.match(html, /src="https:\/\/wiki\.example\.ru\/uploads\/icon\.png"/);
  // Эмодзи остаётся запасным знаком: с выключенными картинками почта покажет
  // на месте иконки именно его, а не пустое место.
  assert.match(html, /alt="🩺"/);
  assert.doesNotMatch(html, /line-height:1;">🩺/);
});

test('плашка со скидкой стоит над заголовком, а не поверх картинки', () => {
  const { html } = renderer.render(doc([{
    type: 'promo', badge: '−20%', title: 'УЗИ', price: '1 900 ₽',
  }]));

  assert.match(html, /−20%/);
  assert.match(html, /border-radius:999px/);
  assert.ok(html.indexOf('−20%') < html.indexOf('УЗИ'));
});

test('круглая картинка это скругление в половину ширины', () => {
  const { html } = renderer.render(doc([{
    type: 'image', src: '/uploads/avatar.jpg', width: 50, shape: 'circle', alt: 'Врач',
  }]));
  // 552 ширины содержимого, половина от 50% — 138.
  assert.match(html, /border-radius:138px/);
});

// ── Сложные градиенты (ver. 8.43) ───────────────────────────────────────────

test('градиент из трёх точек с прозрачностью собирается в rgba', () => {
  const { html } = renderer.render(doc([{
    type: 'text',
    html: '<p>Текст</p>',
    gradient: {
      type: 'linear',
      angle: 45,
      stops: [
        { color: '#FF3B30', at: 0 },
        { color: '#FFCC00', at: 50, alpha: 60 },
        { color: '#34C759', at: 100 },
      ],
    },
  }]));

  assert.match(html, /linear-gradient\(45deg, #FF3B30 0%, rgba\(255, 204, 0, 0\.60\) 50%, #34C759 100%\)/);
  // Запасного сплошного цвета у градиента с прозрачностью быть не должно: он
  // лёг бы ПОД градиентом и закрыл собой фон письма в прозрачных местах.
  assert.doesNotMatch(html, /bgcolor="#FF3B30"/);
});

test('явно заданный фон остаётся даже под прозрачным градиентом', () => {
  // Выведенный цвет мы не красим сами, но выбор человека — это выбор человека.
  const { html } = renderer.render(doc([{
    type: 'text', html: '<p>а</p>',
    background: '#000000',
    gradient: { stops: [{ color: '#FFFFFF', at: 0, alpha: 0 }, { color: '#FFFFFF', at: 100 }] },
  }]));
  assert.match(html, /bgcolor="#000000"/);
});

test('градиент без прозрачности по-прежнему получает запасной цвет', () => {
  const { html } = renderer.render(doc([{
    type: 'text', html: '<p>а</p>',
    gradient: { stops: [{ color: '#FF3B30', at: 0 }, { color: '#34C759', at: 100 }] },
  }]));
  assert.match(html, /bgcolor="#FF3B30"/);
});

test('точки сортируются по положению, а не по порядку набора', () => {
  const { html } = renderer.render(doc([{
    type: 'text',
    html: '<p>Текст</p>',
    gradient: { stops: [{ color: '#111111', at: 80 }, { color: '#222222', at: 10 }] },
  }]));
  assert.match(html, /#222222 10%, #111111 80%/);
});

test('радиальный и конический градиенты собираются своим синтаксисом', () => {
  const radial = renderer.render(doc([{
    type: 'text', html: '<p>а</p>',
    gradient: { type: 'radial', shape: 'circle', position: 'top left', stops: [{ color: '#FFF', at: 0 }, { color: '#000', at: 100 }] },
  }])).html;
  assert.match(radial, /radial-gradient\(circle at top left, #FFF 0%, #000 100%\)/);

  const conic = renderer.render(doc([{
    type: 'text', html: '<p>а</p>',
    gradient: { type: 'conic', angle: 90, stops: [{ color: '#FFF', at: 0 }, { color: '#000', at: 100 }] },
  }])).html;
  assert.match(conic, /conic-gradient\(from 90deg at center, #FFF 0%, #000 100%\)/);
});

test('чужое значение позиции не утекает в CSS', () => {
  const { html } = renderer.render(doc([{
    type: 'text', html: '<p>а</p>',
    gradient: { type: 'radial', position: 'javascript:alert(1)', stops: [{ color: '#FFF', at: 0 }, { color: '#000', at: 100 }] },
  }]));
  assert.doesNotMatch(html, /javascript/i);
  assert.match(html, /radial-gradient\(ellipse at center/);
});

test('старая запись градиента из двух цветов продолжает работать', () => {
  const { html } = renderer.render(doc([{
    type: 'text', html: '<p>а</p>',
    gradient: { from: '#0A84FF', to: '#5856D6', angle: 135 },
  }]));
  assert.match(html, /linear-gradient\(135deg, #0A84FF 0%, #5856D6 100%\)/);
});

test('кнопка с многоточечным градиентом везёт промежуточные точки и в Outlook', () => {
  const { html } = renderer.render(doc([{
    type: 'button', text: 'Жми', href: 'https://alfa.ru',
    gradient: { angle: 90, stops: [{ color: '#FF3B30', at: 0 }, { color: '#FFCC00', at: 40 }, { color: '#34C759', at: 100 }] },
  }]));

  assert.match(html, /<v:fill type="gradient" color="#FF3B30" color2="#34C759" colors="40% #FFCC00" angle="270"\/>/);
  assert.match(html, /linear-gradient\(90deg/);
});

test('кнопка без своего цвета берёт подложку из первой точки градиента', () => {
  const { html } = renderer.render(doc([{
    type: 'button', text: 'Жми', href: 'https://alfa.ru',
    gradient: { stops: [{ color: '#FF3B30', at: 0 }, { color: '#34C759', at: 100 }] },
  }]));
  assert.match(html, /bgcolor="#FF3B30"/);
});

test('градиент буквами живёт классом в шапке, а инлайном остаётся обычный цвет', () => {
  const { html } = renderer.render(doc([{
    type: 'text',
    html: '<p>Заголовок</p>',
    textGradient: { stops: [{ color: '#FF3B30', at: 0 }, { color: '#5856D6', at: 100 }] },
  }]));

  // Правило в <style>: клиент, вырезающий его целиком, останется на цвете.
  assert.match(html, /\.aw-gt1\{background-image:linear-gradient/);
  assert.match(html, /-webkit-text-fill-color:transparent/);
  assert.match(html, /<div class="aw-gt1"[^>]*color:#FF3B30/);
  // Связка не должна оказаться в инлайновом стиле — разорвать её там нельзя.
  assert.doesNotMatch(html, /style="[^"]*background-clip/);
});

test('градиент фона и градиент букв у одного блока не мешают друг другу', () => {
  const { html } = renderer.render(doc([{
    type: 'text',
    html: '<p>а</p>',
    gradient: { stops: [{ color: '#000000', at: 0 }, { color: '#111111', at: 100 }] },
    textGradient: { stops: [{ color: '#FF3B30', at: 0 }, { color: '#FFCC00', at: 100 }] },
  }]));

  assert.match(html, /bgcolor="#000000"/);
  assert.match(html, /\.aw-gt1\{background-image:linear-gradient\(135deg, #FF3B30 0%, #FFCC00 100%\)/);
});

test('разделитель может растворяться к краям', () => {
  const { html } = renderer.render(doc([{
    type: 'divider', thickness: 2,
    gradient: { angle: 90, stops: [{ color: '#E5E5EA', at: 0, alpha: 0 }, { color: '#E5E5EA', at: 50 }, { color: '#E5E5EA', at: 100, alpha: 0 }] },
  }]));

  assert.match(html, /rgba\(229, 229, 234, 0\.00\) 0%/);
  assert.match(html, /height:2px/);
});

test('затемнение баннера умеет растворяться снизу вверх', () => {
  const { html } = renderer.render(doc([{
    type: 'hero', src: '/uploads/h.jpg', overlay: 60, overlayStyle: 'bottom', title: 'Заголовок',
  }]));
  assert.match(html, /linear-gradient\(to bottom, rgba\(0,0,0,0\) 0%, rgba\(0,0,0,0\.60\) 100%\)/);
});

// ── Шрифты (ver. 8.43) ──────────────────────────────────────────────────────

test('шрифт письма разворачивается в стек, а не в одно имя', () => {
  const { html } = renderer.render(doc([{ type: 'text', html: '<p>Текст</p>' }], { font: 'georgia' }));
  assert.match(html, /font-family:Georgia, 'Times New Roman', serif/);
});

test('шрифт блока перекрывает шрифт письма', () => {
  const { html } = renderer.render(doc(
    [
      { type: 'text', html: '<p>Как в письме</p>' },
      { type: 'text', html: '<p>Свой</p>', font: 'courier' },
    ],
    { font: 'arial' }
  ));

  assert.match(html, /font-family:Arial, Helvetica, sans-serif/);
  assert.match(html, /font-family:'Courier New', Courier, monospace/);
});

test('веб-шрифт подключается двумя способами и спрятан от Outlook', () => {
  const { html } = renderer.render(doc([{ type: 'text', html: '<p>а</p>', font: 'montserrat' }]));

  assert.match(html, /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Montserrat:wght@400;700&display=swap"/);
  assert.match(html, /@import url\('https:\/\/fonts\.googleapis\.com/);
  // Word спотыкается о внешние шрифты, поэтому оба способа за условием.
  assert.match(html, /<!--\[if !mso\]><!-->\n<link href="https:\/\/fonts\.googleapis/);
  assert.match(html, /font-family:'Montserrat', 'Trebuchet MS', Arial, sans-serif/);
});

test('подключаются только те веб-шрифты, что реально встретились', () => {
  const { html } = renderer.render(doc([{ type: 'text', html: '<p>а</p>', font: 'arial' }], { font: 'georgia' }));
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
});

test('два разных веб-шрифта едут одной ссылкой', () => {
  const { html } = renderer.render(doc([
    { type: 'text', html: '<p>а</p>', font: 'montserrat' },
    { type: 'text', html: '<p>б</p>', font: 'lato' },
    { type: 'text', html: '<p>в</p>', font: 'montserrat' },
  ]));

  const links = html.match(/fonts\.googleapis\.com\/css2\?[^"']+/g) || [];
  assert.equal(new Set(links).size, 1);
  assert.match(links[0], /family=Montserrat:wght@400;700&family=Lato:wght@400;700/);
});

test('про веб-шрифт предупреждают заранее, а не после рассылки', () => {
  const { warnings } = renderer.render(doc([{ type: 'text', html: '<p>а</p>', font: 'playfair' }]));
  assert.ok(warnings.some(w => w.includes('Playfair Display') && w.includes('Gmail')));
});

test('незнакомый шрифт не оставляет блок без шрифта вовсе', () => {
  const { html } = renderer.render(doc([{ type: 'text', html: '<p>а</p>', font: 'comic-sans-из-2003' }]));
  assert.match(html, /font-family:-apple-system/);
});

// ── Секции: письмо → секция → колонка → блок (ver. 8.43) ────────────────────

const sectioned = (sections, settings = {}) => ({ version: 2, settings, sections });

test('секция красит полосу во всю ширину, а содержимое держит в своих 600px', () => {
  const { html } = renderer.render(sectioned([{
    background: '#0B3D91',
    innerBackground: '#FFFFFF',
    columns: [{ width: 100, blocks: [{ type: 'text', html: '<p>Текст</p>' }] }],
  }]));

  // Полоса — таблица на 100% ширины окна почты.
  assert.match(html, /<table role="presentation" width="100%"[^>]*bgcolor="#0B3D91"/);
  // Контейнер внутри неё — те же 600px, что и раньше.
  assert.match(html, /class="aw-card" width="600"[^>]*bgcolor="#FFFFFF"/);
});

test('у секции два фона и они не мешают друг другу', () => {
  const { html } = renderer.render(sectioned([{
    gradient: { stops: [{ color: '#000000', at: 0 }, { color: '#333333', at: 100 }] },
    innerGradient: { stops: [{ color: '#FFFFFF', at: 0 }, { color: '#F2F2F7', at: 100 }] },
    columns: [{ width: 100, blocks: [] }],
  }]));

  assert.match(html, /linear-gradient\(135deg, #000000 0%, #333333 100%\)/);
  assert.match(html, /linear-gradient\(135deg, #FFFFFF 0%, #F2F2F7 100%\)/);
});

test('колонки секции делят ширину по долям и складываются на телефоне', () => {
  const { html } = renderer.render(sectioned([{
    gap: 20,
    columns: [
      { width: 33, blocks: [{ type: 'text', html: '<p>Узкая</p>' }] },
      { width: 67, blocks: [{ type: 'text', html: '<p>Широкая</p>' }] },
    ],
  }]));

  // 600 минус промежуток 20 = 580; 33 и 67 от него.
  assert.match(html, /class="aw-col[^"]*" width="191"/);
  assert.match(html, /class="aw-col[^"]*" width="388"/);
  assert.match(html, /class="aw-gap" width="20"/);
});

test('у колонки может быть свой фон и свои поля', () => {
  const { html } = renderer.render(sectioned([{
    columns: [
      { width: 50, background: '#FF3B30', padding: { top: 10, right: 10, bottom: 10, left: 10 }, blocks: [] },
      { width: 50, blocks: [] },
    ],
  }]));

  assert.match(html, /class="aw-col[^"]*"[^>]*bgcolor="#FF3B30"[^>]*padding:10px 10px 10px 10px/);
});

test('скругление достаётся внешним углам письма, а не каждой секции', () => {
  const { html } = renderer.render(sectioned([
    { columns: [{ width: 100, blocks: [] }] },
    { columns: [{ width: 100, blocks: [] }] },
    { columns: [{ width: 100, blocks: [] }] },
  ], { radius: 16 }));

  const containers = html.match(/class="aw-card" width="600"[^>]*style="[^"]*"/g) || [];
  assert.match(containers[0], /border-radius:16px 16px 0 0/);
  assert.match(containers[1], /border-radius:0 0 0 0/);
  assert.match(containers[2], /border-radius:0 0 16px 16px/);
});

test('документ первой версии открывается и выглядит как прежде', () => {
  const v1 = {
    version: 1,
    settings: {},
    blocks: [
      { type: 'text', html: '<p>Первый</p>' },
      { type: 'columns', gap: 16, padding: { top: 8, right: 24, bottom: 8, left: 24 }, columns: [
        { width: 50, blocks: [{ type: 'text', html: '<p>Л</p>' }] },
        { width: 50, blocks: [{ type: 'text', html: '<p>П</p>' }] },
      ] },
    ],
  };

  const migrated = renderer.toV2(v1);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.sections.length, 2);
  // Обычный блок оборачивается в секцию нулевой толщины — вид не меняется.
  assert.deepEqual(migrated.sections[0].padding, { top: 0, right: 0, bottom: 0, left: 0 });
  assert.equal(migrated.sections[0].columns[0].blocks[0].type, 'text');
  // Блок «Колонки» становится секцией с теми же колонками и теми же полями.
  assert.equal(migrated.sections[1].columns.length, 2);
  assert.deepEqual(migrated.sections[1].padding, { top: 8, right: 24, bottom: 8, left: 24 });

  const { html } = renderer.render(v1);
  assert.match(html, /Первый/);
  assert.match(html, /class="aw-col[^"]*" width="268"/);
});

test('повторный перевод документа во вторую версию ничего не ломает', () => {
  const once = renderer.toV2({ blocks: [{ type: 'text', html: '<p>а</p>' }] });
  const twice = renderer.toV2(once);
  assert.deepEqual(twice.sections, once.sections);
});

test('блок отписки встаёт туда, куда его поставили, а не в конец письма', () => {
  // Теперь это обычный блок: его место определяет макет, а не рендерер.
  const { html } = renderer.render(sectioned([
    { columns: [{ width: 100, blocks: [{ type: 'unsubscribe' }] }] },
    { background: '#000000', columns: [{ width: 100, blocks: [{ type: 'text', html: '<p>После</p>' }] }] },
  ]));
  assert.ok(html.indexOf('{{unsubscribe_url}}') < html.indexOf('bgcolor="#000000"'));
});

test('блок на тёмной полосе умеет свой цвет текста', () => {
  const { html } = renderer.render(sectioned([{
    background: '#1C1C1E',
    innerBackground: '',
    columns: [{ width: 100, blocks: [
      { type: 'contacts', address: 'Курск, Ленина, 1', phone: '+7 900 000-00-00', color: '#FFFFFF', linkColor: '#64D2FF' },
      { type: 'iconlist', color: '#FFFFFF', mutedColor: '#AEAEB2', items: [{ emoji: '✅', title: 'Заголовок', text: 'Пояснение' }] },
    ] }],
  }]));

  assert.match(html, /color:#FFFFFF;text-align:center/);
  assert.match(html, /color:#64D2FF;text-decoration:none;font-weight:600/);
  assert.match(html, /color:#AEAEB2/);
  // Общий тёмный цвет текста письма в этих блоках больше не участвует: он
  // остаётся только фоном полосы. Проверяем именно «color:», а не вхождение
  // цвета вообще — фоном он встречается дважды, атрибутом и стилем.
  assert.doesNotMatch(html, /color:#1C1C1E/);
});

// ── Сохранённые модули (ver. 8.43) ──────────────────────────────────────────

test('модуль-секция собирается в письмо как есть', () => {
  // Так маршрут сохранения проверяет модуль перед записью в базу: кусок,
  // который не рендерится, не должен попасть в чужое письмо через месяц.
  const section = {
    background: '#1C1C1E',
    columns: [{ width: 100, blocks: [
      { type: 'contacts', address: 'Курск, Ленина, 1', color: '#FFFFFF' },
    ] }],
  };
  const { html } = renderer.render({ version: 2, settings: {}, sections: [section] }, { subject: 'Проверка модуля' });
  assert.match(html, /Курск, Ленина, 1/);
  assert.match(html, /bgcolor="#1C1C1E"/);
});

test('модуль-блок оборачивается в секцию и тоже собирается', () => {
  const block = { type: 'button', text: 'Записаться', href: 'https://alfa.ru' };
  const { html } = renderer.render(
    { version: 2, settings: {}, sections: [{ columns: [{ width: 100, blocks: [block] }] }] },
    { subject: 'Проверка модуля' },
  );
  assert.match(html, /Записаться/);
  assert.match(html, /https:\/\/alfa\.ru/);
});

test('испорченный модуль не валит рендер, а просто ничего не рисует', () => {
  // Маршрут ловит исключение; но даже если payload окажется мусором, письмо
  // должно собраться — иначе одна плохая запись в базе ломает весь раздел.
  const { html } = renderer.render(
    { version: 2, settings: {}, sections: [{ columns: [{ width: 100, blocks: [{ type: 'такого-нет' }] }] }] },
    { subject: 'Проверка' },
  );
  assert.match(html, /<!DOCTYPE html>/);
});

// ── Выравнивание, красная строка и подвал (ver. 8.43) ───────────────────────

test('текст умеет выравнивание по ширине, а ячейка блока — нет', () => {
  const { html } = renderer.render(doc([{ type: 'text', html: '<p>Текст</p>', align: 'justify' }]));

  assert.match(html, /text-align:justify/);
  // В атрибуте align у ячейки justify недопустим — Word на нём спотыкается.
  assert.doesNotMatch(html, /align="justify"/);
  assert.match(html, /<td align="left"/);
});

test('красная строка ставится на каждый абзац, а не на блок', () => {
  const { html } = renderer.render(doc([{
    type: 'text', indent: 24,
    html: '<p>Первый абзац.</p><p>Второй абзац.</p>',
  }]));

  const indents = html.match(/text-indent:24px/g) || [];
  assert.equal(indents.length, 2);
});

test('без красной строки отступ не появляется вовсе', () => {
  const { html } = renderer.render(doc([{ type: 'text', html: '<p>Текст</p>' }]));
  assert.doesNotMatch(html, /text-indent/);
});



/**
 * ── Телефон и доставка картинок (ver. 8.53) ─────────────────────────────────
 *
 * Правки этого раздела приехали из обратной связи по первым рассылкам: баннер
 * на телефоне оставался десктопным, колонки слипались, а фоновая фотография
 * доезжала до получателя позже всего письма. Каждая проверка ниже — про
 * конкретную из этих жалоб.
 */

test('баннер уменьшается на телефоне, а не остаётся десктопным', () => {
  const { html } = renderer.render(doc([{
    type: 'hero', src: '/uploads/email/b.jpg', title: 'Открыли новый медцентр', height: 400, titleSize: 34,
  }]), { baseUrl: 'https://wiki.example.ru' });

  // Высота и кегль заголовка живут в атрибуте style, перебить их можно только
  // классом из медиазапроса — поэтому у баннера он обязан быть.
  const mobile = html.match(/@media only screen and \(max-width:620px\) \{[\s\S]*?\n  \}/)[0];
  assert.match(mobile, /height:264px !important/);   // 400 × 0,66
  assert.match(mobile, /font-size:24px !important/); // 34 × 0,72
  assert.match(mobile, /\.aw-hero-pad \{ padding:22px 18px !important/);
  assert.match(html, /class="aw-hero-pad"/);
});

test('заголовок баннера не опускается ниже читаемого кегля', () => {
  const { html } = renderer.render(doc([{ type: 'hero', title: 'Акция', titleSize: 18, height: 150 }]));
  const mobile = html.match(/@media only screen and \(max-width:620px\) \{[\s\S]*?\n  \}/)[0];
  assert.match(mobile, /font-size:20px !important/);
  assert.match(mobile, /height:140px !important/);
});

test('баннер умеет ехать обычной картинкой, а не фоном', () => {
  // Фоновую картинку почта тянет последней и не кладёт в сохранённое письмо —
  // ради этого у баннера появилась вторая раскладка.
  const { html } = renderer.render(doc([{
    type: 'hero', layout: 'under', src: '/uploads/email/b.jpg', title: 'Открыли', bg: '#1C1C1E',
  }]), { baseUrl: 'https://wiki.example.ru' });

  assert.match(html, /<img src="https:\/\/wiki\.example\.ru\/uploads\/email\/b\.jpg"[^>]*width:100%/);
  assert.doesNotMatch(html, /background-image/);
  assert.doesNotMatch(html, /v:rect/);
  assert.match(html, /bgcolor="#1C1C1E"/);
  assert.match(html, /Открыли/);
});

test('промежуток между колонками на телефоне становится полем под колонкой', () => {
  const { html } = renderer.render(doc([{
    type: 'columns',
    gap: 20,
    columns: [
      { width: 50, blocks: [{ type: 'text', html: '<p>Л</p>' }] },
      { width: 50, blocks: [{ type: 'text', html: '<p>П</p>' }] },
    ],
  }]));

  const mobile = html.match(/@media only screen and \(max-width:620px\) \{[\s\S]*?\n  \}/)[0];
  assert.match(mobile, /padding-bottom:20px !important/);
  assert.match(mobile, /\.aw-col-last \{ padding-bottom:0 !important/);
  // У распорки больше нет высоты в правиле: display:none и height вместе не
  // работают, и колонки слипались.
  assert.doesNotMatch(mobile, /\.aw-gap \{[^}]*height:/);
  // Последняя колонка поля не получает, первая — получает.
  assert.match(html, /class="aw-col aw-m\d+" width="\d+"/);
  assert.match(html, /class="aw-col aw-m\d+ aw-col-last"/);
});

test('картинка на телефоне держит свою долю, а не десктопное число пикселей', () => {
  const { html } = renderer.render(doc([{
    type: 'columns',
    columns: [
      { width: 50, blocks: [{ type: 'image', src: '/uploads/email/a.jpg', width: 60 }] },
      { width: 50, blocks: [{ type: 'text', html: '<p>П</p>' }] },
    ],
  }]), { baseUrl: 'https://wiki.example.ru' });

  const mobile = html.match(/@media only screen and \(max-width:620px\) \{[\s\S]*?\n  \}/)[0];
  assert.match(mobile, /width:60% !important;max-width:60% !important/);
  assert.match(html, /<img src="[^"]+" class="aw-m\d+"/);
});

test('одинаковые мобильные правила делят один класс', () => {
  const { html } = renderer.render(doc([
    { type: 'hero', title: 'А', height: 300, titleSize: 28 },
    { type: 'hero', title: 'Б', height: 300, titleSize: 28 },
  ]));
  const mobile = html.match(/@media only screen and \(max-width:620px\) \{[\s\S]*?\n  \}/)[0];
  assert.equal((mobile.match(/height:198px !important/g) || []).length, 1);
});

test('иконка пункта уходит в письмо картинкой с нашего адреса', () => {
  const { html } = renderer.render(doc([{
    type: 'iconlist',
    iconSize: 40,
    iconColor: '#0A84FF',
    iconBg: '#EAF4FF',
    items: [{ icon: 'test-tubes', title: 'Анализы за сутки' }],
  }]), { baseUrl: 'https://wiki.example.ru' });

  // SVG в письме не показывает ни один клиент, поэтому иконка — PNG, а все её
  // настройки лежат в адресе: по нему же она и кэшируется.
  assert.match(html, /src="https:\/\/wiki\.example\.ru\/api\/email\/icon\/test-tubes\.png\?size=40&amp;color=0A84FF&amp;bg=EAF4FF"/);
  assert.match(html, /width="40" height="40"/);
});

test('иконки не существует — письмо собирается без неё, а не падает', () => {
  // Набор иконок может измениться, а письма в базе остаются со старыми именами.
  const { html } = renderer.render(doc([{
    type: 'iconlist',
    items: [{ icon: 'такой-иконки-нет', emoji: '✅', title: 'Пункт' }],
  }]), { baseUrl: 'https://wiki.example.ru' });

  assert.doesNotMatch(html, /api\/email\/icon/);
  assert.match(html, /✅/);
  assert.match(html, /Пункт/);
});

test('своя картинка пункта сильнее иконки набора', () => {
  const { html } = renderer.render(doc([{
    type: 'iconlist',
    items: [{ icon: 'check', image: '/uploads/email/own.png', title: 'Пункт' }],
  }]), { baseUrl: 'https://wiki.example.ru' });

  assert.match(html, /uploads\/email\/own\.png/);
  assert.doesNotMatch(html, /api\/email\/icon/);
});

test('оформление иконок общее на блок и целиком уезжает в адрес картинки', () => {
  const { html } = renderer.render(doc([{
    type: 'iconlist',
    iconSize: 48,
    iconColor: '#FFFFFF',
    iconBg: '#0A84FF',
    iconRadius: 14,
    iconScale: 52,
    iconStroke: 2.5,
    iconGap: 18,
    iconAlign: 'middle',
    items: [{ icon: 'test-tubes', title: 'Анализы' }, { icon: 'clock', title: 'Быстро' }],
  }]), { baseUrl: 'https://wiki.example.ru' });

  assert.match(html, /icon\/test-tubes\.png\?size=48&amp;color=FFFFFF&amp;bg=0A84FF&amp;radius=14&amp;scale=52&amp;stroke=2\.5/);
  // Оформление общее: вторая иконка отличается только именем.
  assert.match(html, /icon\/clock\.png\?size=48&amp;color=FFFFFF&amp;bg=0A84FF&amp;radius=14&amp;scale=52&amp;stroke=2\.5/);
  // Отступ до текста задан руками, значит колонка под иконку — 48 + 18.
  assert.match(html, /width="66" style="width:66px;/);
  assert.match(html, /<td valign="middle"/);
});

test('отступ иконки от текста по умолчанию считается от её размера', () => {
  // При иконке в 64px фиксированные 14px слипались бы с заголовком.
  const big = renderer.render(doc([{ type: 'iconlist', iconSize: 64, items: [{ icon: 'check', title: 'А' }] }])).html;
  assert.match(big, /width="96"/);
  const small = renderer.render(doc([{ type: 'iconlist', iconSize: 16, items: [{ icon: 'check', title: 'А' }] }])).html;
  assert.match(small, /width="28"/);
});
