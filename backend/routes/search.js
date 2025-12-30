const express = require('express');
const { Op } = require('sequelize');
const { Page, SearchIndex, sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Main search endpoint with improved partial matching
router.get('/', authenticate, async (req, res) => {
  try {
    const { q, type, limit = 20 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({ results: [], total: 0 });
    }

    const searchTerm = q.trim().toLowerCase();
    const results = [];

    // Search in pages with partial matching
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
        attributes: ['id', 'slug', 'title', 'description', 'keywords', 'allowedRoles', 'searchContent'],
        limit: parseInt(limit)
      });

      // Filter by user role
      const filteredPages = pages.filter(page => {
        if (req.user.isAdmin) return true;
        if (!page.allowedRoles || page.allowedRoles.length === 0) return true;
        return page.allowedRoles.includes(req.user.roleId);
      });

      // Create excerpts with search term highlighted context
      filteredPages.forEach(page => {
        let excerpt = '';
        
        // Try to find excerpt from content
        if (page.searchContent && page.searchContent.toLowerCase().includes(searchTerm)) {
          const content = page.searchContent;
          const index = content.toLowerCase().indexOf(searchTerm);
          const start = Math.max(0, index - 50);
          const end = Math.min(content.length, index + searchTerm.length + 50);
          excerpt = (start > 0 ? '...' : '') + 
                   content.substring(start, end) + 
                   (end < content.length ? '...' : '');
        } else if (page.description) {
          excerpt = page.description.substring(0, 100) + (page.description.length > 100 ? '...' : '');
        }

        results.push({
          type: 'page',
          id: page.id,
          title: page.title,
          description: page.description,
          excerpt: excerpt,
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

    // Sort by relevance (title match first, then by position)
    results.sort((a, b) => {
      const aTitle = a.title?.toLowerCase() || '';
      const bTitle = b.title?.toLowerCase() || '';
      const aTitleMatch = aTitle.includes(searchTerm);
      const bTitleMatch = bTitle.includes(searchTerm);
      
      // Prioritize title matches
      if (aTitleMatch && !bTitleMatch) return -1;
      if (!aTitleMatch && bTitleMatch) return 1;
      
      // Then prioritize matches at the start of the title
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

// Full-text search with PostgreSQL (more powerful, with partial matching)
router.get('/fulltext', authenticate, async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({ results: [], total: 0 });
    }

    const searchQuery = q.trim();
    const likePattern = `%${searchQuery}%`;

    const results = await sequelize.query(`
      SELECT 
        id, slug, title, description, keywords, "searchContent",
        GREATEST(
          ts_rank(
            setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('russian', coalesce(description, '')), 'B') ||
            setweight(to_tsvector('russian', coalesce("searchContent", '')), 'C'),
            plainto_tsquery('russian', :searchQuery)
          ),
          0.1
        ) as rank,
        CASE
          WHEN title ILIKE :exactStart THEN 4
          WHEN title ILIKE :likePattern THEN 3
          WHEN description ILIKE :likePattern THEN 2
          WHEN "searchContent" ILIKE :likePattern THEN 1
          ELSE 0
        END as match_type
      FROM pages
      WHERE 
        "isPublished" = true AND
        (
          to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce("searchContent", ''))
          @@ plainto_tsquery('russian', :searchQuery)
          OR title ILIKE :likePattern
          OR description ILIKE :likePattern
          OR "searchContent" ILIKE :likePattern
        )
      ORDER BY match_type DESC, rank DESC
      LIMIT :limit
    `, {
      replacements: { 
        searchQuery,
        likePattern,
        exactStart: `${searchQuery}%`,
        limit: parseInt(limit) 
      },
      type: sequelize.QueryTypes.SELECT
    });

    // Create excerpts for results
    const enrichedResults = results.map(r => {
      let excerpt = '';
      
      if (r.searchContent) {
        const searchLower = q.trim().toLowerCase();
        const contentLower = r.searchContent.toLowerCase();
        const index = contentLower.indexOf(searchLower);
        
        if (index !== -1) {
          const start = Math.max(0, index - 50);
          const end = Math.min(r.searchContent.length, index + searchLower.length + 50);
          excerpt = (start > 0 ? '...' : '') + 
                   r.searchContent.substring(start, end) + 
                   (end < r.searchContent.length ? '...' : '');
        } else if (r.description) {
          excerpt = r.description.substring(0, 100) + (r.description.length > 100 ? '...' : '');
        }
      }

      return {
        type: 'page',
        id: r.id,
        title: r.title,
        description: r.description,
        excerpt: excerpt,
        url: `/page/${r.slug}`,
        keywords: r.keywords,
        rank: r.rank
      };
    });

    res.json({
      results: enrichedResults,
      total: enrichedResults.length,
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

// Get search suggestions (autocomplete with partial matching)
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
      order: [
        [sequelize.literal(`CASE WHEN title ILIKE '${q.trim()}%' THEN 0 ELSE 1 END`)],
        ['title', 'ASC']
      ],
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