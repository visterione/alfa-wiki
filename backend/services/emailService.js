const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

// Создаём транспортер для системных писем (2FA, учётные данные)
const createTransporter = () => {
  if (!process.env.SMTP_HOST) {
    console.warn('⚠️  SMTP settings not configured. Emails will be logged to console.');
    return nodemailer.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true
    });
  }

  const config = {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  };

  if (process.env.SMTP_IGNORE_TLS === 'true') {
    config.tls = { rejectUnauthorized: false };
  }

  return nodemailer.createTransport(config);
};

// Создаём транспортер для рассылок (использует отдельный ящик если настроен,
// иначе падает на основной)
const createBroadcastTransporter = () => {
  const host = process.env.SMTP_HOST_BROADCAST || process.env.SMTP_HOST;

  if (!host) {
    console.warn('⚠️  SMTP settings not configured. Emails will be logged to console.');
    return nodemailer.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true
    });
  }

  const config = {
    host,
    port: parseInt(process.env.SMTP_PORT_BROADCAST || process.env.SMTP_PORT || '587'),
    secure: (process.env.SMTP_SECURE_BROADCAST || process.env.SMTP_SECURE) === 'true',
    auth: {
      user: process.env.SMTP_USER_BROADCAST || process.env.SMTP_USER,
      pass: process.env.SMTP_PASS_BROADCAST || process.env.SMTP_PASS
    }
  };

  const ignoreTls = process.env.SMTP_IGNORE_TLS_BROADCAST || process.env.SMTP_IGNORE_TLS;
  if (ignoreTls === 'true') {
    config.tls = { rejectUnauthorized: false };
  }

  return nodemailer.createTransport(config);
};

/**
 * Экранирование значений, которые приезжают из БД (имя, логин).
 *
 * Письмо — это HTML, и «<» в отображаемом имени разъедет вёрстку, а в худшем
 * случае утащит в письмо чужую разметку.
 */
const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const BRAND = 'Альфа Вики';

/**
 * Логотип вкладывается в письмо, а не тянется ссылкой.
 *
 * Внешняя картинка требует публичного адреса и всё равно режется клиентами,
 * которые по умолчанию не грузят удалённые изображения. Вложение с cid едет
 * вместе с письмом и показывается сразу. Файл лежит в самом бэкенде, а не
 * берётся из frontend/src: тем каталогом распоряжается сборка, и путь там
 * может измениться в любой момент.
 */
const LOGO_CID = 'alfa-wiki-logo';
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo.png');

// Если файла нет, письмо всё равно уходит: на месте картинки останется пустая
// синяя плашка, а название и так стоит текстом под ней. Поэтому и alt пустой —
// иначе клиент с заблокированными картинками нарисовал бы «Альфа Вики» дважды,
// причём внутри плашки и с переносом.
const logoAttachment = () => (fs.existsSync(LOGO_PATH)
  ? [{ filename: 'logo.png', path: LOGO_PATH, cid: LOGO_CID }]
  : []);

// Отбивка после прехедера: без неё почтовый клиент дотягивает в превью текст,
// который идёт следом за скрытым блоком, и обрезает главное.
const PREHEADER_PAD = '&#847;&zwnj;&nbsp;'.repeat(60);

/**
 * Общий каркас системного письма.
 *
 * Таблицы и инлайновые стили — не архаика, а необходимость: Gmail на мобильных
 * вырезает <style> из <head>, Outlook не понимает ни flex, ни grid. Всё, что
 * должно доехать, написано прямо в атрибуте style.
 *
 * `preheader` — скрытый первый текст письма. Именно его почтовый клиент
 * показывает в списке писем и в предпросмотре сразу после темы, поэтому туда
 * вынесено главное. Раньше первым в письме шло «Здравствуйте, имя!», превью
 * занимало приветствие, и код в него не попадал — приходилось открывать
 * письмо целиком, чтобы его увидеть.
 */
const renderEmail = ({ preheader, heading, body }) => `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#F2F2F7;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;">${preheader}${PREHEADER_PAD}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F2F7;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#FFFFFF;border:1px solid #E5E5EA;border-radius:20px;">
        <tr>
          <td align="center" style="padding:36px 32px 0 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
              <tr>
                <td width="64" height="64" align="center" valign="middle" bgcolor="#0A84FF" style="width:64px;height:64px;border-radius:18px;">
                  <img src="cid:${LOGO_CID}" width="38" height="38" alt="" style="display:block;border:0;outline:none;text-decoration:none;">
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 32px 0 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:21px;font-weight:700;color:#1D1D1F;letter-spacing:-0.4px;">${BRAND}</td>
        </tr>
        <tr>
          <td align="center" style="padding:22px 32px 10px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:17px;font-weight:600;color:#6E6E73;letter-spacing:-0.2px;line-height:1.3;">${esc(heading)}</td>
        </tr>
        <tr>
          <td style="padding:0 32px 28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">${body}</td>
        </tr>
        <tr>
          <td style="padding:0 32px;"><div style="height:1px;background:#E5E5EA;line-height:1px;font-size:1px;">&nbsp;</div></td>
        </tr>
        <tr>
          <td align="center" style="padding:18px 32px 26px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8E8E93;">
            © ${new Date().getFullYear()} ${BRAND}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

// Абзац основного текста письма
const p = (html) => `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#4A4A4F;">${html}</p>`;

