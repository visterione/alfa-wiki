import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Save, Trash2, Copy, Check, ArrowUp, ArrowDown,
  MonitorSmartphone, Building2, X, Eye, EyeOff
} from 'lucide-react';
import { siteWidgets as api } from '../../services/api';
import ChannelLogo from '../../components/openline/ChannelLogo';
import { SolidIcon } from '../../components/openline/channelBrands';
import toast from 'react-hot-toast';
import './WidgetTab.css';

/**
 * Виджеты связи для сайтов клиник (ver. 8.06).
 *
 * Экран настраивает кнопку, которая висит в углу чужого сайта: какие каналы
 * показать, каким цветом, по какому номеру звонить. Смысл всей затеи в том,
 * что правка здесь доезжает до сайта сама — тег <script> там неизменный, и
 * трогать чужую вёрстку ради смены номера больше не нужно.
 *
 * Вкладка живёт рядом с линиями и рассылкой не случайно: виджет ведёт в те же
 * боты, что и открытая линия, и заводит их тот же человек. Ссылка на бота
 * подставляется из уже заведённых ботов филиала — переписывать @имя с бумажки
 * тут негде.
 *
 * ПРЕДПРОСМОТР НЕ ЖИВОЙ. Он рисует ту же кнопку средствами страницы, а не
 * подключает настоящий виджет: настоящий исполняется в origin чужого сайта, и
 * тащить его на страницу портала — ровно то, чего мы в этой задаче избегаем.
 * Проверять по-настоящему всё равно надо на самом сайте и на 443.
 */

const CHANNEL_TITLES = { telegram: 'Telegram', max: 'MAX', phone: 'Телефон' };

function Switch({ checked, onChange, children }) {
  return (
    <label className="ola-switch">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span className="track" />
      <span>{children}</span>
    </label>
  );
}

function ChannelMark({ type, size = 30 }) {
  if (type === 'phone') {
    // У телефона своего знака нет и быть не может: это способ связи, а не
    // марка. В макете плитка красится цветом виджета — как в самом виджете.
    return (
      <span className="wgt-mark phone" style={{ width: size, height: size }}>
        <SolidIcon name="phone" size={Math.round(size * 0.52)} />
      </span>
    );
  }
  return <ChannelLogo channel={type} size={size} />;
}

// ── Макет виджета ─────────────────────────────────────────────────────────

/**
 * Тот же виджет, собранный средствами страницы: разметка, размеры, движение и
 * поведение повторяют backend/widget/embed.js, но это макет — настоящий скрипт
 * исполняется в origin чужого сайта, и подключать его к порталу мы намеренно
 * не стали (в этом весь смысл принятого решения по безопасности).
 *
 * Макет живёт ровно здесь и нигде больше. Кнопка в углу портала, которую видят
 * все подряд, породила бы поток вопросов «что это у меня внизу»: поэтому она
 * появляется только по нажатию на этой вкладке, подписана как предпросмотр и
 * исчезает вместе с уходом со страницы.
 *
 * @param {boolean} corner Показать в углу настоящей страницы, а не в рамке.
 */
