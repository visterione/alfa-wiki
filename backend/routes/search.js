const express = require('express');
const { Op } = require('sequelize');
const { Page, SearchIndex, sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Main search endpoint
router.get('/', authenticate, async (req, res) => {
  try {
    const { q, type, limit = 20 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({ results: [], total: 0 });
    }

    const searchTerm = q.trim().toLowerCase();
    const results = [];

    // Search in pages
    if (!type || type === 'page' || type === 'all') {
      const pages = await Page.findAll({
        where: {
          [Op.and]: [
            { isPublished: true },
            {
              [Op.or]: [
                { title: { [Op.iLike]: `%${searchTerm}%` } },
                { description: { [Op.iLike]: `%${searchTerm}%` } },
                { searchContent: { [Op.iLike]: `%${searchTerm}%` } },
                { keywords: { [Op.overlap]: [searchTerm] } }
              ]
            }
          ]
        },
        attributes: ['id', 'slug', 'title', 'description', 'keywords', 'allowedRoles'],
        limit: parseInt(limit)
      });

      // Filter by user role
      const filteredPages = pages.filter(page => {
        if (req.user.isAdmin) return true;
        if (!page.allowedRoles || page.allowedRoles.length === 0) return true;
        return page.allowedRoles.includes(req.user.roleId);
      });

      filteredPages.forEach(page => {
        results.push({
          type: 'page',
          id: page.id,
          title: page.title,
          description: page.description,
          url: `/page/${page.slug}`,
          keywords: page.keywords
        });
      });
    }

    // Search in search index (for dynamic content like doctors, services, etc.)
    if (!type || type !== 'page') {
      const indexed = await SearchIndex.findAll({
        where: {
          [Op.or]: [
            { title: { [Op.iLike]: `%${searchTerm}%` } },
            { content: { [Op.iLike]: `%${searchTerm}%` } },
            { keywords: { [Op.overlap]: [searchTerm] } }
          ],
          ...(type && type !== 'all' ? { entityType: type } : {})
        },
        limit: parseInt(limit)
      });

      indexed.forEach(item => {
        results.push({
          type: item.entityType,
          id: item.entityId,
          title: item.title,
          description: item.content?.substring(0, 200),
          url: item.url,
          keywords: item.keywords,
          metadata: item.metadata
        });
      });
    }

    // Sort by relevance (title match first)
    results.sort((a, b) => {
      const aTitle = a.title?.toLowerCase() || '';
      const bTitle = b.title?.toLowerCase() || '';
      const aTitleMatch = aTitle.includes(searchTerm);
      const bTitleMatch = bTitle.includes(searchTerm);
      if (aTitleMatch && !bTitleMatch) return -1;
      if (!aTitleMatch && bTitleMatch) return 1;
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

// Full-text search with PostgreSQL (more powerful)
router.get('/fulltext', authenticate, async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({ results: [], total: 0 });
    }

    // Convert search term to tsquery format
    const searchTerm = q.trim().split(/\s+/).map(w => `${w}:*`).join(' & ');

    const results = await sequelize.query(`
      SELECT 
        id, slug, title, description, keywords,
        ts_rank(
          setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('russian', coalesce(description, '')), 'B') ||
          setweight(to_tsvector('russian', coalesce(search_content, '')), 'C'),
          to_tsquery('russian', :searchTerm)
        ) as rank
      FROM pages
      WHERE 
        is_published = true AND
        (
          to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(search_content, ''))
          @@ to_tsquery('russian', :searchTerm)
          OR title ILIKE :likePattern
        )
      ORDER BY rank DESC
      LIMIT :limit
    `, {
      replacements: { 
        searchTerm, 
        likePattern: `%${q.trim()}%`,
        limit: parseInt(limit) 
      },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      results: results.map(r => ({
        type: 'page',
        id: r.id,
        title: r.title,
        description: r.description,
        url: `/page/${r.slug}`,
        keywords: r.keywords,
        rank: r.rank
      })),
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

    const pages = await Page.findAll({
      where: {
        isPublished: true,
        title: { [Op.iLike]: `%${q.trim()}%` }
      },
      attributes: ['title', 'slug'],
      limit: parseInt(limit)
    });

    res.json(pages.map(p => ({
      title: p.title,
      url: `/page/${p.slug}`
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

module.exports = router;