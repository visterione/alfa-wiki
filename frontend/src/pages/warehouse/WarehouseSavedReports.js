import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Search, ArrowLeft, Trash2, FileSpreadsheet, FileText,
  Minimize2, Maximize2, ListTree, FolderTree, AlertTriangle,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { ReportTable, exportRow } from './components/reportTable';
import ReportsNav from './components/ReportsNav';
import Pagination from './components/Pagination';
import { REPORT_GROUPS, REPORT_TITLES, allowedReports } from './WarehouseReports';

/**
 * Архив — хранилище снимков отчётов, и только оно.
 *
 * Здесь намеренно нет ни статистики, ни сводок, ни графиков: любой показатель на
 * этом экране пришлось бы считать по снимкам, снятым в разное время и по разным
 * отборам, и он был бы неправдой. Задача вкладки — открыть то, что сохранили, и
 * выгрузить его файлом.
 *
 * Разложены снимки по видам отчётов тем же боковым списком, что и во вкладке
 * «Отчёты»: человек приходит сюда за оборотно-сальдовой ведомостью за март, а не
 * за «чем-нибудь сохранённым», и общая куча из всех видов заставляла бы искать
 * глазами то, что делит один щелчок. Список повторяет соседнюю вкладку целиком,
 * включая порядок и отчёты без единого снимка: две вкладки с одинаковой на вид
 * панелью, но разным составом пунктов, читаются как разные разделы, а пустой
 * отчёт в коротком списке нельзя было даже найти глазами, чтобы убедиться, что
 * снимков по нему правда нет.
 *
 * Отбор, поиск и страницы считает сервер. Архив копится годами, и то, что не
 * попало в первую сотню, иначе нельзя было найти вовсе.
 *
 * Снимок открывается вместо списка, а не рядом с ним: у отчёта пятнадцать колонок
 * и дерево локаций, и половины ширины ему не хватает. Боковой список при этом
 * остаётся на месте — из снимка видно, где ты находишься.
 *
 * В коде и в базе это по-прежнему «сохранённые отчёты» (warehouse_saved_reports):
 * «Архив» — название вкладки, а не отдельная сущность.
 */

