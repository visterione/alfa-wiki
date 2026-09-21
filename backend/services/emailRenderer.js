'use strict';

/**
 * Рендер письма из документа конструктора (ver. 8.43).
 *
 * ── Почему источник правды не HTML ───────────────────────────────────────────
 *
 * До этого релиза письмо существовало только как строка HTML: её либо набирали в
 * TipTap, либо вставляли готовой из внешнего конструктора. Оба пути упираются в
 * одно — письмо обязано быть свёрстано таблицами с инлайновыми стилями, а такую
 * вёрстку нельзя ни набрать в обычном редакторе, ни потом разобрать обратно на
 * блоки. Поэтому источником правды стал JSON-документ (`design`), а HTML — то,
 * что из него отрендерили перед самой отправкой. Руками HTML больше не правится
 * нигде, кроме старого режима «вставить готовый код», который остался рядом.
 *
 * Рендерер живёт на бэкенде, а не во фронтенде, ровно по одной причине: у письма
 * должен быть ОДИН способ превратиться в HTML. Предпросмотр, тестовая отправка и
 * боевая рассылка зовут эту функцию, и расходиться им негде. Холст конструктора
 * в React — не рендерер, а приближение; точный вид показывает предпросмотр.
 *
 * ── Что здесь считается «правильным HTML» ────────────────────────────────────
 *
 * Не тот, что валиден, а тот, что доезжает. Правила, из которых собран вывод:
 *
 *   • Таблицы вместо блоков. Outlook на Windows рисует письмо движком Word: ни
 *     flex, ни grid, ни float он не знает. Всё, что должно встать рядом, стоит
 *     рядом в ячейках таблицы.
 *   • Отступы только на <td>. Word игнорирует padding на <p> и <div>, но честно
 *     отрабатывает его на ячейке.
 *   • Стили инлайном. Gmail на мобильных вырезает <style> из <head> не целиком,
 *     но полагаться на него нельзя ни в чём, кроме @media (см. ниже).
 *   • <style> в <head> оставлен ровно под медиазапрос, который складывает
 *     колонки в столбик на телефоне. Outlook его не поймёт и покажет десктопную
 *     раскладку — это ожидаемая и приемлемая деградация, а не поломка.
 *   • Скругления, тени и прочая косметика деградируют в прямые углы. Ради них
 *     не стоит городить VML нигде, кроме кнопки: кнопку человек ищет глазами.
 *
 * ── Почему письмо рендерится в два шага ──────────────────────────────────────
 *
 * У каждого получателя массовой рассылки свой адрес отписки, а значит и свой
 * HTML. Собирать документ заново на каждого из пяти тысяч человек расточительно
 * и бессмысленно, поэтому render() выдаёт HTML с подстановками вида {{...}},
 * один раз на всю рассылку, а personalize() подставляет в него значения
 * конкретного получателя уже в цикле отправки. Побочная выгода: обращение по
 * имени и название медцентра достались тем же механизмом, бесплатно.
 */

const sanitizeHtml = require('sanitize-html');
const fonts = require('./emailFonts');

const DOC_VERSION = 1;

const WEB_FONT_KEYS = new Set(Object.keys(fonts.FONTS).filter(k => fonts.FONTS[k].web));

// Ширина письма. 600px — не традиция, а предел: в Outlook область чтения по
// умолчанию уже экрана, и всё, что шире, получает горизонтальную прокрутку.
const DEFAULT_WIDTH = 600;

const DEFAULT_SETTINGS = {
  width: DEFAULT_WIDTH,
  bodyBg: '#F2F2F7',
  cardBg: '#FFFFFF',
  textColor: '#1C1C1E',
  mutedColor: '#8E8E93',
  linkColor: '#0A84FF',
  // Ключ из emailFonts. Строка fontFamily рядом осталась для писем, собранных
  // до появления списка шрифтов: там лежит готовый стек, и трогать его незачем.
  font: 'system',
  fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontSize: 16,
  lineHeight: 1.5,
  radius: 16,
  preheader: '',
  // Компания в подвале — то, что закон требует показать в рекламном письме:
  // кто отправитель и где его искать. Значения по умолчанию пустые намеренно,
  // чтобы пустой подвал бросался в глаза в предпросмотре, а не уехал людям.
  // Название отправителя одно на всю сеть и уже зашито в текст подвала, так
  // что спрашивать его в каждом письме заново незачем. Адрес остаётся пустым:
  // он разный у филиалов, и подставленный наугад хуже, чем ненаписанный.
  // Название сети. Осталось в настройках, потому что им подписывается шапка,
  // когда логотип ещё не загружен. Текст подвала живёт в самом блоке отписки.
  senderName: 'Сеть медцентров «Альфа»',
  // Метки перехода. Пустые по умолчанию: проставлять их без спроса значит
  // менять чужие ссылки, а рассылка может вести и на сторонний сайт.
  utm: null,
};

/**
 * Экранирование всего, что приходит из документа в атрибут или в текст.
 *
 * Кавычка в alt картинки рвёт тег и утаскивает за собой остаток письма — это не
 * гипотеза, а то, как выглядит любое письмо с апострофом в подписи.
 */
const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/**
 * Ссылка, которую не стыдно положить в href.
 *
 * javascript: и data: в письме не значат ничего полезного, зато прекрасно
 * переживают пересылку. Всё, что не http(s), mailto и tel, превращается в
 * решётку: пусть кнопка никуда не ведёт, чем ведёт куда попало.
 */
const safeUrl = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  // Подстановки пропускаем как есть: их значение подставится на отправке.
  if (/^\{\{[a-z_]+\}\}$/i.test(raw)) return raw;
  if (/^(https?:|mailto:|tel:)/i.test(raw)) return esc(raw);
  // Адрес без схемы — частая опечатка маркетолога, а не попытка обмана.
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(raw)) return esc(`https://${raw}`);
  return '#';
};

/**
 * Метки перехода на ссылках письма.
 *
 * Без них рассылка в отчётах сайта сливается с прямыми заходами, и вопрос
 * «сколько записей принесло письмо» остаётся без ответа. Проставлять их руками
 * в каждой ссылке никто не будет — поэтому метки живут в настройках письма и
 * навешиваются на все внешние ссылки разом, при рендере.
 *
 * Чужие ссылки с уже проставленными метками не трогаем: маркетолог мог привести
 * их из другого источника осознанно. Не трогаем и подстановки, mailto, tel и
 * адрес отписки — метка в них бессмысленна, а в отписке ещё и вредна.
 */
const withUtm = (url, s) => {
  const raw = String(url || '');
  const utm = s?.utm;
  if (!utm || !raw) return raw;
  if (!/^https?:/i.test(raw)) return raw;
  if (/[?&]utm_/i.test(raw)) return raw;

  const params = [
    ['utm_source', utm.source],
    ['utm_medium', utm.medium],
    ['utm_campaign', utm.campaign],
  ].filter(([, v]) => String(v || '').trim());
  if (!params.length) return raw;

  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(String(v).trim())}`).join('&');
  // Якорь должен остаться в конце адреса, иначе браузер посчитает метки его
  // частью и не прокрутит страницу к нужному месту.
  const [base, hash = ''] = raw.split('#');
  return `${base}${base.includes('?') ? '&' : '?'}${query}${hash ? `#${hash}` : ''}`;
};

/**
 * Абсолютный адрес картинки.
 *
 * В документе картинки лежат относительным путём (`/uploads/2026-09/x.png`) —
 * ровно в том виде, в каком их отдаёт загрузчик. Это сознательно: документ
 * переживает смену домена, а превратить путь в адрес — дело одной строки здесь.
 * В письме относительный путь бесполезен: почтовый клиент не знает, от какого
 * сайта его отсчитывать.
 */
const absoluteUrl = (value, baseUrl) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^(https?:|cid:|data:)/i.test(raw)) return raw;
  const base = String(baseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!base) return raw;
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
};

/**
 * ── Градиенты ────────────────────────────────────────────────────────────────
 *
 * Что из этого доезжает и куда:
 *
 *   • linear-gradient и radial-gradient с любым числом точек и с прозрачностью
 *     понимают Apple Mail, iOS Mail, Gmail (веб и мобильный), Яндекс и Mail.ru.
 *   • conic-gradient — только движки WebKit и Blink (Apple Mail, iOS, Gmail в
 *     браузере). Остальные увидят сплошной цвет. Отдельно не запрещаем: хуже
 *     заливки не станет.
 *   • Outlook на Windows рисует письмо движком Word и не знает градиентов
 *     вовсе. Ему всегда проставляется bgcolor сплошным цветом.
 *   • Кнопка — исключение: у неё есть VML-дубль, а VML умеет и многоточечный
 *     линейный градиент (атрибут colors), и радиальный (gradientRadial). Там
 *     градиент настоящий. Прозрачности VML не знает — в Outlook точки
 *     становятся плотными.
 *
 * Документ хранит градиент так:
 *
 *   { type: 'linear'|'radial'|'conic',
 *     angle: 0..360,                     // linear и conic
 *     shape: 'circle'|'ellipse',         // radial
 *     position: 'center'|'top left'|…,   // radial и conic
 *     stops: [{ color: '#RRGGBB', alpha: 0..100, at: 0..100 }, …] }
 *
 * Старая запись { from, to, angle } из первой версии конструктора продолжает
 * работать: normalizeGradient разворачивает её в две точки. Письма, собранные
 * до этой правки, никто пересобирать не будет.
 */

/** #RRGGBB + прозрачность → rgba(). Без прозрачности цвет остаётся как есть. */
const withAlpha = (color, alpha) => {
  const value = String(color || '').trim();
  const a = Number(alpha);
  if (!Number.isFinite(a) || a >= 100 || a < 0) return value;
  const hex = value.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return value;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${(a / 100).toFixed(2)})`;
};

