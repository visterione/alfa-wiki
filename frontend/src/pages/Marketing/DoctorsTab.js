import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Ban, Clock, Globe, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { marketing } from '../../services/api';
import { MarketingTools } from './toolsSlot';
import './Marketing.css';

// Сверка карточек врачей сети с медицинскими площадками.
//
// Медцентр выбирается в строке инструментов; ниже — его врачи, у врача —
// площадки, у площадки — сравнение с сайтом клиники. Оценка — процент
// совпадения (100% — всё сходится), её считает парсер: среднее по полям
// карточки, по площадкам врача и по врачам клиники. Сверку раз в месяц
// запускает таймер на сервере парсера; «Обновить» — внеочередная.

// Яндекс первым: остальные площадки находятся и по ссылкам из его карточки.
const PLATFORMS = ['Яндекс', 'ПроДокторов', 'НаПоправку', 'СберЗдоровье', 'ДокТу'];
const PLATFORM_LOGO = {
  'Яндекс': '/platform-logos/yandex.png',
  'ПроДокторов': '/platform-logos/prodoctorov.png',
  'НаПоправку': '/platform-logos/napopravku.png',
  'СберЗдоровье': '/platform-logos/docdoc.png',
  'ДокТу': '/platform-logos/doctu.png'
};

const FIELDS = [
  ['identity', 'ФИО'],
  ['specialties', 'Специальности'],
  ['experience', 'Стаж'],
  ['category', 'Категория'],
  ['price', 'Стоимость приёма'],
  ['workplace', 'Место приёма'],
  ['education', 'Образование'],
  ['services', 'Услуги и цены']
];

// Разные исходы поиска — разные действия человека: «нет на площадке» значит
// завести карточку, «не пустила» — открыть ссылку руками.
const PLATFORM_STATUS = {
  found: 'Карточка найдена',
  review: 'Нужно проверить',
  not_found: 'Нет на площадке',
  blocked: 'Площадка не пустила',
  error: 'Ошибка',
  searching: 'Не проверено'
};

const CLINIC_KEY = 'marketingDoctorsClinic';
const remembered = () => { try { return localStorage.getItem(CLINIC_KEY) || ''; } catch { return ''; } };
const remember = value => { try { localStorage.setItem(CLINIC_KEY, value); } catch { /* приватный режим */ } };


