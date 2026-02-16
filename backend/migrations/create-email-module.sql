-- =====================================================
-- EMAIL MODULE - ALL TABLES
-- =====================================================

-- 1. EMAIL TEMPLATES (шаблоны писем)
CREATE TABLE IF NOT EXISTS email_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    "htmlContent" TEXT NOT NULL,
    "createdBy" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "isPublic" BOOLEAN DEFAULT TRUE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для email_templates
CREATE INDEX IF NOT EXISTS idx_email_templates_created_by ON email_templates("createdBy");
CREATE INDEX IF NOT EXISTS idx_email_templates_is_public ON email_templates("isPublic");

-- Комментарии для email_templates
COMMENT ON TABLE email_templates IS 'Шаблоны email-рассылок';
COMMENT ON COLUMN email_templates.name IS 'Название шаблона письма';
COMMENT ON COLUMN email_templates.subject IS 'Тема письма';
COMMENT ON COLUMN email_templates."htmlContent" IS 'HTML содержимое письма';
COMMENT ON COLUMN email_templates."createdBy" IS 'ID пользователя-создателя шаблона';
COMMENT ON COLUMN email_templates."isPublic" IS 'Публичный шаблон (доступен всем) или личный';

-- 2. EMAIL LOGS (история отправки)
CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject VARCHAR(500) NOT NULL,
    "htmlContent" TEXT NOT NULL,
    recipients JSONB NOT NULL,
    attachments JSONB DEFAULT '[]'::jsonb,
    "sentBy" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "sentAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'sent',
    "errorDetails" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для email_logs
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_by ON email_logs("sentBy");
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs("sentAt");
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);

-- Комментарии для email_logs
COMMENT ON TABLE email_logs IS 'История отправленных email-рассылок';
COMMENT ON COLUMN email_logs.subject IS 'Тема письма';
COMMENT ON COLUMN email_logs."htmlContent" IS 'HTML содержимое письма';
COMMENT ON COLUMN email_logs.recipients IS 'Массив получателей: [{email, userId, displayName}]';
COMMENT ON COLUMN email_logs.attachments IS 'Массив вложений: [{name, path, size, mimeType}]';
COMMENT ON COLUMN email_logs."sentBy" IS 'ID пользователя, отправившего рассылку';
COMMENT ON COLUMN email_logs."sentAt" IS 'Время отправки';
COMMENT ON COLUMN email_logs.status IS 'Статус отправки: sent (успешно), failed (ошибка), partial (частично)';
COMMENT ON COLUMN email_logs."errorDetails" IS 'JSON с деталями ошибок отправки';

-- Пример шаблона для тестирования (опционально)
INSERT INTO email_templates (name, subject, "htmlContent", "createdBy", "isPublic")
SELECT
    'Приветственное письмо',
    'Добро пожаловать в Alfa Wiki!',
    '<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f7; }
        .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        .header { background: linear-gradient(135deg, #007AFF 0%, #5856D6 100%); padding: 40px 30px; text-align: center; }
        .header h1 { margin: 0; color: white; font-size: 28px; font-weight: 700; }
        .content { padding: 40px 30px; }
        .footer { background: #f5f5f7; padding: 20px 30px; text-align: center; color: #86868B; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎉 Добро пожаловать!</h1>
        </div>
        <div class="content">
            <h2 style="color: #1D1D1F; margin-top: 0;">Здравствуйте!</h2>
            <p style="color: #86868B; font-size: 15px; line-height: 1.6;">
                Рады приветствовать вас в системе Alfa Wiki. Здесь вы найдете всю необходимую информацию и сможете эффективно работать с коллегами.
            </p>
            <p style="color: #86868B; font-size: 15px; line-height: 1.6;">
                Если у вас возникнут вопросы, обращайтесь к администратору.
            </p>
        </div>
        <div class="footer">
            <p>© ' || EXTRACT(YEAR FROM CURRENT_TIMESTAMP) || ' Alfa Wiki. Все права защищены.</p>
        </div>
    </div>
</body>
</html>',
    (SELECT id FROM users WHERE "isAdmin" = TRUE LIMIT 1),
    TRUE
WHERE EXISTS (SELECT 1 FROM users WHERE "isAdmin" = TRUE)
ON CONFLICT DO NOTHING;

-- 3. EMAIL FAVORITE RECIPIENTS (избранные получатели)
CREATE TABLE IF NOT EXISTS email_favorite_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    "displayName" VARCHAR(200),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("userId", email)
);

CREATE INDEX IF NOT EXISTS idx_email_fav_recipients_user ON email_favorite_recipients("userId");

COMMENT ON TABLE email_favorite_recipients IS 'Избранные получатели email для каждого пользователя';

-- 4. EMAIL FAVORITE TEMPLATES (избранные шаблоны)
CREATE TABLE IF NOT EXISTS email_favorite_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "templateId" UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("userId", "templateId")
);

CREATE INDEX IF NOT EXISTS idx_email_fav_templates_user ON email_favorite_templates("userId");

COMMENT ON TABLE email_favorite_templates IS 'Избранные шаблоны email для каждого пользователя';

-- Готово!
-- Таблицы email_templates, email_logs, email_favorite_recipients, email_favorite_templates созданы.
