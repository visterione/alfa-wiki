/**
 * Обработка голосовых сообщений.
 *
 * Задача одна: привести запись к формату, который играет везде.
 * Браузеры и телефоны пишут разное и несовместимое:
 *   Chrome / Firefox  → webm, кодек opus
 *   Safari            → mp4, кодек aac
 *   Android / iOS     → m4a, кодек aac
 * При этом iOS не умеет opus вообще. Без приведения к общему знаменателю
 * голосовое из Chrome не открылось бы на айфоне — и это выяснилось бы не
 * сразу, а у первого же сотрудника с iPhone.
 *
 * Канонический формат — m4a (AAC LC), моно, 40 кбит/с: играет во всех
 * браузерах, на Android и на iOS, а минута речи весит около 300 КБ.
 *
 * Если ffmpeg на машине нет, файл сохраняется как есть. Голосовые тогда
 * работают внутри одной платформы и ломаются между ними — это запасной режим,
 * чтобы разработка без ffmpeg не вставала колом, а не рабочий вариант.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TARGET_EXT = '.m4a';
const TARGET_MIME = 'audio/mp4';

// Длиннее этого не пишем: минутные монологи в чате никому не нужны,
// а на сервере они превращаются в мегабайты
const MAX_DURATION_SEC = 300;

// Результат проверки кэшируем, но НЕ навсегда: если ffmpeg не нашёлся, его
// могли доустановить уже после старта процесса. Раньше отрицательный ответ
// защёлкивался до перезапуска, и сервер молча складывал записи как есть —
// браузерный webm при этом не играл ни на Android, ни на iOS.
let ffmpegAvailable = false;
let ffmpegCheckedAt = 0;
const RECHECK_MS = 60_000;

function run(cmd, args) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let proc;
    try {
      proc = spawn(cmd, args);
    } catch {
      return resolve({ ok: false, stdout: '', stderr: 'spawn failed' });
    }
    proc.stdout?.on('data', d => { stdout += d; });
    proc.stderr?.on('data', d => { stderr += d; });
    proc.on('error', () => resolve({ ok: false, stdout, stderr }));
    proc.on('close', code => resolve({ ok: code === 0, stdout, stderr }));
  });
}

/**
 * Есть ли ffmpeg. Проверяется один раз за жизнь процесса.
 */
async function checkFfmpeg() {
  // Положительный ответ держим до перезапуска: исчезнуть ffmpeg не может.
  // Отрицательный перепроверяем раз в минуту — вдруг его доустановили.
  if (ffmpegAvailable) return true;
  if (ffmpegCheckedAt && Date.now() - ffmpegCheckedAt < RECHECK_MS) return false;

  ffmpegCheckedAt = Date.now();
  const { ok } = await run('ffmpeg', ['-version']);
  ffmpegAvailable = ok;
  console.log(ok
    ? '🎤 ffmpeg найден — голосовые перекодируются в m4a'
    : '⚠️  ffmpeg не найден — голосовые сохраняются как есть, между платформами играть не будут');
  return ffmpegAvailable;
}

/**
 * Длительность в секундах через ffprobe. null, если определить не удалось.
 */
async function probeDuration(filePath) {
  const { ok, stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  if (!ok) return null;
  const value = parseFloat(String(stdout).trim());
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

/**
 * Приводит загруженный файл к каноническому m4a.
 *
 * @param {object} file — объект multer (path, originalname, mimetype, size)
 * @returns {Promise<{path:string, mimeType:string, size:number, duration:number|null, transcoded:boolean}>}
 */
async function normalize(file) {
  const hasFfmpeg = await checkFfmpeg();

  if (!hasFfmpeg) {
    return {
      path: file.path.replace(/\\/g, '/'),
      mimeType: file.mimetype,
      size: file.size,
      duration: null,
      transcoded: false,
    };
  }

  const dir = path.dirname(file.path);
  const base = path.basename(file.path, path.extname(file.path));
  const outPath = path.join(dir, `${base}${TARGET_EXT}`);

  const { ok, stderr } = await run('ffmpeg', [
    '-i', file.path,
    '-vn',                       // видеодорожки в голосовом быть не может
    '-ac', '1',                  // моно: речь, стерео только удваивает размер
    '-c:a', 'aac',
    '-b:a', '40k',
    '-movflags', '+faststart',   // метаданные в начало — плеер стартует, не скачав файл целиком
    '-t', String(MAX_DURATION_SEC),
    '-y',
    outPath,
  ]);

  if (!ok || !fs.existsSync(outPath)) {
    console.error('[voice] ffmpeg не справился, сохраняю оригинал:', String(stderr).slice(-300));
    return {
      path: file.path.replace(/\\/g, '/'),
      mimeType: file.mimetype,
      size: file.size,
      duration: null,
      transcoded: false,
    };
  }

  // Оригинал больше не нужен — на диске остаётся только приведённый файл
  fs.unlink(file.path, () => {});

  const duration = await probeDuration(outPath);
  const { size } = fs.statSync(outPath);

  return {
    path: outPath.replace(/\\/g, '/'),
    mimeType: TARGET_MIME,
    size,
    duration,
    transcoded: true,
  };
}

module.exports = {
  normalize,
  checkFfmpeg,
  MAX_DURATION_SEC,
};
