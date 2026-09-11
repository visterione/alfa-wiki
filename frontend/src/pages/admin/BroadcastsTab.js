import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus, Trash2, Send, Image as ImageIcon, X, Play, Pause,
  Users, AlertTriangle, Check, Clock, Ban, Megaphone, Copy, Bookmark, CalendarClock
} from 'lucide-react';
import { broadcasts as api } from '../../services/api';
import ChannelLogo from '../../components/openline/ChannelLogo';
import toast from 'react-hot-toast';
import './BroadcastsTab.css';

/**
 * Рекламные рассылки подписчикам ботов (ver. 8.07).
 *
 * Экран собирает одно сообщение — картинку с подписью — и отправляет его всем
 * подписчикам выбранных медцентров от имени их же ботов. От соседней вкладки
 * «Рассылка» отличается принципиально: та настраивает, как уходят уведомления о
 * визитах, и отправляет их МИС; эта отправляет по нашей инициативе и всем сразу.
 *
 * Проверочная отправка доступна как инструмент предпросмотра, но не является
 * обязательным шагом. Немедленный запуск и планирование доступны сразу после
 * заполнения сообщения и выбора хотя бы одного медцентра.
 *
 * Счётчик под текстом считает до 1024 символов. Предел телеграмный: столько
 * вмещает подпись под фотографией. Он же держится для рассылки без картинки —
 * иначе добавленная в последний момент картинка обрезала бы готовый текст.
 */

const LIMIT = 1024;
const MOSCOW_TIMEZONE = 'Europe/Moscow';
const moscowDateTimeValue = (date) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: MOSCOW_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23'
}).format(date).replace(' ', 'T');
const parseMoscowDateTime = (value) => value ? new Date(`${value}:00+03:00`) : null;
const formatMoscowDateTime = (value) => new Date(value).toLocaleString('ru-RU', {
  timeZone: MOSCOW_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit'
});

const STATUS_VIEW = {
  draft:   { label: 'черновик',  icon: Clock,         cls: 'muted' },
  scheduled: { label: 'запланирована', icon: CalendarClock, cls: 'wait' },
  sending: { label: 'идёт',      icon: Play,          cls: 'wait'  },
  paused:  { label: 'остановлена', icon: Pause,       cls: 'muted' },
  done:    { label: 'разослана', icon: Check,         cls: 'ok'    },
  failed:  { label: 'сорвалась', icon: AlertTriangle, cls: 'bad'   }
};

function StatusBadge({ status }) {
  const view = STATUS_VIEW[status] || STATUS_VIEW.draft;
  const Icon = view.icon;
  return <span className={`ola-badge ${view.cls}`}><Icon size={12} /> {view.label}</span>;
}

// ══ Список ════════════════════════════════════════════════════════════════

function BroadcastList({ items, selectedId, onSelect, onCreate, templateMode }) {
  return (
    <aside className="brc-list">
      <button className="ola-btn primary brc-new" onClick={onCreate}>
        <Plus size={14} /> {templateMode ? 'Новый шаблон' : 'Новая рассылка'}
      </button>

      {!items.length && (
        <div className="ola-empty"><Megaphone size={28} /><span>{templateMode ? 'Шаблонов пока нет' : 'Рассылок пока нет'}</span></div>
      )}

      {items.map(item => (
        <button
          key={item.id}
          className={`brc-item ${item.id === selectedId ? 'active' : ''}`}
          onClick={() => onSelect(item.id)}
        >
          <span className="brc-item-title">{item.title}</span>
          <span className="brc-item-meta">
            <StatusBadge status={item.status} />
            {item.counts.total > 0 && (
              <span className="brc-item-count">{item.counts.sent} из {item.counts.total}</span>
            )}
          </span>
        </button>
      ))}
    </aside>
  );
}

// ══ Ход рассылки ══════════════════════════════════════════════════════════

/**
 * Полоса и цифры уже запущенной рассылки. Пропущенные показываем отдельно от
 * не доставленных: пропущен — это отписавшийся или заблокировавший бота, и
 * разбираться в таких строках не надо, а «не доставлено» разбирать стоит.
 */
