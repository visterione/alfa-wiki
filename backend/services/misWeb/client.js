'use strict';

/**
 * Клиент веб-интерфейса МИС Renovatio (ver. 9.12).
 *
 * У «Кассы → Выгрузка по услугам» нет метода в API МИС, поэтому ходим туда,
 * куда ходит браузер бухгалтера. Сначала планировали headless-браузер, но
 * разведка показала, что он не нужен: вход — обычная форма Yii, а кнопка
 * «Скачать» собирает параметры фильтра в GET и уходит на
 * /payment/api/downloadInvoiceServices, который сразу отдаёт xlsx. Chromium
 * на сервере был бы лишней сотней мегабайт и лишним способом сломаться.
 *
 * Вход двухшаговый: логин с паролем, затем код из письма. Код читает человек,
 * а не робот, — учётка личная, и почта при ней тоже личная. Поэтому здесь
 * только механика шагов, а кто и когда вводит код, решает session.js.
 */

const axios = require('axios');

const BASE_URL = (process.env.MIS_WEB_URL || 'https://rnova.medcentralfa.ru:3010').replace(/\/+$/, '');

// МИС отвечает на запрос выгрузки только когда файл готов целиком: заголовки
// приходят вместе с телом. Месяц «Альфы» со всеми полями собирался 218 секунд,
// так что запас в двадцать минут не чрезмерен.
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;
const PAGE_TIMEOUT_MS = 60 * 1000;

// Строка обычного браузера. Без неё часть серверов отдаёт упрощённую страницу,
// и разбирать пришлось бы не ту форму, которую видит человек.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

class MisSessionExpiredError extends Error {
  constructor(message = 'Сессия МИС закончилась — нужно войти заново') {
    super(message);
    this.code = 'MIS_SESSION_EXPIRED';
  }
}

class MisLoginError extends Error {
  constructor(message) {
    super(message);
    this.code = 'MIS_LOGIN_FAILED';
  }
}

/**
 * Куки храним сами, без tough-cookie: у МИС их три, домен один, и полноценный
 * разбор путей и доменов здесь ничего бы не дал, кроме зависимости.
 */
class CookieJar {
  constructor(entries) {
    this.map = new Map(Object.entries(entries || {}));
  }

  absorb(setCookie) {
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const line of list) {
      const [pair, ...attrs] = String(line).split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      // PHP стирает куку, выставляя её в deleted с датой в прошлом.
      const expired = value === 'deleted'
        || attrs.some(a => /^\s*max-age\s*=\s*(0|-\d+)\s*$/i.test(a));
      if (expired) this.map.delete(name);
      else this.map.set(name, value);
    }
  }

  header() {
    return [...this.map].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  toJSON() {
    return Object.fromEntries(this.map);
  }

  get size() {
    return this.map.size;
  }
}

