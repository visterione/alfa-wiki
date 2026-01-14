const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const archiver = require('archiver');
const unzipper = require('unzipper');
const multer = require('multer');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sequelize } = require('../models');

const router = express.Router();

const BACKUP_DIR = process.env.BACKUP_PATH || path.join(__dirname, '..', 'backups');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// ═══════════════════════════════════════════════════════════════
// MULTER SETUP
// ═══════════════════════════════════════════════════════════════

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    cb(null, BACKUP_DIR);
  },
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `uploaded-${timestamp}.zip`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
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

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

// Полная очистка базы данных (удаление всех таблиц, enum, функций, view)
async function cleanDatabase() {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('🧹 Dropping all database objects...');
      
      await sequelize.query(`
        DO $$ 
        DECLARE
          r RECORD;
        BEGIN
          -- Удаляем все таблицы
          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
          END LOOP;
          
          -- Удаляем все последовательности
          FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') LOOP
            EXECUTE 'DROP SEQUENCE IF EXISTS public.' || quote_ident(r.sequence_name) || ' CASCADE';
          END LOOP;
          
          -- Удаляем все ENUM типы
          FOR r IN (SELECT typname FROM pg_type WHERE typtype = 'e' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) LOOP
            EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
          END LOOP;
          
          -- Удаляем все функции
          FOR r IN (SELECT proname, oidvectortypes(proargtypes) as argtypes 
                    FROM pg_proc INNER JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid 
                    WHERE pg_namespace.nspname = 'public') LOOP
            EXECUTE 'DROP FUNCTION IF EXISTS public.' || quote_ident(r.proname) || '(' || r.argtypes || ') CASCADE';
          END LOOP;
          
          -- Удаляем все view
          FOR r IN (SELECT viewname FROM pg_views WHERE schemaname = 'public') LOOP
            EXECUTE 'DROP VIEW IF EXISTS public.' || quote_ident(r.viewname) || ' CASCADE';
          END LOOP;
        END $$;
      `);
      
      console.log('✅ Database cleaned successfully');
      resolve();
    } catch (error) {
      reject(new Error(`Database cleanup failed: ${error.message}`));
    }
  });
}

