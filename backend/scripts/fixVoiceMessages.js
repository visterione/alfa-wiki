/**
 * Разовая починка уже загруженных голосовых сообщений.
 *
 * Зачем: пока на сервере не было ffmpeg (или пока проверка его наличия
 * защёлкивалась в отрицательном ответе), записи сохранялись как есть.
 * Браузерный webm/opus играет только в браузере — ни Android, ни iOS его не
 * открывают, и такие сообщения на телефоне выглядят как «нажал, а звука нет».
 * Плюс у всех них пустая длительность, из-за чего не двигалась полоса прогресса.
 *
 * Что делает: находит сообщения type='voice', приводит файл к m4a/AAC тем же
 * voiceService, что и при загрузке, и обновляет attachments — путь, mime,
 * размер, длительность.
 *
 * Запуск из каталога backend:
 *   node scripts/fixVoiceMessages.js          — показать, что будет сделано
 *   node scripts/fixVoiceMessages.js --apply  — выполнить
 */

const fs = require('fs');
const path = require('path');
const { sequelize, Message } = require('../models');
const voiceService = require('../services/voiceService');

const APPLY = process.argv.includes('--apply');

async function main() {
  const hasFfmpeg = await voiceService.checkFfmpeg();
  if (!hasFfmpeg) {
    console.error('ffmpeg не найден — чинить нечем. Установите его и повторите.');
    process.exit(1);
  }

  const messages = await Message.findAll({ where: { type: 'voice' } });
  console.log(`Найдено голосовых сообщений: ${messages.length}`);

  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (const message of messages) {
    const attachments = message.attachments || [];
    const voice = attachments[0];
    if (!voice?.path) {
      skipped++;
      continue;
    }

    const alreadyOk = voice.mimeType === 'audio/mp4' && voice.duration > 0;
    if (alreadyOk) {
      skipped++;
      continue;
    }

    const absolute = path.isAbsolute(voice.path)
      ? voice.path
      : path.join(__dirname, '..', voice.path);

    if (!fs.existsSync(absolute)) {
      console.warn(`  нет файла: ${voice.path}`);
      failed++;
      continue;
    }

    console.log(`  ${message.id}: ${voice.mimeType || '?'} duration=${voice.duration ?? 'null'} → пересобираю`);
    if (!APPLY) {
      fixed++;
      continue;
    }

    // normalize ждёт объект в формате multer
    const result = await voiceService.normalize({
      path: absolute,
      mimetype: voice.mimeType || 'audio/mp4',
      size: fs.statSync(absolute).size,
      originalname: voice.name || 'voice',
    });

    if (!result.transcoded) {
      console.warn('    перекодировать не удалось, оставляю как было');
      failed++;
      continue;
    }

    // В базе путь хранится относительным — приводим обратно
    const relative = path.relative(path.join(__dirname, '..'), result.path).replace(/\\/g, '/');

    const updated = [{
      ...voice,
      path: relative,
      mimeType: result.mimeType,
      size: result.size,
      duration: result.duration,
    }];

    // attachments — JSONB; Sequelize не заметит мутацию массива без changed()
    message.attachments = updated;
    message.changed('attachments', true);
    await message.save();
    fixed++;
  }

  console.log(`\nИтого: обработано ${fixed}, пропущено ${skipped}, с ошибками ${failed}`);
  if (!APPLY) {
    console.log('Это был сухой прогон. Чтобы применить: node scripts/fixVoiceMessages.js --apply');
  }

  await sequelize.close();
}

main().catch(err => {
  console.error('Ошибка:', err.message);
  process.exit(1);
});