function WidgetMock({ appearance, channels, corner, onExit }) {
  const [open, setOpen] = useState(!corner);

  // В углу макет появляется закрытым — так же, как виджет встречает посетителя
  // сайта; в рамке карточки он сразу раскрыт, иначе смотреть было бы не на что.
  useEffect(() => { setOpen(!corner); }, [corner]);

  useEffect(() => {
    if (!corner) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Первый Esc закрывает окошко, второй — выходит из предпросмотра: так же
      // ведёт себя всё остальное, что открывается поверх страницы.
      setOpen(prev => {
        if (prev) return false;
        onExit();
        return prev;
      });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [corner, onExit]);

  const visible = channels.filter(c => c.enabled !== false);
  const side = appearance.position === 'left' ? 'left' : 'right';
  const style = {
    '--wgt-color': appearance.color,
    '--wgt-fg': foregroundFor(appearance.color),
    '--wgt-bottom': `${corner ? Math.min(Number(appearance.bottomOffset) || 0, 200) : 18}px`
  };

  const body = (
    <div className={`wgt-mock ${side} ${corner ? 'corner' : 'framed'}`} style={style}>
      {/* Кнопка одна и на открытие, и на закрытие — шапки с крестиком у окошка
          больше нет, и закрывать его иначе было бы нечем. */}
      <button
        className={`wgt-mock-fab ${open ? 'open' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        title={open ? 'Закрыть' : (appearance.buttonLabel || 'Написать нам')}
      >
        {/* Оба знака лежат в кнопке всегда и меняются поворотом — как в самом
            виджете. Подмена узла давала бы мгновенный скачок. */}
        <span className="wgt-mock-glyph chat"><SolidIcon name="chat" size={26} /></span>
        <span className="wgt-mock-glyph close"><X size={26} /></span>
      </button>

      {open && (
        <div className="wgt-mock-panel">
          <div className="wgt-mock-list">
            {visible.length === 0 && (
              <div className="wgt-mock-empty">Ни одного включённого канала — на сайте кнопка не появится</div>
            )}
            {visible.map((c, i) => <MockRow channel={c} key={i} />)}
          </div>
        </div>
      )}

      {corner && (
        <div className="wgt-mock-flag">
          <Eye size={13} /> Предпросмотр — видите только вы
          <button onClick={onExit}>Выйти</button>
        </div>
      )}
    </div>
  );

  // В углу — через портал в body: внутри карточки position: fixed отсчитывался
  // бы от неё, если у любого предка окажется transform или filter.
  if (!corner) return body;
  return createPortal(body, document.body);
}

/**
 * Строка канала в макете. Ведёт себя как настоящая, а не изображает её: ссылка
 * открывается, телефон набирается. Предпросмотр, в котором ничего не
 * нажимается, отвечает ровно на один вопрос — «как это выглядит», — а
 * спрашивают обычно второй: «а звонить-то будет?». Здесь можно проверить.
 * Заодно видно, что ссылка на бота ведёт куда надо: опечатку в адресе иначе
 * заметишь только на живом сайте.
 *
 * У телефона нет ни номера, ни кнопки копирования — ровно как в виджете
 * (решение заказчика). Макет обязан врать не больше, чем показывает.
 */
function MockRow({ channel }) {
  const isPhone = channel.type === 'phone';
  const href = isPhone
    ? (channel.value ? `tel:${channel.value}` : undefined)
    : (channel.value || undefined);

  return (
    <a
      className="wgt-mock-row"
      href={href}
      target={isPhone ? undefined : '_blank'}
      rel={isPhone ? undefined : 'noopener noreferrer'}
      title={isPhone ? 'Нажатие звонит по указанному номеру' : 'Открыть ссылку канала'}
    >
      <ChannelMark type={channel.type} size={38} />
      <div className="wgt-mock-row-main">
        <div className="wgt-mock-label">{channel.label || CHANNEL_TITLES[channel.type]}</div>
        {channel.note && <div className="wgt-mock-note">{channel.note}</div>}
      </div>
    </a>
  );
}

/**
 * Белый или тёмный знак поверх выбранного цвета — тот же расчёт, что в самом
 * виджете: на жёлтом и салатовом белая иконка пропадает.
 */
function foregroundFor(hex) {
  const value = /^#[0-9a-f]{6}$/i.test(String(hex || '')) ? hex : '#2f6fed';
  const r = parseInt(value.slice(1, 3), 16);
  const g = parseInt(value.slice(3, 5), 16);
  const b = parseInt(value.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.65 ? '#101828' : '#ffffff';
}

/** Рамка вокруг макета: кусок сайта, чтобы кнопка была видна в своём углу. */
function Preview({ appearance, channels }) {
  return (
    <div className={`wgt-preview ${appearance.position === 'left' ? 'left' : 'right'}`}>
      <div className="wgt-preview-frame">
        <div className="wgt-preview-page">
          <span />
          <span />
          <span />
        </div>
        <WidgetMock appearance={appearance} channels={channels} corner={false} />
      </div>
    </div>
  );
}

// ── Карточка виджета ──────────────────────────────────────────────────────

function WidgetCard({ widget, sources, onChanged, cornerOn, onCorner }) {
  const [draft, setDraft] = useState(widget);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setDraft(widget); }, [widget]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(widget), [draft, widget]);

  const patch = (fields) => setDraft(d => ({ ...d, ...fields }));
  const patchLook = (fields) => setDraft(d => ({ ...d, appearance: { ...d.appearance, ...fields } }));

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.update(widget.id, {
        name: draft.name,
        medCenterId: draft.medCenterId || null,
        channels: draft.channels,
        appearance: draft.appearance,
        allowedOrigins: draft.allowedOrigins,
        isActive: draft.isActive
      });
      onChanged(data);
      toast.success('Сохранено');
    } catch (err) {
      // Сообщение приходит с сервера словами: там же лежит проверка ссылок, и
      // говорить о ней в двух местах разными словами незачем.
      toast.error(err.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(
      `Удалить виджет «${widget.name}»?\n\nТег на сайте останется, но кнопка перестанет появляться. ` +
      'Если нужно просто убрать её на время — снимите галку «Показывать на сайте».'
    )) return;

    try {
      await api.remove(widget.id);
      onChanged(null);
    } catch {
      toast.error('Не удалось удалить');
    }
  };

  const copySnippet = () => {
    navigator.clipboard.writeText(widget.snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => toast.error('Не удалось скопировать'));
  };

  // ── Каналы ──────────────────────────────────────────────────────────────

  const channels = draft.channels || [];
  const setChannels = (next) => patch({ channels: next });

  const editChannel = (index, fields) =>
    setChannels(channels.map((c, i) => (i === index ? { ...c, ...fields } : c)));

  const moveChannel = (index, delta) => {
    const next = channels.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setChannels(next);
  };

  const addChannel = (type) => {
    // Ссылку подставляем из ботов филиала: адрес бота система уже знает, и
    // руками его вписывают только тогда, когда бот заведён не у нас.
    const bot = (sources.bots || []).find(
      b => b.platform === type && b.medCenterId === draft.medCenterId && b.suggestedUrl
    );

    setChannels([...channels, {
      type,
      enabled: true,
      label: type === 'phone' ? 'Позвонить' : CHANNEL_TITLES[type],
      // Подпись подставляем привычную, но она обычный текст и стирается: где-то
      // вместо приглашения хотят часы приёма, а у телефона второй строки чаще
      // всего не нужно вовсе.
      note: type === 'phone' ? '' : `Написать в ${CHANNEL_TITLES[type]}`,
      value: type === 'phone' ? '' : (bot ? bot.suggestedUrl : '')
    }]);
  };

  const taken = new Set(channels.map(c => c.type));

  return (
    <section className={`ola-card ${draft.isActive ? '' : 'off'}`}>
      <header>
        <span className="ola-card-icon accent"><MonitorSmartphone size={17} /></span>
        <h3>{draft.name || 'Без названия'}</h3>
        {widget.medCenter && <span className="ola-badge">{widget.medCenter}</span>}
        <span className="ola-badge">{widget.key}</span>
      </header>

      <div className="ola-card-body">
        <div className="wgt-columns">
          <div className="wgt-settings">
            <div className="ola-row">
              <div className="ola-field">
                <label>Название (видно только здесь)</label>
                <input
                  className="ola-input"
                  value={draft.name}
                  placeholder="Например, «Сайт Альфа-Анапа»"
                  onChange={e => patch({ name: e.target.value })}
                />
              </div>
              <div className="ola-field">
                <label>Филиал</label>
                <select
                  className="ola-select"
                  value={draft.medCenterId || ''}
                  onChange={e => patch({ medCenterId: e.target.value || null })}
                >
                  <option value="">не указан</option>
                  {(sources.medCenters || []).map(mc => (
                    <option key={mc.id} value={mc.id}>{mc.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="ola-field">
              <label>Каналы связи</label>

              {channels.length === 0 && (
                <div className="wgt-hint">Пока ни одного — виджет на сайте не появится.</div>
              )}

              {channels.map((channel, index) => (
                <div className={`wgt-channel ${channel.enabled === false ? 'off' : ''}`} key={index}>
                  <ChannelMark type={channel.type} />

                  <div className="wgt-channel-fields">
                    <input
                      className="ola-input"
                      value={channel.label || ''}
                      placeholder={CHANNEL_TITLES[channel.type]}
                      title="Название кнопки"
                      onChange={e => editChannel(index, { label: e.target.value })}
                    />
                    <input
                      className="ola-input"
                      value={channel.note || ''}
                      placeholder="подпись под названием — можно пустой"
                      title="Вторая строка кнопки. Пустая — строки не будет"
                      onChange={e => editChannel(index, { note: e.target.value })}
                    />
                    <input
                      className="ola-input"
                      value={channel.value || ''}
                      placeholder={channel.type === 'phone' ? '+7 (861) 000-00-00' : 'https://…'}
                      title={channel.type === 'phone' ? 'Номер для звонка (на кнопке не показывается)' : 'Ссылка на бота'}
                      onChange={e => editChannel(index, { value: e.target.value })}
                    />
                  </div>

                  <div className="wgt-channel-actions">
                    <Switch
                      checked={channel.enabled !== false}
                      onChange={v => editChannel(index, { enabled: v })}
                    />
                    <button
                      className="ola-icon-btn" title="Выше"
                      disabled={index === 0}
                      onClick={() => moveChannel(index, -1)}
                    ><ArrowUp size={14} /></button>
                    <button
                      className="ola-icon-btn" title="Ниже"
                      disabled={index === channels.length - 1}
                      onClick={() => moveChannel(index, 1)}
                    ><ArrowDown size={14} /></button>
                    <button
                      className="ola-icon-btn danger" title="Убрать канал"
                      onClick={() => setChannels(channels.filter((_, i) => i !== index))}
                    ><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}

              <div className="ola-actions wgt-add">
                {['telegram', 'max'].map(type => (
                  <button
                    key={type}
                    className="ola-btn"
                    disabled={taken.has(type)}
                    onClick={() => addChannel(type)}
                  >
                    <Plus size={14} /> {CHANNEL_TITLES[type]}
                  </button>
                ))}
                <button className="ola-btn" onClick={() => addChannel('phone')}>
                  <Plus size={14} /> Телефон
                </button>
              </div>
            </div>

            <div className="ola-row">
              <div className="ola-field narrow">
                <label>Цвет</label>
                <div className="wgt-color">
                  <input
                    type="color"
                    value={draft.appearance.color}
                    onChange={e => patchLook({ color: e.target.value })}
                  />
                  <input
                    className="ola-input"
                    value={draft.appearance.color}
                    onChange={e => patchLook({ color: e.target.value })}
                  />
                </div>
              </div>
              <div className="ola-field narrow">
                <label>Угол</label>
                <select
                  className="ola-select"
                  value={draft.appearance.position}
                  onChange={e => patchLook({ position: e.target.value })}
                >
                  <option value="right">справа</option>
                  <option value="left">слева</option>
                </select>
              </div>
              <div className="ola-field narrow">
                <label>Отступ снизу, px</label>
                <input
                  className="ola-input"
                  type="number" min="0" max="300"
                  value={draft.appearance.bottomOffset}
                  onChange={e => patchLook({ bottomOffset: e.target.value })}
                />
              </div>
            </div>

            <div className="ola-field">
              <label>Адреса сайтов, где разрешён виджет (по одному в строке)</label>
              <textarea
                className="ola-textarea"
                rows={3}
                placeholder="medcentralfa.ru&#10;www.medcentralfa.ru&#10;пусто — где угодно"
                value={(draft.allowedOrigins || []).join('\n')}
                onChange={e => patch({
                  allowedOrigins: e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
                })}
              />
            </div>

            <div className="ola-field">
              <label>Тег для сайта</label>
              <div className="wgt-snippet">
                <code>{widget.snippet}</code>
                <button className="ola-icon-btn" onClick={copySnippet} title="Скопировать">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>

          <Preview appearance={draft.appearance} channels={channels} />

          {/* Макет в углу настоящей страницы. Живёт, пока нажата кнопка: уход с
              вкладки размонтирует карточку, и он исчезает сам. */}
          {cornerOn && (
            <WidgetMock
              appearance={draft.appearance}
              channels={channels}
              corner
              onExit={() => onCorner(false)}
            />
          )}
        </div>

        <div className="ola-actions wgt-footer">
          <Switch checked={draft.isActive} onChange={v => patch({ isActive: v })}>
            Показывать на сайте
          </Switch>
          <span className="wgt-spacer" />
          <button className="ola-btn" onClick={() => onCorner(!cornerOn)}>
            {cornerOn ? <EyeOff size={15} /> : <Eye size={15} />}
            {cornerOn ? 'Убрать из угла' : 'Примерить в углу'}
          </button>
          <button className="ola-btn danger" onClick={remove}><Trash2 size={15} /> Удалить</button>
          <button className="ola-btn primary" disabled={!dirty || busy} onClick={save}>
            <Save size={15} /> Сохранить
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Вкладка ───────────────────────────────────────────────────────────────

export default function WidgetTab() {
  const [rows, setRows] = useState(null);
  const [sources, setSources] = useState({ medCenters: [], bots: [] });
  // Кто сейчас примерен в углу. Один на всю вкладку: две кнопки связи в одном
  // углу — это не предпросмотр, а свалка.
  const [cornerId, setCornerId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [list, src] = await Promise.all([api.list(), api.sources()]);
      setRows(list.data.widgets);
      setSources(src.data);
    } catch {
      toast.error('Не удалось загрузить виджеты');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      const { data } = await api.create({ name: 'Новый сайт' });
      setRows(list => [...(list || []), data]);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось создать виджет');
    }
  };

  const changed = (id) => (next) => {
    setRows(list => (next
      ? list.map(w => (w.id === id ? next : w))
      : list.filter(w => w.id !== id)));
    // Удалили тот, что примеряли, — макет в углу убираем вместе с ним
    if (!next) setCornerId(cur => (cur === id ? null : cur));
  };

  if (!rows) return <div className="ola-loading">Загрузка…</div>;

  return (
    <>
      <div className="ola-actions end">
        <button className="ola-btn primary" onClick={create}>
          <Plus size={15} /> Новый виджет
        </button>
      </div>

      {rows.length === 0 && (
        <div className="ola-empty">
          <MonitorSmartphone size={34} />
          <h3>Виджетов пока нет</h3>
          <p>Виджет — это кнопка связи в углу сайта клиники: боты и телефон регистратуры.</p>
        </div>
      )}

      {rows.map(widget => (
        <WidgetCard
          key={widget.id}
          widget={widget}
          sources={sources}
          onChanged={changed(widget.id)}
          cornerOn={cornerId === widget.id}
          onCorner={(on) => setCornerId(on ? widget.id : null)}
        />
      ))}

      {rows.length > 0 && (
        <div className="wgt-note">
          <Building2 size={15} />
          Проверять виджет надо на самом сайте по https, а не на dev-сервере: до сайта он
          доезжает через nginx, и кэш настройки живёт пять минут.
        </div>
      )}
    </>
  );
}
