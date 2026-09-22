const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const { extractText, kindOf, xmlToText } = require('../services/mail/extract');

const FONT = path.join(__dirname, '..', 'fonts', 'DejaVuSans.ttf');

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function makePdf(text) {
  const doc = new PDFDocument();
  const done = collect(doc);
  doc.registerFont('DejaVu', FONT);
  doc.font('DejaVu').fontSize(12).text(text);
  doc.end();
  return done;
}

async function makeZip(entries) {
  const archive = archiver('zip');
  const done = collect(archive);
  for (const [name, content] of Object.entries(entries)) archive.append(content, { name });
  await archive.finalize();
  return done;
}

async function makeXlsx(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Лист1');
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ── Определение вида ──────────────────────────────────────────────────────

test('вид файла определяется и по типу, и по расширению', () => {
  assert.equal(kindOf('application/pdf', 'x'), 'pdf');
  assert.equal(kindOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'x'), 'docx');
  assert.equal(kindOf('text/plain', 'x'), 'plain');

  // Почтовые клиенты сплошь и рядом ставят octet-stream на всё подряд, поэтому
  // расширение — полноправный признак, а не запасной путь.
  assert.equal(kindOf('application/octet-stream', 'претензия.pdf'), 'pdf');
  assert.equal(kindOf('application/octet-stream', 'жалоба.DOCX'), 'docx');
  assert.equal(kindOf('application/octet-stream', 'акт.xlsx'), 'xlsx');

  assert.equal(kindOf('image/jpeg', 'скан.jpg'), null, 'картинки не разбираем — OCR не делаем');
  assert.equal(kindOf('application/zip', 'архив.zip'), null);
});

// ── PDF ───────────────────────────────────────────────────────────────────

test('из PDF достаётся русский текст', async () => {
  const pdf = await makePdf('Претензия от Гулиевой Айны Рамизовны по договору 451');
  const text = await extractText(pdf, 'application/pdf', 'претензия.pdf');

  assert.ok(text, 'текст должен извлечься');
  assert.match(text, /Гулиевой/);
  assert.match(text, /договору 451/);
});

test('PDF без текстового слоя не даёт мусора в индекс', async () => {
  // Скан — это картинка внутри PDF. Мы его не распознаём (OCR отклонён), и
  // важно, чтобы вместо текста не приехали случайные символы от разбора шрифтов.
  const doc = new PDFDocument();
  const done = collect(doc);
  doc.rect(50, 50, 200, 100).fill('#cccccc');
  doc.end();

  const text = await extractText(await done, 'application/pdf', 'скан.pdf');
  assert.equal(text, null);
});

// ── DOCX ──────────────────────────────────────────────────────────────────

test('из DOCX достаётся текст абзацев', async () => {
  const xml = `<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>Жалоба на приём</w:t></w:r></w:p>
        <w:p><w:r><w:t>Пациент: Иванова Мария Петровна</w:t></w:r></w:p>
        <w:p><w:r><w:t>Просим разобраться</w:t></w:r></w:p>
      </w:body>
    </w:document>`;

  const docx = await makeZip({ 'word/document.xml': xml, '[Content_Types].xml': '<Types/>' });
  const text = await extractText(docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'жалоба.docx');

  assert.ok(text);
  assert.match(text, /Иванова Мария Петровна/);
  // Абзацы должны разделиться, иначе «приёмПациент» попало бы в индекс одним
  // несуществующим словом.
  assert.doesNotMatch(text, /приёмПациент/);
});

test('мнемоники внутри DOCX раскрываются', () => {
  const text = xmlToText('<w:t>ООО &quot;Ромашка&quot; &amp; партнёры</w:t>');
  assert.match(text, /"Ромашка"/);
  assert.match(text, /& партнёры/);
});

// ── XLSX ──────────────────────────────────────────────────────────────────

test('из XLSX достаются подписи строк', async () => {
  const xlsx = await makeXlsx([
    ['Контрагент', 'Сумма'],
    ['ООО Ромашка', 12000],
    ['Гулиев Рамиз', 3400],
  ]);

  const text = await extractText(xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'акт.xlsx');
  assert.ok(text);
  assert.match(text, /Ромашка/);
  assert.match(text, /Гулиев Рамиз/);
});

// ── Простой текст и отказы ────────────────────────────────────────────────

test('обычный текстовый файл берётся как есть', async () => {
  const text = await extractText(Buffer.from('Гарантируем оплату за пациента Иванову М. П.', 'utf8'), 'text/plain', 'письмо.txt');
  assert.match(text, /Иванову/);
});

test('битый файл не роняет разбор письма', async () => {
  // Обрезанные и повреждённые вложения в архиве десятилетней давности —
  // обычное дело. Минус одно совпадение в поиске лучше, чем упавшая заливка.
  const garbage = Buffer.from('%PDF-1.4 дальше мусор и обрыв', 'utf8');
  assert.equal(await extractText(garbage, 'application/pdf', 'битый.pdf'), null);

  const notZip = Buffer.from('это не zip', 'utf8');
  assert.equal(await extractText(notZip, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'x.docx'), null);
});

test('пустое и слишком большое пропускается', async () => {
  assert.equal(await extractText(Buffer.alloc(0), 'application/pdf', 'x.pdf'), null);
  assert.equal(await extractText(null, 'application/pdf', 'x.pdf'), null);

  const huge = Buffer.alloc(26 * 1024 * 1024);
  assert.equal(await extractText(huge, 'application/pdf', 'x.pdf'), null, 'файлы за потолком не разбираем');
});

test('слишком короткий результат в индекс не идёт', async () => {
  // Несколько случайных символов от разбора — это не текст, а шум.
  const text = await extractText(Buffer.from('ок', 'utf8'), 'text/plain', 'x.txt');
  assert.equal(text, null);
});