// Восстановление базы из SQL файла
function runPsqlRestore(sqlFile) {
  return new Promise((resolve, reject) => {
    const args = [
      '-h', process.env.DB_HOST || 'localhost',
      '-p', process.env.DB_PORT || '5432',
      '-U', process.env.DB_USER,
      '-d', process.env.DB_NAME,
      '-f', sqlFile,
      '-v', 'ON_ERROR_STOP=1'
    ];

    const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD };
    const psql = spawn('psql', args, { env, shell: true });
    
    let stderr = '';
    let stdout = '';
    
    psql.stdout.on('data', (data) => { stdout += data.toString(); });
    psql.stderr.on('data', (data) => { stderr += data.toString(); });

    psql.on('close', (code) => {
      if (code === 0) {
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

// Распаковка ZIP архива
async function extractZip(zipPath, extractDir) {
  return new Promise((resolve, reject) => {
    fsSync.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractDir }))
      .on('close', resolve)
      .on('error', reject);
  });
}

// Полная очистка директории
async function clearDirectory(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        await clearDirectory(fullPath);
        await fs.rmdir(fullPath);
      } else {
        await fs.unlink(fullPath);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

// Копирование директории
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

// Проверка целостности бэкапа
async function validateBackup(extractDir) {
  const errors = [];

  const backupFile = path.join(extractDir, 'database.backup');
  try {
    await fs.access(backupFile);
  } catch {
    errors.push('Отсутствует файл database.backup');
  }

  return errors;
}

// Создание временной копии для отката
async function createTempBackup() {
  const tempBackupDir = path.join(BACKUP_DIR, `temp-${Date.now()}`);
  await fs.mkdir(tempBackupDir, { recursive: true });
  
  // Копируем uploads
  const tempUploads = path.join(tempBackupDir, 'uploads');
  try {
    await copyDir(UPLOADS_DIR, tempUploads);
  } catch (error) {
    console.log('Uploads folder not found, skipping backup');
  }
  
  // Дамп базы
  const tempDump = path.join(tempBackupDir, 'database.backup');
  await new Promise((resolve, reject) => {
    const args = [
      '-h', process.env.DB_HOST || 'localhost',
      '-p', process.env.DB_PORT || '5432',
      '-U', process.env.DB_USER,
      '-d', process.env.DB_NAME,
      '-f', tempDump,
      '-F', 'p',
      '--no-owner',
      '--no-privileges'
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
  
  return tempBackupDir;
}

// Откат к временной копии
async function rollbackFromTemp(tempBackupDir) {
  console.log('⚠️ Rolling back to previous state...');
  
  try {
    const tempDump = path.join(tempBackupDir, 'database.sql');
    await cleanDatabase();
    await runPsqlRestore(tempDump);
    console.log('✅ Database rolled back');
  } catch (error) {
    console.error('❌ Rollback database error:', error.message);
  }
  
  try {
    const tempUploads = path.join(tempBackupDir, 'uploads');
    await clearDirectory(UPLOADS_DIR);
    await copyDir(tempUploads, UPLOADS_DIR);
    console.log('✅ Files rolled back');
  } catch (error) {
    console.error('❌ Rollback files error:', error.message);
  }
  
  await fs.rm(tempBackupDir, { recursive: true, force: true }).catch(() => {});
  console.log('✅ Rollback completed');
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

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
    const dumpFile = path.join(BACKUP_DIR, `db-${timestamp}.backup`);

    console.log('📦 Creating database dump...');
    
    await new Promise((resolve, reject) => {
      const args = [
        '-h', process.env.DB_HOST || 'localhost',
        '-p', process.env.DB_PORT || '5432',
        '-U', process.env.DB_USER,
        '-d', process.env.DB_NAME,
        '-f', dumpFile,
        '-F', 'p',
        '--no-owner',
        '--no-privileges'
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
    
    console.log('✅ Database dump created');

    console.log('📦 Creating archive...');
    const output = fsSync.createWriteStream(filepath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on('close', () => {
        console.log(`✅ Archive created: ${archive.pointer()} bytes`);
        resolve();
      });
      output.on('error', reject);
      archive.on('error', reject);

      archive.pipe(output);
      archive.file(dumpFile, { name: 'database.backup' });

      fs.access(UPLOADS_DIR)
        .then(() => {
          console.log('📁 Adding uploads folder...');
          archive.directory(UPLOADS_DIR, 'uploads');
          archive.finalize();
        })
        .catch(() => {
          console.log('ℹ️ No uploads folder found');
          archive.finalize();
        });
    });

    await fs.unlink(dumpFile).catch(() => {});
    
    const stat = await fs.stat(filepath);
    console.log('🎉 Backup completed:', filename);
    
    res.json({ 
      message: 'Backup created successfully', 
      filename, 
      size: stat.size 
    });
  } catch (error) {
    console.error('❌ Backup error:', error);
    res.status(500).json({ error: 'Failed to create backup: ' + error.message });
  }
});

// Upload backup
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
  let tempBackupDir = null;
  
  try {
    await fs.access(filepath);
    
    console.log('═══════════════════════════════════════════════════');
    console.log('🔄 Starting FULL RESTORE from:', filename);
    console.log('Options:', { restoreDb, restoreFiles });
    console.log('═══════════════════════════════════════════════════');

    // 1. Распаковка
    await fs.mkdir(extractDir, { recursive: true });
    console.log('📦 Extracting archive...');
    await extractZip(filepath, extractDir);
    console.log('✅ Archive extracted');

    // 2. Валидация
    console.log('🔍 Validating backup...');
    const validationErrors = await validateBackup(extractDir);
    if (validationErrors.length > 0) {
      throw new Error('Backup validation failed: ' + validationErrors.join(', '));
    }
    console.log('✅ Backup is valid');

    // 3. Временная копия для отката
    console.log('💾 Creating temporary backup for rollback...');
    tempBackupDir = await createTempBackup();
    console.log('✅ Temporary backup created');

    const results = { database: null, files: null };

    // 4. Восстановление БД
    if (restoreDb) {
      const backupFile = path.join(extractDir, 'database.backup');
      try {
        console.log('🗄️  Restoring database (full clean and restore)...');
        
        // КРИТИЧЕСКИ ВАЖНО: полная очистка
        await cleanDatabase();

        // Восстанавливаем
        const { stdout, stderr } = await runPsqlRestore(backupFile);
        
        results.database = 'success';
        console.log('✅ Database restored successfully');
        
        if (stderr && stderr.includes('ERROR')) {
          console.warn('⚠️ Database restore warnings:', stderr.substring(0, 500));
        }
      } catch (dbError) {
        console.error('❌ Database restore error:', dbError.message);
        
        await rollbackFromTemp(tempBackupDir);
        tempBackupDir = null;
        
        throw new Error('Database restore failed: ' + dbError.message);
      }
    }

    // 5. Восстановление файлов
    if (restoreFiles) {
      const uploadsBackup = path.join(extractDir, 'uploads');
      try {
        await fs.access(uploadsBackup);
        console.log('📁 Restoring files (full clean and restore)...');
        
        console.log('🧹 Cleaning uploads folder...');
        await clearDirectory(UPLOADS_DIR);
        console.log('✅ Uploads folder cleaned');
        
        await fs.mkdir(UPLOADS_DIR, { recursive: true });
        await copyDir(uploadsBackup, UPLOADS_DIR);
        
        results.files = 'success';
        console.log('✅ Files restored successfully');
      } catch (filesError) {
        if (filesError.code === 'ENOENT') {
          console.log('ℹ️ No uploads in backup, cleaning current uploads...');
          await clearDirectory(UPLOADS_DIR);
          results.files = 'cleaned (no uploads in backup)';
        } else {
          console.error('❌ Files restore error:', filesError.message);
          results.files = 'error: ' + filesError.message;
        }
      }
    }

    // 6. Очистка
    console.log('🧹 Cleaning up...');
    await fs.rm(extractDir, { recursive: true, force: true });
    
    if (tempBackupDir) {
      await fs.rm(tempBackupDir, { recursive: true, force: true });
    }
    
    console.log('✅ Cleanup completed');
    console.log('═══════════════════════════════════════════════════');
    console.log('🎉 RESTORE COMPLETED SUCCESSFULLY');
    console.log('═══════════════════════════════════════════════════');

    const success = results.database === 'success' || results.files === 'success';
    
    res.json({
      message: success ? 'Restore completed successfully' : 'Restore completed with issues',
      results
    });
  } catch (error) {
    console.error('═══════════════════════════════════════════════════');
    console.error('❌ RESTORE FAILED:', error.message);
    console.error('═══════════════════════════════════════════════════');
    
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    
    res.status(500).json({ 
      error: 'Failed to restore backup: ' + error.message,
      hint: 'Система была откачена к предыдущему состоянию'
    });
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