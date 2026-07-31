import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Download, AlertTriangle, CheckCircle2, Loader2, Globe, X, Link2, Check, Ban, Wand2, Trash2, ImageDown, ListPlus, MapPin, Search, ChevronLeft, ChevronRight, ChevronDown, Crosshair } from 'lucide-react';
import { priceParser, priceComparisons, competitorMatching } from '../../services/api';
import { ensureLeaflet } from '../../utils/leaflet';
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

// Состояния очереди, при которых работа идёт прямо сейчас
const IN_WORK = ['queued', 'analyzing', 'crawling'];

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

/**
 * Ход разбора полосой.
 *
 * Честного процента здесь быть не может: сколько у сайта страниц, парсер
 * узнаёт только когда до них дойдёт. Поэтому полоса растёт по времени и
 * тормозит у края — она отвечает на вопрос «оно живое?», а не «сколько
 * осталось». Числа, которые парсер действительно знает (стадия и число
 * пройденных страниц), стоят подписью.
 */
function ParseProgress({ stage, pages }) {
  const [pct, setPct] = useState(6);

  useEffect(() => {
    const handle = setInterval(() => {
      // Шаг тем меньше, чем ближе к 92% — до конца полоса не доходит никогда,
      // конец рисует уже смена состояния задачи
      setPct(prev => Math.min(92, prev + Math.max(0.3, (92 - prev) * 0.05)));
    }, 600);
    return () => clearInterval(handle);
  }, []);

  return (
    <div className="ap-progress">
      <div className="ap-progress-track">
        <div className="ap-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {(stage || pages > 0) && (
        <div className="ap-progress-label">
          <span>{stage}</span>
          {pages > 0 && <span>{pages} стр.</span>}
        </div>
      )}
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

      {job.state === 'running' && <ParseProgress stage={job.stage} pages={job.pages} />}

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

/** Правка текста прямо в ячейке: название клиники и город. */
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
 * Значок клиники: показ, загрузка своего, снятие.
 *
 * Автосбор с сайта справляется не всегда — у части клиник взять картинку
 * неоткуда, и строка остаётся безликой. Поэтому значок кликабелен: клик
 * открывает выбор файла, крестик в углу снимает загруженный. Помеченный
 * как свой автосбор потом не перезаписывает.
 */
