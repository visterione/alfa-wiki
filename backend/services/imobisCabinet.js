'use strict';

/**
 * Личный кабинет Имобиса: вход по логину, счета и отчёт о расходах (ver. 9.33).
 *
 * Их API v3 отдаёт про деньги только остаток (/balance). Счёт на пополнение и
 * расходы по дням есть лишь в кабинете, и раньше их доставали руками: шесть
 * учётных записей, в каждую зайти, выписать счёт, скачать PDF. Здесь то же самое
 * делает сервер.
 *
 * БРАУЗЕРА НЕТ, И ЭТО НАМЕРЕННО. Путь разобран по записи живой сессии: вход —
 * обычная форма Laravel, дальше цепочка OAuth-переадресаций, а бухгалтерия и
 * отчёты — старый сайт sms.imobis.ru на серверных формах без скриптов. Всё это
 * проходится простыми запросами с банкой cookie, и Chromium на боевом сервере
 * ради шести форм не нужен.
 *
 * ПОЧЕМУ У КАЖДОГО ВХОДА СВОЯ БАНКА. Кабинет — это два сайта: новый
 * app.imobis.ru (вход, дашборд) и старый sms.imobis.ru (счета, отчёты). «Выйти»
 * гасит сессию только нового, cookie старого (PHPSESSID, authcheck) живёт
 * дальше. В браузере это выглядело так: входишь во второй аккаунт, а счета
 * выписываются на первый — так на ns459923 и легли два лишних счёта. Отсюда
 * правило: сессия создаётся на один аккаунт и выбрасывается, а номер каждого
 * выписанного счёта сверяется с логином (номер у Имобиса оканчивается на него).
 */

const iconv = require('iconv-lite');

const AUTH = 'https://auth.imobis.ru';
const SMS = 'https://sms.imobis.ru';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const TIMEOUT = 45000;
const MAX_REDIRECTS = 15;

class CabinetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CabinetError';
  }
}

// ── Банка cookie ──────────────────────────────────────────────────────────
//
// Своя, а не пакет: нужно ровно три правила — домен, хост-онли и удаление
// протухшей. Путь и Secure не различаем: все cookie кабинета лежат на «/», а
// http-переадресации мы сами поднимаем до https (см. request ниже).

class CookieJar {
  constructor() {
    this.items = [];
  }

  store(host, setCookies) {
    for (const line of setCookies) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();

      let domain = host;
      let hostOnly = true;
      let expired = false;
      for (const attr of attrs) {
        const [k, v = ''] = attr.split('=');
        const key = k.trim().toLowerCase();
        if (key === 'domain' && v.trim()) {
          domain = v.trim().replace(/^\./, '').toLowerCase();
          hostOnly = false;
        } else if (key === 'max-age' && Number(v) <= 0) {
          expired = true;
        } else if (key === 'expires' && Date.parse(v) < Date.now()) {
          expired = true;
        }
      }

      this.items = this.items.filter(c => !(c.name === name && c.domain === domain));
      if (!expired) this.items.push({ name, value, domain, hostOnly });
    }
  }

  header(host) {
    return this.items
      .filter(c => (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith(`.${c.domain}`)))
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
  }
}

// ── Сессия одного аккаунта ────────────────────────────────────────────────

class CabinetSession {
  constructor(login) {
    this.login = login;
    this.jar = new CookieJar();
  }

