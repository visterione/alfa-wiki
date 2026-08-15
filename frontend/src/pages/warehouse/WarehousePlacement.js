import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowRight, Check, DoorOpen, Info, Package, RefreshCw, Search, Trash2,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';

/**
 * Размещение позиций ведомости по кабинетам.
 *
 * ── Почему экран развёрнут от кабинета ───────────────────────────────────────
 *
 * Раньше кабинет выбирался у ветки дерева 1С: одна ветка — один кабинет. На
 * данных сети это неверно. Под «Кабинетом Хирурга» лежит имущество пяти-шести
 * физических кабинетов, а строка «Стул СТ 6 серый, 3 шт» — это три стула, и они
 * могут стоять в трёх разных местах. Ветка отвечает на вопрос «чьё это», но не
 * на вопрос «где оно стоит», и второго ответа в файле просто нет.
 *
 * Значит собрать его можно только у человека — и собирать надо так, как он
 * работает. А работает он кабинетами: стоит в 305-м и видит, что в нём. Поэтому
 * кабинет выбирается ОДИН раз наверху, а в него набрасываются позиции пачкой:
 * сотня выборов кабинета вместо трёх тысяч, и в порядке обхода здания.
 *
 * ── Почему очередь отсортирована по деньгам ──────────────────────────────────
 *
 * Разложить всё за один заход никто не успеет. Если работа прервётся на
 * середине, пусть неразложенным останется не хирургический инструмент за
 * 300 000 ₽, а салфетки. Сортировка идёт по стоимости НЕРАЗЛОЖЕННОГО остатка, а
 * не строки: наполовину разложенная дорогая позиция должна опускаться.
 */

const money = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const num = value => {
  const n = Number(value || 0);
  return n % 1 === 0 ? n.toLocaleString('ru-RU') : n.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
};

function flattenRooms(tree) {
  const out = [];
  for (const mc of tree?.medCenters || []) {
    for (const r of mc.rooms || []) {
      out.push({
        id: r.id, storages: r.storages || [],
        label: `${mc.name} · Каб. ${r.number}`
          + (r.name && r.name !== r.number ? ` — ${r.name}` : ''),
      });
    }
    for (const b of mc.buildings || []) {
      for (const f of b.floors || []) {
        for (const r of f.rooms || []) {
          out.push({
            id: r.id,
            storages: r.storages || [],
            label: `${b.name} · ${f.number} эт. · Каб. ${r.number}`
              + (r.name && r.name !== r.number ? ` — ${r.name}` : ''),
          });
        }
      }
    }
  }
  return out;
}

