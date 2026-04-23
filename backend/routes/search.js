const express = require('express');
const { Op } = require('sequelize');
const { Page, SearchIndex, sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ---------- Simple in-memory cache ----------
const searchCache = new Map();
const CACHE_TTL = 60_000; // 60 seconds

function cacheKey(userId, query, suffix) {
  return `${userId}:${query}:${suffix}`;
}
function fromCache(key) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { searchCache.delete(key); return null; }
  return entry.data;
}
function toCache(key, data) {
  searchCache.set(key, { data, ts: Date.now() });
  if (searchCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of searchCache) { if (now - v.ts > CACHE_TTL) searchCache.delete(k); }
  }
}
// Call this from other routes when indexed data changes
function invalidateSearchCache() { searchCache.clear(); }
module.exports.invalidateSearchCache = invalidateSearchCache;
// --------------------------------------------

function canAccessPage(page, userRoleIds, isAdmin) {
  if (isAdmin) return true;
  if (!page.allowedRoles || page.allowedRoles.length === 0) return true;
  return userRoleIds.some(roleId => page.allowedRoles.includes(roleId));
}

const cleanExcerpt = (text) => {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
};

const stripHtml = (text) => {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
};

// Synchronous — caller must pass pageIcon instead of fetching inside
const formatIndexedResult = (item, searchTerm, pageIcon = null) => {
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

  let displayType = item.entityType;
  let icon = pageIcon || 'file';
  let structuredData = null;

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
        const parts = [];
        if (meta.medCenter) parts.push(`Медцентр: ${meta.medCenter}`);
        if (meta.expirationDate) {
          const date = new Date(meta.expirationDate);
          parts.push(`Срок: ${date.toLocaleDateString('ru-RU')}`);
        }
        if (parts.length > 0) excerpt = parts.join(' • ') + (excerpt ? ' | ' + excerpt : '');
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
        const parts = [];
        if (meta.organization) parts.push(`Орг: ${meta.organization}`);
        if (meta.licensePlate) parts.push(`${meta.licensePlate}`);
        if (meta.insuranceDate) {
          const date = new Date(meta.insuranceDate);
          parts.push(`Страховка: ${date.toLocaleDateString('ru-RU')}`);
        }
        if (parts.length > 0) excerpt = parts.join(' • ') + (excerpt ? ' | ' + excerpt : '');
      }
      break;

    case 'doctor':
      displayType = 'Врач';
      if (!pageIcon) icon = 'user';
      if (item.metadata) {
        const meta = item.metadata;
        let matchedService = null;
        if (item.content) {
          const searchLower = searchTerm.toLowerCase();
          const contentParts = item.content.split(' | ');
          for (const part of contentParts) {
            const cleanPart = stripHtml(part);
            if (cleanPart.toLowerCase().includes(searchLower) &&
                !cleanPart.toLowerCase().includes(item.title?.toLowerCase() || '')) {
              matchedService = cleanPart.substring(0, 80);
              break;
            }
          }
        }
        structuredData = {
          specialty: meta.specialty || null,
          servicesCount: meta.servicesCount || 0,
          pageSlug: meta.pageSlug || null,
          matchedService
        };
        const parts = [];
        if (meta.specialty) parts.push(meta.specialty);
        if (meta.servicesCount && meta.servicesCount > 0) parts.push(`${meta.servicesCount} услуг`);
        if (meta.pageSlug) {
          const pageNames = {
            'stomatologi': 'Стоматологи', 'ginekologi': 'Гинекологи',
            'pediatry': 'Педиатры', 'terapevty': 'Терапевты',
            'hirurgi': 'Хирурги', 'vrachi': 'Врачи',
            'uzi': 'УЗИ-специалисты', 'nevrology': 'Неврологи',
            'kardiologi': 'Кардиологи'
          };
          parts.push(`Раздел: ${pageNames[meta.pageSlug] || meta.pageSlug}`);
        }
        excerpt = parts.join(' • ');
        if (matchedService) excerpt += (excerpt ? ' | ' : '') + `Услуга: ${cleanExcerpt(matchedService)}${matchedService.length >= 80 ? '...' : ''}`;
      }
      break;

    case 'service':
      displayType = 'Услуга';
      if (!pageIcon) icon = 'briefcase';
      if (item.metadata) {
        const meta = item.metadata;
        structuredData = {
          pageSlug: meta.pageSlug || null,
          medCenter: meta.medCenter || null,
          serviceCode: meta.serviceCode || null,
          price: meta.price || null,
          isStopped: meta.isStopped || false
        };
        const parts = [];
        if (meta.medCenter) parts.push(`Медцентр: ${meta.medCenter}`);
        if (meta.serviceCode) parts.push(`Код: ${meta.serviceCode}`);
        if (meta.price) parts.push(`Цена: ${meta.price} ₽`);
        if (meta.isStopped) parts.push('⚠️ Не выполняется');
        if (parts.length > 0) excerpt = parts.join(' • ') + (excerpt ? ' | ' + excerpt : '');
      }
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
        const parts = [];
        if (meta.medCenter) parts.push(`Медцентр: ${meta.medCenter}`);
        if (meta.serviceCode) parts.push(`Код: ${meta.serviceCode}`);
        if (meta.price) parts.push(`Цена: ${meta.price} ₽`);
        if (meta.isStopped) parts.push('⚠️ Не выполняется');
        if (parts.length > 0) excerpt = parts.join(' • ') + (excerpt ? ' | ' + excerpt : '');
      }
      break;

    default:
      displayType = item.entityType;
      icon = 'file';
  }

  return {
    type: item.entityType,
    displayType,
    icon,
    id: item.entityId,
    title: item.title,
    excerpt,
    url: item.url,
    keywords: item.keywords,
    metadata: item.metadata,
    structuredData
  };
};