/**
 * Генерирует 6-значный код для 2FA
 */
const generateCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Отправляет код 2FA на email пользователя
 */
const send2FACode = async (email, code, username) => {
  const transporter = createTransporter();

  // В письме намеренно нет ничего, кроме кода: срок жизни и предупреждение
  // «никому не сообщайте» вынесены в прехедер, а он и так виден в превью,
  // то есть раньше, чем письмо открывают.
  const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 4px 0;">
      <tr>
        <td align="center" bgcolor="#F2F5FA" style="padding:22px 12px;border:1px solid #E3E9F2;border-radius:14px;">
          <div style="font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:10px;text-indent:10px;color:#0A3D91;">${esc(code)}</div>
        </td>
      </tr>
    </table>`;

  const mailOptions = {
    // Код вынесен в самое начало темы: в списке писем и в баннере уведомления
    // видно только её начало, и так код читается, не открывая письмо.
    subject: `${code} — код для входа в ${BRAND}`,
    from: process.env.SMTP_FROM || `"${BRAND}" <noreply@alfawiki.com>`,
    to: email,
    attachments: logoAttachment(),
    html: renderEmail({
      preheader: `Код ${esc(code)} — действует 15 минут.`,
      heading: 'Код для входа',
      body,
    }),
    text: [
      `${code} — код для входа в ${BRAND}.`,
      '',
      '---',
      `© ${new Date().getFullYear()} ${BRAND}`,
    ].join('\n'),
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    
    // Если используем консольный транспорт - выводим информацию
    if (!process.env.SMTP_HOST) {
      console.log('📧 [2FA CODE EMAIL]');
      console.log('To:', email);
      console.log('Code:', code);
      console.log('Username:', username);
      console.log('---');
    } else {
      console.log('✅ Email sent successfully to:', email);
      console.log('Message ID:', info.messageId);
    }
    
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('❌ Email sending error:', error);
    throw error;
  }
};

/**
 * Отправляет уведомление об отключении 2FA
 */
const send2FADisabledNotification = async (email, username) => {
  const transporter = createTransporter();

  const body = p('Администратор отключил двухфакторную аутентификацию для вашей учётной записи. Теперь для входа достаточно логина и пароля.');

  const mailOptions = {
    subject: `Двухфакторная аутентификация отключена — ${BRAND}`,
    from: process.env.SMTP_FROM || `"${BRAND}" <noreply@alfawiki.com>`,
    to: email,
    attachments: logoAttachment(),
    html: renderEmail({
      preheader: 'Теперь для входа достаточно логина и пароля.',
      heading: 'Двухфакторная аутентификация отключена',
      body,
    }),
    text: [
      `${BRAND} — двухфакторная аутентификация отключена.`,
      '',
      'Администратор отключил двухфакторную аутентификацию для вашей учётной записи.',
      'Теперь для входа достаточно логина и пароля.',
      '',
      '---',
      `© ${new Date().getFullYear()} ${BRAND}`,
    ].join('\n'),
  };

  try {
    await transporter.sendMail(mailOptions);
    
    if (!process.env.SMTP_HOST) {
      console.log('📧 [2FA DISABLED NOTIFICATION]');
      console.log('To:', email);
      console.log('Username:', username);
      console.log('---');
    } else {
      console.log('✅ 2FA disabled notification sent to:', email);
    }
    
    return { success: true };
  } catch (error) {
    console.error('❌ Email sending error:', error);
    // Не бросаем ошибку, так как это некритично
    return { success: false };
  }
};

/**
 * Отправляет учетные данные пользователю (логин и пароль)
 */
const sendCredentials = async (email, username, password, displayName, isPasswordChange = false) => {
  const transporter = createTransporter();

  const heading = isPasswordChange ? 'Пароль изменён' : 'Доступ в портал';
  const intro = isPasswordChange
    ? 'Администратор изменил пароль от вашей учётной записи. Новые данные для входа:'
    : `Для вас создана учётная запись в портале «${BRAND}». Данные для входа:`;

  // Пароль намеренно не попадает ни в тему, ни в прехедер: и то и другое видно
  // в списке писем и во всплывающем уведомлении, то есть через чужое плечо.
  const row = (label, value, last) => `<tr>
        <td style="padding:11px 0;${last ? '' : 'border-bottom:1px solid #E5E5EA;'}font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;color:#8E8E93;">${label}</td>
        <td align="right" style="padding:11px 0;${last ? '' : 'border-bottom:1px solid #E5E5EA;'}font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,'Courier New',monospace;font-size:15px;font-weight:600;color:#1D1D1F;">${esc(value)}</td>
      </tr>`;

  const body = [
    p(intro),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px 0;background:#F7F7FA;border:1px solid #E5E5EA;border-radius:14px;">
      <tr><td style="padding:4px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${row('Логин', username, false)}
          ${row('Пароль', password, true)}
        </table>
      </td></tr>
    </table>`,
  ].join('');

  const mailOptions = {
    subject: isPasswordChange ? `Пароль изменён — ${BRAND}` : `Доступ в портал ${BRAND}`,
    from: process.env.SMTP_FROM || `"${BRAND}" <noreply@alfawiki.com>`,
    to: email,
    attachments: logoAttachment(),
    html: renderEmail({
      preheader: isPasswordChange
        ? 'Логин и новый пароль — внутри письма.'
        : 'Логин и пароль для первого входа — внутри письма.',
      heading,
      body,
    }),
    text: [
      `${BRAND} — ${heading.toLowerCase()}.`,
      '',
      intro,
      '',
      `Логин: ${username}`,
      `Пароль: ${password}`,
      '',
      '---',
      `© ${new Date().getFullYear()} ${BRAND}`,
    ].join('\n'),
  };

  try {
    const info = await transporter.sendMail(mailOptions);

    // Если используем консольный транспорт - выводим информацию
    if (!process.env.SMTP_HOST) {
      console.log('📧 [CREDENTIALS EMAIL]');
      console.log('To:', email);
      console.log('Username:', username);
      console.log('Password:', password);
      console.log('Type:', isPasswordChange ? 'Password Change' : 'New User');
      console.log('---');
    } else {
      console.log('✅ Credentials email sent successfully to:', email);
      console.log('Message ID:', info.messageId);
    }

    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('❌ Credentials email sending error:', error);
    throw error;
  }
};

