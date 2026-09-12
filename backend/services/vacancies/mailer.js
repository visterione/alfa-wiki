'use strict';

/**
 * Письма кандидату (ver. 8.20).
 *
 * Кандидат — не сотрудник портала: аккаунта у него нет, поэтому все касания
 * идут почтой по персональной ссылке.
 *
 * Отличие от первого поколения: тексты живут в шаблоне, а вёрстка остаётся
 * здесь. Вёрстка выстрадана под почтовые клиенты — таблицы, инлайновые стили,
 * отсутствие флексбокса, — и отдавать её в редактор значило бы чинить письма
 * после каждой правки. А текст для технички и для врача обязан отличаться, и
 * держать шесть пар текстов в коде — это ровно тот хардкод, от которого раздел
 * и уходит.
 *
 * Поэтому редактируется только то, что человек читает: заголовок письма, тема и
 * один-два абзаца. Кнопка, код и подписи мелким шрифтом собираются кодом — они
 * одинаковы для любой должности.
 */

const nodemailer = require('nodemailer');

const { publicBase, applicationUrl } = require('./links');

const FROM = process.env.SMTP_FROM || '"Alfa Wiki" <noreply@alfawiki.com>';

function createTransporter() {
  if (!process.env.SMTP_HOST) return null;
  const options = {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  };
  if (process.env.SMTP_IGNORE_TLS === 'true') {
    options.tls = { rejectUnauthorized: false };
  }
  return nodemailer.createTransport(options);
}

/**
 * Отправка. Ошибка почты не должна ронять переход по процессу: заявка уже
 * перешла в следующее состояние, и откатывать её из-за недоступного SMTP было
 * бы хуже, чем не доставить одно письмо.
 */
async function send(to, subject, html) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn(`[vacancies/mail] SMTP не настроен, письмо «${subject}» для ${to} не отправлено`);
    return { success: false, reason: 'smtp_not_configured' };
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    return { success: true };
  } catch (error) {
    console.error(`[vacancies/mail] Не удалось отправить «${subject}» на ${to}:`, error.message);
    return { success: false, reason: error.message };
  }
}

// ── Тексты ─────────────────────────────────────────────────────────────────
//
// Что можно поменять в шаблоне и что подставится, если не меняли. Текст без
// умолчания означал бы, что новый шаблон рассылает пустые письма, пока их не
// написали, — а написать их вспомнят после первого отклика.
const LETTERS = {
  code: {
    name: 'Код подтверждения',
    subject: 'Код подтверждения — отклик на вакансию',
    title: 'Подтверждение адреса',
    body: 'Чтобы открыть анкету, введите на странице этот код:'
  },
  draft: {
    name: 'Ссылка на анкету',
    subject: 'Ваша анкета — ссылка для возврата',
    title: 'Анкета сохранена',
    body: 'Анкета сохранена как черновик. Вернуться к ней и дозаполнить можно по личной ссылке — она не меняется.'
  },
  submitted: {
    name: 'Анкета отправлена',
    subject: 'Анкета отправлена',
    title: 'Спасибо, анкета получена',
    body: 'Мы получили вашу анкету и передали её на рассмотрение. Как только будет решение, напишем на этот адрес.'
  },
  revision: {
    name: 'Возврат на доработку',
    subject: 'Анкета — нужно поправить',
    title: 'Анкета возвращена на доработку',
    body: 'Мы посмотрели анкету и просим уточнить несколько пунктов.'
  },
  rejected: {
    name: 'Отказ',
    subject: 'Решение по вашему отклику',
    title: 'Спасибо за отклик',
    body: 'К сожалению, сейчас мы не готовы продолжить. Спасибо, что откликнулись, — будем рады видеть вас среди кандидатов в будущем.'
  },
  services: {
    name: 'Приглашение выбрать услуги',
    subject: 'Выберите услуги, которые будете оказывать',
    title: 'Остался один шаг',
    body: 'Ваша анкета согласована. Остался последний шаг с вашей стороны — отметить услуги, которые вы будете оказывать. Список уже подтянут по вашей специальности и филиалу.'
  },
  welcome: {
    name: 'Добро пожаловать',
    subject: 'Добро пожаловать в команду',
    title: 'Добро пожаловать в команду',
    body: 'Всё готово, можно выходить на работу.'
  }
};

/** Текст письма с учётом правок в шаблоне. */
function letter(template, key) {
  const base = LETTERS[key];
  const own = template?.emails?.[key] || {};
  return {
    subject: String(own.subject || base.subject).slice(0, 200),
    title: String(own.title || base.title).slice(0, 200),
    body: String(own.body || base.body).slice(0, 4000)
  };
}

