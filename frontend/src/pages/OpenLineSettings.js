import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Users, Bot, Save, Power, X } from 'lucide-react';
import { openLine as api, users as usersApi } from '../services/api';
import toast from 'react-hot-toast';

/**
 * Настройка линий открытой линии (ver. 7.94).
 *
 * До сих пор линии, состав и привязка ботов заводились скриптом. Для шести
 * медцентров и двенадцати ботов этого мало: состав меняется чаще, чем хочется
 * ходить в консоль, а ошибиться в идентификаторе руками легко.
 *
 * Состав линии — это и есть право работать в ней: отдельного разрешения нет,
 * иначе одно и то же настраивалось бы в двух местах и неизбежно разошлось бы.
 */

export default function OpenLineSettings() {
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', medCenterId: '' });
  const [replies, setReplies] = useState({});

  const load = useCallback(async () => {
    try {
      const { data } = await api.lines();
      setData(data);
      setReplies({});
    } catch {
      toast.error('Не удалось загрузить линии');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // Список сотрудников нужен только для добавления в состав, поэтому грузим
    // его один раз и не обновляем: состав правят редко.
    // listBasic, а не полный список: здесь нужны только имя и идентификатор, и
    // он доступен любому сотруднику, а не только администратору.
    usersApi.listBasic()
      .then(({ data }) => setStaff((data.users || data || []).filter(u => u.isActive !== false)))
      .catch(() => {});
  }, []);

  const create = async () => {
    if (!draft.name.trim()) return toast.error('Нужно название линии');
    try {
      await api.createLine({ name: draft.name.trim(), medCenterId: draft.medCenterId || null });
      setDraft({ name: '', medCenterId: '' });
      setCreating(false);
      load();
    } catch {
      toast.error('Не удалось создать линию');
    }
  };

  const update = async (line, patch) => {
    try {
      await api.updateLine(line.id, patch);
      load();
    } catch {
      toast.error('Не удалось сохранить');
    }
  };

  const addOperator = async (line, userId) => {
    if (!userId) return;
    try {
      await api.addOperator(line.id, userId);
      load();
    } catch {
      toast.error('Не удалось добавить сотрудника');
    }
  };

  const removeOperator = async (line, userId) => {
    try {
      await api.removeOperator(line.id, userId);
      load();
    } catch {
      toast.error('Не удалось убрать сотрудника');
    }
  };

  const bindBot = async (lineId, botId) => {
    try {
      await api.bindBot(lineId, botId);
      load();
    } catch {
      toast.error('Не удалось привязать бота');
    }
  };

  if (!data) return <div className="nt-root"><p className="nt-hint">Загрузка…</p></div>;

  const looseBots = data.bots.filter(b => !b.lineId);

  return (
    <div className="nt-root">
      <div className="ols-head">
        <p className="nt-hint">
          Линия на медцентр: свой состав сотрудников и свои боты. Новые обращения видят
          только те, кто начал день. Кто заведён в состав — тот и отвечает, отдельного
          права для этого нет.
        </p>
        <button className="nt-btn primary" onClick={() => setCreating(v => !v)}>
          <Plus size={14} /> Новая линия
        </button>
      </div>

      {creating && (
        <section className="nt-card ols-new">
          <input
            placeholder="Название линии, например «Альфа — колл-центр»"
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          />
          <select value={draft.medCenterId} onChange={e => setDraft(d => ({ ...d, medCenterId: e.target.value }))}>
            <option value="">без медцентра (проверочная)</option>
            {(data.medCenters || []).map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
          </select>
          <button className="nt-btn primary" onClick={create}><Save size={14} /> Создать</button>
        </section>
      )}

      {data.lines.length === 0 && <p className="nt-hint">Линий пока нет.</p>}

      {data.lines.map(line => {
        const bots = data.bots.filter(b => b.lineId === line.id);
        const inLine = new Set((line.operators || []).map(o => o.userId));

        return (
          <section key={line.id} className={`nt-card ols-line ${line.isActive ? '' : 'off'}`}>
            <header>
              <h3>
                {line.name}
                {line.medCenter && <span className="nt-when">{line.medCenter.name}</span>}
              </h3>
              <button
                className="nt-btn"
                onClick={() => update(line, { isActive: !line.isActive })}
                title={line.isActive ? 'Выключить линию' : 'Включить линию'}
              >
                <Power size={14} /> {line.isActive ? 'Включена' : 'Выключена'}
              </button>
            </header>

            <div className="ols-block">
              <h4><Bot size={14} /> Боты</h4>
              {bots.length === 0 && (
                <p className="nt-hint">Бот не привязан — обращения из мессенджеров сюда не попадут.</p>
              )}
              <div className="ols-chips">
                {bots.map(b => (
                  <span key={b.id} className="nt-chip">
                    {b.platform === 'max' ? 'MAX' : 'Telegram'} @{b.username}
                    <button title="Отвязать" onClick={() => bindBot('none', b.id)}><X size={11} /></button>
                  </span>
                ))}
                {looseBots.length > 0 && (
                  <select value="" onChange={e => bindBot(line.id, e.target.value)}>
                    <option value="">+ привязать бота…</option>
                    {looseBots.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.platform === 'max' ? 'MAX' : 'Telegram'} @{b.username} ({b.organization})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="ols-block">
              <h4><Users size={14} /> Состав</h4>
              <div className="ols-chips">
                {(line.operators || []).map(o => (
                  <span key={o.userId} className={`nt-chip ${o.onShift ? 'ok' : ''}`}>
                    {o.user ? (o.user.displayName || o.user.username) : o.userId}
                    {o.onShift && ' · на смене'}
                    <button title="Убрать" onClick={() => removeOperator(line, o.userId)}><X size={11} /></button>
                  </span>
                ))}
                <select value="" onChange={e => addOperator(line, e.target.value)}>
                  <option value="">+ добавить сотрудника…</option>
                  {staff.filter(u => !inLine.has(u.id)).map(u => (
                    <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="ols-block">
              <h4>Ответ, когда на линии никого</h4>
              <textarea
                rows={2}
                placeholder="Сейчас все операторы заняты или смена завершена. Мы видим ваше сообщение и ответим, как только линия откроется."
                value={replies[line.id] !== undefined ? replies[line.id] : (line.offlineReply || '')}
                onChange={e => setReplies(r => ({ ...r, [line.id]: e.target.value }))}
              />
              <p className="nt-hint">Отправляется один раз за обращение, а не на каждое сообщение.</p>
              <div className="nt-card-actions-row">
                <button
                  className="nt-btn primary"
                  disabled={replies[line.id] === undefined || replies[line.id] === (line.offlineReply || '')}
                  onClick={() => update(line, { offlineReply: replies[line.id] })}
                >
                  <Save size={14} /> Сохранить ответ
                </button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
