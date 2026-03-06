const { diffLines } = require('diff');
const express = require('express');
const { body, validationResult } = require('express-validator');
const sanitizeHtml = require('sanitize-html');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx-js-style');
const { Page, User, SearchIndex, Folder, SidebarItem, PageHistory } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { convertXlsxToUniver, convertUniverToXlsx } = require('../utils/xlsxConverter');
const { generatePageHistoryPdf } = require('../services/pdfService');

const router = express.Router();

// Multer configuration for file uploads
const upload = multer({
  dest: 'uploads/temp/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'));
    }
  }
});

// Sanitize config for WYSIWYG content
const sanitizeConfig = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img', 'video', 'audio', 'iframe', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div', 'section', 'article', 'header', 'footer',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'mark', 'del', 'ins'
  ]),
  allowedAttributes: {
    '*': ['class', 'id', 'style', 'data-*'],
    'a': ['href', 'target', 'rel'],
    'img': ['src', 'alt', 'width', 'height', 'loading'],
    'video': ['src', 'controls', 'width', 'height', 'poster'],
    'audio': ['src', 'controls'],
    'iframe': ['src', 'width', 'height', 'frameborder', 'allowfullscreen'],
    'td': ['colspan', 'rowspan', 'colwidth'],
    'th': ['colspan', 'rowspan', 'scope', 'colwidth']
  },
  allowedSchemes: ['http', 'https', 'data', 'mailto', 'tel']
};

