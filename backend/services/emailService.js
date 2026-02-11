const nodemailer = require('nodemailer');

// Создаём транспортер для отправки писем
const createTransporter = () => {
  // Если нет настроек email - используем консоль для разработки
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
    secure: process.env.SMTP_SECURE === 'true', // true для 465, false для других портов
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  };

  // Отключаем проверку сертификата для shared-хостинга
  // (когда сертификат выдан на другой домен)
  if (process.env.SMTP_IGNORE_TLS === 'true') {
    config.tls = {
      rejectUnauthorized: false
    };
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

module.exports = {
  generateCode,
  send2FACode,
  send2FADisabledNotification,
  sendCredentials
};