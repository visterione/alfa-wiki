const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const archiver = require('archiver');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const BACKUP_DIR = process.env.BACKUP_PATH || path.join(__dirname, '..', 'backups');

// Ensure backup directory exists
async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

// Cross-platform pg_dump execution
function runPgDump(dumpFile) {
  return new Promise((resolve, reject) => {
    const args = [
      '-h', process.env.DB_HOST || 'localhost',
      '-p', process.env.DB_PORT || '5432',
      '-U', process.env.DB_USER,
      '-d', process.env.DB_NAME,
      '-f', dumpFile,
      '-F', 'p' // plain text format
    ];

    const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD };
    
    const pgDump = spawn('pg_dump', args, { env, shell: true });
    
    let stderr = '';
    
    pgDump.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pgDump.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pg_dump failed (code ${code}): ${stderr}`));
      }
    });

    pgDump.on('error', (err) => {
      reject(new Error(`pg_dump error: ${err.message}`));
    });
  });
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
    console.error('List backups error:', error);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

// Create backup (POST /api/backup)
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    await ensureBackupDir();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.zip`;
    const filepath = path.join(BACKUP_DIR, filename);
    const dumpFile = path.join(BACKUP_DIR, `db-${timestamp}.sql`);

    // Create database dump
    console.log('Creating database dump...');
    await runPgDump(dumpFile);
    console.log('Database dump created:', dumpFile);

    // Create zip archive
    const output = require('fs').createWriteStream(filepath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);

      archive.pipe(output);
      
      // Add database dump
      archive.file(dumpFile, { name: 'database.sql' });
      
      // Add uploads folder if exists
      const uploadsPath = path.join(__dirname, '..', 'uploads');
      fs.access(uploadsPath)
        .then(() => {
          archive.directory(uploadsPath, 'uploads');
          archive.finalize();
        })
        .catch(() => {
          archive.finalize();
        });
    });

    // Clean up dump file
    await fs.unlink(dumpFile).catch(() => {});
    
    const stat = await fs.stat(filepath);
    console.log('Backup created:', filename, 'Size:', stat.size);
    
    res.json({
      message: 'Backup created successfully',
      filename,
      size: stat.size
    });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Failed to create backup: ' + error.message });
  }
});

// Download backup
router.get('/download/:filename', authenticate, requireAdmin, async (req, res) => {
  try {
    const { filename } = req.params;
    
    if (!filename.endsWith('.zip') || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(BACKUP_DIR, filename);
    await fs.access(filepath);
    res.download(filepath);
  } catch (error) {
    res.status(404).json({ error: 'Backup not found' });
  }
});

// Delete backup
router.delete('/:filename', authenticate, requireAdmin, async (req, res) => {
  try {
    const { filename } = req.params;
    
    if (!filename.endsWith('.zip') || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(BACKUP_DIR, filename);
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

    res.json({ message: `Удалено старых копий: ${deleted}` });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: 'Failed to clean backups' });
  }
});

// Restore backup
router.post('/restore/:filename', authenticate, requireAdmin, async (req, res) => {
  try {
    const { filename } = req.params;
    
    if (!filename.endsWith('.zip') || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(BACKUP_DIR, filename);
    await fs.access(filepath);
    
    res.status(501).json({ error: 'Restore functionality not yet implemented' });
  } catch (error) {
    res.status(404).json({ error: 'Backup not found' });
  }
});

module.exports = router;