// ── Оформление ─────────────────────────────────────────────────────────────

function layout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<!-- Без этой строки почтовые приложения раскладывают письмо на 980 px и потом
     уменьшают целиком: текст становится нечитаемым, а кнопка — размером с
     ноготь. -->
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#007AFF,#5856D6);padding:24px 26px;">
      <h1 style="margin:0;color:#fff;font-size:21px;font-weight:700;">${escapeHtml(title)}</h1>
    </div>
    <div style="padding:24px 26px;color:#1d1d1f;font-size:15px;line-height:1.6;">
      ${bodyHtml}
    </div>
    <div style="padding:18px 26px;background:#f5f5f7;color:#86868B;font-size:12px;">
      Письмо отправлено автоматически, отвечать на него не нужно.
    </div>
  </div>
</body></html>`;
}

function button(href, text) {
  return `<p style="margin:28px 0;">
    <a href="${href}" style="display:inline-block;background:#007AFF;color:#fff;text-decoration:none;
       padding:14px 28px;border-radius:10px;font-weight:600;">${text}</a>
  </p>
  <p style="color:#86868B;font-size:13px;">Если кнопка не открывается, скопируйте ссылку:<br>
    <span style="word-break:break-all;">${href}</span></p>`;
}

/**
 * Текст из шаблона — это текст, а не разметка: пишет его не разработчик, и
 * угловая скобка в нём должна остаться угловой скобкой, а не открыть тег.
 * Переводы строк становятся абзацами.
 */
function paragraphs(text) {
  return String(text)
    .split(/\n{2,}/)
    .map(part => `<p>${escapeHtml(part.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ── Письма ─────────────────────────────────────────────────────────────────

/** Код подтверждения адреса — первый шаг, до самой анкеты. */
async function sendVerificationCode(template, email, code) {
  const text = letter(template, 'code');
  return send(email, text.subject, layout(text.title, `
    ${paragraphs(text.body)}
    <p style="font-size:34px;font-weight:700;letter-spacing:6px;margin:24px 0;">${code}</p>
    <p style="color:#86868B;font-size:13px;">Код действует 15 минут. Если вы не откликались на вакансию — просто не отвечайте на письмо.</p>
  `));
}

/** Черновик заведён — персональная ссылка, чтобы вернуться и дозаполнить. */
async function sendDraftLink(template, app, vacancyTitle) {
  const text = letter(template, 'draft');
  return send(app.email, text.subject, layout(text.title, `
    ${vacancyTitle ? `<p style="color:#86868B;">Вакансия: ${escapeHtml(vacancyTitle)}</p>` : ''}
    ${paragraphs(text.body)}
    ${button(applicationUrl(app.accessToken), 'Продолжить заполнение')}
    <p style="color:#86868B;font-size:13px;">Ссылку никому не передавайте: по ней открывается ваша анкета.</p>
  `));
}

/** Анкета ушла на рассмотрение. */
async function sendSubmitted(template, app, vacancyTitle) {
  const text = letter(template, 'submitted');
  return send(app.email, text.subject, layout(text.title, `
    ${vacancyTitle ? `<p style="color:#86868B;">Вакансия: ${escapeHtml(vacancyTitle)}</p>` : ''}
    ${paragraphs(text.body)}
    <p style="color:#86868B;font-size:13px;">Ваша копия анкеты остаётся доступной по прежней ссылке:
      <span style="word-break:break-all;">${applicationUrl(app.accessToken)}</span></p>
  `));
}

/**
 * Возврат на доработку: замечания и ссылка на ту же заявку.
 *
 * Список полей — подписи, а не ключи: «experienceSpecialty» человеку ничего не
 * говорит, и он пойдёт искать это поле глазами по всей анкете.
 */
async function sendRevision(template, app, note, fields = []) {
  const text = letter(template, 'revision');
  const list = fields.length
    ? `<ul style="margin:16px 0;padding-left:20px;">${fields.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`
    : '';
  return send(app.email, text.subject, layout(text.title, `
    ${paragraphs(text.body)}
    ${note ? `<p style="background:#f5f5f7;border-radius:10px;padding:16px;">${escapeHtml(note)}</p>` : ''}
    ${list}
    ${button(applicationUrl(app.accessToken), 'Открыть анкету')}
    <p style="color:#86868B;font-size:13px;">Заполненное сохранено — поправить нужно только отмеченное.</p>
  `));
}

/**
 * Отказ.
 *
 * Причину в письмо не вставляем, даже если она записана: комментарий при отказе
 * пишется для своих («нет опыта работы с детьми», «не сошлись по деньгам»), и
 * отправлять его человеку как объяснение — не то же самое, что записать для
 * коллеги. Захотят сказать больше — скажут голосом.
 */
async function sendRejected(template, app) {
  const text = letter(template, 'rejected');
  return send(app.email, text.subject, layout(text.title, paragraphs(text.body)));
}

/** Анкета согласована — приглашение отметить услуги по прайсу. */
async function sendServicesInvite(template, app) {
  const text = letter(template, 'services');
  return send(app.email, text.subject, layout(text.title, `
    ${paragraphs(text.body)}
    ${button(`${applicationUrl(app.accessToken)}/services`, 'Открыть список услуг')}
  `));
}

/**
 * Всё закрыто — приветственное письмо со ссылками в рабочие чаты.
 *
 * Чаты стоят первыми, сразу под строкой приветствия, а не в конце. Это не
 * вопрос вкуса: письмо открывают с телефона, и всё, что ниже примерно 600
 * точек, человек увидит, только если решит листать. Поздравление, ради которого
 * листать не станут, отправляло бы карточки за сгиб.
 *
 * Пустой список бывает штатно — чаты для этой должности в этом филиале могли не
 * заводить. Письмо тогда уходит без блока со ссылками, но уходит: оно остаётся
 * единственным сообщением о том, что процесс завершён, и гасить его целиком
 * нельзя (решение заказчика).
 */
async function sendWelcome(template, app, medCenterName, chats = []) {
  const text = letter(template, 'welcome');
  const lead = chats.length
    ? `${paragraphs(text.body)}
       <p style="margin:0 0 14px;">Остался один шаг — вступите в рабочие чаты:</p>
       ${chats.map(chatCard).join('')}`
    : paragraphs(text.body);

  return send(app.email, text.subject, layout(text.title, `
    ${lead}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5ea;color:#86868B;font-size:12.5px;line-height:1.55;">
      ${medCenterName ? `Филиал — ${escapeHtml(medCenterName)}.` : ''}
    </div>
  `));
}

/**
 * Карточка чата.
 *
 * Свёрстана таблицами и с инлайновыми стилями: почтовые клиенты флексбокс и
 * grid либо игнорируют, либо рисуют по-своему, а Outlook вырезает и часть
 * обычных свойств.
 *
 * Картинки в почте по умолчанию не грузятся у половины людей, поэтому на месте
 * аватарки в этом случае остаётся не пустая рамка, а кружок с первой буквой
 * названия: карточка читается и без единого изображения.
 */
function chatCard(chat) {
  const title = escapeHtml(chat.title || 'Рабочий чат');
  const href = escapeHtml(chat.url);
  const initial = escapeHtml((chat.title || '?').trim()[0] || '?').toUpperCase();
  const avatar = chat.avatarUrl
    ? `<img src="${escapeHtml(chat.avatarUrl)}" width="48" height="48" alt=""
            style="display:block;border-radius:24px;">`
    : `<table cellpadding="0" cellspacing="0" style="width:48px;height:48px;background:#f0f0f3;border-radius:24px;">
         <tr><td align="center" valign="middle"
                 style="font-size:19px;font-weight:700;color:#86868B;height:48px;">${initial}</td></tr>
       </table>`;

  return `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 10px;background:#f5f5f7;border-radius:12px;">
    <tr>
      <td width="70" style="padding:12px 0 12px 12px;">${avatar}</td>
      <td style="padding:12px 6px;">
        <div style="font-size:15px;font-weight:600;color:#1d1d1f;">${title}</div>
        ${chat.subtitle ? `<div style="margin-top:3px;color:#86868B;font-size:13px;">${escapeHtml(chat.subtitle)}</div>` : ''}
      </td>
      <td align="right" style="padding:12px 12px 12px 0;">
        <a href="${href}" style="display:inline-block;background:#007AFF;color:#fff;text-decoration:none;
           padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;">Вступить</a>
      </td>
    </tr>
  </table>`;
}

module.exports = {
  LETTERS,
  letter,
  send,
  layout,
  button,
  paragraphs,
  escapeHtml,
  publicBase,
  sendVerificationCode,
  sendDraftLink,
  sendSubmitted,
  sendRevision,
  sendRejected,
  sendServicesInvite,
  sendWelcome
};
