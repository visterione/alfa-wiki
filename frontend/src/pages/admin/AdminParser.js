import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Download, AlertTriangle, CheckCircle2, Loader2, Globe, X, Link2, Check, Ban, Wand2, Trash2, ImageDown, ListPlus, MapPin } from 'lucide-react';
import { priceParser, priceComparisons, competitorMatching } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';
import './AdminParser.css';

/**
 * Парсер прайсов конкурентов.
 *
 * Сам парсер работает на отдельной машине и интерфейса не имеет — весь цикл
 * ведётся отсюда: вставить ссылку, посмотреть разбор, выбрать города,
 * подтвердить, дальше обходы и забор цен.
 *
 * Ключевая особенность экрана: разбор ссылки — не «нажал и получил». Парсер
 * минутами читает сайт, потом ОСТАНАВЛИВАЕТСЯ и ждёт человека: показывает,
 * что нашёл, и только после подтверждения идёт обход и запись. Раньше разбор
 * сразу переходил в обход, и сайт с пагинацией молча уезжал в базу первой
 * страницей, выданной за весь прайс.
 */

// Пока задача идёт, состояние опрашивается. Две секунды — разбор занимает
// минуты, чаще дёргать парсер незачем
const POLL_MS = 2000;

const dateTime = (value) => value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const date = (value) => value ? new Date(value).toLocaleDateString('ru-RU') : '—';