const GRADIENT_POSITIONS = new Set([
  'center', 'top', 'bottom', 'left', 'right',
  'top left', 'top right', 'bottom left', 'bottom right',
]);

const normalizeGradient = (g) => {
  if (!g || typeof g !== 'object') return null;

  let stops = Array.isArray(g.stops) ? g.stops.filter(st => st && st.color) : [];
  // Запись первой версии конструктора: два цвета без точек.
  if (stops.length < 2 && g.from && g.to) {
    stops = [{ color: g.from, at: 0 }, { color: g.to, at: 100 }];
  }
  if (stops.length < 2) return null;

  // Точки сортируются по положению: перепутанный порядок в CSS не ошибка, но
  // браузер подтягивает отставшую точку к предыдущей, и градиент выходит не
  // тем, что человек набрал в панели.
  const ordered = stops
    .map((st, i) => ({
      color: String(st.color),
      alpha: st.alpha,
      at: Number.isFinite(Number(st.at)) ? Math.min(100, Math.max(0, Number(st.at))) : Math.round((i / (stops.length - 1)) * 100),
    }))
    .sort((a, b) => a.at - b.at);

  const type = ['linear', 'radial', 'conic'].includes(g.type) ? g.type : 'linear';
  return {
    type,
    angle: px(g.angle, 135),
    shape: g.shape === 'circle' ? 'circle' : 'ellipse',
    position: GRADIENT_POSITIONS.has(g.position) ? g.position : 'center',
    stops: ordered,
  };
};

/** Есть ли в градиенте хоть одна прозрачная точка. */
const gradientHasAlpha = (g) => {
  const n = normalizeGradient(g);
  return Boolean(n && n.stops.some(st => Number.isFinite(Number(st.alpha)) && Number(st.alpha) < 100));
};

/**
 * Запасной сплошной цвет: первая непрозрачная точка, иначе просто первая.
 *
 * ВАЖНО: у градиента с прозрачностью запасного цвета быть не должно. Он
 * красится ПОД градиентом, и прозрачные места показывают не фон письма, а его.
 * Разделитель, растворяющийся к краям, превращался из-за этого в обычную
 * сплошную линию — именно так это и вылезло. Поэтому здесь только цвет, а
 * решение «красить или нет» принимает вызывающий через gradientHasAlpha.
 */
const gradientFallback = (g) => {
  const n = normalizeGradient(g);
  if (!n) return '';
  const opaque = n.stops.find(st => !Number.isFinite(Number(st.alpha)) || Number(st.alpha) >= 100);
  return (opaque || n.stops[0]).color;
};

const gradientCss = (g) => {
  const n = normalizeGradient(g);
  if (!n) return '';
  const list = n.stops.map(st => `${withAlpha(st.color, st.alpha)} ${st.at}%`).join(', ');
  if (n.type === 'radial') return `radial-gradient(${n.shape} at ${n.position}, ${list})`;
  if (n.type === 'conic') return `conic-gradient(from ${n.angle}deg at ${n.position}, ${list})`;
  return `linear-gradient(${n.angle}deg, ${list})`;
};

/**
 * Заливка для VML — единственный способ показать градиент в Outlook.
 *
 * Промежуточные точки едут в атрибуте colors, крайние — в color и color2.
 * Прозрачность отбрасывается: VML её не знает, и прозрачная точка там стала бы
 * дырой в кнопке.
 */
const gradientVml = (g) => {
  const n = normalizeGradient(g);
  if (!n) return '';
  const first = n.stops[0];
  const last = n.stops[n.stops.length - 1];

  if (n.type === 'radial') {
    // focus/focussize описывают точку схода: Word умеет радиальный градиент
    // только от краёв к центру, направление задаётся перестановкой цветов.
    return `<v:fill type="gradientRadial" color="${esc(last.color)}" color2="${esc(first.color)}" focus="100%" focussize="0,0"/>`;
  }

  const mids = n.stops.slice(1, -1).map(st => `${st.at}% ${st.color}`).join(',');
  return `<v:fill type="gradient" color="${esc(first.color)}" color2="${esc(last.color)}"`
    + `${mids ? ` colors="${esc(mids)}"` : ''} angle="${vmlAngle(n.angle)}"/>`;
};

/**
 * Градиент буквами.
 *
 * Делается связкой background-clip:text и text-fill-color:transparent, и это
 * единственный способ в почте. Приём рискованный: клиент, который оставит
 * прозрачную заливку букв, но выбросит саму картинку фона, покажет пустое
 * место вместо текста.
 *
 * Поэтому правила живут не в атрибуте style, а классом в <style> шапки. Клиент,
 * который вырезает <style> целиком (а именно такие и не понимают
 * background-clip), остаётся на обычном цвете из инлайнового стиля и видит
 * нормальный текст. Разрезать эту связку пополам не может никто.
 */
const gradientTextClass = (gradient, ctx) => {
  const css = gradientCss(gradient);
  if (!css || !ctx?.styles) return '';
  const name = `aw-gt${ctx.styles.length + 1}`;
  ctx.styles.push(
    `.${name}{background-image:${css};-webkit-background-clip:text;background-clip:text;`
    + '-webkit-text-fill-color:transparent;color:transparent;}'
  );
  return name;
};

/**
 * Фон: сплошной цвет или градиент.
 *
 * Сплошной цвет объявляется ПЕРЕД градиентом: клиент, не знающий второго
 * свойства, останется на первом, а не покажет прозрачную дыру.
 */
const background = (block) => {
  const css = gradientCss(block?.gradient);
  // Выведенный из градиента цвет не красим, если в градиенте есть прозрачность:
  // он лёг бы под ним и закрыл фон письма. Цвет, заданный человеком явно, —
  // его выбор, и он остаётся.
  const derived = gradientHasAlpha(block?.gradient) ? '' : gradientFallback(block?.gradient);
  const solid = block?.background || derived || '';
  if (!css) {
    return { css: solid ? `background:${esc(solid)};` : '', bgcolor: solid ? esc(solid) : '' };
  }
  return {
    css: `${solid ? `background:${esc(solid)};` : ''}background-image:${css};`,
    bgcolor: solid ? esc(solid) : '',
  };
};

/**
 * Угол градиента в системе VML.
 *
 * В CSS угол отсчитывается по часовой от «вверх», в VML — по часовой от
 * «вниз». Разница ровно в половине оборота. Проверено на крайних случаях:
 * CSS 180° (сверху вниз) даёт VML 0°, CSS 90° (слева направо) — VML 270°.
 */
const vmlAngle = (cssAngle) => ((px(cssAngle, 135) + 180) % 360);

/**
 * Оформление блока: рамка, скругление, тень, свой фон.
 *
 * Отдельная карточка внутри блока, а не стили на его ячейке. Причина в том,
 * что ячейка блока тянется во всю ширину письма, и скругление с рамкой на ней
 * выглядят как рамка вокруг страницы, а не вокруг содержимого. Плюс так
 * получается привычный дизайнеру приём: цветная полоса во всю ширину
 * (background блока) и карточка поверх неё (card).
 *
 * box-shadow работает в Apple Mail и iOS, в Gmail и Outlook игнорируется. Это
 * приемлемая деградация: тень нигде не несёт смысла, только вид.
 */
const cardWrap = (body, card, s) => {
  if (!card || typeof card !== 'object') return body;
  const bg = background(card);
  const radius = px(card.radius, 0);
  const borderWidth = px(card.borderWidth, 0);
  const style = [
    bg.css,
    radius ? `border-radius:${radius}px;` : '',
    borderWidth ? `border:${borderWidth}px solid ${esc(card.borderColor || '#E5E5EA')};` : '',
    card.shadow ? 'box-shadow:0 6px 18px rgba(0,0,0,0.08);' : '',
  ].join('');
  const inner = px(card.padding, 20);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"${bg.bgcolor ? ` bgcolor="${bg.bgcolor}"` : ''} style="width:100%;${style}">`
    + `<tr><td style="padding:${inner}px;">${body}</td></tr></table>`;
};

