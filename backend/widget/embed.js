/**
 * Виджет связи для сайтов клиник (ver. 8.06).
 *
 * Один файл без сборки — по тем же соображениям, что и страницы в backend/bot/:
 * его правят на месте, а не собирают. Отдаётся маршрутом routes/widget/index.js.
 *
 * КАК ЭТО СТОИТ НА САЙТЕ
 *
 *   <script src="https://wiki.medcentralfa.ru/api/widget/v1/embed.js"
 *           data-widget="КЛЮЧ" async></script>
 *
 * Тег неизменный: всё, что меняется — каналы, цвет, номер, подписи, — приезжает
 * настройкой с вики. Ради этого виджет и переписан со стороны Битрикса.
 *
 * ПОЧЕМУ БЕЗ IFRAME. Так у нас не появляется страницы, отданной с домена
 * портала. Токен сотрудника лежит в localStorage wiki.medcentralfa.ru, и любой
 * документ с того же адреса — потенциальный путь к нему; скрипт же исполняется
 * в origin сайта клиники, и брать в портале ему нечего. Взамен приходится
 * защищаться от чужих стилей — этим занят Shadow DOM.
 *
 * ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО: cookie, localStorage, счётчиков, сторонних
 * запросов. Виджет ходит ровно в один адрес — за своей настройкой. На чужой
 * странице это не аскетизм, а условие: всё, что он делает, видно владельцу
 * сайта и должно объясняться одной фразой.
 */
