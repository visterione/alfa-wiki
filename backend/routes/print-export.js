const express = require('express');
const { Op } = require('sequelize');
const { Folder, Page, Setting } = require('../models');
const { authenticate } = require('../middleware/auth');
const { canAccessPage, folderChainChecker } = require('../utils/pageAccess');
const { buildPrintDocument } = require('../services/wikiDocx');

// Выгрузка страниц вики одним документом Word для печати (ver. 8.99).
//
// Документ собирается под конкретного пользователя на каждый запрос и нигде
// не кэшируется: у двух сотрудников с разными ролями набор страниц разный.
// Список id от клиента — только пожелание. Каждую страницу из него сервер
// заново проверяет по тем же правилам, по которым строит дерево выбора, так
// что подставить в запрос id закрытой страницы бесполезно.

const router = express.Router();

const PRINTABLE_TYPES = ['wysiwyg', 'html'];
const MAX_PAGES = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const byTitle = (a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true, sensitivity: 'base' });

// Печатаемые страницы, доступные пользователю, и папки на пути к ним.
// Страница проходит, только если она опубликована, отмечена для печати, она
// сама и вся цепочка её папок открыты пользователю. Закрытая папка закрывает
// вложенное, даже если у самой страницы роли не заданы.
async function loadPrintable(req, { withContent = false, ids = null } = {}) {
  const userRoleIds = req.user.roles?.map(r => r.id) || [];
  const isAdmin = !!req.user.isAdmin;

  const folders = await Folder.findAll({ attributes: ['id', 'title', 'parentId', 'allowedRoles'] });
  const folderOk = folderChainChecker(folders, userRoleIds, isAdmin);

  const where = { isPrintable: true, isPublished: true, contentType: { [Op.in]: PRINTABLE_TYPES } };
  if (ids) where.id = { [Op.in]: ids };
  const attributes = ['id', 'slug', 'title', 'folderId', 'contentType', 'allowedRoles', 'updatedAt'];
  if (withContent) attributes.push('content');

  const pages = (await Page.findAll({ where, attributes }))
    .filter(p => canAccessPage(p, userRoleIds, isAdmin) && folderOk(p.folderId));

  // Папки оставляем только те, что ведут к отобранным страницам: пустые
  // ветки в дереве выбора только мешают.
  const byId = new Map(folders.map(f => [f.id, f]));
  const used = new Set();
  for (const page of pages) {
    let id = page.folderId;
    while (id && !used.has(id)) {
      used.add(id);
      id = byId.get(id)?.parentId;
    }
  }
  return { pages, folders: folders.filter(f => used.has(f.id)) };
}

// Обход в порядке проводника: по названию. Внутри папки сначала её страницы,
// потом подпапки — в проводнике наоборот, но в книге вводные страницы раздела
// должны идти до его подразделов, а не после них.
function orderEntries(pages, folders, snapshots = {}) {
  const childFolders = new Map();
  const folderPages = new Map();
  for (const f of folders) {
    const key = f.parentId || null;
    if (!childFolders.has(key)) childFolders.set(key, []);
    childFolders.get(key).push(f);
  }
  for (const p of pages) {
    const key = p.folderId || null;
    if (!folderPages.has(key)) folderPages.set(key, []);
    folderPages.get(key).push(p);
  }

  const snapshotsAt = new Date();
  const entries = [];
  const walk = (folderId, level) => {
    for (const page of (folderPages.get(folderId) || []).sort(byTitle)) {
      // Снимок из браузера сотрудника — только для html-страниц: у страниц
      // редактора в базе и так всё содержимое, подменять его незачем.
      const snapshot = page.contentType === 'html' && typeof snapshots[page.id] === 'string' ? snapshots[page.id] : null;
      entries.push({
        kind: 'page', title: page.title, level, updatedAt: page.updatedAt,
        contentHtml: snapshot ?? page.content,
        dataAt: snapshot ? snapshotsAt : null,
      });
    }
    for (const folder of (childFolders.get(folderId) || []).sort(byTitle)) {
      entries.push({ kind: 'folder', title: folder.title, level });
      walk(folder.id, level + 1);
    }
  };
  walk(null, 0);
  return entries;
}

async function siteName() {
  const setting = await Setting.findByPk('siteName').catch(() => null);
  return (typeof setting?.value === 'string' && setting.value.trim()) || 'Alfa Wiki';
}

// Дерево для окна выбора: плоские списки, дерево собирает фронт.
router.get('/tree', authenticate, async (req, res) => {
  try {
    const { pages, folders } = await loadPrintable(req);
    res.json({
      folders: folders.map(f => ({ id: f.id, title: f.title, parentId: f.parentId || null })),
      pages: pages.map(p => ({ id: p.id, slug: p.slug, title: p.title, folderId: p.folderId || null, contentType: p.contentType })),
    });
  } catch (error) {
    console.error('Print export tree error:', error);
    res.status(500).json({ error: 'Не удалось получить список страниц' });
  }
});

router.post('/docx', authenticate, async (req, res) => {
  try {
    const ids = [...new Set((Array.isArray(req.body?.pageIds) ? req.body.pageIds : [])
      .filter(id => typeof id === 'string' && UUID_RE.test(id)))];
    if (!ids.length) return res.status(400).json({ error: 'Не выбрано ни одной страницы' });
    if (ids.length > MAX_PAGES) return res.status(400).json({ error: `За один раз можно выгрузить не больше ${MAX_PAGES} страниц` });

    const { pages, folders } = await loadPrintable(req, { withContent: true, ids });
    if (!pages.length) return res.status(404).json({ error: 'Нет доступных страниц для печати' });

    // Снимки html-страниц, снятые в браузере сотрудника (ver. 9.04). Это его
    // собственный HTML для его же документа, прав он не расширяет: берём
    // снимки только тех страниц, что прошли проверку выше, а картинки из
    // закрытых частей uploads конвертер отсекает и здесь.
    const snapshots = req.body?.snapshots && typeof req.body.snapshots === 'object' ? req.body.snapshots : {};

    const generatedAt = new Date();
    const buffer = await buildPrintDocument({
      entries: orderEntries(pages, folders, snapshots),
      siteName: await siteName(),
      generatedBy: req.user.displayName || req.user.username,
      generatedAt,
      baseUrl: process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || '',
    });

    const date = generatedAt.toISOString().slice(0, 10);
    const filename = `Вики для печати ${date}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="wiki-print-${date}.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    console.error('Print export docx error:', error);
    res.status(500).json({ error: 'Не удалось собрать документ' });
  }
});

module.exports = router;
module.exports.orderEntries = orderEntries;
