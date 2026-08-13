import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Package, Boxes, CalendarClock, Wrench, QrCode, Printer, RefreshCw,
  Activity, AlertTriangle, Search, Copy, Monitor, X, MapPin, User as UserIcon,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';
import SecureImage from '../../components/warehouse/SecureImage';

/**
 * Дашборд кабинета — отчёт № 7 из ТЗ.
 *
 * Это рабочий экран, а не выгружаемый отчёт, и отсюда три следствия:
 *
 *   • Он интерактивный. Плитки сверху — фильтры: клик по «просрочено» оставляет в
 *     таблицах только просроченное, клик по «в ремонте» — только ремонт. Раньше
 *     это были неподвижные счётчики, и до причины цифры приходилось добираться
 *     глазами по всей странице.
 *
 *   • Он живой. Автообновление раз в 60 секунд, потому что в ТЗ этот экран
 *     работает в режиме табло на мониторе у входа в кабинет. Интервал снимается
 *     при уходе со страницы — иначе он продолжает дёргать сервер из закрытой вкладки.
 *
 *   • У него есть режим табло: скрывает управление и увеличивает шрифты, чтобы
 *     экран читался с двух метров.
 *
 * Полный экран, а не боковая панель: панель на карте — это быстрый просмотр, а
 * сюда приходят разбираться.
 */

const STATUS_LABELS = {
  in_use: 'В работе', maintenance: 'На ТО', repair: 'В ремонте',
  storage: 'На хранении', written_off: 'Списано', reserved: 'Зарезервировано',
};

const REFRESH_MS = 60_000;

