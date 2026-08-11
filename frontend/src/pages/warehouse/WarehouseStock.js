import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, AlertTriangle, Info, ShieldAlert, Filter } from 'lucide-react';
import { warehouseApi } from '../../services/api';

/**
 * Материалы: остатки по местам хранения и контроль сроков годности.
 *
 * Два экрана в одном, потому что решение всегда принимается по обоим сразу: «чего
 * не хватает» и «что скоро пропадёт» — это один разговор на утренней планёрке, а
 * не два разных отчёта.
 */

export default function WarehouseStock({ access, tree }) {
  const [view, setView] = useState('stock');
  const [stock, setStock] = useState(null);
  const [expiring, setExpiring] = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [belowOnly, setBelowOnly] = useState(false);
  const [horizon, setHorizon] = useState(90);
  const [medCenterId, setMedCenterId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'stock') {
        const { data } = await warehouseApi.stock({ belowMinimum: belowOnly ? 'true' : undefined });
        setStock(data);
      } else {
        const { data } = await warehouseApi.expiring({
          horizonDays: horizon,
          medCenterId: medCenterId || undefined,
        });
        setExpiring(data);
      }
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, [view, belowOnly, horizon, medCenterId]);

  useEffect(() => { load(); }, [load]);

  const filtered = (stock?.items || []).filter(i =>
    !q || i.nomenclature?.name?.toLowerCase().includes(q.toLowerCase())
       || i.nomenclature?.code?.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="wh-stock">
      <div className="wh-subtabs">
        <button className={view === 'stock' ? 'is-active' : ''} onClick={() => setView('stock')}>
          Остатки
        </button>
        <button className={view === 'expiring' ? 'is-active' : ''} onClick={() => setView('expiring')}>
          Сроки годности
        </button>
      </div>

      {view === 'stock' && (
        <>
          <div className="wh-assets__filters">
            <div className="wh-search">
              <Search size={15} />
              <input placeholder="Наименование или код" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <label className="wh-check">
              <input type="checkbox" checked={belowOnly} onChange={e => setBelowOnly(e.target.checked)} />
              Только ниже минимума
            </label>
            {stock && access?.capabilities?.canSeeCosts && (
              <div className="wh-total">
                Итого: <b>{stock.totalValue.toLocaleString('ru-RU')} ₽</b> · {stock.total} позиций
              </div>
            )}
          </div>

          <div className="wh-table-wrap">
            <table className="wh-table">
              <thead>
                <tr>
                  <th style={{ width: 26 }} />
                  <th>Код</th><th>Наименование</th><th>Партия</th><th>Годен до</th>
                  <th className="wh-num">Остаток</th><th>Ед.</th>
                  <th className="wh-num">Минимум</th>
                  {access?.capabilities?.canSeeCosts && <th className="wh-num">Сумма, ₽</th>}
                  <th>Место хранения</th><th>Кабинет</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={11} className="wh-table__loading"><div className="loading-spinner" /></td></tr>}
                {!loading && filtered.map(i => (
                  <tr key={i.id} className={i.expired ? 'wh-row--expired' : ''}>
                    <td><span className={`wh-dot wh-dot--${i.stockStatus}`} title={statusHint(i.stockStatus)} /></td>
                    <td className="wh-mono">{i.nomenclature?.code}</td>
                    <td>
                      <div className="wh-cell-main">{i.nomenclature?.name}</div>
                      {(i.nomenclature?.isSterile || i.nomenclature?.isMedicine) && (
                        <div className="wh-cell-sub">
                          {i.nomenclature.isSterile && 'стерильное '}
                          {i.nomenclature.isMedicine && '· ЛП'}
                        </div>
                      )}
                    </td>
                    <td className="wh-mono wh-cell-sub">{i.batch?.batchNumber || '—'}</td>
                    <td className={i.expired ? 'wh-danger' : ''}>
                      {i.batch?.expiryDate ? fmt(i.batch.expiryDate) : '—'}
                      {i.blocked && <ShieldAlert size={12} title="Партия заблокирована к выдаче" />}
                    </td>
                    <td className="wh-num"><b>{num(i.quantity)}</b></td>
                    <td>{i.nomenclature?.unit}</td>
                    <td className="wh-num wh-cell-sub">{i.minQty === null ? '—' : num(i.minQty)}</td>
                    {access?.capabilities?.canSeeCosts && (
                      <td className="wh-num">{i.amount.toLocaleString('ru-RU')}</td>
                    )}
                    <td className="wh-cell-sub">{i.storage?.name}</td>
                    <td className="wh-cell-sub">
                      {i.room ? `Каб. ${i.room.number}` : '—'}
                      {i.room?.department && <div>{i.room.department.name}</div>}
                    </td>
                  </tr>
                ))}
                {!loading && !filtered.length && <tr><td colSpan={11} className="wh-empty">Ничего не найдено</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === 'expiring' && (
        <>
          <div className="wh-assets__filters">
            <div className="wh-field">
              <label>Горизонт</label>
              <select value={horizon} onChange={e => setHorizon(Number(e.target.value))}>
                <option value={0}>Только просроченное</option>
                <option value={7}>7 дней</option>
                <option value={30}>30 дней</option>
                <option value={90}>90 дней</option>
                <option value={180}>180 дней</option>
              </select>
            </div>
            <div className="wh-field">
              <label>Медцентр</label>
              <select value={medCenterId} onChange={e => setMedCenterId(e.target.value)}>
                <option value="">Все</option>
                {(tree?.medCenters || []).map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
              </select>
            </div>
          </div>

          {expiring?.summary && (
            <div className="wh-summary">
              <SummaryCard tone="red" title="Просрочено"
                           value={`${expiring.summary.expired.count} поз.`}
                           sub={`${expiring.summary.expired.amount.toLocaleString('ru-RU')} ₽`} />
              <SummaryCard tone="orange" title="Истекает в 30 дней"
                           value={`${expiring.summary.within30.count} поз.`}
                           sub={`${expiring.summary.within30.amount.toLocaleString('ru-RU')} ₽`} />
              <SummaryCard tone="yellow" title="Истекает в 90 дней"
                           value={`${expiring.summary.within90.count} поз.`}
                           sub={`${expiring.summary.within90.amount.toLocaleString('ru-RU')} ₽`} />
              <SummaryCard tone="neutral" title="Списано по срокам за 12 мес."
                           value={`${expiring.summary.writeOffLast12Months.amount.toLocaleString('ru-RU')} ₽`}
                           sub={`${expiring.summary.writeOffLast12Months.count} списаний`} />
            </div>
          )}

          <div className="wh-table-wrap">
            <table className="wh-table">
              <thead>
                <tr>
                  <th style={{ width: 26 }} />
                  <th>Наименование</th><th>Серия</th><th>Годен до</th><th className="wh-num">Дней</th>
                  <th className="wh-num">Кол-во</th>
                  {access?.capabilities?.canSeeCosts && <th className="wh-num">Сумма, ₽</th>}
                  <th>Локация</th><th className="wh-num">Расход/мес</th><th>Прогноз</th><th>Рекомендация</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={11} className="wh-table__loading"><div className="loading-spinner" /></td></tr>}
                {!loading && (expiring?.items || []).map(i => (
                  <tr key={`${i.batchId}-${i.storageId}`}>
                    <td><span className={`wh-dot wh-dot--zone-${i.zone}`} /></td>
                    <td>
                      <div className="wh-cell-main">{i.nomenclatureName}</div>
                      <div className="wh-cell-sub wh-mono">{i.code}</div>
                    </td>
                    <td className="wh-mono wh-cell-sub">{i.batchNumber}</td>
                    <td>{fmt(i.expiryDate)}</td>
                    <td className={`wh-num ${i.daysLeft < 0 ? 'wh-danger' : ''}`}>{i.daysLeft}</td>
                    <td className="wh-num">{num(i.quantity)} {i.unit}</td>
                    {access?.capabilities?.canSeeCosts && (
                      <td className="wh-num">{i.amount.toLocaleString('ru-RU')}</td>
                    )}
                    <td className="wh-cell-sub">
                      {i.departmentName || '—'}<br />Каб. {i.roomNumber} · {i.storageName}
                    </td>
                    <td className="wh-num wh-cell-sub">{i.avgMonthly || '—'}</td>
                    <td>
                      {i.willConsumeInTime === true && <span className="wh-ok">успеем</span>}
                      {i.willConsumeInTime === false && <span className="wh-danger">не успеем</span>}
                      {i.willConsumeInTime === null && <span className="wh-muted">нет истории</span>}
                      {i.exhaustionDate && <div className="wh-cell-sub">до {fmt(i.exhaustionDate)}</div>}
                    </td>
                    <td className="wh-cell-sub">{i.recommendation}</td>
                  </tr>
                ))}
                {!loading && !(expiring?.items || []).length && (
                  <tr><td colSpan={11} className="wh-empty">Позиций с истекающим сроком нет</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="wh-note wh-note--subtle">
            <Info size={15} />
            <div>
              Прогноз «успеем израсходовать» считается по среднему расходу за шесть месяцев.
              Позиции без истории расхода помечены отдельно — по ним прогноза нет,
              а не «успеем».
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ tone, title, value, sub }) {
  return (
    <div className={`wh-sumcard wh-sumcard--${tone}`}>
      <div className="wh-sumcard__title">{title}</div>
      <div className="wh-sumcard__value">{value}</div>
      <div className="wh-sumcard__sub">{sub}</div>
    </div>
  );
}

const fmt = d => (d ? new Date(d).toLocaleDateString('ru-RU') : '—');
const num = n => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
const statusHint = s => ({
  below: 'Ниже минимума', near: 'Близко к минимуму', ok: 'Норма', unknown: 'Минимум не задан',
}[s] || s);