// ---------- Shared helper: batch-fetch parent pages ----------
async function fetchParentPageMap(items) {
  const slugs = [...new Set(items.map(i => i.metadata?.pageSlug).filter(Boolean))];
  if (slugs.length === 0) return new Map();
  const pages = await Page.findAll({
    where: { slug: { [Op.in]: slugs } },
    attributes: ['slug', 'allowedRoles', 'icon']
  });
  return new Map(pages.map(p => [p.slug, p]));
}
// ------------------------------------------------------------

// Basic search endpoint
router.get('/', authenticate, async (req, res) => {
  try {
    const { q, type, limit = 20 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({ results: [], total: 0, query: q });
    }

    const searchTerm = q.trim().toLowerCase();
    const userId = req.user.id;
    const userRoleIds = req.user.roles?.map(r => r.id) || [];
    const isAdmin = req.user.isAdmin;

    // Cache check
    const key = cacheKey(userId, searchTerm, type || 'all');
    const cached = fromCache(key);
    if (cached) return res.json(cached);

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
            sequelize.where(
              sequelize.fn('array_to_string', sequelize.col('keywords'), ' '),
              { [Op.iLike]: `%${searchTerm}%` }
            )
          ]
        },
        attributes: ['id', 'title', 'slug', 'description', 'keywords', 'searchContent', 'icon', 'allowedRoles', 'contentType'],
        limit: parseInt(limit)
      });

      pages.forEach(page => {
        if (!canAccessPage(page, userRoleIds, isAdmin)) return;

        let excerpt = '';
        let displayType = 'Страница';

        if (page.contentType === 'spreadsheet') {
          displayType = 'Таблица';
        } else {
          const content = page.searchContent || '';
          const index = content.toLowerCase().indexOf(searchTerm);
          if (index !== -1) {
            const start = Math.max(0, index - 60);
            const end = Math.min(content.length, index + searchTerm.length + 60);
            excerpt = (start > 0 ? '...' : '') + cleanExcerpt(content.substring(start, end)) + (end < content.length ? '...' : '');
          } else if (page.searchContent?.length > 0) {
            excerpt = cleanExcerpt(page.searchContent.substring(0, 150)) + (page.searchContent.length > 150 ? '...' : '');
          } else if (page.description) {
            excerpt = cleanExcerpt(page.description.substring(0, 120)) + (page.description.length > 120 ? '...' : '');
          } else {
            excerpt = 'Нет доступного контента для предпросмотра';
          }
        }

        results.push({
          type: page.contentType === 'spreadsheet' ? 'spreadsheet' : 'page',
          displayType,
          icon: page.icon || null,
          id: page.id,
          title: page.title,
          description: page.description,
          excerpt,
          url: `/page/${page.slug}?search=${encodeURIComponent(searchTerm)}`,
          keywords: page.keywords
        });
      });
    }

    // Search in search index
    if (!type || type !== 'page') {
      const whereClause = {
        entityType: { [Op.ne]: 'page' },
        [Op.or]: [
          { title: { [Op.iLike]: `%${searchTerm}%` } },
          { content: { [Op.iLike]: `%${searchTerm}%` } },
          sequelize.where(
            sequelize.fn('array_to_string', sequelize.col('SearchIndex.keywords'), ' '),
            { [Op.iLike]: `%${searchTerm}%` }
          )
        ]
      };
      if (type && type !== 'all') whereClause.entityType = type;

      const indexed = await SearchIndex.findAll({ where: whereClause, limit: parseInt(limit) });

      // Batch-fetch all parent pages (access control + icon) — eliminates N+1
      const parentPageMap = await fetchParentPageMap(indexed);

      for (const item of indexed) {
        const pageSlug = item.metadata?.pageSlug;
        const parentPage = pageSlug ? parentPageMap.get(pageSlug) : null;

        if (pageSlug) {
          if (parentPage && !canAccessPage(parentPage, userRoleIds, isAdmin)) continue;
        } else if (!isAdmin) {
          continue;
        }

        results.push(formatIndexedResult(item, searchTerm, parentPage?.icon || null));
      }
    }

    // Sort by relevance
    results.sort((a, b) => {
      const aKeyEx = (a.keywords || []).some(k => k.toLowerCase() === searchTerm);
      const bKeyEx = (b.keywords || []).some(k => k.toLowerCase() === searchTerm);
      if (aKeyEx !== bKeyEx) return aKeyEx ? -1 : 1;

      const aKeyFz = !aKeyEx && (a.keywords || []).some(k => k.toLowerCase().includes(searchTerm));
      const bKeyFz = !bKeyEx && (b.keywords || []).some(k => k.toLowerCase().includes(searchTerm));
      if (aKeyFz !== bKeyFz) return aKeyFz ? -1 : 1;

      const aSpec = a.type !== 'page';
      const bSpec = b.type !== 'page';
      if (aSpec !== bSpec) return aSpec ? -1 : 1;

      const aT = a.title?.toLowerCase() || '';
      const bT = b.title?.toLowerCase() || '';
      const aTm = aT.includes(searchTerm);
      const bTm = bT.includes(searchTerm);
      if (aTm !== bTm) return aTm ? -1 : 1;

      if (aTm && bTm) {
        const aSw = aT.startsWith(searchTerm);
        const bSw = bT.startsWith(searchTerm);
        if (aSw !== bSw) return aSw ? -1 : 1;
      }

      return 0;
    });

    const response = {
      results: results.slice(0, parseInt(limit)),
      total: results.length,
      query: q
    };

    toCache(key, response);
    res.json(response);
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
    const searchTermLower = searchQuery.toLowerCase();
    const likePattern = `%${searchQuery}%`;
    const userId = req.user.id;
    const userRoleIds = req.user.roles?.map(r => r.id) || [];
    const isAdmin = req.user.isAdmin;

    const key = cacheKey(userId, searchTermLower, 'fulltext');
    const cached = fromCache(key);
    if (cached) return res.json(cached);

    const pageResults = await sequelize.query(`
      SELECT
        id, title, slug, description, keywords, "searchContent", icon, "allowedRoles", "contentType",
        CASE
          WHEN EXISTS (SELECT 1 FROM unnest(keywords) k WHERE k ILIKE :likePattern) THEN 6
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
          OR EXISTS (SELECT 1 FROM unnest(keywords) k WHERE k ILIKE :likePattern)
        )
      ORDER BY rank DESC, title ASC
      LIMIT :limit
    `, {
      replacements: { likePattern, exactStart: `${searchQuery}%`, searchQuery, limit: parseInt(limit) },
      type: sequelize.QueryTypes.SELECT
    });

    const indexResults = await sequelize.query(`
      SELECT
        "entityType", "entityId", title, content, keywords, url, metadata,
        CASE
          WHEN EXISTS (SELECT 1 FROM unnest(keywords) k WHERE k ILIKE :likePattern) THEN 6
          WHEN title ILIKE :exactStart THEN 5
          WHEN title ILIKE :likePattern THEN 4
          WHEN content ILIKE :likePattern THEN 3
          ELSE 2
        END as priority
      FROM search_index
      WHERE
        "entityType" != 'page'
        AND (
          title ILIKE :likePattern
          OR content ILIKE :likePattern
          OR EXISTS (SELECT 1 FROM unnest(keywords) k WHERE k ILIKE :likePattern)
        )
      ORDER BY priority DESC
      LIMIT :limit
    `, {
      replacements: { likePattern, exactStart: `${searchQuery}%`, searchQuery, limit: parseInt(limit) },
      type: sequelize.QueryTypes.SELECT
    });

    const results = [];

    // Process pages
    pageResults.forEach(r => {
      if (!canAccessPage(r, userRoleIds, isAdmin)) return;

      let excerpt = '';
      let displayType = 'Страница';

      if (r.contentType === 'spreadsheet') {
        displayType = 'Таблица';
      } else if (r.searchContent) {
        const index = r.searchContent.toLowerCase().indexOf(searchTermLower);
        if (index !== -1) {
          const start = Math.max(0, index - 60);
          const end = Math.min(r.searchContent.length, index + searchQuery.length + 60);
          excerpt = (start > 0 ? '...' : '') + cleanExcerpt(r.searchContent.substring(start, end)) + (end < r.searchContent.length ? '...' : '');
        } else {
          excerpt = cleanExcerpt(r.searchContent.substring(0, 150)) + (r.searchContent.length > 150 ? '...' : '');
        }
      } else if (r.description) {
        excerpt = cleanExcerpt(r.description.substring(0, 120)) + (r.description.length > 120 ? '...' : '');
      }

      results.push({
        type: r.contentType === 'spreadsheet' ? 'spreadsheet' : 'page',
        displayType,
        icon: r.icon || null,
        id: r.id,
        title: r.title,
        description: r.description,
        excerpt,
        url: `/page/${r.slug}?search=${encodeURIComponent(searchTermLower)}`,
        keywords: r.keywords,
        rank: r.rank
      });
    });

    // Batch-fetch parent pages for indexed results — eliminates N+1
    const parentPageMap = await fetchParentPageMap(indexResults.map(i => ({ metadata: i.metadata })));

    for (const item of indexResults) {
      const pageSlug = item.metadata?.pageSlug;
      const parentPage = pageSlug ? parentPageMap.get(pageSlug) : null;

      if (pageSlug) {
        if (parentPage && !canAccessPage(parentPage, userRoleIds, isAdmin)) continue;
      } else if (!isAdmin) {
        continue;
      }

      const formatted = formatIndexedResult(item, searchTermLower, parentPage?.icon || null);
      formatted.rank = item.priority || 0;
      results.push(formatted);
    }

    // Sort by relevance
    results.sort((a, b) => {
      const aKeyEx = (a.keywords || []).some(k => k.toLowerCase() === searchTermLower);
      const bKeyEx = (b.keywords || []).some(k => k.toLowerCase() === searchTermLower);
      if (aKeyEx !== bKeyEx) return aKeyEx ? -1 : 1;

      const aKeyFz = !aKeyEx && (a.keywords || []).some(k => k.toLowerCase().includes(searchTermLower));
      const bKeyFz = !bKeyEx && (b.keywords || []).some(k => k.toLowerCase().includes(searchTermLower));
      if (aKeyFz !== bKeyFz) return aKeyFz ? -1 : 1;

      const aSpec = a.type !== 'page';
      const bSpec = b.type !== 'page';
      if (aSpec !== bSpec) return aSpec ? -1 : 1;

      return (b.rank || 0) - (a.rank || 0);
    });

    const response = {
      results: results.slice(0, parseInt(limit)),
      total: results.length,
      query: q
    };

    toCache(key, response);
    res.json(response);
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

    await SearchIndex.upsert({ entityType, entityId, title, content, keywords: keywords || [], url, metadata: metadata || {} });
    invalidateSearchCache();

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
    await SearchIndex.destroy({ where: { entityType, entityId } });
    invalidateSearchCache();
    res.json({ message: 'Removed from index' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove from index' });
  }
});

