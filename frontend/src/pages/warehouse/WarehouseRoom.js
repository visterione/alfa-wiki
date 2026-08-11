import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Package, Boxes, CalendarClock, Wrench, QrCode, Printer, RefreshCw,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';

/**
 * Дашборд кабинета — экран, а не выгружаемый отчёт (RPT-ROOM-DASH из ТЗ).
 *
 * Он же открывается по QR-коду на двери кабинета: в этом случае человек видит
 * публичную карточку, а внутри портала — этот экран целиком, с остатками и суммами.
 */

const STATUS_LABELS = {
  in_use: 'В работе', maintenance: 'На ТО', repair: 'В ремонте',
  storage: 'На хранении', written_off: 'Списано', reserved: 'Зарезервировано',
};

export default function WarehouseRoom({ roomId, access, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: res } = await warehouseApi.roomDashboard(roomId);
      setData(res);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить дашборд');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [roomId]);

  if (loading) return <div className="wh-page--center"><div className="loading-spinner" /></div>;
  if (!data) return <div className="wh-empty">Кабинет недоступен</div>;

  const { room, cards, assets, stock, maintenance, attention, header } = data;
  const canSeeCosts = access?.capabilities?.canSeeCosts;

  return (
    <div className="wh-room">
      <div className="wh-room__head">
        <button className="wh-btn wh-btn--ghost" onClick={onBack}><ArrowLeft size={15} /> К карте</button>
        <div className="wh-room__title">
          <h2>Кабинет {room.number}{room.name && room.name !== room.number ? ` — ${room.name}` : ''}</h2>
          <div className="wh-room__path">{room.path}</div>
          <div className="wh-room__meta">
            МОЛ: {room.responsible?.displayName || 'не назначен'} ·
            обновлено {new Date(header.generatedAt).toLocaleString('ru-RU')}
          </div>
        </div>
        <div className="wh-room__actions">
          <button className="wh-btn wh-btn--ghost" onClick={load}><RefreshCw size={15} /> Обновить</button>
          <button className="wh-btn wh-btn--ghost" onClick={() => window.print()}>
            <Printer size={15} /> Печать
          </button>
        </div>
      </div>

      <div className="wh-room__cards">
        <BigCard icon={<Package size={16} />} title="Оборудование" value={cards.assets.total} unit="ед."
                 rows={[
                   ['🟢', `${cards.assets.inUse} в работе`],
                   ['🟡', `${cards.assets.maintenance} на ТО`],
                   ['🔴', `${cards.assets.repair} в ремонте`],
                 ]} />
        <BigCard icon={<Boxes size={16} />} title="Материалы" value={cards.materials.positions} unit="поз."
                 sub={canSeeCosts ? `${cards.materials.value.toLocaleString('ru-RU')} ₽` : null}
                 rows={[
                   ['🔴', `${cards.materials.belowMin} ниже минимума`],
                   ['🟡', `${cards.materials.nearMin} близко к минимуму`],
                 ]} />
        <BigCard icon={<CalendarClock size={16} />} title="Сроки"
                 value={cards.expiry.expired + cards.expiry.within30} unit="поз."
                 rows={[
                   ['🔴', `${cards.expiry.expired} просрочено`],
                   ['🟠', `${cards.expiry.within30} истекает в 30 дн.`],
                 ]} />
        <BigCard icon={<Wrench size={16} />} title="ТО" value={cards.maintenance.open} unit="нар."
                 sub={cards.maintenance.nextDate ? `ближайшее ${fmt(cards.maintenance.nextDate)}` : 'нарядов нет'}
                 rows={[['🔴', `${cards.maintenance.overdue} просрочено`]]} />
        <div className="wh-bigcard wh-bigcard--util">
          <div className="wh-bigcard__head">Загрузка кабинета</div>
          {cards.utilization.hasData ? (
            <>
              <div className={`wh-bigcard__value wh-zone wh-zone--${cards.utilization.zone}`}>
                {cards.utilization.percent} %
              </div>
              <div className="wh-bigcard__sub">
                {cards.utilization.zone === 'red' ? 'перегружен'
                  : cards.utilization.zone === 'yellow' ? 'норма' : 'недозагружен'}
              </div>
            </>
          ) : (
            <>
              <div className="wh-bigcard__value wh-muted">—</div>
              {/* Явно, почему пусто: иначе это читается как «загрузки нет». */}
              <div className="wh-bigcard__sub">
                не рассчитана: кабинет не сопоставлен с МИС либо нет данных за период
              </div>
            </>
          )}
        </div>
      </div>

      {attention.length > 0 && (
        <section className="wh-room__section">
          <h3>Требуют внимания</h3>
          <ul className="wh-attention">
            {attention.map((a, i) => (
              <li key={i} className={`wh-attention__item wh-attention__item--${a.level}`}>{a.text}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="wh-room__section">
        <h3>Оборудование кабинета</h3>
        <div className="wh-table-wrap">
          <table className="wh-table wh-table--compact">
            <thead>
              <tr>
                <th>Наименование</th><th>Инв. №</th><th>Статус</th><th>След. ТО</th><th>МОЛ</th>
                {canSeeCosts && <th className="wh-num">Первонач., ₽</th>}
              </tr>
            </thead>
            <tbody>
              {assets.map(a => (
                <tr key={a.id}>
                  <td>
                    <div className="wh-cell-main">{a.name}</div>
                    {a.model && <div className="wh-cell-sub">{a.model}</div>}
                  </td>
                  <td className="wh-mono">{a.inventoryNumber}</td>
                  <td><span className={`wh-status wh-status--${a.status}`}>{STATUS_LABELS[a.status]}</span></td>
                  <td className={a.nextMaintenanceDate && a.nextMaintenanceDate < todayStr() ? 'wh-danger' : ''}>
                    {fmt(a.nextMaintenanceDate)}
                  </td>
                  <td className="wh-cell-sub">{a.responsible?.displayName || '—'}</td>
                  {canSeeCosts && <td className="wh-num">{Number(a.initialCost).toLocaleString('ru-RU')}</td>}
                </tr>
              ))}
              {!assets.length && <tr><td colSpan={6} className="wh-empty">Оборудование не закреплено</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="wh-room__section">
        <h3>Материалы на местах хранения</h3>
        <div className="wh-table-wrap">
          <table className="wh-table wh-table--compact">
            <thead>
              <tr>
                <th style={{ width: 24 }} />
                <th>Наименование</th><th>Место</th><th>Серия</th><th>Годен до</th>
                <th className="wh-num">Остаток</th><th className="wh-num">Минимум</th>
                {canSeeCosts && <th className="wh-num">Сумма, ₽</th>}
              </tr>
            </thead>
            <tbody>
              {stock.map((s, i) => (
                <tr key={i} className={s.expired ? 'wh-row--expired' : ''}>
                  <td><span className={`wh-dot wh-dot--${s.stockStatus}`} /></td>
                  <td>{s.name}</td>
                  <td className="wh-cell-sub">{s.storageName}</td>
                  <td className="wh-mono wh-cell-sub">{s.batchNumber || '—'}</td>
                  <td className={s.expired ? 'wh-danger' : ''}>{fmt(s.expiryDate)}</td>
                  <td className="wh-num"><b>{num(s.quantity)}</b> {s.unit}</td>
                  <td className="wh-num wh-cell-sub">{s.minQty === null ? '—' : num(s.minQty)}</td>
                  {canSeeCosts && <td className="wh-num">{s.amount.toLocaleString('ru-RU')}</td>}
                </tr>
              ))}
              {!stock.length && <tr><td colSpan={8} className="wh-empty">Материалов нет</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {maintenance.length > 0 && (
        <section className="wh-room__section">
          <h3>Открытые наряды ТО</h3>
          <ul className="wh-simple-list">
            {maintenance.map(m => (
              <li key={m.id}>
                <span className="wh-mono">{m.number}</span> — {m.asset?.name},
                план {fmt(m.plannedDate)}
                {m.plannedDate < todayStr() && <b className="wh-danger"> просрочен</b>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {room.publicToken && (
        <div className="wh-note wh-note--subtle">
          <QrCode size={15} />
          <div>
            QR-код на двери кабинета ведёт на публичную страницу со списком оборудования
            и его статусами. Остатки материалов и суммы на неё не попадают.
          </div>
        </div>
      )}
    </div>
  );
}

function BigCard({ icon, title, value, unit, sub, rows }) {
  return (
    <div className="wh-bigcard">
      <div className="wh-bigcard__head">{icon} {title}</div>
      <div className="wh-bigcard__value">{value} <small>{unit}</small></div>
      {sub && <div className="wh-bigcard__sub">{sub}</div>}
      <ul className="wh-bigcard__rows">
        {(rows || []).filter(r => !/^0 /.test(r[1])).map(([mark, text], i) => (
          <li key={i}>{mark} {text}</li>
        ))}
      </ul>
    </div>
  );
}

const fmt = d => (d ? new Date(d).toLocaleDateString('ru-RU') : '—');
const num = n => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
const todayStr = () => new Date().toISOString().slice(0, 10);
