'use strict';

/**
 * Наши файлы в анкете (ver. 8.34).
 *
 * Обратное направление к services/vacancies/files.js. Там кандидат присылает
 * нам сканы, здесь мы отдаём ему свой документ: заявление о приёме он заполняет
 * по нашему бланку, и бланк должен лежать у того самого поля, куда потом ляжет
 * заполненный файл. Пока его высылали письмом отдельно, заявления приходили
 * написанные как придётся.
 *
 * Отдельный модуль, а не пара функций в files.js: правила у двух направлений
 * разные почти во всём. Кандидат присылает PDF и фотографии, и его файл —
 * персональные данные за guard'ом; мы отдаём ещё и .docx (бланк для заполнения
 * его же и требует), а наш бланк персональных данных не содержит и раздаётся
 * всем, кто открыл анкету.
 *
 * Файлы лежат в uploads/vacancies/samples — то есть под общим guard'ом раздела,
 * который знает только про vac_files и такое имя не пропустит. Это намеренно:
 * наружу они уходят единственным маршрутом публичного контура, который отдаёт
 * файл под настоящим именем («Заявление.docx», а не «1758…-9f3a.docx») и с
 * заголовками из uploadSafety.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const { VacAttachment } = require('../../models');

const SAMPLE_DIR = path.join(__dirname, '..', '..', 'uploads', 'vacancies', 'samples');

// Двадцать мегабайт против десяти у кандидата: это мы кладём сюда файл, и
// сканированный на офисном МФУ бланк на шесть страниц туда должен помещаться.
const MAX_FILE_MB = 20;

// Расширение берём из типа, а не из присланного имени: имя — это путь, которым
// управляет загружающий. Список шире кандидатского ровно на то, чем бывают
// бланки: .docx для заполнения, .xlsx для таблиц, .rtf из старых шаблонов.
const EXT_BY_MIME = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/rtf': '.rtf',
  'text/rtf': '.rtf',
  'text/plain': '.txt',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic'
};
const ALLOWED_MIMES = new Set(Object.keys(EXT_BY_MIME));

const ACCEPT_HINT = 'Принимаются PDF, документы Word и Excel, RTF, TXT и изображения';

/** Загрузчик бланка. Как и у кандидатских файлов, имя на диске генерируем сами. */
function uploader() {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(SAMPLE_DIR, { recursive: true });
      cb(null, SAMPLE_DIR);
    },
    filename: (req, file, cb) => {
      const ext = EXT_BY_MIME[file.mimetype] || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIMES.has(file.mimetype)) return cb(new Error(ACCEPT_HINT));
      cb(null, true);
    }
  });
}

function pathOf(filename) {
  return path.join(SAMPLE_DIR, path.basename(String(filename || '')));
}

function removeFile(filename) {
  if (!filename) return;
  try {
    fs.unlinkSync(pathOf(filename));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[vacancies/attachments] Не удалось удалить файл:', error.message);
    }
  }
}

// ── Владелец ───────────────────────────────────────────────────────────────
//
// Файл принадлежит вакансии либо шаблону. Владелец всюду передаётся одним
// объектом { vacancyId } или { templateId }, чтобы маршруты вакансий и
// шаблонов делили один и тот же код: разница между ними — только в этом ключе.

function ownerWhere(owner) {
  return owner.templateId ? { templateId: owner.templateId } : { vacancyId: owner.vacancyId };
}

/** Файлы владельца в том виде, в каком их ждут редактор и публичная анкета. */
async function listFor(owner) {
  const rows = await VacAttachment.findAll({
    where: ownerWhere(owner),
    attributes: ['id', 'title', 'filename', 'originalName', 'mimeType', 'size', 'createdAt'],
    order: [['createdAt', 'ASC']]
  });
  return rows.map(row => row.get({ plain: true }));
}

// ── Ссылки из анкеты ───────────────────────────────────────────────────────

/** Идентификаторы файлов, на которые ссылаются поля анкеты. */
function collectIds(form) {
  const ids = new Set();
  for (const block of form?.blocks || []) {
    for (const field of block.fields || []) {
      for (const id of field.attachments || []) if (id) ids.add(String(id));
    }
  }
  return ids;
}

