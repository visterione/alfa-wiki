/**
 * Словарь предметов: правила «по названию — что это и как учитывать».
 *
 * Отдельным файлом, а не внутри catalog.js: словарь читается разбором ведомости
 * на каждый расчёт, и держать его рядом с формами номенклатуры значило бы
 * смешивать справочник, который заполняют раз в месяц, с тем, который правят
 * каждый день.
 *
 * ── Кто правит ───────────────────────────────────────────────────────────────
 *
 * Чтение — всем, у кого есть модуль: понимать, почему позиция попала в
 * оборудование, должен и тот, кто разбор не ведёт.
 *
 * Правка — canManageCatalog, то есть админ модуля и зав. складом. Намеренно НЕ
 * canImportOsv: ведомость грузит ещё и бухгалтер, но решение «что считать
 * оборудованием» — это решение о номенклатуре, а не о загрузке файла. Иначе
 * порядок учёта менялся бы у того, кто просто принёс выгрузку.
 */

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');

const {
  sequelize, WhItemRule, WhCategory, WhOsvImport, WhOsvLine, User,
} = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse, requireReport } = require('../../services/warehouse/access');
const {
  compileRules, headStats, headWord, normalize,
} = require('../../services/warehouse/itemRules');

const MATCH_TYPES = ['head', 'contains', 'regex'];
const ACCOUNTING = ['auto', 'asset', 'material', 'ignore'];

const include = [
  { model: WhCategory, as: 'category', attributes: ['id', 'name', 'kind'] },
  { model: User, as: 'author', attributes: ['id', 'displayName', 'username'] },
];

