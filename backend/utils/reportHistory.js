// Общий журналлер для встраиваемых страниц-таблиц (терапия, гинекология, скорая и т.п.).
// Пишет события изменений в «Журнал изменений» wiki-страницы (page_history),
// в которую встроена таблица. pageId страница передаёт сама (body/query/form).
const { Page, PageHistory } = require('../models');

function cleanText(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

// pageId wiki-страницы, в которую встроена таблица (передаётся клиентом в body/query/form)
function resolvePageId(req) {
  const raw = (req.body && req.body.pageId) || req.query.pageId || '';
  return String(raw || '').trim();
}

// Все заполненные поля записи → элементы журнала.
// side = 'to' (создание, зелёным) или 'from' (удаление, красным).
function fullEntryChanges(data, side, fieldLabels) {
  const changes = [];
  Object.keys(fieldLabels).forEach(field => {
    const val = cleanText((data || {})[field]);
    if (!val) return;
    changes.push({ field, label: fieldLabels[field], [side]: val });
  });
  return changes;
}

// Полный список полей записи для журнала редактирования (в порядке формы):
// изменённые — { from, to } (старое красным → новое зелёным),
// неизменённые непустые — { unchanged } (серым, для полноты картины).
function editChanges(oldData, newData, fieldLabels) {
  const changes = [];
  Object.keys(fieldLabels).forEach(field => {
    const from = cleanText((oldData || {})[field]);
    const to = cleanText((newData || {})[field]);
    if (from !== to) {
      changes.push({ field, label: fieldLabels[field], from, to });
    } else if (to) {
      changes.push({ field, label: fieldLabels[field], unchanged: to });
    }
  });
  return changes;
}

// Пишем событие в журнал изменений wiki-страницы (page_history).
// Никогда не роняем основную операцию: ошибки логирования только пишем в консоль.
// source — тип таблицы ('therapy' | 'gynecology' | 'ambulance'), event — тип события.
async function logReportHistory(req, { source, event, summary, changes }) {
  try {
    const pageId = resolvePageId(req);
    const userId = req.user && req.user.id;
    if (!pageId || !userId) return;

    const page = await Page.findByPk(pageId, { attributes: ['id'] });
    if (!page) return;

    await PageHistory.create({
      pageId,
      userId,
      action: 'updated',
      changesSummary: summary,
      metadata: {
        source,
        event,
        ...(changes && changes.length ? { changes } : {})
      }
    });
  } catch (err) {
    console.error(`[${source}] logReportHistory error:`, err && err.message);
  }
}

module.exports = { cleanText, resolvePageId, fullEntryChanges, editChanges, logReportHistory };