/**
 * Блоки, которые расходуют градиент на себя, а не на полосу под собой.
 *
 * У кнопки градиент — это заливка самой кнопки, у баннера — часть фона с
 * фотографией. Если бы полоса блока красилась тем же свойством, выбор
 * градиента для кнопки заодно заливал бы всю строку письма за ней, чего никто
 * не просил.
 */
const OWNS_GRADIENT = new Set(['button', 'hero', 'divider']);

/**
 * Шрифт блока.
 *
 * Свой шрифт блока перекрывает общий шрифт письма. Здесь же копится список
 * использованных веб-шрифтов: подключать в шапке нужно только те, что реально
 * встретились, иначе письмо тянет с чужого сервера гарнитуры, которых в нём нет.
 */
const fontOf = (block, s, ctx) => {
  const key = block?.font || s?.font;
  if (!key) return s.fontFamily;
  if (ctx?.webFonts && fonts.FONTS[key]?.web) ctx.webFonts.add(key);
  return fonts.fontStack(key);
};

/**
 * Цвета текста блока.
 *
 * Появились вместе с секциями и не раньше: пока письмо было одной белой
 * карточкой, общего цвета текста хватало. С полосами во всю ширину блок может
 * оказаться на тёмном фоне, и тогда «цвет текста письма» делает его нечитаемым.
 * Свой цвет блока перекрывает общий — иначе тёмные шапки и подвалы бесполезны.
 */
const inkOf = (block, s) => esc(block?.color || s.textColor);
const mutedOf = (block, s) => esc(block?.mutedColor || s.mutedColor);
const linkOf = (block, s) => esc(block?.linkColor || s.linkColor);

const px = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
};

/** Отступы блока. Всегда четыре числа, всегда на <td>, никогда на содержимом. */
const padding = (block, def = [12, 24, 12, 24]) => {
  const p = block?.padding || {};
  const top = px(p.top, def[0]);
  const right = px(p.right, def[1]);
  const bottom = px(p.bottom, def[2]);
  const left = px(p.left, def[3]);
  return `${top}px ${right}px ${bottom}px ${left}px`;
};

const align = (value, def = 'left') => (['left', 'center', 'right'].includes(value) ? value : def);

/**
 * Выравнивание ТЕКСТА — отдельно от выравнивания блока.
 *
 * У текста есть четвёртый вариант, «по ширине», которого нет у атрибута align
 * на ячейке: в HTML он там недопустим, и Outlook на нём спотыкается. Поэтому
 * ячейка получает из justify обычное «влево», а сам текст — настоящий justify
 * в стиле. Клиенты, до которых стиль не доехал, покажут текст по левому краю,
 * и это ровно та деградация, которую никто не заметит.
 */
const textAlign = (value, def = 'left') => (
  ['left', 'center', 'right', 'justify'].includes(value) ? value : def
);

/**
 * Разметка текстового блока.
 *
 * Приходит из TipTap в конструкторе, то есть из браузера, то есть ей нельзя
 * верить. Чистим по белому списку и тем же проходом навешиваем инлайновые
 * стили: без них абзац в Outlook получит собственный отступ от движка Word, а
 * ссылка в Gmail — синее подчёркивание мимо фирменного цвета.
 *
 * transformTags вместо регулярок по готовой строке: пройти по тегам один раз
 * надёжнее, чем угадывать их в тексте, где те же угловые скобки могут быть
 * частью содержимого.
 */
const richText = (html, s, options = {}) => {
  const linkStyle = `color:${s.linkColor};text-decoration:underline;`;
  /**
   * Красная строка — отступ первой строки абзаца, привычный в русской типографике.
   *
   * Ставится на сам <p>, а не на блок: отступ должен получить каждый абзац, а
   * не только первый. text-indent понимают все почтовые клиенты, включая Word,
   * — это одно из немногих свойств, которое доезжает без оговорок.
   */
  const indent = px(options.indent, 0);
  const paragraph = `margin:0 0 12px 0;${indent ? `text-indent:${indent}px;` : ''}`;
  const addStyle = (extra) => (tagName, attribs) => ({
    tagName,
    attribs: { ...attribs, style: `${attribs.style ? `${attribs.style};` : ''}${extra}` },
  });

  return sanitizeHtml(String(html ?? ''), {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'span', 'sub', 'sup'],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'style'],
      span: ['style'],
      p: ['style'],
      h1: ['style'], h2: ['style'], h3: ['style'],
      ul: ['style'], ol: ['style'], li: ['style'],
    },
    // Белый список свойств нужен дважды. Во-первых, он отсекает то, что человек
    // мог принести в тексте из чужого редактора (position, float, display —
    // всё, чем письмо разваливается). Во-вторых — и это не очевидно — под него
    // попадают и стили, которые навешивает transformTags ниже: sanitize-html
    // чистит атрибут style уже ПОСЛЕ преобразования тега, не отличая свои
    // правки от чужих. Забытое здесь свойство молча пропадает из письма.
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(/],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\(/],
        'text-align': [/^(left|right|center|justify)$/],
        'font-weight': [/^(normal|bold|[1-9]00)$/],
        'font-style': [/^(normal|italic)$/],
        'font-size': [/^\d{1,3}px$/],
        'line-height': [/^[\d.]{1,5}$/],
        'text-decoration': [/^(underline|none|line-through)$/],
        margin: [/^[\d .a-z%-]{1,40}$/i],
        'padding-left': [/^\d{1,3}px$/],
        'text-indent': [/^\d{1,3}px$/],
        'text-align': [/^(left|right|center|justify)$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: {
      // Последний абзац без нижнего отступа задаётся не здесь, а padding'ом
      // блока: так маркетолог управляет расстоянием между блоками в одном
      // месте, а не в двух.
      p: addStyle(paragraph),
      h1: addStyle(`margin:0 0 12px 0;font-size:28px;line-height:1.25;font-weight:700;color:${s.textColor};`),
      h2: addStyle(`margin:0 0 10px 0;font-size:22px;line-height:1.3;font-weight:700;color:${s.textColor};`),
      h3: addStyle(`margin:0 0 8px 0;font-size:18px;line-height:1.35;font-weight:600;color:${s.textColor};`),
      ul: addStyle('margin:0 0 12px 0;padding-left:22px;'),
      ol: addStyle('margin:0 0 12px 0;padding-left:22px;'),
      li: addStyle('margin:0 0 6px 0;'),
      a: (tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...attribs,
          href: withUtm(attribs.href, s) || '#',
          target: '_blank',
          rel: 'noopener noreferrer',
          style: `${attribs.style ? `${attribs.style};` : ''}${linkStyle}`,
        },
      }),
    },
  });
};

// ── Блоки ───────────────────────────────────────────────────────────────────
//
// Каждый рендерер возвращает содержимое ОДНОЙ ячейки. Обёртку в <tr><td> делает
// вызывающий: так блок одинаково ложится и в письмо, и в колонку.