// ── Список правил ────────────────────────────────────────────────────────────
router.get('/', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const rows = await WhItemRule.findAll({
      include,
      order: [['matchType', 'ASC'], ['pattern', 'ASC']],
    });

    // Сломанные выражения отдаём вместе со списком: правило, которое не
    // компилируется, выглядит в таблице совершенно рабочим, и без пометки
    // человек будет ждать от него действия, которого не происходит.
    const { broken } = compileRules(rows);
    res.json({ rules: rows, broken });
  } catch (err) {
    console.error('GET warehouse/item-rules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Создание и правка ────────────────────────────────────────────────────────
router.put('/', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  try {
    const {
      id, pattern, matchType = 'head', accounting = 'auto',
      categoryId, unit, note, isActive,
    } = req.body;

    const clean = String(pattern || '').trim();
    if (!clean) return res.status(400).json({ error: 'Нужно выражение или слово' });
    if (clean.length > 200) {
      return res.status(400).json({ error: 'Выражение длиннее 200 символов' });
    }
    if (!MATCH_TYPES.includes(matchType)) {
      return res.status(400).json({ error: 'Неизвестный способ поиска' });
    }
    if (!ACCOUNTING.includes(accounting)) {
      return res.status(400).json({ error: 'Неизвестный способ учёта' });
    }
    // Выражение проверяем здесь, а не при разборе: узнать об опечатке в момент
    // сохранения можно и нужно, а на разборе она превратилась бы в молча
    // пропущенное правило посреди трёх тысяч строк.
    if (matchType === 'regex') {
      try {
        new RegExp(clean, 'i');
      } catch (e) {
        return res.status(400).json({ error: `Выражение не разбирается: ${e.message}` });
      }
    }

    const payload = {
      pattern: clean,
      matchType,
      accounting,
      categoryId: categoryId || null,
      unit: unit || null,
      note: note || null,
      ...(isActive === undefined ? {} : { isActive: Boolean(isActive) }),
      createdBy: req.user.id,
    };

    // Правило одно на пару «выражение + способ поиска»: два правила про «шкаф»
    // означали бы, что результат зависит от того, какое из них нашлось первым.
    //
    // Сравнение через lower(), а не iLike: в выражении законно встречаются % и _
    // («НДС 20%», «шкаф_2»), а для LIKE это шаблонные символы — такой поиск
    // нашёл бы чужое правило и переписал его. Индекс уникальности построен на
    // той же паре lower(pattern) + matchType, так что запрос попадает в него.
    const existing = id
      ? await WhItemRule.findByPk(id)
      : await WhItemRule.findOne({
        where: {
          matchType,
          [Op.and]: sequelize.where(
            sequelize.fn('lower', sequelize.col('pattern')), clean.toLowerCase(),
          ),
        },
      });

    if (existing) {
      await existing.update(payload);
      return res.json(await WhItemRule.findByPk(existing.id, { include }));
    }

    const created = await WhItemRule.create(payload);
    res.status(201).json(await WhItemRule.findByPk(created.id, { include }));
  } catch (err) {
    console.error('PUT warehouse/item-rules error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  try {
    const row = await WhItemRule.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Правило не найдено' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE warehouse/item-rules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Ведущие слова снимка ─────────────────────────────────────────────────────
/**
 * Рабочий список экрана разметки: какие слова встречаются в ведомости, сколько
 * строк и денег стоит за каждым и закрыто ли оно словарём.
 *
 * Сортировка по числу строк — это и есть весь смысл экрана: первые полсотни
 * слов закрывают половину ведомости, и человек должен видеть это сразу, а не
 * идти по алфавиту от «абажура».
 */
router.get('/heads', authenticate, requireWarehouse(), requireReport('RPT-OSV'), async (req, res) => {
  try {
    const snapshot = req.query.importId
      ? await WhOsvImport.findByPk(req.query.importId)
      : await WhOsvImport.findOne({
        where: { status: 'applied' },
        order: [['periodYear', 'DESC'], ['periodMonth', 'DESC']],
      });
    if (!snapshot) return res.json({ import: null, heads: [], totals: null });

    const [lines, rules] = await Promise.all([
      WhOsvLine.findAll({
        where: { importId: snapshot.id, isGroup: false },
        attributes: ['name', 'closingQty', 'closingSum', 'unitCost'],
      }),
      WhItemRule.findAll({ where: { isActive: true } }),
    ]);

    const { compiled } = compileRules(rules);
    const heads = headStats(lines.map(l => l.get({ plain: true })), compiled);

    const totals = heads.reduce((acc, h) => ({
      heads: acc.heads + 1,
      coveredHeads: acc.coveredHeads + (h.covered === h.lines ? 1 : 0),
      lines: acc.lines + h.lines,
      coveredLines: acc.coveredLines + h.covered,
      sum: acc.sum + h.sum,
      coveredSum: acc.coveredSum + (h.covered === h.lines ? h.sum : 0),
    }), { heads: 0, coveredHeads: 0, lines: 0, coveredLines: 0, sum: 0, coveredSum: 0 });

    res.json({
      import: {
        id: snapshot.id, account: snapshot.account,
        periodYear: snapshot.periodYear, periodMonth: snapshot.periodMonth,
      },
      heads,
      totals,
    });
  } catch (err) {
    console.error('GET warehouse/item-rules/heads error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Проверка выражения до сохранения ─────────────────────────────────────────
/**
 * Что поймает правило, если его сохранить. Нужно для regex и подстроки: у
 * ведущего слова совпадения предсказуемы, а выражение человек пишет вслепую и
 * узнаёт о промахе только после разбора всей ведомости.
 */
router.get('/probe', authenticate, requireWarehouse('canManageCatalog'), async (req, res) => {
  try {
    const { pattern, matchType = 'head', importId } = req.query;
    const clean = String(pattern || '').trim();
    if (!clean) return res.status(400).json({ error: 'Нужно выражение' });
    if (!MATCH_TYPES.includes(matchType)) {
      return res.status(400).json({ error: 'Неизвестный способ поиска' });
    }

    const snapshot = importId
      ? await WhOsvImport.findByPk(importId)
      : await WhOsvImport.findOne({
        where: { status: 'applied' },
        order: [['periodYear', 'DESC'], ['periodMonth', 'DESC']],
      });
    if (!snapshot) return res.json({ matched: 0, sum: 0, samples: [] });

    const { compiled, broken } = compileRules([
      { id: 'probe', pattern: clean, matchType, accounting: 'auto', isActive: true },
    ]);
    if (broken.length) {
      return res.status(400).json({ error: `Выражение не разбирается: ${broken[0].reason}` });
    }

    const lines = await WhOsvLine.findAll({
      where: { importId: snapshot.id, isGroup: false },
      attributes: ['name', 'closingQty', 'closingSum', 'unitCost'],
    });

    const probe = compiled[0];
    let matched = 0;
    let sum = 0;
    const samples = [];
    for (const row of lines) {
      const line = row.get({ plain: true });
      if (!probe.test(String(line.name || ''), normalize(line.name), headWord(line.name))) continue;
      matched += 1;
      sum += Number(line.closingSum) || 0;
      if (samples.length < 12) {
        samples.push({
          name: line.name,
          closingQty: Number(line.closingQty),
          unitCost: line.unitCost === null ? null : Number(line.unitCost),
        });
      }
    }

    res.json({ matched, sum, samples, total: lines.length });
  } catch (err) {
    console.error('GET warehouse/item-rules/probe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