/** Связь с парсером: пока её нет, всё остальное на странице бесполезно. */
function ConnectionBanner({ status }) {
  if (!status || status.ok) return null;

  return (
    <div className="card" style={{ marginBottom: 16, padding: '14px 16px', border: '1px solid var(--error)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <AlertTriangle size={18} style={{ color: 'var(--error)' }} />
        <strong>Нет связи с парсером</strong>
      </div>
      <p style={{ margin: '0 0 4px' }}>{status.message}</p>
      {status.parserUrl && <small className="text-muted">Адрес: {status.parserUrl}</small>}
    </div>
  );
}

/** Итог разбора: по нему человек решает, собирать сайт или нет. */
function AnalysisSummary({ analysis, rows }) {
  if (!analysis) return null;

  const columns = analysis.preview?.length ? Object.keys(analysis.preview[0]) : [];

  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        {analysis.sections > 1 ? (
          <>
            Прайс разложен по разделам: их <b>{analysis.sections}</b>, на проверенном
            распознано <b>{rows}</b>. Итог по сайту будет больше.
          </>
        ) : (
          <>На странице распознано <b>{rows}</b> позиций.</>
        )}
      </p>

      {analysis.doubts?.length > 0 && (
        <div className="ap-warn">
          <b style={{ display: 'block', marginBottom: 4 }}>На что стоит посмотреть:</b>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {analysis.doubts.map((doubt, i) => <li key={i}>{doubt}</li>)}
          </ul>
        </div>
      )}

      {analysis.notes?.length > 0 && (
        <ul className="text-muted" style={{ margin: '8px 0', paddingLeft: 18, fontSize: 13 }}>
          {analysis.notes.map((note, i) => <li key={i}>{note}</li>)}
        </ul>
      )}

      {columns.length > 0 && (
        <div className="admin-table-container" style={{ marginTop: 12 }}>
          <table className="admin-table">
            <thead>
              <tr>{columns.map(column => <th key={column}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {analysis.preview.slice(0, 8).map((row, i) => (
                <tr key={i}>
                  {columns.map(column => <td key={column}>{String(row[column] ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Экран задачи: ход разбора, подтверждение, итог. */
function JobPanel({ job, onConfirm, onClose, confirming }) {
  const [chosen, setChosen] = useState([]);

  // Города приходят вместе с разбором. По умолчанию отмечаем тот, на котором
  // разбирали: он точно собирается, остальные человек добавляет осознанно
  useEffect(() => {
    if (job?.cities?.options) {
      setChosen(job.cities.options.filter(c => c.current).map(c => c.name));
    }
  }, [job?.cities]);

  if (!job) return null;

  const toggle = (name) => setChosen(prev =>
    prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
  );

  return (
    <div className="card" style={{ marginBottom: 16, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <strong>{job.title || 'Разбор ссылки'}</strong>
        {(job.state === 'done' || job.state === 'failed' || job.state === 'lost') && (
          <button className="btn btn-icon" onClick={onClose} title="Закрыть"><X size={16} /></button>
        )}
      </div>

      {job.state === 'running' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={16} className="spin" />
          <span>{job.stage}</span>
          {job.pages > 0 && <span className="text-muted">· страниц: {job.pages}</span>}
        </div>
      )}

      {job.state === 'lost' && (
        <p style={{ margin: 0 }}>
          {job.stage}. Данные, собранные до перезапуска, уже в базе — проверьте список источников ниже.
        </p>
      )}

      {job.state === 'failed' && (
        <div>
          <p style={{ margin: '0 0 8px', color: 'var(--error)' }}>{job.error}</p>
          <AnalysisSummary analysis={job.analysis} rows={job.rows} />
        </div>
      )}

      {job.state === 'awaiting_confirm' && (
        <div>
          <AnalysisSummary analysis={job.analysis} rows={job.rows} />

          {job.cities && (
            <div style={{ margin: '14px 0' }}>
              <b style={{ display: 'block', marginBottom: 6 }}>
                <Globe size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                У сайта несколько городов — отметьте нужные
              </b>
              <p className="text-muted" style={{ margin: '0 0 8px', fontSize: 13 }}>
                Каждый станет отдельным источником со своим прайсом: цены в городах различаются.
                {job.cities.source === 'browser' && ' Список собран через браузер — проверьте его глазами.'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {job.cities.options.map(city => (
                  <label key={city.name} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(city.name)}
                      onChange={() => toggle(city.name)}
                    />
                    {city.name}{city.current && <span className="text-muted"> (текущий)</span>}
                  </label>
                ))}
              </div>
              {job.cities.note && <small className="text-muted">· {job.cities.note}</small>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary" onClick={() => onConfirm(chosen)} disabled={confirming}>
              {confirming ? 'Запускаем…' : 'Всё верно, собрать'}
            </button>
            <button className="btn btn-ghost" onClick={onClose} disabled={confirming}>Отменить</button>
          </div>
        </div>
      )}

      {job.state === 'done' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />
            <span>Собрано <b>{job.rows}</b> позиций со {job.pages} страниц.</span>
          </div>
          {(job.items_new > 0 || job.items_changed > 0 || job.items_gone > 0) && (
            <p className="text-muted" style={{ margin: '0 0 8px', fontSize: 13 }}>
              Новых {job.items_new}, цена изменилась у {job.items_changed}, пропало {job.items_gone}.
            </p>
          )}
          {Object.keys(job.per_city || {}).length > 1 && (
            <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
              {Object.entries(job.per_city).map(([city, count]) => (
                <li key={city}>{city} — {count}</li>
              ))}
            </ul>
          )}
          <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
            Цены попадут в сравнение после ближайшего забора — его можно запустить кнопкой ниже.
          </p>
        </div>
      )}
    </div>
  );
}

/** Правка текста прямо в ячейке: и название клиники, и подпись в сравнениях. */
function EditableCell({ value, placeholder, hint, bold, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        className="btn btn-ghost"
        style={{ padding: '2px 6px', fontWeight: bold && value ? 600 : 400, textAlign: 'left' }}
        onClick={() => setEditing(true)}
        title={hint}
      >
        {value || <span className="text-muted">{placeholder}</span>}
      </button>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <input
        className="input ap-cell-input"
        style={{ width: 170 }}
        value={draft}
        autoFocus
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
      />
      <button className="btn btn-icon" onClick={save} disabled={saving} title="Сохранить"><Check size={14} /></button>
      <button className="btn btn-icon" onClick={() => { setDraft(value); setEditing(false); }} title="Отмена"><X size={14} /></button>
    </span>
  );
}

/**
 * Как эта клиника называется в сравнениях цен.
 *
 * В зеркале источники зовутся по домену («clinic23-krd»), а в сравнении
 * конкуренты перечислены человеческими названиями («Неомед»). Пока связь
 * не проставлена, цены источника подставлять некуда — и в сопоставлении
 * он не участвует вовсе.
 */
function LabelCell({ source, value, onSaved }) {
  return (
    <EditableCell
      value={value}
      placeholder="указать…"
      hint="Название колонки; город источника добавится автоматически"
      onSave={async next => { await priceParser.setLabel(source.id, next); onSaved(); }}
    />
  );
}

/**
 * Точки клиники: адреса филиалов и пунктов забора.
 *
 * Города для карты мало — у clinic23 в одном Краснодаре десять отделений
 * с разными адресами. Собираются со страницы контактов автоматически, но
 * три сайта из пятнадцати не поддаются: инвитро рисует страницу скриптами,
 * kdl отбивает антиботом, у cl-lab самоподписанный сертификат. Для них
 * адреса вписываются руками, и автосбор их потом не затирает.
 */
function LocationsModal({ source, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', address: '', city: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await priceParser.locations(source.id);
      setItems(data.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось загрузить адреса');
    } finally {
      setLoading(false);
    }
  }, [source.id]);

  useEffect(() => { load(); }, [load]);

  const collect = async () => {
    setBusy(true);
    try {
      const { data } = await priceParser.collectLocations(source.id);
      toast.success(
        data.data.found
          ? `Найдено точек: ${data.data.found}`
          : 'На сайте адресов найти не удалось — впишите вручную'
      );
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось собрать адреса');
    } finally {
      setBusy(false);
    }
  };

  const add = async (event) => {
    event.preventDefault();
    if (!draft.address.trim()) return;
    try {
      await priceParser.addLocation(source.id, draft);
      setDraft({ name: '', address: '', city: '' });
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось добавить');
    }
  };

  const remove = async (item) => {
    try {
      await priceParser.dropLocation(item.parserLocationId ?? item.id);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось убрать');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-md" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Адреса: {source.display_name || source.name}</h2>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <button className="btn" onClick={collect} disabled={busy}>
            <MapPin size={16} /> {busy ? 'Ищем…' : 'Собрать с сайта'}
          </button>
          <span className="text-muted" style={{ fontSize: 13 }}>точек: {items.length}</span>
        </div>

        {loading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : (
          <div className="admin-table-container" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="admin-table">
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td>
                      <div>{item.name || <span className="text-muted">без названия</span>}</div>
                      <small className="text-muted">{item.address}</small>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {item.city || <span className="text-muted">—</span>}
                      {/* вписанному руками веры больше, чем вытащенному из текста */}
                      {item.origin === 'manual' && <div><small className="text-muted">вручную</small></div>}
                    </td>
                    <td>
                      <button className="btn btn-icon" title="Убрать" onClick={() => remove(item)}>
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={3} className="text-muted">Пусто. Соберите с сайта или впишите адрес ниже.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={add} style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          <input
            className="input ap-cell-input" style={{ flex: '1 1 150px' }} placeholder="Название точки"
            value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className="input ap-cell-input" style={{ flex: '2 1 220px' }} placeholder="Адрес*"
            value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })}
          />
          <input
            className="input ap-cell-input" style={{ flex: '0 1 130px' }} placeholder="Город"
            value={draft.city} onChange={e => setDraft({ ...draft, city: e.target.value })}
          />
          <button className="btn btn-primary" type="submit" disabled={!draft.address.trim()}>
            <Check size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Очередь разбора ссылок.
 *
 * Каждый сайт разбирается минутами, а выкатывать их приходится десятками:
 * сдал список, ушёл, вернулся к готовым разборам. Очередь доводит каждый сайт
 * до «разобрано, проверьте» и останавливается — подтверждение остаётся
 * за человеком, иначе сайт с постраничной навигацией молча уедет в базу
 * первой страницей, выданной за весь прайс.
 */
function QueueTab({ onConfirmed }) {
  const [items, setItems] = useState([]);
  const [urls, setUrls] = useState('');
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState({});   // id элемента → отмеченные города

  const load = useCallback(async () => {
    try {
      const { data } = await priceParser.queueList();
      setItems(data.data?.items || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось загрузить очередь');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Пока что-то в работе, список сам обновляется: разбор идёт минутами,
  // и человеку незачем жать «обновить»
  const working = items.some(item => item.status === 'analyzing' || item.status === 'crawling' || item.status === 'queued');
  useEffect(() => {
    if (!working) return undefined;
    const handle = setInterval(load, 5000);
    return () => clearInterval(handle);
  }, [working, load]);

  const handleAdd = async (event) => {
    event.preventDefault();
    const list = urls.split('\n').map(s => s.trim()).filter(Boolean);
    if (!list.length) return;

    setBusy(true);
    try {
      const { data } = await priceParser.queueAdd(list);
      toast.success(
        `В очередь: ${data.data.added}` +
        (data.data.skipped ? `, пропущено повторов: ${data.data.skipped}` : '')
      );
      setUrls('');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось поставить в очередь');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (item) => {
    try {
      await priceParser.queueConfirm(item.id, chosen[item.id] || []);
      await load();
      onConfirmed();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось подтвердить');
    }
  };

  const handleDrop = async (item) => {
    try {
      await priceParser.queueDrop(item.id);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось убрать');
    }
  };

  const toggleCity = (itemId, name, options) => {
    setChosen(prev => {
      const current = prev[itemId] ?? options.filter(c => c.current).map(c => c.name);
      const next = current.includes(name) ? current.filter(n => n !== name) : [...current, name];
      return { ...prev, [itemId]: next };
    });
  };

  const ready = items.filter(i => i.status === 'ready').length;
  const inWork = items.filter(i => ['queued', 'analyzing', 'crawling'].includes(i.status)).length;

  return (
    <>
      <form className="card" onSubmit={handleAdd} style={{ marginBottom: 16, padding: '16px 18px' }}>
        <b style={{ display: 'block', marginBottom: 8 }}>Добавить клиники</b>
        <p className="text-muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
          Вставьте одну или несколько ссылок, по одной в строке. Каждая сразу
          встанет во внутреннюю очередь и обработается после предыдущей.
          Эту страницу можно закрыть и вернуться позже.
        </p>
        <textarea
          className="input ap-cell-input"
          style={{ width: '100%', minHeight: 90, fontFamily: 'monospace', fontSize: 13 }}
          placeholder={'https://клиника-1.рф\nhttps://клиника-2.рф/price/\nhttps://лаборатория.рф'}
          value={urls}
          onChange={e => setUrls(e.target.value)}
          disabled={busy}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <button className="btn btn-primary" type="submit" disabled={busy || !urls.trim()}>
            <ListPlus size={18} /> {busy ? 'Ставим…' : 'В очередь'}
          </button>
          {items.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => { await priceParser.queueClear(); load(); }}
            >
              Прибрать завершённые
            </button>
          )}
          <span className="text-muted" style={{ fontSize: 13 }}>
            {inWork > 0 && `в работе: ${inWork}`}
            {ready > 0 && `${inWork > 0 ? ' · ' : ''}ждут проверки: ${ready}`}
          </span>
        </div>
      </form>

      {items.length > 0 && (
        items.map(item => {
          const options = item.cities?.options || [];
          const picked = chosen[item.id] ?? options.filter(c => c.current).map(c => c.name);
          const analysis = item.analysis || {};

          return (
            <div key={item.id} className="card" style={{ marginBottom: 10, padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.url}</div>
                  <small className="text-muted">
                    {item.status === 'ready' ? 'разобрано — проверьте' : (item.stage || item.status)}
                  </small>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {['queued', 'analyzing', 'crawling'].includes(item.status) && <Loader2 size={16} className="spin" />}
                  {item.status === 'done' && <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />}
                  {item.status === 'failed' && <AlertTriangle size={16} style={{ color: 'var(--error)' }} />}
                  {item.status !== 'analyzing' && item.status !== 'crawling' && (
                    <button className="btn btn-icon" title="Убрать из очереди" onClick={() => handleDrop(item)}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {item.error && (
                <p style={{ margin: '8px 0 0', color: 'var(--error)', fontSize: 13 }}>{item.error}</p>
              )}

              {item.status === 'ready' && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border-light)', paddingTop: 10 }}>
                  <AnalysisSummary analysis={analysis} rows={analysis.rows_found ?? item.rows_found} />

                  {options.length > 0 && (
                    <div style={{ margin: '10px 0' }}>
                      <b style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>
                        <Globe size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                        Города сайта — отметьте нужные
                      </b>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {options.map(city => (
                          <label key={city.name} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
                            <input
                              type="checkbox"
                              checked={picked.includes(city.name)}
                              onChange={() => toggleCity(item.id, city.name, options)}
                            />
                            {city.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <button className="btn btn-primary" onClick={() => handleConfirm(item)}>
                    <Check size={16} /> Всё верно, собрать
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}

/**
 * Проверка только неоднозначных совпадений.
 *
 * Код 804н, точное/сильное название и решения, уже принятые на другом листе,
 * применяются автоматически. Сюда попадает лишь остаток, где автоматике
 * действительно нельзя доверить выбор.
 */
function MatchingTab() {
  const [comparisons, setComparisons] = useState([]);
  const [comparisonId, setComparisonId] = useState('');
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    priceComparisons.list()
      .then(({ data }) => setComparisons(Array.isArray(data) ? data : (data.data || [])))
      .catch(() => toast.error('Не удалось загрузить список сравнений'));
  }, []);

  const load = useCallback(async (id) => {
    if (!id) { setMatches([]); return; }
    setLoading(true);
    try {
      const { data } = await competitorMatching.list(id);
      setMatches(data.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось загрузить сопоставления');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(comparisonId); }, [comparisonId, load]);

  const run = async (what, action, done) => {
    setBusy(what);
    try {
      const { data } = await action();
      done(data.data);
      await load(comparisonId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не получилось');
    } finally {
      setBusy('');
    }
  };

  const handleSuggest = () => run('suggest',
    () => competitorMatching.suggest(comparisonId),
    r => toast.success(
      `Цен подставлено: ${r.filled}, автоматически принято: ${r.autoConfirmed}` +
      (r.reused ? `, взято с других листов: ${r.reused}` : '') +
      (r.review ? `, требуют проверки: ${r.review}` : '')));

  const decide = async (match, accept) => {
    try {
      if (accept) {
        // цена уходит в сравнение сразу при принятии — отдельного шага нет
        const { data } = await competitorMatching.confirm(comparisonId, match.id);
        const reused = data.data?.reused || 0;
        toast.success(`Принято${reused ? ` и применено ещё на ${reused} листах` : ''}`);
      } else {
        await competitorMatching.reject(comparisonId, match.id);
      }
      await load(comparisonId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось сохранить решение');
    }
  };

  // Принятые и отклонённые строки не превращаем в бесконечный архив:
  // эта вкладка — рабочая очередь только действительно спорных вариантов.
  const reviewMatches = matches.filter(match => match.status === 'suggested');

  // Соответствия приходят плоским списком, а решение человек принимает
  // по нашей позиции целиком: видеть надо всех кандидатов сразу
  const byItem = [];
  const index = new Map();
  for (const match of reviewMatches) {
    if (!index.has(match.itemId)) {
      index.set(match.itemId, { itemId: match.itemId, ourName: match.ourName, ourCode: match.ourCode, rows: [] });
      byItem.push(index.get(match.itemId));
    }
    index.get(match.itemId).rows.push(match);
  }

  const pending = reviewMatches.length;
  const confirmed = matches.filter(m => m.status === 'confirmed').length;

  return (
    <>
      <div className="card" style={{ marginBottom: 16, padding: '16px 18px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="input ap-cell-input"
            style={{ flex: '1 1 280px' }}
            value={comparisonId}
            onChange={e => setComparisonId(e.target.value)}
          >
            <option value="">— выберите сравнение цен —</option>
            {comparisons.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <button className="btn btn-primary" onClick={handleSuggest} disabled={!comparisonId || busy}>
            <Wand2 size={16} /> {busy === 'suggest' ? 'Сопоставляем…' : 'Сопоставить автоматически'}
          </button>
        </div>

        <p className="text-muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
          Точные совпадения и связи, уже проверенные на других листах, применяются
          без участия человека. Ниже показываются только неоднозначные названия.
          Явное принятие заменяет старую ручную цену ценой парсера; ночное
          обновление само по себе ручные значения не трогает.
          {comparisonId && matches.length > 0 && (
            <> Сейчас: ждут решения <b>{pending}</b>, принято <b>{confirmed}</b>.</>
          )}
        </p>
      </div>

      {loading ? (
        <div className="admin-loading"><div className="loading-spinner" /></div>
      ) : !comparisonId ? (
        <div className="admin-empty">
          <Link2 size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p>Выберите сравнение цен, чтобы подобрать к его позициям услуги конкурентов.</p>
        </div>
      ) : byItem.length === 0 ? (
        <div className="admin-empty">
          <CheckCircle2 size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p>
            Спорных совпадений нет.
            {confirmed
              ? ` Автоматически или ранее принято: ${confirmed}.`
              : ' Нажмите «Сопоставить автоматически», если конкурент добавлен недавно.'}
          </p>
        </div>
      ) : (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Наша позиция</th>
                <th>Услуга конкурента</th>
                <th>Клиника</th>
                <th>Цена</th>
                <th>Подобрано</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {byItem.map(group => group.rows.map((match, i) => (
                <tr key={match.id} style={{ opacity: match.status === 'rejected' ? 0.45 : 1 }}>
                  {i === 0 && (
                    <td rowSpan={group.rows.length} style={{ verticalAlign: 'top' }}>
                      <div>{group.ourName}</div>
                      {group.ourCode && <small className="text-muted">{group.ourCode}</small>}
                    </td>
                  )}
                  <td>
                    <div>{match.competitorName}</div>
                    {match.competitorCategory && <small className="text-muted">{match.competitorCategory}</small>}
                  </td>
                  <td>{match.competitorLabel}{match.city && <small className="text-muted"> · {match.city}</small>}</td>
                  <td>{match.price != null ? Number(match.price).toLocaleString('ru-RU') : '—'}</td>
                  <td>
                    {match.method === 'code804' ? (
                      <span title="Совпал код 804н — это точное соответствие">по коду 804н</span>
                    ) : (
                      <span title="Похожее название — требует проверки глазами">
                        по названию · {Math.round(Number(match.score) * 100)}%
                      </span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {match.status === 'confirmed' ? (
                      <span style={{ color: 'var(--success)' }}>
                        <CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> принято
                        {match.confirmedByName && <small className="text-muted"> · {match.confirmedByName}</small>}
                      </span>
                    ) : match.status === 'rejected' ? (
                      <span className="text-muted">отклонено</span>
                    ) : (
                      <>
                        <button className="btn btn-icon" title="Принять" onClick={() => decide(match, true)}>
                          <Check size={14} />
                        </button>
                        <button className="btn btn-icon" title="Отклонить" onClick={() => decide(match, false)}>
                          <Ban size={14} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function AdminParser() {
  const [tab, setTab] = useState('sources');
  const [connection, setConnection] = useState(null);
  const [sources, setSources] = useState([]);
  const [logos, setLogos] = useState({});
  const [toDelete, setToDelete] = useState(null);
  const [locationsFor, setLocationsFor] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [syncBySourceId, setSyncBySourceId] = useState({});
  const [syncRunning, setSyncRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const [confirming, setConfirming] = useState(false);

  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  // Подтверждение снова запускает работу, а опрос к этому моменту уже
  // остановился. Счётчик перезапускает его, не пересоздавая задачу
  const [pollNonce, setPollNonce] = useState(0);

  const loadSources = useCallback(async () => {
    try {
      const { data } = await priceParser.sources();
      setSources(data.data || []);
      setConnection({ ok: true });
    } catch (err) {
      const body = err.response?.data;
      setConnection({ ok: false, message: body?.message || 'Парсер недоступен', parserUrl: body?.parserUrl });
      setSources([]);
    }
  }, []);

  const loadSyncStatus = useCallback(async () => {
    try {
      const { data } = await priceParser.syncStatus();
      const byId = {};
      for (const row of data.data || []) byId[row.parserSourceId] = row;
      setSyncBySourceId(byId);
      setSyncRunning(Boolean(data.running));
    } catch {
      // состояние синхронизации — вспомогательное: без него страница
      // остаётся рабочей, поэтому молча
    }
  }, []);

  // Логотипы приходят готовыми data-URI одним запросом: <img> не умеет слать
  // заголовок авторизации, а весь API вики за JWT
  const loadLogos = useCallback(async () => {
    try {
      const { data } = await priceParser.logos();
      setLogos(data.data || {});
    } catch {
      // без логотипов таблица работает — молча
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([loadSources(), loadSyncStatus(), loadLogos()]);
      setLoading(false);
    })();
  }, [loadSources, loadSyncStatus, loadLogos]);

  // Опрос задачи, пока она идёт. Останавливаемся, как только парсер встал:
  // закончил, упал или ждёт подтверждения
  useEffect(() => {
    if (!jobId) return undefined;

    let cancelled = false;
    let handle;
    const tick = async () => {
      try {
        const { data } = await priceParser.job(jobId);
        if (cancelled) return;
        setJob(data.data);

        if (data.data.state === 'running') {
          handle = setTimeout(tick, POLL_MS);
        } else if (data.data.state === 'done') {
          // источник мог только что появиться — список обязан это показать
          loadSources();
        }
      } catch (err) {
        if (cancelled) return;
        toast.error(err.response?.data?.message || 'Не удалось получить состояние задачи');
      }
    };

    tick();
    return () => { cancelled = true; clearTimeout(handle); };
  }, [jobId, pollNonce, loadSources]);

  // Пока идёт забор цен, подглядываем за ним. Признак `running` приходит
  // с сервера, поэтому опрос гасит сам себя, когда работа кончилась
  useEffect(() => {
    if (!syncRunning) return undefined;
    const handle = setInterval(loadSyncStatus, 3000);
    return () => clearInterval(handle);
  }, [syncRunning, loadSyncStatus]);

  const handleConfirm = async (cities) => {
    setConfirming(true);
    try {
      await priceParser.confirm(jobId, cities);
      setJob(prev => ({ ...prev, state: 'running', stage: 'Сохраняем источник' }));
      setPollNonce(nonce => nonce + 1);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось подтвердить разбор');
    } finally {
      setConfirming(false);
    }
  };

  const handleRefresh = async (source) => {
    try {
      const { data } = await priceParser.refresh(source.id);
      setJobId(data.data.job_id);
      setJob({ state: 'running', stage: 'В очереди', title: source.name });
      toast.success(`Обход ${source.name} запущен`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось запустить обход');
    }
  };

  const handleBranding = async (source) => {
    try {
      const { data } = await priceParser.branding(source.id);
      // название не перебиваем, если его уже вписали руками, — так решает парсер
      if (data.data?.error) {
        toast.error(`Сайт не отдал карточку: ${data.data.error}`);
      } else {
        toast.success(`Карточка обновлена: ${data.data?.title || source.name}`);
      }
      await Promise.all([loadSources(), loadLogos()]);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось подтянуть карточку');
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await priceParser.remove(toDelete.id);
      toast.success(`Клиника «${toDelete.display_name || toDelete.name}» удалена`);
      setToDelete(null);
      await Promise.all([loadSources(), loadSyncStatus(), loadLogos()]);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось удалить');
    } finally {
      setDeleting(false);
    }
  };

  const handleSync = async () => {
    try {
      await priceParser.sync();
      // дальше за ходом дела следит отдельный эффект
      setSyncRunning(true);
      toast.success('Забор цен запущен');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось запустить забор цен');
    }
  };

  // Опрос остановит сам эффект: он завязан на jobId
  const closeJob = () => { setJobId(null); setJob(null); };

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Парсер цен конкурентов</h1>
        {tab === 'sources' && (
          <button className="btn" onClick={handleSync} disabled={syncRunning || !connection?.ok}>
            <Download size={18} /> {syncRunning ? 'Забираем цены…' : 'Забрать цены сейчас'}
          </button>
        )}
      </div>

      <div className="admin-tabs">
        {[
          { id: 'sources',  label: 'Источники' },
          { id: 'matching', label: 'Требуют проверки' },
        ].map(t => (
          <button
            key={t.id}
            className={`admin-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'matching' ? <MatchingTab /> : <>

      <ConnectionBanner status={connection} />

      <QueueTab onConfirmed={loadSources} />
      <JobPanel job={job} onConfirm={handleConfirm} onClose={closeJob} confirming={confirming} />

      {loading ? (
        <div className="admin-loading"><div className="loading-spinner" /></div>
      ) : sources.length === 0 ? (
        <div className="admin-empty">
          <Globe size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p>Источников пока нет. Вставьте ссылку на прайс конкурента выше.</p>
        </div>
      ) : (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Клиника</th>
                <th>Город</th>
                <th>Услуг</th>
                <th>Название в сравнениях</th>
                <th>Сайт обойдён</th>
                <th>Цены забраны</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sources.map(source => {
                const sync = syncBySourceId[source.id];
                return (
                  <tr key={source.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {logos[source.id] ? (
                          <img
                            src={logos[source.id]}
                            alt=""
                            style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }}
                          />
                        ) : (
                          <span style={{ width: 24, flexShrink: 0 }} />
                        )}
                        <div>
                          {/* Название с сайта, а не домен: у сети из двадцати
                              городов домены различаются лишь приставкой */}
                          <EditableCell
                            value={source.display_name || ''}
                            placeholder={source.name}
                            hint="Название клиники — можно поправить, если автомат угадал криво"
                            bold
                            onSave={async next => {
                              await priceParser.rename(source.id, next);
                              loadSources();
                            }}
                          />
                          <div><small className="text-muted">{source.base_url}</small></div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {/* Правится здесь, а не при вводе ссылки: у сайта без
                          переключателя городов взять город неоткуда */}
                      <EditableCell
                        value={source.city || ''}
                        placeholder="указать…"
                        hint="Город клиники"
                        onSave={async next => {
                          await priceParser.setCity(source.id, next);
                          loadSources();
                        }}
                      />
                      <div>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '0 4px', fontSize: 12 }}
                          onClick={() => setLocationsFor(source)}
                          title="Адреса точек — для карты в сравнении цен"
                        >
                          <MapPin size={12} style={{ verticalAlign: -1 }} /> адреса
                          {source.filials_total > 0 && ` · филиалов ${source.filials_total}`}
                        </button>
                      </div>
                    </td>
                    <td>{source.services_total}</td>
                    <td>
                      <LabelCell
                        source={source}
                        value={sync?.competitorLabel || ''}
                        onSaved={loadSyncStatus}
                      />
                    </td>
                    <td>
                      {date(source.last_run?.finished_at || source.last_run?.started_at)}
                      {source.last_run?.status && source.last_run.status !== 'ok' && (
                        <div><small style={{ color: 'var(--error)' }}>{source.last_run.status}</small></div>
                      )}
                    </td>
                    <td>
                      {/* Две даты намеренно рядом: свежий забор недельного обхода
                          даёт всё ещё недельные цены */}
                      {dateTime(sync?.syncedAt)}
                      {sync?.syncStatus === 'failed' && (
                        <div><small style={{ color: 'var(--error)' }}>{sync.syncError}</small></div>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-icon"
                        title="Обойти сайт заново"
                        onClick={() => handleRefresh(source)}
                        disabled={job?.state === 'running'}
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        className="btn btn-icon"
                        title="Подтянуть название и логотип с сайта"
                        onClick={() => handleBranding(source)}
                      >
                        <ImageDown size={14} />
                      </button>
                      <button
                        className="btn btn-icon"
                        title="Удалить клинику"
                        onClick={() => setToDelete(source)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {locationsFor && (
        <LocationsModal source={locationsFor} onClose={() => setLocationsFor(null)} />
      )}

      {toDelete && (
        <div className="modal-overlay" onClick={() => !deleting && setToDelete(null)}>
          <div className="modal modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Удалить клинику?</h2>
              <button className="btn-icon" onClick={() => setToDelete(null)} disabled={deleting}>
                <X size={20} />
              </button>
            </div>
            <p>
              <b>{toDelete.display_name || toDelete.name}</b>
              {toDelete.city && ` — ${toDelete.city}`}
            </p>
            <p className="text-muted" style={{ fontSize: 13 }}>
              Уйдут все {toDelete.services_total} услуг, их цены и история обходов.
              Отменить это нельзя — клинику придётся заводить заново по ссылке.
            </p>

            {/* Рукописный рецепт повторным разбором не воспроизводится: автоматика
                этот сайт разобрать не смогла, потому его и писали руками */}
            {toDelete.recipe?.generated_by === 'manual' && (
              <div className="ap-warn" style={{ margin: '10px 0' }}>
                <b style={{ display: 'block', marginBottom: 4 }}>
                  <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                  У этой клиники рецепт написан руками
                </b>
                <span style={{ fontSize: 13 }}>
                  Автоматический разбор этот сайт не осилил — рецепт составляли вручную,
                  и повторное добавление по ссылке его не воспроизведёт. Восстановить
                  можно только из файла <code>recipes/</code> в репозитории парсера.
                </span>
              </div>
            )}
            <p className="text-muted" style={{ fontSize: 13 }}>
              Цены, уже подставленные в сравнения, останутся на месте: их подтверждал
              человек. Обновляться они перестанут.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                <Trash2 size={16} /> {deleting ? 'Удаляем…' : 'Удалить'}
              </button>
              <button className="btn btn-ghost" onClick={() => setToDelete(null)} disabled={deleting}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      </>}
    </div>
  );
}
