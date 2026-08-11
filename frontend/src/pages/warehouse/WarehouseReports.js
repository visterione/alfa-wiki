import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  FileSpreadsheet, FileText, Info, AlertTriangle, ArrowRightLeft, Plug,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';

/**
 * Отчёты складского модуля.
 *
 * Все отчёты описываются одной таблицей REPORTS: колонки, параметры и способ
 * загрузки. Это позволяет иметь один экран, одну выгрузку и одну шапку на все
 * одиннадцать отчётов — вместо одиннадцати почти одинаковых компонентов, которые
 * разъехались бы после первой же правки формата.
 *
 * Колонки описаны здесь, а не приходят с бэкенда: их состав — вопрос вида, а не
 * данных, и держать вид рядом с данными означало бы менять API при каждом
 * переименовании заголовка.
 */

const REPORTS = {
  turnover: {
    code: 'RPT-TURNOVER',
    title: 'Оборотно-сальдовая ведомость по локациям',
    needsPeriod: true,
    load: params => warehouseApi.turnover(params),
    columns: [
      { key: 'medCenterName', title: 'Медцентр' },
      { key: 'departmentName', title: 'Отделение' },
      { key: 'roomNumber', title: 'Кабинет' },
      { key: 'storageName', title: 'Место хранения' },
      { key: 'nomenclatureName', title: 'Номенклатура' },
      { key: 'code', title: 'Код' },
      { key: 'unit', title: 'Ед.' },
      { key: 'openQty', title: 'Сальдо начало, кол-во', type: 'qty' },
      { key: 'openAmount', title: 'Сальдо начало, ₽', type: 'money' },
      { key: 'inQty', title: 'Приход, кол-во', type: 'qty' },
      { key: 'inAmount', title: 'Приход, ₽', type: 'money' },
      { key: 'outQty', title: 'Расход, кол-во', type: 'qty' },
      { key: 'outAmount', title: 'Расход, ₽', type: 'money' },
      { key: 'closeQty', title: 'Сальдо конец, кол-во', type: 'qty' },
      { key: 'closeAmount', title: 'Сальдо конец, ₽', type: 'money' },
      { key: 'minQty', title: 'Минимум', type: 'qty' },
    ],
  },
  consumption: {
    code: 'RPT-CONSUMPTION',
    title: 'Расход материалов по локациям',
    needsPeriod: true,
    load: params => warehouseApi.consumption(params),
    columns: [
      { key: 'departmentName', title: 'Отделение' },
      { key: 'roomNumber', title: 'Кабинет' },
      { key: 'nomenclatureName', title: 'Номенклатура' },
      { key: 'unit', title: 'Ед.' },
      { key: 'qty', title: 'Кол-во за период', type: 'qty' },
      { key: 'amount', title: 'Сумма, ₽', type: 'money' },
      { key: 'prevQty', title: 'Кол-во пред. период', type: 'qty' },
      { key: 'deltaAmountPct', title: 'Δ суммы, %', type: 'percent' },
      { key: 'visits', title: 'Посещений', type: 'number' },
      { key: 'perVisit', title: 'На 1 посещение', type: 'qty' },
      { key: 'normPerVisit', title: 'Норма', type: 'qty' },
      { key: 'normDeviationPct', title: 'Откл. от нормы, %', type: 'percent' },
      { key: 'missingReason', title: 'Почему нет показателя' },
    ],
  },
  doctors: {
    code: 'RPT-CONSUMPTION-2',
    title: 'Расход материалов по врачам',
    needsPeriod: true,
    load: params => warehouseApi.consumption({ ...params, mode: 'doctors' }),
    columns: [
      { key: 'doctorName', title: 'Врач' },
      { key: 'departmentName', title: 'Отделение' },
      { key: 'operations', title: 'Операций / приёмов', type: 'number' },
      { key: 'amount', title: 'Расход, ₽', type: 'money' },
      { key: 'perOperation', title: 'На 1 операцию, ₽', type: 'money' },
      { key: 'medianBySpecialty', title: 'Медиана по специальности, ₽', type: 'money' },
      { key: 'deviationPct', title: 'Отклонение, %', type: 'percent' },
      { key: 'sampleReliable', title: 'Выборка значима' },
    ],
  },
  expiring: {
    code: 'RPT-EXPIRING',
    title: 'Просроченные и истекающие позиции',
    load: params => warehouseApi.expiring({ ...params, horizonDays: 90 }),
    columns: [
      { key: 'nomenclatureName', title: 'Наименование' },
      { key: 'batchNumber', title: 'Серия' },
      { key: 'expiryDate', title: 'Годен до', type: 'date' },
      { key: 'daysLeft', title: 'Осталось дней', type: 'number' },
      { key: 'quantity', title: 'Кол-во', type: 'qty' },
      { key: 'unit', title: 'Ед.' },
      { key: 'amount', title: 'Сумма, ₽', type: 'money' },
      { key: 'departmentName', title: 'Отделение' },
      { key: 'roomNumber', title: 'Кабинет' },
      { key: 'storageName', title: 'Место хранения' },
      { key: 'avgMonthly', title: 'Расход/мес', type: 'qty' },
      { key: 'recommendation', title: 'Рекомендация' },
      { key: 'supplierName', title: 'Поставщик' },
    ],
  },
  depreciation: {
    code: 'RPT-DEPRECIATION',
    title: 'Ведомость амортизации основных средств',
    load: params => warehouseApi.depreciation(params),
    columns: [
      { key: 'inventoryNumber', title: 'Инв. №' },
      { key: 'name', title: 'Наименование' },
      { key: 'model', title: 'Модель' },
      { key: 'okof', title: 'ОКОФ' },
      { key: 'depreciationGroup', title: 'Аморт. группа', type: 'number' },
      { key: 'commissioningDate', title: 'Ввод в эксплуатацию', type: 'date' },
      { key: 'usefulLifeMonths', title: 'СПИ, мес.', type: 'number' },
      { key: 'initialCost', title: 'Первоначальная, ₽', type: 'money' },
      { key: 'accumulatedDepreciation', title: 'Накоплено, ₽', type: 'money' },
      { key: 'residual', title: 'Остаточная, ₽', type: 'money' },
      { key: 'wearPercent', title: 'Износ, %', type: 'percent' },
      { key: 'departmentName', title: 'Отделение' },
      { key: 'roomNumber', title: 'Кабинет' },
      { key: 'responsibleName', title: 'МОЛ' },
      { key: 'forecastFullWearDate', title: 'Прогноз 100 % износа', type: 'date' },
    ],
  },
  maintenance: {
    code: 'RPT-MAINTENANCE',
    title: 'Исполнение графика ТО',
    load: params => warehouseApi.maintenance(params),
    unwrap: data => ({ items: data.items, summary: data.summary, header: null }),
    columns: [
      { key: 'number', title: 'Наряд' },
      { key: '_asset', title: 'Оборудование' },
      { key: '_room', title: 'Кабинет' },
      { key: 'type', title: 'Тип' },
      { key: 'plannedDate', title: 'План', type: 'date' },
      { key: 'factDate', title: 'Факт', type: 'date' },
      { key: 'deviationDays', title: 'Отклонение, дней', type: 'number' },
      { key: 'status', title: 'Статус' },
      { key: 'result', title: 'Результат' },
      { key: 'cost', title: 'Стоимость, ₽', type: 'money' },
      { key: 'downtimeHours', title: 'Простой, ч', type: 'number' },
      { key: '_contractor', title: 'Подрядчик' },
    ],
  },
  reliability: {
    code: 'RPT-MAINTENANCE-3',
    title: 'Отказы и надёжность по моделям',
    load: () => warehouseApi.reliability(),
    columns: [
      { key: 'model', title: 'Модель' },
      { key: 'unitsInPark', title: 'В парке', type: 'number' },
      { key: 'repairs', title: 'Ремонтов за год', type: 'number' },
      { key: 'downtimeHours', title: 'Простой, ч', type: 'number' },
      { key: 'repairCost', title: 'Затраты на ремонт, ₽', type: 'money' },
      { key: 'maintenanceCost', title: 'Затраты на ТО, ₽', type: 'money' },
      { key: 'mtbfDays', title: 'MTBF, дней', type: 'number' },
      { key: 'ownershipCostPerUnitYear', title: 'Владение, ₽/ед./год', type: 'money' },
    ],
  },
  movements: {
    code: 'RPT-MOVEMENT',
    title: 'Движение активов и материалов',
    needsPeriod: true,
    load: params => warehouseApi.movements({ ...params, limit: 300 }),
    unwrap: data => ({ items: data.items.map(flattenMovement), summary: data.summary, header: null }),
    columns: [
      { key: 'occurredAt', title: 'Дата и время', type: 'date' },
      { key: 'docNumber', title: '№ документа' },
      { key: 'typeLabel', title: 'Тип операции' },
      { key: 'object', title: 'Объект' },
      { key: 'qty', title: 'Кол-во', type: 'qty' },
      { key: 'fromPath', title: 'Откуда' },
      { key: 'toPath', title: 'Куда' },
      { key: 'fromWho', title: 'Сдал' },
      { key: 'toWho', title: 'Принял' },
      { key: 'reason', title: 'Причина' },
      { key: 'initiator', title: 'Оформил' },
      { key: 'device', title: 'Устройство' },
      { key: 'oneC', title: 'Статус 1С' },
    ],
  },
  idle: {
    code: 'RPT-IDLE',
    title: 'Простаивающее оборудование',
    load: () => warehouseApi.idleAssets({}),
    unwrap: data => ({ items: data.items, note: data.note, header: null }),
    columns: [
      { key: 'inventoryNumber', title: 'Инв. №' },
      { key: 'name', title: 'Наименование' },
      { key: 'model', title: 'Модель' },
      { key: 'idleDays', title: 'Дней без операций', type: 'number' },
      { key: 'initialCost', title: 'Первоначальная, ₽', type: 'money' },
      { key: 'medCenterName', title: 'Медцентр' },
      { key: 'departmentName', title: 'Отделение' },
      { key: 'roomNumber', title: 'Кабинет' },
    ],
  },
  inventory: {
    code: 'RPT-INVENTORY',
    title: 'Инвентаризационные описи',
    custom: 'inventory',
  },
  onec: {
    code: 'RPT-1C-RECON',
    title: 'Сверка с 1С',
    custom: 'onec',
  },
};

