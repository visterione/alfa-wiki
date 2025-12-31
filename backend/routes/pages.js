const express = require('express');
const { body, validationResult } = require('express-validator');
const sanitizeHtml = require('sanitize-html');
const { Page, User, SearchIndex, Folder, SidebarItem } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

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
    'td': ['colspan', 'rowspan'],
    'th': ['colspan', 'rowspan', 'scope']
  },
  allowedSchemes: ['http', 'https', 'data', 'mailto', 'tel']
};

function extractTextContent(html) {
  if (!html) return '';
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
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
        return page.allowedRoles.includes(req.user.roleId);
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
      if (!page.allowedRoles.includes(req.user.roleId)) {
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

    await page.update(updateData);

    await SearchIndex.upsert({
      entityType: 'page',
      entityId: page.id,
      title: page.title,
      content: page.searchContent,
      keywords: page.keywords,
      url: `/page/${page.slug}`
    });

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

module.exports = router;