const blockRenderers = {
  text(block, s, ctx) {
    const size = px(block.fontSize, s.fontSize);
    // Под градиентом букв всё равно должен лежать настоящий цвет: его увидят
    // все, до кого градиент не доехал.
    const color = block.color || gradientFallback(block.textGradient) || s.textColor;
    const style = [
      `font-family:${fontOf(block, s, ctx)}`,
      `font-size:${size}px`,
      `line-height:${block.lineHeight || s.lineHeight}`,
      `color:${color}`,
      `text-align:${textAlign(block.align)}`,
      // Word не наследует стили шрифта внутрь таблиц так же, как браузер;
      // mso-line-height-rule страхует межстрочный интервал именно в нём.
      'mso-line-height-rule:exactly',
    ].join(';');
    const cls = gradientTextClass(block.textGradient, ctx);
    return `<div${cls ? ` class="${cls}"` : ''} style="${style}">${richText(block.html, s, { indent: block.indent })}</div>`;
  },

  image(block, s, ctx) {
    const src = absoluteUrl(block.src, ctx.baseUrl);
    if (!src) return '';
    // Ширина картинки в письме задаётся числом в атрибуте, а не процентом в
    // стиле: Outlook растягивает процент от ячейки непредсказуемо, а атрибут
    // width понимают все. max-width в стиле отвечает за телефон.
    const boxWidth = ctx.contentWidth;
    const widthPct = Math.min(100, Math.max(5, px(block.width, 100)));
    const width = Math.round((boxWidth * widthPct) / 100);
    // Круг — это скругление в половину ширины. Outlook покажет квадрат: Word не
    // знает border-radius. Круглый аватар в письме всегда так и деградирует,
    // подменять его картинкой с прорезанным фоном не стоит — она не загрузится.
    const radius = block.shape === 'circle' ? Math.round(width / 2) : px(block.radius, 0);
    const img = `<img src="${esc(src)}" width="${width}" alt="${esc(block.alt || '')}" style="display:block;border:0;outline:none;text-decoration:none;width:${width}px;max-width:100%;height:auto;${radius ? `border-radius:${radius}px;` : ''}${block.borderWidth ? `border:${px(block.borderWidth)}px solid ${esc(block.borderColor || '#FFFFFF')};` : ''}">`;
    const href = safeUrl(withUtm(block.href, s));
    const body = href ? `<a href="${href}" target="_blank" rel="noopener noreferrer" style="display:block;border:0;">${img}</a>` : img;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align(block.align, 'center')}"><tr><td align="${align(block.align, 'center')}">${body}</td></tr></table>`;
  },

  button(block, s, ctx) {
    const label = esc(block.text || 'Подробнее');
    const href = safeUrl(withUtm(block.href, s)) || '#';
    // Цвет-подложка: он же bgcolor для Outlook и он же то, что увидит клиент,
    // не знающий градиентов. Берётся из первой непрозрачной точки градиента,
    // если свой не задан, — иначе кнопка с градиентом оказалась бы синей по
    // умолчанию независимо от того, какие цвета выбрал человек.
    const bg = block.bg || gradientFallback(block.gradient) || s.linkColor;
    const color = block.color || '#FFFFFF';
    const radius = px(block.radius, 10);
    const padX = px(block.paddingX, 28);
    const padY = px(block.paddingY, 14);
    const size = px(block.fontSize, 16);
    const a = align(block.align, 'center');
    // Ширина для VML считается на глаз: Word не умеет подгонять roundrect под
    // содержимое, ему нужно число. Пол-кегля на символ — грубая, но устойчивая
    // оценка для кириллицы; ошибка в полсимвола видна только в Outlook и только
    // как чуть более широкая кнопка.
    const vmlWidth = Math.round(label.length * size * 0.55) + padX * 2;
    const vmlHeight = size * 1.2 + padY * 2;
    const font = fontOf(block, s, ctx);

    // Градиент на кнопке — единственное место, где он доезжает и до Outlook:
    // у кнопки есть VML-дубль, а VML умеет и многоточечную линейную заливку,
    // и радиальную.
    const gradCss = gradientCss(block.gradient);
    const cssBg = gradCss
      ? `background:${esc(bg)};background-image:${gradCss};`
      : `background:${esc(bg)};`;
    const vmlFill = gradientVml(block.gradient);

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${a}"><tr><td align="center" bgcolor="${esc(bg)}" style="border-radius:${radius}px;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:${Math.round(vmlHeight)}px;v-text-anchor:middle;width:${vmlWidth}px;" arcsize="${Math.round((radius / (vmlHeight / 2)) * 50)}%" stroke="f" fillcolor="${esc(bg)}">${vmlFill}<w:anchorlock/><center style="color:${esc(color)};font-family:${font};font-size:${size}px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:${padY}px ${padX}px;font-family:${font};font-size:${size}px;font-weight:bold;line-height:1.2;color:${esc(color)};text-decoration:none;border-radius:${radius}px;${cssBg}">${label}</a><!--<![endif]-->
</td></tr></table>`;
  },

  divider(block, s, ctx) {
    const color = block.color || '#E5E5EA';
    const thickness = px(block.thickness, 1);
    const widthPct = Math.min(100, Math.max(10, px(block.width, 100)));
    // Линия рисуется фоном пустой ячейки, а не <hr>: у <hr> в каждом клиенте
    // своя толщина, свой цвет и свои поля, и переспорить его нельзя. Фоном же
    // может быть и градиент — линия, растворяющаяся к краям, это обычный приём
    // в рассылках, и стоит он ровно ничего.
    const gradCss = gradientCss(block.gradient);
    // Тот же запрет, что и у фона: под растворяющейся линией не должно лежать
    // сплошного цвета, иначе она перестаёт растворяться.
    const solid = block.color || (gradientHasAlpha(block.gradient) ? '' : gradientFallback(block.gradient));
    const fill = gradCss
      ? `${solid ? `background:${esc(solid)};` : ''}background-image:${gradCss};`
      : `background:${esc(color)};`;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${widthPct}%" align="center" style="width:${widthPct}%;"><tr><td height="${thickness}" style="height:${thickness}px;line-height:${thickness}px;font-size:0;${fill}">&nbsp;</td></tr></table>`;
  },

  spacer(block) {
    const h = px(block.height, 24);
    // font-size:0 и &nbsp; вместе: без пробела Outlook схлопывает пустую ячейку,
    // без нулевого кегля — растягивает её до высоты строки.
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td height="${h}" style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr></table>`;
  },

  html(block) {
    // Осознанная дыра в общем правиле «в письмо попадает только то, что собрал
    // конструктор». Нужна для чужих сниппетов, которые иначе пришлось бы
    // воспроизводить блоками: счётчики, готовые карточки из внешних сервисов.
    // Содержимое не чистится — на том же доверии, на котором работает старый
    // режим «вставить готовый HTML», доступный тем же людям с тем же правом.
    return String(block.code ?? '');
  },

  /**
   * Шапка письма: логотип и, если нужно, строка под ним.
   *
   * Отдельный блок, а не картинка с текстом, по одной причине — цветная
   * подложка. Фон под логотипом задаётся на ячейке, и вместе с ним в Outlook
   * приходится дублировать цвет атрибутом bgcolor: стиль background он
   * применяет к ячейке не всегда, а bgcolor — всегда.
   */
  header(block, s, ctx) {
    const src = absoluteUrl(block.src, ctx.baseUrl);
    const width = px(block.logoWidth, 160);
    const a = align(block.align, 'center');
    const logo = src
      ? `<img src="${esc(src)}" width="${width}" alt="${esc(block.alt || s.senderName || '')}" style="display:block;border:0;outline:none;text-decoration:none;width:${width}px;max-width:100%;height:auto;">`
      : `<div style="font-family:${fontOf(block, s, ctx)};font-size:20px;font-weight:700;color:${esc(block.color || s.textColor)};">${esc(s.senderName || 'Логотип')}</div>`;

    const tagline = block.tagline
      // Подпись под логотипом идёт следом за цветом шапки, если свой не задан:
      // на тёмной полосе серый по умолчанию читается плохо.
      ? `<div style="font-family:${fontOf(block, s, ctx)};font-size:13px;line-height:1.5;color:${esc(block.mutedColor || block.color || s.mutedColor)};padding-top:10px;">${esc(block.tagline)}</div>`
      : '';

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${a}"><tr><td align="${a}">${logo}${tagline}</td></tr></table>`;
  },

  /**
   * Карточка акции — то, ради чего рассылку чаще всего и делают.
   *
   * Собрать её из картинки, текста и кнопки можно и вручную, но тогда каждое
   * письмо будет выравнивать цену и кнопку заново, и через месяц у сети будет
   * пять разных «акций» в одном фирменном стиле. Здесь порядок частей задан
   * один раз.
   *
   * Старая цена зачёркнута через <s> и повторена стилем: Outlook понимает тег,
   * но не всегда наследует text-decoration внутрь таблицы.
   */
  promo(block, s, ctx) {
    const inner = ctx.contentWidth - 32;
    const bg = block.bg || '#F7F7FA';
    const radius = px(block.radius, 14);
    const rows = [];

    const src = absoluteUrl(block.src, ctx.baseUrl);
    if (src) {
      rows.push(`<tr><td style="padding:0;"><img src="${esc(src)}" width="${inner + 32}" alt="${esc(block.alt || block.title || '')}" style="display:block;border:0;outline:none;text-decoration:none;width:${inner + 32}px;max-width:100%;height:auto;border-radius:${radius}px ${radius}px 0 0;"></td></tr>`);
    }

    // Плашка со скидкой. Отдельной строкой над заголовком, а не углом поверх
    // картинки: наложение в письме держится на отрицательных отступах, которые
    // Outlook понимает по-своему, и плашка уезжает на середину фотографии.
    if (block.badge) {
      rows.push(`<tr><td style="padding:16px 16px 0 16px;">`
        + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left"><tr>`
        + `<td bgcolor="${esc(block.badgeBg || '#FF3B30')}" style="border-radius:999px;background:${esc(block.badgeBg || '#FF3B30')};padding:5px 12px;font-family:${fontOf(block, s, ctx)};font-size:12px;font-weight:700;color:${esc(block.badgeColor || '#FFFFFF')};white-space:nowrap;">${esc(block.badge)}</td>`
        + `</tr></table></td></tr>`);
    }

    if (block.title) {
      rows.push(`<tr><td style="padding:${block.badge ? 10 : 18}px 16px 0 16px;font-family:${fontOf(block, s, ctx)};font-size:19px;line-height:1.3;font-weight:700;color:${inkOf(block, s)};">${esc(block.title)}</td></tr>`);
    }

    if (block.text) {
      rows.push(`<tr><td style="padding:8px 16px 0 16px;font-family:${fontOf(block, s, ctx)};font-size:14px;line-height:1.5;color:${inkOf(block, s)};">${esc(block.text)}</td></tr>`);
    }

    if (block.price || block.oldPrice) {
      const oldPrice = block.oldPrice
        ? `<span style="font-size:15px;color:${mutedOf(block, s)};text-decoration:line-through;"><s>${esc(block.oldPrice)}</s></span>&nbsp;&nbsp;`
        : '';
      const price = block.price
        ? `<span style="font-size:22px;font-weight:700;color:${esc(block.priceColor || block.color || s.textColor)};">${esc(block.price)}</span>`
        : '';
      rows.push(`<tr><td style="padding:14px 16px 0 16px;font-family:${fontOf(block, s, ctx)};">${oldPrice}${price}</td></tr>`);
    }

    if (block.buttonText) {
      const button = blockRenderers.button({
        type: 'button',
        text: block.buttonText,
        href: block.buttonHref,
        bg: block.buttonBg || s.linkColor,
        align: 'left',
      }, s, ctx);
      rows.push(`<tr><td style="padding:16px 16px 4px 16px;">${button}</td></tr>`);
    }

    rows.push(`<tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>`);

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${esc(bg)}" style="width:100%;background:${esc(bg)};border-radius:${radius}px;">${rows.join('')}</table>`;
  },

  /**
   * Список услуг с ценами.
   *
   * Две колонки в каждой строке: название слева, цена справа. На телефоне они
   * НЕ складываются в столбик, в отличие от блока «Колонки», — цена, уехавшая
   * под название, перестаёт читаться как цена этой строки. Поэтому у ячейки
   * цены фиксированная ширина, а переносится длинное название.
   */
  services(block, s, ctx) {
    const items = Array.isArray(block.items) ? block.items : [];
    if (!items.length) return '';
    const lineColor = block.lineColor || '#E5E5EA';

    const rows = items.map((item, i) => {
      const name = `<div style="font-family:${fontOf(block, s, ctx)};font-size:15px;line-height:1.4;color:${inkOf(block, s)};">${esc(item?.name || '')}</div>`
        + (item?.note ? `<div style="font-family:${fontOf(block, s, ctx)};font-size:12px;line-height:1.4;color:${mutedOf(block, s)};padding-top:2px;">${esc(item.note)}</div>` : '');
      const price = `<div style="font-family:${fontOf(block, s, ctx)};font-size:15px;font-weight:700;line-height:1.4;color:${inkOf(block, s)};white-space:nowrap;">${esc(item?.price || '')}</div>`;
      const border = i < items.length - 1 ? `border-bottom:1px solid ${esc(lineColor)};` : '';
      return `<tr>`
        + `<td valign="top" style="padding:10px 12px 10px 0;${border}">${name}</td>`
        + `<td valign="top" align="right" width="110" style="width:110px;padding:10px 0;${border}">${price}</td>`
        + `</tr>`;
    }).join('');

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">${rows}</table>`;
  },

  /**
   * Ссылки на соцсети.
   *
   * Плашки с названиями, а не иконки, и это выбор, а не упрощение. Иконка в
   * письме — внешняя картинка: половина клиентов не грузит её по умолчанию, и
   * вместо ряда кружков человек видит ряд пустых рамок. Надпись видна всегда,
   * в том числе в тексте письма у того, кто читает его голосом.
   */
  social(block, s, ctx) {
    const items = (Array.isArray(block.items) ? block.items : []).filter(i => i && i.href);
    if (!items.length) return '';
    const colors = { vk: '#0077FF', telegram: '#26A5E4', whatsapp: '#25D366', site: s.linkColor, phone: '#5856D6' };
    const labels = { vk: 'ВКонтакте', telegram: 'Telegram', whatsapp: 'WhatsApp', site: 'Сайт', phone: 'Позвонить' };

    const cells = items.map((item, i) => {
      const bg = item.color || colors[item.network] || s.linkColor;
      const label = esc(item.label || labels[item.network] || item.network || 'Ссылка');
      const href = safeUrl(withUtm(item.href, s));
      const gap = i ? `<td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>` : '';
      return `${gap}<td bgcolor="${esc(bg)}" style="border-radius:8px;background:${esc(bg)};">`
        + `<a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:9px 16px;font-family:${fontOf(block, s, ctx)};font-size:13px;font-weight:600;line-height:1.2;color:#FFFFFF;text-decoration:none;">${label}</a>`
        + `</td>`;
    }).join('');

    const a = align(block.align, 'center');
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${a}"><tr>${cells}</tr></table>`;
  },

  /**
   * Контакты медцентра.
   *
   * Не путать с обязательным подвалом: тот несёт отписку и сведения об
   * отправителе и добавляется сам. Этот блок — про то, куда прийти и куда
   * позвонить, и живёт там, где его поставил маркетолог.
   */
  contacts(block, s, ctx) {
    const ink = inkOf(block, s);
    const link = linkOf(block, s);
    const lines = [];
    if (block.title) lines.push(`<div style="font-size:15px;font-weight:700;color:${ink};padding-bottom:8px;">${esc(block.title)}</div>`);
    if (block.address) lines.push(`<div style="padding-bottom:4px;">${esc(block.address)}</div>`);
    if (block.hours) lines.push(`<div style="padding-bottom:4px;">${esc(block.hours)}</div>`);
    // Телефон ссылкой tel:, иначе на телефоне по нему нельзя позвонить нажатием,
    // а именно так им и пользуются.
    if (block.phone) {
      const digits = String(block.phone).replace(/[^\d+]/g, '');
      lines.push(`<div style="padding-bottom:4px;"><a href="tel:${esc(digits)}" style="color:${link};text-decoration:none;font-weight:600;">${esc(block.phone)}</a></div>`);
    }
    if (block.site) lines.push(`<div><a href="${safeUrl(withUtm(block.site, s))}" target="_blank" rel="noopener noreferrer" style="color:${link};text-decoration:underline;">${esc(block.site)}</a></div>`);
    if (!lines.length) return '';

    const a = align(block.align, 'center');
    return `<div style="font-family:${fontOf(block, s, ctx)};font-size:14px;line-height:1.5;color:${ink};text-align:${a};">${lines.join('')}</div>`;
  },

  /**
   * Баннер: заголовок и кнопка поверх фотографии.
   *
   * Самый «дизайнерский» приём, который вообще доживает до почтового клиента, и
   * самый капризный. Держится на трёх вещах сразу:
   *
   *   • атрибут background на <td> — его понимает старая почта;
   *   • background-image в стиле — современная;
   *   • VML-прямоугольник с fill type="frame" — Outlook на Windows, который не
   *     понимает ни первого в нужном виде, ни второго вовсе.
   *
   * Высота задаётся числом и это не лень: VML не умеет тянуться по содержимому,
   * ему нужен размер. Если текст не влезет, в Outlook он вылезет за картинку,
   * поэтому высота — видимое свойство блока, а не спрятанная константа.
   *
   * Затемнение поверх фото — полупрозрачный слой. В Outlook его не будет:
   * rgba поверх VML не ложится. Поэтому по умолчанию оно заметное, а цвет
   * подложки (bg) выбран тёмным — в Outlook текст ляжет на неё, если картинка
   * не загрузится.
   */
  hero(block, s, ctx) {
    const src = absoluteUrl(block.src, ctx.baseUrl);
    const width = ctx.contentWidth + 48;
    const height = px(block.height, 260);
    const bg = esc(block.bg || '#1C1C1E');
    const color = esc(block.color || '#FFFFFF');
    const overlay = Math.min(100, Math.max(0, px(block.overlay, 35)));

    const parts = [];
    if (block.title) {
      const titleCls = gradientTextClass(block.textGradient, ctx);
      const titleColor = block.color || gradientFallback(block.textGradient) || '#FFFFFF';
      parts.push(`<div${titleCls ? ` class="${titleCls}"` : ''} style="font-family:${fontOf(block, s, ctx)};font-size:${px(block.titleSize, 28)}px;line-height:1.25;font-weight:700;color:${esc(titleColor)};">${esc(block.title)}</div>`);
    }
    if (block.text) {
      parts.push(`<div style="font-family:${fontOf(block, s, ctx)};font-size:15px;line-height:1.5;color:${color};padding-top:10px;">${esc(block.text)}</div>`);
    }
    if (block.buttonText) {
      parts.push(`<div style="padding-top:18px;">${blockRenderers.button({
        type: 'button',
        text: block.buttonText,
        href: block.buttonHref,
        bg: block.buttonBg || s.linkColor,
        align: align(block.align, 'center'),
      }, s, ctx)}</div>`);
    }

    const content = `<div style="padding:28px 24px;text-align:${align(block.align, 'center')};">${parts.join('')}</div>`;

    // Затемнение — не слой поверх картинки, а ещё один слой В САМОМ фоне:
    // linear-gradient из одного цвета в себя же, положенный над url(). Слоем
    // внутри ячейки его сделать нельзя — он занимал бы высоту текста, а не всей
    // ячейки, и сверху с фотографией оставалась бы светлая полоса. Несколько
    // фоновых слоёв понимают все клиенты, где вообще работают фоновые картинки.
    // Затемнение бывает ровным и растворяющимся. Второе — обычный приём для
    // баннеров: текст внизу читается, а верх фотографии остаётся открытым.
    const a = (overlay / 100).toFixed(2);
    const shade = overlay > 0
      ? ({
        bottom: `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,${a}) 100%)`,
        top: `linear-gradient(to bottom, rgba(0,0,0,${a}) 0%, rgba(0,0,0,0) 100%)`,
      }[block.overlayStyle] || `linear-gradient(rgba(0,0,0,${a}), rgba(0,0,0,${a}))`)
      : '';
    const layers = [shade, src ? `url('${esc(src)}')` : ''].filter(Boolean).join(', ');

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
<tr><td align="center" height="${height}"${src ? ` background="${esc(src)}"` : ''} bgcolor="${bg}" valign="middle" style="height:${height}px;background-color:${bg};${layers ? `background-image:${layers};background-size:cover;background-position:center;` : ''}">
<!--[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${width}px;height:${height}px;"><v:fill ${src ? `type="frame" src="${esc(src)}" ` : ''}color="${bg}"/><v:textbox inset="0,0,0,0"><![endif]-->
${content}
<!--[if mso]></v:textbox></v:rect><![endif]-->
</td></tr></table>`;
  },

  /**
   * Текст с картинкой сбоку, которую он обтекает.
   *
   * В письме обтекание делается не float, а атрибутом align на самой картинке:
   * float половина клиентов игнорирует, а align понимают все, включая Outlook.
   * Стиль float ставится рядом — для тех, кто наоборот.
   *
   * На телефоне обтекание выключается и картинка встаёт во всю ширину: текст,
   * обтекающий картинку в 200px на экране в 320px, превращается в лесенку из
   * двух слов. За это отвечает класс aw-wrap-img и медиазапрос в шапке письма.
   */
  textimage(block, s, ctx) {
    const src = absoluteUrl(block.src, ctx.baseUrl);
    const side = block.side === 'right' ? 'right' : 'left';
    const imgWidth = Math.min(ctx.contentWidth - 80, Math.max(60, px(block.imageWidth, 200)));
    const gap = px(block.gap, 16);

    const img = src
      ? `<img class="aw-wrap-img" src="${esc(src)}" width="${imgWidth}" alt="${esc(block.alt || '')}" align="${side}" style="display:block;border:0;outline:none;text-decoration:none;width:${imgWidth}px;max-width:100%;height:auto;float:${side};${side === 'left' ? `margin:0 ${gap}px ${gap}px 0;` : `margin:0 0 ${gap}px ${gap}px;`}${block.radius ? `border-radius:${px(block.radius)}px;` : ''}">`
      : '';

    const style = [
      `font-family:${fontOf(block, s, ctx)}`,
      `font-size:${px(block.fontSize, s.fontSize)}px`,
      `line-height:${block.lineHeight || s.lineHeight}`,
      `color:${esc(block.color || s.textColor)}`,
      `text-align:${textAlign(block.align)}`,
      'mso-line-height-rule:exactly',
    ].join(';');

    // Распорка в конце схлопывает обтекание: без неё следующий блок заползает
    // под картинку, если текста оказалось меньше её высоты.
    return `<div style="${style}">${img}${richText(block.html, s, { indent: block.indent })}<div style="clear:both;font-size:0;line-height:0;">&nbsp;</div></div>`;
  },

  /**
   * Пункты с иконками.
   *
   * Иконкой может быть эмодзи или картинка, и эмодзи стоит первым не случайно.
   * Картинка в письме — внешний файл, который половина клиентов не грузит без
   * разрешения, и вместо ряда иконок человек видит ряд пустых рамок. Эмодзи —
   * это текст: он виден всегда, везде и сразу, и в почтовых рассылках это
   * давно рабочий приём, а не самодеятельность.
   */
  iconlist(block, s, ctx) {
    const items = Array.isArray(block.items) ? block.items : [];
    if (!items.length) return '';
    const size = px(block.iconSize, 28);
    const gap = px(block.gap, 14);

    const rows = items.map((item, i) => {
      const src = absoluteUrl(item?.image, ctx.baseUrl);
      const icon = src
        ? `<img src="${esc(src)}" width="${size}" alt="" style="display:block;border:0;width:${size}px;height:auto;">`
        : `<div style="font-size:${size}px;line-height:1;">${esc(item?.emoji || '•')}</div>`;

      const title = item?.title
        ? `<div style="font-family:${fontOf(block, s, ctx)};font-size:15px;font-weight:700;line-height:1.35;color:${inkOf(block, s)};">${esc(item.title)}</div>`
        : '';
      const text = item?.text
        ? `<div style="font-family:${fontOf(block, s, ctx)};font-size:14px;line-height:1.5;color:${mutedOf(block, s)};padding-top:${title ? 3 : 0}px;">${esc(item.text)}</div>`
        : '';

      const top = i ? `padding-top:${gap}px;` : '';
      return `<tr>`
        + `<td valign="top" width="${size + 14}" style="width:${size + 14}px;${top}">${icon}</td>`
        + `<td valign="top" style="${top}">${title}${text}</td>`
        + `</tr>`;
    }).join('');

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">${rows}</table>`;
  },

  /**
   * Подвал с отпиской — обычный блок палитры (ver. 8.43).
   *
   * Раньше он добавлялся сам и не убирался: для рассылки на внешние адреса
   * отписка — условие доставки, а не вежливость, и казалось правильным не дать
   * её снять. На практике это значило, что текст подвала правился в настройках
   * письма, которых никто не находил, а сам подвал висел там, где решил
   * рендерер, а не там, где нужно макету.
   *
   * Теперь это блок как все: его ставят, двигают, оформляют и — да — могут не
   * поставить вовсе. Проверка перед отправкой об этом скажет; решение остаётся
   * за отправителем.
   *
   * Неизменна ровно одна вещь: ссылка ведёт на {{unsubscribe_url}}, адрес
   * подставляется на отправке и у каждого получателя свой. Подпись у ссылки
   * любая, но пустую подменяем умолчанием — отписка без текста это отписка,
   * которую не найдут.
   */
  unsubscribe(block, s, ctx) {
    const color = esc(block.color || s.mutedColor);
    const linkColor = esc(block.linkColor || block.color || s.mutedColor);
    const label = String(block.linkText ?? '').trim() || 'Отписаться от рассылки';
    const size = px(block.fontSize, 12);

    const style = [
      `font-family:${fontOf(block, s, ctx)}`,
      `font-size:${size}px`,
      `line-height:${block.lineHeight || 1.5}`,
      `color:${color}`,
      `text-align:${textAlign(block.align, 'center')}`,
      'mso-line-height-rule:exactly',
    ].join(';');

    const text = String(block.html ?? '').trim()
      ? richText(block.html, s, { indent: block.indent })
      : '';

    const link = `<a href="{{unsubscribe_url}}" target="_blank" style="color:${linkColor};text-decoration:underline;">${esc(label)}</a>`;

    return `<div style="${style}">${text}<div style="padding-top:${text ? px(block.gap, 6) : 0}px;">${link}</div></div>`;
  },

  columns(block, s, ctx) {
    const cols = Array.isArray(block.columns) ? block.columns.filter(Boolean) : [];
    if (!cols.length) return '';
    const gap = px(block.gap, 16);
    const count = cols.length;
    const totalGap = gap * (count - 1);
    const usable = ctx.contentWidth - totalGap;

    // Доли колонок нормализуются к 100: маркетолог тянет ползунок, а сумма
    // должна сойтись в любом случае, иначе таблица разъедется.
    const rawWeights = cols.map(c => Math.max(1, Number(c.width) || Math.round(100 / count)));
    const weightSum = rawWeights.reduce((a, b) => a + b, 0);

    const cells = cols.map((col, i) => {
      const w = Math.floor((usable * rawWeights[i]) / weightSum);
      const inner = renderBlockList(col.blocks || [], s, { ...ctx, contentWidth: w });
      const spacer = i < count - 1
        ? `<td class="aw-gap" width="${gap}" style="width:${gap}px;font-size:0;line-height:0;">&nbsp;</td>`
        : '';
      return `<td class="aw-col" width="${w}" valign="${['top', 'middle', 'bottom'].includes(block.valign) ? block.valign : 'top'}" style="width:${w}px;">`
        + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${inner}</table>`
        + `</td>${spacer}`;
    }).join('');

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;"><tr>${cells}</tr></table>`;
  },
};

/**
 * Список блоков в строки таблицы.
 *
 * Фон и отступы живут на <td> каждого блока, поэтому блок, у которого свой
 * цвет фона, растягивает его на всю ширину письма сам, без обёрток.
 */
/**
 * ── Устройство документа, версия 2 ───────────────────────────────────────────
 *
 * Письмо — это список СЕКЦИЙ. У секции есть колонки, у колонки — блоки:
 *
 *   письмо → секция → колонка → блок
 *
 * Первая версия документа была плоской: список блоков, а колонки жили внутри
 * блока «Колонки». Так нельзя сделать главного, ради чего вообще нужна
 * структура, — цветной или градиентной полосы ВО ВСЮ ШИРИНУ письма, внутри
 * которой содержимое остаётся в своих 600 пикселях. Именно на этом стоит почти
 * любой почтовый макет: тёмная шапка от края до края, белое тело, серый подвал.
 *
 * Поэтому у секции два фона, и это не дублирование:
 *
 *   • background / gradient        — полоса во всю ширину окна почты;
 *   • innerBackground / innerGradient — фон содержимого в пределах 600px.
 *
 * Документы первой версии никуда не делись и продолжают открываться: toV2()
 * заворачивает каждый их блок в односекционную обёртку, а блок «Колонки» — в
 * секцию с такими же колонками. Вид письма при этом не меняется ни на пиксель,
 * что и проверяется тестом.
 */
const DOC_VERSION_2 = 2;

/** Документ любой версии → документ второй версии. */
function toV2(design) {
  const doc = design && typeof design === 'object' ? design : {};
  if (Array.isArray(doc.sections)) return doc;

  const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
  const sections = blocks.map((block) => {
    if (block?.type === 'columns') {
      return {
        id: block.id,
        gap: block.gap,
        valign: block.valign,
        padding: block.padding,
        background: block.background,
        gradient: block.gradient,
        columns: (block.columns || []).map(col => ({ ...col, blocks: col.blocks || [] })),
      };
    }
    // Оформление блока остаётся на блоке, секция — пустая обёртка нулевой
    // толщины. Так письмо первой версии выглядит ровно как раньше.
    return {
      id: block?.id,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      columns: [{ width: 100, blocks: [block] }],
    };
  });

  return { ...doc, version: DOC_VERSION_2, sections, blocks: undefined };
}

/**
 * Секция целиком: полоса во всю ширину, внутри неё контейнер, внутри — колонки.
 *
 * `first` и `last` нужны для скругления: круглыми должны быть внешние углы
 * письма, а не каждой секции по отдельности, иначе письмо превращается в стопку
 * карточек. Outlook скругления не покажет в любом случае.
 */
function renderSection(section, s, ctx, { first, last } = {}) {
  const width = px(s.width, DEFAULT_WIDTH);
  const cols = Array.isArray(section.columns) && section.columns.length
    ? section.columns
    : [{ width: 100, blocks: [] }];

  const outer = background(section);
  const inner = background({
    background: section.innerBackground ?? (section.transparent ? '' : s.cardBg),
    gradient: section.innerGradient,
  });

  const pad = padding(section, [0, 0, 0, 0]);
  const gap = px(section.gap, cols.length > 1 ? 16 : 0);
  const totalGap = gap * (cols.length - 1);

  // Ширина содержимого секции — ширина письма минус её собственные боковые
  // поля. От неё считаются картинки и доли колонок, поэтому она едет вниз.
  const innerWidth = width - (px(section.padding?.left, 0) + px(section.padding?.right, 0));
  const usable = innerWidth - totalGap;

  const weights = cols.map(c => Math.max(1, Number(c.width) || Math.round(100 / cols.length)));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const cells = cols.map((col, i) => {
    const w = Math.floor((usable * weights[i]) / weightSum);
    const colBg = background(col);
    const colPad = col.padding ? `padding:${padding(col, [0, 0, 0, 0])};` : '';
    const body = renderBlockList(col.blocks || [], s, { ...ctx, contentWidth: w - (px(col.padding?.left, 0) + px(col.padding?.right, 0)) });
    const spacer = i < cols.length - 1
      ? `<td class="aw-gap" width="${gap}" style="width:${gap}px;font-size:0;line-height:0;">&nbsp;</td>`
      : '';
    const valign = ['top', 'middle', 'bottom'].includes(col.valign || section.valign) ? (col.valign || section.valign) : 'top';
    return `<td class="aw-col" width="${w}" valign="${valign}"${colBg.bgcolor ? ` bgcolor="${colBg.bgcolor}"` : ''} style="width:${w}px;${colBg.css}${colPad}">`
      + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${body}</table>`
      + `</td>${spacer}`;
  }).join('');

  // Скругление внешних углов письма. Секция, которая не первая и не последняя,
  // остаётся прямоугольной — иначе между секциями появляются светлые просветы.
  const r = px(s.radius, 16);
  const radius = r
    ? `border-radius:${first ? `${r}px ${r}px` : '0 0'} ${last ? `${r}px ${r}px` : '0 0'};`
    : '';

  const container = `<table role="presentation" class="aw-card" width="${innerWidth}" cellpadding="0" cellspacing="0" border="0"${inner.bgcolor ? ` bgcolor="${inner.bgcolor}"` : ''} style="width:${innerWidth}px;max-width:${innerWidth}px;${inner.css}${radius}">`
    + `<tr>${cells}</tr></table>`;

  const cardBody = section.card ? cardWrap(container, section.card, s) : container;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${outer.bgcolor ? ` bgcolor="${outer.bgcolor}"` : ''} style="${outer.css}">
<tr><td align="center" style="padding:${pad};">
<!--[if mso]><table role="presentation" width="${innerWidth}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
${cardBody}
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>`;
}

function renderBlockList(blocks, s, ctx) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map((block) => {
    const renderer = blockRenderers[block?.type];
    if (!renderer) return '';

    // Собственные боковые поля блока вычитаются из доступной ширины: они живут
    // на ячейке, а картинка внутри считает свои 100% от того, что осталось.
    // Без этого картинка на всю ширину вылезала за письмо ровно на величину
    // своих же отступов.
    const inset = px(block.padding?.left, block.type === 'spacer' ? 0 : 24)
      + px(block.padding?.right, block.type === 'spacer' ? 0 : 24);
    const blockCtx = { ...ctx, contentWidth: Math.max(40, ctx.contentWidth - inset) };

    const body = cardWrap(renderer(block, s, blockCtx), block.card, s);
    if (!body) return '';
    const bg = background(OWNS_GRADIENT.has(block.type) ? { background: block.background } : block);
    const pad = padding(block, block.type === 'spacer' ? [0, 0, 0, 0] : undefined);
    return `<tr><td align="${align(block.align, 'left')}"${bg.bgcolor ? ` bgcolor="${bg.bgcolor}"` : ''} style="padding:${pad};${bg.css}">${body}</td></tr>`;
  }).join('');
}

/**
 * Скрытый текст превью.
 *
 * Именно его почтовый клиент показывает в списке писем следом за темой. Если
 * его не задать, туда уедет первая строка письма — чаще всего «Здравствуйте!»
 * или адрес картинки, и место, которое решает, откроют письмо или нет, уходит
 * впустую. Отбивка после текста нужна, чтобы клиент не дотянул в превью то,
 * что идёт дальше по письму, и не обрезал главное на полуслове.
 */
function renderPreheader(text) {
  if (!text) return '';
  const pad = '&#847;&zwnj;&nbsp;'.repeat(60);
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;">${esc(text)}${pad}</div>`;
}

/**
 * Медиазапрос — единственное, ради чего в письме остался <style>.
 *
 * Складывает колонки в столбик на телефоне. Outlook на Windows его не прочитает
 * и покажет десктопную раскладку: это ожидаемо и приемлемо, Outlook на телефоне
 * не бывает узким настолько, чтобы это мешало.
 */
function responsiveStyles(s, extra = []) {
  return `<style type="text/css">
${extra.join('\n')}
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; }
  a { color:${s.linkColor}; }
  @media only screen and (max-width:620px) {
    .aw-card { width:100% !important; max-width:100% !important; border-radius:0 !important; }
    .aw-col { display:block !important; width:100% !important; max-width:100% !important; }
    .aw-gap { display:none !important; width:0 !important; height:12px !important; }
    .aw-wrap-img { float:none !important; width:100% !important; margin:0 0 12px 0 !important; }
  }
</style>`;
}

/**
 * Документ конструктора → HTML письма с подстановками.
 *
 * Возвращает и предупреждения: то, что не мешает отправить, но о чём человеку
 * лучше узнать до, а не после. Проверки живут здесь, а не во фронтенде, потому
 * что считать их надо по тому же дереву, из которого собран HTML, — иначе они
 * разойдутся с письмом при первом же новом блоке.
 */
function render(design, options = {}) {
  // Документ первой версии поднимается до второй прямо здесь: письма и шаблоны
  // в базе никто пересобирать не будет, а рендер должен быть один.
  const doc = toV2(design);
  const s = { ...DEFAULT_SETTINGS, ...(doc.settings || {}) };
  const width = px(s.width, DEFAULT_WIDTH);
  const sections = Array.isArray(doc.sections) ? doc.sections : [];
  const ctx = {
    // Сюда блоки складывают правила, которым нельзя жить в атрибуте style, —
    // сейчас это градиент буквами. Собирается при обходе дерева, выводится
    // в <style> шапки; порядок важен, поэтому body считается до шаблона письма.
    styles: [],
    // Использованные веб-шрифты. Подключаются в шапке только те, что реально
    // встретились в письме.
    webFonts: new Set(),
    baseUrl: options.baseUrl || process.env.PUBLIC_BASE_URL || '',
    // Ширина содержимого — ширина письма минус боковые поля карточки. От неё
    // считаются картинки и колонки, поэтому она едет по дереву вниз.
    contentWidth: width - 48,
  };

  // Шрифт письма разрешается один раз и до обхода дерева: блоки без своего
  // шрифта берут именно его, и он же попадает в подвал и в служебные надписи.
  if (s.font && fonts.FONTS[s.font]) {
    s.fontFamily = fonts.fontStack(s.font);
    if (fonts.FONTS[s.font].web) ctx.webFonts.add(s.font);
  }

  const body = sections
    .map((section, i) => renderSection(section, s, ctx, { first: i === 0, last: i === sections.length - 1 }))
    .join('\n');
  const subject = esc(options.subject || '');

  const html = `<!DOCTYPE html>
<html lang="ru" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${subject}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
${fonts.webFontTags([...ctx.webFonts])}
${responsiveStyles(s, ctx.styles)}
</head>
<body style="margin:0;padding:0;background:${esc(s.bodyBg)};">
${renderPreheader(s.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${esc(s.bodyBg)};">
<tr><td align="center" style="padding:24px 0;">
<!--
  Общей карточки на всё письмо больше нет: полосу во всю ширину рисует каждая
  секция сама, а внутри держит содержимое в своих ${width}px. Без этого нельзя
  сделать тёмную шапку от края до края — а на ней стоит почти любой макет.
-->
${body}
</td></tr>
</table>
</body>
</html>`;

  return { html, warnings: inspect(doc, html, s, options) };
}

/**
 * Проверки перед отправкой.
 *
 * Ничего не запрещают — только называют. Запрет на отправку письма, которое
 * «кажется неправильным», кончается тем, что его отправляют в обход.
 */
function inspect(doc, html, s, options = {}) {
  const warnings = [];
  const blocks = [];
  const walk = (list) => {
    (Array.isArray(list) ? list : []).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      blocks.push(b);
      if (b.type === 'columns') (b.columns || []).forEach(c => walk(c.blocks));
    });
  };
  (Array.isArray(doc.sections) ? doc.sections : []).forEach((section) => {
    (section?.columns || []).forEach(col => walk(col.blocks));
  });

  if (!blocks.length) warnings.push('Письмо пустое — в нём нет ни одного блока.');
  if (!String(options?.subject || '').trim()) warnings.push('Не заполнена тема письма.');
  if (!String(s.preheader || '').trim()) {
    warnings.push('Не заполнен текст превью. Почтовый клиент покажет рядом с темой первую строку письма — обычно это не то, что нужно.');
  }
  // Блок отписки необязателен — так решил отправитель, и запрещать нельзя.
  // Но сказать надо: для рассылки на внешние адреса это не вежливость, а
  // условие доставки. Gmail с 2024 года требует отписку от отправителей свыше
  // 5000 писем в сутки и иначе роняет в спам весь домен, а не одно письмо.
  if (!blocks.some(b => b.type === 'unsubscribe')) {
    warnings.push('В письме нет блока отписки. Для рассылки на внешние адреса это условие доставки: без работающей отписки письма уходят в спам целиком.');
  }

  // Веб-шрифт — не гарантия, а пожелание: Gmail и Outlook его вырежут. Сказать
  // об этом надо заранее, потому что на холсте письмо будет выглядеть иначе,
  // чем у половины получателей.
  const usedWebFonts = new Set();
  const collectFont = (b) => { if (b?.font && WEB_FONT_KEYS.has(b.font)) usedWebFonts.add(b.font); };
  blocks.forEach(collectFont);
  if (s.font && WEB_FONT_KEYS.has(s.font)) usedWebFonts.add(s.font);
  if (usedWebFonts.size) {
    const names = [...usedWebFonts].map(k => fonts.FONTS[k].label).join(', ');
    warnings.push(`Веб-шрифты (${names}) не покажут Gmail и Outlook — там письмо будет набрано запасным шрифтом из того же стека.`);
  }

  const noAlt = blocks.filter(b => ['image', 'textimage'].includes(b.type) && b.src && !String(b.alt || '').trim()).length;
  if (noAlt) {
    warnings.push(`Картинок без подписи (alt): ${noAlt}. Многие клиенты не грузят картинки по умолчанию, и вместо них человек увидит пустоту.`);
  }

  const emptyLinks = blocks.filter(b => b.type === 'button' && !String(b.href || '').trim()).length
    + blocks.filter(b => ['promo', 'hero'].includes(b.type) && b.buttonText && !String(b.buttonHref || '').trim()).length;
  if (emptyLinks) warnings.push(`Кнопок без ссылки: ${emptyLinks}. Нажатие по такой кнопке никуда не ведёт.`);

  const noSrc = blocks.filter(b => ['image', 'header', 'hero', 'textimage'].includes(b.type) && !String(b.src || '').trim()).length;
  if (noSrc) warnings.push(`Блоков с картинкой, в которые файл не загружен: ${noSrc}.`);

  // http вместо https: почтовые клиенты и антивирусы помечают такие ссылки как
  // небезопасные, а часть корпоративных шлюзов режет письмо целиком.
  const insecure = new Set();
  const collectLinks = (b) => [b.href, b.buttonHref, b.site, ...(b.items || []).map(i => i?.href)]
    .concat(String(b.html || '').match(/href="([^"]+)"/g) || [])
    .filter(Boolean);
  blocks.forEach((b) => {
    collectLinks(b).forEach((raw) => {
      const url = String(raw).replace(/^href="|"$/g, '');
      if (/^http:\/\//i.test(url)) insecure.add(url);
    });
  });
  if (insecure.size) {
    warnings.push(`Ссылок по незащищённому http: ${insecure.size}. Почтовые клиенты помечают такие как небезопасные — замените на https.`);
  }

  // Gmail обрезает письмо тяжелее ~102 КБ и вешает «Показать полностью»,
  // а вместе с обрезанным хвостом теряется и отписка внизу.
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > 102 * 1024) {
    warnings.push(`Письмо весит ${Math.round(bytes / 1024)} КБ. Gmail обрезает всё тяжелее 102 КБ и прячет хвост под «Показать полностью» — вместе с отпиской.`);
  }

  return warnings;
}

/**
 * Подстановка значений получателя в уже отрендеренный HTML.
 *
 * Второй шаг рендера: вызывается в цикле отправки, по разу на адрес.
 *
 * ── Что здесь подставляется и почему только это ──────────────────────────────
 *
 * Только `unsubscribe_url` — адрес отписки, у каждого получателя свой. Ради
 * него письмо и собирается в два шага: общая разметка один раз, подстановка на
 * каждого.
 *
 * Обращение по имени и подстановка медцентра были и убраны: пользоваться ими
 * не стали, а держать в письме механизм, который у половины получателей
 * подставляет пустоту (имени в файле может не быть), значит однажды
 * поздороваться с человеком его же почтовым адресом.
 *
 * Неизвестные подстановки остаются в тексте как есть, а не вычищаются. Раньше
 * они молча превращались в пустоту, и это было правильно, пока подстановки были
 * функцией. Теперь фигурные скобки в письме — просто текст, который написал
 * человек, и съедать его нельзя.
 */
function personalize(html, vars = {}) {
  return String(html ?? '').replace(/\{\{([a-z_]+)\}\}/gi, (match, key) => {
    const name = String(key).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return match;
    const value = vars[name];
    if (value === undefined || value === null) return '';
    // Адрес отписки уходит в href, где экранировать надо иначе, чем текст:
    // амперсанд в query-строке ломается от общего esc().
    return name.endsWith('_url')
      ? String(value).replace(/"/g, '%22').replace(/</g, '%3C')
      : esc(value);
  });
}

module.exports = {
  DOC_VERSION,
  DOC_VERSION_2,
  toV2,
  DEFAULT_SETTINGS,
  render,
  personalize,
  esc,
  safeUrl,
  absoluteUrl,
};