function LogoCell({ source, logo, onChanged }) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const upload = async (event) => {
    const file = event.target.files?.[0];
    // Сбрасываем сразу: иначе повторный выбор того же файла не даст change
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) return toast.error('Нужен файл изображения');
    if (file.size > 1024 * 1024) return toast.error('Файл больше мегабайта — это иконка, а не обои');

    setBusy(true);
    try {
      await priceParser.uploadLogo(source.id, file);
      await onChanged();
      toast.success('Логотип загружен');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось загрузить логотип');
    } finally {
      setBusy(false);
    }
  };

  const drop = async (event) => {
    event.stopPropagation();
    setBusy(true);
    try {
      await priceParser.dropLogo(source.id);
      await onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось убрать логотип');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`ap-logo${logo ? ' has-logo' : ''}`}
      onClick={() => !busy && inputRef.current?.click()}
      title={logo ? 'Заменить логотип' : 'Загрузить логотип'}
    >
      {busy
        ? <Loader2 size={14} className="spin" />
        : logo
          ? <img src={logo} alt="" />
          : <ImageDown size={14} className="ap-logo-empty" />}

      {logo && !busy && (
        <button className="ap-logo-drop" onClick={drop} title="Убрать логотип">
          <X size={10} />
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={upload}
        onClick={e => e.stopPropagation()}
      />
    </div>
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
  const [filials, setFilials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState({ name: '', address: '', city: '' });
  const [selected, setSelected] = useState(null);   // точка, которую ставим кликом
  // Готовность карты — состоянием, а не ref: скрипт грузится с CDN и может
  // прийти позже списка точек, а эффект с метками должен на это отреагировать
  const [mapReady, setMapReady] = useState(false);

  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  // Обработчики попадают внутрь Leaflet, который живёт вне React. Держим
  // свежие значения в ref, иначе замыкание навсегда запомнит первый рендер.
  const stateRef = useRef({ items: [], selected: null });
  stateRef.current = { items, selected };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await priceParser.locations(source.id);
      setItems(data.data || []);
      setFilials(data.filials || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось загрузить адреса');
    } finally {
      setLoading(false);
    }
  }, [source.id]);

  useEffect(() => { load(); }, [load]);

  const savePosition = useCallback(async (point, lat, lon) => {
    try {
      await priceParser.setLocationPos(point.parserLocationId, lat, lon);
      setItems(prev => prev.map(row => row.id === point.id
        ? { ...row, lat, lon, geoOrigin: 'manual' }
        : row));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось сохранить координаты');
      await load();
    }
  }, [load]);

  // ── Карта ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    ensureLeaflet().then(L => {
      if (cancelled || !mapNode.current || mapRef.current) return;

      const map = L.map(mapNode.current).setView([45.03, 38.97], 11);
      // Приставка «Leaflet» с 2022 года идёт с украинским флагом — убираем.
      // Подпись OpenStreetMap остаётся: тайлы под ODbL, указание источника
      // это условие лицензии
      map.attributionControl.setPrefix('');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(map);

      // Клик по карте ставит выбранную точку — так размещаются адреса,
      // которые геокодер не нашёл вовсе
      map.on('click', (e) => {
        const target = stateRef.current.selected;
        if (!target) return;
        const point = stateRef.current.items.find(row => row.id === target);
        if (point) savePosition(point, e.latlng.lat, e.latlng.lng);
        setSelected(null);
      });

      mapRef.current = map;
      setMapReady(true);
      // Окно открывается анимацией, и на первом кадре размеры ещё нулевые
      setTimeout(() => map.invalidateSize(), 200);
    }).catch(err => toast.error(err.message));

    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markersRef.current.clear();
      setMapReady(false);
    };
  }, [savePosition]);

  // Метки пересобираем при изменении списка: точек десятки, дешевле снести
  // и разложить заново, чем сверять что с чем
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    const L = window.L;

    markersRef.current.forEach(marker => marker.remove());
    markersRef.current.clear();

    const placed = items.filter(row => row.lat !== null && row.lon !== null);
    placed.forEach(row => {
      const manual = row.geoOrigin === 'manual';
      const marker = L.marker([Number(row.lat), Number(row.lon)], {
        draggable: true,
        title: row.name || row.address,
        // Поставленное мышью отличаем цветом: видно, что уже выверено
        icon: L.divIcon({
          className: '',
          html: `<div class="ap-map-pin${manual ? ' manual' : ''}"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
      }).addTo(map);

      marker.bindTooltip(`${row.name ? row.name + ' · ' : ''}${row.address}`);
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng();
        savePosition(row, lat, lng);
      });
      markersRef.current.set(row.id, marker);
    });

    if (placed.length) {
      map.fitBounds(placed.map(row => [Number(row.lat), Number(row.lon)]), {
        padding: [30, 30],
        maxZoom: 14
      });
    }
  }, [items, savePosition, mapReady]);

  const focus = (row) => {
    if (row.lat === null || !mapRef.current) return;
    mapRef.current.setView([Number(row.lat), Number(row.lon)], 16);
    markersRef.current.get(row.id)?.openTooltip();
  };

  const collect = async () => {
    setBusy('collect');
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
      setBusy('');
    }
  };

  // Геокодер идёт по адресам с паузой в секунду — на десяток точек это
  // десяток секунд, поэтому кнопка блокируется, а не притворяется мгновенной
  const geocode = async () => {
    setBusy('geocode');
    try {
      const { data } = await priceParser.geocodeLocations(source.id);
      const r = data.data;
      toast.success(
        `Поставлено: ${r.placed}` +
        (r.doubtful ? `, под вопросом: ${r.doubtful}` : '') +
        (r.missed ? `, не нашлось: ${r.missed}` : '')
      );
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось определить координаты');
    } finally {
      setBusy('');
    }
  };

  const setFilial = async (row, filialId) => {
    try {
      await priceParser.setLocationFilial(row.parserLocationId, filialId || null);
      setItems(prev => prev.map(item => item.id === row.id
        ? { ...item, filialIdManual: filialId ? Number(filialId) : null }
        : item));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Не удалось привязать филиал');
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
      <div className="modal modal-lg ap-loc-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Адреса: {source.display_name || source.name}</h2>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>

        {/* Карта и кнопки прибиты, прокручивается только список: точек
            бывает под два десятка, и уезжающая вверх карта делает
            расстановку меток невозможной */}
        <div className="ap-loc-fixed">
          <div className="ap-loc-toolbar">
            <button className="btn" onClick={collect} disabled={!!busy}>
              {busy === 'collect' ? <Loader2 size={16} className="spin" /> : <MapPin size={16} />}
              {busy === 'collect' ? 'Ищем…' : 'Собрать с сайта'}
            </button>
            <button className="btn" onClick={geocode} disabled={!!busy || !items.length}>
              {busy === 'geocode' ? <Loader2 size={16} className="spin" /> : <Crosshair size={16} />}
              {busy === 'geocode' ? 'Определяем…' : 'Определить координаты'}
            </button>
            <span className="text-muted">
              точек: {items.length} · на карте: {items.filter(i => i.lat !== null).length}
            </span>
          </div>

          {/* Карта над списком: метку двигают мышью, и после этого координаты
              считаются выверенными — автогеокодер их больше не трогает */}
          <div className="ap-map" ref={mapNode} />
          <div className="ap-map-hint">
            {selected
              ? 'Кликните по карте, чтобы поставить выбранную точку'
              : 'Метку можно перетащить — так координаты закрепляются за адресом навсегда'}
          </div>
        </div>

        <div className="modal-body ap-loc-scroll">
          {loading ? (
            <div className="admin-loading"><div className="loading-spinner" /></div>
          ) : items.length === 0 ? (
            <div className="ap-loc-empty">Пусто. Соберите с сайта или впишите адрес ниже.</div>
          ) : (
            <ul className="ap-loc-list">
              {items.map(item => {
                const placed = item.lat !== null && item.lon !== null;
                const filialId = item.filialIdManual ?? item.parserFilialId ?? '';
                return (
                  <li
                    key={item.id}
                    className={`ap-loc-item${selected === item.id ? ' picking' : ''}`}
                    onClick={() => placed && focus(item)}
                  >
                    <MapPin
                      size={14}
                      className={`ap-loc-pin${placed ? (item.geoOrigin === 'manual' ? ' manual' : ' placed') : ''}`}
                    />
                    <div className="ap-loc-text">
                      <div className="ap-loc-name">
                        {item.name || <span className="text-muted">без названия</span>}
                        {/* вписанному руками веры больше, чем вытащенному из текста */}
                        {item.origin === 'manual' && <span className="ap-loc-tag">адрес вручную</span>}
                        {item.geoOrigin === 'manual' && <span className="ap-loc-tag">точка выверена</span>}
                      </div>
                      <div className="ap-loc-addr">
                        {item.address}
                        {item.city && <span className="text-muted"> · {item.city}</span>}
                      </div>

                      {/* Без филиала цену к точке привязать нечем: у сети
                          в каждом отделении свой прайс */}
                      {filials.length > 0 && (
                        <select
                          className="input ap-cell-input ap-loc-filial"
                          value={filialId}
                          onClick={e => e.stopPropagation()}
                          onChange={e => setFilial(item, e.target.value)}
                        >
                          <option value="">— филиал прайса не указан —</option>
                          {filials.map(f => (
                            <option key={f.id} value={f.id}>{f.name || `Филиал ${f.id}`}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div className="ap-loc-actions" onClick={e => e.stopPropagation()}>
                      {!placed && (
                        <button
                          className={`btn btn-icon${selected === item.id ? ' active' : ''}`}
                          title="Поставить точку кликом по карте"
                          onClick={() => setSelected(selected === item.id ? null : item.id)}
                        >
                          <Crosshair size={14} />
                        </button>
                      )}
                      <button className="btn btn-icon" title="Убрать" onClick={() => remove(item)}>
                        <X size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <form className="modal-footer ap-loc-form" onSubmit={add}>
          <input
            className="input ap-cell-input" placeholder="Название точки"
            value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className="input ap-cell-input" placeholder="Адрес"
            value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })}
          />
          <input
            className="input ap-cell-input" placeholder="Город"
            value={draft.city} onChange={e => setDraft({ ...draft, city: e.target.value })}
          />
          <button className="btn btn-primary" type="submit" disabled={!draft.address.trim()}>
            <Check size={16} /> Добавить
          </button>
        </form>
      </div>
    </div>
  );
}

const money = (value) =>
  value === null || value === undefined ? '—' : `${Number(value).toLocaleString('ru-RU')} ₽`;

/** Цена услуги: у лаборатории она одна, у сети — своя в каждом филиале. */
function PriceCell({ prices }) {
  if (!prices?.length) {
    // Услуга без цены не попадёт в сравнение никогда — это стоит увидеть сразу
    return <span className="text-muted">нет цены</span>;
  }
  if (prices.length === 1) return <>{money(prices[0].price)}</>;

  const values = prices.map(p => Number(p.price)).filter(v => Number.isFinite(v));
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (
    <>
      {min === max ? money(min) : `${money(min)} – ${money(max)}`}
      <div>
        <small
          className="text-muted"
          title={prices.map(p => `${p.filialName || `Филиал ${p.filialId}`}: ${money(p.price)}`).join('\n')}
        >
          филиалов: {prices.length}
        </small>
      </div>
    </>
  );
}

/**
 * Каталог услуг источника.
 *
 * Показывается наша копия, а не сайт: сопоставление читает именно её, и когда
 * цена конкурента «не подтянулась», разбираться нужно здесь. Рядом с числом
 * услуг в копии стоит число у парсера — расхождение означает, что забор цен
 * отстал от обхода, и это самая частая причина, по которой услуги «нет».
 */
function ServicesModal({ source, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [showInactive, setShowInactive] = useState(false);

  const LIMIT = 50;

  // Ввод не дёргает сервер на каждую букву: каталог у clinic23 — тысячи строк
  useEffect(() => {
    const handle = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    priceParser.catalog(source.id, {
      search: query,
      page,
      limit: LIMIT,
      status: showInactive ? 'all' : 'active'
    })
      .then(({ data: body }) => { if (!cancelled) setData(body.data); })
      .catch(err => {
        if (cancelled) return;
        toast.error(err.response?.data?.message || 'Не удалось загрузить услуги');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source.id, query, page, showInactive]);

  const counts = data?.counts;
  const pages = data ? Math.max(Math.ceil(data.total / data.limit), 1) : 1;
  // У парсера число живое, у нас — на момент последнего забора. Расходятся —
  // значит копия отстала, и в сравнении цен этих услуг ещё нет.
  const behind = counts && source.services_total > counts.activeTotal;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Услуги: {source.display_name || source.name}</h2>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>

        {counts && (
          <p className="text-muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
            В нашей копии <b>{counts.activeTotal}</b>, у парсера <b>{source.services_total}</b>.
            {counts.inactiveTotal > 0 && <> Пропало из прайса: <b>{counts.inactiveTotal}</b>.</>}
            {' '}С кодом 804н: <b>{counts.withCodesTotal}</b>.
            {' '}Цены забраны {dateTime(data.source.syncedAt)}.
          </p>
        )}

        {data?.source?.syncStatus === 'failed' && (
          <div className="ap-warn" style={{ background: 'rgba(255, 59, 48, 0.12)' }}>
            Последний забор цен не удался: {data.source.syncError}
          </div>
        )}

        {behind && data?.source?.syncStatus !== 'failed' && (
          <div className="ap-warn">
            Копия отстаёт от парсера на {source.services_total - counts.activeTotal} услуг.
            Пока не нажата «Забрать цены», в сравнении цен их не будет.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ position: 'relative', flex: '1 1 280px' }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
            <input
              className="input ap-cell-input"
              style={{ width: '100%', paddingLeft: 26 }}
              placeholder="Название, код 804н или артикул"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => { setShowInactive(e.target.checked); setPage(1); }}
            />
            Показывать пропавшие из прайса
          </label>
        </div>

        {loading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : !data?.items?.length ? (
          <div className="admin-empty">
            <p>{query ? 'По запросу ничего не нашлось.' : 'В нашей копии услуг нет — заберите цены.'}</p>
          </div>
        ) : (
          <div className="admin-table-container" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Услуга</th>
                  <th style={{ width: 170 }}>Код 804н</th>
                  <th style={{ width: 110 }}>Артикул</th>
                  <th style={{ width: 170 }}>Цена</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(item => (
                  <tr key={item.id} style={{ opacity: item.isActive ? 1 : 0.5 }}>
                    <td>
                      <div>
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noreferrer">{item.name}</a>
                        ) : item.name}
                      </div>
                      {item.category && <small className="text-muted">{item.category}</small>}
                      {!item.isActive && (
                        <div><small className="text-muted">пропала из прайса {date(item.lastSeenAt)}</small></div>
                      )}
                    </td>
                    <td>
                      {item.codes?.length
                        ? item.codes.join(', ')
                        // Без кода услуга сопоставляется только по названию —
                        // это заметно менее надёжно, и это стоит видеть
                        : <span className="text-muted">нет</span>}
                    </td>
                    <td>{item.externalId || <span className="text-muted">—</span>}</td>
                    <td><PriceCell prices={item.prices} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <small className="text-muted">
            {data ? `Найдено: ${data.total}` : ''}
          </small>
          {pages > 1 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft size={14} />
              </button>
              <small className="text-muted">стр. {page} из {pages}</small>
              <button className="btn btn-icon" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
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
  const working = items.some(item => IN_WORK.includes(item.status));
  useEffect(() => {
    if (!working) return undefined;
    const handle = setInterval(load, 5000);
    return () => clearInterval(handle);
  }, [working, load]);

  const handleAdd = async (event) => {
    event.preventDefault();
    const url = urls.trim();
    if (!url) return;

    setBusy(true);
    try {
      // Маршрут принимает список — ссылку заворачиваем в массив из одной
      const { data } = await priceParser.queueAdd([url]);
      toast[data.data.added ? 'success' : 'error'](
        data.data.added ? 'Ссылка в очереди' : 'Эта ссылка уже в очереди'
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
  const inWork = items.filter(i => IN_WORK.includes(i.status)).length;

  return (
    <>
      {/* Ссылки сдают по одной, по мере того как находят клинику. Прежнее поле
          на несколько строк предлагало собрать список заранее — так никто
          не работает, а место занимало */}
      <form className="card ap-queue-add" onSubmit={handleAdd}>
        <input
          className="input"
          type="url"
          placeholder="https://клиника.рф/price"
          value={urls}
          onChange={e => setUrls(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !urls.trim()}>
          {busy ? <Loader2 size={18} className="spin" /> : <ListPlus size={18} />}
          В очередь
        </button>
        {items.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => { await priceParser.queueClear(); load(); }}
          >
            Прибрать
          </button>
        )}
        {(inWork > 0 || ready > 0) && (
          <span className="text-muted ap-queue-counts">
            {inWork > 0 && `в работе: ${inWork}`}
            {ready > 0 && `${inWork > 0 ? ' · ' : ''}ждут проверки: ${ready}`}
          </span>
        )}
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
                  {!IN_WORK.includes(item.status) && (
                    <small className="text-muted">
                      {item.status === 'ready' ? 'разобрано — проверьте' : item.status}
                    </small>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {item.status === 'done' && <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />}
                  {item.status === 'failed' && <AlertTriangle size={16} style={{ color: 'var(--error)' }} />}
                  {item.status !== 'analyzing' && item.status !== 'crawling' && (
                    <button className="btn btn-icon" title="Убрать из очереди" onClick={() => handleDrop(item)}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Полоса вместо крутилки: разбор идёт минутами, и «оно живое?» —
                  единственный вопрос, на который здесь нужно отвечать */}
              {IN_WORK.includes(item.status) && (
                <ParseProgress stage={item.stage || 'в очереди'} pages={item.pages} />
              )}

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
    r => {
      // Молчаливые нули здесь читаются как поломка. На деле подбору некуда
      // класть цену: в листе нет ни одной колонки конкурента из парсера.
      if (r.noCompetitorColumns) {
        toast.error(
          'В этом сравнении нет ни одной колонки конкурента из парсера. ' +
          'Добавьте её на странице сравнения цен: «Управление колонками» → «+ Конкурент».',
          { duration: 8000 }
        );
        return;
      }
      toast.success(
        `Цен подставлено: ${r.filled}, автоматически принято: ${r.autoConfirmed}` +
        (r.reused ? `, взято с других листов: ${r.reused}` : '') +
        (r.review ? `, требуют проверки: ${r.review}` : ''));
    });

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
                  <td>{match.sourceName}{match.city && <small className="text-muted"> · {match.city}</small>}</td>
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

/* ── Дерево источников ──────────────────────────────────────────────────────
 *
 * Парсер отдаёт источники плоским списком в порядке заведения, и у сети из
 * двух десятков городов её строки расползаются по всей таблице вперемешку
 * с чужими. Собираем их обратно в клиники.
 *
 * Клиника определяется доменом, а не названием: у сети под каждый город свой
 * поддомен, зато имя с сайта совпадает не всегда — clinic23.ru отдаёт и
 * «Клинику Екатерининскую», и «Клинику на Герцена», а это одна сеть. Домен
 * же у всех городов один.
 */

// Домены, где предпоследняя часть — сама часть суффикса (com.ru, co.uk):
// без этого списка clinic.com.ru разложился бы в «com.ru»
const SUFFIX_2LD = new Set(['com', 'net', 'org', 'co', 'edu', 'gov', 'ac']);

const ru = new Intl.Collator('ru');

const sourceName = (source) => (source.display_name || source.name || '').trim();

/** Домен клиники: belgorod.fomin-clinic.ru и fomin-clinic.ru — одна сеть. */
function brandKey(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    return SUFFIX_2LD.has(parts[parts.length - 2])
      ? parts.slice(-3).join('.')
      : parts.slice(-2).join('.');
  } catch {
    // Ссылка, которую не разобрал даже URL — пусть живёт отдельной веткой
    return url || 'unknown';
  }
}

/**
 * Как назвать ветку сети.
 *
 * Берём название, встречающееся у большинства городов: у Фомина это
 * «Клиника Фомина» во всех двадцати, а единичное «Клиника на Герцена»
 * не должно перебивать имя всей сети.
 */
function brandTitle(items, fallback) {
  const tally = new Map();
  for (const source of items) {
    const name = sourceName(source);
    if (name) tally.set(name, (tally.get(name) || 0) + 1);
  }
  if (!tally.size) return fallback;
  return [...tally.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].length - b[0].length || ru.compare(a[0], b[0])
  )[0][0];
}

/**
 * Клиника → город → источник.
 *
 * Город становится отдельной веткой только когда в нём правда несколько
 * источников: у Фомина в каждом городе ровно один, и промежуточный узел
 * там был бы лишним кликом ради одной строки.
 */
function buildTree(sources) {
  const groups = new Map();
  for (const source of sources) {
    const key = brandKey(source.base_url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(source);
  }

  const byNameThenCity = (a, b) =>
    ru.compare(sourceName(a), sourceName(b)) || ru.compare(a.city || '', b.city || '');

  return [...groups.entries()].map(([key, items]) => {
    const byCity = new Map();
    for (const source of items) {
      const city = (source.city || '').trim();
      if (!byCity.has(city)) byCity.set(city, []);
      byCity.get(city).push(source);
    }

    const nodes = [...byCity.entries()]
      // Города по алфавиту, безымянный — в конец: он требует внимания,
      // но не должен возглавлять список
      .sort(([a], [b]) => (a ? 0 : 1) - (b ? 0 : 1) || ru.compare(a, b))
      .map(([city, cityItems]) => {
        cityItems.sort(byNameThenCity);
        return cityItems.length > 1
          ? { type: 'city', key: `c:${key}:${city}`, city, items: cityItems }
          : { type: 'source', key: `s:${cityItems[0].id}`, source: cityItems[0] };
      });

    return {
      key: `g:${key}`,
      title: brandTitle(items, key),
      items,
      nodes,
    };
  }).sort((a, b) => ru.compare(a.title, b.title));
}

// Раскрытые ветки переживают перезагрузку: страницу держат открытой днями
const TREE_OPEN_KEY = 'ap-tree-open';

export default function AdminParser() {
  const [tab, setTab] = useState('sources');
  const [connection, setConnection] = useState(null);
  const [sources, setSources] = useState([]);
  const [logos, setLogos] = useState({});
  const [filialsBySource, setFilialsBySource] = useState({});
  const [toDelete, setToDelete] = useState(null);
  const [locationsFor, setLocationsFor] = useState(null);
  const [servicesFor, setServicesFor] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [syncBySourceId, setSyncBySourceId] = useState({});
  const [syncRunning, setSyncRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const [confirming, setConfirming] = useState(false);

  // Ветка открыта, если о ней есть явное решение человека; иначе действует
  // умолчание: сети свёрнуты (у Фомина два десятка городов), города внутри —
  // раскрыты, до них человек уже добрался осознанно
  const [open, setOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(TREE_OPEN_KEY)) || {}; } catch { return {}; }
  });

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

  // Филиалы — третий уровень дерева. Приходят из нашей копии одним запросом:
  // у сети в одном Краснодаре десять отделений, и ходить за каждым отдельно
  // значит десять запросов ради двух строк
  const loadFilials = useCallback(async () => {
    try {
      const { data } = await priceParser.filials();
      setFilialsBySource(data.data || {});
    } catch {
      // без филиалов дерево остаётся рабочим — молча
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([loadSources(), loadSyncStatus(), loadLogos(), loadFilials()]);
      setLoading(false);
    })();
  }, [loadSources, loadSyncStatus, loadLogos, loadFilials]);

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
    // Забор цен мог принести новые филиалы — перечитываем их, когда он встал
    return () => { clearInterval(handle); loadFilials(); };
  }, [syncRunning, loadSyncStatus, loadFilials]);

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
      await Promise.all([loadSources(), loadSyncStatus(), loadLogos(), loadFilials()]);
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

  const tree = useMemo(() => buildTree(sources), [sources]);

  useEffect(() => {
    try { localStorage.setItem(TREE_OPEN_KEY, JSON.stringify(open)); } catch { /* приватный режим */ }
  }, [open]);

  // Города раскрыты по умолчанию, сети и филиалы — свёрнуты: у сети два
  // десятка городов, у города до десяти филиалов, и вываливать это разом
  // значит вернуть ту же простыню, из-за которой дерево и заводилось
  const isOpen = (key) => open[key] ?? key.startsWith('c:');
  const toggleBranch = (key) => setOpen(prev => ({ ...prev, [key]: !(prev[key] ?? key.startsWith('c:')) }));

  const branchKeys = tree.flatMap(group => [
    ...(group.items.length > 1 ? [group.key] : []),
    ...group.nodes.filter(node => node.type === 'city').map(node => node.key),
    ...group.items.filter(s => filialsBySource[s.id]?.length).map(s => `f:${s.id}`),
  ]);
  const allOpen = branchKeys.length > 0 && branchKeys.every(isOpen);
  const toggleAll = () =>
    setOpen(Object.fromEntries(branchKeys.map(key => [key, !allOpen])));

  /**
   * Переименование сети целиком.
   *
   * Отдельного «названия сети» в парсере нет — есть название у каждого
   * источника, а заголовок ветки складывается из них. Поэтому правим все
   * города разом, но только те, что зовутся как сеть: индивидуально
   * переименованный филиал («Клиника на Герцена») своё имя сохраняет.
   */
  const renameGroup = async (group, next) => {
    const targets = group.items.filter(s => sourceName(s) === group.title);
    for (const source of targets) await priceParser.rename(source.id, next);
    await loadSources();
    toast.success(`Переименовано городов: ${targets.length}`);
  };

  /** Строка источника — одна и та же на любом уровне дерева, меняется отступ. */
  const sourceRow = (source, depth) => {
    const sync = syncBySourceId[source.id];
    const filials = filialsBySource[source.id] || [];
    const filialsKey = `f:${source.id}`;
    const filialsOpen = filials.length > 0 && isOpen(filialsKey);

    return (
      <React.Fragment key={source.id}>
      <tr>
        <td style={{ paddingLeft: 20 + depth * 22 }}>
          <div className="ap-branch">
            {/* Место под шеврон занято всегда — иначе значки и названия
                строк без потомков разъезжаются с остальными */}
            <span
              className={`ap-twist${filials.length ? ' ap-twist-on' : ''}`}
              onClick={filials.length ? () => toggleBranch(filialsKey) : undefined}
              title={filials.length ? 'Филиалы прайса' : undefined}
            >
              {filials.length > 0 && (filialsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
            </span>
            <LogoCell source={source} logo={logos[source.id]} onChanged={loadLogos} />
            <div style={{ minWidth: 0 }}>
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
              {/* Ссылка обрезается: у Инвитро адрес с query-строкой на сотню
                  символов растягивал таблицу так, что колонка с кнопками
                  уезжала за край контейнера. Целиком она в подсказке */}
              <div>
                <a
                  className="ap-url"
                  href={source.base_url}
                  target="_blank"
                  rel="noreferrer"
                  title={source.base_url}
                >
                  {source.base_url}
                </a>
              </div>
              {/* Неудавшийся обход раньше был виден в отдельной колонке —
                  теперь её нет, а знать про него надо */}
              {source.last_run?.status && source.last_run.status !== 'ok' && (
                <div><small style={{ color: 'var(--error)' }}>обход: {source.last_run.status}</small></div>
              )}
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
            </button>
          </div>
        </td>
        <td>
          {/* Одной цифрой разобрать «почему цены нет» нельзя:
              по клику открывается наш каталог по этой клинике */}
          <button
            className="btn btn-ghost"
            style={{ padding: '0 4px' }}
            onClick={() => setServicesFor(source)}
            title="Показать услуги, забранные в нашу копию"
          >
            {source.services_total}
          </button>
        </td>
        <td>
          {dateTime(sync?.syncedAt)}
          {sync?.syncStatus === 'failed' && (
            <div><small style={{ color: 'var(--error)' }}>{sync.syncError}</small></div>
          )}
        </td>
        <td className="ap-actions">
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

      {/* Филиалы: у сети в одном городе до десяти отделений, и цена в каждом
          своя. Считаем по нашей копии — сопоставление читает именно её */}
      {filialsOpen && filials.map(filial => (
        <tr key={`${source.id}-${filial.id}`} className="ap-filial-row">
          <td style={{ paddingLeft: 20 + (depth + 1) * 22 }}>
            <div className="ap-branch">
              <span className="ap-twist" />
              <span className="ap-logo-slot" />
              <div style={{ minWidth: 0 }}>
                <div>{filial.name}</div>
                {filial.address && <small className="text-muted">{filial.address}</small>}
              </div>
            </div>
          </td>
          <td />
          <td title="Услуг с ценой в этом филиале">{filial.services.toLocaleString('ru-RU')}</td>
          <td colSpan={2} />
        </tr>
      ))}
      </React.Fragment>
    );
  };

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
        <>
        <div className="ap-tree-toolbar">
          <button className="btn btn-ghost" onClick={toggleAll}>
            {allOpen ? 'Свернуть всё' : 'Развернуть всё'}
          </button>
        </div>

        <div className="admin-table-container ap-sources">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Клиника</th>
                <th>Город</th>
                <th>Услуг</th>
                <th>Цены забраны</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tree.map(group => {
                // Клиника из одного города — просто строка: сворачивать
                // ветку с единственным потомком незачем
                if (group.items.length === 1) return sourceRow(group.items[0], 0);

                const groupOpen = isOpen(group.key);
                const logo = group.items.map(s => logos[s.id]).find(Boolean);

                return (
                  <React.Fragment key={group.key}>
                    <tr className="ap-group-row" onClick={() => toggleBranch(group.key)}>
                      <td>
                        <div className="ap-branch">
                          <span className="ap-twist ap-twist-on">
                            {groupOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </span>
                          <span className="ap-logo-slot">
                            {logo && <img className="ap-group-logo" src={logo} alt="" />}
                          </span>
                          {/* Название сети правится здесь и разъезжается по всем
                              её городам: своего имени у сети в парсере нет */}
                          <span onClick={e => e.stopPropagation()}>
                            <EditableCell
                              value={group.title}
                              placeholder="название сети"
                              hint="Название сети — применится ко всем её городам"
                              bold
                              onSave={next => renameGroup(group, next)}
                            />
                          </span>
                        </div>
                      </td>
                      {/* Сводных чисел на ветках нет намеренно: сумма услуг
                          по сети ничего не решает, а строку загромождает */}
                      <td colSpan={4} />
                    </tr>

                    {groupOpen && group.nodes.map(node => {
                      if (node.type === 'source') return sourceRow(node.source, 1);

                      const cityOpen = isOpen(node.key);

                      return (
                        <React.Fragment key={node.key}>
                          <tr className="ap-city-row" onClick={() => toggleBranch(node.key)}>
                            <td style={{ paddingLeft: 42 }}>
                              <div className="ap-branch">
                                <span className="ap-twist ap-twist-on">
                                  {cityOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                </span>
                                <span className="ap-logo-slot" />
                                <span>{node.city || 'город не указан'}</span>
                              </div>
                            </td>
                            <td colSpan={4} />
                          </tr>
                          {cityOpen && node.items.map(source => sourceRow(source, 2))}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {locationsFor && (
        <LocationsModal source={locationsFor} onClose={() => setLocationsFor(null)} />
      )}

      {servicesFor && (
        <ServicesModal source={servicesFor} onClose={() => setServicesFor(null)} />
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
