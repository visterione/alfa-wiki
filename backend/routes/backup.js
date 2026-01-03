const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const archiver = require('archiver');
const unzipper = require('unzipper');
const multer = require('multer');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const BACKUP_DIR = process.env.BACKUP_PATH || path.join(__dirname, '..', 'backups');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Multer для загрузки бэкапов
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    cb(null, BACKUP_DIR);
  },
  filename: (req, file, cb) => {
    // Сохраняем с оригинальным именем или генерируем новое
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = file.originalname.endsWith('.zip') 
      ? `uploaded-${timestamp}.zip`
      : `uploaded-${timestamp}.zip`;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Только ZIP файлы разрешены'));
    }
  }
});

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
      '-F', 'p'
    ];

    const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD };
    const pgDump = spawn('pg_dump', args, { env, shell: true });
    
    let stderr = '';
    pgDump.stderr.on('data', (data) => { stderr += data.toString(); });

    pgDump.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump failed (code ${code}): ${stderr}`));
    });

    pgDump.on('error', (err) => {
      reject(new Error(`pg_dump error: ${err.message}`));
    });
  });
}

// Cross-platform psql execution for restore
function runPsqlRestore(sqlFile) {
  return new Promise((resolve, reject) => {
    const args = [
      '-h', process.env.DB_HOST || 'localhost',
      '-p', process.env.DB_PORT || '5432',
      '-U', process.env.DB_USER,
      '-d', process.env.DB_NAME,
      '-f', sqlFile,
      '-v', 'ON_ERROR_STOP=0' // Продолжать при ошибках (для идемпотентности)
    ];

    const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD };
    const psql = spawn('psql', args, { env, shell: true });
    
    let stderr = '';
    let stdout = '';
    
    psql.stdout.on('data', (data) => { stdout += data.toString(); });
    psql.stderr.on('data', (data) => { stderr += data.toString(); });

    psql.on('close', (code) => {
      // psql может вернуть не-0 код даже при частичном успехе
      if (code === 0 || stdout.includes('INSERT') || stdout.includes('CREATE')) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`psql failed (code ${code}): ${stderr}`));
      }
    });

    psql.on('error', (err) => {
      reject(new Error(`psql error: ${err.message}`));
    });
  });
}

// Extract zip file
async function extractZip(zipPath, extractDir) {
  return new Promise((resolve, reject) => {
    fsSync.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractDir }))
      .on('close', resolve)
      .on('error', reject);
  });
}

// Copy directory recursively
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
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
          createdAt: stat.birthtime,
          isUploaded: filename.startsWith('uploaded-')
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

// Create backup
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    await ensureBackupDir();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.zip`;
    const filepath = path.join(BACKUP_DIR, filename);
    const dumpFile = path.join(BACKUP_DIR, `db-${timestamp}.sql`);

    console.log('Creating database dump...');
    await runPgDump(dumpFile);
    console.log('Database dump created:', dumpFile);

    const output = fsSync.createWriteStream(filepath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);

      archive.pipe(output);
      archive.file(dumpFile, { name: 'database.sql' });
      
      fs.access(UPLOADS_DIR)
        .then(() => {
          archive.directory(UPLOADS_DIR, 'uploads');
          archive.finalize();
        })
        .catch(() => {
          archive.finalize();
        });
    });

    await fs.unlink(dumpFile).catch(() => {});
    
    const stat = await fs.stat(filepath);
    console.log('Backup created:', filename, 'Size:', stat.size);
    
    res.json({ message: 'Backup created successfully', filename, size: stat.size });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Failed to create backup: ' + error.message });
  }
});

// Upload backup file
router.post('/upload', authenticate, requireAdmin, upload.single('backup'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const stat = await fs.stat(req.file.path);
    
    res.json({
      message: 'Backup uploaded successfully',
      filename: req.file.filename,
      size: stat.size
    });
  } catch (error) {
    console.error('Upload backup error:', error);
    res.status(500).json({ error: 'Failed to upload backup: ' + error.message });
  }
});

// Restore backup
router.post('/restore/:filename', authenticate, requireAdmin, async (req, res) => {
  const { filename } = req.params;
  const { restoreDb = true, restoreFiles = true } = req.body;
  
  if (!filename.endsWith('.zip') || filename.includes('..') || filename.includes('/')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filepath = path.join(BACKUP_DIR, filename);
  const extractDir = path.join(BACKUP_DIR, `restore-${Date.now()}`);
  
  try {
    await fs.access(filepath);
    
    console.log('Starting restore from:', filename);
    console.log('Options:', { restoreDb, restoreFiles });

    // Создаём временную папку для распаковки
    await fs.mkdir(extractDir, { recursive: true });
    
    // Распаковываем архив
    console.log('Extracting archive...');
    await extractZip(filepath, extractDir);
    console.log('Archive extracted to:', extractDir);

    const results = { database: null, files: null };

    // Восстанавливаем базу данных
    if (restoreDb) {
      const sqlFile = path.join(extractDir, 'database.sql');
      try {
        await fs.access(sqlFile);
        console.log('Restoring database...');
        
        const { stdout, stderr } = await runPsqlRestore(sqlFile);
        results.database = 'success';
        console.log('Database restored successfully');
        
        if (stderr) {
          console.log('Database restore warnings:', stderr.substring(0, 500));
        }
      } catch (dbError) {
        console.error('Database restore error:', dbError.message);
        results.database = 'error: ' + dbError.message;
      }
    }

    // Восстанавливаем файлы
    if (restoreFiles) {
      const uploadsBackup = path.join(extractDir, 'uploads');
      try {
        await fs.access(uploadsBackup);
        console.log('Restoring uploads...');
        
        // Копируем файлы (не удаляем существующие, а перезаписываем)
        await copyDir(uploadsBackup, UPLOADS_DIR);
        results.files = 'success';
        console.log('Files restored successfully');
      } catch (filesError) {
        if (filesError.code === 'ENOENT') {
          results.files = 'skipped (no uploads in backup)';
        } else {
          console.error('Files restore error:', filesError.message);
          results.files = 'error: ' + filesError.message;
        }
      }
    }

    // Очищаем временную папку
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});

    const success = results.database === 'success' || results.files === 'success';
    
    res.json({
      message: success ? 'Restore completed' : 'Restore completed with issues',
      results
    });
  } catch (error) {
    // Очищаем временную папку при ошибке
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    
    console.error('Restore error:', error);
    res.status(500).json({ error: 'Failed to restore backup: ' + error.message });
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

module.exports = router;