/**
 * Замена идентификаторов в анкете по карте «старый → новый». Нужна при
 * копировании: у копии файлы свои, и ссылки на чужие строки в ней — это чужой
 * файл, который однажды удалят вместе с его владельцем.
 *
 * Ссылка, которой нет в карте, выбрасывается: она либо от удалённого файла,
 * либо от чужого владельца, и в обоих случаях показывать её нечем.
 */
function remapIds(form, map) {
  const next = JSON.parse(JSON.stringify(form || {}));
  for (const block of next.blocks || []) {
    for (const field of block.fields || []) {
      if (!Array.isArray(field.attachments)) continue;
      const kept = field.attachments.map(id => map.get(String(id))).filter(Boolean);
      if (kept.length) field.attachments = kept;
      else delete field.attachments;
    }
  }
  return next;
}

/**
 * Копирование файлов вместе с анкетой: из шаблона в новую вакансию и обратно,
 * когда вакансию сохраняют как шаблон.
 *
 * Копируются и строки, и сами файлы на диске. Общий файл на двоих был бы
 * дешевле, но тогда удаление шаблона уносило бы бланк из живой вакансии, а
 * замена бланка в шаблоне молча меняла бы его у всех, кто когда-то этим
 * шаблоном воспользовался, — ровно та связь, от которой шаблон и уходит.
 *
 * @returns {Promise<object>} анкета с переписанными ссылками
 */
async function copyInto(form, fromOwner, toOwner, userId) {
  const used = collectIds(form);
  if (!used.size) return form;

  const rows = await VacAttachment.findAll({ where: ownerWhere(fromOwner) });
  const map = new Map();

  for (const row of rows) {
    if (!used.has(row.id)) continue;

    const ext = path.extname(row.filename);
    const filename = `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`;
    try {
      fs.mkdirSync(SAMPLE_DIR, { recursive: true });
      fs.copyFileSync(pathOf(row.filename), pathOf(filename));
    } catch (error) {
      // Файла на диске нет — строка осталась от ручной уборки uploads. Копию не
      // заводим: ссылка на пустое место хуже, чем её отсутствие.
      console.warn('[vacancies/attachments] Не удалось скопировать файл:', error.message);
      continue;
    }

    const copy = await VacAttachment.create({
      ...toOwner,
      title: row.title,
      filename,
      originalName: row.originalName,
      mimeType: row.mimeType,
      size: row.size,
      uploadedBy: userId || null
    });
    map.set(row.id, copy.id);
  }

  return remapIds(form, map);
}

/**
 * Уборка после сохранения анкеты.
 *
 * Файл прикладывается сразу, а анкета сохраняется кнопкой, поэтому загруженный
 * и тут же отцепленный бланк остаётся ничьим. Выбрасываем такие — но только у
 * вакансии, по которой ещё никто не откликнулся.
 *
 * Причина исключения в снимке: отправленная заявка отвечает на ту анкету,
 * которую человек открыл, и ссылка на бланк живёт в её снимке. Убрать поле из
 * нынешней анкеты — обычное дело, а удалить вместе с ним файл значит сломать
 * образец у того, кого как раз вернули на доработку. Пара забытых файлов на
 * диске дешевле.
 */
async function pruneUnused(owner, form, { keepAll = false } = {}) {
  if (keepAll) return 0;

  const used = collectIds(form);
  const rows = await VacAttachment.findAll({ where: ownerWhere(owner) });
  let removed = 0;

  for (const row of rows) {
    if (used.has(row.id)) continue;
    removeFile(row.filename);
    await row.destroy();
    removed += 1;
  }
  return removed;
}

/**
 * Ссылки на чужие и несуществующие файлы из присланной анкеты.
 *
 * Редактор присылает анкету целиком, вместе со ссылками, и подставить туда
 * идентификатор файла соседней вакансии ему ничто не мешает. Своими считаются
 * только файлы владельца.
 */
async function keepOwn(owner, form) {
  const used = collectIds(form);
  if (!used.size) return form;

  const rows = await VacAttachment.findAll({
    where: ownerWhere(owner),
    attributes: ['id']
  });
  const own = new Map(rows.map(row => [row.id, row.id]));
  return remapIds(form, own);
}

module.exports = {
  SAMPLE_DIR,
  MAX_FILE_MB,
  ACCEPT_HINT,
  uploader,
  pathOf,
  removeFile,
  ownerWhere,
  listFor,
  collectIds,
  copyInto,
  pruneUnused,
  keepOwn
};
