'use strict';

/**
 * Файлы анкеты: приём и доступ (ver. 8.20).
 *
 * Сканы документов и портретное фото — персональные данные, а /uploads
 * раздаётся express.static целиком. До ver. 7.27 так же лежали вложения чатов,
 * и «кто знал имя файла, тот и читал, хоть из интернета»; повторять это с
 * документами кандидатов нельзя.
 *
 * Поэтому файлы раздела живут в своей подпапке за guard'ом: имя файла → заявка
 * → право смотреть. Право есть у сотрудника, который может открыть раздел, и у
 * самого кандидата по токену его заявки — аккаунта в портале у него нет.
 *
 * Отличие от первого поколения одно: вид файла больше не выбирается из трёх
 * зашитых значений, а равен ключу поля анкеты. Какие бывают файлы, теперь
 * решает тот, кто собирает анкету.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const { VacFile, VacApplication } = require('../../models');
const fileAccess = require('../fileAccess');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'vacancies');

const MAX_FILE_MB = 10;
const EXT_BY_MIME = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/webp': '.webp'
};
const ALLOWED_MIMES = new Set(Object.keys(EXT_BY_MIME));

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);

/**
 * Загрузчик для публичной формы. Имя файла на диске генерируем сами: имя,
 * пришедшее от клиента, — это путь, которым он управляет.
 */
function uploader() {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const ext = EXT_BY_MIME[file.mimetype] || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 12 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIMES.has(file.mimetype)) {
        return cb(new Error('Принимаются PDF и изображения (JPG, PNG, HEIC, WEBP)'));
      }
      cb(null, true);
    }
  });
}

/** Подходит ли файл полю: у поля с accept свои ограничения. */
function acceptsFile(field, mimeType) {
  if (field?.accept === 'image') return IMAGE_MIMES.has(mimeType);
  // 'doc' и пустое значение одинаково принимают и сканы, и снятые телефоном
  // фотографии: диплом чаще приносят именно фотографией.
  return ALLOWED_MIMES.has(mimeType);
}

function removeFile(filename) {
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(filename)));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[vacancies/files] Не удалось удалить файл:', error.message);
    }
  }
}

/**
 * Guard на /uploads/vacancies.
 *
 * Два способа предъявить право, как и у вложений чата: токен заявки в query —
 * по нему свои файлы смотрит кандидат, — либо подписанный токен сотрудника
 * (заголовок Authorization в <img src> не подставить).
 */
async function vacancyFileGuard(req, res, next) {
  try {
    const filename = decodeURIComponent(req.path).split('/').pop();
    if (!filename) return res.status(404).send('Not found');

    const file = await VacFile.findOne({ where: { filename }, attributes: ['applicationId'] });
    if (!file) return res.status(404).send('Not found');

    // Кандидат по ссылке на свою заявку
    const appToken = String(req.query.app || '');
    if (appToken) {
      const app = await VacApplication.findOne({
        where: { accessToken: appToken },
        attributes: ['id']
      });
      if (app && app.id === file.applicationId) return next();
      return res.status(403).send('Forbidden');
    }

    // Сотрудник. Кто именно может смотреть заявки, решится вместе с рабочим
    // контуром — сейчас раздел открыт только полным админам, и подписанный
    // токен выдаётся тоже только им.
    const userId = fileAccess.verifyToken(String(req.query.t || ''));
    if (!userId) return res.status(401).send('Unauthorized');

    next();
  } catch (error) {
    console.error('[vacancies/files] Guard error:', error);
    res.status(500).send('Internal error');
  }
}

module.exports = {
  UPLOAD_DIR,
  MAX_FILE_MB,
  uploader,
  acceptsFile,
  removeFile,
  vacancyFileGuard
};
