import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Headphones, FileText, Radio, ScrollText, Plus, Users, Bot, Save, Power, X,
  Check, AlertTriangle, Clock, Ban, ArrowUp, ArrowDown, Moon, Send,
  Search, Wallet, Inbox, CalendarPlus, CalendarClock, CalendarX, BellRing,
  Star, FlaskConical, Building2, ChevronDown, ChevronLeft, ChevronRight,
  ShieldCheck, MonitorSmartphone, Copy, RotateCcw
} from 'lucide-react';
import {
  openLine as lineApi, notifications as notifApi, users as usersApi, mis as misApi
} from '../../services/api';
import ChannelLogo from '../../components/openline/ChannelLogo';
import WidgetTab from './WidgetTab';
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
 * Появились филиалы. С 8.11 тексты у каждого только свои: ссылки на карту
 * вписываются прямо в сообщение, а для SMS используются отдельные сокращённые
 * варианты, поэтому общего безопасного текста у сети нет.
 */

// ── Справочники ───────────────────────────────────────────────────────────

const TABS = [
  { key: 'lines',    label: 'Линии',    icon: Headphones },
  { key: 'texts',    label: 'Тексты',   icon: FileText },
  { key: 'delivery', label: 'Рассылка', icon: Radio },
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

/**
 * Каким путём событие доходит до нас (ver. 8.25).
 *
 * Почти всё берётся забором: детектор раз в минуту спрашивает МИС, что
 * изменилось, и считает событие сравнением со снимком. Так надёжнее — забор не
 * зависит от того, дошёл ли до нас чужой запрос, и переживает перезапуск.
 *
 * Готовность лабораторных исследований забором не берётся совсем: спросить о ней
 * публичное API нечем. Поэтому МИС зовёт наш адрес сама, и под эти два события
 * режим вебхука и делался.
 */
const SOURCE_VIEW = {
  poll: {
    label: 'забором',
    hint: 'Детектор портала раз в минуту спрашивает МИС, что изменилось'
  },
  webhook: {
    label: 'вебхуком',
    hint: 'МИС зовёт наш адрес сама — настройка «уведомления о событиях» в Renovatio'
  }
};

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

// «1 отправка», «2 отправки», «5 отправок». Цифра без слова в подписи под
// фильтрами читается как номер, а не как количество.
function plural(n, one, few, many) {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
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

function Switch({ checked, onChange, children, disabled, label }) {
  return (
    <label className="ola-switch" title={label}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        aria-label={label}
        onChange={e => onChange(e.target.checked)}
      />
      <span className="track" />
      {children && <span>{children}</span>}
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

function LinesTab({ creating, setCreating }) {
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
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
  const setSenior = guard((line, o) => lineApi.setSenior(line.id, o.userId, !o.isSenior), 'Не удалось изменить');
  const bindBot = guard((lineId, botId) => lineApi.bindBot(lineId, botId), 'Не удалось привязать бота');

  if (!data) return <div className="ola-loading">Загрузка…</div>;

  const looseBots = data.bots.filter(b => !b.lineId);

  return (
    <>
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
                {/* Звёздочка — старший оператор. Единственное, что она даёт, —
                    архив закрытых обращений: это чтение чужих разговоров с
                    пациентами задним числом, и всей смене оно ни к чему
                    (ver. 8.10). Отдельного экрана прав не заводили: состав линии
                    и есть то место, где про людей на ней всё и решается. */}
                <div className="ola-chips">
                  {(line.operators || []).map(o => (
                    <span key={o.userId} className={`ola-chip ${o.onShift ? 'on-shift' : ''} ${o.isSenior ? 'senior' : ''}`}>
                      {o.onShift && <span className="dot" title="На смене" />}
                      {o.user ? (o.user.displayName || o.user.username) : o.userId}
                      <button
                        className={`ola-senior ${o.isSenior ? 'on' : ''}`}
                        title={o.isSenior
                          ? 'Старший оператор: видит архив обращений. Снять'
                          : 'Сделать старшим — откроется архив обращений линии'}
                        onClick={() => setSenior(line, o)}
                      ><Star size={12} /></button>
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
                    Сохранить
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
/**
 * Откуда приходит событие. Значение общее на пару «филиал × событие», а не на
 * карточку: напоминаний у филиала может быть несколько, и у всех них источник
 * один — сама запись, по которой они ставятся.
 */
function EventSource({ event, source, webhook, onChange }) {
  const view = SOURCE_VIEW[source] || SOURCE_VIEW.poll;
  const url = webhook ? `${webhook.url}/${event}` : '';

  return (
    <div className="ola-event-source">
      <label>Как приходит</label>
      <select
        className="ola-select narrow"
        value={source}
        title={view.hint}
        onChange={e => onChange(e.target.value)}
      >
        <option value="poll">забором</option>
        <option value="webhook">вебхуком</option>
      </select>

      {source === 'webhook' && (
        <div className="ola-event-hook">
          {/* Адрес нужен целиком: без него запись в Renovatio не завести, а
              собрать его в голове нельзя — секрет part пути. */}
          <code title={url}>{url}</code>
          <button
            className="ola-icon-btn"
            title="Скопировать адрес для настройки в МИС"
            onClick={() => {
              navigator.clipboard?.writeText(url);
              toast.success('Адрес скопирован — заведите его в МИС на это событие');
            }}
          ><Copy size={13} /></button>
          {webhook && !webhook.ready && (
            <span className="ola-badge warn">не задан MIS_EVENTS_SECRET — приёмник закрыт</span>
          )}
        </div>
      )}
    </div>
  );
}

function TemplateCard({ template, steps, placeholders, source, webhook, onSource, onSave, onToggle }) {
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

  const placeholderGroups = useMemo(() => {
    const groups = new Map();
    for (const placeholder of placeholders) {
      const name = placeholder.group || 'Дополнительно';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(placeholder);
    }
    return [...groups.entries()];
  }, [placeholders]);

  return (
    <article className={`ola-card ola-event ${template.isActive ? '' : 'off'}`}>
      <header>
        <span className={`ola-card-icon ${view.tone}`}><Icon size={17} /></span>
        <h3>{view.title}</h3>
        {template.medCenter && <span className="ola-badge accent">{template.medCenter.name}</span>}

        <Switch
          checked={template.isActive}
          onChange={v => onToggle(template, 'isActive', v)}
          label={template.isActive ? 'Выключить событие' : 'Включить событие'}
        />
      </header>

      <div className="ola-card-body">
        <div className="ola-event-options">
          <Check1 checked={template.withConfirm} onChange={v => onToggle(template, 'withConfirm', v)}>
            Добавлять кнопку «Подтверждаю»
          </Check1>

          <EventSource
            event={template.event}
            source={source}
            webhook={webhook}
            onChange={value => onSource(template.event, value)}
          />
        </div>

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

                    <details className="ola-placeholder-picker">
                      <summary>Вставить значение</summary>
                      <div className="ola-placeholder-groups">
                        {placeholderGroups.map(([group, items]) => (
                          <section key={group}>
                            <h5>{group}</h5>
                            <div className="ola-tokens">
                              {items.map(p => (
                                <button
                                  key={p.key} type="button" className="ola-token" title={`{{${p.key}}}`}
                                  onClick={() => setText(channel, `${value}{{${p.key}}}`)}
                                >{p.title}</button>
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    </details>
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
            Сохранить
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * Блокировка отправки по врачу.
 *
 * Врачи спрашиваются у МИС по клинике выбранного филиала, а не общим списком по
 * сети (ver. 8.31). Общий список — это полтысячи фамилий, из которых к филиалу
 * относится десяток, и найти среди них нужного врача можно было только зная,
 * как он записан. Клиник у филиала бывает несколько (у Сукко исторически две),
 * поэтому спрашиваем по каждой и склеиваем по id.
 *
 * Филиал без клиники в МИС — случай не настроенного справочника. Спрашиваем
 * тогда всю сеть: пустой список означал бы «заблокировать некого», а это
 * неправда, и настройку просто не удалось бы сделать.
 */
function BlockedDoctorsPanel({ medCenterId, clinicIds }) {
  const [available, setAvailable] = useState([]);
  const [saved, setSaved] = useState([]);
  const [draft, setDraft] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Массив в зависимостях эффекта менялся бы ссылкой на каждую отрисовку
  // страницы, и список врачей перезапрашивался бы на каждый набранный символ.
  const clinicKey = (clinicIds || []).join(',');

  useEffect(() => {
    let active = true;
    const clinics = clinicKey ? clinicKey.split(',') : [];
    const doctorRequests = clinics.length
      ? clinics.map(id => misApi.getDoctors({ clinic_id: id, show_all: true, roles: ['doctor'] }))
      : [misApi.getDoctors({ show_all: true, roles: ['doctor'] })];

    Promise.allSettled([notifApi.blockedDoctors(medCenterId), ...doctorRequests])
      .then(([blockedResult, ...doctorResults]) => {
        if (!active) return;

        if (blockedResult.status === 'fulfilled') {
          const rows = blockedResult.value.data?.doctors || [];
          setSaved(rows);
          setDraft(rows);
        } else {
          toast.error('Не удалось загрузить блокировку врачей');
        }

        const byId = new Map();
        for (const result of doctorResults) {
          if (result.status !== 'fulfilled') continue;
          for (const doctor of (result.value.data?.data || [])) {
            const id = String(doctor.id || '');
            const name = doctor.name
              || [doctor.last_name, doctor.first_name, doctor.middle_name].filter(Boolean).join(' ');
            if (!id || !name || byId.has(id)) continue;
            byId.set(id, {
              id,
              name,
              specialty: (doctor.professions || [])
                .map(item => typeof item === 'object' ? (item.title || item.name || '') : String(item || ''))
                .filter(Boolean).join(', ')
            });
          }
        }

        if (doctorResults.every(result => result.status !== 'fulfilled')) {
          toast.error('Не удалось загрузить врачей из МИС');
        }

        setAvailable([...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
        setLoading(false);
      });
    return () => { active = false; };
  }, [medCenterId, clinicKey]);

  const selectedIds = useMemo(() => new Set(draft.map(doctor => String(doctor.id))), [draft]);
  const suggestions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru');
    if (!needle) return [];
    return available.filter(doctor => (
      !selectedIds.has(doctor.id) &&
      `${doctor.name} ${doctor.specialty}`.toLocaleLowerCase('ru').includes(needle)
    )).slice(0, 8);
  }, [available, query, selectedIds]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const add = (doctor) => {
    setDraft(current => [...current, { id: doctor.id, name: doctor.name }]);
    setQuery('');
  };
  const remove = (id) => setDraft(current => current.filter(doctor => String(doctor.id) !== String(id)));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await notifApi.saveBlockedDoctors(medCenterId, draft);
      setSaved(data.doctors || []);
      setDraft(data.doctors || []);
      toast.success('Блокировка сохранена');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="ola-card ola-doctor-blocklist">
      <header>
        <span className="ola-card-icon red"><Ban size={17} /></span>
        <h3>Блокировать отправку для врачей</h3>
        {draft.length > 0 && <span className="ola-badge">{draft.length}</span>}
      </header>
      <div className="ola-card-body">
        <div className="ola-doctor-search">
          <Search size={16} />
          <input
            className="ola-input"
            value={query}
            disabled={loading}
            placeholder={loading ? 'Загрузка врачей…' : `Найти врача филиала (${available.length})`}
            onChange={event => setQuery(event.target.value)}
          />
          {suggestions.length > 0 && (
            <div className="ola-doctor-suggestions">
              {suggestions.map(doctor => (
                <button key={doctor.id} type="button" onClick={() => add(doctor)}>
                  <strong>{doctor.name}</strong>
                  {doctor.specialty && <span>{doctor.specialty}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ola-chips ola-blocked-doctors">
          {draft.map(doctor => (
            <span className="ola-chip" key={doctor.id || doctor.name}>
              {doctor.name || `Врач ${doctor.id}`}
              <button type="button" aria-label={`Убрать ${doctor.name}`} onClick={() => remove(doctor.id)}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>

        <div className="ola-actions end">
          <button className="ola-btn primary" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </article>
  );
}

function TemplatesTab({ data, steps, reload, selected }) {
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

  // Источник лежит у филиала, а не у шаблона: напоминаний у филиала бывает
  // несколько, и «это событие мы забираем сами» — утверждение о событии, а не о
  // каждом его тексте. Отправляем карту целиком: сервер хранит только известные
  // ключи, и частичный объект стёр бы остальные.
  const setSource = async (medCenterId, sources, event, value) => {
    try {
      await notifApi.saveBranch(medCenterId, { eventSources: { ...sources, [event]: value } });
      toast.success(value === 'webhook'
        ? 'Событие ждём вебхуком — заведите адрес в МИС'
        : 'Событие забираем сами');
      reload();
    } catch {
      toast.error('Не удалось изменить источник');
    }
  };

  if (!data) return <div className="ola-loading">Загрузка…</div>;

  const medCenters = data.medCenters || [];
  const visibleTemplates = (data.templates || []).filter(t => t.medCenterId === selected);
  const sources = (data.eventSources || {})[selected] || {};
  const clinicIds = medCenters.find(mc => mc.id === selected)?.misClinicIds || [];

  return (
    <>
      {selected && (
        <BlockedDoctorsPanel key={selected} medCenterId={selected} clinicIds={clinicIds} />
      )}

      {medCenters.length === 0 && (
        <div className="ola-empty"><Building2 size={34} /><h3>Нет действующих филиалов</h3></div>
      )}

      {medCenters.length > 0 && visibleTemplates.length === 0 && (
        <div className="ola-empty"><FileText size={34} /><h3>Для филиала нет настроенных событий</h3></div>
      )}

      {visibleTemplates.length > 0 && (
        <div className="ola-event-grid">
          {visibleTemplates.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              steps={steps}
              placeholders={data.placeholders || []}
              source={sources[t.event] || 'poll'}
              webhook={data.misWebhook}
              onSource={(event, value) => setSource(selected, sources, event, value)}
              onSave={save}
              onToggle={toggle}
            />
          ))}
        </div>
      )}
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
/**
 * Категория подписчика в МИС (ver. 8.08). Номер вписывается руками: справочника
 * категорий публичное API МИС не отдаёт, а заведены они там по одной на бота —
 * не «Telegram», а «Telegram, Альфа Дети». Пусто — бот никого не помечает.
 *
 * Сохраняем по Enter и по уходу из поля, а не на каждую набранную цифру: иначе
 * в базу успевал бы лечь недонабранный номер, и первая же подписка ушла бы в
 * чужую категорию.
 */
function BotCategory({ bot, onSave }) {
  const [value, setValue] = useState(bot.misCategoryId ?? '');

  useEffect(() => { setValue(bot.misCategoryId ?? ''); }, [bot.misCategoryId]);

  const commit = () => {
    if (String(value) === String(bot.misCategoryId ?? '')) return;
    onSave({ misCategoryId: value });
  };

  return (
    <input
      className="ola-input mis-cat"
      inputMode="numeric"
      placeholder="кат. МИС"
      title="Номер категории в МИС, которая ставится подписчику этого бота"
      value={value}
      onChange={e => setValue(e.target.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

function BranchBots({ medCenterId, bots, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ token: '', platform: 'telegram', deliveryMode: 'webhook', misCategoryId: '' });
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!draft.token.trim()) return toast.error('Нужен токен');
    setBusy(true);
    try {
      const { data } = await lineApi.addBot({ ...draft, medCenterId });
      toast.success(`@${data.username}: ${data.note}`);
      setDraft({ token: '', platform: 'telegram', deliveryMode: 'webhook', misCategoryId: '' });
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
                {/* Бот без категории работает как обычно, и заметить пропажу
                    иначе негде: подписки просто не доходят до карточек в МИС. */}
                {!bot.misCategoryId && (
                  <span className="ola-badge warn" title="Подписчики этого бота не помечаются в карточке пациента">
                    без категории МИС
                  </span>
                )}
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

            <BotCategory bot={bot} onSave={body => update(bot, body)} />

            <select
              className="ola-select narrow" value={bot.deliveryMode}
              onChange={e => update(bot, { deliveryMode: e.target.value })}
            >
              <option value="webhook">вебхук</option>
              <option value="polling">забор</option>
            </select>

            <Switch
              checked={bot.isActive}
              onChange={v => update(bot, { isActive: v })}
              label={bot.isActive ? 'Выключить бота' : 'Включить бота'}
            />

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
              <label>Категория МИС</label>
              <input
                className="ola-input" inputMode="numeric" placeholder="номер"
                value={draft.misCategoryId}
                onChange={e => setDraft(d => ({ ...d, misCategoryId: e.target.value.replace(/\D/g, '') }))}
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
 * Филиал целиком: его боты и его учётная запись у Имобиса.
 *
 * Общей настройки сети больше нет (ver. 8.25). Учётная запись у Имобиса заведена
 * на каждый медцентр отдельно, трафик по ним распределён намеренно, и наследование
 * от «счёта сети» отвечало неправду на единственный важный вопрос — с какого
 * счёта ушла эта SMS. Филиал без токена SMS не отправляет и виден
 * предупреждением; молчаливая отправка с чужого счёта хуже неотправки, за неё
 * платит другое юрлицо.
 */
function BranchCard({ branch, open, onToggleOpen, onSave, onChanged }) {
  const [sender, setSender] = useState(branch.imobis.sender || '');
  const [vkGroup, setVkGroup] = useState(branch.imobis.vkGroup ?? '');
  const [token, setToken] = useState('');
  const [account, setAccount] = useState(null);
  const [checking, setChecking] = useState(false);

  const senderDirty = sender !== (branch.imobis.sender || '');
  const groupDirty = String(vkGroup) !== String(branch.imobis.vkGroup ?? '');
  const dirty = senderDirty || groupDirty || !!token.trim();

  const save = async () => {
    const patch = { imobis: {} };
    if (senderDirty) patch.imobis.sender = sender;
    if (groupDirty) patch.imobis.vkGroup = vkGroup;
    // Токен отправляем только когда его вписали заново: поле секрета пустое
    // всегда, и пустая строка на каждом сохранении уносила бы доступ вместе с
    // правкой имени отправителя.
    if (token.trim()) patch.imobis.token = token.trim();
    await onSave(branch.medCenterId, patch);
    setToken('');
    setAccount(null);
  };

  // Баланс и имена отправителя спрашиваем по кнопке, а не при открытии карточки:
  // это два запроса к Имобису на каждый филиал, и девять открытых карточек
  // означали бы восемнадцать походов наружу ради цифры, которую смотрят изредка.
  const check = async () => {
    setChecking(true);
    try {
      const { data } = await notifApi.checkImobis(branch.medCenterId);
      setAccount(data);
      if (data.error) toast.error(data.error);
    } catch {
      toast.error('Не удалось спросить Имобис');
    } finally {
      setChecking(false);
    }
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

        {/* Свёрнутая карточка должна отвечать «уйдут ли отсюда SMS» без
            разворачивания: филиал без токена молчит по всему каскаду ниже
            ботов, и узнать об этом из журнала можно только постфактум. */}
        {!branch.imobis.tokenSet && <span className="ola-badge warn">без счёта Имобиса</span>}
        {branch.imobis.sandbox && <span className="ola-badge warn">песочница</span>}

        {/* Подписи у тумблера нет намеренно (ver. 8.31): слово рядом с ним читается
            как название, а не как состояние, и «подключён» у выключенного филиала
            сбивало с толку — включать его или он уже включён. Положение тумблера
            отвечает на это само, а для чтения с экрана есть label. */}
        <Switch
          checked={branch.isEnabled}
          onChange={v => onSave(branch.medCenterId, { isEnabled: v })}
          label={branch.isEnabled ? 'Отключить филиал от рассылки' : 'Подключить филиал к рассылке'}
        />

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
                  Токен
                  {branch.imobis.tokenSet
                    ? <span className="ola-badge">{branch.imobis.tokenTail}</span>
                    : <span className="ola-badge warn">не задан</span>}
                </label>
                <input
                  className="ola-input" type="password" autoComplete="off"
                  placeholder={branch.imobis.tokenSet
                    ? 'задан — впишите новый, чтобы заменить'
                    : 'из личного кабинета app.imobis.ru'}
                  value={token}
                  onChange={e => setToken(e.target.value)}
                />
              </div>
              <div className="ola-field">
                <label>Имя отправителя</label>
                <input
                  className="ola-input"
                  placeholder="проходит модерацию у операторов"
                  value={sender}
                  onChange={e => setSender(e.target.value)}
                />
              </div>
              <div className="ola-field narrow">
                <label>Группа ВК</label>
                <input
                  className="ola-input" inputMode="numeric" placeholder="номер"
                  value={vkGroup}
                  onChange={e => setVkGroup(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div className="ola-field narrow">
                <Switch
                  checked={!!branch.imobis.sandbox}
                  onChange={v => onSave(branch.medCenterId, { imobis: { sandbox: v } })}
                >песочница</Switch>
              </div>
            </div>

            <div className="ola-row">
              <button className="ola-btn primary" disabled={!dirty} onClick={save}>
                <Save size={14} /> Сохранить
              </button>
              <button className="ola-btn" onClick={check} disabled={checking || !branch.imobis.tokenSet}>
                {checking ? 'Спрашиваю…' : 'Проверить счёт'}
              </button>

              {account && !account.error && (
                <span className="ola-bot-state ok">
                  {account.balance != null
                    ? `${account.balance.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${account.currency || '₽'}`
                    : 'баланс не отдан'}
                  {account.senders?.length ? ` · имена: ${account.senders.join(', ')}` : ''}
                </span>
              )}
              {account && account.error && (
                <span className="ola-bot-state bad">{account.error}</span>
              )}
            </div>

            {/* Имя, вписанное с опечаткой, ничем себя не выдаёт: SMS просто не
                уходит. Поэтому сверяем его со списком аккаунта, как только
                список получен. */}
            {account && account.senderKnown === false && (
              <div className="ola-bot-state bad">
                имени «{branch.imobis.sender}» нет в аккаунте — SMS с ним не уйдут
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function DeliveryTab({ templates, safety, onSafetyChange }) {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(null);
  const [branches, setBranches] = useState(null);
  const [orphans, setOrphans] = useState([]);
  const [openBranch, setOpenBranch] = useState(null);
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
        setSaved(JSON.stringify({ quietHours: data.quietHours }));
      })
      .catch(() => toast.error('Не удалось загрузить настройки рассылки'));
    loadBranches();
  }, [loadBranches]);

  const dirty = useMemo(() => {
    if (!settings || !saved) return false;
    return JSON.stringify({ quietHours: settings.quietHours }) !== saved;
  }, [settings, saved]);

  const setQuiet = (field, value) =>
    setSettings(s => ({ ...s, quietHours: { ...s.quietHours, [field]: value } }));

  const saveSettings = async () => {
    try {
      const { data } = await notifApi.saveSettings({ quietHours: settings.quietHours });
      const next = { ...settings, ...data };
      setSettings(next);
      setSaved(JSON.stringify({ quietHours: next.quietHours }));
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
          <span className="ola-card-icon violet"><Moon size={17} /></span>
          <h3>Тихие часы</h3>
          <Switch
            checked={settings.quietHours.enabled}
            onChange={v => setQuiet('enabled', v)}
            label={settings.quietHours.enabled ? 'Выключить тихие часы' : 'Включить тихие часы'}
          />
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
                  <option key={t.id} value={t.id}>
                    {t.medCenter?.name ? `${t.medCenter.name} — ` : ''}{eventTitle(t.event)}
                  </option>
                ))}
              </select>
            </div>
            <button className="ola-btn primary" onClick={sendTest} disabled={test.busy}>
              <Send size={14} /> {test.busy ? 'Отправляю…' : 'Отправить'}
            </button>
          </div>

          {/* Счёт у Имобиса свой у каждого филиала (ver. 8.25), а филиал берётся
              из выбранного текста — другого указания на него в этой форме нет.
              Без текста проверка SMS ответила бы отказом, и причина была бы
              неочевидной. */}
          {!test.templateId && test.step.startsWith('imobis:') && (
            <div className="ola-bot-state bad">
              Выберите текст: по нему определяется филиал, с чьего счёта уйдёт SMS
            </div>
          )}
        </div>
      </section>

      <div className={`ola-savebar ${dirty ? 'dirty' : ''}`}>
        <span className={`state ${dirty ? 'dirty' : ''}`}>
          {dirty ? 'Есть несохранённые изменения' : 'Всё сохранено'}
        </span>
        <button className="ola-btn primary" onClick={saveSettings} disabled={!dirty}>
          Сохранить общие
        </button>
      </div>
    </>
  );
}

// ══ Вкладка «Журнал» ══════════════════════════════════════════════════════

/**
 * Журнал отправок (ver. 8.31).
 *
 * Хранится в базе он весь и всегда — строка заводится в pending и остаётся с
 * исходом навсегда. До 8.31 наружу отдавались последние 50 строк, и по сети с
 * тысячей отправок в сутки это означало «журнал за последний час»: вчерашний
 * день открыть было нечем. Отсюда страницы.
 *
 * Фильтров стало шесть, и они разного рода:
 *
 *   • плитки состояния — это одновременно сводка за сутки и фильтр по нашему
 *     исходу. Цифры на них считаются за сутки всегда, а не по выбранному
 *     периоду: это состояние рассылки, и меняться от того, что в поиске набрали
 *     номер, оно не должно — иначе «ноль недоставленных» значит «ничего не
 *     нашлось», а не «всё хорошо»;
 *   • отчёт провайдера — отдельно от нашего исхода. «Мы отправили» и «человек
 *     получил» разные вопросы: принятая Имобисом SMS лежит у нас как sent, а
 *     через минуту приходит отчёт rejected, и разбирают в журнале как раз такие
 *     строки;
 *   • период — по времени заведения, а не отправки: у пропущенных и ждущих
 *     строк отправки не было вовсе, и по её дате они бы не нашлись.
 *
 * Фильтр сбрасывает страницу на первую: иначе после сужения выборки экран
 * оставался пустым на седьмой странице того, чего больше нет.
 */

const DELIVERY_FILTER_VIEW = [
  { key: 'delivered', label: 'дошло до человека' },
  { key: 'failed', label: 'провайдер отказал' },
  { key: 'none', label: 'отчёта нет' }
];

const CHANNEL_FILTER_VIEW = [
  { key: 'telegram', label: 'Telegram' },
  { key: 'max', label: 'MAX' },
  { key: 'sms', label: 'SMS' },
  { key: 'vk', label: 'ВКонтакте' },
  { key: 'viber', label: 'Viber' }
];

const PAGE_SIZE = 50;
const EMPTY_FILTERS = { status: '', event: '', channel: '', delivery: '', phone: '', from: '', to: '' };

function LogTab() {
  const [log, setLog] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const setFilter = (patch) => {
    setFilters(f => ({ ...f, ...patch }));
    setPage(0);
  };

  const { status, event, channel, delivery, phone, from, to } = filters;

  useEffect(() => {
    // Поиск по номеру ждёт паузы в наборе: журнал за всё время — сотни тысяч
    // строк, и запрос на каждую цифру гонял бы их впустую.
    setLoading(true);
    const timer = setTimeout(() => {
      const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      if (status) params.status = status;
      if (event) params.event = event;
      if (channel) params.channel = channel;
      if (delivery) params.delivery = delivery;
      if (phone.replace(/\D/g, '')) params.phone = phone.replace(/\D/g, '');
      if (from) params.from = from;
      if (to) params.to = to;

      notifApi.outbox(params)
        .then(({ data }) => setLog(data))
        .catch(() => toast.error('Не удалось загрузить журнал'))
        .finally(() => setLoading(false));
    }, phone ? 350 : 0);

    return () => clearTimeout(timer);
  }, [status, event, channel, delivery, phone, from, to, page]);

  const total = log?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <>
      <div className="ola-log-head">
        {Object.entries(STATUS_VIEW).map(([key, view]) => (
          <button
            key={key}
            className={`ola-stat ${view.cls} ${status === key ? 'active' : ''}`}
            onClick={() => setFilter({ status: status === key ? '' : key })}
          >
            <span className="value">{log ? (log.counts[key] ?? 0) : '—'}</span>
            <span className="label">{view.label}</span>
          </button>
        ))}

        <div className="ola-log-search">
          <Search size={16} />
          <input
            placeholder="Поиск по номеру"
            value={phone}
            onChange={e => setFilter({ phone: e.target.value })}
          />
        </div>
      </div>

      <div className="ola-log-filters">
        <label className="ola-log-filter">
          <span>Событие</span>
          <select className="ola-select" value={event} onChange={e => setFilter({ event: e.target.value })}>
            <option value="">любое</option>
            {Object.keys(EVENT_VIEW).map(key => (
              <option key={key} value={key}>{EVENT_VIEW[key].title}</option>
            ))}
          </select>
        </label>

        <label className="ola-log-filter">
          <span>Канал</span>
          <select className="ola-select" value={channel} onChange={e => setFilter({ channel: e.target.value })}>
            <option value="">любой</option>
            {CHANNEL_FILTER_VIEW.map(item => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
        </label>

        <label className="ola-log-filter">
          <span>Отчёт провайдера</span>
          <select className="ola-select" value={delivery} onChange={e => setFilter({ delivery: e.target.value })}>
            <option value="">любой</option>
            {DELIVERY_FILTER_VIEW.map(item => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
        </label>

        <label className="ola-log-filter">
          <span>С даты</span>
          <input className="ola-input" type="date" value={from} onChange={e => setFilter({ from: e.target.value })} />
        </label>

        <label className="ola-log-filter">
          <span>По дату</span>
          <input className="ola-input" type="date" value={to} onChange={e => setFilter({ to: e.target.value })} />
        </label>

        {filtered && (
          <button className="ola-btn ola-log-reset" onClick={() => { setFilters(EMPTY_FILTERS); setPage(0); }}>
            <RotateCcw size={14} /> Сбросить
          </button>
        )}
      </div>

      {log && (
        <div className="ola-log-count">
          {loading
            ? 'Ищем…'
            : (total === 0
              ? 'Ничего не нашлось'
              : `${total.toLocaleString('ru-RU')} ${plural(total, 'отправка', 'отправки', 'отправок')}`
                + (pages > 1 ? ` · страница ${page + 1} из ${pages}` : ''))}
        </div>
      )}

      {log && log.rows.length === 0 && (
        <div className="ola-empty">
          <Inbox size={34} />
          <h3>Отправок не нашлось</h3>
          <p>{filtered ? 'Снимите фильтры или расширьте период.' : 'Детектор ещё не находил событий.'}</p>
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
              {/* Отчёт провайдера рядом с нашим исходом, а не вместо него: «мы
                  отправили» и «дошло» — разные утверждения, и подменять одно
                  другим значит терять как раз спорные строки. */}
              {row.deliveryStatus && (
                <span className="ola-badge" title="Отчёт провайдера о доставке">{row.deliveryStatus}</span>
              )}
              <span className="time">{new Date(row.sentAt || row.plannedAt).toLocaleString('ru-RU')}</span>
            </div>
            <div className="ola-row-text">{row.text}</div>
            {row.error && <div className="ola-row-error">{row.error}</div>}
          </article>
        );
      })}

      {pages > 1 && (
        <div className="ola-log-pager">
          <button className="ola-btn" disabled={page === 0} onClick={() => setPage(0)}>Начало</button>
          <button className="ola-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={15} /> Назад
          </button>
          <span className="ola-log-pager-state">{page + 1} из {pages}</span>
          <button className="ola-btn" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>
            Вперёд <ChevronRight size={15} />
          </button>
          <button className="ola-btn" disabled={page + 1 >= pages} onClick={() => setPage(pages - 1)}>Конец</button>
        </div>
      )}
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
                label={p.allowed ? `Выключить отправку через ${p.title}` : `Включить отправку через ${p.title}`}
              />
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
              Сохранить
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
  // Заведение линии и выбор филиала у текстов живут здесь, а не во вкладках
  // (ver. 8.31). Оба органа управления переехали в строку вкладок: заголовок
  // страницы убран, и эта строка осталась единственной шапкой — держать в ней
  // пусто, пока под ней стоит кнопка «Новая линия», было бы расточительством
  // целой строки экрана. Состояние пришлось поднять сюда же: рисует их шапка, а
  // распоряжается ими вкладка.
  const [creatingLine, setCreatingLine] = useState(false);
  const [branchId, setBranchId] = useState('');

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

  // Филиал у вкладки «Тексты»: выбранный, если он ещё есть в справочнике, иначе
  // первый. Справочник приезжает вместе с шаблонами, поэтому и считается здесь.
  const medCenters = templates?.medCenters || [];
  const branch = medCenters.some(mc => mc.id === branchId) ? branchId : (medCenters[0]?.id || '');

  return (
    <div className="admin-page">
      <div className="ola-shell">
        <div className="ola-bar">
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

          {tab === 'lines' && (
            <button className="ola-btn primary ola-bar-side" onClick={() => setCreatingLine(v => !v)}>
              <Plus size={15} /> Новая линия
            </button>
          )}

          {tab === 'texts' && medCenters.length > 0 && (
            <div className="ola-bar-side ola-template-scope">
              <label htmlFor="ola-template-medcenter"><Building2 size={16} /> Филиал</label>
              <select
                id="ola-template-medcenter"
                className="ola-select"
                value={branch}
                onChange={e => setBranchId(e.target.value)}
              >
                {medCenters.map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Единственный текст, оставленный в интерфейсе. Это не пояснение, а
            состояние системы: пока предохранитель стоит, часть отправок
            помечается пропущенной, и понимать это надо до того, как начнёшь
            разбираться по журналу.
            
            Раньше здесь была одна строка про Fromni, и она врала: предохранитель
            стоял внутри ветки Fromni, а прямая отправка через Имобис проходила
            мимо него. Теперь перечисляем провайдеров поимённо — утверждение
            «наружу ничего не уходит» должно быть проверяемым. */}
        {tab === 'lines' && <LinesTab creating={creatingLine} setCreating={setCreatingLine} />}
        {tab === 'texts' && (
          <TemplatesTab data={templates} steps={steps} reload={loadTemplates} selected={branch} />
        )}
        {tab === 'delivery' && <DeliveryTab templates={templates} safety={safety} onSafetyChange={loadTemplates} />}
        {tab === 'log' && <LogTab />}
        {tab === 'widget' && <WidgetTab />}
      </div>
    </div>
  );
}