// Процент в круге: дуга — доля совпадения, цвет — как у подсветки полей.
function ScoreRing({ value, size = 36, title }) {
  const stroke = size >= 40 ? 4 : 3;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const filled = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100 * length;
  // Цвет — по самому значению: оттенок от красного (0) к зелёному (100),
  // а не три ступени, между которыми 69 и 71 выглядели разными мирами.
  const color = value == null ? undefined : `hsl(${Math.round(Math.max(0, Math.min(100, value)) * 1.2)}, 72%, var(--mk-ring-light))`;
  return <span className={'mk-ring' + (value == null ? ' none' : '')} style={{ width: size, height: size, color }} title={title}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="mk-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke}/>
      {value != null && <circle className="mk-ring-arc" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke}
        strokeDasharray={`${filled} ${length}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}/>}
    </svg>
    <b style={{ fontSize: Math.max(10, Math.round(size * 0.32)) }}>{value == null ? '—' : value}</b>
  </span>;
}

const plain = value => Array.isArray(value) ? value.filter(Boolean).join(', ') : value;

// Прайс врача на сайте бывает в сотню позиций; сравнённые идут первыми,
// серый хвост раскрывается по кнопке.
const ITEMS_SHOWN = 12;

function Cell({ field, side }) {
  const [all, setAll] = useState(false);
  const items = field.items?.[side];
  if (items) {
    if (!items.length) return <span className="mk-diff-empty">не указано</span>;
    const shown = all ? items : items.slice(0, ITEMS_SHOWN);
    return <div className={'mk-diff-items' + (items.length > 4 ? ' column' : '')}>
      {shown.map((item, index) => <span key={index} className={'mk-diff-item ' + item.tone}>{item.text}</span>)}
      {items.length > ITEMS_SHOWN && <button type="button" className="mk-diff-more" onClick={() => setAll(!all)}>
        {all ? 'свернуть' : 'показать все ' + items.length}
      </button>}
    </div>;
  }
  const value = plain(field[side]);
  return value ? <span>{value}</span> : <span className="mk-diff-empty">не указано</span>;
}

const siteHost = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Шапка таблицы — откуда какая колонка: сайт клиники и площадка, обе ссылками.
function Diff({ fields, platform, entry, doctor }) {
  return <table className="mk-diff">
    <colgroup><col className="mk-diff-label"/><col/><col/></colgroup>
    <thead><tr>
      <th/>
      <th><a className="mk-diff-source" href={doctor.profile_url} target="_blank" rel="noreferrer">
        <Globe size={15}/>{siteHost(doctor.profile_url || doctor.source_url)}
      </a></th>
      <th><a className="mk-diff-source" href={entry.url} target="_blank" rel="noreferrer">
        <img className="mk-platform-logo" src={PLATFORM_LOGO[platform]} alt=""/>{platform}
      </a></th>
    </tr></thead>
    <tbody>
      {FIELDS.filter(([key]) => fields[key]).map(([key, label]) => {
        const field = fields[key];
        const tone = field.tone || 'empty';
        return <React.Fragment key={key}>
          <tr className={'mk-diff-row ' + tone}>
            <th>{label}</th>
            <td><Cell field={field} side="source"/></td>
            <td><Cell field={field} side="external"/></td>
          </tr>
          {field.note && <tr className={'mk-diff-note ' + tone}><td/><td colSpan={2}>{field.note}</td></tr>}
        </React.Fragment>;
      })}
    </tbody>
  </table>;
}

// Площадка без оценки — значок вместо текста; пояснение во всплывающей подсказке.
const STATUS_ICON = {
  blocked: [AlertTriangle, 'warn'],
  review: [AlertTriangle, 'warn'],
  not_found: [Ban, 'bad'],
  error: [AlertCircle, 'muted'],
  searching: [Clock, 'muted']
};

// Площадка — кнопка: логотип, название и оценка (или значок, если оценить нельзя).
function PlatformButton({ platform, entry, active, onClick }) {
  const status = entry?.status || 'searching';
  const scored = entry?.score != null;
  const [Icon, kind] = STATUS_ICON[status] || STATUS_ICON.error;
  const hint = [PLATFORM_STATUS[status], entry?.review_note || entry?.error].filter(Boolean).join('. ');
  return <button type="button" className={'mk-platform-btn' + (scored ? '' : ' ' + kind) + (active ? ' active' : '')}
    onClick={onClick} title={hint}>
    <img className="mk-platform-logo" src={PLATFORM_LOGO[platform]} alt=""/>
    <span className="mk-platform-label">{platform}</span>
    {scored ? <ScoreRing value={entry.score} size={30}/> : <Icon size={18} className={'mk-status-icon ' + kind}/>}
  </button>;
}

// Дерево приходит без таблиц сравнения — они весят в десять раз больше
// всего остального. Подробности врача грузятся, когда открыли площадку.
const details = new Map();

function useDoctorDetails(scanId, sourceIndex, doctorIndex, open) {
  const key = scanId + '/' + sourceIndex + '/' + doctorIndex;
  const [state, setState] = useState(() => details.get(key) || null);
  useEffect(() => {
    if (!open || details.has(key)) { setState(details.get(key) || null); return undefined; }
    let cancelled = false;
    setState({ loading: true });
    marketing.getDoctorScanDoctor(scanId, sourceIndex, doctorIndex)
      .then(({ data }) => { details.set(key, { doctor: data }); if (!cancelled) setState({ doctor: data }); })
      .catch(err => { if (!cancelled) setState({ error: err.response?.data?.message || 'Не удалось загрузить сравнение' }); });
    return () => { cancelled = true; };
  }, [key, open, scanId, sourceIndex, doctorIndex]);
  return state;
}

function Photo({ doctor, src }) {
  if (!src) {
    const initials = doctor.name.split(/\s+/).slice(0, 2).map(word => word.charAt(0)).join('');
    return <span className="mk-doctor-photo empty">{initials}</span>;
  }
  return <img className="mk-doctor-photo" src={src} alt=""/>;
}

function DoctorRow({ doctor, photo, scanId, sourceIndex, platform, onPlatform }) {
  const loaded = useDoctorDetails(scanId, sourceIndex, doctor.index, Boolean(platform));
  const full = loaded?.doctor || doctor;
  const entry = platform ? full.comparisons?.[platform] : null;
  const comparable = entry?.fields && Object.keys(entry.fields).length > 0;
  return <div className={'mk-doctor' + (platform ? ' open' : '')}>
    <div className="mk-doctor-line">
      <Photo doctor={doctor} src={photo}/>
      <div className="mk-doctor-title">
        <a href={doctor.profile_url} target="_blank" rel="noreferrer">{doctor.name}</a>
        <span>{(doctor.specialties || []).join(', ')}</span>
      </div>
      <div className="mk-doctor-platforms">
        {PLATFORMS.map(name => <PlatformButton key={name} platform={name} entry={doctor.comparisons?.[name]}
          active={platform === name} onClick={() => onPlatform(platform === name ? null : name)}/>)}
      </div>
      <span className="mk-doctor-divider"/>
      <ScoreRing value={doctor.score} size={40} title="Среднее по площадкам, где есть карточка врача"/>
    </div>
    {platform && <div className="mk-doctor-details">
      {doctor.site_conflicts?.length > 0 && <div className="mk-doctor-conflicts">
        Сайт противоречит сам себе: {doctor.site_conflicts.join('; ')}
      </div>}
      {loaded?.loading && <div className="mk-doctor-hint"><Loader2 className="mk-spin" size={13}/> Загрузка сравнения…</div>}
      {loaded?.error && <div className="mk-doctor-error">{loaded.error}</div>}
      {entry?.review_note && <div className="mk-doctor-hint">{entry.review_note}</div>}
      {entry && !comparable && !loaded?.loading && <div className="mk-doctor-hint">
        {PLATFORM_STATUS[entry.status] || 'Сравнить не с чем'}{entry.error ? '. ' + entry.error : '.'}
        {entry.url && <> <a href={entry.url} target="_blank" rel="noreferrer">Открыть карточку</a></>}
      </div>}
      {comparable && <Diff fields={entry.fields} platform={platform} entry={entry} doctor={full}/>}
    </div>}
  </div>;
}

// Фото клиники приходят одним запросом миниатюрами; парсер докачивает их в
// фоне, поэтому, пока pending > 0, переспрашиваем.
function useClinicPhotos(scanId, sourceIndex) {
  const [state, setState] = useState({ photos: {}, pending: 0, error: '' });
  useEffect(() => {
    let cancelled = false;
    let timer;
    let rounds = 0;
    const poll = async () => {
      try {
        const { data } = await marketing.getDoctorScanPhotos(scanId, sourceIndex);
        if (cancelled) return;
        const pending = data.pending || 0;
        setState({ photos: data.photos || {}, pending, error: '' });
        if (pending > 0 && ++rounds < 60) timer = setTimeout(poll, 3000);
      } catch (err) {
        // Без фото страница работает на инициалах, но причину видно — иначе
        // «фото нет» не отличить от «фото ещё качаются».
        if (!cancelled) setState(current => ({ ...current, pending: 0,
          error: err.response?.data?.message || err.response?.data?.error || err.message || 'ошибка запроса' }));
      }
    };
    setState({ photos: {}, pending: 0, error: '' });
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [scanId, sourceIndex]);
  return state;
}

const clinicName = source => source.center?.name || source.clinic;

// Шапка медцентра — как полка во вкладке «Акции»: логотип и название на
// градиенте фирменного цвета.
function ClinicHeader({ source }) {
  const name = clinicName(source);
  return <header className="mk-doctors-clinic" style={{ '--mk-tone': source.center?.color || 'var(--accent-500)' }}>
    {source.center?.logo
      ? <img className="mk-shelf-logo" src={source.center.logo} alt=""/>
      : <span className="mk-shelf-logo letter">{name.charAt(0)}</span>}
    <h3>{name}</h3>
    <ScoreRing value={source.score} size={44} title="Среднее по врачам медцентра"/>
  </header>;
}

function ClinicDoctors({ source, sourceIndex, scanId, doctors }) {
  // Открыта одна площадка одного врача: {doctor, platform}.
  const [open, setOpen] = useState(null);
  const { photos, pending, error } = useClinicPhotos(scanId, sourceIndex);
  return <section className="mk-doctors-section">
    <ClinicHeader source={source}/>
    {pending > 0 && <div className="mk-doctor-hint"><Loader2 className="mk-spin" size={13}/> Загружаются фото врачей: осталось {pending}</div>}
    {error && <div className="mk-doctor-hint">Фото врачей не загрузились: {error}</div>}
    {source.error && <div className="mk-doctor-error">{source.error}</div>}
    {!source.error && !doctors.length && <div className="mk-doctor-empty">Врачей не найдено.</div>}
    {doctors.length > 0 && <div className="mk-doctors-list">
      {doctors.map(doctor => <DoctorRow key={doctor.index} doctor={doctor} photo={photos[doctor.index]}
        scanId={scanId} sourceIndex={sourceIndex}
        platform={open?.doctor === doctor.index ? open.platform : null}
        onPlatform={platform => setOpen(platform ? { doctor: doctor.index, platform } : null)}/>)}
    </div>}
  </section>;
}

export default function DoctorsTab() {
  const [last, setLast] = useState(null);
  const [running, setRunning] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [clinic, setClinic] = useState(remembered);

  const load = useCallback(async () => {
    try {
      const { data } = await marketing.getLatestDoctorScan();
      setLast(data.last);
      setRunning(data.running);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Не удалось получить результаты сверки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Идущую сверку опрашиваем по этапам; как закончится — перечитываем итог.
  useEffect(() => {
    if (!running?.id) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const { data } = await marketing.getDoctorScan(running.id);
        if (cancelled) return;
        if (data.finished) { clearInterval(timer); load(); }
        else setRunning(current => ({ ...current, stage: data.stage, progress: data.progress }));
      } catch (err) {
        if (err.response?.status === 404) { clearInterval(timer); load(); }
      }
    }, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [running?.id, load]);

  const start = async () => {
    setStarting(true); setError('');
    try {
      const { data } = await marketing.startDoctorScan();
      setRunning({ id: data.scan_id, stage: data.stage });
    } catch (err) {
      setError(err.response?.data?.message || 'Не удалось запустить сверку');
    } finally { setStarting(false); }
  };

  const results = useMemo(() => last?.results || [], [last]);
  // Выбранный медцентр держится по названию в сверке: номер в списке может
  // сдвинуться, если в следующей сверке сайтов станет больше.
  const selected = Math.max(0, results.findIndex(source => source.clinic === clinic));
  const choose = value => { setClinic(value); remember(value); };

  const needle = query.trim().toLowerCase();
  const sections = useMemo(() => results.map((source, sourceIndex) => {
    // Номер врача в сверке нужен для запроса подробностей — до сортировки.
    const doctors = (source.doctors || []).map((doctor, index) => ({ ...doctor, index }))
      .filter(doctor => !needle || doctor.name.toLowerCase().includes(needle))
      // Сначала те, у кого расхождений больше: с них и начинают правку.
      .sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || a.name.localeCompare(b.name, 'ru'));
    return { source, sourceIndex, doctors };
  })
    // Поиск идёт по всей сети: врача ищут, не всегда зная, где он принимает.
    .filter(section => needle ? section.doctors.length > 0 : section.sourceIndex === selected),
  [results, needle, selected]);

  return <section className="mk-doctors">
    <MarketingTools>
      <div className="ola-log-search mk-search">
        <Search size={15}/>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти врача во всех медцентрах"/>
        {query && <button className="ola-icon-btn" onClick={() => setQuery('')}><X size={14}/></button>}
      </div>
      {results.length > 0 && <select className="ola-select mk-filter" value={results[selected]?.clinic || ''}
        onChange={event => choose(event.target.value)} aria-label="Медцентр" disabled={Boolean(needle)}>
        {results.map(source => <option key={source.clinic} value={source.clinic}>{clinicName(source)}</option>)}
      </select>}
      {last?.platform_notice && <span className="mk-scan-warning" title={last.platform_notice}>
        <AlertTriangle size={18}/>
      </span>}
      {/* Пока идёт сверка, кнопка сама показывает прогресс; этап — в подсказке. */}
      <button className={'ola-btn primary mk-scan-btn' + (running ? ' running' : '')} onClick={start}
        disabled={starting || Boolean(running)}
        title={running ? `Идёт сверка: ${running.stage}. Пока показаны результаты предыдущей.` : undefined}>
        {running && <span className="mk-scan-progress" style={{ width: (running.progress || 0) + '%' }}/>}
        {starting || running ? <Loader2 className="mk-spin" size={15}/> : <RefreshCw size={15}/>}
        {running ? `Сверка ${running.progress || 0}%` : 'Обновить сейчас'}
      </button>
    </MarketingTools>

    {error && <div className="mk-doctor-error">{error}</div>}
    {loading && <div className="mk-doctor-empty"><Loader2 className="mk-spin" size={14}/> Загрузка…</div>}
    {!loading && !last && !running && !error && <div className="mk-doctor-empty">
      Сверок ещё не было. Нажмите «Обновить сейчас» — парсер соберёт врачей с сайтов клиник и найдёт их карточки на площадках.
    </div>}
    {last && needle && !sections.length && <div className="mk-doctor-empty">Врачей с таким ФИО не нашлось.</div>}

    {last && sections.map(({ source, sourceIndex, doctors }) =>
      <ClinicDoctors key={source.clinic} source={source} sourceIndex={sourceIndex} scanId={last.id} doctors={doctors}/>)}
  </section>;
}