  /**
   * Запрос с ручным проходом переадресаций: fetch сам cookie между шагами не
   * переносит, а без них OAuth-цепочка возвращает на страницу входа.
   */
  async request(url, { method = 'GET', form = null, headers = {} } = {}) {
    let current = url;
    let currentMethod = method;
    let body = form ? new URLSearchParams(form).toString() : null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Кабинет местами переадресует на http://auth.imobis.ru — по открытому
      // каналу ушла бы cookie сессии. Поднимаем до https сами: тот же адрес
      // сервер всё равно переадресует туда следующим шагом.
      current = current.replace(/^http:\/\/([\w.-]*imobis\.ru)/i, 'https://$1');
      const { host } = new URL(current);

      const reqHeaders = { 'User-Agent': UA, Accept: '*/*', ...headers };
      const cookie = this.jar.header(host);
      if (cookie) reqHeaders.Cookie = cookie;
      if (body != null) reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';

      const res = await fetch(current, {
        method: currentMethod,
        headers: reqHeaders,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT)
      });
      this.jar.store(host, res.headers.getSetCookie());

      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        // После 301–303 браузер переходит GET'ом без тела; 307/308 у них не
        // встречались, но повторяем и их правило, чтобы не гадать.
        if (res.status !== 307 && res.status !== 308) {
          currentMethod = 'GET';
          body = null;
        }
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      return { status: res.status, url: current, headers: res.headers, buffer, text: () => buffer.toString('utf8') };
    }
    throw new CabinetError('Кабинет Имобиса зациклил переадресации');
  }

  /**
   * Вход и проход на старый сайт. После него сессия годится и для счетов, и
   * для отчётов: оба живут на sms.imobis.ru.
   */
  async signIn(password) {
    const page = await this.request(`${AUTH}/login`);
    const token = (page.text().match(/name="_token"\s+value="([^"]+)"/) || [])[1];
    if (!token) throw new CabinetError('Страница входа Имобиса изменилась: не найден _token формы');

    const after = await this.request(`${AUTH}/login`, {
      method: 'POST',
      form: { _token: token, name: this.login, password }
    });
    // Неверный пароль возвращает на ту же форму входа — ответ при этом 200.
    if (/\/login(\?|$)/.test(new URL(after.url).pathname + new URL(after.url).search)) {
      throw new CabinetError('Кабинет не пустил: неверный логин или пароль');
    }

    // Старый сайт заводит свою сессию через тот же OAuth: первый заход на него
    // сам уходит на auth.imobis.ru и возвращается с кодом.
    const books = await this.request(`${SMS}/bookkeeping/payments_co`);
    if (new URL(books.url).host !== 'sms.imobis.ru') {
      throw new CabinetError('Вход прошёл, но раздел счетов не открылся');
    }
  }

  // ── Счета ───────────────────────────────────────────────────────────────

  /**
   * Список счетов за период: номер, дата, статус. Отвечает XML с куском HTML
   * таблицы внутри — разбор в parsePayments.
   */
  async payments(from, to) {
    const res = await this.request(`${SMS}/bookkeeping/payments_co?process=loadPayments`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      form: {
        filterBank: 'on',
        filterElectro: 'off',
        filterQuittance: 'on',
        filterDateFrom: ruDate(from),
        filterDateTo: ruDate(to),
        page: '1'
      }
    });
    return parsePayments(res.text());
  }

  /**
   * Выписать счёт по безналу и скачать PDF.
   *
   * Повторяет три шага мастера «Пополнить баланс»: сумма → способ оплаты и
   * плательщик → готовый счёт. Почта и параметры автоплатежа уходят теми, что
   * форма подставила сама: автоплатёж выключен отсутствием галки
   * autopay_enable, ровно как в браузере.
   */
  async createInvoice(amount) {
    const sum = String(Math.round(amount));

    await this.request(`${SMS}/bookkeeping/payments_co?process=new`);
    const step2 = await this.request(`${SMS}/bookkeeping/payments_co?process=new&step=2`, {
      method: 'POST',
      form: { 'payment[pm_credit]': sum, doSave: 'Далее' }
    });
    const form = parsePayerForm(step2.text());
    if (!form.payers.length) throw new CabinetError('В кабинете нет действующего плательщика — счёт выписать не на кого');
    // Плательщик у каждого аккаунта один — юрлицо медцентра. Если их станет
    // несколько, выбирать наугад нельзя: счёт уйдёт не тому юрлицу, и видно это
    // будет только бухгалтерии.
    if (form.payers.length > 1) {
      throw new CabinetError(`В кабинете несколько плательщиков (${form.payers.map(p => p.name).join(', ')}) — выпишите счёт вручную`);
    }
    const payer = form.payers[0];

    const step3 = await this.request(`${SMS}/bookkeeping/payments_co?process=new&step=3`, {
      method: 'POST',
      form: {
        pmType: 'B',
        currency: 'B',
        contentOnly: '1',
        email: payer.email,
        payment_payer_id: payer.id,
        outsum: sum,
        autopay_amount: form.autopayAmount,
        autopay_threshold: form.autopayThreshold,
        autopay_expire_month: form.autopayExpireMonth,
        autopay_expire_year: form.autopayExpireYear
      }
    });

    const number = invoiceNumberFrom(step3.url) || invoiceNumberFrom(step3.text());
    if (!number) throw new CabinetError('Счёт, похоже, создан, но номер не найден — проверьте раздел счетов в кабинете');
    // Та самая путаница аккаунтов, ради которой всё и затевалось: счёт должен
    // принадлежать тому логину, под которым вошли.
    if (!number.toLowerCase().endsWith(`/${this.login.toLowerCase()}`)) {
      throw new CabinetError(`Счёт ${number} выписан не на ${this.login}`);
    }

    const pdf = await this.invoicePdf(number);
    return { number, payer: payer.name, pdf };
  }

  async invoicePdf(number) {
    const res = await this.request(`${SMS}/bookkeeping/payments?process=getText&number=${number}`);
    if (res.buffer.subarray(0, 4).toString() !== '%PDF') {
      throw new CabinetError(`Кабинет не отдал PDF счёта ${number}`);
    }
    return res.buffer;
  }

  // ── Расходы ─────────────────────────────────────────────────────────────

  /**
   * Краткий отчёт «Центра отчётов» за период: строка на день × оператор (для
   * трафика API) или на рассылку. Телефонов и текстов в нём нет — в отличие от
   * полного отчёта, который поэтому и не запрашиваем.
   */
  async spendReport(from, to) {
    await this.request(`${SMS}/sms/statistics/reportcenter/`);
    const res = await this.request(`${SMS}/sms/statistics/reportcenter/`, {
      method: 'POST',
      form: {
        dateFrom: `${ruDate(from)} 00:00`,
        dateTo: `${ruDate(to)} 23:59`,
        getSummary: 'Скачать краткий отчёт'
      }
    });
    // Отчёт в windows-1251, как и всё на старом сайте.
    const text = iconv.decode(res.buffer, 'win1251');
    if (!/^﻿?Логин;/.test(text)) throw new CabinetError('Кабинет не отдал краткий отчёт о расходах');
    return parseSpendReport(text);
  }
}

