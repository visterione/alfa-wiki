'use strict';

/**
 * Письма врачу.
 *
 * Врач — не сотрудник портала: аккаунта у него нет и по итогам процесса он не
 * заводится (решение заказчика; возможно, вернёмся к этому позже). Поэтому все
 * его касания идут почтой по персональной ссылке.
 *
 * Исполнителям внутри клиники письма не шлём — им уходит задача в портале и
 * сообщение от бота, см. services/onboarding/engine.js. Дублировать это ещё и
 * почтой значит приучить людей не читать ни то, ни другое.
 */

const nodemailer = require('nodemailer');

const FROM = process.env.SMTP_FROM || '"Alfa Wiki" <noreply@alfawiki.com>';

// Публичный адрес портала — тот же, что у публичных карточек оборудования
// (services/warehouse/qr.js). Врач открывает ссылку с телефона снаружи сети,
// поэтому FRONTEND_URL из dev-конфига (localhost:9000) сюда не годится, и
// умолчание тут боевое, а не пустое.
const { publicBase } = require('./links');

function applicationLink(app) {
  return `${publicBase()}/anketa/${app.accessToken}`;
}

function servicesLink(app) {
  return `${publicBase()}/anketa/${app.accessToken}/services`;
}

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
 * бы хуже, чем не доставить одно письмо. Неудача пишется в журнал заявки
 * вызывающим кодом.
 */
async function send(to, subject, html) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn(`[onboarding/mail] SMTP не настроен, письмо «${subject}» для ${to} не отправлено`);
    return { success: false, reason: 'smtp_not_configured' };
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    return { success: true };
  } catch (error) {
    console.error(`[onboarding/mail] Не удалось отправить «${subject}» на ${to}:`, error.message);
    return { success: false, reason: error.message };
  }
}

// ── Оформление ─────────────────────────────────────────────────────────────

function layout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#007AFF,#5856D6);padding:32px 30px;">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">${title}</h1>
    </div>
    <div style="padding:32px 30px;color:#1d1d1f;font-size:15px;line-height:1.6;">
      ${bodyHtml}
    </div>
    <div style="padding:20px 30px;background:#f5f5f7;color:#86868B;font-size:12px;">
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

// ── Письма ─────────────────────────────────────────────────────────────────

/** Код подтверждения адреса — первый шаг, до самой анкеты. */
async function sendVerificationCode(email, code) {
  return send(email, 'Код подтверждения — анкета врача', layout('Подтверждение адреса', `
    <p>Чтобы открыть анкету, введите на странице этот код:</p>
    <p style="font-size:34px;font-weight:700;letter-spacing:6px;margin:24px 0;">${code}</p>
    <p style="color:#86868B;font-size:13px;">Код действует 15 минут. Если вы не заполняли анкету — просто не отвечайте на письмо.</p>
  `));
}

/** Черновик сохранён — персональная ссылка, чтобы вернуться и дозаполнить. */
async function sendDraftLink(app) {
  return send(app.email, `Анкета врача №${app.number} — ссылка для возврата`, layout('Анкета сохранена', `
    <p>Анкета сохранена как черновик. Вернуться к ней и дозаполнить можно по личной ссылке — она не меняется.</p>
    ${button(applicationLink(app), 'Продолжить заполнение')}
    <p style="color:#86868B;font-size:13px;">Ссылку никому не передавайте: по ней открывается ваша анкета.</p>
  `));
}

/** Возврат на доработку: замечания главврача и ссылка на ту же заявку. */
async function sendRevision(app, note, fields = []) {
  const list = fields.length
    ? `<ul style="margin:16px 0;padding-left:20px;">${fields.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`
    : '';
  return send(app.email, `Анкета №${app.number} — нужно поправить`, layout('Анкета возвращена на доработку', `
    <p>Главврач посмотрел анкету и попросил уточнить несколько пунктов.</p>
    ${note ? `<p style="background:#f5f5f7;border-radius:10px;padding:16px;">${escapeHtml(note)}</p>` : ''}
    ${list}
    ${button(applicationLink(app), 'Открыть анкету')}
    <p style="color:#86868B;font-size:13px;">Заполненное сохранено — поправить нужно только отмеченное.</p>
  `));
}

/** Учётка в МИС создана — врачу уходит ссылка на выбор услуг. */
async function sendServicesInvite(app) {
  return send(app.email, `Анкета №${app.number} — выберите услуги`, layout('Выберите услуги', `
    <p>Вы заведены в системе клиники. Остался последний шаг с вашей стороны — отметить услуги, которые вы будете оказывать.</p>
    <p>Список уже подтянут по вашей специальности и филиалу. Отмечать можно разделами целиком, длительность приёма по каждой услуге при необходимости меняется.</p>
    ${button(servicesLink(app), 'Открыть список услуг')}
    <p style="color:#86868B;font-size:13px;">На это отводится 48 часов.</p>
  `));
}

/** Всё закрыто — приветственное письмо. */
async function sendWelcome(app, medCenterName) {
  return send(app.email, 'Добро пожаловать в «Альфу»', layout('Всё готово', `
    <p>Все подготовительные шаги закрыты: учётная запись создана, расписание открыто, услуги внесены${medCenterName ? `, филиал — ${escapeHtml(medCenterName)}` : ''}.</p>
    <p>Можно выходить на приём — запись к вам уже доступна.</p>
    <p style="color:#86868B;font-size:13px;">Логин и пароль к «Реновации» вам передаст администратор МИС отдельно.</p>
  `));
}

/**
 * Приглашение заполнить анкету — то, что сотрудник отправляет кандидату прямо
 * из раздела «Материалы».
 *
 * Ссылка тут та же самая, постоянная: письмо не создаёт заявку и ничего не
 * резервирует, оно просто избавляет от копирования адреса в мессенджер.
 */
async function sendAnketaInvite(to, { fromName, note } = {}) {
  const { anketaUrl } = require('./links');
  return send(to, 'Анкета врача — сеть медцентров «Альфа»', layout('Анкета врача', `
    <p>Здравствуйте! Чтобы начать оформление, заполните анкету — она откроется с телефона и сохраняется по ходу.</p>
    ${note ? `<p style="background:#f5f5f7;border-radius:10px;padding:16px;">${escapeHtml(note)}</p>` : ''}
    ${button(anketaUrl(), 'Заполнить анкету')}
    <p style="color:#86868B;font-size:13px;">
      Сначала попросим подтвердить адрес кодом — он придёт на эту же почту.
      ${fromName ? `<br>Отправитель: ${escapeHtml(fromName)}.` : ''}
    </p>
  `));
}

/** Заявка отклонена. Пишем без причин: они внутренние. */
async function sendRejected(app) {
  return send(app.email, `Анкета №${app.number}`, layout('Анкета рассмотрена', `
    <p>Спасибо, что заполнили анкету. К сожалению, продолжить оформление сейчас мы не готовы.</p>
  `));
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  sendVerificationCode,
  sendAnketaInvite,
  sendDraftLink,
  sendRevision,
  sendServicesInvite,
  sendWelcome,
  sendRejected,
  applicationLink,
  servicesLink
};