function Progress({ counts }) {
  const done = counts.sent + counts.failed + counts.skipped;
  const percent = counts.total ? Math.round((done / counts.total) * 100) : 0;

  return (
    <div className="brc-progress">
      <div className="brc-bar"><span style={{ width: `${percent}%` }} /></div>
      <div className="brc-numbers">
        <span className="ok"><Check size={13} /> {counts.sent}</span>
        {counts.skipped > 0 && <span className="muted"><Ban size={13} /> {counts.skipped}</span>}
        {counts.failed > 0 && <span className="bad"><AlertTriangle size={13} /> {counts.failed}</span>}
        <span className="rest">из {counts.total}</span>
      </div>
    </div>
  );
}

function DeliveryIssues({ issues = [] }) {
  if (!issues.length) return null;
  return (
    <div className="brc-issues">
      <strong>Почему не доставлено</strong>
      {issues.map((issue, index) => (
        <div key={`${issue.status}-${issue.error}-${index}`}>
          <span>{issue.count}</span> {issue.error}
        </div>
      ))}
    </div>
  );
}

// ══ Редактор ══════════════════════════════════════════════════════════════

function Editor({ broadcast, sources, onSaved, onDeleted, onCopied }) {
  const [draft, setDraft] = useState(broadcast);
  const [audience, setAudience] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);
  const [test, setTest] = useState({ externalUserId: '', botId: '' });
  const [scheduledAt, setScheduledAt] = useState('');
  const [sendMode, setSendMode] = useState('now');
  const fileRef = useRef(null);

  // Фоновое обновление нужно для счётчиков, но не имеет права перетирать
  // несохранённый черновик. Раньше любой идущий рядом анонс обновлял список раз
  // в пять секунд — и выбранный медцентр исчезал прямо во время набора текста.
  useEffect(() => {
    setDraft(current => {
      if (!current || current.id !== broadcast.id || current.status !== 'draft') return broadcast;
      return {
        ...current,
        status: broadcast.status,
        scheduledAt: broadcast.scheduledAt,
        counts: broadcast.counts,
        issues: broadcast.issues
      };
    });
  }, [broadcast]);

  // А отметку о проверке сбрасываем только при переходе к ДРУГОЙ рассылке.
  //
  // Раньше сброс висел на самом объекте — и отменял сам себя: проверочная
  // отправка сохраняет черновик и перезагружает список, список отдаёт новый
  // объект, эффект срабатывает и гасит только что поставленную отметку. Со
  // стороны это выглядело так, будто проверка не засчитывается вовсе: письмо
  // приходит, а кнопка «Разослать» остаётся серой навсегда.
  //
  // Правки текста, картинки и медцентров отметку по-прежнему снимают — но там,
  // где эти правки происходят, а не здесь: проверять надо то, что уйдёт людям.
  useEffect(() => {
    setTested(false);
  }, [broadcast.id]);

  const editable = draft.status === 'draft';
  const isTemplate = Boolean(draft.isTemplate);
  const centerIds = useMemo(() => draft.medCenterIds || [], [draft.medCenterIds]);

  // Размер аудитории спрашиваем на каждое движение галок: это единственная
  // цифра, по которой видно, что выбраны не те медцентры или что у бота не
  // проставлен филиал.
  useEffect(() => {
    if (!centerIds.length) { setAudience({ total: 0, byPlatform: {} }); return; }
    let alive = true;
    api.audience(centerIds)
      .then(({ data }) => { if (alive) setAudience(data); })
      .catch(() => { if (alive) setAudience(null); });
    return () => { alive = false; };
  }, [centerIds]);

  // Боты выбранных медцентров. Проверку получает не «телеграм вообще», а
  // конкретный бот: первым бот написать не может, и прийти сообщение способно
  // только от того, которому проверяющий когда-то нажал /start.
  const testBots = useMemo(() => sources
    .filter(c => centerIds.includes(c.id))
    .flatMap(c => c.bots.map(b => ({ ...b, center: c.name }))), [sources, centerIds]);

  // Выбранный бот пропал из списка вместе с галкой медцентра — сбрасываем, а не
  // отправляем проверку неизвестно кому.
  useEffect(() => {
    setTest(t => (t.botId && testBots.some(b => b.id === t.botId))
      ? t
      : { ...t, botId: testBots[0]?.id || '' });
  }, [testBots]);

  const patch = (fields) => setDraft(d => ({ ...d, ...fields }));

  const toggleCenter = (id, on) => {
    patch({ medCenterIds: on ? [...centerIds, id] : centerIds.filter(x => x !== id) });
    setTested(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.update(draft.id, {
        title: draft.title,
        text: draft.text,
        medCenterIds: centerIds
      });
      toast.success('Сохранено');
      onSaved(data.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const pickImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setBusy(true);
    try {
      const { data } = await api.uploadImage(draft.id, file);
      patch({ imagePath: data.imagePath });
      setTested(false);
      onSaved(draft.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось загрузить картинку');
    } finally {
      setBusy(false);
    }
  };

  const dropImage = async () => {
    setBusy(true);
    try {
      await api.update(draft.id, { imagePath: null });
      patch({ imagePath: null });
      setTested(false);
      onSaved(draft.id);
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      // Сохраняем перед проверкой: проверять надо то, что уйдёт людям, а не то,
      // что лежало в базе до правки текста.
      await api.update(draft.id, { title: draft.title, text: draft.text, medCenterIds: centerIds });
      await api.test(draft.id, test);
      setTested(true);
      toast.success('Отправлено — посмотрите в мессенджере');
      onSaved(draft.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось отправить');
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    try {
      const { data } = await api.start(draft.id);
      toast.success(`Рассылка пошла: ${data.counts.total} адресатов`);
      onSaved(draft.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось запустить');
    } finally {
      setBusy(false);
    }
  };

  const pause = async () => {
    setBusy(true);
    try {
      await api.pause(draft.id);
      toast.success('Остановлена');
      onSaved(draft.id);
    } finally {
      setBusy(false);
    }
  };

  const schedule = async () => {
    const when = parseMoscowDateTime(scheduledAt);
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      toast.error('Выберите будущую дату и время');
      return;
    }
    setBusy(true);
    try {
      await api.update(draft.id, { title: draft.title, text: draft.text, medCenterIds: centerIds });
      await api.schedule(draft.id, when.toISOString());
      toast.success(`Запланировано на ${formatMoscowDateTime(when)} МСК`);
      onSaved(draft.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось запланировать');
    } finally {
      setBusy(false);
    }
  };

  const unschedule = async () => {
    setBusy(true);
    try {
      await api.unschedule(draft.id);
      toast.success('Отложенная отправка отменена');
      onSaved(draft.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось отменить');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (asTemplate) => {
    setBusy(true);
    try {
      const { data } = await api.copy(draft.id, asTemplate);
      toast.success(asTemplate ? 'Шаблон сохранён' : 'Создан новый черновик');
      onCopied(data.id, asTemplate);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось создать копию');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.remove(draft.id);
      onDeleted();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось удалить');
    } finally {
      setBusy(false);
    }
  };

  const over = (draft.text || '').length > LIMIT;
  const ready = draft.title?.trim() && draft.text?.trim() && centerIds.length && !over;

  return (
    <section className="brc-editor">
      <div className="ola-card">
        <header>
          <span className="ola-card-icon accent"><Megaphone size={17} /></span>
          <h3>{draft.title || (isTemplate ? 'Новый шаблон' : 'Новая рассылка')}</h3>
          <StatusBadge status={draft.status} />
        </header>

        <div className="ola-card-body">
          <div className="ola-field">
            <label>Название</label>
            <input
              className="ola-input"
              value={draft.title || ''}
              disabled={!editable}
              placeholder="Акция на УЗИ, октябрь"
              onChange={e => patch({ title: e.target.value })}
            />
          </div>

          <div className="ola-field">
            <label>
              Кому
              {audience && <span className="ola-badge"><Users size={12} /> {audience.total}</span>}
            </label>
            <div className="ola-checks">
              {sources.map(center => (
                <label
                  key={center.id}
                  className={`ola-check ${centerIds.includes(center.id) ? 'on' : ''} ${center.bots.length ? '' : 'no-bots'}`}
                >
                  <input
                    type="checkbox"
                    checked={centerIds.includes(center.id)}
                    disabled={!editable || !center.bots.length}
                    onChange={e => toggleCenter(center.id, e.target.checked)}
                  />
                  <span>{center.name}</span>
                  <span className="brc-center-bots">
                    {center.bots.length
                      ? center.bots.map(b => <ChannelLogo key={b.platform} channel={b.platform} size={15} />)
                      : <span className="brc-no-bot">без бота</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="ola-field">
            <label>Картинка</label>
            {draft.imagePath ? (
              <div className="brc-image">
                <img src={`/uploads/${draft.imagePath}`} alt="" />
                {editable && (
                  <button className="ola-btn danger" onClick={dropImage} disabled={busy}>
                    <X size={14} /> Убрать
                  </button>
                )}
              </div>
            ) : (
              <>
                <button
                  className="ola-btn"
                  disabled={!editable || busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImageIcon size={14} /> Выбрать файл
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={pickImage}
                />
              </>
            )}
          </div>

          <div className="ola-field">
            <label>
              Текст
              <span className={`ola-badge ${over ? 'warn' : ''}`}>
                {(draft.text || '').length} / {LIMIT}
              </span>
            </label>
            <textarea
              className="ola-textarea brc-text"
              rows={7}
              value={draft.text || ''}
              disabled={!editable}
              onChange={e => { patch({ text: e.target.value }); setTested(false); }}
            />
          </div>

          {editable && (
            <div className="ola-row">
              <button className="ola-btn primary" disabled={!ready || busy} onClick={save}>
                Сохранить
              </button>
              <button className="ola-btn danger" disabled={busy} onClick={remove}>
                <Trash2 size={14} /> Удалить
              </button>
            </div>
          )}
        </div>
      </div>

      {isTemplate && (
        <div className="ola-card">
          <div className="ola-card-body">
            <button className="ola-btn primary" disabled={!ready || busy} onClick={() => copy(false)}>
              <Copy size={14} /> Создать рассылку по шаблону
            </button>
          </div>
        </div>
      )}

      {/* Проверочная отправка остаётся доступной, но не блокирует запуск. */}
      {editable && !isTemplate && (
        <div className={`ola-card brc-test ${tested ? 'done' : ''}`}>
          <header>
            <span className={`ola-card-icon ${tested ? 'green' : 'amber'}`}>
              {tested ? <Check size={17} /> : <Send size={17} />}
            </span>
            <h3>{tested ? 'Проверочная отправка сделана' : 'Проверочная отправка — необязательно'}</h3>
          </header>
          <div className="ola-card-body">
            <div className="ola-row">
              <select
                className="ola-select narrow"
                value={test.botId}
                onChange={e => setTest(t => ({ ...t, botId: e.target.value }))}
              >
                {!testBots.length && <option value="">Сначала выберите медцентры</option>}
                {testBots.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.username ? `@${b.username}` : b.platform} — {b.center}
                  </option>
                ))}
              </select>
              <input
                className="ola-input"
                placeholder="Ваш id в мессенджере"
                value={test.externalUserId}
                onChange={e => setTest(t => ({ ...t, externalUserId: e.target.value }))}
              />
              <button
                className="ola-btn"
                disabled={!ready || !test.botId || !test.externalUserId.trim() || busy}
                onClick={sendTest}
              >
                <Send size={14} /> Отправить себе
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Запуск и ход */}
      {!isTemplate && <div className="ola-card">
        <div className="ola-card-body">
          {draft.counts?.total > 0 && <Progress counts={draft.counts} />}
          <DeliveryIssues issues={draft.issues} />

          {draft.status === 'sending' && (
            <button className="ola-btn danger" disabled={busy} onClick={pause}>
              <Pause size={14} /> Остановить
            </button>
          )}

          {draft.status === 'paused' && (
            <button className="ola-btn primary" disabled={busy} onClick={start}>
              <Play size={14} /> Продолжить
            </button>
          )}

          {draft.status === 'scheduled' && (
            <div className="brc-scheduled">
              <span><CalendarClock size={16} /> Отправка {formatMoscowDateTime(draft.scheduledAt)} МСК</span>
              <button className="ola-btn danger" disabled={busy} onClick={unschedule}>Отменить</button>
            </div>
          )}

          {['done', 'failed'].includes(draft.status) && (
            <div className="ola-row">
              <button className="ola-btn primary" disabled={busy} onClick={() => copy(false)}><Copy size={14} /> Повторить</button>
              <button className="ola-btn" disabled={busy} onClick={() => copy(true)}><Bookmark size={14} /> Сохранить как шаблон</button>
            </div>
          )}

          {editable && (
            <div className="brc-send-planner">
              <div className="brc-send-mode" role="group" aria-label="Время отправки">
                <button className={sendMode === 'now' ? 'active' : ''} onClick={() => setSendMode('now')}>Сейчас</button>
                <button className={sendMode === 'later' ? 'active' : ''} onClick={() => setSendMode('later')}>По времени</button>
              </div>
              {sendMode === 'later' && (
                <label className="brc-schedule-input">
                  <CalendarClock size={15} />
                  <input
                    type="datetime-local"
                    min={moscowDateTimeValue(new Date(Date.now() + 60000))}
                    value={scheduledAt}
                    onChange={e => { setScheduledAt(e.target.value); setSendMode('later'); }}
                  />
                  <span>МСК</span>
                </label>
              )}
              {sendMode === 'now' ? (
                <button
                  className="ola-btn primary"
                  disabled={!ready || busy}
                  onClick={start}
                >
                  <Send size={14} /> Разослать сейчас{audience?.total ? ` — ${audience.total}` : ''}
                </button>
              ) : (
                <button className="ola-btn primary" disabled={!ready || !scheduledAt || busy} onClick={schedule}>
                  <CalendarClock size={14} /> Запланировать{scheduledAt ? ` на ${scheduledAt.slice(11)}` : ''}
                </button>
              )}
            </div>
          )}

        </div>
      </div>}
    </section>
  );
}

// ══ Вкладка ═══════════════════════════════════════════════════════════════

export default function BroadcastsTab() {
  const [items, setItems] = useState(null);
  const [sources, setSources] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('history');

  const load = useCallback(async (keepId) => {
    try {
      const { data } = await api.list(mode === 'templates' ? 'templates' : undefined);
      setItems(data);
      setSelectedId(id => keepId || (data.some(b => b.id === id) ? id : (data[0]?.id || null)));
    } catch {
      toast.error('Не удалось загрузить рассылки');
    }
  }, [mode]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.sources().then(({ data }) => setSources(data)).catch(() => {}); }, []);

  // Идущая рассылка обновляется сама: смотреть на застывший счётчик и гадать,
  // работает ли движок, — худшее, что можно предложить у кнопки «Остановить».
  const selectedStatus = items?.find(b => b.id === selectedId)?.status;
  const sending = selectedStatus === 'sending' || selectedStatus === 'scheduled';
  useEffect(() => {
    if (!sending) return undefined;
    const timer = setInterval(() => load(selectedId), 5000);
    return () => clearInterval(timer);
  }, [sending, selectedId, load]);

  const create = async () => {
    try {
      const isTemplate = mode === 'templates';
      const { data } = await api.create({
        title: isTemplate ? 'Новый шаблон' : 'Новая рассылка',
        text: '', medCenterIds: [], isTemplate
      });
      await load(data.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось создать');
    }
  };

  if (!items) return <div className="ola-loading">Загрузка…</div>;

  const selected = items.find(b => b.id === selectedId) || null;

  return (
    <>
      <div className="brc-view-tabs">
        <button className={mode === 'history' ? 'active' : ''} onClick={() => { setMode('history'); setItems(null); }}>История и черновики</button>
        <button className={mode === 'templates' ? 'active' : ''} onClick={() => { setMode('templates'); setItems(null); }}>Шаблоны</button>
      </div>
      <div className="brc-columns">
        <BroadcastList items={items} selectedId={selectedId} onSelect={setSelectedId} onCreate={create} templateMode={mode === 'templates'} />
        {selected
          ? <Editor
              key={selected.id}
              broadcast={selected}
              sources={sources}
              onSaved={(id) => load(id)}
              onDeleted={() => load()}
              onCopied={(id, asTemplate) => {
                const nextMode = asTemplate ? 'templates' : 'history';
                setSelectedId(id);
                if (nextMode === mode) load(id);
                else {
                  setItems(null);
                  setMode(nextMode);
                }
              }}
            />
          : <div className="ola-empty brc-blank"><Megaphone size={32} /><span>Выберите {mode === 'templates' ? 'шаблон' : 'рассылку'} слева</span></div>}
      </div>
    </>
  );
}
