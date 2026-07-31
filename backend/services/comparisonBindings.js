'use strict';

/**
 * Связь колонки сравнения цен с клиникой парсера.
 *
 * Раньше связь держалась на совпадении строк: у источника было отдельное
 * «название в сравнениях», и колонка считалась его, если называлась так же
 * или начиналась с «<название> — ». Из-за этого у клиники было два имени,
 * человек путался, какое из них где, а переименование в парсере молча
 * отрывало колонку от цен.
 *
 * Теперь связь явная и лежит в самом сравнении:
 *
 *   price_comparisons."competitorBindings" =
 *     { "<имя колонки>": { "parserSourceId": 12, "filialId": 3 } }
 *
 * Имя колонки после этого — просто подпись: её видит человек, а цены находят
 * свою колонку по id. `filialId: null` означает «вся клиника» — в такую
 * колонку идут цены всех филиалов, а из нескольких берётся минимальная.
 *
 * Ключ объекта — то же имя, что и в price_comparison_items.prices, поэтому
 * привязка ничего не знает о самих ценах и не меняет их формат.
 */

/**
 * Привязки сравнения, разобранные по клиникам парсера.
 *
 * Колонки, которых уже нет в `competitors`, пропускаются: удаление колонки
 * на странице сравнения не обязано доходить до привязки мгновенно, а цены
 * в несуществующую колонку класть незачем.
 *
 * @returns {Map<number, Array<{ column: string, filialId: number|null }>>}
 */
function readBindings(comparison) {
  const columns = new Set(comparison?.competitors || []);
  const bindings = comparison?.competitorBindings || {};
  const bySource = new Map();

  for (const [column, binding] of Object.entries(bindings)) {
    if (!columns.has(column)) continue;

    const parserSourceId = Number(binding?.parserSourceId);
    if (!Number.isFinite(parserSourceId)) continue;

    const filialId = binding.filialId == null ? null : Number(binding.filialId);
    if (!bySource.has(parserSourceId)) bySource.set(parserSourceId, []);
    bySource.get(parserSourceId).push({
      column,
      filialId: Number.isFinite(filialId) ? filialId : null
    });
  }
  return bySource;
}

/** Клиники парсера, участвующие в этом сравнении. */
function boundSourceIds(comparison) {
  return [...readBindings(comparison).keys()];
}

/**
 * В какие колонки должна попасть цена конкурента.
 *
 * Колонок может быть несколько: если рядом с колонкой филиала заведена
 * колонка «вся клиника», цена филиала участвует и в ней — иначе минимум
 * по клинике считался бы не по всем филиалам.
 */
function columnsForRow(bySource, row) {
  const targets = bySource.get(Number(row.parserSourceId)) || [];
  const filialId = row.filialId == null ? null : Number(row.filialId);
  return targets
    .filter(target => target.filialId === null || target.filialId === filialId)
    .map(target => target.column);
}

/**
 * Оставить привязки только для существующих колонок.
 *
 * Вызывается при сохранении сравнения: колонку удаляют кнопкой «удалить
 * колонку», и отдельного действия «отвязать клинику» у человека нет.
 */
function pruneBindings(bindings, competitors) {
  const columns = new Set(competitors || []);
  const kept = {};
  for (const [column, binding] of Object.entries(bindings || {})) {
    if (columns.has(column)) kept[column] = binding;
  }
  return kept;
}

module.exports = { readBindings, boundSourceIds, columnsForRow, pruneBindings };
