'use strict';

/**
 * Быстрые данные колл-центра (ver. 8.32).
 *
 * Набор для страницы backend/bot/call-center.html. До этой версии он лежал в
 * localStorage браузера, и это оказалось ловушкой: человек заполнял карточки,
 * считал работу сделанной, а смена продолжала видеть демо-примеры. Набор общий
 * по смыслу задачи — оператор диктует пациенту то же, что и его сосед.
 *
 * Страница правит набор целиком и целиком же его сохраняет: она маленькая, без
 * сборки, и дробить сохранение на «создать/изменить/удалить карточку» значило бы
 * переписать её всю ради случая, который случается раз в месяц. Поэтому здесь
 * два метода: отдать всё и принять всё.
 *
 * Плата за это — риск затереть чужую правку, и от него защищает revision:
 * страница присылает номер, с которым читала набор, и если за это время его
 * кто-то сохранил, запись не проходит. Иначе двое, открывшие «Редактировать» в
 * один день, молча стёрли бы работу друг друга.
 */

const express = require('express');
const { Op } = require('sequelize');
const { CallCenterTab, CallCenterSnippet, Setting } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const sequelize = CallCenterTab.sequelize;

const REVISION_KEY = 'call_center_revision';

// Пределы стоят не от злого умысла, а от случайной вставки: в поле «что
// копируется» попадает буфер обмена целиком, и это бывает страница текста.
const LIMITS = {
  tabs: 50,
  snippets: 1000,
  items: 20,
  id: 64,
  tabTitle: 200,
  title: 300,
  label: 200,
  value: 20000
};

const KINDS = ['text', 'url', 'email', 'phone'];

function text(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function intOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * Чистим то, что пришло от страницы. Разбор намеренно снисходительный: если
 * карточка пришла кривой, её проще выбросить, чем отказать в сохранении всего
 * набора и оставить оператора с формой, из которой некуда деться.
 */
function cleanTabs(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw.slice(0, LIMITS.tabs)) {
    const id = text(item && item.id, LIMITS.id);
    const title = text(item && item.title, LIMITS.tabTitle);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title, sortOrder: intOr(item.sortOrder, out.length + 1) });
  }
  return out;
}

function cleanItems(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(0, LIMITS.items)) {
    const value = text(item && item.value, LIMITS.value);
    if (!value) continue;
    const kind = KINDS.includes(item && item.kind) ? item.kind : 'text';
    out.push({ label: text(item && item.label, LIMITS.label), kind, value });
  }
  return out;
}

function cleanSnippets(raw, tabIds) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw.slice(0, LIMITS.snippets)) {
    const id = text(item && item.id, LIMITS.id);
    const tabId = text(item && item.tabId, LIMITS.id);
    const title = text(item && item.title, LIMITS.title);
    // Карточка без вкладки не отобразится нигде и станет невидимым мусором,
    // который потом ищут в базе руками.
    if (!id || !title || seen.has(id) || !tabIds.has(tabId)) continue;
    const items = cleanItems(item && item.items);
    if (!items.length) continue;
    seen.add(id);
    out.push({ id, tabId, title, sortOrder: intOr(item.sortOrder, out.length + 1), items });
  }
  return out;
}

async function readRevision(transaction, lock) {
  const [row] = await Setting.findOrCreate({
    where: { key: REVISION_KEY },
    defaults: { value: 0, description: 'Номер правки набора быстрых данных колл-центра' },
    transaction
  });
  if (!lock) return { row, revision: intOr(row.value, 0) };
  // Перечитываем под блокировкой: findOrCreate её не ставит, а без неё двое
  // сохраняющих одновременно получат один и тот же номер и оба пройдут проверку.
  const locked = await Setting.findByPk(REVISION_KEY, { transaction, lock: transaction.LOCK.UPDATE });
  return { row: locked || row, revision: intOr((locked || row).value, 0) };
}

