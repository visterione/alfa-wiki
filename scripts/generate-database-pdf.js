#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');
const sourcePath = path.join(projectDir, 'docs', 'DATABASE_PRODUCTION.md');
const outputPath = path.join(projectDir, 'docs', 'DATABASE_PRODUCTION.pdf');
const chromePath = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mermaidPath = process.env.MERMAID_JS
  || '/private/tmp/alfa-wiki-mermaid.min.js';
const markdownItPath = path.join(
  projectDir,
  'frontend',
  'node_modules',
  'markdown-it',
  'dist',
  'markdown-it.min.js',
);

for (const requiredPath of [sourcePath, chromePath, mermaidPath, markdownItPath]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Не найден обязательный файл: ${requiredPath}`);
  }
}

// eslint-disable-next-line import/no-dynamic-require, global-require
const MarkdownIt = require(markdownItPath);
const markdown = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
});
const defaultFence = markdown.renderer.rules.fence;
markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (token.info.trim() === 'mermaid') {
    return `<div class="mermaid">${markdown.utils.escapeHtml(token.content)}</div>\n`;
  }
  return defaultFence(tokens, index, options, env, self);
};

const source = fs.readFileSync(sourcePath, 'utf8');
let content = markdown.render(source);
const erdIntroPattern = /<p><a id="erd"><\/a><\/p>\s*<h2>1\. ERD<\/h2>[\s\S]*?(?=<p><a id="erd-)/;
const erdIntroMatch = content.match(erdIntroPattern);
if (!erdIntroMatch) throw new Error('Не найден вводный блок ERD в HTML');
const erdIntro = erdIntroMatch[0];
content = content.replace(erdIntroPattern, '');

let erdSectionCount = 0;
content = content.replace(
  /<p><a id="erd-[^"]+"><\/a><\/p>\s*<h3>[\s\S]*?<div class="mermaid">[\s\S]*?<\/div>/g,
  block => {
    const prefix = erdSectionCount === 0 ? erdIntro : '';
    erdSectionCount += 1;
    return `<section class="erd-page">${prefix}${block}</section>`;
  },
);
if (erdSectionCount !== 14) {
  throw new Error(`Ожидалось 14 ERD-секций, найдено: ${erdSectionCount}`);
}
const generatedAt = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'long',
  timeStyle: 'medium',
  timeZone: 'Europe/Moscow',
}).format(new Date());

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Production-БД Alfa-Wiki: ERD и словарь данных</title>
  <style>
    @page { size: A4 portrait; margin: 11mm 10mm 12mm; }
    @page erd { size: A4 landscape; margin: 10mm 9mm 11mm; }
    * { box-sizing: border-box; }
    html { font-family: Arial, "Helvetica Neue", sans-serif; font-size: 9pt; color: #172033; }
    body { margin: 0; line-height: 1.35; }
    h1 { font-size: 23pt; margin: 0 0 8mm; color: #172554; }
    h2 { font-size: 17pt; margin: 9mm 0 4mm; padding-bottom: 2mm; border-bottom: 1px solid #aebbd0; break-after: avoid; }
    h3 { font-size: 13pt; margin: 7mm 0 3mm; color: #1e3a8a; break-after: avoid; }
    h4 { font-size: 11pt; margin: 6mm 0 2mm; color: #334155; break-after: avoid; }
    p:has(> a[id]) { height: 0; margin: 0; padding: 0; }
    p:has(> a#fields) + h2 { break-before: page; }
    p { margin: 0 0 3mm; }
    a { color: #1d4ed8; text-decoration: none; }
    ul { margin: 1.5mm 0 3mm 5mm; padding-left: 4mm; }
    li { margin: 0.5mm 0; }
    table { width: 100%; border-collapse: collapse; margin: 2mm 0 5mm; font-size: 7pt; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 0.25mm solid #cbd5e1; padding: 1.2mm 1.5mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #e8eef8; color: #172554; font-weight: 700; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    table:has(th:nth-child(6)) { table-layout: fixed; }
    table:has(th:nth-child(6)) th:nth-child(1) { width: 10%; }
    table:has(th:nth-child(6)) th:nth-child(2) { width: 12%; }
    table:has(th:nth-child(6)) th:nth-child(3) { width: 8%; }
    table:has(th:nth-child(6)) th:nth-child(4) { width: 34%; }
    table:has(th:nth-child(6)) th:nth-child(5) { width: 5%; }
    table:has(th:nth-child(6)) th:nth-child(6) { width: 31%; }
    code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.92em; white-space: normal; overflow-wrap: anywhere; }
    blockquote { margin: 3mm 0; padding: 2mm 4mm; border-left: 1mm solid #64748b; background: #f1f5f9; }
    .erd-page { page: erd; break-before: page; }
    .erd-page h2 { margin-top: 0; }
    .erd-page h3 { margin-top: 0; }
    .erd-page h2 + p { margin-bottom: 3mm; }
    .mermaid { display: flex; align-items: center; justify-content: center; width: 100%; height: 150mm; margin: 2mm auto 0; text-align: center; break-inside: avoid; overflow: hidden; }
    .mermaid svg { display: block; max-width: 100% !important; width: auto !important; height: auto !important; max-height: 145mm !important; margin: 0 auto; }
    .erd-page:first-of-type .mermaid { height: 125mm; }
    .erd-page:first-of-type .mermaid svg { max-height: 120mm !important; }
    .pdf-meta { margin-top: 10mm; font-size: 8pt; color: #64748b; }
  </style>
</head>
<body>
  ${content}
  <p class="pdf-meta">PDF сформирован ${generatedAt} (MSK).</p>
  <script src="${pathToFileURL(mermaidPath).href}"></script>
  <script>
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
      flowchart: { htmlLabels: false },
      er: { useMaxWidth: true },
    });
    mermaid.run({ querySelector: '.mermaid' })
      .then(() => document.documentElement.setAttribute('data-mermaid-ready', 'true'))
      .catch(error => {
        document.documentElement.setAttribute('data-mermaid-error', String(error));
        console.error(error);
      });
  </script>
</body>
</html>`;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alfa-wiki-database-pdf-'));
const htmlPath = path.join(tempDir, 'DATABASE_PRODUCTION.html');
const chromeProfile = path.join(tempDir, 'chrome-profile');
fs.writeFileSync(htmlPath, html);

const result = spawnSync(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-pdf-header-footer',
  '--run-all-compositor-stages-before-draw',
  '--allow-file-access-from-files',
  '--virtual-time-budget=30000',
  `--user-data-dir=${chromeProfile}`,
  `--print-to-pdf=${outputPath}`,
  pathToFileURL(htmlPath).href,
], {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

if (result.status !== 0 || !fs.existsSync(outputPath)) {
  process.stderr.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  throw new Error(`Chrome не смог сформировать PDF, код завершения: ${result.status}`);
}

const sizeMb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
console.log(`PDF создан: ${outputPath}`);
console.log(`Размер: ${sizeMb} МБ`);
