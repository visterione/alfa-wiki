import React, { useState, useEffect, useCallback } from 'react';
import { FileText, ScrollText, Check, AlertTriangle, Clock, Ban, Save, Eye, Settings, ArrowUp, ArrowDown, Moon, Send, ListChecks } from 'lucide-react';
import { notifications as api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

/**
 * Шаблоны уведомлений и журнал отправок (ver. 7.86).
 *
 * Тексты правит администратор — так же, как он правил их на экране Renovatio до
 * переезда. Журнал открыт всем, кто работает на линии: вопрос «почему человек не
 * получил напоминание» задают операторам, и отвечать они должны сами.
 */

const EVENT_TITLES = {
  created: 'Запись на визит',
  moved: 'Перенос визита',
  cancelled: 'Отмена визита',
  reminder: 'Напоминание о визите',
  review: 'Просьба об отзыве',
  lab_full: 'Результаты анализов готовы',
  lab_partial: 'Часть результатов готова'
};

const STATUS_VIEW = {
  sent: { label: 'доставлено', icon: Check, cls: 'ok' },
  pending: { label: 'ждёт отправки', icon: Clock, cls: 'wait' },
  failed: { label: 'не доставлено', icon: AlertTriangle, cls: 'bad' },
  skipped: { label: 'пропущено', icon: Ban, cls: 'muted' }
};

function beforeLabel(minutes) {
  if (!minutes) return '';
  if (minutes % 1440 === 0) return `за ${minutes / 1440} сут.`;
  if (minutes % 60 === 0) return `за ${minutes / 60} ч.`;
  return `за ${minutes} мин.`;
}


/**
 * Во сколько SMS обойдётся текст. Кириллица кодируется в UCS-2, и это 70
 * символов на одно сообщение против 160 латиницей; в длинном тексте на каждый
 * сегмент уходит ещё меньше — часть занимает служебный заголовок. Один лишний
 * символ здесь стоит вторую SMS, поэтому счётчик виден прямо в поле.
 */
function smsCost(text) {
  const value = text || '';
  const unicode = /[^\u0000-\u007F]/.test(value);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;

  const chars = value.length;
  const parts = chars === 0 ? 0 : (chars <= single ? 1 : Math.ceil(chars / multi));
  const limit = parts <= 1 ? single : multi * parts;

  return { chars, parts, limit, unicode };
}

export default function NotificationsPanel() {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  const [tab, setTab] = useState(isAdmin ? 'templates' : 'log');
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [preview, setPreview] = useState({});
  const [log, setLog] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [settings, setSettings] = useState(null);
  const [approved, setApproved] = useState(null);
  const [test, setTest] = useState({ phone: '', step: 'sms', templateId: '', busy: false });

  const loadTemplates = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data } = await api.templates();
      setData(data);
      setDrafts({});
    } catch {
      toast.error('Не удалось загрузить шаблоны');
    }
  }, [isAdmin]);

  const loadLog = useCallback(async () => {
    try {
      const { data } = await api.outbox(statusFilter ? { status: statusFilter } : {});
      setLog(data);
    } catch (err) {
      if (err.response?.status !== 403) toast.error('Не удалось загрузить журнал');
    }
  }, [statusFilter]);

  const loadSettings = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data } = await api.settings();
      setSettings(data);
    } catch {
      toast.error('Не удалось загрузить настройки рассылки');
    }
  }, [isAdmin]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => { if (tab === 'settings') loadSettings(); }, [tab, loadSettings]);

  useEffect(() => {
    if (tab !== 'settings' || !isAdmin) return;
    api.approved().then(({ data }) => setApproved(data)).catch(() => setApproved(null));
  }, [tab, isAdmin]);
  useEffect(() => { if (tab === 'log') loadLog(); }, [tab, loadLog]);

  const textOf = (t) => (drafts[t.id] !== undefined ? drafts[t.id] : t.text);
  const smsOf = (t) => (drafts[`sms:${t.id}`] !== undefined ? drafts[`sms:${t.id}`] : (t.smsText || ''));
  const changed = (t) => textOf(t) !== t.text || smsOf(t) !== (t.smsText || '');

  const save = async (t) => {
    try {
      await api.updateTemplate(t.id, { text: textOf(t), smsText: smsOf(t) });
      toast.success('Текст сохранён');
      loadTemplates();
    } catch {
      toast.error('Не удалось сохранить');
    }
  };

  const toggle = async (t, field) => {
    try {
      await api.updateTemplate(t.id, { [field]: !t[field] });
      loadTemplates();
    } catch {
      toast.error('Не удалось изменить');
    }
  };

  const showPreview = async (t) => {
    try {
      const { data } = await api.preview(textOf(t));
      setPreview(p => ({ ...p, [t.id]: data.text }));
    } catch {
      toast.error('Предпросмотр не получился');
    }
  };

  const sendTest = async () => {
    if (!test.phone.trim()) return toast.error('Укажите номер');
    setTest(t => ({ ...t, busy: true }));
    try {
      const { data } = await api.test({
        phone: test.phone.trim(),
        step: test.step,
        templateId: test.templateId || undefined
      });
      if (data.result.error) toast.error(data.result.error);
      else toast.success(`Отправлено: ${data.result.channel}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось отправить');
    } finally {
      setTest(t => ({ ...t, busy: false }));
    }
  };

  const moveStep = (index, delta) => {
    setSettings(s => {
      const next = [...s.cascade];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return { ...s, cascade: next };
    });
  };

  const setQuiet = (field, value) => {
    setSettings(s => ({ ...s, quietHours: { ...s.quietHours, [field]: value } }));
  };

  const saveSettings = async () => {
    try {
      const { data } = await api.saveSettings({
        cascade: settings.cascade,
        quietHours: settings.quietHours
      });
      setSettings(s => ({ ...s, ...data }));
      toast.success('Настройки сохранены');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить');
    }
  };

  const insert = (t, key) => {
    setDrafts(d => ({ ...d, [t.id]: `${textOf(t)}{{${key}}}` }));
  };

  return (
    <div className="nt-root">
      <nav className="nt-tabs">
        {isAdmin && (
          <button className={`nt-tab ${tab === 'templates' ? 'active' : ''}`} onClick={() => setTab('templates')}>
            <FileText size={15} /> Тексты
          </button>
        )}
        <button className={`nt-tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>
          <ScrollText size={15} /> Журнал отправок
        </button>
        {isAdmin && (
          <button className={`nt-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
            <Settings size={15} /> Настройки рассылки
          </button>
        )}
      </nav>

      {/* Предохранители показываем крупно: пока вторая ступень выключена,
          половина отправок помечается пропущенной, и это надо понимать, а не
          выяснять по журналу. */}
      {isAdmin && data && !data.safety.fromniAllowed && (
        <div className="nt-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>Вторая ступень каскада выключена.</strong> Уведомления уходят только
            подписчикам ботов; всё остальное помечается пропущенным. Включается в <code>.env</code>
            {' '}(<code>NOTIFIER_ALLOW_FROMNI=true</code>) — вместе со снятием галок «Отправлять
            сообщение» в МИС у той же организации, иначе пациент получит два уведомления.
          </div>
        </div>
      )}

      {tab === 'templates' && data && (
        <div className="nt-templates">
          {data.templates.map(t => (
            <article key={t.id} className={`nt-card ${t.isActive ? '' : 'off'}`}>
              <header>
                <h3>
                  {EVENT_TITLES[t.event] || t.event}
                  {t.event === 'reminder' && <span className="nt-when">{beforeLabel(t.beforeMinutes)}</span>}
                  {t.event.startsWith('lab_') && !t.isActive && (
                    <span className="nt-when">ждёт разбора события от МИС</span>
                  )}
                  {t.event === 'review' && (
                    <span className="nt-when">
                      через {beforeLabel(t.afterMinutes).replace('за ', '')} после визита
                      {t.frequency === 'daily' ? ', один раз за день' : ', по каждому визиту'}
                    </span>
                  )}
                </h3>
                <div className="nt-card-actions">
                  <label className="nt-check">
                    <input type="checkbox" checked={t.withConfirm} onChange={() => toggle(t, 'withConfirm')} />
                    кнопка «Подтверждаю»
                  </label>
                  <label className="nt-check">
                    <input type="checkbox" checked={t.isActive} onChange={() => toggle(t, 'isActive')} />
                    включено
                  </label>
                </div>
              </header>

              <textarea
                value={textOf(t)}
                onChange={e => setDrafts(d => ({ ...d, [t.id]: e.target.value }))}
                rows={3}
              />

              <div className="nt-sms">
                <label>
                  Короткий текст для SMS
                  <span className="nt-sms-hint">
                    если пусто — уйдёт текст выше, и он может стоить нескольких SMS
                  </span>
                </label>
                <textarea
                  value={smsOf(t)}
                  onChange={e => setDrafts(d => ({ ...d, [`sms:${t.id}`]: e.target.value }))}
                  rows={2}
                  placeholder="Например: Альфа: результаты анализов готовы. Забрать в регистратуре."
                />
                {(() => {
                  const cost = smsCost(smsOf(t) || textOf(t));
                  return (
                    <div className={`nt-sms-cost ${cost.parts > 1 ? 'over' : ''}`}>
                      {cost.chars} симв. из {cost.limit} · {cost.parts <= 1
                        ? 'одна SMS'
                        : `${cost.parts} SMS — платим как за ${cost.parts}`}
                      <span className="nt-sms-hint"> (подстановки при отправке станут длиннее — проверяйте кнопкой «Посмотреть»)</span>
                    </div>
                  );
                })()}
              </div>

              <div className="nt-placeholders">
                {data.placeholders.map(p => (
                  <button key={p.key} type="button" title={p.title} onClick={() => insert(t, p.key)}>
                    {`{{${p.key}}}`}
                  </button>
                ))}
              </div>

              {preview[t.id] && <div className="nt-preview">{preview[t.id]}</div>}

              <footer>
                <button className="nt-btn" onClick={() => showPreview(t)}>
                  <Eye size={14} /> Посмотреть
                </button>
                <button
                  className="nt-btn primary"
                  onClick={() => save(t)}
                  disabled={!changed(t)}
                >
                  <Save size={14} /> Сохранить
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}


      {tab === 'settings' && settings && (
        <div className="nt-settings">
          <section className="nt-card">
            <h3>Порядок каскада</h3>
            <p className="nt-hint">
              Сообщение идёт по ступеням сверху вниз и останавливается на первой, которая
              доставила. Ступени ниже «наших ботов» выполняет Fromni — там же остаются
              её договор и цены.
            </p>

            <ol className="nt-cascade">
              {settings.cascade.map((name, i) => {
                const known = settings.available.find(a => a.name === name);
                return (
                  <li key={name}>
                    <span className="nt-step-no">{i + 1}</span>
                    <span className="nt-step-name">{known ? known.title : name}</span>
                    <button
                      type="button" title="Выше" disabled={i === 0}
                      onClick={() => moveStep(i, -1)}
                    ><ArrowUp size={14} /></button>
                    <button
                      type="button" title="Ниже" disabled={i === settings.cascade.length - 1}
                      onClick={() => moveStep(i, 1)}
                    ><ArrowDown size={14} /></button>
                    <button
                      type="button" title="Убрать" disabled={settings.cascade.length === 1}
                      onClick={() => setSettings(s => ({ ...s, cascade: s.cascade.filter(n => n !== name) }))}
                    >×</button>
                  </li>
                );
              })}
            </ol>

            <div className="nt-placeholders">
              {settings.available.filter(a => !settings.cascade.includes(a.name)).map(a => (
                <button
                  key={a.name} type="button"
                  onClick={() => setSettings(s => ({ ...s, cascade: [...s.cascade, a.name] }))}
                >+ {a.title}</button>
              ))}
            </div>
          </section>

          <section className="nt-card">
            <h3><Moon size={15} /> Тихие часы</h3>
            <p className="nt-hint">
              Сообщение, попавшее в это время, не отменяется — оно ждёт начала разрешённых
              часов и уходит утром. В журнале такая строка видна с пометкой об отсрочке.
            </p>

            <label className="nt-check">
              <input
                type="checkbox"
                checked={!!settings.quietHours.enabled}
                onChange={e => setQuiet('enabled', e.target.checked)}
              />
              не отправлять ночью
            </label>

            <div className="nt-times">
              <label>с
                <input type="time" value={settings.quietHours.from}
                  onChange={e => setQuiet('from', e.target.value)} />
              </label>
              <label>до
                <input type="time" value={settings.quietHours.to}
                  onChange={e => setQuiet('to', e.target.value)} />
              </label>
            </div>

            <div className="nt-quiet-channels">
              <span className="nt-hint">Каких ступеней это касается:</span>
              {settings.available.map(a => (
                <label key={a.name} className="nt-check">
                  <input
                    type="checkbox"
                    checked={(settings.quietHours.channels || []).includes(a.name)}
                    onChange={e => {
                      const list = new Set(settings.quietHours.channels || []);
                      if (e.target.checked) list.add(a.name); else list.delete(a.name);
                      setQuiet('channels', [...list]);
                    }}
                  />
                  {a.title}
                </label>
              ))}
            </div>
          </section>


          <section className="nt-card">
            <h3><Send size={15} /> Проверить отправку</h3>
            <p className="nt-hint">
              Одно сообщение на указанный номер, минуя детектор. Нужно, чтобы убедиться:
              по SMS уходит текст из вики, а не тот, что остался в МИС. Предохранитель
              второй ступени здесь не действует — он защищает от веерной рассылки, а тут
              один номер, набранный руками.
            </p>

            <div className="nt-test">
              <input
                placeholder="+7 999 000-00-00"
                value={test.phone}
                onChange={e => setTest(t => ({ ...t, phone: e.target.value }))}
              />
              <select value={test.step} onChange={e => setTest(t => ({ ...t, step: e.target.value }))}>
                <option value="sms">только SMS</option>
                <option value="fromni">Fromni по каскаду (Notify, потом SMS)</option>
                <option value="bot">только наш бот</option>
                <option value="auto">как в бою: бот, потом Fromni</option>
              </select>
              <select value={test.templateId} onChange={e => setTest(t => ({ ...t, templateId: e.target.value }))}>
                <option value="">какой текст — выберите событие</option>
                {(data ? data.templates : []).map(t => (
                  <option key={t.id} value={t.id}>{EVENT_TITLES[t.event] || t.event}</option>
                ))}
              </select>
              <button className="nt-btn primary" onClick={sendTest} disabled={test.busy}>
                <Send size={14} /> {test.busy ? 'Отправляю…' : 'Отправить'}
              </button>
            </div>
            <p className="nt-hint">
              Результат появится в журнале отправок событием «test» — с каналом, которым
              в итоге ушло.
            </p>
          </section>

          <section className="nt-card">
            <h3><ListChecks size={15} /> Одобренные шаблоны Notify</h3>
            <p className="nt-hint">
              Метод отправки у агрегатора сам ищет наш текст среди зарегистрированных.
              Совпал — уходит Notify, не совпал — <strong>молча SMS</strong>, дороже.
              Поэтому тексты выше стоит писать под эти образцы.
            </p>

            {!approved && <p className="nt-hint">Загрузка…</p>}
            {approved && approved.error && (
              <p className="nt-hint">Агрегатор не ответил: {approved.error}</p>
            )}
            {approved && !approved.error && approved.templates.length === 0 && (
              <p className="nt-hint">
                Зарегистрированных шаблонов не нашлось. Возможно, они заведены на стороне
                Имобиса, а не Fromni — тогда проверять придётся тестовой отправкой выше.
              </p>
            )}
            {approved && approved.templates.map(t => (
              <div key={t.id || t.name} className="nt-approved">
                <strong>{t.name || 'без названия'}</strong>
                {t.channels?.length > 0 && <span className="nt-chip">{t.channels.join(', ')}</span>}
                <div>{t.text}</div>
              </div>
            ))}
          </section>

          <div className="nt-card-actions-row">
            <button className="nt-btn primary" onClick={saveSettings}>
              <Save size={14} /> Сохранить настройки
            </button>
          </div>
        </div>
      )}

      {tab === 'log' && (
        <div className="nt-log">
          <div className="nt-log-head">
            {log && Object.entries(STATUS_VIEW).map(([key, view]) => (
              <button
                key={key}
                className={`nt-stat ${view.cls} ${statusFilter === key ? 'active' : ''}`}
                onClick={() => setStatusFilter(statusFilter === key ? '' : key)}
              >
                <span className="nt-stat-value">{log.counts[key] ?? 0}</span>
                <span className="nt-stat-label">{view.label}</span>
              </button>
            ))}
            <span className="nt-log-note">за сутки</span>
          </div>

          {log && log.rows.length === 0 && <p className="nt-empty">Отправок пока не было</p>}

          {log && log.rows.map(row => {
            const view = STATUS_VIEW[row.status] || STATUS_VIEW.pending;
            const Icon = view.icon;
            return (
              <article key={row.id} className={`nt-row ${view.cls}`}>
                <div className="nt-row-top">
                  <Icon size={14} />
                  <span className="nt-row-event">{EVENT_TITLES[row.event] || row.event}</span>
                  <span className="nt-row-phone">{row.phone || 'без телефона'}</span>
                  <span className="nt-row-time">
                    {new Date(row.sentAt || row.plannedAt).toLocaleString('ru-RU')}
                  </span>
                  {row.channel && <span className="nt-chip">{row.channel}</span>}
                </div>
                <div className="nt-row-text">{row.text}</div>
                {row.error && <div className="nt-row-error">{row.error}</div>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
