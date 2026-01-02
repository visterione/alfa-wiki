const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { MapMarker, User, SearchIndex } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// НАСТРОЙКА: slug страницы карты для поиска
// ═══════════════════════════════════════════════════════════════
const MAP_PAGE_SLUG = 'map';

// === Multer для загрузки медиа ===
const uploadDir = path.join(__dirname, '../uploads/map');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `marker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/ogg'
    ];
    cb(null, allowed.includes(file.mimetype));
  }
});

// === HELPER: Индексация маркера для поиска ===
const indexMarker = async (marker) => {
  const searchContent = [
    marker.title,
    marker.description,
    marker.category
  ].filter(Boolean).join(' | ');

  const keywords = [
    'карта',
    'метка',
    'локация',
    marker.category?.toLowerCase()
  ].filter(Boolean);

  await SearchIndex.upsert({
    entityType: 'map_marker',
    entityId: marker.id,
    title: marker.title,
    content: searchContent,
    keywords: keywords,
    url: `/map?marker=${marker.id}`,
    metadata: {
      lat: marker.lat,
      lng: marker.lng,
      color: marker.color,
      category: marker.category
    }
  });
};

// === HELPER: Удаление из индекса ===
const removeFromIndex = async (markerId) => {
  await SearchIndex.destroy({
    where: { entityType: 'map_marker', entityId: markerId }
  });
};

// === Загрузка файлов ===
router.post('/upload', authenticate, upload.array('files', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const files = req.files.map(f => `/uploads/map/${f.filename}`);
    res.json({ files });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

// === Стриминг видео ===
router.get('/stream/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(uploadDir, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    const range = req.headers.range;

    // Для изображений - просто отдаём файл
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      res.setHeader('Content-Type', `image/${ext.slice(1)}`);
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Для видео - поддержка range requests
    if (!range) {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': `video/${ext.slice(1)}`
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const CHUNK_SIZE = 10 ** 6; // ~1MB
    const start = Number(range.replace(/\D/g, ''));
    const end = Math.min(start + CHUNK_SIZE, stat.size - 1);
    const contentLength = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': contentLength,
      'Content-Type': `video/${ext.slice(1)}`
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ error: 'Streaming failed' });
  }
});

// === Получить все маркеры ===
router.get('/markers', authenticate, async (req, res) => {
  try {
    const { category, color } = req.query;
    const where = {};
    
    if (category) where.category = category;
    if (color) where.color = color;

    const markers = await MapMarker.findAll({
      where,
      include: [{ model: User, as: 'creator', attributes: ['id', 'username', 'displayName'] }],
      order: [['createdAt', 'DESC']]
    });

    res.json(markers);
  } catch (error) {
    console.error('Get markers error:', error);
    res.status(500).json({ error: 'Failed to get markers' });
  }
});

// === Получить один маркер ===
router.get('/markers/:id', authenticate, async (req, res) => {
  try {
    const marker = await MapMarker.findByPk(req.params.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'username', 'displayName'] }]
    });

    if (!marker) {
      return res.status(404).json({ error: 'Marker not found' });
    }

    res.json(marker);
  } catch (error) {
    console.error('Get marker error:', error);
    res.status(500).json({ error: 'Failed to get marker' });
  }
});

// === Создать маркер ===
router.post('/markers', authenticate, requirePermission('pages', 'write'), [
  body('lat').isFloat().withMessage('Latitude is required'),
  body('lng').isFloat().withMessage('Longitude is required'),
  body('title').notEmpty().withMessage('Title is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { lat, lng, title, description, color, media, category } = req.body;

    // Валидация цвета
    let colorValue = '#4a90e2';
    if (color) {
      colorValue = String(color).trim();
      if (!/^#[0-9A-Fa-f]{6}$/.test(colorValue)) {
        colorValue = '#4a90e2';
      }
    }

    const marker = await MapMarker.create({
      lat,
      lng,
      title,
      description: description || null,
      color: colorValue,
      media: media || [],
      category: category || null,
      createdBy: req.user.id
    });

    // Индексируем для поиска
    await indexMarker(marker);

    const created = await MapMarker.findByPk(marker.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'username', 'displayName'] }]
    });

    res.status(201).json(created);
  } catch (error) {
    console.error('Create marker error:', error);
    res.status(500).json({ error: 'Failed to create marker' });
  }
});

// === Обновить маркер ===
router.put('/markers/:id', authenticate, requirePermission('pages', 'write'), async (req, res) => {
  try {
    const marker = await MapMarker.findByPk(req.params.id);
    if (!marker) {
      return res.status(404).json({ error: 'Marker not found' });
    }

    const { lat, lng, title, description, color, media, category } = req.body;

    // Валидация цвета
    let colorValue = marker.color;
    if (color !== undefined) {
      colorValue = String(color).trim();
      if (!/^#[0-9A-Fa-f]{6}$/.test(colorValue)) {
        colorValue = '#4a90e2';
      }
    }

    await marker.update({
      ...(lat !== undefined && { lat }),
      ...(lng !== undefined && { lng }),
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description: description || null }),
      ...(color !== undefined && { color: colorValue }),
      ...(media !== undefined && { media }),
      ...(category !== undefined && { category: category || null })
    });

    // Обновляем индекс
    await indexMarker(marker);

    const updated = await MapMarker.findByPk(marker.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'username', 'displayName'] }]
    });

    res.json(updated);
  } catch (error) {
    console.error('Update marker error:', error);
    res.status(500).json({ error: 'Failed to update marker' });
  }
});

// === Удалить маркер ===
router.delete('/markers/:id', authenticate, requirePermission('pages', 'delete'), async (req, res) => {
  try {
    const marker = await MapMarker.findByPk(req.params.id);
    if (!marker) {
      return res.status(404).json({ error: 'Marker not found' });
    }

    // Удаляем медиа-файлы
    if (marker.media && marker.media.length > 0) {
      for (const mediaPath of marker.media) {
        const filePath = path.join(__dirname, '..', mediaPath);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    // Удаляем из индекса
    await removeFromIndex(marker.id);

    await marker.destroy();

    res.json({ deleted: true, marker });
  } catch (error) {
    console.error('Delete marker error:', error);
    res.status(500).json({ error: 'Failed to delete marker' });
  }
});

// === Получить категории ===
router.get('/categories', authenticate, async (req, res) => {
  try {
    const categories = await MapMarker.findAll({
      attributes: ['category', 'color'],
      group: ['category', 'color'],
      where: { category: { [require('sequelize').Op.ne]: null } }
    });

    // Подсчитываем количество маркеров по категориям
    const result = {};
    for (const cat of categories) {
      if (cat.category) {
        const count = await MapMarker.count({ where: { category: cat.category } });
        result[cat.category] = { color: cat.color, count };
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

// === Переиндексация всех маркеров ===
router.post('/reindex', authenticate, requirePermission('pages', 'admin'), async (req, res) => {
  try {
    const markers = await MapMarker.findAll();
    
    for (const marker of markers) {
      await indexMarker(marker);
    }

    res.json({ message: `Reindexed ${markers.length} markers` });
  } catch (error) {
    console.error('Reindex error:', error);
    res.status(500).json({ error: 'Failed to reindex markers' });
  }
});

module.exports = router;