(function () {
  'use strict';

  // Тег могли вставить дважды (общий шаблон плюс страница) — рисуем один раз.
  if (window.__alfaWidget) return;

  var script = document.currentScript;
  if (!script) {
    // Совсем старые браузеры и часть систем управления сайтом currentScript не
    // дают; последний исполняющийся скрипт — это мы.
    var all = document.getElementsByTagName('script');
    script = all[all.length - 1];
  }

  var key = script && script.getAttribute('data-widget');
  if (!key) {
    console.warn('[alfa-widget] в теге <script> не указан data-widget');
    return;
  }

  var base;
  try {
    base = new URL(script.src, window.location.href).origin;
  } catch (e) {
    return;
  }

  window.__alfaWidget = true;

  // ── Мелочи ──────────────────────────────────────────────────────────────

  /**
   * Белый или тёмный знак поверх фирменного цвета. Цвет выбирает администратор,
   * и на жёлтом или салатовом белая иконка пропадает.
   */
  function foregroundFor(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.65 ? '#101828' : '#ffffff';
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var name in attrs) {
        if (name === 'text') node.textContent = attrs[name];
        else if (attrs[name] !== null && attrs[name] !== undefined) node.setAttribute(name, attrs[name]);
      }
    }
    (children || []).forEach(function (child) { node.appendChild(child); });
    return node;
  }

  function svg(markup, viewBox) {
    // Знаки собраны разметкой, а не innerHTML на элементе: содержимое своё,
    // из этого файла, и в него никогда не попадает ничего от сервера.
    var wrap = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // Собственные значки размечены на 24, фирменные знаки мессенджеров — на 16,
    // как их прислали. Приводить чужой знак к своей сетке значило бы его
    // перерисовывать.
    wrap.setAttribute('viewBox', viewBox || '0 0 24 24');
    wrap.setAttribute('width', '22');
    wrap.setAttribute('height', '22');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = markup;
    return wrap;
  }

  // Знаки Telegram и MAX — те же, что в интерфейсе оператора. Их источник —
  // frontend/src/components/openline/channelBrands.js; сюда они скопированы
  // потому, что этот файл исполняется на чужом сайте и импортировать из портала
  // ничего не может. Правите знак или цвет — правьте оба места.
  var BRAND_VIEWBOX = '0 0 16 16';
  var GLYPHS = {
    telegram: '<path fill="currentColor" d="M2.82494 7.73547C6.04616 6.18313 8.19414 5.15973 9.26889 4.66527C12.3375 3.2535 12.9751 3.00826 13.3907 3.00008C13.4822 2.99838 13.6865 3.02344 13.8189 3.14226C13.9307 3.2426 13.9615 3.37813 13.9762 3.47325C13.9909 3.56838 14.0092 3.78508 13.9947 3.9544C13.8284 5.88701 13.1088 10.5769 12.7428 12.7415C12.5879 13.6574 12.2829 13.9645 11.9876 13.9945C11.346 14.0599 10.8587 13.5255 10.2372 13.0749C9.26468 12.3697 8.71527 11.9308 7.77127 11.2427C6.68032 10.4475 7.38754 10.0104 8.00927 9.29615C8.17198 9.10923 10.9992 6.26477 11.0539 6.00673C11.0608 5.97446 11.0671 5.85417 11.0025 5.79065C10.9379 5.72713 10.8426 5.74885 10.7738 5.76612C10.6762 5.79061 9.1226 6.92645 6.11292 9.17363C5.67193 9.50858 5.2725 9.67177 4.91462 9.66322C4.52009 9.65379 3.76117 9.41648 3.19699 9.21363C2.505 8.96482 1.95502 8.83328 2.00291 8.41073C2.02785 8.19064 2.30186 7.96555 2.82494 7.73547Z"/>',
    // Знак замкнут сам на себя, поэтому evenodd обязателен: без него внутренняя
    // часть заливается и знак превращается в пятно.
    max: '<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M9.15041 14.96C7.77649 14.96 7.138 14.7586 6.02816 13.9528C5.32616 14.8593 3.10315 15.5677 3.00621 14.3557C3.00621 13.4459 2.80563 12.677 2.57832 11.8377C2.30754 10.8036 2 9.65201 2 7.98338C2 3.99815 5.25596 1 9.11364 1C12.9747 1 16 4.14588 16 8.02031C16.0062 9.8523 15.2885 11.6119 14.0043 12.913C12.7201 14.2141 10.9745 14.9503 9.15041 14.96ZM9.20724 4.44469C7.32854 4.34732 5.86436 5.65335 5.5401 7.70136C5.27267 9.39685 5.74736 11.4616 6.15185 11.5691C6.34574 11.6161 6.8338 11.2199 7.138 10.9144C7.64101 11.2634 8.22676 11.473 8.83618 11.5221C9.77194 11.5673 10.688 11.242 11.3875 10.616C12.087 9.99011 12.514 9.11355 12.5769 8.17475C12.6134 7.23402 12.2809 6.31645 11.6507 5.61949C11.0205 4.92253 10.1431 4.50188 9.20724 4.44804V4.44469Z"/>',
    // Свои знаки — залитые, а не контурные: рядом с ними стоят фирменные знаки
    // мессенджеров, а те залиты всегда. Контур посреди залитых читается как
    // другой набор значков, а не как один ряд.
    phone: '<path fill="currentColor" d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.5 0 1 .4 1 1V20c0 .6-.5 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/>',
    chat: '<path fill="currentColor" d="M19 3H5a4 4 0 0 0-4 4v7a4 4 0 0 0 4 4h1.5v3.4L11.6 18H19a4 4 0 0 0 4-4V7a4 4 0 0 0-4-4z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
  };

  var BRAND = { telegram: '#239cd6', max: '#8b52e8' };
  // Зелёный звонка. Своей марки у телефона нет, но цвет за ним закреплён так же
  // прочно: он одинаков на всех виджетах и не зависит от оформления сайта.
  var CALL_COLOR = '#16a34a';

  // ── Стили ───────────────────────────────────────────────────────────────
  //
  // Живут внутри Shadow DOM, поэтому селекторы сайта сюда не достают. А вот
  // наследуемые свойства (шрифт, цвет, межстрочный) достают — их задаём явно,
  // иначе виджет на каждом сайте выглядит по-своему.

  function styles(cfg, fg) {
    var side = cfg.position === 'left' ? 'left' : 'right';
    var other = side === 'left' ? 'right' : 'left';

    return [
      ':host { all: initial; }',
      '*, *::before, *::after { box-sizing: border-box; }',
      '.root {',
      '  position: fixed;',
      '  ' + side + ': 20px;',
      '  ' + other + ': auto;',
      '  bottom: ' + cfg.bottomOffset + 'px;',
      '  z-index: 2147483000;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
      '  font-size: 15px;',
      '  line-height: 1.4;',
      '  color: #101828;',
      '  display: flex;',
      // Панель приходит в DOM после кнопки (её создают по клику), а стоять
      // должна над ней — иначе она уезжает за нижний край экрана.
      '  flex-direction: column-reverse;',
      '  align-items: ' + (side === 'left' ? 'flex-start' : 'flex-end') + ';',
      '  gap: 12px;',
      '}',

      '.fab {',
      '  position: relative;',
      '  width: 58px; height: 58px; border: 0; border-radius: 50%;',
      '  background: ' + cfg.color + '; color: ' + fg + ';',
      '  box-shadow: 0 8px 24px rgba(16, 24, 40, .28);',
      '  cursor: pointer; display: flex; align-items: center; justify-content: center;',
      '  transition: transform .18s ease, box-shadow .18s ease;',
      '  -webkit-tap-highlight-color: transparent;',
      '}',
      '.fab:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(16, 24, 40, .34); }',
      '.fab:active { transform: translateY(0); }',
      '.fab:focus-visible { outline: 3px solid ' + cfg.color + '; outline-offset: 3px; }',

      // Оба знака лежат в кнопке всегда и меняются поворотом со сменой
      // прозрачности. Подменять узел нельзя: новый появляется мгновенно, и
      // именно это выглядело резким рывком.
      '.fab .glyph {',
      '  position: absolute; width: 26px; height: 26px;',
      '  transition: transform .26s cubic-bezier(.4, 0, .2, 1), opacity .16s ease;',
      '}',
      '.fab .glyph-close { transform: rotate(-90deg) scale(.4); opacity: 0; }',
      '.root.open .fab .glyph-chat { transform: rotate(90deg) scale(.4); opacity: 0; }',
      '.root.open .fab .glyph-close { transform: none; opacity: 1; }',

      '.panel {',
      '  width: 320px; max-width: calc(100vw - 32px);',
      '  background: #ffffff; border-radius: 18px;',
      '  box-shadow: 0 18px 48px rgba(16, 24, 40, .22), 0 0 0 1px rgba(16, 24, 40, .06);',
      '  overflow: hidden;',
      '  transform-origin: bottom ' + side + ';',
      '  animation: pop .16s ease-out;',
      '}',
      '@keyframes pop { from { opacity: 0; transform: scale(.94) translateY(8px); } }',
      '@media (prefers-reduced-motion: reduce) {',
      '  .panel { animation: none; }',
      '  .fab, .fab .glyph, .mark svg { transition: none; }',
      '}',

      // Шапки у окошка нет (ver. 8.08). Заголовок с приветствием занимал треть
      // высоты и повторял то, что человек и так знает: он сам нажал кнопку
      // связи. Закрывает окно та же кнопка, что открыла, — она превращается в
      // крестик, поэтому отдельный крестик внутри не нужен.
      '.list { padding: 10px; display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow-y: auto; }',

      '.row {',
      '  display: flex; align-items: center; gap: 12px;',
      '  padding: 11px 12px; border-radius: 12px;',
      '  text-decoration: none; color: inherit; background: transparent;',
      '  border: 0; width: 100%; text-align: left; cursor: pointer;',
      '  font: inherit;',
      '}',
      '.row:hover { background: #f2f4f7; }',
      '.row:focus-visible { outline: 2px solid ' + cfg.color + '; outline-offset: -2px; }',
      '.mark {',
      '  width: 38px; height: 38px; border-radius: 11px; flex: 0 0 38px;',
      '  display: flex; align-items: center; justify-content: center; color: #ffffff;',
      '}',
      '.mark.telegram { background: ' + BRAND.telegram + '; }',
      '.mark.max { background: ' + BRAND.max + '; }',
      // Зелёный, а не цвет виджета (ver. 8.08). Плитка канала — это знак
      // способа связи, как синий у Telegram и фиолетовый у MAX: телефон
      // зелёный везде, и подкрашивать его под оформление сайта значит выдавать
      // за марку то, что ею не является. Заодно на светлом фирменном цвете
      // белая трубка пропадала.
      '.mark.phone { background: ' + CALL_COLOR + '; color: #ffffff; }',

      // Движение своё у каждого знака и все — маленькие: самолётик трогается с
      // места, облачко подрастает, трубку снимают. Двигается знак внутри
      // плитки, а не плитка: повёрнутый фирменный квадрат выглядит поломкой.
      '.mark svg { transition: transform .22s cubic-bezier(.34, 1.3, .5, 1); }',
      '.row:hover .mark.telegram svg { transform: translate(2px, -1.5px); }',
      '.row:hover .mark.max svg { transform: scale(1.12); }',
      '.row:hover .mark.phone svg { transform: rotate(-14deg) scale(1.06); }',
      '.row-main { min-width: 0; flex: 1; }',
      '.row-label { display: block; font-weight: 600; font-size: 14px; }',
      '.row-note { display: block; font-size: 12.5px; color: #667085; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.backdrop { display: none; }',

      // Телефон. Панель прижимается к низу во всю ширину: всплывающая карточка
      // шириной 320 px на узком экране половину времени оказывается под
      // клавиатурой или под панелью браузера.
      '@media (max-width: 560px) {',
      '  .root { left: 16px; right: 16px; align-items: stretch; }',
      '  .fab { align-self: ' + (side === 'left' ? 'flex-start' : 'flex-end') + '; }',
      '  .panel { width: 100%; max-width: none; border-radius: 18px; }',
      '  .list { max-height: min(58vh, 420px); }',
      '  .row { padding: 13px 12px; }',
      '  .backdrop {',
      '    display: block; position: fixed; inset: 0; z-index: -1;',
      '    background: rgba(16, 24, 40, .38);',
      '  }',
      '}',
      // Отступ под «домашнюю полоску» iPhone: без него нижняя кнопка списка
      // упирается в жест «назад».
      '@supports (padding: max(0px)) {',
      '  @media (max-width: 560px) {',
      '    .root { bottom: max(' + cfg.bottomOffset + 'px, env(safe-area-inset-bottom)); }',
      '  }',
      '}'
    ].join('\n');
  }

  // ── Сборка ──────────────────────────────────────────────────────────────

  function build(cfg) {
    var fg = foregroundFor(cfg.color);
    var host = document.createElement('div');
    // Хост в потоке страницы ничего не занимает: всё позиционирование внутри.
    host.style.cssText = 'all: initial; position: static;';
    var shadow = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : null;
    if (!shadow) return;   // без Shadow DOM не рисуем вовсе: чужие стили сломают вид

    shadow.appendChild(el('style', { text: styles(cfg, fg) }));

    var root = el('div', { class: 'root' });
    var backdrop = el('div', { class: 'backdrop', part: 'backdrop' });

    var chatGlyph = svg(GLYPHS.chat);
    chatGlyph.setAttribute('class', 'glyph glyph-chat');
    var closeGlyph = svg(GLYPHS.close);
    closeGlyph.setAttribute('class', 'glyph glyph-close');

    var fab = el('button', {
      class: 'fab',
      type: 'button',
      'aria-label': cfg.buttonLabel || 'Связаться с нами',
      'aria-expanded': 'false'
    }, [chatGlyph, closeGlyph]);

    var panel = null;

    // Кнопка одна и на открытие, и на закрытие: шапки с крестиком у окошка
    // больше нет (ver. 8.08), и другого способа закрыть его на телефоне не
    // осталось бы вовсе. Какой знак виден — решает класс на .root, здесь только
    // подписи: знаки лежат в кнопке оба и переезжают поворотом.
    function setFab(isOpen) {
      fab.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      fab.setAttribute('aria-label', isOpen ? 'Закрыть' : (cfg.buttonLabel || 'Связаться с нами'));
    }

    function close() {
      if (!panel) return;
      panel.remove();
      if (backdrop.parentNode) backdrop.remove();
      panel = null;
      root.classList.remove('open');
      setFab(false);
      fab.focus();
    }

    function open() {
      if (panel) return close();
      panel = renderPanel(cfg, close);
      root.appendChild(backdrop);
      root.appendChild(panel);
      root.classList.add('open');
      setFab(true);
      var first = panel.querySelector('.row');
      if (first) first.focus();
    }

    fab.addEventListener('click', open);
    backdrop.addEventListener('click', close);

    // Esc закрывает, клик мимо — тоже. Виджет висит поверх чужой страницы, и
    // из него всегда должен быть очевидный выход.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel) close();
    });
    document.addEventListener('click', function (e) {
      if (!panel) return;
      var path = e.composedPath ? e.composedPath() : [];
      if (path.indexOf(host) === -1) close();
    });

    root.appendChild(fab);
    shadow.appendChild(root);
    document.body.appendChild(host);
  }

  function renderPanel(cfg, close) {
    // Название окна остаётся подписью для экранных дикторов: на экране его нет,
    // но объявить, что открылось, всё равно нужно.
    var panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': cfg.title || 'Связаться с нами' });

    var list = el('div', { class: 'list' });
    cfg.channels.forEach(function (channel) {
      var row = channel.type === 'phone' ? phoneRow(channel) : linkRow(channel, close);
      if (row) list.appendChild(row);
    });

    panel.appendChild(list);
    return panel;
  }

  function linkRow(channel, close) {
    // rel обязателен: без noopener открытая вкладка получает доступ к
    // window.opener страницы клиники.
    var row = el('a', {
      class: 'row',
      href: channel.value,
      target: '_blank',
      rel: 'noopener noreferrer'
    }, [
      el('span', { class: 'mark ' + channel.type }, [svg(GLYPHS[channel.type] || GLYPHS.chat, BRAND_VIEWBOX)]),
      el('span', { class: 'row-main' }, [main(channel)])
    ]);
    row.addEventListener('click', close);
    return row;
  }

  /**
   * Название и подпись под ним. Подпись задаёт клиника (ver. 8.08): раньше это
   * была вшитая строка «Написать в Telegram», а сказать там хотят разное — от
   * часов приёма до «отвечаем за минуту». Пустая подпись означает, что второй
   * строки нет вовсе.
   */
  function main(channel) {
    var box = document.createDocumentFragment();
    box.appendChild(el('span', { class: 'row-label', text: channel.label }));
    if (channel.note) box.appendChild(el('span', { class: 'row-note', text: channel.note }));
    return box;
  }

  /**
   * Телефон: подпись и звонок, больше ничего.
   *
   * Сам номер в окошке не показывается намеренно (решение заказчика). Кнопка
   * тут — действие, а не справка: человек нажимает «Регистратура», чтобы
   * позвонить, а не чтобы переписать цифры. Номер в подписи заодно означал бы,
   * что его надо держать в двух местах и что строка на узком экране начинает
   * переноситься.
   *
   * Прежде рядом стояла кнопка «скопировать» — на компьютере, где tel:
   * отдаётся системе и часто не делает ничего. Она ушла вместе с номером:
   * копировать стало нечего.
   */
  function phoneRow(channel) {
    return el('a', { class: 'row', href: 'tel:' + channel.value }, [
      el('span', { class: 'mark phone' }, [svg(GLYPHS.phone)]),
      el('span', { class: 'row-main' }, [main(channel)])
    ]);
  }

  // ── Настройка ───────────────────────────────────────────────────────────

  function start() {
    fetch(base + '/api/widget/v1/config/' + encodeURIComponent(key), { credentials: 'omit' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (cfg) {
        // Виджет без каналов не рисуем: кнопка, за которой пусто, хуже, чем её
        // отсутствие. Так же выключается виджет целиком — снятием галок.
        if (!cfg || !cfg.channels || !cfg.channels.length) return;
        build(cfg);
      })
      .catch(function () { /* сайт клиники не должен падать из-за нашей кнопки */ });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
