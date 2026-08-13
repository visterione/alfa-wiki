import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ShieldCheck, Users, Table2, UserCheck, Info, Check, X, Lock, Search,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';

/**
 * Настройка доступа к модулю.
 *
 * Три вкладки, и это не произвол, а три разных вопроса, которые задают про права:
 *
 *   • «Кто вообще что видит» — матрица отчётов из ТЗ. Справочник, не настройка:
 *     списки ролей согласованы с заказчиком, и менять их через интерфейс значило
 *     бы тихо разойтись с документом.
 *
 *   • «Кому выдать роль» — сопоставление ролей портала с ролями модуля. Здесь и
 *     настраивают. Выводимые роли (зав. отделением, МОЛ, председатель комиссии)
 *     тут не назначаются: они следуют из данных, и об этом сказано прямо.
 *
 *   • «А что увидит конкретно Иванова» — самый частый вопрос, и на него нельзя
 *     отвечать пересказом таблицы. Расчёт делает сервер тем же кодом, что и на
 *     боевых запросах.
 */

const SCOPE_LABEL = {
  network: 'вся сеть',
  department: 'только свои отделения и кабинеты',
  none: 'нет доступа',
};

export default function WarehouseAccess({ access }) {
  const [tab, setTab] = useState('matrix');
  const [matrix, setMatrix] = useState(null);
  const [grants, setGrants] = useState([]);
  const [users, setUsers] = useState([]);
  const [effective, setEffective] = useState(null);
  const [userQuery, setUserQuery] = useState('');
  const [saving, setSaving] = useState(null);

  const canManage = access?.capabilities?.canManageAccess;

  const load = useCallback(async () => {
    try {
      const { data } = await warehouseApi.accessMatrix();
      setMatrix(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить матрицу доступа');
    }
    if (!canManage) return;
    try {
      const [g, u] = await Promise.all([warehouseApi.roleGrants(), warehouseApi.accessUsers()]);
      setGrants(g.data);
      setUsers(u.data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить роли портала');
    }
  }, [canManage]);

  useEffect(() => { load(); }, [load]);

  const assignable = useMemo(
    () => (matrix?.roles || []).filter(r => r.kind === 'assigned'),
    [matrix]
  );
  const derived = useMemo(
    () => (matrix?.roles || []).filter(r => r.kind === 'derived'),
    [matrix]
  );

  const toggleGrant = async (role, roleKey) => {
    const next = role.warehouseRoles.includes(roleKey)
      ? role.warehouseRoles.filter(k => k !== roleKey)
      : [...role.warehouseRoles, roleKey];
    setSaving(role.id);
    try {
      await warehouseApi.setRoleGrants(role.id, { warehouseRoles: next });
      setGrants(prev => prev.map(r => (r.id === role.id ? { ...r, warehouseRoles: next } : r)));
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving(null);
    }
  };

  const checkUser = async (userId) => {
    if (!userId) { setEffective(null); return; }
    try {
      const { data } = await warehouseApi.effectiveAccess(userId);
      setEffective(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось рассчитать доступ');
    }
  };

  if (!matrix) return <div className="wh-page--center"><div className="loading-spinner" /></div>;

  const filteredUsers = users.filter(u =>
    !userQuery
    || (u.displayName || '').toLowerCase().includes(userQuery.toLowerCase())
    || (u.username || '').toLowerCase().includes(userQuery.toLowerCase()));

  return (
    <div className="wh-access">
      <div className="wh-tabs wh-tabs--sub">
        <button className={tab === 'matrix' ? 'is-active' : ''} onClick={() => setTab('matrix')}>
          <Table2 size={14} /> Кто что видит
        </button>
        {canManage && (
          <button className={tab === 'grants' ? 'is-active' : ''} onClick={() => setTab('grants')}>
            <Users size={14} /> Назначение ролей
          </button>
        )}
        {canManage && (
          <button className={tab === 'check' ? 'is-active' : ''} onClick={() => setTab('check')}>
            <UserCheck size={14} /> Проверка доступа
          </button>
        )}
      </div>

      {/* ── Мои права ───────────────────────────────────────────────────────── */}
      <div className="wh-panel">
        <div className="wh-panel__head">
          <div className="wh-panel__title"><ShieldCheck size={15} /> Ваши права в модуле</div>
        </div>
        <div className="wh-panel__body">
          <div className="wh-access__my">
            <div>
              <span className="wh-field-ro__label">Роли</span>
              <div className="wh-chiplist">
                {(matrix.my.roles || []).map(k => {
                  const def = matrix.roles.find(r => r.key === k);
                  return (
                    <span key={k} className={`wh-rolechip ${def?.kind === 'derived' ? 'is-derived' : ''}`}
                          title={def?.hint}>
                      {def?.label || k}
                      {def?.kind === 'derived' && <small>из данных</small>}
                    </span>
                  );
                })}
                {!matrix.my.roles?.length && <span className="wh-muted">роли не назначены</span>}
              </div>
            </div>
            <div>
              <span className="wh-field-ro__label">Область видимости</span>
              <div className={`wh-scope wh-scope--${matrix.my.scope}`}>{SCOPE_LABEL[matrix.my.scope]}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Матрица отчётов ─────────────────────────────────────────────────── */}
      {tab === 'matrix' && (
        <>
          <div className="wh-alert wh-alert--info">
            <Info size={15} />
            <div>
              Списки ролей взяты из ТЗ и через интерфейс не меняются — иначе настройка
              тихо разошлась бы с согласованным документом. Настраивается другое: кому
              из сотрудников какая роль достаётся, на вкладке «Назначение ролей».
              Ваши роли подсвечены.
            </div>
          </div>

          <div className="wh-panel">
            <div className="wh-panel__head">
              <div className="wh-panel__title"><Table2 size={15} /> Отчёты и экраны</div>
            </div>
            <div className="wh-table-wrap">
              <table className="wh-table wh-table--compact wh-access__matrix">
                <thead>
                  <tr>
                    <th>Отчёт или экран</th>
                    {matrix.roles.map(r => (
                      <th key={r.key} className="wh-access__rolecol" title={`${r.label}${r.hint ? ` — ${r.hint}` : ''}`}>
                        <span>{r.label}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.reports.map(rep => (
                    <tr key={rep.code}>
                      <td>
                        <div className="wh-cell-main">{rep.title}</div>
                        <div className="wh-cell-sub wh-mono">{rep.code}</div>
                      </td>
                      {matrix.roles.map(r => {
                        const canRead = rep.read.includes(r.key);
                        const canWrite = rep.write.includes(r.key);
                        const mine = matrix.my.roles?.includes(r.key);
                        return (
                          <td key={r.key}
                              className={`wh-access__cell ${mine ? 'is-mine' : ''}`}
                              title={canWrite ? 'Просмотр и изменение' : canRead ? 'Только просмотр' : 'Нет доступа'}>
                            {canWrite ? <b className="wh-ok">✎</b>
                              : canRead ? <Check size={13} className="wh-access__yes" />
                              : <span className="wh-access__no">·</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="wh-panel__body wh-access__legend">
              <span><Check size={13} className="wh-access__yes" /> просмотр</span>
              <span><b className="wh-ok">✎</b> просмотр и изменение</span>
              <span><span className="wh-access__no">·</span> нет доступа</span>
              <span className="wh-access__mine-hint">Подсвечены колонки ваших ролей</span>
            </div>
          </div>

          <div className="wh-panel">
            <div className="wh-panel__head">
              <div className="wh-panel__title">Возможности</div>
            </div>
            <div className="wh-table-wrap">
              <table className="wh-table wh-table--compact">
                <thead>
                  <tr>
                    <th>Действие</th><th>Кому доступно</th><th style={{ width: 90 }}>У вас</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.capabilities.map(c => (
                    <tr key={c.key}>
                      <td>{c.title}</td>
                      <td className="wh-cell-sub">
                        {c.roles.map(k => matrix.roles.find(r => r.key === k)?.label || k).join(', ')}
                      </td>
                      <td>
                        {matrix.my.capabilities?.[c.key]
                          ? <span className="wh-status wh-status--in_use">есть</span>
                          : <span className="wh-status wh-status--written_off">нет</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Назначение ролей ────────────────────────────────────────────────── */}
      {tab === 'grants' && canManage && (
        <>
          <div className="wh-alert wh-alert--info">
            <Info size={15} />
            <div>
              Роли модуля выдаются ролям портала — тем же механизмом, что и остальные
              права. Человек получает роль модуля, потому что состоит в роли портала;
              отдельного списка людей здесь нет намеренно, иначе он разошёлся бы с
              кадровыми изменениями.
            </div>
          </div>

          <div className="wh-panel">
            <div className="wh-panel__head">
              <div className="wh-panel__title"><Users size={15} /> Роли портала → роли модуля</div>
            </div>
            <div className="wh-table-wrap">
              <table className="wh-table wh-table--compact">
                <thead>
                  <tr>
                    <th>Роль портала</th>
                    <th style={{ width: 80 }} className="wh-num">Человек</th>
                    <th>Роли в складском модуле</th>
                  </tr>
                </thead>
                <tbody>
                  {grants.map(role => (
                    <tr key={role.id}>
                      <td>
                        <div className="wh-cell-main">{role.name}</div>
                        {role.description && <div className="wh-cell-sub">{role.description}</div>}
                      </td>
                      <td className="wh-num wh-cell-sub">{role.users ?? '—'}</td>
                      <td>
                        <div className="wh-chiplist">
                          {assignable.map(r => {
                            const on = role.warehouseRoles.includes(r.key);
                            return (
                              <button key={r.key}
                                      className={`wh-chip ${on ? 'is-active' : ''}`}
                                      disabled={saving === role.id}
                                      title={r.hint}
                                      onClick={() => toggleGrant(role, r.key)}>
                                {on && <Check size={11} />} {r.label}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!grants.length && <tr><td colSpan={3} className="wh-empty">Ролей нет</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="wh-panel">
            <div className="wh-panel__head">
              <div className="wh-panel__title"><Lock size={15} /> Роли, которые не назначаются</div>
            </div>
            <div className="wh-panel__body">
              <p className="wh-hint">
                Эти роли следуют из данных и появляются у человека сами. Выдавать их
                галочкой было бы ошибкой: сегодня человек ведёт кабинет, завтра нет —
                права должны меняться вместе с этим фактом, а не отдельной заявкой.
              </p>
              <ul className="wh-simple-list">
                {derived.map(r => (
                  <li key={r.key}>
                    <span className="wh-cell-main">{r.label}</span>
                    <span className="wh-cell-sub">{r.hint}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}

      {/* ── Проверка доступа ────────────────────────────────────────────────── */}
      {tab === 'check' && canManage && (
        <>
          <div className="wh-alert wh-alert--info">
            <Info size={15} />
            <div>
              Расчёт делает сервер тем же кодом, что и на боевых запросах, — это не
              пересказ таблицы, а ответ на вопрос «что человек реально откроет».
            </div>
          </div>

          <div className="wh-panel">
            <div className="wh-panel__head">
              <div className="wh-panel__title"><UserCheck size={15} /> Сотрудник</div>
            </div>
            <div className="wh-panel__body">
              <div className="wh-search">
                <Search size={15} />
                <input placeholder="Поиск по имени или логину"
                       value={userQuery} onChange={e => setUserQuery(e.target.value)} />
              </div>
              <div className="wh-access__users">
                {filteredUsers.slice(0, 40).map(u => (
                  <button key={u.id}
                          className={`wh-chip ${effective?.user?.id === u.id ? 'is-active' : ''}`}
                          onClick={() => checkUser(u.id)}>
                    {u.displayName || u.username}
                    {u.isAdmin && <small> · админ</small>}
                  </button>
                ))}
                {!filteredUsers.length && (
                  <span className="wh-muted">
                    Никого не найдено. В списке только сотрудники с доступом к разделу.
                  </span>
                )}
              </div>
            </div>
          </div>

          {effective && !effective.allowed && (
            <div className="wh-alert wh-alert--warning">
              <X size={15} />
              <div>
                <b>{effective.user.displayName || effective.user.username}</b> — доступа нет.
                {' '}{effective.reason}
              </div>
            </div>
          )}

          {effective?.allowed && (
            <div className="wh-panel">
              <div className="wh-panel__head">
                <div className="wh-panel__title">
                  {effective.user.displayName || effective.user.username}
                </div>
                <div className={`wh-scope wh-scope--${effective.scope}`}>
                  {SCOPE_LABEL[effective.scope]}
                  {effective.visibleRooms !== 'all' && ` · кабинетов: ${effective.visibleRooms}`}
                </div>
              </div>
              <div className="wh-panel__body">
                <div className="wh-grid2">
                  <div className="wh-field-ro">
                    <span className="wh-field-ro__label">Роли портала</span>
                    <span className="wh-field-ro__value">
                      {effective.user.portalRoles.join(', ') || '—'}
                    </span>
                  </div>
                  <div className="wh-field-ro">
                    <span className="wh-field-ro__label">Роли в модуле</span>
                    <span className="wh-field-ro__value">
                      <div className="wh-chiplist">
                        {effective.roles.map(r => (
                          <span key={r.key} className={`wh-rolechip ${r.kind === 'derived' ? 'is-derived' : ''}`}>
                            {r.label}{r.kind === 'derived' && <small>из данных</small>}
                          </span>
                        ))}
                        {!effective.roles.length && <span className="wh-muted">нет ролей</span>}
                      </div>
                    </span>
                  </div>
                </div>
              </div>
              <div className="wh-table-wrap">
                <table className="wh-table wh-table--compact">
                  <thead>
                    <tr><th>Отчёт или экран</th><th style={{ width: 130 }}>Доступ</th></tr>
                  </thead>
                  <tbody>
                    {effective.reports.map(r => (
                      <tr key={r.code} className={r.read ? '' : 'wh-access__denied'}>
                        <td>
                          <div className="wh-cell-main">{r.title}</div>
                          <div className="wh-cell-sub wh-mono">{r.code}</div>
                        </td>
                        <td>
                          {r.write ? <span className="wh-status wh-status--in_use">просмотр и изменение</span>
                            : r.read ? <span className="wh-status wh-status--planned">просмотр</span>
                            : <span className="wh-status wh-status--written_off">нет</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