// ── Разбор ответов ────────────────────────────────────────────────────────
//
// Вынесен в чистые функции ради тестов: вёрстка кабинета поменяется раньше,
// чем что-либо ещё, и ломаться должно здесь, с внятной причиной.

/** 'YYYY-MM-DD' → 'DD.MM.YYYY', как ждут формы кабинета. */
function ruDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

const stripTags = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const toNumber = (s) => {
  const n = parseFloat(String(s || '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

function invoiceNumberFrom(s) {
  const m = String(s || '').match(/number=(\d+[A-Za-z]\/[\w.-]+)/);
  return m ? m[1] : null;
}

function parsePayerForm(html) {
  const payers = [];
  for (const m of html.matchAll(/<option class="payer-status-active" value="(\d+)"[^>]*>([^<]*)/g)) {
    const id = m[1];
    const email = (html.match(new RegExp(`id="rowpayer-${id}-email" value="([^"]*)"`)) || [])[1] || '';
    payers.push({ id, name: m[2].trim(), email });
  }
  const valueOf = (id, fallback) => (html.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`)) || [])[1] || fallback;
  return {
    payers,
    autopayAmount: valueOf('autopayAmount', '500.00'),
    autopayThreshold: valueOf('autopayThreshold', '500.00'),
    autopayExpireMonth: valueOf('autopayExpireMonth', ''),
    autopayExpireYear: valueOf('autopayExpireYear', '')
  };
}

/**
 * Строки таблицы платежей. Столбцы: номер, дата, статус, SMS/цена, кредит…
 * Статус берём текстом: «Оплачен» зелёным, остальное — как есть.
 */
function parsePayments(xml) {
  const rows = [];
  for (const tr of xml.split(/<tr[\s>]/).slice(1)) {
    const number = invoiceNumberFrom(tr.match(/process=stat&(?:amp;)?number=[^"'&]+/)?.[0]);
    if (!number) continue;
    const cells = tr.split(/(?=<td[\s>])/).filter(c => c.startsWith('<td')).map(stripTags);
    const date = (tr.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || null;
    const status = cells[2] || '';
    rows.push({
      number,
      date,
      status,
      paid: /оплачен/i.test(status) && !/не\s*оплачен/i.test(status)
    });
  }
  return rows;
}

/** Строка CSV с «;» и кавычками, где "" внутри поля — это одна кавычка. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Краткий отчёт → расход по дням { 'YYYY-MM-DD': { cost, messages, operators } }.
 *
 * Столбцы ищутся по названию, а не по номеру: отчёт выгружается для людей, и
 * столбец туда добавят, не спросив нас. День — по «Времени старта»: трафик API
 * у них и так сложен в строку на сутки («Трафик за 01.09.2026»), а рассылку из
 * кабинета честнее отнести ко дню, когда её запустили.
 */
function parseSpendReport(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return {};
  const head = splitCsvLine(lines[0]).map(h => h.trim());
  const col = (name) => head.findIndex(h => h.toLowerCase().startsWith(name));
  const iStart = col('время старта');
  const iCost = col('стоимость');
  const iCount = col('кол-во');
  const iOperator = col('оператор');
  if (iStart < 0 || iCost < 0) throw new CabinetError('В кратком отчёте нет столбцов «Время старта» и «Стоимость»');

  const days = {};
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const m = String(cells[iStart] || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (!m) continue;
    const day = `${m[3]}-${m[2]}-${m[1]}`;
    const cost = toNumber(cells[iCost]);
    const bucket = days[day] || (days[day] = { cost: 0, messages: 0, operators: {} });
    bucket.cost += cost;
    bucket.messages += iCount >= 0 ? Math.round(toNumber(cells[iCount])) : 0;
    const op = (iOperator >= 0 && cells[iOperator]) || 'другие';
    bucket.operators[op] = (bucket.operators[op] || 0) + cost;
  }
  for (const b of Object.values(days)) {
    b.cost = Math.round(b.cost * 100) / 100;
    for (const k of Object.keys(b.operators)) b.operators[k] = Math.round(b.operators[k] * 100) / 100;
  }
  return days;
}

/** Открыть сессию аккаунта. Пароль дальше не хранится — он нужен только входу. */
async function open(login, password) {
  if (!login || !password) throw new CabinetError('Не задан вход в кабинет Имобиса');
  const session = new CabinetSession(login);
  await session.signIn(password);
  return session;
}

module.exports = {
  open,
  CabinetError,
  // для тестов
  CookieJar,
  parsePayments,
  parsePayerForm,
  parseSpendReport,
  invoiceNumberFrom,
  ruDate
};
