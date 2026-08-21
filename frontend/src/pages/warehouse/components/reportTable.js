import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import Pagination from './Pagination';

/**
 * Таблица отчёта и всё, что превращает сырую строку в ячейку.
 *
 * Вынесено из WarehouseReports отдельным модулем, когда появились сохранённые
 * отчёты: сохранённый отчёт — это ровно та же таблица, только строки к ней
 * приходят не из расчёта, а из базы. Держать вторую копию разбора ячеек значило
 * бы, что через месяц один и тот же отчёт выглядит по-разному в зависимости от
 * того, построили его сейчас или открыли из сохранённых.
 *
 * Свёрнутые узлы дерева живут снаружи: кнопки «свернуть до отделений» стоят в
 * полосе фильтров, а не над таблицей, и владеть этим состоянием таблица не может.
 */

export const isNum = t => ['money', 'qty', 'number', 'percent', 'share', 'delta', 'deviation'].includes(t);

const STOCK_STATUS = {
  below: { zone: 'red', label: 'ниже минимума' },
  near: { zone: 'yellow', label: 'близко к минимуму' },
  ok: { zone: 'green', label: 'норма' },
  unknown: { zone: 'none', label: 'минимум не задан' },
};
const ASSET_STATUS = {
  in_use: 'В работе', maintenance: 'На ТО', repair: 'В ремонте',
  storage: 'На хранении', written_off: 'Списано', reserved: 'Зарезервировано',
};

/**
 * Значение ячейки. Псевдоколонки (ключ с подчёркиванием) собираются из нескольких
 * полей строки — так в отчёт попадают «Локация» одной колонкой вместо трёх и
 * «Δ количества» абсолютным значением вместе с процентом, как в макетах ТЗ.
 */