export default function WarehousePlacement({ access, tree, onDone }) {
  const [queue, setQueue] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [storageId, setStorageId] = useState('');
  const [inRoom, setInRoom] = useState(null);
  const [picked, setPicked] = useState(new Map());
  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('');
  const [kind, setKind] = useState('');
  // По умолчанию показываем и то, что держится на кабинете ветки: на ведомости,
  // размеченной по веткам ещё в ver. 6.73, режим «только ничьё» дал бы пустой
  // экран — то есть ровно тогда, когда разложить всё как раз и нужно.
  const [mode, setMode] = useState('all');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const rooms = useMemo(() => flattenRooms(tree), [tree]);
  const room = rooms.find(r => r.id === roomId);
  const canEdit = Boolean(access?.capabilities?.canImportOsv);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await warehouseApi.placementQueue({
        q: q || undefined, branch: branch || undefined, kind: kind || undefined,
        mode, limit: 150,
      });
      setQueue(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить очередь');
    } finally {
      setLoading(false);
    }
  }, [q, branch, kind, mode]);

  const loadRoom = useCallback(async () => {
    if (!roomId) { setInRoom(null); return; }
    try {
      const { data } = await warehouseApi.placementsInRoom(roomId);
      setInRoom(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить содержимое кабинета');
    }
  }, [roomId]);

  useEffect(() => {
    const timer = setTimeout(loadQueue, q ? 350 : 0);
    return () => clearTimeout(timer);
  }, [loadQueue, q]);

  useEffect(() => { loadRoom(); }, [loadRoom]);

  // Смена кабинета сбрасывает и отметки, и полку: отмечали их для прошлого
  // кабинета, и уехать вместе с ним они не должны.
  useEffect(() => { setPicked(new Map()); setStorageId(''); }, [roomId]);

  const toggle = (item) => {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(item.lineKey)) next.delete(item.lineKey);
      // Пустое значение означает «весь остаток»: в девяти случаях из десяти
      // позиция целиком лежит там, где на неё смотрят.
      else next.set(item.lineKey, '');
      return next;
    });
  };

  const setQty = (lineKey, value) => setPicked((prev) => {
    const next = new Map(prev);
    next.set(lineKey, value);
    return next;
  });

  const send = async () => {
    if (!roomId) return toast.error('Выберите кабинет');
    if (!picked.size) return toast.error('Отметьте позиции');
    setSending(true);
    try {
      const { data } = await warehouseApi.placeItems({
        roomId,
        storageId: storageId || null,
        items: [...picked.entries()].map(([lineKey, quantity]) => ({
          lineKey, quantity: quantity === '' ? null : Number(quantity),
        })),
      });
      if (data.rejected?.length) {
        toast(`Размещено ${data.saved}, пропущено ${data.rejected.length}: `
          + data.rejected[0].reason, { icon: '⚠️', duration: 7000 });
      } else {
        toast.success(`Размещено позиций: ${data.saved}`);
      }
      setPicked(new Map());
      await Promise.all([loadQueue(), loadRoom()]);
      await onDone?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось разместить');
    } finally {
      setSending(false);
    }
  };

  const remove = async (row) => {
    try {
      await warehouseApi.deletePlacement(row.id);
      toast.success('Размещение снято');
      await Promise.all([loadQueue(), loadRoom()]);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось снять размещение');
    }
  };

  if (loading && !queue) return <div className="wh-table__loading"><div className="loading-spinner" /></div>;

  if (!queue?.import) {
    return (
      <div className="wh-empty">
        Нет принятого снимка. Загрузите ведомость на вкладке «Снимок» и примите её.
      </div>
    );
  }

  const t = queue.totals;
  const totalUnits = (t?.placedUnits || 0) + (t?.unplacedUnits || 0);
  const percent = totalUnits ? Math.round((t.placedUnits / totalUnits) * 100) : 0;

  return (
    <div className="wh-place">
      <div className="wh-panel">
        <div className="wh-panel__head">
          <div className="wh-panel__title">
            Разложено {num(t?.placedUnits)} из {num(totalUnits)} единиц · {percent}%
          </div>
          <div className="wh-panel__actions">
            <button className="wh-btn wh-btn--ghost wh-btn--sm" onClick={loadQueue}>
              <RefreshCw size={13} /> Обновить
            </button>
          </div>
        </div>
        <div className="wh-panel__body">
          <div className="wh-osv-map__bar">
            <div className="wh-osv-map__fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="wh-osv-map__legend">
            <span>позиций в очереди: {queue.total}</span>
            <span className="wh-muted">строк с размещением: {t?.linesWithPlacement || 0}</span>
          </div>
        </div>
      </div>

      <div className="wh-note wh-note--subtle">
        <Info size={15} />
        <div>
          Кабинет выбирается один раз, а позиции набрасываются в него пачкой.
          Количество можно не указывать — тогда переедет весь нераспределённый
          остаток позиции. Инвентарный номер выдаётся не здесь, а при создании
          карточек на вкладке «Разбор»: он содержит код специальности отделения
          этого кабинета и потом не меняется.
        </div>
      </div>

      <div className="wh-place__room">
        <label>
          <DoorOpen size={14} /> Кабинет
          <select value={roomId} onChange={e => setRoomId(e.target.value)}>
            <option value="">Выберите кабинет…</option>
            {rooms.map(r => (
              <option key={r.id} value={r.id} disabled={!r.storages.length}>
                {r.label}{r.storages.length ? '' : ' (нет мест хранения)'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Место хранения
          <select value={storageId} disabled={!room}
                  onChange={e => setStorageId(e.target.value)}>
            <option value="">Первое в кабинете</option>
            {(room?.storages || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <button className="wh-btn wh-btn--primary" disabled={!canEdit || !roomId || !picked.size || sending}
                onClick={send}>
          <ArrowRight size={15} /> {sending ? 'Размещаю…' : `Положить сюда (${picked.size})`}
        </button>
      </div>

      <div className="wh-place__cols">
        <div className="wh-place__queue">
          <div className="wh-subhead"><Package size={15} /> Ещё нигде не лежит</div>
          <div className="wh-assets__filters">
            <div className="wh-search">
              <Search size={15} />
              <input value={q} placeholder="Название или ветка"
                     onChange={e => setQ(e.target.value)} />
            </div>
            <select value={branch} onChange={e => setBranch(e.target.value)}>
              <option value="">Все ветки 1С</option>
              {(queue.branches || []).map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={kind} onChange={e => setKind(e.target.value)}>
              <option value="">Всё</option>
              <option value="asset">Только карточки</option>
              <option value="material">Только остатки</option>
            </select>
            <select value={mode} onChange={e => setMode(e.target.value)}>
              <option value="all">Всё, что не разложено вручную</option>
              <option value="unplaced">Только то, что вообще нигде</option>
            </select>
          </div>

          <div className="wh-table-wrap wh-table-wrap--tall">
            <table className="wh-table wh-table--compact">
              <thead>
                <tr>
                  <th />
                  <th>Позиция</th>
                  <th className="wh-num">Осталось</th>
                  <th className="wh-num">Цена за ед.</th>
                  <th className="wh-num">Сколько сюда</th>
                </tr>
              </thead>
              <tbody>
                {queue.items.map((item) => {
                  const checked = picked.has(item.lineKey);
                  return (
                    <tr key={item.lineKey} className={checked ? 'wh-row--picked' : ''}>
                      <td>
                        <input type="checkbox" checked={checked} disabled={!canEdit}
                               onChange={() => toggle(item)} />
                      </td>
                      <td onClick={() => canEdit && toggle(item)}>
                        <div className="wh-cell-main">{item.name}</div>
                        <div className="wh-cell-sub wh-muted">
                          {item.pathText || 'без ветки'}
                          {' · '}
                          {item.kind === 'asset' ? 'карточками' : 'остатком'}
                          {item.placedQty > 0 && ` · уже разложено ${num(item.placedQty)}`}
                          {/* Строка держится на кабинете ветки — это и есть тот
                              способ, который на данных сети неверен. Показываем
                              явно, чтобы было видно, что именно замещается. */}
                          {item.branchRoomId && (
                            <span className="wh-warn">
                              {' · '}сейчас по ветке: {
                                rooms.find(r => r.id === item.branchRoomId)?.label || 'кабинет ветки'
                              }
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="wh-num">
                        <b>{num(item.unplacedQty)}</b>
                        <div className="wh-cell-sub wh-muted">из {num(item.totalQty)} {item.unit}</div>
                      </td>
                      <td className="wh-num">{item.unitCost === null ? '—' : money(item.unitCost)}</td>
                      <td className="wh-num">
                        {checked && (
                          <input className="wh-input--qty" type="number" min="0.001" step="1"
                                 value={picked.get(item.lineKey)}
                                 placeholder={num(item.unplacedQty)}
                                 onChange={e => setQty(item.lineKey, e.target.value)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!queue.items.length && (
                  <tr><td colSpan={5} className="wh-empty">
                    Нераспределённого не осталось — всё имущество ведомости разложено по кабинетам.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {queue.total > queue.items.length && (
            <div className="wh-assets__count">
              Показано {queue.items.length} из {queue.total} — сузьте поиск или ветку
            </div>
          )}
        </div>

        <div className="wh-place__room-content">
          <div className="wh-subhead">
            <DoorOpen size={15} /> {inRoom?.room ? `В кабинете ${inRoom.room.number}` : 'Кабинет не выбран'}
          </div>
          {!roomId && (
            <div className="wh-empty">
              Выберите кабинет сверху — здесь появится то, что в него уже положено.
            </div>
          )}
          {roomId && inRoom && (
            <div className="wh-table-wrap wh-table-wrap--tall">
              <table className="wh-table wh-table--compact">
                <thead>
                  <tr><th>Позиция</th><th className="wh-num">Кол-во</th><th>Место</th><th /></tr>
                </thead>
                <tbody>
                  {inRoom.items.map(row => (
                    <tr key={row.id}>
                      <td>
                        <div className="wh-cell-main">{row.name}</div>
                        <div className="wh-cell-sub wh-muted">
                          {row.pathText || '—'}
                          {row.materialized > 0 && (
                            <span className="wh-ok"> · карточек создано: {row.materialized}</span>
                          )}
                        </div>
                      </td>
                      <td className="wh-num">{num(row.quantity)}</td>
                      <td className="wh-cell-sub">{row.storage?.name || 'первое в кабинете'}</td>
                      <td className="wh-num">
                        {canEdit && (
                          <button className="wh-icon-btn wh-icon-btn--danger"
                                  title={row.materialized
                                    ? 'Карточки уже созданы — переезд оформляется перемещением'
                                    : 'Снять размещение'}
                                  onClick={() => remove(row)}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!inRoom.items.length && (
                    <tr><td colSpan={4} className="wh-empty">В этот кабинет ещё ничего не положено</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {roomId && inRoom?.items?.length > 0 && (
            <div className="wh-hint">
              <Check size={13} /> Карточки и остатки создаются на вкладке «Разбор» —
              там же виден инвентарный номер, который получит каждая вещь.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
