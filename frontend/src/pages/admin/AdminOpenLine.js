import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Headphones, FileText, Radio, ScrollText, Plus, Users, Bot, Save, Power, X,
  Check, AlertTriangle, Clock, Ban, ArrowUp, ArrowDown, Moon, Send,
  Search, Wallet, Inbox, CalendarPlus, CalendarClock, CalendarX, BellRing,
  Star, FlaskConical, Building2, ChevronDown, ShieldCheck, MonitorSmartphone, Megaphone
} from 'lucide-react';
import { openLine as lineApi, notifications as notifApi, users as usersApi } from '../../services/api';
import ChannelLogo from '../../components/openline/ChannelLogo';
import WidgetTab from './WidgetTab';
import BroadcastsTab from './BroadcastsTab';
import toast from 'react-hot-toast';
import './AdminOpenLine.css';

/**
 * Настройки открытой линии и оповещений (ver. 8.02, филиалы и каналы — 8.03).
 *
 * До 8.02 это были две вкладки внутри самого модуля открытой линии, рядом с
 * очередью обращений. Модуль при этом — рабочее окно оператора колл-центра, и
 * соседство получилось неудачным: в одном клике от списка обращений лежали
 * состав линий, тексты уведомлений всей сети и токены провайдера.
 *
 * ЧТО ИЗМЕНИЛОСЬ В 8.03.
 *
 * Подсказки убраны. Их было по абзацу под каждым заголовком, и на экране по
 * пять — читать это никто не станет, а искать среди них поле уже работа. В
 * 8.02 их свернули за кнопку «зачем это»; заказчик повторил замечание, и теперь
 * пояснений в интерфейсе нет вовсе. Осталось одно предупреждение о выключенной
 * второй ступени: это не пояснение, а состояние системы, из-за которого
 * половина отправок помечается пропущенной. Всё, что объясняло решения, живёт в
 * комментариях этого файла и в migrations/*.txt — там оно и нужно, потому что
 * читают его те, кто правит код, а не те, кто правит тексты.
 *
 * Тексты стали по каналам. Было два поля — «в мессенджеры» и «в SMS», то есть
 * деление по длине. Каналов у нас три, и у каждого свой разговор: в Telegram
 * есть кнопки, в MAX своя длина строки, в SMS сегменты по 70 символов.
 *
 * Каскад стал свой у каждого события. Общий не выдерживал первого возражения:
 * просьбу оценить приём незачем слать по SMS — выполнить её там нельзя, а
 * деньги списываются.
 *
 * Появились филиалы. Пока это только переопределения поверх общих настроек, но
 * дальше сеть расходится: у филиалов разные боты, разные лицевые счета у
 * провайдера и разные привычки в текстах.
 */

// ── Справочники ───────────────────────────────────────────────────────────

const TABS = [
  { key: 'lines',    label: 'Линии',    icon: Headphones },
  { key: 'texts',    label: 'Тексты',   icon: FileText },
  { key: 'delivery', label: 'Рассылка', icon: Radio },
  // «Анонсы», а не «Рассылки»: соседняя вкладка уже называется так, и речь там
  // о том, как уходят уведомления о визитах. Здесь — сообщение, которое мы шлём
  // по своей инициативе всем сразу, и путать эти два дела нельзя.
  { key: 'ads',      label: 'Анонсы',   icon: Megaphone },
  { key: 'log',      label: 'Журнал',   icon: ScrollText },
  // Виджет стоит здесь, а не отдельным разделом: он ведёт в те же боты, что и
  // линия, и заводит его тот же человек, что настраивает их.
  { key: 'widget',   label: 'Виджет',   icon: MonitorSmartphone }
];

// Событие узнаётся по значку раньше, чем по названию: карточек на вкладке семь,
// и в списке одинаковых заголовков глаз ищет дольше, чем в списке разных.
const EVENT_VIEW = {
  created:     { title: 'Запись на визит',            icon: CalendarPlus,  tone: 'green'  },
  moved:       { title: 'Перенос визита',             icon: CalendarClock, tone: 'amber'  },
  cancelled:   { title: 'Отмена визита',              icon: CalendarX,     tone: 'red'    },
  reminder:    { title: 'Напоминание о визите',       icon: BellRing,      tone: 'accent' },
  review:      { title: 'Просьба об отзыве',          icon: Star,          tone: 'violet' },
  lab_full:    { title: 'Результаты анализов готовы', icon: FlaskConical,  tone: 'cyan'   },
  lab_partial: { title: 'Часть результатов готова',   icon: FlaskConical,  tone: 'cyan'   },
  test:        { title: 'Проверочная отправка',       icon: Send,          tone: 'accent' }
};

const eventTitle = (event) => (EVENT_VIEW[event]?.title) || event;

const STATUS_VIEW = {
  sent:    { label: 'доставлено',    icon: Check,         cls: 'ok'    },
  pending: { label: 'ждёт отправки', icon: Clock,         cls: 'wait'  },
  failed:  { label: 'не доставлено', icon: AlertTriangle, cls: 'bad'   },
  skipped: { label: 'пропущено',     icon: Ban,           cls: 'muted' }
};

// Какой знак показать у ступени каскада. Ступень «наши боты» ведёт сразу в два
// мессенджера, поэтому у неё знака одного нет — показывать один из двух было бы
// неправдой, и рисуются оба.
function stepChannel(name) {
  if (name === 'imobis:sms' || name === 'sms+webchat') return 'sms';
  if (name === 'notify+vk') return 'notify';
  return null;
}

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
  const unicode = [...value].some(ch => ch.codePointAt(0) > 127);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;

  const chars = value.length;
  const parts = chars === 0 ? 0 : (chars <= single ? 1 : Math.ceil(chars / multi));
  const limit = parts <= 1 ? single : multi * parts;

  return { chars, parts, limit, unicode };
}

