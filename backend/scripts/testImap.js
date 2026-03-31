/**
 * Диагностика IMAP-подключения
 * Запуск: node scripts/testImap.js
 */
require('dotenv').config();
const { ImapFlow } = require('imapflow');

const configs = [
  { host: process.env.MAIL_IMAP_HOST, port: 993, secure: true,  label: '993 SSL/TLS' },
  { host: process.env.MAIL_IMAP_HOST, port: 143, secure: false, label: '143 STARTTLS' },
];

async function test({ host, port, secure, label }) {
  console.log(`\nПробуем ${host}:${port} (${label})...`);
  const client = new ImapFlow({
    host, port, secure,
    auth: { user: process.env.MAIL_IMAP_USER, pass: process.env.MAIL_IMAP_PASSWORD },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    console.log(`  ✓ Подключились! Открываем INBOX...`);
    const mb = await client.mailboxOpen('INBOX');
    console.log(`  ✓ INBOX открыт. Писем: ${mb.exists}`);
    const uids = await client.search({ unseen: true });
    console.log(`  ✓ Непрочитанных: ${uids.length}`);
    await client.logout();
    console.log(`  ✓ Готово. Используйте PORT=${port}, TLS=${secure}`);
    return true;
  } catch (err) {
    console.log(`  ✗ Ошибка: ${err.message}`);
    await client.logout().catch(() => {});
    return false;
  }
}

(async () => {
  for (const cfg of configs) {
    const ok = await test(cfg);
    if (ok) break;
  }
})();
