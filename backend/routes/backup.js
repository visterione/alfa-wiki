const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const archiver = require('archiver');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const BACKUP_DIR = process.env.BACKUP_PATH || './backups';

// Ensure backup directory exists
async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

// List backups
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    await ensureBackupDir();
    const files = await fs.readdir(BACKUP_DIR);
    
    const backups = await Promise.all(
      files.filter(f => f.endsWith('.zip')).map(async filename => {
        const filepath = path.join(BACKUP_DIR, filename);
        const stat = await fs.stat(filepath);
        return {
          filename,
          size: stat.size,
          createdAt: stat.birthtime
        };
      })
    );

    backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(backups);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

// Create backup
router.post('/create', authenticate, requireAdmin, async (req, res) => {
  try {
    await ensureBackupDir();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.zip`;
    const filepath = path.join(BACKUP_DIR, filename);

    // Create database dump
    const dumpFile = path.join(BACKUP_DIR, `db-${timestamp}.sql`);
    
    await new Promise((resolve, reject) => {
      const cmd = `PGPASSWORD=${process.env.DB_PASSWORD} pg_dump -h ${process.env.DB_HOST} -p ${process.env.DB_PORT} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -f ${dumpFile}`;
      exec(cmd, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    // Create zip archive
    const output = require('fs').createWriteStream(filepath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', async () => {
      // Clean up dump file
      await fs.unlink(dumpFile).catch(() => {});
      
      const stat = await fs.stat(filepath);
      res.json({
        message: 'Backup created successfully',
        filename,
        size: stat.size
      });
    });

    archive.on('error', (err) => {
      throw err;
    });

    archive.pipe(output);
    
    // Add database dump
    archive.file(dumpFile, { name: 'database.sql' });
    
    // Add uploads folder
    const uploadsPath = path.join(__dirname, '..', 'uploads');
    try {
      await fs.access(uploadsPath);
      archive.directory(uploadsPath, 'uploads');
    } catch (e) {
      // Uploads folder doesn't exist yet
    }

    await archive.finalize();
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// Download backup
router.get('/download/:filename', authenticate, requireAdmin, async (req, res) => {
  try {
    const filepath = path.join(BACKUP_DIR, req.params.filename);
    
    // Security check - prevent path traversal
    if (!req.params.filename.endsWith('.zip') || req.params.filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    await fs.access(filepath);
    res.download(filepath);
  } catch (error) {
    res.status(404).json({ error: 'Backup not found' });
  }
});

// Delete backup
router.delete('/:filename', authenticate, requireAdmin, async (req, res) => {
  try {
    const filepath = path.join(BACKUP_DIR, req.params.filename);
    
    if (!req.params.filename.endsWith('.zip') || req.params.filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    await fs.unlink(filepath);
    res.json({ message: 'Backup deleted' });
  } catch (error) {
    res.status(404).json({ error: 'Backup not found' });
  }
});

// Clean old backups
router.post('/cleanup', authenticate, requireAdmin, async (req, res) => {
  try {
    const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    await ensureBackupDir();
    const files = await fs.readdir(BACKUP_DIR);
    let deleted = 0;

    for (const filename of files) {
      if (!filename.endsWith('.zip')) continue;
      
      const filepath = path.join(BACKUP_DIR, filename);
      const stat = await fs.stat(filepath);
      
      if (stat.birthtime < cutoffDate) {
        await fs.unlink(filepath);
        deleted++;
      }
    }

    res.json({ message: `Cleaned ${deleted} old backups` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clean backups' });
  }
});

module.exports = router;