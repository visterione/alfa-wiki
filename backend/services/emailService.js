const nodemailer = require('nodemailer');

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

  const mailOptions = {
    from: process.env.SMTP_FROM || '"Alfa Wiki" <noreply@alfawiki.com>',
    to: email,
    subject: 'Код подтверждения входа - Alfa Wiki',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f7; }
          .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
          .header { background: linear-gradient(135deg, #007AFF 0%, #5856D6 100%); padding: 40px 30px; text-align: center; }
          .header h1 { margin: 0; color: white; font-size: 28px; font-weight: 700; }
          .content { padding: 40px 30px; }
          .code-box { background: #f5f5f7; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; }
          .code { font-size: 48px; font-weight: 700; color: #007AFF; letter-spacing: 8px; margin: 0; }
          .info { color: #86868B; font-size: 14px; line-height: 1.6; margin-top: 20px; }
          .footer { background: #f5f5f7; padding: 20px 30px; text-align: center; color: #86868B; font-size: 12px; }
          .warning { background: #FFF4E5; border-left: 4px solid #FF9500; padding: 16px; border-radius: 8px; margin-top: 20px; }
          .warning p { margin: 0; color: #1D1D1F; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Alfa Wiki</h1>
          </div>
          <div class="content">
            <h2 style="color: #1D1D1F; margin-top: 0;">Код подтверждения входа</h2>
            <p style="color: #86868B; font-size: 15px; line-height: 1.6;">
              Здравствуйте, <strong>${username}</strong>!
            </p>
            <p style="color: #86868B; font-size: 15px; line-height: 1.6;">
              Для завершения входа в систему используйте следующий код:
            </p>
            
            <div class="code-box">
              <p class="code">${code}</p>
            </div>
            
            <div class="warning">
              <p><strong>⚠️ Важно:</strong> Код действителен в течение 15 минут. Никому не сообщайте этот код!</p>
            </div>
            
            <p class="info">
              Если вы не пытались войти в систему, немедленно свяжитесь с администратором.
            </p>
          </div>
          <div class="footer">
            <p>Это автоматическое письмо. Пожалуйста, не отвечайте на него.</p>
            <p>© ${new Date().getFullYear()} Alfa Wiki. Все права защищены.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      Alfa Wiki - Код подтверждения входа
      
      Здравствуйте, ${username}!
      
      Для завершения входа в систему используйте следующий код:
      
      ${code}
      
      ⚠️ ВАЖНО: Код действителен в течение 15 минут. Никому не сообщайте этот код!
      
      Если вы не пытались войти в систему, немедленно свяжитесь с администратором.
      
      ---
      Это автоматическое письмо. Пожалуйста, не отвечайте на него.
      © ${new Date().getFullYear()} Alfa Wiki
    `
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

  const mailOptions = {
    from: process.env.SMTP_FROM || '"Alfa Wiki" <noreply@alfawiki.com>',
    to: email,
    subject: 'Двухфакторная аутентификация отключена - Alfa Wiki',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f7; }
          .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
          .header { background: linear-gradient(135deg, #FF9500 0%, #FF3B30 100%); padding: 40px 30px; text-align: center; }
          .header h1 { margin: 0; color: white; font-size: 28px; font-weight: 700; }
          .content { padding: 40px 30px; }
          .footer { background: #f5f5f7; padding: 20px 30px; text-align: center; color: #86868B; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⚠️ Alfa Wiki</h1>
          </div>
          <div class="content">
            <h2 style="color: #1D1D1F; margin-top: 0;">Двухфакторная аутентификация отключена</h2>
            <p style="color: #86868B; font-size: 15px; line-height: 1.6;">
              Здравствуйте, <strong>${username}</strong>!
            </p>
            <p style="color: #86868B; font-size: 15px; line-height: 1.6;">
              Администратор отключил двухфакторную аутентификацию для вашей учетной записи.
              Теперь для входа в систему достаточно только логина и пароля.
            </p>
            <p style="color: #86868B; font-size: 15px; line-height: 1.6;">
              Если вы не запрашивали это изменение, немедленно свяжитесь с администратором.
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Alfa Wiki. Все права защищены.</p>
          </div>
        </div>
      </body>
      </html>
    `
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

  const subject = isPasswordChange
    ? 'Пароль изменен - Alfa Wiki'
    : 'Добро пожаловать в Alfa Wiki';

  const greetingText = isPasswordChange
    ? 'Ваш пароль был изменен администратором.'
    : 'Для вас создана учетная запись в системе Alfa Wiki.';

  const mailOptions = {
    from: process.env.SMTP_FROM || '"Alfa Wiki" <noreply@alfawiki.com>',
    to: email,
    subject: subject,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f7; }
          .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
          .header { background: linear-gradient(135deg, #007AFF 0%, #5856D6 100%); padding: 40px 30px; text-align: center; }
          .header h1 { margin: 0; color: white; font-size: 28px; font-weight: 700; }
          .content { padding: 40px 30px; }
          .credentials-box { background: #f5f5f7; border-radius: 12px; padding: 24px; margin: 24px 0; }
          .credential-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e5e5e7; }
          .credential-row:last-child { border-bottom: none; }
          .credential-label { font-size: 13px; color: #86868B; font-weight: 500; }
          .credential-value { font-size: 16px; color: #1D1D1F; font-weight: 600; font-family: monospace; }
          .info { color: #86868B; font-size: 14px; line-height: 1.6; margin-top: 20px; }
          .footer { background: #f5f5f7; padding: 20px 30px; text-align: center; color: #86868B; font-size: 12px; }
          .warning { background: #FFF4E5; border-left: 4px solid #FF9500; padding: 16px; border-radius: 8px; margin-top: 20px; }
          .warning p { margin: 0; color: #1D1D1F; font-size: 14px; }
          .button { display: inline-block; padding: 12px 24px; background: #007AFF; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Alfa Wiki</h1>
          </div>
          <div class="content">
            <h2 style="color: #1D1D1F; margin-top: 0;">${isPasswordChange ? 'Пароль изменен' : 'Добро пожаловать!'}</h2>
            <p style="color: #86868B; font-size: 15px; line-height: 1.6;">
              Здравствуйте, <strong>${displayName || username}</strong>!
            </p>
            <p style="color: #86868B; font-size: 15px; line-height: 1.6;">
              ${greetingText}
            </p>

            <div class="credentials-box">
              <div class="credential-row">
                <span class="credential-label">Логин:</span>
                <span class="credential-value">${username}</span>
              </div>
              <div class="credential-row">
                <span class="credential-label">Пароль:</span>
                <span class="credential-value">${password}</span>
              </div>
            </div>

            <div class="warning">
              <p><strong>⚠️ Важно:</strong> Сохраните эти данные в надежном месте. Рекомендуем изменить пароль после первого входа в систему.</p>
            </div>

            <p class="info">
              Используйте эти учетные данные для входа в систему Alfa Wiki.
            </p>
          </div>
          <div class="footer">
            <p>Это автоматическое письмо. Пожалуйста, не отвечайте на него.</p>
            <p>© ${new Date().getFullYear()} Alfa Wiki. Все права защищены.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      Alfa Wiki - ${subject}

      Здравствуйте, ${displayName || username}!

      ${greetingText}

      Ваши учетные данные для входа:

      Логин: ${username}
      Пароль: ${password}

      ⚠️ ВАЖНО: Сохраните эти данные в надежном месте. Рекомендуем изменить пароль после первого входа в систему.

      Используйте эти учетные данные для входа в систему Alfa Wiki.

      ---
      Это автоматическое письмо. Пожалуйста, не отвечайте на него.
      © ${new Date().getFullYear()} Alfa Wiki
    `
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

/**
 * Отправляет массовую рассылку email
 * @param {Object} params
 * @param {string} params.subject - Тема письма
 * @param {string} params.htmlContent - HTML содержимое
 * @param {Array<{email, displayName}>} params.recipients - Массив получателей
 * @param {Array<{name, path, mimeType}>} params.attachments - Вложения (опционально)
 * @param {string} params.senderInfo - Имя отправителя для автоподписи
 * @returns {Promise<{success: boolean, sent: number, failed: number, errors: Array}>}
 */
const sendBulkEmail = async ({ subject, htmlContent, recipients, attachments = [], senderInfo }) => {
  const path = require('path');
  const fs = require('fs');
  const transporter = createBroadcastTransporter();
  const results = { success: true, sent: 0, failed: 0, errors: [] };

  // Встраиваем изображения из HTML как inline attachments
  const { html: processedHtml, images } = embedImagesInline(htmlContent);

  console.log(`📧 Preparing email with ${images.length} embedded images and ${attachments.length} attachments`);

  for (const recipient of recipients) {
    // Пропускаем получателей без email
    if (!recipient.email) {
      results.failed++;
      results.errors.push({
        email: recipient.displayName || 'Unknown',
        error: 'Email не указан'
      });
      continue;
    }

    try {
      // Собираем все вложения
      const emailAttachments = [];

      // Обычные вложения (файлы, PDF и т.д.)
      for (const att of attachments) {
        const fullPath = att.path.startsWith('uploads/')
          ? path.join(__dirname, '..', att.path)
          : path.join(__dirname, '../uploads', att.path);

        emailAttachments.push({
          filename: att.name,
          path: fullPath
        });
      }

      // Inline изображения (встроенные в HTML)
      for (const img of images) {
        // Проверяем существование файла перед отправкой
        if (fs.existsSync(img.fullPath)) {
          emailAttachments.push({
            filename: path.basename(img.filePath),
            path: img.fullPath,
            cid: img.cid // Content-ID для ссылки из HTML
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

      const info = await transporter.sendMail(mailOptions);
      results.sent++;

      if (!process.env.SMTP_HOST) {
        console.log(`📧 [BROADCAST EMAIL] To: ${recipient.email}, Subject: ${subject}`);
      }
    } catch (error) {
      console.error(`❌ Failed to send to ${recipient.email}:`, error.message);
      results.failed++;
      results.errors.push({ email: recipient.email, error: error.message });
    }
  }

  if (results.failed > 0) {
    results.success = false;
  }

  console.log(`✅ Email broadcast complete: ${results.sent} sent, ${results.failed} failed`);

  return results;
};

module.exports = {
  generateCode,
  send2FACode,
  send2FADisabledNotification,
  sendCredentials,
  sendBulkEmail
};