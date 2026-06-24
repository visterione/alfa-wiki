/**
 * Заливка справочника номенклатуры 804н в таблицу nomenclature_804n.
 *
 * Источник эталонов — актуальная редакция (xlsx Минздрава), плюс редакция 2017
 * (nameAlt) только для кодов, где название отличалось (scripts/data/...-alt2017.json).
 *
 * Запуск:
 *   node backend/scripts/seedNomenclature804n.js [путь_к_xlsx]
 * По умолчанию берёт backend/bot/1.2.643.5.1.13.13.11.1070_2.10-2.xlsx
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const XLSX = require('xlsx-js-style');
const { sequelize, Nomenclature804n } = require('../models');
const { normalizeCode } = require('../services/nomenclature804n');

const DEFAULT_XLSX = path.join(__dirname, '..', 'bot', '1.2.643.5.1.13.13.11.1070_2.10-2.xlsx');
const ALT_2017 = require('./data/nomenclature-804n-alt2017.json');
const SHEET = 'Справочные данные';
const EDITION = '2.10';

async function run() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX;
  console.log('🔄 Подключение к БД...');
  await sequelize.authenticate();

  console.log('🔄 Создание таблицы (если нет)...');
  await Nomenclature804n.sync();

  console.log(`🔄 Чтение справочника: ${xlsxPath}`);
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`В файле нет листа "${SHEET}". Листы: ${wb.SheetNames.join(', ')}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // колонки: Код | ID | Код услуги | Полное название | Признак актуальности | Дата упразднения | Наименование
  const altNorm = {};
  for (const [code, name] of Object.entries(ALT_2017)) altNorm[normalizeCode(code)] = name;

  const seen = new Set();
  const records = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[0] == null) continue;
    const code = normalizeCode(r[0]);
    const name = String(r[3] == null ? '' : r[3]).trim();
    if (!code || !name) { skipped++; continue; }
    if (seen.has(code)) { skipped++; continue; } // дубль кода — берём первый
    seen.add(code);
    const deprecated = String(r[4]).trim() === '0' || (r[5] != null && String(r[5]).trim() !== '');
    records.push({
      code,
      name: name.slice(0, 500),
      nameAlt: altNorm[code] ? altNorm[code].slice(0, 500) : null,
      deprecated,
      edition: EDITION
    });
  }

  console.log(`🔄 Готово к заливке: ${records.length} кодов (пропущено ${skipped}), alt-названий 2017: ${Object.keys(altNorm).length}`);

  await sequelize.transaction(async (t) => {
    await Nomenclature804n.destroy({ where: {}, truncate: true, transaction: t });
    const CHUNK = 1000;
    for (let i = 0; i < records.length; i += CHUNK) {
      await Nomenclature804n.bulkCreate(records.slice(i, i + CHUNK), { transaction: t });
      process.stdout.write(`\r  залито ${Math.min(i + CHUNK, records.length)}/${records.length}`);
    }
  });

  const total = await Nomenclature804n.count();
  const dep = await Nomenclature804n.count({ where: { deprecated: true } });
  const alt = await Nomenclature804n.count({ where: { nameAlt: { [sequelize.Sequelize.Op.ne]: null } } });
  console.log(`\n✅ Справочник залит: всего ${total}, упразднённых ${dep}, с alt-2017 ${alt}`);
  process.exit(0);
}

run().catch(e => { console.error('\n❌ Ошибка сидирования:', e); process.exit(1); });