// Get search suggestions (autocomplete)
router.get('/suggest', authenticate, async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length < 2) return res.json([]);

    const searchTerm = q.trim();
    const userRoleIds = req.user.roles?.map(r => r.id) || [];
    const isAdmin = req.user.isAdmin;

    const pages = await Page.findAll({
      where: { isPublished: true, title: { [Op.iLike]: `%${searchTerm}%` } },
      attributes: ['title', 'slug', 'allowedRoles', 'contentType'],
      order: [[sequelize.literal(`CASE WHEN title ILIKE '${searchTerm}%' THEN 0 ELSE 1 END`), 'ASC'], ['title', 'ASC']],
      limit: Math.floor(parseInt(limit) / 2)
    });

    const indexed = await SearchIndex.findAll({
      where: { title: { [Op.iLike]: `%${searchTerm}%` } },
      attributes: ['title', 'url', 'entityType', 'metadata'],
      limit: Math.floor(parseInt(limit) / 2)
    });

    // Batch-fetch parent pages for suggestions — eliminates N+1
    const parentPageMap = await fetchParentPageMap(indexed.map(i => ({ metadata: i.metadata })));

    const filteredPages = pages.filter(p => canAccessPage(p, userRoleIds, isAdmin));

    const filteredIndexed = indexed.filter(item => {
      const pageSlug = item.metadata?.pageSlug;
      if (!pageSlug) return isAdmin;
      const parentPage = parentPageMap.get(pageSlug);
      return parentPage && canAccessPage(parentPage, userRoleIds, isAdmin);
    });

    const suggestions = [
      ...filteredIndexed.map(i => ({ title: i.title, url: i.url, type: i.entityType })),
      ...filteredPages.map(p => ({ title: p.title, url: `/page/${p.slug}`, type: p.contentType === 'spreadsheet' ? 'spreadsheet' : 'page' }))
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
      attributes: ['entityType', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['entityType']
    });
    res.json({
      pages: pageCount,
      indexed: indexStats.map(s => ({ type: s.entityType, count: parseInt(s.getDataValue('count')) }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

module.exports = router;