export default function WarehouseRoom({ roomId, access, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [filter, setFilter] = useState(null);   // null | 'repair' | 'maintenance' | 'expired' | 'belowMin'
  const [q, setQ] = useState('');
  const [kiosk, setKiosk] = useState(false);
  const [qrModal, setQrModal] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: res } = await warehouseApi.roomDashboard(roomId);
      setData(res);
      setRefreshedAt(new Date());
    } catch (e) {
      if (!silent) toast.error(e.response?.data?.error || 'Не удалось загрузить дашборд');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [roomId]);

  // Автообновление для режима табло. Интервал живёт только пока экран открыт.
  useEffect(() => {
    const timer = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(timer);
    /* eslint-disable-next-line */
  }, [roomId]);

  // Escape выходит из режима табло: в нём скрыто всё управление, включая кнопку
  // выхода, и без клавиши экран становится ловушкой.
  useEffect(() => {
    if (!kiosk) return undefined;
    const onKey = e => { if (e.key === 'Escape') setKiosk(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kiosk]);

  const canSeeCosts = access?.capabilities?.canSeeCosts;

  const filteredAssets = useMemo(() => {
    if (!data) return [];
    let rows = data.assets;
    if (filter === 'repair') rows = rows.filter(a => a.status === 'repair');
    if (filter === 'maintenance') rows = rows.filter(a => a.status === 'maintenance');
    if (filter === 'maintDue') {
      const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      rows = rows.filter(a => a.nextMaintenanceDate && a.nextMaintenanceDate <= soon);
    }
    if (filter === 'expired' || filter === 'belowMin') rows = [];
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(a =>
        a.name?.toLowerCase().includes(needle) ||
        a.model?.toLowerCase().includes(needle) ||
        a.inventoryNumber?.toLowerCase().includes(needle));
    }
    return rows;
  }, [data, filter, q]);

  const filteredStock = useMemo(() => {
    if (!data) return [];
    let rows = data.stock;
    if (filter === 'expired') rows = rows.filter(s => s.expired || s.expiringSoon);
    if (filter === 'belowMin') rows = rows.filter(s => s.stockStatus === 'below');
    if (filter === 'repair' || filter === 'maintenance' || filter === 'maintDue') rows = [];
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(s => s.name?.toLowerCase().includes(needle));
    }
    return rows;
  }, [data, filter, q]);

  if (loading) return <div className="wh-page--center"><div className="loading-spinner" /></div>;
  if (!data) return <div className="wh-empty">Кабинет недоступен</div>;

  const { room, cards, maintenance, attention } = data;
  const publicUrl = room.publicToken ? `${window.location.origin}/p/r/${room.publicToken}` : null;

  return (
    <div className={`wh-room ${kiosk ? 'wh-room--kiosk' : ''}`}>
      {/* ── Шапка ─────────────────────────────────────────────────────────── */}
      <div className="wh-room__head">
        {!kiosk && (
          <button className="wh-btn wh-btn--secondary" onClick={onBack}>
            <ArrowLeft size={15} /> К списку кабинетов
          </button>
        )}
        <div className="wh-room__title">
          <h2>
            Кабинет {room.number}
            {room.name && room.name !== room.number ? ` — ${room.name}` : ''}
          </h2>
          <div className="wh-room__path"><MapPin size={12} /> {room.path}</div>
          <div className="wh-room__meta">
            <UserIcon size={11} /> МОЛ: {room.responsible?.displayName || 'не назначен'}
            {refreshedAt && ` · обновлено ${refreshedAt.toLocaleTimeString('ru-RU')}`}
            {' · обновляется автоматически раз в минуту'}
          </div>
        </div>
        {!kiosk && (
          <div className="wh-room__actions">
            <button className="wh-btn wh-btn--secondary" onClick={() => load()}>
              <RefreshCw size={15} /> Обновить
            </button>
            {publicUrl && (
              <button className="wh-btn wh-btn--secondary" onClick={() => setQrModal(true)}>
                <QrCode size={15} /> QR на дверь
              </button>
            )}
            <button className="wh-btn wh-btn--secondary" onClick={() => setKiosk(true)}
                    title="Крупные цифры, без управления — для монитора у кабинета">
              <Monitor size={15} /> Табло
            </button>
            <button className="wh-btn wh-btn--secondary" onClick={() => window.print()}>
              <Printer size={15} /> Печать
            </button>
          </div>
        )}
        {kiosk && (
          <button className="wh-btn wh-btn--secondary" onClick={() => setKiosk(false)}>
            <X size={15} /> Выйти из табло (Esc)
          </button>
        )}
      </div>

      {/* ── Плитки-фильтры ────────────────────────────────────────────────── */}
      <div className="wh-room__cards">
        <TileButton
          icon={<Package size={16} />} title="Оборудование"
          value={cards.assets.total} unit="ед."
          onClick={() => setFilter(null)}
          rows={[
            ['🟢', `${cards.assets.inUse} в работе`],
            ['🟡', `${cards.assets.maintenance} на ТО`],
            ['🔴', `${cards.assets.repair} в ремонте`],
          ]} />

        <TileButton
          icon={<Boxes size={16} />} title="Материалы"
          value={cards.materials.positions} unit="поз."
          sub={canSeeCosts ? `${cards.materials.value.toLocaleString('ru-RU')} ₽` : null}
          alert={cards.materials.belowMin > 0}
          active={filter === 'belowMin'}
          onClick={() => setFilter(filter === 'belowMin' ? null : 'belowMin')}
          hint={cards.materials.belowMin > 0 ? 'показать дефицит' : null}
          rows={[
            ['🔴', `${cards.materials.belowMin} ниже минимума`],
            ['🟡', `${cards.materials.nearMin} близко к минимуму`],
          ]} />

        <TileButton
          icon={<CalendarClock size={16} />} title="Сроки годности"
          value={cards.expiry.expired + cards.expiry.within30} unit="поз."
          alert={cards.expiry.expired > 0}
          active={filter === 'expired'}
          onClick={() => setFilter(filter === 'expired' ? null : 'expired')}
          hint={(cards.expiry.expired + cards.expiry.within30) > 0 ? 'показать позиции' : null}
          rows={[
            ['🔴', `${cards.expiry.expired} просрочено`],
            ['🟠', `${cards.expiry.within30} истекает в 30 дн.`],
          ]} />

        <TileButton
          icon={<Wrench size={16} />} title="Техобслуживание"
          value={cards.maintenance.open} unit="нар."
          sub={cards.maintenance.nextDate ? `ближайшее ${fmt(cards.maintenance.nextDate)}` : 'нарядов нет'}
          alert={cards.maintenance.overdue > 0}
          active={filter === 'maintDue'}
          onClick={() => setFilter(filter === 'maintDue' ? null : 'maintDue')}
          hint={cards.maintenance.open > 0 ? 'показать оборудование' : null}
          rows={[['🔴', `${cards.maintenance.overdue} просрочено`]]} />

        <div className="wh-bigcard">
          <div className="wh-bigcard__head"><Activity size={16} /> Загрузка кабинета</div>
          {cards.utilization.hasData ? (
            <>
              <div className={`wh-bigcard__value wh-zone wh-zone--${cards.utilization.zone}`}>
                {Math.round(cards.utilization.percent)} <small>%</small>
              </div>
              <div className="wh-bigcard__sub">
                {cards.utilization.zone === 'red' ? 'перегружен'
                  : cards.utilization.zone === 'yellow' ? 'в норме' : 'недозагружен'}
              </div>
              <div className="wh-bigcard__bar">
                <i style={{
                  width: `${Math.min(100, cards.utilization.percent)}%`,
                  background: `var(--wh-zone-${cards.utilization.zone}-line)`,
                }} />
              </div>
            </>
          ) : (
            <>
              <div className="wh-bigcard__value wh-muted">—</div>
              {/* Явно, почему пусто: иначе читается как «загрузки нет». */}
              <div className="wh-bigcard__sub">
                не рассчитана: кабинет не сопоставлен с МИС либо нет данных за период
              </div>
            </>
          )}
        </div>
      </div>

      {filter && (
        <div className="wh-alert wh-alert--info">
          <Search size={15} />
          <div>
            Показано только по фильтру «{filterLabel(filter)}».{' '}
            <button className="wh-btn wh-btn--link" onClick={() => setFilter(null)}>показать всё</button>
          </div>
        </div>
      )}

      {/* ── Основная раскладка: данные слева, внимание справа ─────────────── */}
      <div className="wh-room__layout">
        <div>
          {!kiosk && (
            <div className="wh-panel">
              <div className="wh-panel__body">
                <div className="wh-search">
                  <Search size={15} />
                  <input placeholder="Поиск по оборудованию и материалам кабинета"
                         value={q} onChange={e => setQ(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          <div className="wh-panel">
            <div className="wh-panel__head">
              <div className="wh-panel__title">
                <Package size={15} /> Оборудование кабинета ({filteredAssets.length})
              </div>
            </div>
            <div className="wh-table-wrap">
              <table className="wh-table wh-table--compact">
                <thead>
                  <tr>
                    <th>Наименование</th><th>Инв. №</th><th>Статус</th><th>След. ТО</th><th>МОЛ</th>
                    {canSeeCosts && <th className="wh-num">Первонач., ₽</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredAssets.map(a => (
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
                  {!filteredAssets.length && (
                    <tr><td colSpan={6} className="wh-empty">
                      {filter || q ? 'По условию ничего не найдено' : 'Оборудование не закреплено'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="wh-panel">
            <div className="wh-panel__head">
              <div className="wh-panel__title">
                <Boxes size={15} /> Материалы на местах хранения ({filteredStock.length})
              </div>
            </div>
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
                  {filteredStock.map((s, i) => (
                    <tr key={i} className={s.expired ? 'wh-row--expired' : s.expiringSoon ? 'wh-row--orange' : ''}>
                      <td><span className={`wh-dot wh-dot--${s.stockStatus}`} title={stockHint(s.stockStatus)} /></td>
                      <td>{s.name}</td>
                      <td className="wh-cell-sub">{s.storageName}</td>
                      <td className="wh-mono wh-cell-sub">{s.batchNumber || '—'}</td>
                      <td className={s.expired ? 'wh-danger' : ''}>{fmt(s.expiryDate)}</td>
                      <td className="wh-num"><b>{num(s.quantity)}</b> {s.unit}</td>
                      <td className="wh-num wh-cell-sub">{s.minQty === null ? '—' : num(s.minQty)}</td>
                      {canSeeCosts && <td className="wh-num">{s.amount.toLocaleString('ru-RU')}</td>}
                    </tr>
                  ))}
                  {!filteredStock.length && (
                    <tr><td colSpan={8} className="wh-empty">
                      {filter || q ? 'По условию ничего не найдено' : 'Материалов нет'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          <div className={`wh-panel ${attention.length ? 'wh-panel--warn' : ''}`}>
            <div className="wh-panel__head">
              <div className="wh-panel__title">
                <AlertTriangle size={15} /> Требуют внимания ({attention.length})
              </div>
            </div>
            <div className="wh-panel__body">
              {attention.length ? (
                <ul className="wh-attention">
                  {attention.map((a, i) => (
                    <li key={i} className={`wh-attention__item wh-attention__item--${a.level}`}>{a.text}</li>
                  ))}
                </ul>
              ) : (
                <div className="wh-alert wh-alert--ok">
                  <div>Просрочек, дефицита и незакрытых ремонтов нет.</div>
                </div>
              )}
            </div>
          </div>

          {maintenance.length > 0 && (
            <div className="wh-panel">
              <div className="wh-panel__head">
                <div className="wh-panel__title"><Wrench size={15} /> Открытые наряды ТО</div>
              </div>
              <ul className="wh-simple-list">
                {maintenance.map(m => {
                  const overdue = m.plannedDate < todayStr();
                  return (
                    <li key={m.id}>
                      <span className={`wh-dot ${overdue ? 'wh-dot--repair' : 'wh-dot--maintenance'}`} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="wh-cell-main">{m.asset?.name}</span>
                        <span className="wh-cell-sub"> · {m.number}</span>
                      </span>
                      <span className={overdue ? 'wh-danger' : ''}>{fmt(m.plannedDate)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {!kiosk && publicUrl && (
            <div className="wh-alert wh-alert--info">
              <QrCode size={15} />
              <div>
                QR-код на двери ведёт на публичную страницу кабинета: перечень
                оборудования и его статусы. Остатки материалов и суммы на неё не попадают.
              </div>
            </div>
          )}
        </div>
      </div>

      {qrModal && publicUrl && (
        <RoomQrModal room={room} url={publicUrl} onClose={() => setQrModal(false)} />
      )}
    </div>
  );
}

/**
 * Плитка-фильтр. Кнопка, а не div: по ней щёлкают, и это должно быть доступно
 * с клавиатуры и очевидно по курсору.
 */
function TileButton({ icon, title, value, unit, sub, rows, alert, active, onClick, hint }) {
  return (
    <button type="button"
            className={`wh-bigcard wh-bigcard--clickable ${alert ? 'wh-bigcard--alert' : ''} ${active ? 'is-active' : ''}`}
            onClick={onClick}
            title={hint || undefined}>
      <div className="wh-bigcard__head">{icon} {title}</div>
      <div className="wh-bigcard__value">{value} <small>{unit}</small></div>
      {sub && <div className="wh-bigcard__sub">{sub}</div>}
      <ul className="wh-bigcard__rows">
        {(rows || []).filter(r => !/^0 /.test(r[1])).map(([mark, text], i) => (
          <li key={i}>{mark} {text}</li>
        ))}
      </ul>
      {hint && <div className="wh-bigcard__sub wh-muted">{active ? 'фильтр включён' : hint}</div>}
    </button>
  );
}

function RoomQrModal({ room, url, onClose }) {
  const copy = () => {
    navigator.clipboard?.writeText(url)
      .then(() => toast.success('Ссылка скопирована'))
      .catch(() => toast.error('Не удалось скопировать'));
  };

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--narrow" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div>
            <div className="wh-modal__title">QR-код на дверь кабинета {room.number}</div>
            <div className="wh-modal__sub">Открывается без авторизации</div>
          </div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body" style={{ textAlign: 'center' }}>
          <SecureImage className="wh-qr__img"
                       alt={`QR-код кабинета ${room.number}`}
                       url={warehouseApi.roomQrUrl(room.id)} />
          <div className="wh-qr__url">
            <code>{url}</code>
            <button className="wh-icon-btn" onClick={copy} title="Скопировать"><Copy size={15} /></button>
          </div>
          <p className="wh-hint">
            Распечатайте и наклейте у входа. Страница показывает перечень оборудования
            кабинета и его статусы — без остатков материалов, сумм и ФИО.
          </p>
        </div>
        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Закрыть</button>
          <button className="wh-btn wh-btn--primary" onClick={() => window.open(url, '_blank')}>
            Открыть страницу
          </button>
        </div>
      </div>
    </div>
  );
}

const filterLabel = f => ({
  belowMin: 'ниже минимума', expired: 'сроки годности',
  repair: 'в ремонте', maintenance: 'на ТО', maintDue: 'ТО в течение 30 дней',
}[f] || f);
const stockHint = s => ({ below: 'Ниже минимума', near: 'Близко к минимуму', ok: 'Норма', unknown: 'Минимум не задан' }[s] || s);
const fmt = d => (d ? new Date(d).toLocaleDateString('ru-RU') : '—');
const num = n => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
const todayStr = () => new Date().toISOString().slice(0, 10);
