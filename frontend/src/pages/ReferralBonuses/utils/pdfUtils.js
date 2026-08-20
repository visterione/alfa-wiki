import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.legacy.min.mjs`;

// WebKit (Tauri) polyfill: ReadableStream does not support Symbol.asyncIterator
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Strip all whitespace variants (including non-breaking spaces) and parse Russian float
function parseRuNum(s) {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/[\s   ]+/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

// Normalize a subdivision string for comparison: strip quotes and collapse spaces
function normSubdivision(s) {
  return String(s || '').replace(/["“”«»"«»]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Coerce a stored pdfSubdivision value into a clean array of subdivision names.
// Accepts the new array form, the legacy single string, and legacy ";"/newline-separated strings.
function toSubdivisionList(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[;\n]/);
  return arr.map(s => String(s || '').trim()).filter(Boolean);
}

// Extract lines from a PDF page, sorted top→bottom, items within each line left→right
async function extractLines(page) {
  const content = await page.getTextContent();
  const yMap = new Map();
  for (const item of content.items) {
    const str = item.str;
    if (!str || !str.trim()) continue;
    const y = Math.round(item.transform[5]);
    if (!yMap.has(y)) yMap.set(y, []);
    yMap.get(y).push({ x: item.transform[4], str });
  }
  return [...yMap.entries()]
    .sort(([ya], [yb]) => yb - ya) // higher y = top of page in PDF coords
    .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.str).join(' ').trim())
    .filter(l => l.length > 0);
}

// ── Block parser ──────────────────────────────────────────────────────────────

// Matches a Russian-formatted number like "73 409,93" (with any whitespace variants)
const RU_NUM = '[\\d\\s\\u00A0\\u202F\\u2009]+,\\d{2}';
const RU_NUM_RE = new RegExp(RU_NUM);

// Колонка «Период» в листке: "май 2026", но месяцы длиннее трёх букв 1С сокращает
// точкой — "авг. 2026", "сент. 2026", "февр. 2026". Раньше точка не допускалась, и
// импорт молча терял аванс/зарплату/отпускные во все месяцы, кроме март/май/июнь/июль.
const MONTH_YEAR_SUM =
  '(?:янв|фев|мар|апр|май|июн|июл|авг|сен|окт|ноя|дек)[а-яё]*\\.?\\s+\\d{4}\\s+(' + RU_NUM + ')';

function parseBlock(lines) {
  const text = lines.join('\n');

  // ── Name: "Борецкая Ольга Алексеевна (00480)" ─────────────────────────────
  const nameMatch = text.match(/^([Ѐ-ӿ][Ѐ-ӿ\s\-]+?)\s*\(\d{4,6}\)/m);
  const name = nameMatch ? nameMatch[1].trim() : null;
  if (!name) return null;

  // ── Subdivision: "Подразделение: МЦ "Альфа Линия"  Оклад (тариф): ..."
  let subdivision = null;
  const subdivLineMatch = text.match(/Подразделение:\s+(.+)/m);
  if (subdivLineMatch) {
    let s = subdivLineMatch[1];
    const cutAt = s.search(/\s{3,}|Оклад/);
    if (cutAt > -1) s = s.substring(0, cutAt);
    // Strip all quote variants so comparison works regardless of how quotes are stored
    subdivision = normSubdivision(s);
  }

  // ── НДФЛ: "...НДФЛ май 2026 52 000,00" ───────────────────────────────────
  let ndfl = null;
  const ndflMatch = text.match(new RegExp('НДФЛ\\s+\\S+\\s+\\d{4}\\s+(' + RU_NUM + ')'));
  if (ndflMatch) ndfl = parseRuNum(ndflMatch[1]);

  // ── Аванс: "За первую половину месяца ... май 2026  73 409,93" ─────────────
  // Find the FIRST date+amount after the label (≤200 chars away).
  // Using nums[last] over a large slice bleeds into совместительство rows.
  // Заголовок листка — "РАСЧЕТНЫЙ ЛИСТОК ЗА АВГУСТ 2026 (ЗА ПЕРВУЮ ПОЛОВИНУ МЕСЯЦА)" —
  // содержит ту же фразу, поэтому метку в скобках отсекаем: считаем только строку выплаты.
  let advance = null;
  const advMatch = text.match(
    new RegExp(
      '(?:^|[^(])За первую половину месяца[\\s\\S]{0,200}?' + MONTH_YEAR_SUM,
      'i'
    )
  );
  if (advMatch) advance = parseRuNum(advMatch[1]);

  // ── Основная зарплата ──────────────────────────────────────────────────────
  let mainPayment = null;
  // Priority 1: "Зарплата за [второй] месяц … май YYYY  NNN,NN"
  const salaryMatch = text.match(
    new RegExp(
      'Зарплата за\\s+(?:второй\\s+)?месяц[\\s\\S]{0,200}?' + MONTH_YEAR_SUM,
      'i'
    )
  );
  if (salaryMatch) {
    const v = parseRuNum(salaryMatch[1]);
    if (v && v > 0) mainPayment = v;
  }
  // Priority 2: "Долг предприятия на конец  274 588,25"
  if (mainPayment === null) {
    const debtMatch = text.match(new RegExp('на конец\\s+(' + RU_NUM + ')'));
    if (debtMatch) {
      const v = parseRuNum(debtMatch[1]);
      if (v && v > 0) mainPayment = v;
    }
  }

  // ── Отпуска/межрасчет: "Отпуска, межрасчет (Банк, ...) май 2026 39 862,62" ──
  let vacation = null;
  const vacMatch = text.match(
    new RegExp(
      'Отпуска,\\s+межрасчет[\\s\\S]{0,200}?' + MONTH_YEAR_SUM,
      'i'
    )
  );
  if (vacMatch) vacation = parseRuNum(vacMatch[1]);

  return { name, subdivision, ndfl, advance, vacation, mainPayment };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a 1C salary-slip PDF and return an array of per-employee records.
 * Returns: [{ name, subdivision, ndfl, advance, mainPayment }, ...]
 * subdivision is pre-normalized (no quotes, lowercase) for easy comparison.
 */
export async function parseSalarySlipPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

  const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    allLines.push(...await extractLines(page));
  }

  const blocks = [];
  let block = null;
  for (const line of allLines) {
    if (/РАСЧЕТНЫЙ ЛИСТОК ЗА/i.test(line)) {
      if (block !== null) blocks.push(block);
      block = [line];
    } else if (block !== null) {
      block.push(line);
    }
  }
  if (block && block.length) blocks.push(block);

  return blocks.map(parseBlock).filter(Boolean);
}

// Export for use in matching logic in index.js
export { normSubdivision, toSubdivisionList };
