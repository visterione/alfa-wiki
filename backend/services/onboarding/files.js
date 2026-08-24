'use strict';

/**
 * Файлы анкеты: приём и доступ.
 *
 * Сканы диплома, сертификатов и портретное фото — персональные данные, а
 * /uploads раздаётся express.static целиком. До ver. 7.27 так же лежали
 * вложения чатов, и «кто знал имя файла, тот и читал, хоть из интернета» —
 * повторять эту историю с паспортными данными врачей нельзя.
 *
 * Поэтому файлы онбординга живут в своей подпапке за guard'ом, устроенным как
 * chatFileGuard: имя файла → заявка → право смотреть. Право есть у сотрудника,
 * которому заявка видна, и у самого врача по токену его заявки.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const { OnbFile, OnbApplication } = require('../../models');
const access = require('./access');
const fileAccess = require('../fileAccess');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'onboarding');

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

function removeFile(filename) {
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(filename)));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[onboarding/files] Не удалось удалить файл:', error.message);
    }
  }
}

/**
 * Guard на /uploads/onboarding.
 *
 * Два способа предъявить право, как и у вложений чата: подписанный токен
 * сотрудника в query (заголовок Authorization в <img src> не подставить) либо
 * токен заявки — по нему свои файлы смотрит сам врач, у которого аккаунта нет.
 */
async function onboardingFileGuard(req, res, next) {
  try {
    const filename = decodeURIComponent(req.path).split('/').pop();
    if (!filename) return res.status(404).send('Not found');

    const file = await OnbFile.findOne({ where: { filename }, attributes: ['applicationId', 'kind'] });
    if (!file) return res.status(404).send('Not found');

    // Врач по ссылке на свою заявку
    const appToken = String(req.query.app || '');
    if (appToken) {
      const app = await OnbApplication.findOne({
        where: { accessToken: appToken },
        attributes: ['id']
      });
      if (app && app.id === file.applicationId) return next();
      return res.status(403).send('Forbidden');
    }

    // Сотрудник
    const userId = fileAccess.verifyToken(String(req.query.t || ''));
    if (!userId) return res.status(401).send('Unauthorized');

    const allowed = await access.canViewFile(userId, file);
    if (!allowed) return res.status(403).send('Forbidden');

    next();
  } catch (error) {
    console.error('[onboarding/files] Guard error:', error);
    res.status(500).send('Internal error');
  }
}

module.exports = {
  UPLOAD_DIR,
  MAX_FILE_MB,
  uploader,
  removeFile,
  onboardingFileGuard
};