// ── Общие мелочи интерфейса ───────────────────────────────────────────────

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
    // и не обновляем, состав правят редко. listBasic доступен любому сотруднику
    // и отдаёт ровно то, что здесь нужно, — имя и идентификатор.
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

  if (!data) return <div className="ola-loading">Загрузка…</div>;

  const looseBots = data.bots.filter(b => !b.lineId);

  return (
    <>
      <div className="ola-actions end">
        <button className="ola-btn primary" onClick={() => setCreating(v => !v)}>
          <Plus size={15} /> Новая линия
        </button>
      </div>

      {creating && (
        <section className="ola-card">
          <header>
            <span className="ola-card-icon accent"><Plus size={17} /></span>
            <h3>Новая линия</h3>
          </header>
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
                <label>Филиал</label>
                <select
                  className="ola-select"
                  value={draft.medCenterId}
                  onChange={e => setDraft(d => ({ ...d, medCenterId: e.target.value }))}
                >
                  <option value="">без филиала (проверочная)</option>
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
          <p>Линия — это филиал, его боты и его состав сотрудников.</p>
        </div>
      )}

      {data.lines.map(line => {
        const bots = data.bots.filter(b => b.lineId === line.id);
        const inLine = new Set((line.operators || []).map(o => o.userId));
        const reply = replies[line.id] !== undefined ? replies[line.id] : (line.offlineReply || '');

        return (
          <section key={line.id} className={`ola-card ${line.isActive ? '' : 'off'}`}>
            <header>
              <span className="ola-card-icon accent"><Headphones size={17} /></span>
              <h3>{line.name}</h3>
              {line.medCenter && <span className="ola-badge accent">{line.medCenter.name}</span>}
              {!line.isActive && <span className="ola-badge warn">выключена</span>}
              <button className="ola-btn" onClick={() => update(line, { isActive: !line.isActive })}>
                <Power size={14} /> {line.isActive ? 'Выключить' : 'Включить'}
              </button>
            </header>

            <div className="ola-card-body">
              <div className="ola-block">
                <h4><Bot size={13} /> Боты</h4>
                <div className="ola-chips">
                  {bots.map(b => (
                    <span key={b.id} className="ola-chip">
                      <ChannelLogo channel={b.platform === 'max' ? 'max' : 'telegram'} size={18} />
                      @{b.username}
                      <button title="Отвязать" onClick={() => bindBot('none', b.id)}><X size={12} /></button>
                    </span>
                  ))}
                  {looseBots.length > 0 && (
                    <select className="ola-add" value="" onChange={e => e.target.value && bindBot(line.id, e.target.value)}>
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

              <div className="ola-block">
                <h4><Users size={13} /> Состав</h4>
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
              </div>

              <div className="ola-block">
                <h4>Ответ, когда на линии никого</h4>
                <textarea
                  className="ola-textarea"
                  rows={2}
                  placeholder="Сейчас все операторы заняты или смена завершена. Мы ответим, как только линия откроется."
                  value={reply}
                  onChange={e => setReplies(r => ({ ...r, [line.id]: e.target.value }))}
                />
                <div className="ola-actions end">
                  <button
                    className="ola-btn primary"
                    disabled={replies[line.id] === undefined || reply === (line.offlineReply || '')}
                    onClick={() => update(line, { offlineReply: reply })}
                  >
                    <Save size={14} /> Сохранить
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

/**
 * Время у напоминания и просьбы об отзыве (ver. 8.04).
 *
 * Было вбито: напоминание за сутки, отзыв через три часа. Числа разумные, но
 * это чужое решение, принятое за заказчика, и подходит оно не всякой клинике —
 * стоматологии удобнее напомнить за два часа, лаборатории за трое суток.
 *
 * Единицы отдельным списком, а не одним полем в минутах: «1440» никто не читает
 * как «сутки», и ошибиться в нуле легко.
 */
const UNITS = [
  { key: 'minutes', label: 'мин.', mul: 1 },
  { key: 'hours',   label: 'ч.',   mul: 60 },
  { key: 'days',    label: 'сут.', mul: 1440 }
];

function splitMinutes(total) {
  const value = Number(total) || 0;
  if (value && value % 1440 === 0) return { amount: value / 1440, unit: 'days' };
  if (value && value % 60 === 0) return { amount: value / 60, unit: 'hours' };
  return { amount: value, unit: 'minutes' };
}

function TimingField({ label, minutes, onChange }) {
  const { amount, unit } = splitMinutes(minutes);

  const apply = (nextAmount, nextUnit) => {
    const mul = UNITS.find(u => u.key === nextUnit)?.mul || 1;
    const n = Math.max(0, Number(nextAmount) || 0);
    onChange(n * mul);
  };

  return (
    <div className="ola-timing">
      <span className="ola-timing-label">{label}</span>
      <input
        className="ola-input"
        type="number"
        min="0"
        value={amount}
        onChange={e => apply(e.target.value, unit)}
      />
      <select className="ola-select" value={unit} onChange={e => apply(amount, e.target.value)}>
        {UNITS.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
      </select>
    </div>
  );
}

/**
 * Карточка события: порядок доставки и тексты в нём же (ver. 8.04).
 *
 * Прежде это были две несвязанные части — список ступеней и отдельный набор
 * полей с текстами. Связь между ними приходилось держать в голове: «SMS стоит
 * третьей, значит вон то поле». Теперь текст живёт внутри своей ступени, и
 * вопрос «что уйдёт в MAX» решается взглядом на строку MAX.
 *
 * Полного текста больше нет. Он уходил в любой канал, для которого не завели
 * свой, то есть один абзац оказывался и в мессенджере, и в SMS, где он стоит
 * трёх сегментов. Ступень без текста теперь пропускается — с причиной в журнале.
 *
 * Ступени раскрываются по одной. Их три-четыре, и четыре поля разом растянули
 * бы карточку на экран — ровно то, от чего уходили в 8.03.
 */
function TemplateCard({ template, steps, placeholders, onSave, onToggle }) {
  const [draft, setDraft] = useState(null);
  const [openStep, setOpenStep] = useState(null);

  const view = EVENT_VIEW[template.event] || { title: template.event, icon: FileText, tone: 'accent' };
  const Icon = view.icon;

  const current = draft || {
    channelTexts: { ...(template.channelTexts || {}) },
    cascade: Array.isArray(template.cascade) ? template.cascade : [],
    beforeMinutes: template.beforeMinutes,
    afterMinutes: template.afterMinutes,
    frequency: template.frequency
  };

  const patch = (next) => setDraft(d => ({ ...(d || current), ...next }));

  const setText = (channel, value) =>
    patch({ channelTexts: { ...current.channelTexts, [channel]: value } });

  const dirty = !!draft && JSON.stringify({
    channelTexts: draft.channelTexts, cascade: draft.cascade,
    beforeMinutes: draft.beforeMinutes, afterMinutes: draft.afterMinutes, frequency: draft.frequency
  }) !== JSON.stringify({
    channelTexts: template.channelTexts || {}, cascade: template.cascade || [],
    beforeMinutes: template.beforeMinutes, afterMinutes: template.afterMinutes, frequency: template.frequency
  });

  const save = async () => {
    await onSave(template, {
      channelTexts: current.channelTexts,
      cascade: current.cascade,
      beforeMinutes: current.beforeMinutes,
      afterMinutes: current.afterMinutes,
      frequency: current.frequency
    });
    setDraft(null);
  };

  const move = (index, delta) => {
    const next = [...current.cascade];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    patch({ cascade: next });
  };

  const stepOf = (name) => steps.find(a => a.name === name) || { name, title: name, provider: '', channel: null };

  // Две ступени SMS (Имобис и Fromni) делят один текст: канал у них один и тот
  // же, и держать два одинаковых поля значило бы предлагать их разойтись.
  const sharesChannel = (channel) =>
    current.cascade.filter(n => stepOf(n).channel === channel).length > 1;

  return (
    <article className={`ola-card ola-event ${template.isActive ? '' : 'off'}`}>
      <header>
        <span className={`ola-card-icon ${view.tone}`}><Icon size={17} /></span>
        <h3>{view.title}</h3>
        {template.medCenter && <span className="ola-badge accent">{template.medCenter.name}</span>}

        <Switch checked={template.withConfirm} onChange={v => onToggle(template, 'withConfirm', v)}>
          «Подтверждаю»
        </Switch>
        <Switch checked={template.isActive} onChange={v => onToggle(template, 'isActive', v)}>
          включено
        </Switch>
      </header>

      <div className="ola-card-body">
        {/* Время — только у событий, которые его имеют. У записи и отмены
            момент задан самим событием, и настраивать там нечего. */}
        {(template.event === 'reminder' || template.event === 'review') && (
          <div className="ola-timings">
            {template.event === 'reminder' && (
              <TimingField
                label="Напомнить за"
                minutes={current.beforeMinutes}
                onChange={v => patch({ beforeMinutes: v })}
              />
            )}
            {template.event === 'review' && (
              <>
                <TimingField
                  label="Спросить через"
                  minutes={current.afterMinutes}
                  onChange={v => patch({ afterMinutes: v })}
                />
                <select
                  className="ola-select ola-freq"
                  value={current.frequency || 'each'}
                  onChange={e => patch({ frequency: e.target.value })}
                >
                  <option value="each">по каждому визиту</option>
                  <option value="daily">один раз за день</option>
                </select>
              </>
            )}
          </div>
        )}

        <h4 className="ola-order-title">Порядок доставки</h4>

        {current.cascade.length === 0 && (
          <div className="ola-cascade-empty">
            Ни одной ступени — событие никуда не уйдёт. Добавьте канал ниже.
          </div>
        )}

        <ol className="ola-order">
          {current.cascade.map((name, i) => {
            const step = stepOf(name);
            const channel = step.channel;
            const value = channel ? (current.channelTexts[channel] || '') : '';
            const open = openStep === name;
            const cost = channel === 'sms' ? smsCost(value) : null;
            const fill = cost && cost.limit ? Math.min(100, (cost.chars / cost.limit) * 100) : 0;

            return (
              <li key={name} className={`ola-order-step ${open ? 'open' : ''} ${!value ? 'blank' : ''}`}>
                <div className="ola-order-head">
                  <span className="no">{i + 1}</span>
                  <ChannelLogo channel={channel || 'notify'} size={22} />
                  <button className="ola-order-name" onClick={() => setOpenStep(open ? null : name)}>
                    {step.title}
                    <span className="provider">{step.provider}</span>
                    {!value && <span className="ola-order-blank">текст не задан — ступень пропустится</span>}
                    <ChevronDown size={15} className="chev" />
                  </button>
                  <button className="ola-icon-btn" title="Выше" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="ola-icon-btn" title="Ниже"
                    disabled={i === current.cascade.length - 1} onClick={() => move(i, 1)}
                  ><ArrowDown size={14} /></button>
                  <button
                    className="ola-icon-btn danger" title="Убрать ступень"
                    onClick={() => patch({ cascade: current.cascade.filter(n => n !== name) })}
                  ><X size={14} /></button>
                </div>

                {open && (
                  <div className="ola-order-body">
                    {sharesChannel(channel) && (
                      <div className="ola-order-shared">
                        Текст общий со второй ступенью {channel === 'sms' ? 'SMS' : channel}
                      </div>
                    )}

                    <textarea
                      className="ola-textarea tall"
                      rows={3}
                      value={value}
                      placeholder="Что получит пациент этим каналом"
                      onChange={e => setText(channel, e.target.value)}
                    />

                    {cost && (
                      <div className={`ola-sms-cost ${cost.parts > 1 ? 'over' : ''}`}>
                        <span>{cost.chars} из {cost.limit} симв.</span>
                        <span className="ola-sms-bar"><i style={{ width: `${fill}%` }} /></span>
                        <strong>{cost.parts <= 1 ? 'одна SMS' : `${cost.parts} SMS`}</strong>
                      </div>
                    )}

                    <div className="ola-tokens">
                      {placeholders.map(p => (
                        <button
                          key={p.key} type="button" className="ola-token" title={p.title}
                          onClick={() => setText(channel, `${value}{{${p.key}}}`)}
                        >{`{{${p.key}}}`}</button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <div className="ola-chips">
          {steps.filter(a => !current.cascade.includes(a.name)).map(a => (
            <button
              key={a.name} type="button" className="ola-add"
              onClick={() => patch({ cascade: [...current.cascade, a.name] })}
            >+ {a.title}</button>
          ))}
        </div>

        <div className="ola-actions end">
          <button className="ola-btn primary" disabled={!dirty} onClick={save}>
            <Save size={14} /> Сохранить
          </button>
        </div>
      </div>
    </article>
  );
}

function TemplatesTab({ data, steps, reload }) {
  const save = async (t, patch) => {
    try {
      await notifApi.updateTemplate(t.id, patch);
      toast.success('Сохранено');
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

  if (!data) return <div className="ola-loading">Загрузка…</div>;

  return (
    <>
      {data.templates.map(t => (
        <TemplateCard
          key={t.id}
          template={t}
          steps={steps}
          placeholders={data.placeholders || []}
          onSave={save}
          onToggle={toggle}
        />
      ))}
    </>
  );
}

// ══ Вкладка «Рассылка» ════════════════════════════════════════════════════

/**
 * Боты филиала (ver. 8.05). Раньше это был общий список, где бот привязывался к
 * «организации» — ключу лицевого счёта у Fromni, к филиалам отношения не
 * имевшему. Теперь бот лежит там же, где его настраивают: внутри своего филиала.
 *
 * Состояние вебхука показываем у платформы, а не в нашей базе: в базе записано,
 * каким режим задумывался, а расхождение между задуманным и получившимся — это
 * и есть обычная причина «бот молчит».
 */
function BranchBots({ medCenterId, bots, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ token: '', platform: 'telegram', deliveryMode: 'webhook' });
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!draft.token.trim()) return toast.error('Нужен токен');
    setBusy(true);
    try {
      const { data } = await lineApi.addBot({ ...draft, medCenterId });
      toast.success(`@${data.username}: ${data.note}`);
      setDraft({ token: '', platform: 'telegram', deliveryMode: 'webhook' });
      setAdding(false);
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось завести бота');
    } finally {
      setBusy(false);
    }
  };

  const update = async (bot, body) => {
    try {
      const { data } = await lineApi.updateBot(bot.id, body);
      if (data.note) toast.success(data.note);
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось изменить');
    }
  };

  const remove = async (bot) => {
    if (!window.confirm(`Убрать бота @${bot.username}? Вебхук будет снят, подписчики останутся.`)) return;
    try {
      await lineApi.deleteBot(bot.id);
      onChanged();
    } catch {
      toast.error('Не удалось убрать бота');
    }
  };

  const taken = new Set(bots.map(b => b.platform));

  return (
    <div className="ola-field">
      <label>Боты</label>

      {bots.map(bot => {
        const ok = bot.deliveryMode === 'polling'
          ? !bot.webhook.url
          : bot.webhook.url === bot.expectedWebhook;

        return (
          <div key={bot.id} className={`ola-bot ${bot.isActive ? '' : 'off'}`}>
            <ChannelLogo channel={bot.platform === 'max' ? 'max' : 'telegram'} size={26} />
            <div className="ola-bot-main">
              <div className="ola-bot-name">
                @{bot.username || '—'}
                <span className="ola-bot-token">{bot.tokenTail}</span>
              </div>
              <div className={`ola-bot-state ${ok ? 'ok' : 'bad'}`}>
                {bot.webhook.error
                  ? bot.webhook.error
                  : (bot.deliveryMode === 'webhook'
                    ? (ok ? 'вебхук на месте' : `вебхук указывает не сюда: ${bot.webhook.url || 'не установлен'}`)
                    : (ok ? 'забор обновлений' : 'вебхук не снят — забор работать не будет'))}
                {bot.webhook.pending > 0 && ` · в очереди ${bot.webhook.pending}`}
              </div>
            </div>

            <select
              className="ola-select narrow" value={bot.deliveryMode}
              onChange={e => update(bot, { deliveryMode: e.target.value })}
            >
              <option value="webhook">вебхук</option>
              <option value="polling">забор</option>
            </select>

            <Switch checked={bot.isActive} onChange={v => update(bot, { isActive: v })}>работает</Switch>

            <button className="ola-icon-btn danger" title="Убрать бота" onClick={() => remove(bot)}>
              <X size={14} />
            </button>
          </div>
        );
      })}

      {adding && (
        <div className="ola-subcard">
          <div className="ola-row">
            <div className="ola-field narrow">
              <label>Платформа</label>
              <select className="ola-select" value={draft.platform}
                onChange={e => setDraft(d => ({ ...d, platform: e.target.value }))}>
                <option value="telegram">Telegram</option>
                <option value="max">MAX</option>
              </select>
            </div>
            <div className="ola-field">
              <label>Токен</label>
              <input
                className="ola-input" type="password" autoComplete="off"
                placeholder="от BotFather"
                value={draft.token}
                onChange={e => setDraft(d => ({ ...d, token: e.target.value }))}
              />
            </div>
            <div className="ola-field narrow">
              <label>Как получать</label>
              <select className="ola-select" value={draft.deliveryMode}
                onChange={e => setDraft(d => ({ ...d, deliveryMode: e.target.value }))}>
                <option value="webhook">вебхук</option>
                <option value="polling">забор</option>
              </select>
            </div>
            <button className="ola-btn primary" onClick={add} disabled={busy}>
              <Save size={14} /> {busy ? 'Проверяю…' : 'Завести'}
            </button>
          </div>
        </div>
      )}

      {!adding && (
        <button className="ola-add" onClick={() => setAdding(true)}>
          + бот {taken.size === 0 ? '' : (taken.has('telegram') ? 'MAX' : 'Telegram')}
        </button>
      )}
    </div>
  );
}

/**
 * Филиал целиком: его боты, его счёт у провайдера, его имя отправителя.
 *
 * Общая настройка Имобиса осталась основанием, а не исчезла: сеть чаще всего
 * живёт на одном счету, и заставлять вписывать один токен девять раз значило бы
 * менять одну беду на другую. Поэтому поля показывают, что унаследовано, а
 * заполняются только там, где счёт действительно отдельный.
 */
function BranchCard({ branch, open, onToggleOpen, onSave, onChanged }) {
  const [sender, setSender] = useState(branch.imobis.sender || '');
  const [token, setToken] = useState('');

  const senderDirty = sender !== (branch.imobis.sender || '');
  const dirty = senderDirty || !!token.trim();

  const save = async () => {
    const patch = { imobis: {} };
    if (senderDirty) patch.imobis.sender = sender;
    if (token.trim()) patch.imobis.token = token.trim();
    await onSave(branch.medCenterId, patch);
    setToken('');
  };

  const working = branch.bots.filter(b => b.isActive).length;

  return (
    <section className={`ola-card ola-branch-card ${branch.isEnabled ? '' : 'off'}`}>
      <header>
        <span className="ola-card-icon cyan"><Building2 size={17} /></span>
        <h3>{branch.name}</h3>
        {branch.bots.length > 0 && (
          <span className="ola-branch-bots">
            {branch.bots.map(b => (
              <ChannelLogo key={b.id} channel={b.platform === 'max' ? 'max' : 'telegram'} size={19} />
            ))}
            <span className="ola-badge">{working} из {branch.bots.length} работают</span>
          </span>
        )}
        {branch.bots.length === 0 && <span className="ola-badge warn">без ботов</span>}

        <Switch checked={branch.isEnabled} onChange={v => onSave(branch.medCenterId, { isEnabled: v })}>
          подключён
        </Switch>

        <button
          className={`ola-icon-btn ${open ? 'open' : ''}`}
          title={open ? 'Свернуть' : 'Настроить'}
          onClick={onToggleOpen}
        ><ChevronDown size={15} /></button>
      </header>

      {open && (
        <div className="ola-card-body">
          <BranchBots medCenterId={branch.medCenterId} bots={branch.bots} onChanged={onChanged} />

          <div className="ola-block">
            <h4><Wallet size={13} /> Счёт у Имобиса</h4>
            <div className="ola-row">
              <div className="ola-field">
                <label>
                  Имя отправителя
                  {branch.imobis.senderInherited && <span className="ola-badge">общее: {branch.imobis.senderInherited}</span>}
                </label>
                <input
                  className="ola-input"
                  placeholder={branch.imobis.senderInherited ? 'пусто — как в общих' : 'проходит модерацию у операторов'}
                  value={sender}
                  onChange={e => setSender(e.target.value)}
                />
              </div>
              <div className="ola-field">
                <label>
                  Токен
                  {branch.imobis.tokenSet && <span className="ola-badge">свой</span>}
                  {branch.imobis.tokenInherited && <span className="ola-badge">общий</span>}
                </label>
                <input
                  className="ola-input" type="password" autoComplete="off"
                  placeholder={branch.imobis.tokenSet ? 'задан — впишите новый, чтобы заменить' : 'пусто — общий счёт сети'}
                  value={token}
                  onChange={e => setToken(e.target.value)}
                />
              </div>
              <button className="ola-btn primary" disabled={!dirty} onClick={save}>
                <Save size={14} /> Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function DeliveryTab({ templates, safety, onSafetyChange }) {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(null);
  const [balance, setBalance] = useState(null);
  const [branches, setBranches] = useState(null);
  const [orphans, setOrphans] = useState([]);
  const [openBranch, setOpenBranch] = useState(null);
  const [imobisToken, setImobisToken] = useState('');
  const [test, setTest] = useState({ phone: '', step: 'auto', templateId: '', busy: false });

  const loadBranches = useCallback(() => {
    notifApi.branches()
      .then(({ data }) => { setBranches(data.branches); setOrphans(data.orphanBots || []); })
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    notifApi.settings()
      .then(({ data }) => {
        setSettings(data);
        setSaved(JSON.stringify({ quietHours: data.quietHours, imobis: data.imobis }));
      })
      .catch(() => toast.error('Не удалось загрузить настройки рассылки'));
    notifApi.balance().then(({ data }) => setBalance(data)).catch(() => setBalance({ balance: null }));
    loadBranches();
  }, [loadBranches]);

  const dirty = useMemo(() => {
    if (!settings || !saved) return false;
    return !!imobisToken.trim() ||
      JSON.stringify({ quietHours: settings.quietHours, imobis: settings.imobis }) !== saved;
  }, [settings, saved, imobisToken]);

  const setQuiet = (field, value) =>
    setSettings(s => ({ ...s, quietHours: { ...s.quietHours, [field]: value } }));

  const setImobis = (field, value) =>
    setSettings(s => ({ ...s, imobis: { ...s.imobis, [field]: value } }));

  const saveSettings = async () => {
    try {
      const body = { quietHours: settings.quietHours, imobis: { ...settings.imobis } };
      // Токен отправляем только если его вписали заново: пустое поле означает
      // «оставить как есть», а не «стереть доступ».
      if (imobisToken.trim()) body.imobis.token = imobisToken.trim();
      else delete body.imobis.token;

      const { data } = await notifApi.saveSettings(body);
      const next = { ...settings, ...data };
      setSettings(next);
      setSaved(JSON.stringify({ quietHours: next.quietHours, imobis: next.imobis }));
      setImobisToken('');
      notifApi.settings().then(({ data }) => setSettings(s => ({ ...s, credentials: data.credentials })));
      loadBranches();
      toast.success('Настройки сохранены');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить');
    }
  };

  const saveSafety = async (patch) => {
    try {
      await notifApi.saveSafety(patch);
      await onSafetyChange();
      toast.success('Предохранители сохранены');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить');
    }
  };

  const saveBranch = async (medCenterId, patch) => {
    try {
      await notifApi.saveBranch(medCenterId, patch);
      loadBranches();
    } catch {
      toast.error('Не удалось сохранить филиал');
    }
  };

  const sendTest = async () => {
    if (!test.phone.trim()) return toast.error('Нужен номер');
    setTest(t => ({ ...t, busy: true }));
    try {
      const { data } = await notifApi.test({
        phone: test.phone,
        step: test.step,
        templateId: test.templateId || undefined
      });
      // Имобис отвечает «принято», а доставку подтверждает отчётом — поэтому
      // «ушло» здесь не то же, что «дошло», и путать их нельзя: именно на этом
      // и обожглись, когда проверка сообщала об успехе, а в журнале лежал отказ.
      if (data.result?.error) toast.error(data.result.error);
      else if (data.result?.accepted) toast.success('Принято провайдером — исход смотрите в журнале');
      else toast.success(`Ушло каналом ${data.result?.channel || '—'}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось отправить');
    } finally {
      setTest(t => ({ ...t, busy: false }));
    }
  };

  if (!settings) return <div className="ola-loading">Загрузка…</div>;

  const creds = settings.credentials || {};

  return (
    <>
      {/* Предохранители первыми: пока они закрыты, всё остальное на этой
          вкладке настраивается вхолостую, и знать об этом надо до, а не после. */}
      {safety && <SafetyPanel safety={safety} onChange={saveSafety} />}

      <h2 className="ola-section">Филиалы</h2>

      {!branches && <div className="ola-loading">Загрузка…</div>}

      {(branches || []).map(b => (
        <BranchCard
          key={b.medCenterId}
          branch={b}
          open={openBranch === b.medCenterId}
          onToggleOpen={() => setOpenBranch(openBranch === b.medCenterId ? null : b.medCenterId)}
          onSave={saveBranch}
          onChanged={loadBranches}
        />
      ))}

      {/* Боты без филиала: проверочные и те, что не встали при переносе.
          Прятать их нельзя — иначе бот работает, а в настройке его нет. */}
      {orphans.length > 0 && (
        <section className="ola-card">
          <header>
            <span className="ola-card-icon amber"><Bot size={17} /></span>
            <h3>Боты вне филиалов</h3>
            <span className="ola-badge warn">{orphans.length}</span>
          </header>
          <div className="ola-card-body">
            {orphans.map(bot => (
              <div key={bot.id} className="ola-bot">
                <ChannelLogo channel={bot.platform === 'max' ? 'max' : 'telegram'} size={26} />
                <div className="ola-bot-main">
                  <div className="ola-bot-name">
                    @{bot.username || '—'}
                    <span className="ola-badge">{bot.organization}</span>
                  </div>
                  <div className="ola-bot-state">не привязан к филиалу</div>
                </div>
                <select
                  className="ola-select narrow" value=""
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    try {
                      await lineApi.updateBot(bot.id, { medCenterId: e.target.value });
                      loadBranches();
                    } catch { toast.error('Не удалось привязать'); }
                  }}
                >
                  <option value="">к филиалу…</option>
                  {(branches || []).map(b => (
                    <option key={b.medCenterId} value={b.medCenterId}>{b.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      <h2 className="ola-section">Общее для сети</h2>

      <section className="ola-card">
        <header>
          <span className="ola-card-icon amber"><Wallet size={17} /></span>
          <h3>Счёт у Имобиса по умолчанию</h3>
          {balance && balance.balance != null && (
            <span className="ola-badge accent">
              {balance.balance.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽
            </span>
          )}
          {settings.imobis?.sandbox && <span className="ola-badge warn">песочница</span>}
          {!creds.imobisTokenSet && <span className="ola-badge warn">токен не задан</span>}
          {creds.imobisTokenFromEnv && <span className="ola-badge">из .env</span>}
        </header>
        <div className="ola-card-body">
          <div className="ola-row">
            <div className="ola-field">
              <label>Токен</label>
              <input
                className="ola-input" type="password" autoComplete="off"
                placeholder={creds.imobisTokenSet ? 'задан — впишите новый, чтобы заменить' : 'из личного кабинета app.imobis.ru'}
                value={imobisToken}
                onChange={e => setImobisToken(e.target.value)}
              />
            </div>
            <div className="ola-field">
              <label>Имя отправителя</label>
              <input
                className="ola-input" placeholder="Например, ALFA"
                value={settings.imobis?.sender || ''}
                onChange={e => setImobis('sender', e.target.value)}
              />
            </div>
            <div className="ola-field narrow">
              <Switch checked={settings.imobis?.sandbox} onChange={v => setImobis('sandbox', v)}>
                песочница
              </Switch>
            </div>
          </div>
          {balance && balance.error && (
            <div className="ola-bot-state bad">Баланс не получен: {balance.error}</div>
          )}
        </div>
      </section>

      <section className="ola-card">
        <header>
          <span className="ola-card-icon violet"><Moon size={17} /></span>
          <h3>Тихие часы</h3>
          <Switch checked={settings.quietHours.enabled} onChange={v => setQuiet('enabled', v)}>
            включены
          </Switch>
        </header>
        <div className="ola-card-body">
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

          <div className="ola-field">
            <label>Каких ступеней это касается</label>
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
          <span className="ola-card-icon accent"><Send size={17} /></span>
          <h3>Проверить отправку</h3>
        </header>
        <div className="ola-card-body">
          <div className="ola-row">
            <div className="ola-field narrow">
              <label>Номер</label>
              <input className="ola-input" placeholder="+7 999 000-00-00"
                value={test.phone} onChange={e => setTest(t => ({ ...t, phone: e.target.value }))} />
            </div>
            <div className="ola-field">
              <label>Какой ступенью</label>
              {/* Ступени берутся из общего списка, а не из чьего-то каскада:
                  проверяют обычно до того, как ступень туда поставят. */}
              <select className="ola-select" value={test.step} onChange={e => setTest(t => ({ ...t, step: e.target.value }))}>
                <option value="auto">как в бою — по каскаду события</option>
                <option value="bot">любой наш бот</option>
                {settings.available.map(a => (
                  <option key={a.name} value={a.name}>только «{a.title}» ({a.provider})</option>
                ))}
              </select>
            </div>
            <div className="ola-field">
              <label>Какой текст</label>
              <select className="ola-select" value={test.templateId} onChange={e => setTest(t => ({ ...t, templateId: e.target.value }))}>
                <option value="">выберите событие</option>
                {(templates?.templates || []).map(t => (
                  <option key={t.id} value={t.id}>{eventTitle(t.event)}</option>
                ))}
              </select>
            </div>
            <button className="ola-btn primary" onClick={sendTest} disabled={test.busy}>
              <Send size={14} /> {test.busy ? 'Отправляю…' : 'Отправить'}
            </button>
          </div>
        </div>
      </section>

      <div className={`ola-savebar ${dirty ? 'dirty' : ''}`}>
        <span className={`state ${dirty ? 'dirty' : ''}`}>
          {dirty ? 'Есть несохранённые изменения' : 'Всё сохранено'}
        </span>
        <button className="ola-btn primary" onClick={saveSettings} disabled={!dirty}>
          <Save size={15} /> Сохранить общие
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
          <input placeholder="Поиск по номеру" value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
      </div>

      {log && log.rows.length === 0 && (
        <div className="ola-empty">
          <Inbox size={34} />
          <h3>Отправок не нашлось</h3>
          <p>{status || phone ? 'Снимите фильтр или очистите поиск.' : 'Детектор ещё не находил событий.'}</p>
        </div>
      )}

      {(log?.rows || []).map(row => {
        const view = STATUS_VIEW[row.status] || STATUS_VIEW.pending;
        const Icon = view.icon;
        const eview = EVENT_VIEW[row.event];
        const EIcon = eview?.icon || FileText;
        return (
          <article key={row.id} className={`ola-row-card ${view.cls}`}>
            <div className="ola-row-top">
              <span className={`ola-card-icon small ${eview?.tone || 'accent'}`}><EIcon size={14} /></span>
              <span className="event">{eventTitle(row.event)}</span>
              <span className="phone">{row.phone || 'без телефона'}</span>
              {row.channel && <span className="ola-badge">{row.channel}</span>}
              {row.postponedFrom && <span className="ola-badge warn">отложено</span>}
              <span className={`ola-row-status ${view.cls}`}><Icon size={13} /> {view.label}</span>
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

/**
 * Предохранители: что уходит наружу и на какие номера (ver. 8.06).
 *
 * Прежде состояние жило в .env и на экране показывалось одной строкой про
 * Fromni — строкой, которая врала: предохранитель стоял внутри ветки Fromni,
 * ниже ветки Имобиса, и прямая отправка SMS шла мимо него. Настройка, состояние
 * которой нельзя увидеть, не защищает, а создаёт ложное чувство защиты.
 *
 * Теперь это орган управления, и он устроен так, чтобы включение нельзя было
 * сделать по инерции:
 *
 *   • выключение мгновенно, включение — через подтверждение с набором слова.
 *     Несимметрично намеренно: остановить рассылку надо уметь одним движением,
 *     а запустить — понимая, что делаешь;
 *   • подтверждение называет последствие («сообщения пойдут живым пациентам»),
 *     а не спрашивает «вы уверены?» — на такой вопрос отвечают не думая;
 *   • видно, кто и когда менял: вопрос «кто это включил» задают через неделю;
 *   • замок на сервере (NOTIFIER_LOCK_EXTERNAL) делает переключатель
 *     неработающим — на время пилота снятие должно требовать доступа к серверу.
 */
function SafetyPanel({ safety, onChange }) {
  const [confirming, setConfirming] = useState(null);
  const [word, setWord] = useState('');
  const [pilot, setPilot] = useState((safety.pilotPhones || []).join(', '));
  const [busy, setBusy] = useState(false);

  const open = (safety.providers || []).filter(p => p.allowed);
  const piloted = (safety.pilotPhones || []).length > 0;
  const CONFIRM = 'ОТПРАВЛЯТЬ';

  const apply = async (allowExternal, extra = {}) => {
    setBusy(true);
    try {
      await onChange({ allowExternal, ...extra });
      setConfirming(null);
      setWord('');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (provider, on) => {
    const names = (safety.providers || []).filter(p => p.allowed).map(p => p.name);
    const next = on ? [...names, provider.name] : names.filter(n => n !== provider.name);

    // Выключение — сразу. Включение — через подтверждение.
    if (!on) return apply(next);
    setConfirming({ provider, next });
    setWord('');
  };

  const savePilot = () => {
    const list = pilot.split(',').map(s => s.trim()).filter(Boolean);
    apply(undefined, { pilotPhones: list });
  };

  const pilotDirty = pilot !== (safety.pilotPhones || []).join(', ');

  return (
    <section className={`ola-card ola-safety ${open.length ? 'live' : (piloted ? 'safe' : '')}`}>
      <header>
        <span className={`ola-card-icon ${open.length ? 'red' : (piloted ? 'green' : 'amber')}`}>
          {open.length ? <AlertTriangle size={17} /> : <ShieldCheck size={17} />}
        </span>
        <h3>
          {open.length
            ? `Отправка наружу включена: ${open.map(p => p.title).join(', ')}`
            : 'Наружу ничего не уходит'}
        </h3>
        {safety.locked && <span className="ola-badge warn">замок на сервере</span>}
        {safety.changedBy && (
          <span className="ola-badge">
            {safety.changedBy}, {new Date(safety.changedAt).toLocaleString('ru-RU')}
          </span>
        )}
      </header>

      <div className="ola-card-body">
        <div className="ola-safety-rows">
          {(safety.providers || []).map(p => (
            <div key={p.name} className={`ola-safety-row ${p.allowed ? 'on' : ''}`}>
              <span className="name">{p.title}</span>
              <span className="state">
                {p.allowed ? 'сообщения уходят пациентам' : 'помечается пропущенным'}
              </span>
              <Switch
                checked={p.allowed}
                disabled={safety.locked || busy}
                onChange={v => toggle(p, v)}
              >{p.allowed ? 'включено' : 'выключено'}</Switch>
            </div>
          ))}
        </div>

        <div className="ola-field">
          <label>
            Только эти номера
            {!piloted && <span className="ola-badge warn">не сужено — вся сеть</span>}
          </label>
          <div className="ola-row">
            <input
              className="ola-input"
              placeholder="+7 900 000-00-00, +7 900 111-11-11 — пусто означает всю сеть"
              value={pilot}
              onChange={e => setPilot(e.target.value)}
            />
            <button className="ola-btn primary" disabled={!pilotDirty || busy} onClick={savePilot}>
              <Save size={14} /> Сохранить
            </button>
          </div>
        </div>

        {confirming && (
          <div className="ola-confirm">
            <AlertTriangle size={18} />
            <div className="ola-confirm-body">
              <strong>Включить «{confirming.provider.title}»?</strong>
              <p>
                После этого уведомления пойдут живым пациентам
                {piloted
                  ? ` — пока только на ${safety.pilotPhones.length} проверочны${safety.pilotPhones.length === 1 ? 'й номер' : 'х номера'}.`
                  : ' по всей сети: круг получателей не сужен.'}
                {' '}Убедитесь, что в МИС у тех же организаций сняты галки «Отправлять
                сообщение», иначе пациент получит два уведомления об одном событии.
              </p>
              <div className="ola-row">
                <input
                  className="ola-input"
                  placeholder={`Наберите ${CONFIRM}, чтобы подтвердить`}
                  value={word}
                  onChange={e => setWord(e.target.value)}
                  autoFocus
                />
                <button
                  className="ola-btn danger-solid"
                  disabled={word.trim().toUpperCase() !== CONFIRM || busy}
                  onClick={() => apply(confirming.next)}
                >Включить отправку</button>
                <button className="ola-btn" onClick={() => setConfirming(null)}>Отмена</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ══ Страница ══════════════════════════════════════════════════════════════

export default function AdminOpenLine() {
  const [tab, setTab] = useState('lines');
  const [templates, setTemplates] = useState(null);
  const [steps, setSteps] = useState([]);
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

  // Список ступеней нужен вкладке «Тексты» для каскада события, а живёт он в
  // настройках рассылки. Забираем один раз на странице, чтобы карточка события
  // не ходила за ним сама на каждый разворот.
  useEffect(() => {
    notifApi.settings().then(({ data }) => setSteps(data.available || [])).catch(() => {});
  }, []);

  // Недоставленное за сутки — цифрой на вкладке журнала. Иначе о том, что
  // рассылка встала (кончился баланс, отвалился токен), узнаёшь, только если
  // заглянешь в журнал по своей воле, а заглядывают туда по жалобе.
  useEffect(() => {
    notifApi.outbox({ status: 'failed', limit: 1 })
      .then(({ data }) => setFailed(data.counts?.failed || 0))
      .catch(() => {});
  }, [tab]);

  const safety = templates?.safety;

  return (
    <div className="admin-page">
      <div className="ola-shell">
        <div className="ola-head">
          <h1>Открытая линия и оповещения</h1>
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

        {/* Единственный текст, оставленный в интерфейсе. Это не пояснение, а
            состояние системы: пока предохранитель стоит, часть отправок
            помечается пропущенной, и понимать это надо до того, как начнёшь
            разбираться по журналу.
            
            Раньше здесь была одна строка про Fromni, и она врала: предохранитель
            стоял внутри ветки Fromni, а прямая отправка через Имобис проходила
            мимо него. Теперь перечисляем провайдеров поимённо — утверждение
            «наружу ничего не уходит» должно быть проверяемым. */}
        {tab === 'lines' && <LinesTab />}
        {tab === 'texts' && <TemplatesTab data={templates} steps={steps} reload={loadTemplates} />}
        {tab === 'delivery' && <DeliveryTab templates={templates} safety={safety} onSafetyChange={loadTemplates} />}
        {tab === 'ads' && <BroadcastsTab />}
        {tab === 'log' && <LogTab />}
        {tab === 'widget' && <WidgetTab />}
      </div>
    </div>
  );
}
