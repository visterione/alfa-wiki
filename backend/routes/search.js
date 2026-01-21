const express = require('express');
const { Op } = require('sequelize');
const { Page, SearchIndex, sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Функция для очистки и форматирования excerpt
const cleanExcerpt = (text) => {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
};

// Функция для форматирования результатов из SearchIndex
const formatIndexedResult = async (item, searchTerm) => {
  let excerpt = '';

  if (item.content) {
    const contentLower = item.content.toLowerCase();
    const index = contentLower.indexOf(searchTerm);
    if (index !== -1) {
      const start = Math.max(0, index - 60);
      const end = Math.min(item.content.length, index + searchTerm.length + 60);
      let rawExcerpt = item.content.substring(start, end);
      excerpt = (start > 0 ? '...' : '') +
               cleanExcerpt(rawExcerpt) +
               (end < item.content.length ? '...' : '');
    } else {
      let rawExcerpt = item.content.substring(0, 150);
      excerpt = cleanExcerpt(rawExcerpt) + (item.content.length > 150 ? '...' : '');
    }
  }

  // Получаем иконку родительской страницы, если она указана в метаданных
  let pageIcon = null;
  if (item.metadata && item.metadata.pageSlug) {
    try {
      const parentPage = await Page.findOne({
        where: { slug: item.metadata.pageSlug },
        attributes: ['icon']
      });
      if (parentPage && parentPage.icon) {
        pageIcon = parentPage.icon;
      }
    } catch (err) {
      console.error('Error fetching parent page icon:', err);
    }
  }

  // Специальная обработка для разных типов сущностей
  let displayType = item.entityType;
  let icon = pageIcon || 'file';
  let structuredData = null; // Новое поле для структурированных данных

  switch (item.entityType) {
    case 'accreditation':
      displayType = 'Аккредитация';
      if (!pageIcon) icon = 'award';
      if (item.metadata) {
        const meta = item.metadata;
        structuredData = {
          medCenter: meta.medCenter || null,
          specialty: meta.specialty || null,
          expirationDate: meta.expirationDate || null
        };
        // Оставляем старый excerpt для совместимости
        const parts = [];
        if (meta.medCenter) parts.push(`Медцентр: ${meta.medCenter}`);
        if (meta.expirationDate) {
          const date = new Date(meta.expirationDate);
          parts.push(`Срок: ${date.toLocaleDateString('ru-RU')}`);
        }
        if (parts.length > 0) {
          excerpt = parts.join(' • ') + (excerpt ? ' | ' + excerpt : '');
        }
      }
      break;

    case 'vehicle':
      displayType = 'Транспорт';
      if (!pageIcon) icon = 'car';
      if (item.metadata) {
        const meta = item.metadata;
        structuredData = {
          organization: meta.organization || null,
          licensePlate: meta.licensePlate || null,
          insuranceDate: meta.insuranceDate || null,
          model: meta.model || null
        };
        // Оставляем старый excerpt для совместимости
        const parts = [];
        if (meta.organization) parts.push(`Орг: ${meta.organization}`);
        if (meta.licensePlate) parts.push(`${meta.licensePlate}`);
        if (meta.insuranceDate) {
          const date = new Date(meta.insuranceDate);
          parts.push(`Страховка: ${date.toLocaleDateString('ru-RU')}`);
        }
        if (parts.length > 0) {
          excerpt = parts.join(' • ') + (excerpt ? ' | ' + excerpt : '');
        }
      }
      break;

    case 'doctor':
      displayType = 'Врач';
      if (!pageIcon) icon = 'user';
      if (item.metadata) {
        const meta = item.metadata;

        // Поиск совпадающей услуги
        let matchedService = null;
        if (item.content) {
          const searchLower = searchTerm.toLowerCase();
          const contentParts = item.content.split(' | ');

          for (const part of contentParts) {
            if (part.toLowerCase().includes(searchLower) &&
                !part.toLowerCase().includes(item.title?.toLowerCase() || '')) {
              matchedService = part.substring(0, 80);
              break;
            }
          }
        }

        structuredData = {
          specialty: meta.specialty || null,
          servicesCount: meta.servicesCount || 0,
          pageSlug: meta.pageSlug || null,
          matchedService: matchedService
        };

        // Оставляем старый excerpt для совместимости
        const parts = [];
        if (meta.specialty) parts.push(meta.specialty);
        if (meta.servicesCount && meta.servicesCount > 0) {
          parts.push(`${meta.servicesCount} услуг`);
        }
        if (meta.pageSlug) {
          const pageNames = {
            'stomatologi': 'Стоматологи',
            'ginekologi': 'Гинекологи',
            'pediatry': 'Педиатры',
            'terapevty': 'Терапевты',
            'hirurgi': 'Хирурги',
            'vrachi': 'Врачи',
            'uzi': 'УЗИ-специалисты',
            'nevrology': 'Неврологи',
            'kardiologi': 'Кардиологи'
          };
          const pageName = pageNames[meta.pageSlug] || meta.pageSlug;
          parts.push(`Раздел: ${pageName}`);
        }
        if (parts.length > 0) {
          excerpt = parts.join(' • ');
        }
        if (matchedService) {
          excerpt += excerpt ? ' | ' : '';
          excerpt += `Услуга: ${cleanExcerpt(matchedService)}${matchedService.length >= 80 ? '...' : ''}`;
        }
      }
      break;

    case 'service':
      displayType = 'Услуга';
      if (!pageIcon) icon = 'briefcase';
      break;

    case 'analysis':
      displayType = 'Анализ';
      if (!pageIcon) icon = 'test-tube';
      if (item.metadata) {
        const meta = item.metadata;
        structuredData = {
          medCenter: meta.medCenter || null,
          serviceCode: meta.serviceCode || null,
          price: meta.price || null,
          isStopped: meta.isStopped || false
        };
        // Оставляем старый excerpt для совместимости
        const parts = [];
        if (meta.medCenter) parts.push(`Медцентр: ${meta.medCenter}`);
        if (meta.serviceCode) parts.push(`Код: ${meta.serviceCode}`);
        if (meta.price) parts.push(`Цена: ${meta.price} ₽`);
        if (meta.isStopped) parts.push('⚠️ Не выполняется');
        if (parts.length > 0) {
          excerpt = parts.join(' • ') + (excerpt ? ' | ' + excerpt : '');
        }
      }
      break;

    default:
      displayType = item.entityType;
      icon = 'file';
  }

  return {
    type: item.entityType,
    displayType: displayType,
    icon: icon,
    id: item.entityId,
    title: item.title,
    excerpt: excerpt,
    url: item.url,
    keywords: item.keywords,
    metadata: item.metadata,
    structuredData: structuredData // Новое поле
  };
};

// Basic search endpoint
router.get('/', authenticate, async (req, res) => {
  try {
    const { q, type, limit = 20 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({ results: [], total: 0, query: q });
    }

    const searchTerm = q.trim().toLowerCase();
    const results = [];

    // Search in pages
    if (!type || type === 'all' || type === 'page') {
      const pages = await Page.findAll({
        where: {
          isPublished: true,
          [Op.or]: [
            { title: { [Op.iLike]: `%${searchTerm}%` } },
            { searchContent: { [Op.iLike]: `%${searchTerm}%` } },
            { description: { [Op.iLike]: `%${searchTerm}%` } },
            { keywords: { [Op.overlap]: [searchTerm] } }
          ]
        },
        attributes: ['id', 'title', 'slug', 'description', 'keywords', 'searchContent', 'icon'],
        limit: parseInt(limit)
      });

      pages.forEach(page => {
        let excerpt = '';
        const content = page.searchContent || '';
        const index = content.toLowerCase().indexOf(searchTerm);
        
        if (index !== -1) {
          const start = Math.max(0, index - 60);
          const end = Math.min(content.length, index + searchTerm.length + 60);
          let rawExcerpt = content.substring(start, end);
          excerpt = (start > 0 ? '...' : '') + 
                   cleanExcerpt(rawExcerpt) + 
                   (end < content.length ? '...' : '');
        } else if (page.searchContent && page.searchContent.length > 0) {
          let rawExcerpt = page.searchContent.substring(0, 150);
          excerpt = cleanExcerpt(rawExcerpt) + 
                   (page.searchContent.length > 150 ? '...' : '');
        } else if (page.description) {
          excerpt = cleanExcerpt(page.description.substring(0, 120)) + 
                   (page.description.length > 120 ? '...' : '');
        } else {
          excerpt = 'Нет доступного контента для предпросмотра';
        }

        results.push({
          type: 'page',
          displayType: 'Страница',
          icon: page.icon || null,
          id: page.id,
          title: page.title,
          description: page.description,
          excerpt: excerpt,
          url: `/page/${page.slug}`,
          keywords: page.keywords
        });
      });
    }

    // Search in search index (for dynamic content, excluding pages as they are searched directly)
    if (!type || type !== 'page') {
      const whereClause = {
        entityType: { [Op.ne]: 'page' }, // Exclude pages from search_index
        [Op.or]: [
          { title: { [Op.iLike]: `%${searchTerm}%` } },
          { content: { [Op.iLike]: `%${searchTerm}%` } },
          { keywords: { [Op.overlap]: [searchTerm] } }
        ]
      };

      if (type && type !== 'all') {
        whereClause.entityType = type;
      }

      const indexed = await SearchIndex.findAll({
        where: whereClause,
        limit: parseInt(limit)
      });

      for (const item of indexed) {
        results.push(await formatIndexedResult(item, searchTerm));
      }
    }

    // Sort by relevance
    results.sort((a, b) => {
      const aTitle = a.title?.toLowerCase() || '';
      const bTitle = b.title?.toLowerCase() || '';
      const aTitleMatch = aTitle.includes(searchTerm);
      const bTitleMatch = bTitle.includes(searchTerm);
      
      if (aTitleMatch && !bTitleMatch) return -1;
      if (!aTitleMatch && bTitleMatch) return 1;
      
      if (aTitleMatch && bTitleMatch) {
        const aStartsWith = aTitle.startsWith(searchTerm);
        const bStartsWith = bTitle.startsWith(searchTerm);
        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;
      }
      
      return 0;
    });

    res.json({
      results: results.slice(0, parseInt(limit)),
      total: results.length,
      query: q
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Fulltext search with ranking
router.get('/fulltext', authenticate, async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({ results: [], total: 0, query: q });
    }

    const searchQuery = q.trim();
    const likePattern = `%${searchQuery}%`;

    // Search in pages with ranking
    const pageResults = await sequelize.query(`
      SELECT
        id, title, slug, description, keywords, "searchContent", icon,
        CASE
          WHEN title ILIKE :exactStart THEN 5
          WHEN title ILIKE :likePattern THEN 4
          WHEN description ILIKE :likePattern THEN 3
          WHEN "searchContent" ILIKE :likePattern THEN 2
          ELSE 1
        END as rank
      FROM pages
      WHERE
        "isPublished" = true
        AND (
          title ILIKE :likePattern
          OR description ILIKE :likePattern
          OR "searchContent" ILIKE :likePattern
        )
      ORDER BY rank DESC, title ASC
      LIMIT :limit
    `, {
      replacements: {
        likePattern,
        exactStart: `${searchQuery}%`,
        limit: parseInt(limit)
      },
      type: sequelize.QueryTypes.SELECT
    });

    // Search in search index (excluding pages as they are searched directly)
    const indexResults = await sequelize.query(`
      SELECT
        "entityType", "entityId", title, content, keywords, url, metadata,
        CASE
          WHEN title ILIKE :exactStart THEN 4
          WHEN title ILIKE :likePattern THEN 3
          WHEN content ILIKE :likePattern THEN 2
          ELSE 1
        END as priority
      FROM search_index
      WHERE
        "entityType" != 'page'
        AND (
          title ILIKE :likePattern
          OR content ILIKE :likePattern
        )
      ORDER BY priority DESC
      LIMIT :limit
    `, {
      replacements: {
        likePattern,
        exactStart: `${searchQuery}%`,
        limit: parseInt(limit)
      },
      type: sequelize.QueryTypes.SELECT
    });

    const searchTermLower = searchQuery.toLowerCase();
    const results = [];

    // Process pages
    pageResults.forEach(r => {
      let excerpt = '';
      
      if (r.searchContent) {
        const index = r.searchContent.toLowerCase().indexOf(searchTermLower);
        if (index !== -1) {
          const start = Math.max(0, index - 60);
          const end = Math.min(r.searchContent.length, index + searchQuery.length + 60);
          let rawExcerpt = r.searchContent.substring(start, end);
          excerpt = (start > 0 ? '...' : '') + 
                   cleanExcerpt(rawExcerpt) + 
                   (end < r.searchContent.length ? '...' : '');
        } else {
          let rawExcerpt = r.searchContent.substring(0, 150);
          excerpt = cleanExcerpt(rawExcerpt) + (r.searchContent.length > 150 ? '...' : '');
        }
      } else if (r.description) {
        excerpt = cleanExcerpt(r.description.substring(0, 120)) + (r.description.length > 120 ? '...' : '');
      }

      results.push({
        type: 'page',
        displayType: 'Страница',
        icon: r.icon || null,
        id: r.id,
        title: r.title,
        description: r.description,
        excerpt: excerpt,
        url: `/page/${r.slug}`,
        keywords: r.keywords,
        rank: r.rank
      });
    });

    // Process indexed entities
    for (const item of indexResults) {
      results.push(await formatIndexedResult(item, searchTermLower));
    }

    // Sort by relevance
    results.sort((a, b) => {
      const aTitle = a.title?.toLowerCase() || '';
      const bTitle = b.title?.toLowerCase() || '';
      const aTitleMatch = aTitle.includes(searchTermLower);
      const bTitleMatch = bTitle.includes(searchTermLower);
      
      if (aTitleMatch && !bTitleMatch) return -1;
      if (!aTitleMatch && bTitleMatch) return 1;
      
      return (b.rank || 0) - (a.rank || 0);
    });

    res.json({
      results: results.slice(0, parseInt(limit)),
      total: results.length,
      query: q
    });
  } catch (error) {
    console.error('Fulltext search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Index custom entity (for dynamic content)
router.post('/index', authenticate, async (req, res) => {
  try {
    const { entityType, entityId, title, content, keywords, url, metadata } = req.body;

    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'entityType and entityId required' });
    }

    await SearchIndex.upsert({
      entityType,
      entityId,
      title,
      content,
      keywords: keywords || [],
      url,
      metadata: metadata || {}
    });

    res.json({ message: 'Indexed successfully' });
  } catch (error) {
    console.error('Index error:', error);
    res.status(500).json({ error: 'Failed to index' });
  }
});

// Remove from index
router.delete('/index/:entityType/:entityId', authenticate, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    
    await SearchIndex.destroy({
      where: { entityType, entityId }
    });

    res.json({ message: 'Removed from index' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove from index' });
  }
});

// Get search suggestions (autocomplete)
router.get('/suggest', authenticate, async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json([]);
    }

    const searchTerm = q.trim();

    // Search pages
    const pages = await Page.findAll({
      where: {
        isPublished: true,
        title: { [Op.iLike]: `%${searchTerm}%` }
      },
      attributes: ['title', 'slug'],
      order: [
        [sequelize.literal(`CASE WHEN title ILIKE '${searchTerm}%' THEN 0 ELSE 1 END`)],
        ['title', 'ASC']
      ],
      limit: Math.floor(parseInt(limit) / 2)
    });

    // Search index
    const indexed = await SearchIndex.findAll({
      where: {
        title: { [Op.iLike]: `%${searchTerm}%` }
      },
      attributes: ['title', 'url', 'entityType'],
      limit: Math.floor(parseInt(limit) / 2)
    });

    const suggestions = [
      ...pages.map(p => ({
        title: p.title,
        url: `/page/${p.slug}`,
        type: 'page'
      })),
      ...indexed.map(i => ({
        title: i.title,
        url: i.url,
        type: i.entityType
      }))
    ];

    res.json(suggestions.slice(0, parseInt(limit)));
  } catch (error) {
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

// Get index stats
router.get('/stats', authenticate, async (req, res) => {
  try {
    const pageCount = await Page.count({ where: { isPublished: true } });
    
    const indexStats = await SearchIndex.findAll({
      attributes: [
        'entityType',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['entityType']
    });

    res.json({
      pages: pageCount,
      indexed: indexStats.map(s => ({
        type: s.entityType,
        count: parseInt(s.getDataValue('count'))
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

module.exports = router;