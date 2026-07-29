import React, { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, Download, AlertTriangle, CheckCircle2, Loader2, Globe, X, Link2, Check, Ban, Wand2 } from 'lucide-react';
import { priceParser, priceComparisons, competitorMatching } from '../../services/api';
import toast from 'react-hot-toast';

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
    <div className="card" style={{ marginBottom: 16, padding: '14px 16px', border: '1px solid var(--color-danger, #dc2626)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <AlertTriangle size={18} style={{ color: 'var(--color-danger, #dc2626)' }} />
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
        <div style={{ margin: '8px 0', padding: '8px 12px', background: 'var(--color-warning-bg, #fef3c7)', borderRadius: 6 }}>
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
        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
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
          <p style={{ margin: '0 0 8px', color: 'var(--color-danger, #dc2626)' }}>{job.error}</p>
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
            <CheckCircle2 size={16} style={{ color: 'var(--color-success, #16a34a)' }} />
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

/**
 * Как эта клиника называется в сравнениях цен.
 *
 * В зеркале источники зовутся по домену («clinic23-krd»), а в сравнении
 * конкуренты перечислены человеческими названиями («Неомед»). Пока связь
 * не проставлена, цены источника подставлять некуда — и в сопоставлении
 * он не участвует вовсе.
 */
function LabelCell({ source, value, known, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  // Источник ещё не попал в нашу копию — сначала нужен забор цен
  if (!known) return <small className="text-muted">после забора цен</small>;

  const save = async () => {
    setSaving(true);
    try {
      await priceParser.setLabel(source.id, draft);
      setEditing(false);
      onSaved();
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
        style={{ padding: '2px 6px', fontWeight: value ? 500 : 400 }}
        onClick={() => setEditing(true)}
        title="Как эта клиника называется в сравнениях цен"
      >
        {value || <span className="text-muted">указать…</span>}
      </button>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <input
        className="form-input"
        style={{ width: 140 }}
        value={draft}
        autoFocus
        placeholder="Напр. Неомед"
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
 * Сопоставление услуг конкурентов с позициями сравнения цен.
 *
 * Подбор ничего не решает сам: он предлагает, а человек принимает. Иначе
 * и быть не могло — по названиям всегда найдётся пара вроде «Мочевина
 * суточной мочи» против просто «Мочевина», и разницу видит только человек.
 * Поэтому у каждого предложения на виду, чем оно получено: код 804н точен,
 * похожесть названия — лишь повод посмотреть.
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
    r => toast.success(`Позиций просмотрено ${r.items}, предложено ${r.created}`));

  const handleFill = () => run('fill',
    () => competitorMatching.fill(comparisonId),
    r => toast.success(
      `Проставлено ${r.filled}` +
      (r.protectedByHuman ? `, ручных цен не тронуто ${r.protectedByHuman}` : '')));

  const decide = async (match, accept) => {
    try {
      await (accept
        ? competitorMatching.confirm(comparisonId, match.id)
        : competitorMatching.reject(comparisonId, match.id));
      await load(comparisonId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось сохранить решение');
    }
  };

  // Соответствия приходят плоским списком, а решение человек принимает
  // по нашей позиции целиком: видеть надо всех кандидатов сразу
  const byItem = [];
  const index = new Map();
  for (const match of matches) {
    if (!index.has(match.itemId)) {
      index.set(match.itemId, { itemId: match.itemId, ourName: match.ourName, ourCode: match.ourCode, rows: [] });
      byItem.push(index.get(match.itemId));
    }
    index.get(match.itemId).rows.push(match);
  }

  const pending = matches.filter(m => m.status === 'suggested').length;
  const confirmed = matches.filter(m => m.status === 'confirmed').length;

  return (
    <>
      <div className="card" style={{ marginBottom: 16, padding: '16px 18px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ flex: '1 1 280px' }}
            value={comparisonId}
            onChange={e => setComparisonId(e.target.value)}
          >
            <option value="">— выберите сравнение цен —</option>
            {comparisons.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <button className="btn" onClick={handleSuggest} disabled={!comparisonId || busy}>
            <Wand2 size={16} /> {busy === 'suggest' ? 'Подбираем…' : 'Подобрать'}
          </button>
          <button className="btn btn-primary" onClick={handleFill} disabled={!comparisonId || busy || !confirmed}>
            <Download size={16} /> {busy === 'fill' ? 'Подставляем…' : 'Подставить цены'}
          </button>
        </div>

        <p className="text-muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
          Подбор предлагает, решаете вы. В сравнение попадают цены только принятых соответствий.
          Цену, вписанную сотрудником руками, парсер не перезаписывает никогда.
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
          <Link2 size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p>
            Соответствий пока нет — нажмите «Подобрать».
            Если после подбора пусто, проверьте на вкладке «Источники», что клиникам
            проставлено, как они называются в сравнениях.
          </p>
        </div>
      ) : (
        <div className="admin-table-wrap">
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
                      <span style={{ color: 'var(--color-success, #16a34a)' }}>
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
  const [syncBySourceId, setSyncBySourceId] = useState({});
  const [syncRunning, setSyncRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const [url, setUrl] = useState('');
  const [city, setCity] = useState('');
  const [starting, setStarting] = useState(false);
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

  useEffect(() => {
    (async () => {
      await Promise.all([loadSources(), loadSyncStatus()]);
      setLoading(false);
    })();
  }, [loadSources, loadSyncStatus]);

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

  const handleAnalyze = async (event) => {
    event.preventDefault();
    if (!url.trim()) return;

    setStarting(true);
    try {
      const { data } = await priceParser.analyze(url.trim(), city.trim() || null);
      setJobId(data.data.job_id);
      setJob({ state: 'running', stage: 'В очереди', title: url.trim() });
      setUrl('');
      setCity('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось запустить разбор');
    } finally {
      setStarting(false);
    }
  };

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

      <div className="tabs" style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {[
          { id: 'sources',  label: 'Источники' },
          { id: 'matching', label: 'Сопоставление' },
        ].map(t => (
          <button
            key={t.id}
            className={`btn ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'matching' ? <MatchingTab /> : <>

      <ConnectionBanner status={connection} />

      <form className="card" onSubmit={handleAnalyze} style={{ marginBottom: 16, padding: '16px 18px' }}>
        <b style={{ display: 'block', marginBottom: 8 }}>Добавить клинику</b>
        <p className="text-muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
          Вставьте ссылку на страницу с ценами. Парсер разберёт её и покажет,
          что нашёл, — обход начнётся только после вашего подтверждения.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="form-input"
            style={{ flex: '1 1 320px' }}
            placeholder="https://клиника.рф/price/"
            value={url}
            onChange={e => setUrl(e.target.value)}
            disabled={starting || job?.state === 'running'}
          />
          <input
            className="form-input"
            style={{ flex: '0 1 180px' }}
            placeholder="Город (необязательно)"
            value={city}
            onChange={e => setCity(e.target.value)}
            disabled={starting || job?.state === 'running'}
          />
          <button className="btn btn-primary" type="submit" disabled={starting || !url.trim() || job?.state === 'running'}>
            <Search size={18} /> {starting ? 'Запускаем…' : 'Разобрать'}
          </button>
        </div>
        <small className="text-muted">
          Город указывают, когда он и так известен: тогда парсер не тратит время на поиск переключателя городов.
        </small>
      </form>

      <JobPanel job={job} onConfirm={handleConfirm} onClose={closeJob} confirming={confirming} />

      {loading ? (
        <div className="admin-loading"><div className="loading-spinner" /></div>
      ) : sources.length === 0 ? (
        <div className="admin-empty">
          <Globe size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p>Источников пока нет. Вставьте ссылку на прайс конкурента выше.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
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
                      <div>{source.name}</div>
                      <small className="text-muted">{source.base_url}</small>
                    </td>
                    <td>{source.city || '—'}</td>
                    <td>{source.services_total}</td>
                    <td>
                      {/* Пока не заполнено, цены источника подставлять некуда:
                          в сравнении конкуренты названы по-человечески */}
                      <LabelCell
                        source={source}
                        value={sync?.competitorLabel || ''}
                        known={Boolean(sync)}
                        onSaved={loadSyncStatus}
                      />
                    </td>
                    <td>
                      {date(source.last_run?.finished_at || source.last_run?.started_at)}
                      {source.last_run?.status && source.last_run.status !== 'ok' && (
                        <div><small style={{ color: 'var(--color-danger, #dc2626)' }}>{source.last_run.status}</small></div>
                      )}
                    </td>
                    <td>
                      {/* Две даты намеренно рядом: свежий забор недельного обхода
                          даёт всё ещё недельные цены */}
                      {dateTime(sync?.syncedAt)}
                      {sync?.syncStatus === 'failed' && (
                        <div><small style={{ color: 'var(--color-danger, #dc2626)' }}>{sync.syncError}</small></div>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-icon"
                        title="Обойти сайт заново"
                        onClick={() => handleRefresh(source)}
                        disabled={job?.state === 'running'}
                      >
                        <RefreshCw size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      </>}
    </div>
  );
}