export default function WarehouseSavedReports({ access, onOpenAsset }) {
  const { user } = useAuth();
  const isAllowed = useMemo(() => allowedReports(access), [access]);

  // Открытый вид отчёта — первый доступный, как и во вкладке «Отчёты»: жёсткая
  // «оборотка» встречала бы отказом того, кому она закрыта.
  const [activeKey, setActiveKey] = useState(() => {
    for (const g of REPORT_GROUPS) {
      for (const k of g.keys) if (isAllowedStatic(access, k)) return k;
    }
    return 'turnover';
  });
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [state, setState] = useState({ loading: true, items: [], total: 0 });
  const [openId, setOpenId] = useState(null);

  // Ввод в поиске не бьёт по серверу на каждую букву: запрос уходит, когда
  // человек остановился. Полсекунды — примерно пауза между словами.
  const [needle, setNeedle] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { setNeedle(q.trim()); setPage(1); }, 400);
    return () => clearTimeout(timer);
  }, [q]);

  const load = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true }));
    try {
      const { data } = await warehouseApi.savedReports({
        reportKey: activeKey, q: needle || undefined, page, limit: pageSize,
      });
      setState({ loading: false, items: data.items || [], total: data.total || 0 });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить архив');
      setState({ loading: false, items: [], total: 0 });
    }
  }, [activeKey, needle, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  const remove = async (row) => {
    if (!window.confirm(`Удалить сохранённый отчёт «${row.title}»? Снимок не восстановить.`)) return;
    try {
      await warehouseApi.deleteSavedReport(row.id);
      toast.success('Снимок удалён из архива');
      if (openId === row.id) setOpenId(null);
      // Удалили последний на странице — уходим на предыдущую, иначе экран
      // показывает пустоту там, где записи были секунду назад.
      if (state.items.length === 1 && page > 1) setPage(page - 1);
      else await load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось удалить');
    }
  };

  // Удалять может автор — и администратор портала, у которого этот же признак
  // проверяет сервер. Клиент прячет кнопку, решение принимает бэкенд.
  const canRemove = row => Boolean(user?.isAdmin || (row.createdBy && row.createdBy === user?.id));

  return (
    <div className="wh-reports">
      <ReportsNav groups={REPORT_GROUPS} titles={REPORT_TITLES} isVisible={isAllowed}
                  active={activeKey}
                  onSelect={k => {
                    setActiveKey(k);
                    setOpenId(null);
                    setQ('');
                    setPage(1);
                  }} />

      <div className="wh-reports__main wh-saved" key={openId || activeKey}>
        {openId ? (
          <SavedReportView id={openId} onBack={() => setOpenId(null)} onOpenAsset={onOpenAsset} />
        ) : (
          <>
            {/* Поиск стоит в одной строке с названием, а не отдельной полосой
                фильтров: фильтр здесь один, и целая панель ради одного поля
                занимала бы строку впустую. */}
            <div className="wh-reports__head">
              <h2>{REPORT_TITLES[activeKey] || 'Снимки отчётов'}</h2>
              <div className="wh-search wh-saved__search">
                <Search size={15} />
                <input placeholder="Название, примечание, отбор, кто сохранил…"
                       value={q} onChange={e => setQ(e.target.value)} />
              </div>
            </div>

            <div className="wh-table-wrap wh-table-wrap--tall">
              <table className="wh-table wh-table--compact">
                <thead>
                  <tr>
                    <th>Снимок</th>
                    <th>Период</th>
                    <th>Отбор</th>
                    <th className="wh-num">Строк</th>
                    <th>Сохранил</th>
                    <th>Когда</th>
                    <th style={{ width: 36 }} />
                  </tr>
                </thead>
                <tbody>
                  {state.loading && (
                    <tr><td colSpan={7} className="wh-table__loading">
                      <div className="loading-spinner" />
                    </td></tr>
                  )}
                  {!state.loading && state.items.map(row => (
                    <tr key={row.id} className="wh-table__row" onClick={() => setOpenId(row.id)}>
                      <td>
                        <div className="wh-cell-main">{row.title}</div>
                        {row.note && <div className="wh-cell-sub">{row.note}</div>}
                      </td>
                      <td className="wh-cell-sub">{row.params?.periodLabel || '—'}</td>
                      <td className="wh-cell-sub">{row.params?.filterLabel || 'Вся сеть'}</td>
                      <td className="wh-num">{Number(row.rowCount).toLocaleString('ru-RU')}</td>
                      <td className="wh-cell-sub">{row.author?.displayName || '—'}</td>
                      <td className="wh-cell-sub">{fmtDateTime(row.createdAt)}</td>
                      <td className="wh-num">
                        {canRemove(row) && (
                          <button className="wh-icon-btn" title="Удалить снимок"
                                  onClick={e => { e.stopPropagation(); remove(row); }}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!state.loading && !state.items.length && (
                    <tr><td colSpan={7} className="wh-empty">
                      {needle
                        ? 'По условию ничего не найдено'
                        : access?.capabilities?.canSaveReports
                          ? 'Снимков по этому отчёту пока нет. Постройте его во вкладке «Отчёты» и сохраните — «Действия» → «Сохранить в архив».'
                          : 'Снимков по этому отчёту пока нет'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Пагинация показывается всегда, когда снимки есть: она же сообщает,
                сколько их всего — под таблицей это первое, о чём спрашивают. */}
            {(state.total > 0 || page > 1) && (
              <Pagination page={page} pageSize={pageSize} total={state.total}
                          onPage={setPage}
                          onPageSize={size => { setPageSize(size); setPage(1); }}
                          unit="снимков" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Тот же признак доступа, что и allowedReports, но вызываемый до первого
 * рендера: начальное значение useState считается один раз, и заводить ради него
 * мемоизированную функцию не из чего.
 */
function isAllowedStatic(access, key) {
  return allowedReports(access)(key);
}

/**
 * Просмотр снимка. Таблица та же, что и у свежесобранного отчёта, — вплоть до
 * дерева и подытогов: колонки и строки лежат в снимке, а разбирает их общий
 * компонент, поэтому один и тот же отчёт выглядит одинаково независимо от того,
 * построили его сейчас или открыли из сохранённых.
 */
function SavedReportView({ id, onBack, onOpenAsset }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    warehouseApi.savedReport(id)
      .then(({ data: res }) => {
        if (!alive) return;
        setData(res);
        // Места хранения сворачиваем сразу, как и в свежем отчёте: полностью
        // раскрытое дерево на тысячу строк читать невозможно.
        if (res.payload?.hierarchical) {
          const next = new Set();
          for (const row of res.payload.items || []) {
            if (row.__isGroup && row.__levelKey === 'storage') next.add(row.__key);
          }
          setCollapsed(next);
        }
      })
      .catch(e => { if (alive) setFailed(e.response?.data?.error || 'Не удалось открыть отчёт'); });
    return () => { alive = false; };
  }, [id]);

  const toggleNode = (key) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const collapseAll = (levelKey) => {
    const next = new Set();
    for (const row of data?.payload?.items || []) {
      if (row.__isGroup && (!levelKey || row.__levelKey === levelKey)) next.add(row.__key);
    }
    setCollapsed(next);
  };

  const doExport = async (format) => {
    setExporting(true);
    try {
      const { data: blob } = await warehouseApi.exportReport({
        format,
        code: data.code,
        // Шапку берём из снимка: она описывает тот расчёт, а не сегодняшний день.
        header: data.payload.header || { title: data.title, generatedAt: data.createdAt },
        items: (data.payload.items || []).map(row => exportRow(row, data.columns)),
        totals: data.payload.totals || null,
        columns: data.columns,
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${data.code}.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error('Не удалось выгрузить');
    } finally {
      setExporting(false);
    }
  };

  if (failed) {
    return (
      <>
        <button className="wh-btn wh-btn--ghost" onClick={onBack}><ArrowLeft size={15} /> К списку</button>
        <div className="wh-alert wh-alert--warning"><AlertTriangle size={15} /><div>{failed}</div></div>
      </>
    );
  }
  if (!data) return <div className="wh-table__loading"><div className="loading-spinner" /></div>;

  const hierarchical = Boolean(data.payload?.hierarchical);

  return (
    <>
      <div className="wh-reports__head wh-saved__viewhead">
        <button className="wh-icon-btn" title="К списку" onClick={onBack}><ArrowLeft size={16} /></button>
        <div>
          <h2>{data.title}</h2>
          {/* Снимок — то, что было, а не то, что есть, и дата стоит прямо под
              названием. Плашкой .wh-note это сказать нельзя: поясняющие плашки в
              модуле скрыты правилом стилей. */}
          <div className="wh-modal__sub">
            Снимок на {fmtDateTime(data.createdAt)} · не пересчитывается
          </div>
        </div>
      </div>

      <div className="wh-reports__filters">
        <div className="wh-field">
          <label>Период</label>
          <div className="wh-cell-sub">{data.params?.periodLabel || '—'}</div>
        </div>
        <div className="wh-field">
          <label>Отбор</label>
          <div className="wh-cell-sub">{data.params?.filterLabel || 'Вся сеть'}</div>
        </div>
        <div className="wh-field">
          <label>Сохранил</label>
          <div className="wh-cell-sub">
            {data.author?.displayName || '—'}, {fmtDateTime(data.createdAt)}
          </div>
        </div>
        {hierarchical && (
          <div className="wh-field wh-reports__tree-ctl">
            <label>Дерево</label>
            <div className="wh-btn-group">
              <button className="wh-icon-btn" title="Раскрыть всё"
                      onClick={() => setCollapsed(new Set())}>
                <Maximize2 size={15} />
              </button>
              <button className="wh-icon-btn" title="Свернуть до кабинетов"
                      onClick={() => collapseAll('storage')}>
                <ListTree size={15} />
              </button>
              <button className="wh-icon-btn" title="Свернуть до отделений"
                      onClick={() => collapseAll('room')}>
                <FolderTree size={15} />
              </button>
              <button className="wh-icon-btn" title="Свернуть всё"
                      onClick={() => collapseAll()}>
                <Minimize2 size={15} />
              </button>
            </div>
          </div>
        )}
        <div className="wh-reports__export">
          <button className="wh-btn wh-btn--ghost" onClick={() => doExport('xlsx')} disabled={exporting}>
            <FileSpreadsheet size={15} /> XLSX
          </button>
          <button className="wh-btn wh-btn--ghost" onClick={() => doExport('pdf')} disabled={exporting}>
            <FileText size={15} /> PDF
          </button>
        </div>
      </div>

      {data.payload?.disclaimer && (
        <div className="wh-note wh-note--warn">
          <AlertTriangle size={15} /><div>{data.payload.disclaimer}</div>
        </div>
      )}

      <ReportTable
        columns={data.columns || []}
        items={data.payload?.items || []}
        totals={data.payload?.totals || null}
        hierarchical={hierarchical}
        collapsed={collapsed}
        onToggleNode={toggleNode}
        onOpenAsset={onOpenAsset}
        emptyText="В снимке нет строк"
      />
    </>
  );
}

const fmtDateTime = d => (d ? new Date(d).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '—');