/**
 * Встраивает изображения из HTML как inline attachments (CID)
 * @param {string} htmlContent - HTML содержимое с изображениями
 * @returns {{html: string, images: Array<{cid: string, filePath: string, fullPath: string}>}}
 */
const embedImagesInline = (htmlContent) => {
  const path = require('path');
  const crypto = require('crypto');
  const imageMap = new Map(); // Map<originalSrc, {cid, filePath, fullPath}>
  let processedHtml = htmlContent;

  // Regex для поиска всех img src (поддерживает и одинарные и двойные кавычки)
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const matches = htmlContent.matchAll(imgRegex);

  for (const match of matches) {
    const srcUrl = match[1];

    // Проверяем, это ли наш upload (абсолютный или относительный путь)
    let filePath = null;

    // Паттерн 1: http://192.168.22.39:9001/uploads/2026-02/file.png
    // Паттерн 2: http://localhost:9001/uploads/2026-02/file.png
    // Паттерн 3: /uploads/2026-02/file.png
    if (srcUrl.includes('/uploads/')) {
      const uploadMatch = srcUrl.match(/\/uploads\/(.+)$/);
      if (uploadMatch) {
        filePath = uploadMatch[1]; // "2026-02/file.png"
      }
    }

    if (filePath && !imageMap.has(srcUrl)) {
      // Генерируем уникальный CID на основе пути к файлу
      const fileName = path.basename(filePath);
      const fileNameWithoutExt = path.parse(fileName).name;
      const ext = path.extname(fileName);
      const cid = `${fileNameWithoutExt}-${crypto.createHash('md5').update(filePath).digest('hex').substring(0, 8)}${ext}`;

      const fullPath = path.join(__dirname, '../uploads', filePath);

      imageMap.set(srcUrl, {
        cid: cid,
        filePath: filePath,
        fullPath: fullPath
      });

      console.log(`📎 Embedding image: ${filePath} as cid:${cid}`);
    }
  }

  // Заменяем все src на cid:
  for (const [originalSrc, imageData] of imageMap) {
    // Экранируем специальные символы в URL для regex
    const escapedSrc = originalSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    processedHtml = processedHtml.replace(
      new RegExp(`(src=["'])${escapedSrc}(["'])`, 'g'),
      `$1cid:${imageData.cid}$2`
    );
  }

  return {
    html: processedHtml,
    images: Array.from(imageMap.values())
  };
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Отправляет массовую рассылку email батчами с паузами между ними.
 * @param {Object} params
 * @param {string} params.subject
 * @param {string} params.htmlContent
 * @param {Array<{email, displayName}>} params.recipients
 * @param {Array<{name, path, mimeType}>} params.attachments
 * @param {string} params.senderInfo
 * @param {Function} [params.onProgress] - callback({ sent, failed, total }) после каждого письма
 * @returns {Promise<{success: boolean, sent: number, failed: number, errors: Array}>}
 */
const sendBulkEmail = async ({ subject, htmlContent, recipients, attachments = [], senderInfo, onProgress }) => {
  const path = require('path');
  const fs = require('fs');
  const transporter = createBroadcastTransporter();
  const results = { success: true, sent: 0, failed: 0, errors: [] };

  const BATCH_SIZE = parseInt(process.env.BROADCAST_BATCH_SIZE || '20');
  const BATCH_DELAY = parseInt(process.env.BROADCAST_BATCH_DELAY_MS || '3000');

  // Встраиваем изображения из HTML как inline attachments
  const { html: processedHtml, images } = embedImagesInline(htmlContent);

  console.log(`📧 Starting broadcast: ${recipients.length} recipients, batch=${BATCH_SIZE}, delay=${BATCH_DELAY}ms`);

  for (let batchStart = 0; batchStart < recipients.length; batchStart += BATCH_SIZE) {
    const batch = recipients.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(recipients.length / BATCH_SIZE);
    console.log(`📦 Batch ${batchNum}/${totalBatches} (${batch.length} recipients)`);

    for (const recipient of batch) {
      if (!recipient.email) {
        results.failed++;
        results.errors.push({ email: recipient.displayName || 'Unknown', error: 'Email не указан' });
        onProgress?.({ sent: results.sent, failed: results.failed, total: recipients.length });
        continue;
      }

      try {
        const emailAttachments = [];

        for (const att of attachments) {
          const fullPath = att.path.startsWith('uploads/')
            ? path.join(__dirname, '..', att.path)
            : path.join(__dirname, '../uploads', att.path);
          emailAttachments.push({ filename: att.name, path: fullPath });
        }

        for (const img of images) {
          if (fs.existsSync(img.fullPath)) {
            emailAttachments.push({
              filename: path.basename(img.filePath),
              path: img.fullPath,
              cid: img.cid
            });
          } else {
            console.warn(`⚠️  Image not found: ${img.fullPath}`);
          }
        }

        const mailOptions = {
          from: process.env.SMTP_FROM_BROADCAST || process.env.SMTP_FROM || '"Alfa Wiki" <noreply@alfawiki.com>',
          to: recipient.email,
          subject: subject,
          html: processedHtml,
          attachments: emailAttachments
        };

        await transporter.sendMail(mailOptions);
        results.sent++;
      } catch (error) {
        console.error(`❌ Failed to send to ${recipient.email}:`, error.message);
        results.failed++;
        results.errors.push({ email: recipient.email, error: error.message });
      }

      onProgress?.({ sent: results.sent, failed: results.failed, total: recipients.length });
    }

    // Пауза между батчами, кроме последнего
    if (batchStart + BATCH_SIZE < recipients.length) {
      console.log(`⏸️  Waiting ${BATCH_DELAY}ms before next batch...`);
      await sleep(BATCH_DELAY);
    }
  }

  if (results.failed > 0) results.success = false;

  console.log(`✅ Email broadcast complete: ${results.sent} sent, ${results.failed} failed`);

  return results;
};

/**
 * Одно письмо одному адресату через рассылочный ящик.
 *
 * sendBulkEmail рядом шлёт ОДНО И ТО ЖЕ письмо списку — для новостей это верно, а
 * для регламентных отчётов нет: каждый получатель видит только свои кабинеты, и
 * вложение у каждого своё. Отдельная функция вместо параметра к sendBulkEmail,
 * потому что общего у них ровно транспорт.
 *
 * attachments здесь — буферы в памяти ({ filename, content }), а не пути в
 * uploads: отчёт формируется на лету и на диск не ложится.
 */
const sendReportEmail = async ({ to, subject, html, text, attachments = [] }) => {
  const transporter = createBroadcastTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM_BROADCAST || process.env.SMTP_FROM || '"Alfa Wiki" <noreply@alfawiki.com>',
    to, subject, html, text, attachments,
  });
};

module.exports = {
  generateCode,
  send2FACode,
  send2FADisabledNotification,
  sendCredentials,
  sendBulkEmail,
  sendReportEmail
};