async function readSet(transaction) {
  const [tabs, snippets] = await Promise.all([
    CallCenterTab.findAll({ order: [['sortOrder', 'ASC']], transaction }),
    CallCenterSnippet.findAll({ order: [['sortOrder', 'ASC']], transaction })
  ]);
  return {
    tabs: tabs.map(t => ({ id: t.id, title: t.title, sortOrder: t.sortOrder })),
    snippets: snippets.map(s => ({
      id: s.id, tabId: s.tabId, title: s.title, sortOrder: s.sortOrder, items: s.items || []
    }))
  };
}

// Отдать набор целиком. Пустой ответ — это не ошибка, а «ещё не заполняли»:
// страница в таком случае показывает примеры и предлагает их заменить.
router.get('/', authenticate, async (req, res) => {
  try {
    const { revision } = await readRevision(null, false);
    const set = await readSet(null);
    res.json({ ...set, revision });
  } catch (err) {
    console.error('[call-center] чтение набора:', err);
    res.status(500).json({ error: 'Не удалось прочитать набор' });
  }
});

// Принять набор целиком.
router.put('/', authenticate, async (req, res) => {
  const body = req.body || {};
  const tabs = cleanTabs(body.tabs);
  const tabIds = new Set(tabs.map(t => t.id));
  const snippets = cleanSnippets(body.snippets, tabIds);

  // Пустой набор разрешён только явно: удалить всё через интерфейс можно, но
  // это должно быть решением, а не последствием того, что страница отправила
  // пустое тело, не дождавшись загрузки.
  if (!tabs.length && !snippets.length && body.allowEmpty !== true) {
    return res.status(400).json({ error: 'Пустой набор не сохраняется' });
  }

  const userId = req.user && req.user.id ? req.user.id : null;

  try {
    const result = await sequelize.transaction(async (transaction) => {
      const { row, revision } = await readRevision(transaction, true);

      const sent = intOr(body.revision, null);
      if (sent === null || sent !== revision) {
        const current = await readSet(transaction);
        return { conflict: true, revision, ...current };
      }

      const tabIdList = tabs.map(t => t.id);
      const snippetIdList = snippets.map(s => s.id);

      // Op.notIn с пустым списком в SQL превращается в NOT IN (NULL) и не
      // удаляет ничего — поэтому пустой случай разбираем отдельно.
      await CallCenterTab.destroy({
        where: tabIdList.length ? { id: { [Op.notIn]: tabIdList } } : {},
        transaction
      });
      await CallCenterSnippet.destroy({
        where: snippetIdList.length ? { id: { [Op.notIn]: snippetIdList } } : {},
        transaction
      });

      for (const tab of tabs) {
        await CallCenterTab.upsert({ ...tab, updatedBy: userId }, { transaction });
      }
      for (const snippet of snippets) {
        await CallCenterSnippet.upsert({ ...snippet, updatedBy: userId }, { transaction });
      }

      const next = revision + 1;
      row.value = next;
      row.changed('value', true);
      await row.save({ transaction });

      return { conflict: false, revision: next };
    });

    if (result.conflict) {
      return res.status(409).json({
        error: 'Набор изменили, пока вы правили. Страница перечитает его и покажет свежий.',
        revision: result.revision,
        tabs: result.tabs,
        snippets: result.snippets
      });
    }
    res.json({ revision: result.revision });
  } catch (err) {
    console.error('[call-center] сохранение набора:', err);
    res.status(500).json({ error: 'Не удалось сохранить набор' });
  }
});

module.exports = router;

// Разбор вынесен наружу ради тестов. Правило «карточка без своей вкладки
// выбрасывается» неочевидно, а цена ошибки здесь выше обычной: набор приходит
// целиком и целиком же перезаписывает справочник, которым пользуется смена.
module.exports.cleanTabs = cleanTabs;
module.exports.cleanSnippets = cleanSnippets;