const GROUPS = [
  { title: 'Склад и материалы', keys: ['turnover', 'consumption', 'doctors', 'expiring'] },
  { title: 'Основные средства', keys: ['depreciation', 'maintenance', 'reliability', 'idle'] },
  { title: 'Аудит и сверка', keys: ['movements', 'inventory', 'onec'] },
];

export default function WarehouseReports({ access, tree, initialReport }) {
  const [key, setKey] = useState(initialReport && REPORTS[initialReport] ? initialReport : 'turnover');
  const [period, setPeriod] = useState(() => {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), 1);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });
  const [medCenterId, setMedCenterId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [state, setState] = useState({ loading: false, data: null });
  const [exporting, setExporting] = useState(false);

  const report = REPORTS[key];

  const load = useCallback(async () => {
    if (!report || report.custom) return;
    setState({ loading: true, data: null });
    try {
      const params = {};
      if (report.needsPeriod) { params.from = period.from; params.to = period.to; }
      if (medCenterId) params.medCenterId = medCenterId;
      if (departmentId) params.departmentId = departmentId;
      const { data } = await report.load(params);
      const shaped = report.unwrap ? { ...data, ...report.unwrap(data) } : data;
      setState({ loading: false, data: shaped });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Отчёт не построился');
      setState({ loading: false, data: null });
    }
  }, [report, period, medCenterId, departmentId]);

  useEffect(() => { load(); }, [load]);

  const doExport = async (format) => {
    if (!state.data?.items?.length) return toast.error('Нечего выгружать');
    setExporting(true);
    try {
      const { data: blob } = await warehouseApi.exportReport({
        format,
        code: report.code,
        header: state.data.header || { title: report.title, generatedAt: new Date().toISOString() },
        items: state.data.items,
        totals: state.data.totals || null,
        columns: report.columns,
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${report.code}.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error('Не удалось выгрузить');
    } finally {
      setExporting(false);
    }
  };

  const departments = useMemo(() => {
    if (!medCenterId) return tree?.departments || [];
    return (tree?.departments || []).filter(d => d.medCenterId === medCenterId);
  }, [tree, medCenterId]);

  return (
    <div className="wh-reports">
      <aside className="wh-reports__nav">
        {GROUPS.map(g => (
          <div key={g.title} className="wh-reports__group">
            <h4>{g.title}</h4>
            {g.keys.map(k => (
              <button key={k} className={key === k ? 'is-active' : ''} onClick={() => setKey(k)}>
                {REPORTS[k].title}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <div className="wh-reports__main">
        <div className="wh-reports__head">
          <div>
            <h2>{report.title}</h2>
            <span className="wh-mono wh-cell-sub">{report.code}</span>
          </div>
          {!report.custom && (
            <div className="wh-reports__export">
              <button className="wh-btn wh-btn--ghost" onClick={() => doExport('xlsx')} disabled={exporting}>
                <FileSpreadsheet size={15} /> XLSX
              </button>
              <button className="wh-btn wh-btn--ghost" onClick={() => doExport('pdf')} disabled={exporting}>
                <FileText size={15} /> PDF
              </button>
            </div>
          )}
        </div>

        {!report.custom && (
          <div className="wh-reports__filters">
            {report.needsPeriod && (
              <>
                <div className="wh-field">
                  <label>С</label>
                  <input type="date" value={period.from} onChange={e => setPeriod(p => ({ ...p, from: e.target.value }))} />
                </div>
                <div className="wh-field">
                  <label>По</label>
                  <input type="date" value={period.to} onChange={e => setPeriod(p => ({ ...p, to: e.target.value }))} />
                </div>
                <div className="wh-presets">
                  {[['Месяц', 30], ['Квартал', 90], ['Год', 365]].map(([label, days]) => (
                    <button key={label} onClick={() => setPeriod({
                      from: new Date(Date.now() - days * 86400000).toISOString().slice(0, 10),
                      to: new Date().toISOString().slice(0, 10),
                    })}>{label}</button>
                  ))}
                </div>
              </>
            )}
            <div className="wh-field">
              <label>Медцентр</label>
              <select value={medCenterId} onChange={e => { setMedCenterId(e.target.value); setDepartmentId(''); }}>
                <option value="">Все</option>
                {(tree?.medCenters || []).map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
              </select>
            </div>
            <div className="wh-field">
              <label>Отделение</label>
              <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
                <option value="">Все</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {report.custom === 'onec' && <OneCPanel />}
        {report.custom === 'inventory' && <InventoryPanel />}

        {!report.custom && (
          <>
            {state.data?.note && (
              <div className="wh-note wh-note--subtle"><Info size={15} /><div>{state.data.note}</div></div>
            )}
            {state.data?.disclaimer && (
              <div className="wh-note wh-note--warn"><AlertTriangle size={15} /><div>{state.data.disclaimer}</div></div>
            )}
            {state.data?.summary && <SummaryStrip summary={state.data.summary} />}
            {state.data?.controls?.stockVsMovements?.length > 0 && (
              <div className="wh-note wh-note--warn">
                <AlertTriangle size={15} />
                <div>
                  Остаток расходится с журналом движений по {state.data.controls.stockVsMovements.length} позициям.
                  Это означает, что остатки правились в обход модуля.
                </div>
              </div>
            )}

            <div className="wh-table-wrap wh-table-wrap--tall">
              <table className="wh-table wh-table--compact">
                <thead>
                  <tr>{report.columns.map(c => (
                    <th key={c.key} className={isNum(c.type) ? 'wh-num' : ''}>{c.title}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {state.loading && (
                    <tr><td colSpan={report.columns.length} className="wh-table__loading">
                      <div className="loading-spinner" />
                    </td></tr>
                  )}
                  {!state.loading && (state.data?.items || []).map((row, i) => (
                    <tr key={i} className={rowClass(row)}>
                      {report.columns.map(c => (
                        <td key={c.key} className={isNum(c.type) ? 'wh-num' : ''}>
                          {cell(row, c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!state.loading && !(state.data?.items || []).length && (
                    <tr><td colSpan={report.columns.length} className="wh-empty">Данных нет</td></tr>
                  )}
                </tbody>
                {state.data?.totals && (
                  <tfoot>
                    <tr>
                      {report.columns.map((c, i) => (
                        <td key={c.key} className={isNum(c.type) ? 'wh-num' : ''}>
                          {i === 0 ? <b>ИТОГО</b>
                            : state.data.totals[c.key] !== undefined
                              ? <b>{format(state.data.totals[c.key], c.type)}</b>
                              : ''}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="wh-assets__count">
              Строк: {(state.data?.items || []).length}
              {state.data?.header?.oneCNote && ` · ${state.data.header.oneCNote}`}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryStrip({ summary }) {
  const entries = Object.entries(summary).filter(([, v]) => typeof v !== 'object');
  const nested = Object.entries(summary).filter(([, v]) => v && typeof v === 'object');
  return (
    <div className="wh-summary wh-summary--strip">
      {entries.map(([k, v]) => (
        <div key={k} className="wh-sumcard wh-sumcard--neutral">
          <div className="wh-sumcard__title">{summaryLabel(k)}</div>
          <div className="wh-sumcard__value">{typeof v === 'number' ? v.toLocaleString('ru-RU') : String(v)}</div>
        </div>
      ))}
      {nested.map(([k, v]) => (
        <div key={k} className="wh-sumcard wh-sumcard--neutral">
          <div className="wh-sumcard__title">{summaryLabel(k)}</div>
          <div className="wh-sumcard__value">
            {v.count !== undefined ? v.count : Object.values(v).reduce((s, x) => s + Number(x || 0), 0)}
          </div>
          {v.amount !== undefined && (
            <div className="wh-sumcard__sub">{Number(v.amount).toLocaleString('ru-RU')} ₽</div>
          )}
        </div>
      ))}
    </div>
  );
}

function OneCPanel() {
  const [data, setData] = useState(null);
  useEffect(() => {
    warehouseApi.oneCStatus().then(({ data: res }) => setData(res)).catch(() => {});
  }, []);
  if (!data) return <div className="wh-page--center"><div className="loading-spinner" /></div>;

  return (
    <div className="wh-onec">
      <div className="wh-note wh-note--warn">
        <Plug size={15} />
        <div>
          <b>Обмен с 1С не подключён.</b> {data.integration.reason}. Отчёт существует и
          показывает это прямо, вместо того чтобы рисовать «расхождение 0,00 ₽» при
          выключенной интеграции — такая галочка означала бы, что сверка прошла успешно.
        </div>
      </div>

      <h3>Готовность к обмену</h3>
      <p className="wh-hint">{data.readiness.note}</p>

      <h3>Внутренняя сверка</h3>
      <p className="wh-hint">{data.internalReconciliation.description}</p>
      {data.internalReconciliation.ok ? (
        <div className="wh-note wh-note--ok">
          <Info size={15} />
          <div>Остаток совпадает с журналом движений: расхождений нет.</div>
        </div>
      ) : (
        <table className="wh-table wh-table--compact">
          <thead><tr><th>Номенклатура</th><th className="wh-num">По остаткам</th><th className="wh-num">По движениям</th><th className="wh-num">Разница</th></tr></thead>
          <tbody>
            {data.internalReconciliation.discrepancies.map((d, i) => (
              <tr key={i}>
                <td>{d.name}</td>
                <td className="wh-num">{d.stock_qty}</td>
                <td className="wh-num">{d.calc_qty}</td>
                <td className="wh-num wh-danger">{d.diff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Очередь исходящих (outbox)</h3>
      <p className="wh-hint">
        Таблица создана по образцу очереди заявок публичного API и пока пуста: пока
        обмен выключен, события в неё не пишутся.
      </p>
      <pre className="wh-pre">{JSON.stringify(data.integration.outboxQueue, null, 2)}</pre>

      <h3>Документы по статусу синхронизации</h3>
      <pre className="wh-pre">{JSON.stringify(data.integration.documentsByStatus, null, 2)}</pre>
    </div>
  );
}

function InventoryPanel() {
  const [sessions, setSessions] = useState([]);
  const [report, setReport] = useState(null);

  useEffect(() => {
    warehouseApi.inventorySessions().then(({ data }) => setSessions(data)).catch(() => {});
  }, []);

  const open = async (id) => {
    try {
      const { data } = await warehouseApi.inventoryReport(id);
      setReport(data);
    } catch {
      toast.error('Не удалось открыть опись');
    }
  };

  return (
    <div className="wh-inventory">
      <div className="wh-table-wrap">
        <table className="wh-table wh-table--compact">
          <thead><tr><th>Опись</th><th>Локация</th><th>Основание</th><th>Статус</th><th>Начата</th><th>Завершена</th><th>Длительность</th></tr></thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id} className="wh-table__row" onClick={() => open(s.id)}>
                <td className="wh-mono">{s.number}</td>
                <td>{s.room ? `Каб. ${s.room.number}` : s.department?.name || '—'}</td>
                <td className="wh-cell-sub">{s.basis || '—'}</td>
                <td><span className={`wh-status wh-status--${s.status}`}>{
                  { open: 'Открыта', counting: 'Пересчёт', closed: 'Закрыта', cancelled: 'Отменена' }[s.status]
                }</span></td>
                <td>{s.startedAt ? new Date(s.startedAt).toLocaleString('ru-RU') : '—'}</td>
                <td>{s.finishedAt ? new Date(s.finishedAt).toLocaleString('ru-RU') : '—'}</td>
                <td>{s.durationMinutes ? `${Math.floor(s.durationMinutes / 60)} ч ${s.durationMinutes % 60} мин` : '—'}</td>
              </tr>
            ))}
            {!sessions.length && <tr><td colSpan={7} className="wh-empty">Описей нет</td></tr>}
          </tbody>
        </table>
      </div>

      {report && (
        <div className="wh-inv-report">
          <h3>{report.header.title}</h3>
          <div className="wh-inv-report__meta">
            <div>Опись № <b>{report.session.number}</b></div>
            <div>Локация: {report.session.location}</div>
            <div>Основание: {report.session.basis || '—'}</div>
            <div>МОЛ: {report.session.responsible?.displayName || '—'}</div>
            <div>Председатель комиссии: {report.session.chairman?.displayName || '—'}</div>
          </div>

          <table className="wh-table wh-table--compact">
            <thead>
              <tr><th>№</th><th>Инв. № / код</th><th>Наименование</th><th className="wh-num">По учёту</th>
                  <th className="wh-num">Фактически</th><th className="wh-num">Расхождение</th><th>Примечание</th></tr>
            </thead>
            <tbody>
              {report.items.map(i => (
                <tr key={i.id} className={i.difference ? (i.difference < 0 ? 'wh-row--shortage' : 'wh-row--surplus') : ''}>
                  <td>{i.rowNumber}</td>
                  <td className="wh-mono">{i.inventoryNumber}</td>
                  <td>{i.name}</td>
                  <td className="wh-num">{i.expectedQty}</td>
                  <td className="wh-num">{i.actualQty === null ? '—' : i.actualQty}</td>
                  <td className="wh-num">{i.difference === null ? '—' : (i.difference > 0 ? `+${i.difference}` : i.difference)}</td>
                  <td className="wh-cell-sub">{i.note || (i.scanMethod === 'qr' ? 'скан QR' : '')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="wh-inv-report__totals">
            <span>Недостач: <b>{report.totals.shortage}</b></span>
            <span>Излишков: <b>{report.totals.surplus}</b></span>
            <span>По QR: <b>{report.totals.scannedByQr}</b></span>
            <span>Вручную: <b>{report.totals.scannedManually}</b></span>
            {report.totals.qrSharePct !== null && <span>Доля QR: <b>{report.totals.qrSharePct} %</b></span>}
            {report.session.durationMinutes && (
              <span>Длительность: <b>{Math.floor(report.session.durationMinutes / 60)} ч {report.session.durationMinutes % 60} мин</b></span>
            )}
          </div>

          <div className="wh-note wh-note--subtle">
            <Info size={15} />
            <div>
              Документы по итогам описи (оприходование излишков, списание недостач) не
              создаются автоматически: это решение комиссии, а не следствие пересчёта.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Форматирование ───────────────────────────────────────────────────────────
const isNum = t => ['money', 'qty', 'number', 'percent'].includes(t);

function cell(row, col) {
  // Псевдоколонки отчёта по ТО: значения лежат во вложенных объектах.
  if (col.key === '_asset') return row.asset ? `${row.asset.name} ${row.asset.model || ''}` : '—';
  if (col.key === '_room') return row.asset?.room ? `Каб. ${row.asset.room.number}` : '—';
  if (col.key === '_contractor') return row.contractor?.name || '—';
  if (col.key === 'type' && row.number) return maintType(row.type);
  if (col.key === 'status' && row.number) return maintStatus(row.status);
  if (col.key === 'result' && row.number) return maintResult(row.result);
  if (col.key === 'sampleReliable') return row.sampleReliable ? 'да' : 'нет — мало наблюдений';
  return format(row[col.key], col.type);
}

function format(v, type) {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'money') return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'qty') return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  if (type === 'number') return Number(v).toLocaleString('ru-RU');
  if (type === 'percent') return `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)} %`;
  if (type === 'date') return new Date(v).toLocaleDateString('ru-RU');
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

function flattenMovement(m) {
  return {
    occurredAt: m.occurredAt,
    docNumber: m.document?.number || '—',
    typeLabel: moveType(m.type),
    object: m.asset
      ? `${m.asset.inventoryNumber} · ${m.asset.name}`
      : `${m.nomenclature?.code || ''} ${m.nomenclature?.name || ''}${m.batch ? ` (серия ${m.batch.batchNumber})` : ''}`,
    qty: m.quantity,
    fromPath: m.fromRoom ? `${m.fromRoom.department?.name || ''} / Каб. ${m.fromRoom.number}` : '—',
    toPath: m.toRoom ? `${m.toRoom.department?.name || ''} / Каб. ${m.toRoom.number}` : '—',
    fromWho: m.fromResponsible?.displayName || '—',
    toWho: m.toResponsible?.displayName || '—',
    reason: m.reasonText || m.reasonCode || '—',
    initiator: m.initiator?.displayName || '—',
    device: m.document?.device || '—',
    // «выключено» вместо «не синхронизировано»: обмена нет, и это разные вещи.
    oneC: m.document?.oneCStatus === 'disabled' ? 'обмен выключен' : m.document?.oneCStatus || '—',
  };
}

const moveType = t => ({
  receipt: 'Приём', issue: 'Выдача', transfer: 'Перемещение', repair_out: 'В ремонт',
  repair_in: 'Из ремонта', writeoff: 'Списание', inventory: 'Инвентаризация', surplus: 'Оприходование',
}[t] || t);
const maintType = t => ({ maintenance: 'ТО', verification: 'Поверка', calibration: 'Калибровка', dosimetry: 'Дозиметрия', inspection: 'Осмотр' }[t] || t);
const maintStatus = s => ({ planned: 'Запланирован', in_progress: 'В работе', done: 'Выполнен', overdue: 'Просрочен', cancelled: 'Отменён' }[s] || s);
const maintResult = r => ({ normal: 'Норма', with_remarks: 'С замечаниями', failed: 'Не пройдено' }[r] || '—');

function summaryLabel(k) {
  return {
    total: 'Всего', done: 'Выполнено', onTime: 'В срок', deviated: 'С отклонением',
    overdue: 'Просрочено', totalCost: 'Затраты, ₽', downtimeHours: 'Простой, ч',
    byType: 'По типам', expired: 'Просрочено', within30: 'Истекает 30 дн.',
    within90: 'Истекает 90 дн.', writeOffLast12Months: 'Списано за 12 мес.',
    amount: 'Сумма, ₽', prevAmount: 'Пред. период, ₽', count: 'Позиций',
    initialCost: 'Первоначальная, ₽', accumulated: 'Накоплено, ₽', residual: 'Остаточная, ₽',
    fullyDepreciatedInUse: 'Самортизировано, в работе',
  }[k] || k;
}
