import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Headphones, FileText, Radio, ScrollText, Plus, Users, Bot, Save, Power, X,
  Check, AlertTriangle, Clock, Ban, Eye, ArrowUp, ArrowDown, Moon, Send,
  ListChecks, HelpCircle, Search, Wallet, Inbox
} from 'lucide-react';
import { openLine as lineApi, notifications as notifApi, users as usersApi } from '../../services/api';
import toast from 'react-hot-toast';
import './AdminOpenLine.css';

/**
 * Настройки открытой линии и оповещений (ver. 8.02).
 *
 * До 8.02 это были две вкладки внутри самого модуля открытой линии, рядом с
 * очередью обращений. Модуль при этом — рабочее окно оператора колл-центра, и
 * соседство получилось неудачным: в одном клике от списка обращений лежали
 * состав линий, тексты уведомлений всей сети и токены провайдера. Прав это не
 * нарушало (вкладки показывались только администратору), но само присутствие
 * лишних вкладок в рабочем окне сбивало, а один промах мимо вкладки уводил
 * человека туда, где ему делать нечего.
 *
 * Теперь настройки — отдельный раздел админки, и открытая линия у оператора
 * состоит ровно из того, чем он занят: обращения и показатели.
 *
 * Журнал отправок переехал сюда же. Прежде он был открыт операторам намеренно —
 * «почему пациенту не пришло напоминание» спрашивают у колл-центра. Но лежал он
 * вплотную к каскаду и тихим часам, а разбирать недоставку всё равно приходится
 * тому, кто может поправить причину.
 *
 * Оформление — см. шапку AdminOpenLine.css: там расписано, что именно было не
 * так с прежним экраном и каким решением здесь правится каждая беда.
 */

// ── Справочники ───────────────────────────────────────────────────────────

const TABS = [
  { key: 'lines',    label: 'Линии',    icon: Headphones },
  { key: 'texts',    label: 'Тексты',   icon: FileText },
  { key: 'delivery', label: 'Рассылка', icon: Radio },
  { key: 'log',      label: 'Журнал',   icon: ScrollText }
];

const EVENT_TITLES = {
  created: 'Запись на визит',
  moved: 'Перенос визита',
  cancelled: 'Отмена визита',
  reminder: 'Напоминание о визите',
  review: 'Просьба об отзыве',
  lab_full: 'Результаты анализов готовы',
  lab_partial: 'Часть результатов готова',
  test: 'Проверочная отправка'
};

const STATUS_VIEW = {
  sent:    { label: 'доставлено',    icon: Check,         cls: 'ok'    },
  pending: { label: 'ждёт отправки', icon: Clock,         cls: 'wait'  },
  failed:  { label: 'не доставлено', icon: AlertTriangle, cls: 'bad'   },
  skipped: { label: 'пропущено',     icon: Ban,           cls: 'muted' }
};

function beforeLabel(minutes) {
  if (!minutes) return '';
  if (minutes % 1440 === 0) return `за ${minutes / 1440} сут.`;
  if (minutes % 60 === 0) return `за ${minutes / 60} ч.`;
  return `за ${minutes} мин.`;
}

/**
 * Во сколько SMS обойдётся текст. Кириллица кодируется в UCS-2, и это 70
 * символов на сообщение против 160 латиницей; в длинном тексте на каждый
 * сегмент уходит ещё меньше — часть занимает служебный заголовок. Один лишний
 * символ здесь стоит вторую SMS на всю рассылку, поэтому счётчик виден прямо
 * под полем, а не выясняется по счёту в конце месяца.
 */
function smsCost(text) {
  const value = text || '';
  // Latin-1 determined by code point rather than a regex range: an escape
  // sequence here is too easy to turn into a real control byte on edit.
  const unicode = [...value].some(ch => ch.codePointAt(0) > 127);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;

  const chars = value.length;
  const parts = chars === 0 ? 0 : (chars <= single ? 1 : Math.ceil(chars / multi));
  const limit = parts <= 1 ? single : multi * parts;

  return { chars, parts, limit, unicode };
}

// ── Общие мелочи интерфейса ───────────────────────────────────────────────

/**
 * Свёрнутое объяснение. Длинные тексты не выброшены — они помнят, почему
 * настройка устроена именно так, — но по умолчанию не занимают экран.
 */
