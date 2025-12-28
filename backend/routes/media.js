const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { Media } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Configure multer
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads', new Date().toISOString().slice(0, 7));
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'video/mp4', 'video/webm', 'video/ogg',
    'audio/mpeg', 'audio/ogg', 'audio/wav',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800 } // 50MB default
});

// Get all media
router.get('/', authenticate, async (req, res) => {
  try {
    const { type, limit = 50, offset = 0 } = req.query;
    
    const where = {};
    if (type) {
      where.mimeType = { [require('sequelize').Op.like]: `${type}/%` };
    }

    const media = await Media.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json(media);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

// Upload single file
router.post('/upload', authenticate, requirePermission('media', 'upload'), 
  upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { alt, description } = req.body;
    const relativePath = path.relative(
      path.join(__dirname, '..'),
      req.file.path
    ).replace(/\\/g, '/');

    let thumbnailPath = null;

    // Generate thumbnail for images
    if (req.file.mimetype.startsWith('image/') && !req.file.mimetype.includes('svg')) {
      const thumbDir = path.join(path.dirname(req.file.path), 'thumbs');
      await fs.mkdir(thumbDir, { recursive: true });
      
      const thumbFilename = `thumb_${req.file.filename}`;
      const thumbPath = path.join(thumbDir, thumbFilename);
      
      await sharp(req.file.path)
        .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);
      
      thumbnailPath = path.relative(
        path.join(__dirname, '..'),
        thumbPath
      ).replace(/\\/g, '/');
    }

    const media = await Media.create({
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      path: relativePath,
      thumbnailPath,
      alt,
      description,
      uploadedBy: req.user.id
    });

    res.status(201).json({
      ...media.toJSON(),
      url: `/${relativePath}`,
      thumbnailUrl: thumbnailPath ? `/${thumbnailPath}` : null
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Upload multiple files
router.post('/upload-multiple', authenticate, requirePermission('media', 'upload'),
  upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const results = [];

    for (const file of req.files) {
      const relativePath = path.relative(
        path.join(__dirname, '..'),
        file.path
      ).replace(/\\/g, '/');

      let thumbnailPath = null;

      if (file.mimetype.startsWith('image/') && !file.mimetype.includes('svg')) {
        const thumbDir = path.join(path.dirname(file.path), 'thumbs');
        await fs.mkdir(thumbDir, { recursive: true });
        
        const thumbFilename = `thumb_${file.filename}`;
        const thumbPathFull = path.join(thumbDir, thumbFilename);
        
        await sharp(file.path)
          .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(thumbPathFull);
        
        thumbnailPath = path.relative(
          path.join(__dirname, '..'),
          thumbPathFull
        ).replace(/\\/g, '/');
      }

      const media = await Media.create({
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        path: relativePath,
        thumbnailPath,
        uploadedBy: req.user.id
      });

      results.push({
        ...media.toJSON(),
        url: `/${relativePath}`,
        thumbnailUrl: thumbnailPath ? `/${thumbnailPath}` : null
      });
    }

    res.status(201).json(results);
  } catch (error) {
    console.error('Upload multiple error:', error);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

// Update media metadata
router.put('/:id', authenticate, async (req, res) => {
  try {
    const media = await Media.findByPk(req.params.id);
    if (!media) return res.status(404).json({ error: 'Media not found' });

    const { alt, description } = req.body;
    await media.update({ alt, description });

    res.json(media);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update media' });
  }
});

// Delete media
router.delete('/:id', authenticate, requirePermission('media', 'delete'), async (req, res) => {
  try {
    const media = await Media.findByPk(req.params.id);
    if (!media) return res.status(404).json({ error: 'Media not found' });

    // Delete files
    try {
      await fs.unlink(path.join(__dirname, '..', media.path));
      if (media.thumbnailPath) {
        await fs.unlink(path.join(__dirname, '..', media.thumbnailPath));
      }
    } catch (e) {
      console.error('Error deleting files:', e);
    }

    await media.destroy();
    res.json({ message: 'Media deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

module.exports = router;