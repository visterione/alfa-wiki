'use strict';

/**
 * Приём файлов, приложенных к заявке публичного API.
 *
 * Файлы кладём в uploads/public-submissions/ГГГГ-ММ/ и описываем в payload заявки
 * в том же виде, в каком мессенджер хранит вложения ({ name, path, size, mimeType }) —
 * поэтому их можно без переработки отправить в чат вместе с текстом заявки.
 *
 * Форма объявляет файловые поля так:
 *   files: [{ key, label, maxCount, maxSizeMb, mimeTypes, requiredIf }]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'public-submissions');

// Расширение по типу файла: имя, пришедшее от клиента, для хранения не используем
const EXT_BY_MIME = {
  'application/pdf':  '.pdf',
  'image/jpeg':       '.jpg',
  'image/png':        '.png',
  'image/heic':       '.heic',
  'image/heif':       '.heif',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
};

/**
 * Multer для формы: принимает объявленные ею файловые поля в память диска.
 * Ограничения проверяем и здесь (быстрый отказ), и потом в validateFiles —
 * multer знает только про размер, но не про то, какое поле обязательно.
 *
 * @param {Object} form Модуль формы
 * @returns {Function} middleware
 */
function uploaderFor(form) {
  const specs = form.files || [];
  const maxSizeMb = Math.max(...specs.map(s => s.maxSizeMb || 5), 1);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_ROOT, monthFolder());
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = EXT_BY_MIME[file.mimetype] || path.extname(file.originalname).slice(0, 10) || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    }
  });

  const allowedMimes = new Set(specs.flatMap(s => s.mimeTypes || []));

  return multer({
    storage,
    limits: {
      fileSize: maxSizeMb * 1024 * 1024,
      files: specs.reduce((sum, s) => sum + (s.maxCount || 1), 0)
    },
    fileFilter: (req, file, cb) => {
      if (allowedMimes.size && !allowedMimes.has(file.mimetype)) {
        // Отдаём осмысленную ошибку, а не «Unexpected field»
        const err = new Error(`Недопустимый тип файла: ${file.mimetype}`);
        err.code = 'UNSUPPORTED_FILE_TYPE';
        return cb(err);
      }
      cb(null, true);
    }
  }).fields(specs.map(s => ({ name: s.key, maxCount: s.maxCount || 1 })));
}

/**
 * Проверяет загруженные файлы против описания формы и превращает их во вложения.
 *
 * @param {Object} files  req.files от multer
 * @param {Object} form   Модуль формы
 * @param {Object} value  Уже провалидированные текстовые поля — от них зависит,
 *                        обязателен ли файл (галочка на форме)
 * @returns {{ ok: boolean, attachments?: Object, fields?: Object }}
 */
function validateFiles(files, form, value) {
  const specs = form.files || [];
  const attachments = {};
  const fields = {};

  for (const spec of specs) {
    const uploaded = (files && files[spec.key]) || [];
    const isRequired = spec.required || (spec.requiredIf && spec.requiredIf(value));

    // Поле скрыто галочкой — приложенные к нему файлы не нужны
    if (spec.requiredIf && !spec.requiredIf(value)) {
      uploaded.forEach(removeFile);
      continue;
    }

    if (uploaded.length === 0) {
      if (isRequired) fields[spec.key] = `«${spec.label}» — приложите файл`;
      continue;
    }

    if (uploaded.length > (spec.maxCount || 1)) {
      uploaded.forEach(removeFile);
      fields[spec.key] = `«${spec.label}» — не больше ${spec.maxCount || 1} файлов`;
      continue;
    }

    attachments[spec.key] = uploaded.map(file => ({
      // Ключи ровно те, что кладёт в attachments сам мессенджер (см. POST /chat/upload):
      // name и path без ведущего слэша. С парой filename/url файл в чате не открывался —
      // клиент собирает адрес как `${BASE_URL}/${path}`, и ведущий слэш давал
      // «//uploads/...», куда не попадает ни express.static, ни location в nginx
      name: sanitizeName(file.originalname),
      // Путь берём у самого файла, а не собираем заново: так он верен и когда
      // запрос пришёлся на смену месяца
      path: 'uploads/public-submissions/' + path.relative(UPLOAD_ROOT, file.path).split(path.sep).join('/'),
      size: file.size,
      mimeType: file.mimetype
    }));
  }

  // Ошибка в одном поле — не оставляем на диске файлы из остальных
  if (Object.keys(fields).length > 0) {
    Object.values(files || {}).flat().forEach(removeFile);
    return { ok: false, fields };
  }

  return { ok: true, attachments };
}

/** Удаляет уже сохранённый файл — при отказе в приёме заявки. */
function removeFile(file) {
  if (!file?.path) return;
  fs.promises.unlink(file.path).catch(() => {});
}

/**
 * Имя файла показывается в чате, поэтому чистим его от путей и управляющих символов.
 * На диск оно не попадает — там имена генерируются.
 */
function sanitizeName(name) {
  return String(decodeName(name) || 'файл')
    .replace(/[\\/\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 150) || 'файл';
}

/**
 * Возвращает имя файла в UTF-8.
 *
 * multipart передаёт имя байтами, а multer читает их как latin1 — русское
 * название приезжает как «Ð½Ð¾Ð¼ÐµÑÐ¾Ð².pdf». В проекте это лечится так же
 * (routes/media.js, routes/accreditations.js), но там перекодируют вслепую.
 * Здесь так нельзя: заявки шлют сторонние сайты, и уже правильное имя обратная
 * перекодировка сломала бы.
 */
function decodeName(name) {
  const str = String(name || '');
  const code = (ch) => ch.codePointAt(0);

  // Ни одного символа из верхней половины latin1 — перекодировать нечего.
  // Проверяем кодами, а не регуляркой: диапазон 0x80–0x9F это невидимые
  // управляющие символы, в исходнике их легко потерять при правке
  if (![...str].some(ch => code(ch) >= 0x80 && code(ch) <= 0xFF)) return str;

  const decoded = Buffer.from(str, 'latin1').toString('utf8');
  // U+FFFD значит, что это были не UTF-8 байты — оставляем имя как пришло
  return [...decoded].some(ch => code(ch) === 0xFFFD) ? str : decoded;
}

function monthFolder() {
  return new Date().toISOString().slice(0, 7); // ГГГГ-ММ
}

module.exports = { uploaderFor, validateFiles, removeFile, UPLOAD_ROOT };