function extractTextContent(html) {
  if (!html) return '';
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

// Извлекает структурированный текст из HTML, сохраняя строки через \n
function extractStructuredText(html) {
  if (!html) return '';
  // Удаляем script/style блоки, чтобы JS/CSS и UI-шаблоны не попадали в diff
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const withBreaks = cleaned.replace(/<\/(div|p|li|h[1-6]|tr|td|th|section|article|header|footer|br)[^>]*>/gi, '\n');
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Вычисляет diff содержимого: возвращает добавленные и удалённые строки
function computeContentDiff(oldHtml, newHtml, contentType) {
  if (contentType === 'spreadsheet') {
    return computeSpreadsheetDiff(oldHtml, newHtml);
  }
  const oldText = extractStructuredText(oldHtml || '');
  const newText = extractStructuredText(newHtml || '');
  if (oldText === newText) return null;

  const chunks = diffLines(oldText, newText);
  const addedLines = [];
  const removedLines = [];
  for (const chunk of chunks) {
    const lines = chunk.value.split('\n').map(l => l.trim()).filter(Boolean);
    if (chunk.added)   addedLines.push(...lines);
    if (chunk.removed) removedLines.push(...lines);
  }
  return {
    field: 'content',
    label: 'Содержимое',
    addedLines:   addedLines.slice(0, 15),
    removedLines: removedLines.slice(0, 15),
    delta: newText.length - oldText.length,
  };
}

function computeSpreadsheetDiff(oldJson, newJson) {
  try {
    const oldData = JSON.parse(oldJson || '{}');
    const newData = JSON.parse(newJson || '{}');
    const changed = [];
    for (const sheetId of Object.keys(newData.sheets || {})) {
      const oldCells = ((oldData.sheets || {})[sheetId] || {}).cellData || {};
      const newCells = newData.sheets[sheetId].cellData || {};
      for (const r of Object.keys(newCells))
        for (const c of Object.keys(newCells[r])) {
          const nv = newCells[r][c].v, ov = ((oldCells[r] || {})[c] || {}).v;
          if (nv !== ov) changed.push({ cell: `${String.fromCharCode(65 + parseInt(c))}${+r + 1}`, from: ov ?? '', to: nv ?? '' });
        }
      for (const r of Object.keys(oldCells))
        for (const c of Object.keys(oldCells[r])) {
          if (!((newCells[r] || {})[c])) {
            const ov = oldCells[r][c].v;
            changed.push({ cell: `${String.fromCharCode(65 + parseInt(c))}${+r + 1}`, from: ov ?? '', to: '' });
          }
        }
    }
    return {
      field: 'content',
      label: 'Таблица',
      changedCells: changed.slice(0, 20),
    };
  } catch { return null; }
}

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[а-яё]/gi, char => {
      const ru = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
      const en = ['a','b','v','g','d','e','yo','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','c','ch','sh','sch','','y','','e','yu','ya'];
      const idx = ru.indexOf(char.toLowerCase());
      return idx >= 0 ? en[idx] : char;
    })
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Get all pages (with filtering)
router.get('/', authenticate, async (req, res) => {
  try {
    const { published, search, folderId, limit = 50, offset = 0 } = req.query;
    
    const where = {};
    if (published !== undefined) {
      where.isPublished = published === 'true';
    }
    
    // Фильтр по папке
    if (folderId !== undefined) {
      where.folderId = folderId === 'null' ? null : folderId;
    }

    if (!req.user.isAdmin && published === undefined) {
      where.isPublished = true;
    }

    const pages = await Page.findAndCountAll({
      where,
      include: [
        { model: User, as: 'author', attributes: ['id', 'displayName', 'username'] },
        { model: User, as: 'editor', attributes: ['id', 'displayName', 'username'] },
        { model: Folder, as: 'folder', attributes: ['id', 'title'] }
      ],
      order: [['sortOrder', 'ASC'], ['updatedAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
      attributes: { exclude: ['content', 'customCss', 'customJs'] }
    });

    if (!req.user.isAdmin) {
      pages.rows = pages.rows.filter(page => {
        if (!page.allowedRoles || page.allowedRoles.length === 0) return true;
        const userRoleIds = req.user.roles?.map(r => r.id) || [];
        return userRoleIds.some(roleId => page.allowedRoles.includes(roleId));
      });
    }

    res.json(pages);
  } catch (error) {
    console.error('Get pages error:', error);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

// Get single page by slug or ID
router.get('/:identifier', authenticate, async (req, res) => {
  try {
    const { identifier } = req.params;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    
    const page = await Page.findOne({
      where: isUUID ? { id: identifier } : { slug: identifier },
      include: [
        { model: User, as: 'author', attributes: ['id', 'displayName', 'username'] },
        { model: User, as: 'editor', attributes: ['id', 'displayName', 'username'] },
        { model: Folder, as: 'folder', attributes: ['id', 'title'] }
      ]
    });

    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }

    if (!page.isPublished) {
      const canView = req.user.isAdmin || 
                      page.createdBy === req.user.id ||
                      req.user.permissions?.pages?.write;
      if (!canView) {
        return res.status(404).json({ error: 'Page not found' });
      }
    }

    if (!req.user.isAdmin && page.allowedRoles?.length > 0) {
      const userRoleIds = req.user.roles?.map(r => r.id) || [];
      const hasAccess = userRoleIds.some(roleId => page.allowedRoles.includes(roleId));
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json(page);
  } catch (error) {
    console.error('Get page error:', error);
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

// Create page
router.post('/', authenticate, requirePermission('pages', 'write'), [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('contentType').optional().isIn(['wysiwyg', 'html']).withMessage('Invalid content type')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, content, contentType = 'wysiwyg', description, keywords, icon, 
            isPublished, allowedRoles, customCss, customJs, metadata, folderId } = req.body;

    let slug = req.body.slug || generateSlug(title);
    
    const existing = await Page.findOne({ where: { slug } });
    if (existing) {
      slug = `${slug}-${Date.now()}`;
    }

    const sanitizedContent = contentType === 'html' 
      ? content 
      : sanitizeHtml(content || '', sanitizeConfig);
    const searchContent = extractTextContent(sanitizedContent);

    // Получаем maxSortOrder для папки
    const maxOrder = await Page.max('sortOrder', { 
      where: { folderId: folderId || null } 
    });

    const page = await Page.create({
      slug,
      title,
      content: sanitizedContent,
      contentType,
      description,
      keywords: keywords || [],
      searchContent,
      icon,
      folderId: folderId || null,
      sortOrder: (maxOrder || 0) + 1,
      isPublished: isPublished || false,
      allowedRoles: allowedRoles || [],
      customCss,
      customJs,
      metadata: metadata || {},
      createdBy: req.user.id,
      updatedBy: req.user.id
    });

    await SearchIndex.upsert({
      entityType: 'page',
      entityId: page.id,
      title: page.title,
      content: searchContent,
      keywords: page.keywords,
      url: `/page/${page.slug}`
    });

    // Записываем в историю
    await PageHistory.create({
      pageId: page.id,
      userId: req.user.id,
      action: 'created',
      changesSummary: `Создана страница "${title}"`,
      metadata: {
        isPublished: page.isPublished,
        folderId: page.folderId
      }
    });

    const created = await Page.findByPk(page.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'displayName', 'username'] },
        { model: Folder, as: 'folder', attributes: ['id', 'title'] }
      ]
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Create page error:', error);
    res.status(500).json({ error: 'Failed to create page' });
  }
});

// Update page
router.put('/:id', authenticate, requirePermission('pages', 'write'), async (req, res) => {
  try {
    const page = await Page.findByPk(req.params.id);
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const { title, content, contentType, description, keywords, icon,
            isPublished, allowedRoles, customCss, customJs, metadata, slug, folderId, sortOrder } = req.body;

    if (slug && slug !== page.slug) {
      const existing = await Page.findOne({ where: { slug } });
      if (existing) {
        return res.status(400).json({ error: 'Slug already exists' });
      }
    }

    const updateData = {
      ...(title && { title }),
      ...(slug && { slug }),
      ...(contentType && { contentType }),
      ...(description !== undefined && { description }),
      ...(keywords && { keywords }),
      ...(icon !== undefined && { icon }),
      ...(isPublished !== undefined && { isPublished }),
      ...(allowedRoles && { allowedRoles }),
      ...(customCss !== undefined && { customCss }),
      ...(customJs !== undefined && { customJs }),
      ...(metadata && { metadata }),
      ...(folderId !== undefined && { folderId: folderId || null }),
      ...(sortOrder !== undefined && { sortOrder }),
      updatedBy: req.user.id
    };

    if (content !== undefined) {
      const type = contentType || page.contentType;
      const sanitizedContent = type === 'html' 
        ? content 
        : sanitizeHtml(content || '', sanitizeConfig);
      const searchContent = extractTextContent(sanitizedContent);
      
      updateData.content = sanitizedContent;
      updateData.searchContent = searchContent;
    }

    // Сохраняем старые значения ДО обновления
    const oldValues = {
      title: page.title,
      content: page.content,
      slug: page.slug,
      description: page.description,
      icon: page.icon,
      folderId: page.folderId,
      contentType: page.contentType,
      customCss: page.customCss,
      customJs: page.customJs,
      isPublished: page.isPublished,
    };

    await page.update(updateData);

    await SearchIndex.upsert({
      entityType: 'page',
      entityId: page.id,
      title: page.title,
      content: page.searchContent,
      keywords: page.keywords,
      url: `/page/${page.slug}`
    });

    // Определяем детальные изменения для истории
    const detailedChanges = [];
    let historyAction = 'updated';

    if (title && title !== oldValues.title)
      detailedChanges.push({ field: 'title', label: 'Заголовок', from: oldValues.title, to: title });

    if (slug && slug !== oldValues.slug)
      detailedChanges.push({ field: 'slug', label: 'Адрес (slug)', from: oldValues.slug, to: slug });

    if (description !== undefined && description !== oldValues.description)
      detailedChanges.push({ field: 'description', label: 'Описание',
        from: oldValues.description || '', to: description || '' });

    if (icon !== undefined && icon !== oldValues.icon)
      detailedChanges.push({ field: 'icon', label: 'Иконка', from: oldValues.icon, to: icon });

    if (folderId !== undefined && folderId !== oldValues.folderId)
      detailedChanges.push({ field: 'folder', label: 'Папка' });

    if (customCss !== undefined && customCss !== oldValues.customCss)
      detailedChanges.push({ field: 'customCss', label: 'CSS-стили изменены' });

    if (customJs !== undefined && customJs !== oldValues.customJs)
      detailedChanges.push({ field: 'customJs', label: 'JavaScript изменён' });

    if (content !== undefined) {
      const effectiveType = contentType || oldValues.contentType;
      const contentDiff = computeContentDiff(oldValues.content, updateData.content, effectiveType);
      if (contentDiff) {
        // Для spreadsheet нет смысла показывать diff если ничего не изменилось
        if (contentDiff.changedCells?.length > 0 || contentDiff.addedLines?.length > 0 || contentDiff.removedLines?.length > 0) {
          detailedChanges.push(contentDiff);
        } else if (updateData.content !== oldValues.content) {
          detailedChanges.push({ field: 'content', label: 'Содержимое обновлено (форматирование)' });
        }
      } else if (updateData.content !== oldValues.content) {
        detailedChanges.push({ field: 'content', label: 'Содержимое обновлено (форматирование)' });
      }
    }

    if (isPublished !== undefined && isPublished !== oldValues.isPublished) {
      historyAction = isPublished ? 'published' : 'unpublished';
    }

    // Записываем в историю только если были изменения
    if (detailedChanges.length > 0 || historyAction !== 'updated') {
      const summaryParts = detailedChanges.map(c => {
        if (c.field === 'content') {
          if (c.changedCells) return `Таблица: изменено ${c.changedCells.length} яч.`;
          const added = c.addedLines?.length || 0;
          const removed = c.removedLines?.length || 0;
          if (added && removed) return `Содержимое: +${added} стр., −${removed} стр.`;
          if (added)   return `Содержимое: добавлено ${added} стр.`;
          if (removed) return `Содержимое: удалено ${removed} стр.`;
          return 'Содержимое обновлено';
        }
        if (c.from !== undefined && c.to !== undefined && String(c.from) !== String(c.to))
          return `${c.label}: «${String(c.from).slice(0, 40)}» → «${String(c.to).slice(0, 40)}»`;
        return c.label;
      });

      const changesSummary = historyAction === 'published'   ? 'Страница опубликована'
        : historyAction === 'unpublished' ? 'Публикация отменена'
        : summaryParts.join('; ');

      await PageHistory.create({
        pageId: page.id,
        userId: req.user.id,
        action: historyAction,
        changesSummary,
        metadata: {
          changes: detailedChanges,
          previousContent: oldValues.content
        }
      });
    }

    const updated = await Page.findByPk(page.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'displayName', 'username'] },
        { model: User, as: 'editor', attributes: ['id', 'displayName', 'username'] },
        { model: Folder, as: 'folder', attributes: ['id', 'title'] }
      ]
    });

    res.json(updated);
  } catch (error) {
    console.error('Update page error:', error);
    res.status(500).json({ error: 'Failed to update page' });
  }
});

// Get page history
router.get('/:id/history', authenticate, async (req, res) => {
  try {
    const page = await Page.findByPk(req.params.id);
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }

    // Проверяем права доступа к странице
    if (!req.user.isAdmin && !page.isPublished) {
      const canView = page.createdBy === req.user.id || req.user.permissions?.pages?.write;
      if (!canView) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const history = await PageHistory.findAll({
      where: { pageId: req.params.id },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'displayName', 'username', 'avatar']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json(history);
  } catch (error) {
    console.error('Get page history error:', error);
    res.status(500).json({ error: 'Failed to fetch page history' });
  }
});

// Export page history as PDF
router.get('/:id/history/pdf', authenticate, async (req, res) => {
  try {
    const page = await Page.findByPk(req.params.id);
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }

    // Проверяем права доступа к странице
    if (!req.user.isAdmin && !page.isPublished) {
      const canView = page.createdBy === req.user.id || req.user.permissions?.pages?.write;
      if (!canView) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const history = await PageHistory.findAll({
      where: { pageId: req.params.id },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'displayName', 'username', 'avatar']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Генерируем PDF
    const filePath = await generatePageHistoryPdf(page, history);
    const filename = `История изменений - ${page.title}.pdf`;

    res.json({
      success: true,
      filePath,
      filename
    });

  } catch (error) {
    console.error('Export page history PDF error:', error);
    res.status(500).json({ error: 'Failed to export page history as PDF' });
  }
});

// Delete page
router.delete('/:id', authenticate, requirePermission('pages', 'delete'), async (req, res) => {
  try {
    const page = await Page.findByPk(req.params.id);
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }

    await SearchIndex.destroy({ where: { entityType: 'page', entityId: page.id } });
    
    // Удаляем связанные элементы сайдбара
    await SidebarItem.destroy({ where: { pageId: page.id } });
    
    await page.destroy();

    res.json({ message: 'Page deleted' });
  } catch (error) {
    console.error('Delete page error:', error);
    res.status(500).json({ error: 'Failed to delete page' });
  }
});

// Toggle favorite (legacy support)
router.post('/:id/favorite', authenticate, async (req, res) => {
  try {
    const page = await Page.findByPk(req.params.id);
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    await page.update({ isFavorite: !page.isFavorite });
    res.json({ isFavorite: page.isFavorite });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// Import Excel file to Luckysheet format
router.post('/:id/import-xlsx', authenticate, requirePermission('pages', 'write'), upload.single('file'), async (req, res) => {
  try {
    const page = await Page.findByPk(req.params.id);

    if (!page) {
      // Очистка загруженного файла
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Page not found' });
    }

    if (page.contentType !== 'spreadsheet') {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Page must be of type spreadsheet' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Парсим Excel файл
    const workbook = XLSX.readFile(req.file.path);

    // Конвертируем в формат Univer
    const univerData = convertXlsxToUniver(workbook);

    // Сохраняем в БД
    await page.update({
      content: JSON.stringify(univerData),
      updatedBy: req.user.id
    });

    // Создаем запись в истории
    await PageHistory.create({
      pageId: page.id,
      userId: req.user.id,
      action: 'updated',
      changesSummary: `Импортирован Excel файл: ${req.file.originalname}`,
      metadata: {
        changedFields: ['content'],
        importedFile: req.file.originalname
      }
    });

    // Очищаем временный файл
    fs.unlinkSync(req.file.path);

    res.json({ success: true, data: univerData });
  } catch (error) {
    console.error('Import xlsx error:', error);
    // Очистка файла при ошибке
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to import xlsx file' });
  }
});

// Export Luckysheet to Excel file
router.get('/:id/export-xlsx', authenticate, async (req, res) => {
  try {
    const page = await Page.findByPk(req.params.id);

    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }

    if (page.contentType !== 'spreadsheet') {
      return res.status(400).json({ error: 'Page must be of type spreadsheet' });
    }

    // Проверка доступа по ролям
    if (!req.user.isAdmin && page.allowedRoles?.length > 0) {
      const userRoleIds = req.user.roles?.map(r => r.id) || [];
      const hasAccess = userRoleIds.some(roleId => page.allowedRoles.includes(roleId));
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Парсим Univer данные
    const univerData = JSON.parse(page.content || '{}');

    // Конвертируем в Excel
    const workbook = convertUniverToXlsx(univerData);

    // Генерируем буфер
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Отправляем файл
    const filename = `${page.slug || 'spreadsheet'}_${Date.now()}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Export xlsx error:', error);
    res.status(500).json({ error: 'Failed to export xlsx file' });
  }
});

module.exports = router;