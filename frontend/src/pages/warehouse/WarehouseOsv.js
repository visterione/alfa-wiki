import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, FileSpreadsheet, Info,
  Maximize2, Minimize2, RefreshCw, Search, Trash2, Upload, X,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';
import WarehouseOsvMapping from './WarehouseOsvMapping';
import WarehouseItemRules from './WarehouseItemRules';
import WarehousePlacement from './WarehousePlacement';

/**
 * Оборотно-сальдовая ведомость 1С: снимки по месяцам и дерево позиций.
 *
 * Экран намеренно показывает файл таким, какой он есть, — с деревом номенклатуры
 * 1С, а не с деревом кабинетов портала. Эти два дерева разные: в 1С группы
 * называются то по кабинету («Кабинет Хирурга»), то по назначению («Канцтовары»),
 * и перекладывать одно в другое на лету значит показывать выдумку. Сопоставление
 * с кабинетами — отдельная ручная работа, и до неё здесь честно видно исходник.
 *
 * Загрузка идёт в два шага: разобранный файл сначала лежит черновиком со
 * сравнением против прошлого месяца, и только потом становится снимком. Ошибку
 * выгрузки (не тот период, половина номенклатуры) в одношаговом импорте замечают
 * уже после того, как она стала данными.
 */

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const money = value => Number(value || 0).toLocaleString('ru-RU', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

// Количество бывает дробным: в ведомости лежат метры портьеры и миллилитры
// спирта. Хвост из нулей у штук при этом не нужен — он превращает «14» в «14,000»
// и мешает читать колонку.
const qty = value => {
  const number = Number(value || 0);
  return number % 1 === 0 ? number.toLocaleString('ru-RU') : number.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
};

const periodOf = row => `${MONTHS[(row.periodMonth || 1) - 1]} ${row.periodYear}`;

export default function WarehouseOsv({ access, tree, onReloadTree }) {
  const [sub, setSub] = useState('snapshot');
  const [imports, setImports] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [diff, setDiff] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(new Set());
  const fileRef = useRef(null);

  const canImport = Boolean(access?.capabilities?.canImportOsv);

  const loadList = useCallback(async (openId) => {
    setLoadingList(true);
    try {
      const { data } = await warehouseApi.osvImports();
      setImports(data);
      setSelectedId(previous => openId || previous || data[0]?.id || null);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить список снимков');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    if (!selectedId) { setSnapshot(null); setDiff(null); return; }
    let cancelled = false;
    setLoadingSnapshot(true);
    (async () => {
      try {
        const [snap, delta] = await Promise.all([
          warehouseApi.osvImport(selectedId, query ? { q: query } : undefined),
          warehouseApi.osvDiff(selectedId),
        ]);
        if (cancelled) return;
        setSnapshot(snap.data);
        setDiff(delta.data);
        setCollapsed(new Set());
      } catch (e) {
        if (!cancelled) toast.error(e.response?.data?.error || 'Не удалось открыть снимок');
      } finally {
        if (!cancelled) setLoadingSnapshot(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, query]);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const { data } = await warehouseApi.uploadOsv(form);
      toast.success(`Файл разобран: ${data.import.lineCount} строк`);
      if (data.sameFileAs) {
        toast('Такой же файл уже принят за другой период — проверьте, тот ли месяц выгрузили', { icon: '⚠️' });
      }
      await loadList(data.import.id);
      setSelectedId(data.import.id);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить файл');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      await warehouseApi.applyOsv(selectedId);
      toast.success('Снимок принят');
      await loadList(selectedId);
      const { data } = await warehouseApi.osvImport(selectedId);
      setSnapshot(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось применить снимок');
    } finally { setBusy(false); }
  };

  const remove = async (row) => {
    const label = row.status === 'applied'
      ? `Удалить принятый снимок за ${periodOf(row)}? Сравнение следующих месяцев будет считаться от более раннего.`
      : 'Удалить черновик?';
    if (!window.confirm(label)) return;
    setBusy(true);
    try {
      await warehouseApi.deleteOsv(row.id);
      if (row.id === selectedId) setSelectedId(null);
      await loadList();
      toast.success('Удалено');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось удалить');
    } finally { setBusy(false); }
  };

  const lines = snapshot?.lines || [];
  const head = snapshot?.import;

  // Свёрнутая группа прячет всю свою ветку: строки идут плоским списком в порядке
  // файла, поэтому достаточно пропускать всё, что глубже, до первой строки того
  // же или меньшего уровня.
  const visible = useMemo(() => {
    if (snapshot?.isSearch) return lines;
    const out = [];
    let hiddenAbove = null;
    for (const line of lines) {
      if (hiddenAbove !== null) {
        if (line.level > hiddenAbove) continue;
        hiddenAbove = null;
      }
      out.push(line);
      if (line.isGroup && collapsed.has(line.id)) hiddenAbove = line.level;
    }
    return out;
  }, [lines, collapsed, snapshot?.isSearch]);

  const toggle = id => setCollapsed(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const collapseAll = () => setCollapsed(new Set(lines.filter(l => l.isGroup).map(l => l.id)));

  // Обороты в выгрузке бывают пустыми: ведомость за текущий месяц приходит срезом,
  // где сальдо на начало равно сальдо на конец. Показывать в таком файле две
  // колонки нулей — значит заставлять читателя выяснять, ноль это или «нет данных».
  const hasTurnover = Number(head?.debitSum) !== 0 || Number(head?.creditSum) !== 0
    || Number(head?.debitQty) !== 0 || Number(head?.creditQty) !== 0;

  return (
    <div className="wh-osv">
      <div className="wh-assets__filters">
        <div>
          <div className="wh-panel__title"><FileSpreadsheet size={16} /> Ведомость 1С</div>
          <div className="wh-hint">
            Выгрузка по счёту МЦ.04 раз в месяц. Единственный источник, который заполняется автоматически.
          </div>
        </div>
        <button className="wh-btn wh-btn--ghost" onClick={() => loadList()} disabled={loadingList}>
          <RefreshCw size={14} /> Обновить
        </button>
        {canImport && (
          <>
            <input ref={fileRef} type="file" accept=".xlsx" hidden
                   onChange={e => upload(e.target.files?.[0])} />
            <button className="wh-btn wh-btn--primary" disabled={uploading}
                    onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> {uploading ? 'Разбираю…' : 'Загрузить XLSX'}
            </button>
          </>
        )}
      </div>

      {/* Снимок и разбор — два разных занятия: первое делают раз в месяц за пять
          минут, второе один раз за несколько часов. В одном экране они мешали бы
          друг другу.

          Словарь стоит третьим и отдельно, потому что это работа не над снимком, а
          над справочником: разметка слов переживает следующий месяц и следующую
          выгрузку, тогда как сопоставление веток с кабинетами привязано к
          конкретному дереву 1С. */}
      <div className="wh-subtabs">
        <button className={sub === 'snapshot' ? 'is-active' : ''} onClick={() => setSub('snapshot')}>
          Снимок
        </button>
        <button className={sub === 'placement' ? 'is-active' : ''} onClick={() => setSub('placement')}>
          Размещение
        </button>
        <button className={sub === 'mapping' ? 'is-active' : ''} onClick={() => setSub('mapping')}>
          Разбор
        </button>
        <button className={sub === 'dictionary' ? 'is-active' : ''} onClick={() => setSub('dictionary')}>
          Словарь предметов
        </button>
      </div>

      {/* Размещение стоит перед разбором, потому что в этом порядке и идёт
          работа: пока вещь не разложена по кабинетам, карточку ей создавать
          нельзя — инвентарный номер содержит код специальности отделения и после
          выдачи не меняется. */}
      {sub === 'placement' && (
        <WarehousePlacement access={access} tree={tree} onDone={onReloadTree} />
      )}

      {sub === 'mapping' && (
        <WarehouseOsvMapping access={access} tree={tree} onDone={onReloadTree} />
      )}

      {sub === 'dictionary' && <WarehouseItemRules access={access} />}

      {sub === 'snapshot' && (
        <div className="wh-osv__layout">
        <aside className="wh-osv__side">
          <div className="wh-subhead">Снимки</div>
          {loadingList && <div className="wh-table__loading"><div className="loading-spinner" /></div>}
          {!loadingList && !imports.length && (
            <div className="wh-empty">
              Ни одной выгрузки. Загрузите файл «ОСВ по счету МЦ.04 за … .xlsx».
            </div>
          )}
          {imports.map(row => (
            <button key={row.id}
                    className={`wh-osv__snap ${row.id === selectedId ? 'is-active' : ''}`}
                    onClick={() => setSelectedId(row.id)}>
              <div className="wh-osv__snap-head">
                <b>{periodOf(row)}</b>
                <span className={`wh-status wh-status--${row.status === 'applied' ? 'done' : 'open'}`}>
                  {row.status === 'applied' ? 'принят' : 'черновик'}
                </span>
              </div>
              <div className="wh-cell-sub">{money(row.closingSum)} ₽ · {qty(row.closingQty)} ед.</div>
              <div className="wh-cell-sub wh-muted">{row.leafCount} позиций · {row.account}</div>
            </button>
          ))}
        </aside>

        <section className="wh-osv__main">
          {loadingSnapshot && <div className="wh-table__loading"><div className="loading-spinner" /></div>}

          {!loadingSnapshot && !head && (
            <div className="wh-empty">Выберите снимок слева</div>
          )}

          {!loadingSnapshot && head && (
            <>
              <div className="wh-osv__cards">
                <Card title="Сумма на конец" value={`${money(head.closingSum)} ₽`} />
                <Card title="Количество" value={`${qty(head.closingQty)} ед.`} />
                <Card title="Позиций" value={head.leafCount} sub={`групп: ${head.groupCount}`} />
                <Card title="Файл" value={periodOf(head)} sub={head.fileName} />
              </div>

              {head.status === 'draft' && (
                <div className="wh-alert wh-alert--warning">
                  <AlertTriangle size={15} />
                  <div>
                    Черновик. Проверьте расхождения ниже и примите снимок — он станет
                    ведомостью за {periodOf(head)}.
                    {canImport && (
                      <div className="wh-form__actions">
                        <button className="wh-btn wh-btn--primary wh-btn--sm" onClick={apply} disabled={busy}>
                          <Check size={14} /> Принять за {periodOf(head)}
                        </button>
                        <button className="wh-btn wh-btn--danger-ghost wh-btn--sm"
                                onClick={() => remove(head)} disabled={busy}>
                          <Trash2 size={14} /> Удалить черновик
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(head.warnings || []).map((warning, index) => (
                <div key={index} className="wh-note wh-note--warn"><AlertTriangle size={15} /><div>{warning}</div></div>
              ))}

              {!hasTurnover && (
                <div className="wh-note wh-note--subtle">
                  <Info size={15} />
                  <div>
                    В файле не заполнены обороты за период — сальдо на начало равно сальдо
                    на конец. Это срез на дату, движения за месяц по нему не видны.
                  </div>
                </div>
              )}

              <DiffPanel diff={diff} />

              <div className="wh-tree__bar">
                <span className="wh-tree__bar-title">Дерево 1С</span>
                <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={() => setCollapsed(new Set())}>
                  <Maximize2 size={14} /> Раскрыть всё
                </button>
                <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={collapseAll}>
                  <Minimize2 size={14} /> Свернуть всё
                </button>
                <div className="wh-search">
                  <Search size={14} />
                  <input value={search} placeholder="Найти позицию…"
                         onChange={e => setSearch(e.target.value)}
                         onKeyDown={e => { if (e.key === 'Enter') setQuery(search.trim()); }} />
                  {query && (
                    <button className="wh-icon-btn" onClick={() => { setSearch(''); setQuery(''); }}>
                      <X size={14} />
                    </button>
                  )}
                </div>
                <span className="wh-tree__bar-count">
                  {snapshot.isSearch
                    ? `найдено ${lines.length}`
                    : `видно ${visible.length} из ${lines.length} строк`}
                </span>
              </div>

              <div className="wh-table-wrap wh-table-wrap--tall">
                <table className="wh-table wh-table--compact">
                  <thead>
                    <tr>
                      <th>Номенклатура</th>
                      {snapshot.isSearch && <th>Путь в 1С</th>}
                      <th className="wh-num">Кол-во</th>
                      {hasTurnover && <th className="wh-num">Приход</th>}
                      {hasTurnover && <th className="wh-num">Расход</th>}
                      <th className="wh-num">Цена за ед.</th>
                      <th className="wh-num">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(line => {
                      const isCollapsed = line.isGroup && collapsed.has(line.id);
                      return (
                        <tr key={line.id}
                            className={line.isGroup ? 'wh-tree__group' : 'wh-tree__leaf'}
                            onClick={line.isGroup ? () => toggle(line.id) : undefined}>
                          <td className="wh-tree__cell"
                              style={{ paddingLeft: 10 + (snapshot.isSearch ? 0 : line.level * 18) }}>
                            {line.isGroup ? (
                              <button className="wh-tree__toggle" tabIndex={-1}
                                      title={isCollapsed ? 'Раскрыть' : 'Свернуть'}>
                                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                              </button>
                            ) : <span className="wh-tree__bullet" />}
                            <span className={line.isGroup ? 'wh-tree__label' : ''}>{line.name}</span>
                            {isCollapsed && <span className="wh-tree__hint">свёрнуто</span>}
                          </td>
                          {snapshot.isSearch && <td className="wh-muted">{line.pathText || '—'}</td>}
                          <td className="wh-num">{qty(line.closingQty)}</td>
                          {hasTurnover && <td className="wh-num">{Number(line.debitQty) ? qty(line.debitQty) : '—'}</td>}
                          {hasTurnover && <td className="wh-num">{Number(line.creditQty) ? qty(line.creditQty) : '—'}</td>}
                          <td className="wh-num wh-muted">{line.isGroup || !line.unitCost ? '' : money(line.unitCost)}</td>
                          <td className="wh-num">{money(line.closingSum)}</td>
                        </tr>
                      );
                    })}
                    {!visible.length && (
                      <tr>
                        <td colSpan={3 + (hasTurnover ? 2 : 0) + (snapshot.isSearch ? 1 : 0)}
                            className="wh-empty">Ничего не найдено</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={snapshot.isSearch ? 2 : 1}><b>ИТОГО ПО ФАЙЛУ</b></td>
                      <td className="wh-num"><b>{qty(head.closingQty)}</b></td>
                      {hasTurnover && <td className="wh-num"><b>{qty(head.debitQty)}</b></td>}
                      {hasTurnover && <td className="wh-num"><b>{qty(head.creditQty)}</b></td>}
                      <td />
                      <td className="wh-num"><b>{money(head.closingSum)}</b></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {head.status === 'applied' && canImport && (
                <div className="wh-form__actions">
                  <button className="wh-btn wh-btn--danger-ghost wh-btn--sm"
                          onClick={() => remove(head)} disabled={busy}>
                    <Trash2 size={14} /> Удалить снимок
                  </button>
                </div>
              )}
            </>
          )}
        </section>
        </div>
      )}
    </div>
  );
}

function Card({ title, value, sub }) {
  return (
    <div className="wh-minicard">
      <div className="wh-minicard__head">{title}</div>
      <div className="wh-minicard__value">{value}</div>
      {sub && <div className="wh-minicard__sub">{sub}</div>}
    </div>
  );
}

/**
 * Расхождения с прошлым месяцем. Главный смысл импорта: сами по себе цифры мало
 * что говорят, а «появилось 12 позиций, пропало 3, у 40 изменилось количество» —
 * это и есть месячный отчёт о движении имущества, которого в файле нет.
 */
function DiffPanel({ diff }) {
  const [open, setOpen] = useState(null);
  if (!diff) return null;

  if (!diff.base) {
    return (
      <div className="wh-note wh-note--subtle">
        <Info size={15} />
        <div>Это первая выгрузка — сравнивать не с чем. Расхождения появятся со следующего месяца.</div>
      </div>
    );
  }

  const sections = [
    { key: 'added', label: 'Появилось', rows: diff.added, count: diff.counts.added },
    { key: 'removed', label: 'Пропало', rows: diff.removed, count: diff.counts.removed },
    { key: 'changed', label: 'Изменилось', rows: diff.changed, count: diff.counts.changed },
  ];
  const total = sections.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="wh-panel">
      <div className="wh-panel__head">
        <div className="wh-panel__title">
          Против {periodOf(diff.base)}
          <span className="wh-count">{total}</span>
        </div>
        <div className="wh-panel__actions">
          {sections.map(section => (
            <button key={section.key}
                    className={`wh-btn wh-btn--sm ${open === section.key ? 'wh-btn--primary' : 'wh-btn--secondary'}`}
                    disabled={!section.count}
                    onClick={() => setOpen(open === section.key ? null : section.key)}>
              {section.label}: {section.count}
            </button>
          ))}
        </div>
      </div>
      {open && (
        <div className="wh-panel__body">
          <div className="wh-table-wrap">
            <table className="wh-table wh-table--compact">
              <thead>
                <tr>
                  <th>Позиция</th><th>Путь в 1С</th>
                  {open === 'changed' && <th className="wh-num">Было</th>}
                  <th className="wh-num">{open === 'removed' ? 'Было' : 'Стало'}</th>
                  {open === 'changed' && <th className="wh-num">Δ суммы</th>}
                </tr>
              </thead>
              <tbody>
                {sections.find(s => s.key === open).rows.map(row => (
                  <tr key={row.lineKey}>
                    <td>{row.name}</td>
                    <td className="wh-muted">{row.pathText || '—'}</td>
                    {open === 'changed' && <td className="wh-num">{qty(row.previousQty)}</td>}
                    <td className="wh-num">{qty(row.closingQty)}</td>
                    {open === 'changed' && (
                      <td className={`wh-num ${row.sumDelta < 0 ? 'wh-danger' : 'wh-ok'}`}>
                        {row.sumDelta > 0 ? '+' : ''}{money(row.sumDelta)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Список обрезан сервером: в первый месяц «появилось» — это вся
              ведомость целиком, и выкладывать три тысячи строк незачем. */}
          {sections.find(s => s.key === open).count > sections.find(s => s.key === open).rows.length && (
            <div className="wh-hint">
              Показаны первые {sections.find(s => s.key === open).rows.length} из{' '}
              {sections.find(s => s.key === open).count}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