function cell(row, col, ctx = {}) {
  switch (col.key) {
    case '_asset': return row.asset ? `${row.asset.name} ${row.asset.model || ''}` : '—';
    case '_assetNumber': return row.asset?.inventoryNumber || '—';
    case '_assetName': return [row.asset?.name, row.asset?.model].filter(Boolean).join(' ') || '—';
    case '_room': return row.asset?.room ? `Каб. ${row.asset.room.number}` : '—';
    case '_contractor': return row.contractor?.name || '—';
    case '_nameModel': return [row.name, row.model].filter(Boolean).join(', ') || '—';
    case '_categoryOkof': return [row.categoryName, row.okof].filter(Boolean).join(' / ') || '—';
    case '_location': return locationPath(row);
    case '_forecast': return forecastText(row);
    default: break;
  }

  // Отчёт по ТО: справочные значения приходят кодами, а не подписями.
  if (row.number && ['type', 'status', 'result'].includes(col.key)) {
    return col.key === 'type' ? maintType(row.type)
      : col.key === 'status' ? maintStatus(row.status)
      : maintResult(row.result);
  }

  const value = row[col.key];

  if (col.type === 'zone') {
    return <span className={`wh-dot wh-dot--zone-${value || 'none'}`} title={zoneTitle(value)} />;
  }
  if (col.type === 'stockStatus') {
    const s = STOCK_STATUS[value];
    if (!s || row.__isGroup) return null;
    return <span className={`wh-zonebadge wh-zonebadge--${s.zone}`}>{s.label}</span>;
  }
  if (col.type === 'assetStatus') return ASSET_STATUS[value] || value || '—';
  if (col.type === 'deprMethod') {
    return value === 'reducing' ? 'Уменьшаемого остатка' : value === 'linear' ? 'Линейный' : '—';
  }
  if (col.type === 'abcCell') {
    return value ? <span className={`wh-abc wh-abc--${value[0]}`}>{value}</span> : '—';
  }
  if (col.type === 'signature') {
    return row.signedAt
      ? <span className="wh-ok" title={`Подписано ${format(row.signedAt, 'datetime')}`}>✓ подписано</span>
      : <span className="wh-muted">✗ без подписи</span>;
  }
  if (col.type === 'delta') {
    // Абсолютное значение и процент вместе: «+18 %» без штук не говорит, много
    // это или две упаковки.
    if (row.deltaQty === null || row.deltaQty === undefined) return '—';
    const abs = Number(row.deltaQty);
    const pct = row.deltaQtyPct;
    return `${abs > 0 ? '+' : ''}${abs.toLocaleString('ru-RU', { maximumFractionDigits: 3 })}`
      + (pct === null || pct === undefined ? '' : ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)} %)`);
  }
  if (col.type === 'deviation') {
    if (value === null || value === undefined) return '—';
    const n = Number(value);
    return `${n > 0 ? '+' : ''}${n}${n > 0 ? (row.isOverdue ? ' 🔴' : ' ⚠') : ' ✓'}`;
  }
  if (col.type === 'assetLink' && value && ctx.onOpenAsset) {
    const assetId = row.assetId || row.id || row.asset?.id;
    if (assetId) {
      return (
        <button className="wh-btn wh-btn--link wh-mono"
                onClick={e => { e.stopPropagation(); ctx.onOpenAsset(assetId); }}>
          {value}
        </button>
      );
    }
  }
  // Причина отсутствия показателя объясняется подсказкой, а не отдельной
  // колонкой: колонка «почему нет» была почти всегда пустой и занимала ширину.
  if (col.key === 'normDeviationPct' && (value === null || value === undefined) && row.missingReason) {
    return <span className="wh-muted" title={row.missingReason}>нет данных</span>;
  }

  // В строке-группе показателя позиции нет и быть не может: код, единица, доля,
  // минимум и статус относятся к номенклатуре, а не к этажу или кабинету.
  // Прочерк в каждой такой ячейке складывался в столбцы прочерков через весь
  // отчёт и читался как «данные потерялись», хотя терять там нечего.
  if (row.__isGroup && (value === null || value === undefined || value === '')) return null;

  return format(value, col.type);
}

/**
 * Строка для выгрузки. Числовые колонки отдаются числами — их форматирует Excel;
 * всё производное сводится к тексту, тому же, что видно на экране.
 */
const RAW_TYPES = ['money', 'qty', 'number', 'percent', 'share', 'date', 'datetime', 'deviation'];

export function exportRow(row, columns) {
  const out = { __level: row.__level, __isGroup: row.__isGroup, __key: row.__key };
  for (const col of columns) {
    if (!col.key.startsWith('_') && (RAW_TYPES.includes(col.type) || !col.type)) {
      out[col.key] = row[col.key];
      continue;
    }
    const value = cell(row, col);
    // Ячейки-индикаторы возвращают разметку — в файл идёт их текстовый смысл.
    out[col.key] = typeof value === 'object' && value !== null
      ? plainOf(row, col)
      : value;
  }
  return out;
}

function plainOf(row, col) {
  if (col.type === 'zone') return zoneTitle(row.zone);
  if (col.type === 'stockStatus') return STOCK_STATUS[row.status]?.label ?? null;
  if (col.type === 'abcCell') return row.cell || null;
  if (col.type === 'signature') return row.signedAt ? 'подписано' : 'без подписи';
  if (col.type === 'assetLink') return row[col.key] ?? null;
  return row[col.key] ?? null;
}

function locationPath(row) {
  return [row.departmentName, row.roomNumber ? `Каб. ${row.roomNumber}` : null, row.storageName]
    .filter(Boolean).join(' / ') || '—';
}

function forecastText(row) {
  if (row.willConsumeInTime === null || row.willConsumeInTime === undefined) return 'нет истории расхода';
  return row.willConsumeInTime
    ? `✓ успеем${row.exhaustionDate ? ` (до ${format(row.exhaustionDate, 'date')})` : ''}`
    : `✗ не успеем${row.exhaustionDate ? ` (расчёт до ${format(row.exhaustionDate, 'date')})` : ''}`;
}

const zoneTitle = z => ({
  red: 'Просрочено или ≤ 7 дней', orange: '8–30 дней',
  yellow: '31–90 дней', green: 'Больше 90 дней',
}[z] || 'Зона не определена');

export function format(v, type) {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'money') return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'qty') return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  if (type === 'number') return Number(v).toLocaleString('ru-RU');
  if (type === 'percent') return `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)} %`;
  // Доля — не изменение: знак «+» перед ней читался бы как рост.
  if (type === 'share') return `${Number(v).toFixed(1)} %`;
  if (type === 'date') return new Date(v).toLocaleDateString('ru-RU');
  if (type === 'datetime') return new Date(v).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  return String(v);
}

function rowClass(row) {
  const zone = row.zone || row.status || row.stockStatus;
  if (['red', 'below'].includes(zone)) return 'wh-row--red';
  if (zone === 'orange') return 'wh-row--orange';
  if (['yellow', 'near'].includes(zone)) return 'wh-row--yellow';
  if (row.isOverdue) return 'wh-row--red';
  if (row.fullyDepreciatedInUse) return 'wh-row--yellow';
  return '';
}


export const maintType = t => ({ maintenance: 'ТО', verification: 'Поверка', calibration: 'Калибровка', dosimetry: 'Дозиметрия', inspection: 'Осмотр' }[t] || t);
const maintStatus = s => ({ planned: 'Запланирован', in_progress: 'В работе', done: 'Выполнен', overdue: 'Просрочен', cancelled: 'Отменён' }[s] || s);
const maintResult = r => ({ normal: 'Норма', with_remarks: 'С замечаниями', failed: 'Не пройдено' }[r] || '—');

/**
 * Строки, видимые в дереве: узел скрыт, если свёрнут любой из его предков.
 * Предки определяются по префиксу ключа — он собран из пути, поэтому сравнения
 * строк достаточно и обходить дерево заново не нужно.
 */
function visibleRowsOf(items, hierarchical, collapsed) {
  if (!hierarchical || !collapsed.size) return items;

  // Строка видна, если не свёрнут ни один её строгий предок. Сам свёрнутый узел
  // остаётся виден — иначе его нечем было бы раскрыть обратно.
  const hiddenUnder = (key) => {
    if (!key) return false;
    for (const c of collapsed) {
      if (key === c || key.startsWith(c + '/')) return true;
    }
    return false;
  };

  return items.filter(row => {
    if (row.__isGroup) {
      // Для группы отсекаем сам её ключ: свёрнут — но виден.
      const parent = row.__key.includes('/') ? row.__key.slice(0, row.__key.lastIndexOf('/')) : null;
      return !hiddenUnder(parent) && !collapsed.has(parent);
    }
    return !hiddenUnder(row.__parentKey);
  });
}

/**
 * Подписи узлов дерева по ключу — для строки «продолжение» вверху страницы.
 * Собираются один раз по всему отчёту, а не ищутся перебором на каждую страницу.
 */
function groupLabels(items) {
  const out = new Map();
  for (const row of items) if (row.__isGroup) out.set(row.__key, row.label);
  return out;
}

/**
 * Ветка, внутри которой начинается страница: «МЦ Альфа / Главный корпус / 1 этаж».
 *
 * Нужна только в дереве и только там, где страница начинается не с начала ветки.
 * Без неё вторая страница оборотки открывается посреди чужих кабинетов, и
 * понять, чьи это остатки, нельзя ничем, кроме возврата на страницу назад.
 */
function branchOf(row, labels) {
  if (!row) return null;
  const key = row.__isGroup
    ? (row.__key?.includes('/') ? row.__key.slice(0, row.__key.lastIndexOf('/')) : null)
    : row.__parentKey;
  if (!key) return null;

  const parts = key.split('/');
  const path = [];
  let prefix = '';
  for (const part of parts) {
    prefix = prefix ? `${prefix}/${part}` : part;
    const label = labels.get(prefix);
    if (label) path.push(label);
  }
  return path.length ? path.join(' / ') : null;
}

export function ReportTable({
  columns, items = [], totals, hierarchical, loading, hidden,
  collapsed, onToggleNode, onOpenAsset, emptyText,
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  const visibleRows = useMemo(
    () => visibleRowsOf(items, hierarchical, collapsed || new Set()),
    [items, hierarchical, collapsed],
  );

  // Новый расчёт — снова с первой страницы: иначе отчёт за другой период
  // открывался бы посередине, на странице, оставшейся от прошлого.
  useEffect(() => { setPage(1); }, [items]);

  // Свернуть ветку — значит укоротить список; страницы за его концом больше нет,
  // и оставаться на ней нельзя.
  const pages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const current = Math.min(page, pages);
  const pageRows = visibleRows.slice((current - 1) * pageSize, current * pageSize);

  const labels = useMemo(() => (hierarchical ? groupLabels(items) : new Map()), [items, hierarchical]);
  const branch = hierarchical && !loading ? branchOf(pageRows[0], labels) : null;

  return (
    <div hidden={hidden}>
    <div className="wh-table-wrap wh-table-wrap--tall">
      <table className="wh-table wh-table--compact">
        <thead>
          <tr>{columns.map(c => (
            <th key={c.key} className={isNum(c.type) ? 'wh-num' : ''}>{c.title}</th>
          ))}</tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={columns.length} className="wh-table__loading">
              <div className="loading-spinner" />
            </td></tr>
          )}
          {/* Страница открылась посреди ветки — говорим, какой именно. Строка
              стоит внутри таблицы, а не над ней: она относится к содержимому и
              должна уезжать вместе с ним при прокрутке вбок. */}
          {branch && (
            <tr className="wh-tree__branch">
              <td colSpan={columns.length}>Продолжение: {branch}</td>
            </tr>
          )}
          {!loading && pageRows.map((row, i) => {
            const hasChildren = row.__isGroup;
            const isCollapsed = hasChildren && collapsed?.has(row.__key);
            return (
              <tr key={row.__key || `${row.__parentKey || ''}-${i}`}
                  className={`${rowClass(row)} ${hasChildren ? 'wh-tree__group' : ''} ${hierarchical && !hasChildren ? 'wh-tree__leaf' : ''}`}
                  onClick={hasChildren && onToggleNode ? () => onToggleNode(row.__key) : undefined}>
                {columns.map(c => {
                  if (c.type === 'tree') {
                    // Номенклатура прижата к левому краю ячейки: в ОСВ пять
                    // уровней локаций, и лист шестым отступом оказывался у
                    // середины колонки — длинным названиям оставалась пара
                    // сантиметров. Отступы нужны, чтобы читалась вложенность
                    // локаций, а лист вложенности не продолжает: он последний и
                    // виден по обычному начертанию подписи против полужирного
                    // у групп.
                    const isLeaf = hierarchical && !hasChildren;
                    const indent = isLeaf ? 0 : (row.__level || 0);
                    return (
                      <td key={c.key} className="wh-tree__cell"
                          style={{ paddingLeft: 10 + indent * 18 }}>
                        {/* Стрелка — указатель состояния, а не мишень: сворачивает
                            строка целиком, поэтому кнопка выведена из обхода табом
                            и не ловит клик сама. */}
                        {hasChildren ? (
                          <button className="wh-tree__toggle" tabIndex={-1}
                                  title={isCollapsed ? 'Раскрыть' : 'Свернуть'}>
                            {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                          </button>
                        ) : isLeaf ? null : <span className="wh-tree__bullet" />}
                        <span className={hasChildren ? 'wh-tree__label' : ''}>{row.label}</span>
                        {isCollapsed && <span className="wh-tree__hint">свёрнуто</span>}
                      </td>
                    );
                  }
                  return (
                    <td key={c.key} className={isNum(c.type) ? 'wh-num' : ''}>
                      {cell(row, c, { onOpenAsset })}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {!loading && !visibleRows.length && (
            <tr><td colSpan={columns.length} className="wh-empty">{emptyText}</td></tr>
          )}
        </tbody>
        {/* Итог — по всему отчёту, а не по странице: он и в выгрузке такой же, и
            складывать страницы глазами никто не должен. */}
        {totals && (
          <tfoot>
            <tr>
              {columns.map((c, i) => (
                <td key={c.key} className={isNum(c.type) ? 'wh-num' : ''}>
                  {i === 0 ? <b>ИТОГО</b>
                    : totals[c.key] !== undefined
                      ? <b>{format(totals[c.key], c.type)}</b>
                      : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>

    {/* Пока отчёт не построен, считать нечего — и подпись «Нет данных» под
        пустой таблицей повторяла бы то, что в ней и так написано. */}
    {!loading && visibleRows.length > 0 && (
      <Pagination page={current} pageSize={pageSize} total={visibleRows.length}
                  onPage={setPage}
                  onPageSize={size => { setPageSize(size); setPage(1); }}
                  unit="строк" />
    )}
    </div>
  );
}