function Why({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`ola-why ${open ? 'open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title={open ? 'Свернуть' : 'Зачем это'}
        aria-expanded={open}
      >
        <HelpCircle size={13} />
      </button>
      {open && <div className="ola-why-body">{children}</div>}
    </>
  );
}

function Switch({ checked, onChange, children, disabled }) {
  return (
    <label className="ola-switch">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="track" />
      <span>{children}</span>
    </label>
  );
}

function Check1({ checked, onChange, children }) {
  return (
    <label className={`ola-check ${checked ? 'on' : ''}`}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

// ══ Вкладка «Линии» ═══════════════════════════════════════════════════════

/**
 * Линия на медцентр: свой состав сотрудников и свои боты. Состав линии — это и
 * есть право работать в ней; отдельного разрешения нет намеренно, иначе одно и
 * то же настраивалось бы в двух местах и неизбежно разошлось бы.
 */
function LinesTab() {
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', medCenterId: '' });
  const [replies, setReplies] = useState({});

  const load = useCallback(async () => {
    try {
      const { data } = await lineApi.lines();
      setData(data);
      setReplies({});
    } catch {
      toast.error('Не удалось загрузить линии');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // Список сотрудников нужен только для добавления в состав: грузим один раз
    // и не обновляем, состав правят редко. listBasic, а не полный список —
    // здесь нужны имя и идентификатор, и он доступен любому сотруднику.
    usersApi.listBasic()
      .then(({ data }) => setStaff((data.users || data || []).filter(u => u.isActive !== false)))
      .catch(() => {});
  }, []);

  const create = async () => {
    if (!draft.name.trim()) return toast.error('Нужно название линии');
    try {
      await lineApi.createLine({ name: draft.name.trim(), medCenterId: draft.medCenterId || null });
      setDraft({ name: '', medCenterId: '' });
      setCreating(false);
      load();
    } catch {
      toast.error('Не удалось создать линию');
    }
  };

  const guard = (fn, message) => async (...args) => {
    try { await fn(...args); load(); } catch { toast.error(message); }
  };

  const update = guard((line, patch) => lineApi.updateLine(line.id, patch), 'Не удалось сохранить');
  const addOperator = guard((line, userId) => lineApi.addOperator(line.id, userId), 'Не удалось добавить сотрудника');
  const removeOperator = guard((line, userId) => lineApi.removeOperator(line.id, userId), 'Не удалось убрать сотрудника');
  const bindBot = guard((lineId, botId) => lineApi.bindBot(lineId, botId), 'Не удалось привязать бота');

  if (!data) return <p className="ola-lead">Загрузка…</p>;

  const looseBots = data.bots.filter(b => !b.lineId);
  const botTitle = (b) => `${b.platform === 'max' ? 'MAX' : 'Telegram'} @${b.username}`;

  return (
    <>
      <div className="ola-actions end" style={{ marginBottom: 14 }}>
        <button className="ola-btn primary" onClick={() => setCreating(v => !v)}>
          <Plus size={15} /> Новая линия
        </button>
      </div>

      {creating && (
        <section className="ola-card">
          <header><h3>Новая линия</h3></header>
          <div className="ola-card-body">
            <div className="ola-row">
              <div className="ola-field">
                <label>Название</label>
                <input
                  className="ola-input"
                  placeholder="Например, «Альфа — колл-центр»"
                  value={draft.name}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                />
              </div>
              <div className="ola-field">
                <label>Медцентр</label>
                <select
                  className="ola-select"
                  value={draft.medCenterId}
                  onChange={e => setDraft(d => ({ ...d, medCenterId: e.target.value }))}
                >
                  <option value="">без медцентра (проверочная)</option>
                  {(data.medCenters || []).map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
                </select>
              </div>
              <button className="ola-btn primary" onClick={create}><Save size={15} /> Создать</button>
            </div>
          </div>
        </section>
      )}

      {data.lines.length === 0 && !creating && (
        <div className="ola-empty">
          <Headphones size={34} />
          <h3>Линий пока нет</h3>
          <p>Линия — это медцентр, его боты и его состав сотрудников. Обращения из ботов без линии никуда не попадут.</p>
        </div>
      )}

      {data.lines.map(line => {
        const bots = data.bots.filter(b => b.lineId === line.id);
        const inLine = new Set((line.operators || []).map(o => o.userId));
        const reply = replies[line.id] !== undefined ? replies[line.id] : (line.offlineReply || '');

        return (
          <section key={line.id} className={`ola-card ${line.isActive ? '' : 'off'}`}>
            <header>
              <h3>
                <Headphones size={16} />
                {line.name}
              </h3>
              {line.medCenter && <span className="ola-badge accent">{line.medCenter.name}</span>}
              {!line.isActive && <span className="ola-badge warn">выключена</span>}
              <button
                className="ola-btn"
                onClick={() => update(line, { isActive: !line.isActive })}
                title={line.isActive ? 'Выключить линию' : 'Включить линию'}
              >
                <Power size={14} /> {line.isActive ? 'Выключить' : 'Включить'}
              </button>
            </header>

            <div className="ola-card-body">
              <div className="ola-block">
                <h4><Bot size={13} /> Боты</h4>
                <div className="ola-chips">
                  {bots.map(b => (
                    <span key={b.id} className="ola-chip">
                      {botTitle(b)}
                      <button title="Отвязать" onClick={() => bindBot('none', b.id)}><X size={12} /></button>
                    </span>
                  ))}
                  {looseBots.length > 0 && (
                    <select className="ola-add" value="" onChange={e => e.target.value && bindBot(line.id, e.target.value)}>
                      <option value="">+ привязать бота…</option>
                      {looseBots.map(b => (
                        <option key={b.id} value={b.id}>{botTitle(b)} ({b.organization})</option>
                      ))}
                    </select>
                  )}
                </div>
                {bots.length === 0 && (
                  <p className="ola-hint">Бот не привязан — обращения из мессенджеров сюда не попадут.</p>
                )}
              </div>

              <div className="ola-block">
                <h4>
                  <Users size={13} /> Состав
                  <Why>
                    <p>
                      Кто заведён в состав — тот и отвечает: отдельного права для открытой
                      линии нет. Два места настройки одного и того же неизбежно разошлись бы.
                    </p>
                    <p>
                      Зелёная точка — сотрудник начал день. Новые обращения видят только те,
                      кто на смене: чужие чаты не должны мигать у того, кто сегодня занят
                      другим. Смену человек включает сам, в меню пользователя.
                    </p>
                  </Why>
                </h4>
                <div className="ola-chips">
                  {(line.operators || []).map(o => (
                    <span key={o.userId} className={`ola-chip ${o.onShift ? 'on-shift' : ''}`}>
                      {o.onShift && <span className="dot" title="На смене" />}
                      {o.user ? (o.user.displayName || o.user.username) : o.userId}
                      <button title="Убрать из состава" onClick={() => removeOperator(line, o.userId)}><X size={12} /></button>
                    </span>
                  ))}
                  <select className="ola-add" value="" onChange={e => e.target.value && addOperator(line, e.target.value)}>
                    <option value="">+ добавить сотрудника…</option>
                    {staff.filter(u => !inLine.has(u.id)).map(u => (
                      <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
                    ))}
                  </select>
                </div>
                {(line.operators || []).length === 0 && (
                  <p className="ola-hint">В составе никого — отвечать на обращения этой линии некому.</p>
                )}
              </div>

              <div className="ola-block">
                <h4>
                  Ответ, когда на линии никого
                  <Why>
                    <p>
                      Уходит один раз за обращение, а не на каждое сообщение: иначе человек,
                      написавший ночью три строки, получит три одинаковых извинения.
                    </p>
                  </Why>
                </h4>
                <textarea
                  className="ola-textarea"
                  rows={2}
                  placeholder="Сейчас все операторы заняты или смена завершена. Мы видим ваше сообщение и ответим, как только линия откроется."
                  value={reply}
                  onChange={e => setReplies(r => ({ ...r, [line.id]: e.target.value }))}
                />
                <div className="ola-actions end" style={{ marginTop: 10 }}>
                  <button
                    className="ola-btn primary"
                    disabled={replies[line.id] === undefined || reply === (line.offlineReply || '')}
                    onClick={() => update(line, { offlineReply: reply })}
                  >
                    <Save size={14} /> Сохранить ответ
                  </button>
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}

// ══ Вкладка «Тексты» ══════════════════════════════════════════════════════

function TemplatesTab({ data, reload }) {
  const [drafts, setDrafts] = useState({});
  const [preview, setPreview] = useState({});

  const textOf = (t) => (drafts[t.id] !== undefined ? drafts[t.id] : t.text);
  const smsOf = (t) => (drafts[`sms:${t.id}`] !== undefined ? drafts[`sms:${t.id}`] : (t.smsText || ''));
  const changed = (t) => textOf(t) !== t.text || smsOf(t) !== (t.smsText || '');

  const save = async (t) => {
    try {
      await notifApi.updateTemplate(t.id, { text: textOf(t), smsText: smsOf(t) });
      setDrafts(d => {
        const next = { ...d };
        delete next[t.id];
        delete next[`sms:${t.id}`];
        return next;
      });
      toast.success('Текст сохранён');
      reload();
    } catch {
      toast.error('Не удалось сохранить');
    }
  };

  const toggle = async (t, field, value) => {
    try {
      await notifApi.updateTemplate(t.id, { [field]: value });
      reload();
    } catch {
      toast.error('Не удалось изменить');
    }
  };

  const showPreview = async (t) => {
    try {
      const { data } = await notifApi.preview(textOf(t));
      setPreview(p => ({ ...p, [t.id]: data.text }));
    } catch {
      toast.error('Предпросмотр не получился');
    }
  };

  if (!data) return <p className="ola-lead">Загрузка…</p>;

  return (
    <>
      <p className="ola-lead">
        Что получает пациент при записи, переносе, отмене и напоминании. Подстановки
        вставляются кнопками под полем; пустой SMS-текст означает, что уйдёт полный.
        <Why>
          <p>
            Тексты уехали из МИС к нам вместе с самой отправкой: раз инициатор мы, то
            и шаблон должен лежать здесь. Подстановки те же по смыслу, что на экране
            Renovatio, но с русскими именами — их правит администратор, а не программист.
          </p>
          <p>
            Короткий текст для SMS отдельным полем потому, что SMS считается сегментами
            по 70 символов кириллицей. Полный текст с адресом клиники и ФИО врача
            легко стоит трёх SMS вместо одной, и на рассылке в тысячу человек разница
            заметна в счёте.
          </p>
        </Why>
      </p>

      {data.templates.map(t => {
        const cost = smsCost(smsOf(t) || textOf(t));
        const fill = cost.limit ? Math.min(100, (cost.chars / cost.limit) * 100) : 0;

        return (
          <article key={t.id} className={`ola-card ${t.isActive ? '' : 'off'}`}>
            <header>
              <h3>
                {EVENT_TITLES[t.event] || t.event}
                {t.event === 'reminder' && <span className="ola-badge">{beforeLabel(t.beforeMinutes)}</span>}
                {t.event === 'review' && (
                  <span className="ola-badge">
                    через {beforeLabel(t.afterMinutes).replace('за ', '')} после визита
                    {t.frequency === 'daily' ? ', раз в день' : ', по каждому визиту'}
                  </span>
                )}
                {t.event.startsWith('lab_') && !t.isActive && (
                  <span className="ola-badge warn">ждёт разбора события от МИС</span>
                )}
              </h3>
              <Switch checked={t.withConfirm} onChange={v => toggle(t, 'withConfirm', v)}>
                кнопка «Подтверждаю»
              </Switch>
              <Switch checked={t.isActive} onChange={v => toggle(t, 'isActive', v)}>
                включено
              </Switch>
            </header>

            <div className="ola-card-body">
              <div className="ola-field">
                <label>Полный текст — уходит в мессенджеры</label>
                <textarea
                  className="ola-textarea"
                  rows={3}
                  value={textOf(t)}
                  onChange={e => setDrafts(d => ({ ...d, [t.id]: e.target.value }))}
                />
                <div className="ola-chips" style={{ marginTop: 9 }}>
                  {data.placeholders.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      className="ola-token"
                      title={p.title}
                      onClick={() => setDrafts(d => ({ ...d, [t.id]: `${textOf(t)}{{${p.key}}}` }))}
                    >{`{{${p.key}}}`}</button>
                  ))}
                </div>
              </div>

              <div className="ola-field">
                <label>Короткий текст для SMS</label>
                <textarea
                  className="ola-textarea"
                  rows={2}
                  value={smsOf(t)}
                  onChange={e => setDrafts(d => ({ ...d, [`sms:${t.id}`]: e.target.value }))}
                  placeholder="Например: Альфа: результаты анализов готовы. Забрать в регистратуре."
                />
                <div className={`ola-sms-cost ${cost.parts > 1 ? 'over' : ''}`}>
                  <span>{cost.chars} из {cost.limit} симв.</span>
                  <span className="ola-sms-bar"><i style={{ width: `${fill}%` }} /></span>
                  <strong>{cost.parts <= 1 ? 'одна SMS' : `${cost.parts} SMS — платим как за ${cost.parts}`}</strong>
                </div>

              </div>

              {preview[t.id] && <div className="ola-preview">{preview[t.id]}</div>}

              <div className="ola-actions end" style={{ marginTop: 14 }}>
                <button className="ola-btn" onClick={() => showPreview(t)}>
                  <Eye size={14} /> Посмотреть
                </button>
                <button className="ola-btn primary" disabled={!changed(t)} onClick={() => save(t)}>
                  <Save size={14} /> Сохранить
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </>
  );
}

// ══ Вкладка «Рассылка» ════════════════════════════════════════════════════

function DeliveryTab({ templates }) {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(null);
  const [approved, setApproved] = useState(null);
  const [balance, setBalance] = useState(null);
  const [test, setTest] = useState({ phone: '', step: 'sms', templateId: '', busy: false });

  useEffect(() => {
    notifApi.settings()
      .then(({ data }) => { setSettings(data); setSaved(JSON.stringify({ cascade: data.cascade, quietHours: data.quietHours, imobis: data.imobis })); })
      .catch(() => toast.error('Не удалось загрузить настройки рассылки'));
    notifApi.approved().then(({ data }) => setApproved(data)).catch(() => setApproved({ error: 'нет ответа' }));
    notifApi.balance().then(({ data }) => setBalance(data)).catch(() => setBalance({ balance: null }));
  }, []);

  const dirty = useMemo(() => {
    if (!settings || !saved) return false;
    return JSON.stringify({ cascade: settings.cascade, quietHours: settings.quietHours, imobis: settings.imobis }) !== saved;
  }, [settings, saved]);

  const moveStep = (index, delta) => {
    setSettings(s => {
      const next = [...s.cascade];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return { ...s, cascade: next };
    });
  };

  const setQuiet = (field, value) =>
    setSettings(s => ({ ...s, quietHours: { ...s.quietHours, [field]: value } }));

  const setImobis = (field, value) =>
    setSettings(s => ({ ...s, imobis: { ...s.imobis, [field]: value } }));

  const saveSettings = async () => {
    try {
      const { data } = await notifApi.saveSettings({
        cascade: settings.cascade,
        quietHours: settings.quietHours,
        imobis: settings.imobis
      });
      const next = { ...settings, ...data };
      setSettings(next);
      setSaved(JSON.stringify({ cascade: next.cascade, quietHours: next.quietHours, imobis: next.imobis }));
      toast.success('Настройки сохранены');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить');
    }
  };

  const sendTest = async () => {
    if (!test.phone.trim()) return toast.error('Нужен номер');
    setTest(t => ({ ...t, busy: true }));
    try {
      const { data } = await notifApi.test({ phone: test.phone, step: test.step, templateId: test.templateId || undefined });
      toast.success(`Ушло каналом ${data.channel || '—'}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось отправить');
    } finally {
      setTest(t => ({ ...t, busy: false }));
    }
  };

  if (!settings) return <p className="ola-lead">Загрузка…</p>;

  const titleOf = (name) => {
    const known = settings.available.find(a => a.name === name);
    return known ? known.title : name;
  };

  return (
    <>
      <section className="ola-card">
        <header>
          <h3>Порядок каскада</h3>
        </header>
        <div className="ola-card-body">
          <p className="ola-lead">
            Сообщение идёт по ступеням сверху вниз и останавливается на первой, которая доставила.
            <Why>
              <p>
                Ступени с пометкой «Имобис» идут к провайдеру напрямую, с пометкой «Fromni» —
                через агрегатора. Подряд идущие ступени одного провайдера уходят одним
                запросом: их собственный каскад сам остановится на доставленной, и платить
                за обе не придётся.
              </p>
              <p>
                Прямая отправка появилась не ради экономии, хотя и ради неё тоже. Через
                Fromni не видно, что стало с сообщением: её метод отвечает «принято», а
                статус доставки уходит на её callback-сервер, занятый мостом Renovatio.
                У Имобиса статус приходит нам.
              </p>
            </Why>
          </p>

          <ol className="ola-cascade">
            {settings.cascade.map((name, i) => {
              const known = settings.available.find(a => a.name === name);
              return (
                <li key={name}>
                  <span className="no">{i + 1}</span>
                  <span className="name">
                    {titleOf(name)}
                    {known?.provider && <span className="provider">{known.provider}</span>}
                  </span>
                  <button className="ola-icon-btn" title="Выше" disabled={i === 0} onClick={() => moveStep(i, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="ola-icon-btn" title="Ниже"
                    disabled={i === settings.cascade.length - 1}
                    onClick={() => moveStep(i, 1)}
                  ><ArrowDown size={14} /></button>
                  <button
                    className="ola-icon-btn danger" title="Убрать из каскада"
                    disabled={settings.cascade.length === 1}
                    onClick={() => setSettings(s => ({ ...s, cascade: s.cascade.filter(n => n !== name) }))}
                  ><X size={14} /></button>
                </li>
              );
            })}
          </ol>

          <div className="ola-chips">
            {settings.available.filter(a => !settings.cascade.includes(a.name)).map(a => (
              <button
                key={a.name} type="button" className="ola-add" title={a.provider}
                onClick={() => setSettings(s => ({ ...s, cascade: [...s.cascade, a.name] }))}
              >+ {a.title}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="ola-card">
        <header><h3><Moon size={15} /> Тихие часы</h3></header>
        <div className="ola-card-body">
          <p className="ola-lead">
            Сообщение, попавшее в это время, не отменяется — оно ждёт утра и уходит,
            когда можно. В журнале такая строка видна с пометкой об отсрочке.
          </p>

          <div className="ola-field">
            <Switch checked={settings.quietHours.enabled} onChange={v => setQuiet('enabled', v)}>
              не отправлять ночью
            </Switch>
          </div>

          <div className="ola-row">
            <div className="ola-field narrow">
              <label>С какого часа</label>
              <input className="ola-input" type="time" value={settings.quietHours.from}
                onChange={e => setQuiet('from', e.target.value)} />
            </div>
            <div className="ola-field narrow">
              <label>До какого</label>
              <input className="ola-input" type="time" value={settings.quietHours.to}
                onChange={e => setQuiet('to', e.target.value)} />
            </div>
          </div>

          <div className="ola-field" style={{ marginTop: 16 }}>
            <label>
              Каких ступеней это касается
            </label>
            <p className="ola-hint" style={{ marginTop: 0, marginBottom: 9 }}>
              Наши боты обычно не молчат: сообщение в мессенджере не будит так, как SMS,
              а человек, записавшийся поздно вечером, ждёт подтверждения сразу.
            </p>
            <div className="ola-checks">
              {settings.available.map(a => (
                <Check1
                  key={a.name}
                  checked={(settings.quietHours.channels || []).includes(a.name)}
                  onChange={on => {
                    const list = new Set(settings.quietHours.channels || []);
                    if (on) list.add(a.name); else list.delete(a.name);
                    setQuiet('channels', [...list]);
                  }}
                >{a.title}</Check1>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="ola-card">
        <header>
          <h3><Wallet size={15} /> Имобис</h3>
          {balance && balance.balance != null && (
            <span className="ola-badge accent">
              на счету {balance.balance.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽
            </span>
          )}
          {settings.imobis?.sandbox && <span className="ola-badge warn">песочница</span>}
          {!settings.imobisReady && <span className="ola-badge warn">токен не задан</span>}
        </header>
        <div className="ola-card-body">
          <p className="ola-lead">
            Прямая отправка SMS и ВКонтакте, минуя агрегатора.
            <Why>
              <p>
                Имя отправителя нельзя придумать — оно проходит модерацию у операторов
                связи. Какое одобрено на аккаунте, покажет <code>npm run imobis:check</code>.
              </p>
              <p>
                Остаток на счету — единственная цифра о деньгах, которую их API отдаёт:
                отчёта о расходах, детализации по каналам и прайса в нём нет. Сколько
                потратили за период, портал считает сам по журналу отправок.
              </p>
              {!settings.imobisReady && (
                <p>Токен берётся в личном кабинете app.imobis.ru и вписывается в
                  <code>backend/.env</code> строкой <code>IMOBIS_TOKEN=…</code>.</p>
              )}
            </Why>
          </p>

          <div className="ola-row">
            <div className="ola-field">
              <label>Имя отправителя</label>
              <input
                className="ola-input" placeholder="Например, ALFA"
                value={settings.imobis?.sender || ''}
                onChange={e => setImobis('sender', e.target.value)}
              />
            </div>
            <div className="ola-field">
              <label>ID группы ВКонтакте</label>
              <input
                className="ola-input" placeholder="Нужен ступени «ВКонтакте напрямую»"
                value={settings.imobis?.vkGroup || ''}
                onChange={e => setImobis('vkGroup', e.target.value)}
              />
            </div>
          </div>

          <div className="ola-field" style={{ marginTop: 14 }}>
            <Switch checked={settings.imobis?.sandbox} onChange={v => setImobis('sandbox', v)}>
              песочница — сообщения не уходят
            </Switch>
          </div>

          {balance && balance.error && (
            <p className="ola-hint">Баланс не получен: {balance.error}</p>
          )}
        </div>
      </section>

      <section className="ola-card">
        <header><h3><Send size={15} /> Проверить отправку</h3></header>
        <div className="ola-card-body">
          <p className="ola-lead">
            Одно сообщение на указанный номер, минуя детектор.
            <Why>
              <p>
                Нужно, чтобы убедиться: по SMS уходит текст из вики, а не тот, что остался
                в МИС. Предохранитель второй ступени здесь не действует — он защищает от
                веерной рассылки, а тут один номер, набранный руками.
              </p>
              <p>Результат появится в журнале событием «Проверочная отправка» — с каналом, которым в итоге ушло.</p>
            </Why>
          </p>

          <div className="ola-row">
            <div className="ola-field narrow">
              <label>Номер</label>
              <input className="ola-input" placeholder="+7 999 000-00-00"
                value={test.phone} onChange={e => setTest(t => ({ ...t, phone: e.target.value }))} />
            </div>
            <div className="ola-field">
              <label>Чем отправить</label>
              <select className="ola-select" value={test.step} onChange={e => setTest(t => ({ ...t, step: e.target.value }))}>
                <option value="sms">только SMS</option>
                <option value="fromni">Fromni по каскаду (Notify, потом SMS)</option>
                <option value="bot">только наш бот</option>
                <option value="auto">как в бою: бот, потом Fromni</option>
              </select>
            </div>
            <div className="ola-field">
              <label>Какой текст</label>
              <select className="ola-select" value={test.templateId} onChange={e => setTest(t => ({ ...t, templateId: e.target.value }))}>
                <option value="">выберите событие</option>
                {(templates?.templates || []).map(t => (
                  <option key={t.id} value={t.id}>{EVENT_TITLES[t.event] || t.event}</option>
                ))}
              </select>
            </div>
            <button className="ola-btn primary" onClick={sendTest} disabled={test.busy}>
              <Send size={14} /> {test.busy ? 'Отправляю…' : 'Отправить'}
            </button>
          </div>
        </div>
      </section>

      <section className="ola-card">
        <header><h3><ListChecks size={15} /> Одобренные шаблоны Notify</h3></header>
        <div className="ola-card-body">
          <p className="ola-lead">
            Тексты выше стоит писать под эти образцы.
            <Why>
              <p>
                Метод отправки у агрегатора сам ищет наш текст среди зарегистрированных.
                Совпал — уходит Notify. Не совпал — <strong>молча SMS</strong>, дороже, и
                узнать об этом можно только по счёту.
              </p>
            </Why>
          </p>

          {!approved && <p className="ola-hint">Загрузка…</p>}
          {approved?.error && <p className="ola-hint">Агрегатор не ответил: {approved.error}</p>}
          {approved && !approved.error && (approved.templates || []).length === 0 && (
            <p className="ola-hint">
              Зарегистрированных шаблонов не нашлось. Возможно, они заведены на стороне
              Имобиса, а не Fromni — тогда проверять придётся тестовой отправкой выше.
            </p>
          )}
          {(approved?.templates || []).map(t => (
            <div key={t.id || t.name} className="ola-card" style={{ marginBottom: 8 }}>
              <div className="ola-card-body" style={{ padding: 12 }}>
                <div className="ola-chips" style={{ marginBottom: 6 }}>
                  <strong style={{ fontSize: 13 }}>{t.name || 'без названия'}</strong>
                  {(t.channels || []).length > 0 && <span className="ola-chip plain">{t.channels.join(', ')}</span>}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{t.text}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className={`ola-savebar ${dirty ? 'dirty' : ''}`}>
        <span className={`state ${dirty ? 'dirty' : ''}`}>
          {dirty ? 'Есть несохранённые изменения' : 'Всё сохранено'}
        </span>
        <button className="ola-btn primary" onClick={saveSettings} disabled={!dirty}>
          <Save size={15} /> Сохранить настройки
        </button>
      </div>
    </>
  );
}

// ══ Вкладка «Журнал» ══════════════════════════════════════════════════════

function LogTab() {
  const [log, setLog] = useState(null);
  const [status, setStatus] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    // Поиск по номеру ждёт паузы в наборе: журнал за сутки — тысячи строк, и
    // запрос на каждую цифру гонял бы их впустую.
    const timer = setTimeout(() => {
      const params = {};
      if (status) params.status = status;
      if (phone.replace(/\D/g, '')) params.phone = phone.replace(/\D/g, '');
      notifApi.outbox(params)
        .then(({ data }) => setLog(data))
        .catch(() => toast.error('Не удалось загрузить журнал'));
    }, phone ? 350 : 0);

    return () => clearTimeout(timer);
  }, [status, phone]);

  return (
    <>
      <div className="ola-log-head">
        {Object.entries(STATUS_VIEW).map(([key, view]) => (
          <button
            key={key}
            className={`ola-stat ${view.cls} ${status === key ? 'active' : ''}`}
            onClick={() => setStatus(status === key ? '' : key)}
          >
            <span className="value">{log ? (log.counts[key] ?? 0) : '—'}</span>
            <span className="label">{view.label}</span>
          </button>
        ))}

        <div className="ola-log-search">
          <Search size={16} />
          <input
            placeholder="Поиск по номеру телефона"
            value={phone}
            onChange={e => setPhone(e.target.value)}
          />
        </div>
      </div>

      <p className="ola-lead">
        Плитки считают за последние сутки; список показывает последние отправки
        независимо от них.
      </p>

      {log && log.rows.length === 0 && (
        <div className="ola-empty">
          <Inbox size={34} />
          <h3>Отправок не нашлось</h3>
          <p>{status || phone ? 'Попробуйте снять фильтр или очистить поиск.' : 'Детектор ещё не находил событий, о которых нужно сообщить пациенту.'}</p>
        </div>
      )}

      {(log?.rows || []).map(row => {
        const view = STATUS_VIEW[row.status] || STATUS_VIEW.pending;
        const Icon = view.icon;
        return (
          <article key={row.id} className={`ola-row-card ${view.cls}`}>
            <div className="ola-row-top">
              <Icon size={15} />
              <span className="event">{EVENT_TITLES[row.event] || row.event}</span>
              <span className="phone">{row.phone || 'без телефона'}</span>
              {row.channel && <span className="ola-badge">{row.channel}</span>}
              {row.postponedFrom && <span className="ola-badge warn">отложено на утро</span>}
              <span className="time">{new Date(row.sentAt || row.plannedAt).toLocaleString('ru-RU')}</span>
            </div>
            <div className="ola-row-text">{row.text}</div>
            {row.error && <div className="ola-row-error">{row.error}</div>}
          </article>
        );
      })}
    </>
  );
}

// ══ Страница ══════════════════════════════════════════════════════════════

export default function AdminOpenLine() {
  const [tab, setTab] = useState('lines');
  const [templates, setTemplates] = useState(null);
  const [failed, setFailed] = useState(0);

  // Шаблоны нужны двум вкладкам сразу: «Тексты» их правят, «Рассылка» выбирает
  // из них текст для проверочной отправки. Держим на странице, а не в каждой.
  const loadTemplates = useCallback(async () => {
    try {
      const { data } = await notifApi.templates();
      setTemplates(data);
    } catch {
      toast.error('Не удалось загрузить шаблоны');
    }
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // Недоставленное за сутки — цифрой на вкладке журнала. Иначе о том, что
  // рассылка встала (кончился баланс, отвалился токен), узнаёшь, только если
  // заглянешь в журнал по своей воле, а заглядывают туда по жалобе.
  useEffect(() => {
    notifApi.outbox({ status: 'failed', limit: 1 })
      .then(({ data }) => setFailed(data.counts?.failed || 0))
      .catch(() => {});
  }, [tab]);

  return (
    <div className="admin-page">
      <div className="ola-shell">
        <div className="ola-head">
          <div>
            <h1>Открытая линия и оповещения</h1>
            <p>
              Состав линий, тексты уведомлений пациентам и порядок доставки.
              Рабочее окно колл-центра — в разделе «Открытая линия».
            </p>
          </div>
        </div>

        <nav className="ola-tabs">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                className={`ola-tab ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <Icon size={15} /> {t.label}
                {t.key === 'log' && failed > 0 && <span className="ola-tab-count">{failed}</span>}
              </button>
            );
          })}
        </nav>

        {/* Предохранитель показываем крупно и на всех вкладках: пока вторая
            ступень выключена, половина отправок помечается пропущенной, и это
            надо понимать сразу, а не выяснять по журналу. */}
        {templates && !templates.safety?.fromniAllowed && (
          <div className="ola-warning">
            <AlertTriangle size={17} />
            <div>
              <strong>Вторая ступень каскада выключена.</strong> Уведомления уходят только
              подписчикам наших ботов, всё остальное помечается пропущенным. Включается
              в <code>.env</code> строкой <code>NOTIFIER_ALLOW_FROMNI=true</code> — вместе
              со снятием галок «Отправлять сообщение» в МИС у той же организации, иначе
              пациент получит два уведомления об одном событии.
            </div>
          </div>
        )}

        {tab === 'lines' && <LinesTab />}
        {tab === 'texts' && <TemplatesTab data={templates} reload={loadTemplates} />}
        {tab === 'delivery' && <DeliveryTab templates={templates} />}
        {tab === 'log' && <LogTab />}
      </div>
    </div>
  );
}