async function request(jar, method, path, { form, params, timeout = PAGE_TIMEOUT_MS, binary = false, signal } = {}) {
  const res = await axios({
    method,
    url: BASE_URL + path,
    params,
    data: form ? new URLSearchParams(form).toString() : undefined,
    headers: {
      'User-Agent': USER_AGENT,
      ...(jar.size ? { Cookie: jar.header() } : {}),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    // Редиректы разбираем сами: по тому, куда МИС отправляет, мы и понимаем,
    // жива ли сессия. Автоматический переход спрятал бы ответ.
    maxRedirects: 0,
    validateStatus: () => true,
    responseType: binary ? 'arraybuffer' : 'text',
    // Параметры фильтра МИС ждёт в виде InvoiceServicesExportGrid[clinics][]=2,
    // а не в той записи массивов, которую axios строит сам.
    paramsSerializer: p => (p instanceof URLSearchParams ? p : new URLSearchParams(p)).toString(),
    timeout,
    signal,
  });
  jar.absorb(res.headers['set-cookie']);
  return res;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
}

/**
 * Поля формы входа. HTML-парсер ради одной формы Yii тащить не стали: форма
 * плоская, инпуты в ней однострочные, а регулярку проверяют тесты на снимке
 * настоящей страницы. Кнопку отправки возвращаем отдельно — по её наличию в
 * запросе МИС отличает «проверить код» от «прислать код ещё раз».
 */
function parseLoginForm(html) {
  const formMatch = String(html).match(/<form[^>]*id=["']login-form["'][^>]*>([\s\S]*?)<\/form>/i);
  if (!formMatch) return null;
  const body = formMatch[1];
  const fields = {};
  let submit = null;
  for (const [tag] of body.matchAll(/<(input|button)\b[^>]*>/gi)) {
    const name = attr(tag, 'name');
    if (!name) continue;
    const type = (attr(tag, 'type') || (tag.toLowerCase().startsWith('<button') ? 'submit' : 'text')).toLowerCase();
    const value = attr(tag, 'value') ?? '';
    if (type === 'submit') submit = { name, value };
    else fields[name] = value;
  }
  return { fields, submit, hasCode: 'LoginForm[code]' in fields };
}

/**
 * Текст ошибки со страницы входа. Разметку ошибок МИС не документирует, так что
 * берём всё, что помечено классами ошибок Yii и Bootstrap, и склеиваем.
 */
function extractLoginError(html) {
  const out = [];
  const re = /<(div|span|p)[^>]*class=["'][^"']*(errorMessage|errorSummary|help-block|alert-danger|error)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of String(html).matchAll(re)) {
    const text = decodeEntities(m[3].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out.join('. ');
}

function isLoginRedirect(res) {
  return res.status >= 300 && res.status < 400 && /\/site\/login/.test(res.headers.location || '');
}

/**
 * Проходит цепочку переходов после принятого кода. МИС после входа ведёт на
 * выбор клиники; сессия без выбранной клиники на части страниц снова
 * отправляет туда же, поэтому выбор делаем сами — ровно как это сделал бы
 * человек, кликнув первую клинику в списке.
 */
async function settleAfterLogin(jar, location) {
  let next = location;
  for (let hop = 0; hop < 8 && next; hop++) {
    const path = next.startsWith('http') ? new URL(next).pathname + new URL(next).search : next;
    const res = await request(jar, 'GET', path);
    if (res.status >= 300 && res.status < 400) {
      next = res.headers.location;
      continue;
    }
    if (/\/common\/default\/clinic/.test(path)) {
      const m = String(res.data).match(/\/common\/default\/selectClinic\/id\/(\d+)/);
      if (m) {
        next = `/common/default/selectClinic/id/${m[1]}`;
        continue;
      }
    }
    return;
  }
}

/**
 * Шаг 1: логин и пароль. Возвращает либо готовую сессию (если 2FA для учётки
 * вдруг отключат), либо заготовку для шага с кодом.
 */
async function beginLogin(username, password) {
  const jar = new CookieJar();
  const page = await request(jar, 'GET', '/site/login');
  const form = parseLoginForm(page.data);
  if (!form) throw new MisLoginError(`МИС не показала форму входа (HTTP ${page.status})`);

  const res = await request(jar, 'POST', '/site/login', {
    form: {
      ...form.fields,
      'LoginForm[username]': username,
      'LoginForm[password]': password,
      ...(form.submit ? { [form.submit.name]: form.submit.value } : {}),
    },
  });

  if (res.status >= 300 && res.status < 400 && !isLoginRedirect(res)) {
    await settleAfterLogin(jar, res.headers.location);
    return { done: true, jar };
  }

  const next = parseLoginForm(res.data);
  if (next && next.hasCode) {
    // Пароль МИС кладёт в эту форму скрытым полем и ждёт его обратно вместе с
    // кодом. Отсюда он уходит только в память процесса (session.js), в базу —
    // никогда.
    return { done: false, jar, fields: next.fields, submit: next.submit };
  }
  throw new MisLoginError(extractLoginError(res.data) || 'МИС не приняла логин или пароль');
}

/**
 * Шаг 2: код из письма. При неверном коде МИС снова показывает форму, со
 * свежим CSRF-токеном, — возвращаем её, чтобы следующая попытка шла с ним.
 */
async function submitCode(pending, code) {
  const { jar } = pending;
  const res = await request(jar, 'POST', '/site/login', {
    form: {
      ...pending.fields,
      'LoginForm[code]': String(code).trim(),
      ...(pending.submit ? { [pending.submit.name]: pending.submit.value } : {}),
    },
  });

  if (res.status >= 300 && res.status < 400 && !isLoginRedirect(res)) {
    await settleAfterLogin(jar, res.headers.location);
    return { done: true, jar };
  }

  const next = parseLoginForm(res.data);
  const message = extractLoginError(res.data) || 'МИС не приняла код';
  if (next && next.hasCode) {
    return { done: false, jar, fields: next.fields, submit: next.submit, error: message };
  }
  throw new MisLoginError(message);
}

/**
 * «Отправить код повторно» — тот же POST, но без кода и без кнопки. Так его
 * отправляет сама страница МИС: это видно в записи входа, другого признака
 * у запроса нет.
 */
async function resendCode(pending) {
  const { jar } = pending;
  const fields = { ...pending.fields };
  delete fields['LoginForm[code]'];
  const res = await request(jar, 'POST', '/site/login', { form: fields });
  const next = parseLoginForm(res.data);
  if (!next || !next.hasCode) {
    throw new MisLoginError(extractLoginError(res.data) || 'МИС не отправила код повторно');
  }
  return { done: false, jar, fields: next.fields, submit: next.submit };
}

async function isAlive(jar) {
  const res = await request(jar, 'GET', '/payment/income/services');
  if (isLoginRedirect(res)) return false;
  return res.status === 200 && !/id=["']login-form["']/.test(String(res.data));
}

function toMisDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// Все поля «Отображаемых полей» по порядку, от «№ счета» (0) до «Кабинет»
// (50). Галочки на странице роботу не нужны: они лишь собирают этот же список
// перед переходом на адрес выгрузки.
const ALL_COLUMNS = Array.from({ length: 51 }, (_, i) => i);

/**
 * Выгрузка по одной клинике за один отрезок. Возвращает содержимое xlsx.
 * dateType: 1 — по дате выставления счёта, 2 — по дате оплаты.
 */
async function downloadServices(jar, { dateFrom, dateTo, dateType = 2, clinicId, columns = ALL_COLUMNS, signal }) {
  const q = new URLSearchParams();
  q.append('InvoiceServicesExportGrid[period]', 'custom');
  q.append('InvoiceServicesExportGrid[custom_dates]', `${toMisDate(dateFrom)} - ${toMisDate(dateTo)}`);
  q.append('InvoiceServicesExportGrid[dateType]', String(dateType));
  q.append('InvoiceServicesExportGrid[clinics][]', String(clinicId));
  for (const c of columns) q.append('excelColumns[]', String(c));
  // Сортировку и total страница берёт из таблицы на экране. Пустые значения
  // проверены на полном месяце: файл приходит целиком.
  q.append('orderBy', '');
  q.append('orderDir', '');
  q.append('total', '');

  const res = await request(jar, 'GET', '/payment/api/downloadInvoiceServices', {
    params: q, binary: true, timeout: DOWNLOAD_TIMEOUT_MS, signal,
  });

  if (isLoginRedirect(res)) throw new MisSessionExpiredError();
  const buf = Buffer.from(res.data || []);
  // xlsx — это zip, он всегда начинается с «PK». Всё остальное — HTML с
  // ошибкой или со страницей входа, и сохранять его как источник нельзя.
  if (res.status === 200 && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) return buf;

  const text = buf.toString('utf8');
  if (/id=["']login-form["']/.test(text)) throw new MisSessionExpiredError();

  // Без сессии API МИС не отправляет на вход, а отвечает JSON с кодом 403 —
  // тем же, что и при живой сессии без прав на выгрузку. Различить их можно
  // только отдельным вопросом, пускает ли нас МИС вообще.
  let json = null;
  try { json = JSON.parse(text); } catch { /* не JSON — разберём ниже как текст */ }
  if (json?.error) {
    const desc = json.data?.desc || 'МИС отказала в выгрузке';
    if (String(json.data?.code) === '403' && !(await isAlive(jar))) throw new MisSessionExpiredError();
    throw new Error(`МИС: ${desc}`);
  }

  const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  throw new Error(`МИС вернула не файл (HTTP ${res.status})${snippet ? `: ${snippet}` : ''}`);
}

module.exports = {
  BASE_URL,
  CookieJar,
  MisSessionExpiredError,
  MisLoginError,
  parseLoginForm,
  extractLoginError,
  beginLogin,
  submitCode,
  resendCode,
  isAlive,
  downloadServices,
  toMisDate,
  ALL_COLUMNS,
};
