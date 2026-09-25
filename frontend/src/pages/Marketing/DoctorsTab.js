import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search, X } from 'lucide-react';
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

const scoreKind = score => score == null ? 'none' : score >= 90 ? 'good' : score >= 70 ? 'mid' : 'bad';

// Процент в круге: дуга — доля совпадения, цвет — как у подсветки полей.
function ScoreRing({ value, size = 36, title }) {
  const stroke = size >= 40 ? 4 : 3;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const filled = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100 * length;
  return <span className={'mk-ring ' + scoreKind(value)} style={{ width: size, height: size }} title={title}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="mk-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke}/>
      {value != null && <circle className="mk-ring-arc" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke}
        strokeDasharray={`${filled} ${length}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}/>}
    </svg>
    <b style={{ fontSize: Math.round(size * 0.3) }}>{value == null ? '—' : value}</b>
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

function Diff({ fields }) {
  return <table className="mk-diff">
    <colgroup><col className="mk-diff-label"/><col/><col/></colgroup>
    <thead><tr><th/><th>На сайте клиники</th><th>На площадке</th></tr></thead>
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

// Клик по названию или ФИО ведёт на карточку и не должен раскрывать строку.
const stop = event => event.stopPropagation();

function PlatformRow({ platform, entry }) {
  const [open, setOpen] = useState(false);
  const status = entry?.status || 'searching';
  const comparable = entry?.fields && Object.keys(entry.fields).length > 0;
  return <div className={'mk-tree-platform ' + status}>
    <div className="mk-tree-line" onClick={() => comparable && setOpen(!open)} role={comparable ? 'button' : undefined}>
      {comparable ? (open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>) : <span className="mk-tree-spacer"/>}
      <img className="mk-platform-logo" src={PLATFORM_LOGO[platform]} alt=""/>
      {entry?.url
        ? <a className="mk-platform-name" href={entry.url} target="_blank" rel="noreferrer" onClick={stop}>{platform}</a>
        : <b className="mk-platform-name">{platform}</b>}
      {!comparable && <span className={'mk-status ' + status}>{PLATFORM_STATUS[status]}</span>}
      {comparable && <ScoreRing value={entry.score} size={32}/>}
    </div>
    {(entry?.review_note || entry?.error) && <div className="mk-tree-note">{entry.review_note || entry.error}</div>}
    {open && comparable && <Diff fields={entry.fields}/>}
  </div>;
}

// Дерево приходит без таблиц сравнения — они весят в десять раз больше
// всего остального. Подробности врача грузятся, когда его раскрыли.
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

function Photo({ doctor }) {
  const [broken, setBroken] = useState(false);
  if (!doctor.photo || broken) {
    const initials = doctor.name.split(/\s+/).slice(0, 2).map(word => word.charAt(0)).join('');
    return <span className="mk-doctor-photo empty">{initials}</span>;
  }
  return <img className="mk-doctor-photo" src={doctor.photo} alt="" loading="lazy" onError={() => setBroken(true)}/>;
}

function DoctorRow({ doctor, scanId, sourceIndex, open, onToggle }) {
  const loaded = useDoctorDetails(scanId, sourceIndex, doctor.index, open);
  const full = loaded?.doctor || doctor;
  return <div className="mk-tree-doctor">
    <div className="mk-tree-line mk-doctor-line" onClick={onToggle} role="button">
      {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
      <Photo doctor={doctor}/>
      <div className="mk-doctor-title">
        <a href={doctor.profile_url} target="_blank" rel="noreferrer" onClick={stop}>{doctor.name}</a>
        <span>{(doctor.specialties || []).join(', ')}</span>
      </div>
      <ScoreRing value={doctor.score} size={36} title="Среднее по площадкам, где есть карточка врача"/>
    </div>
    {open && <div className="mk-tree-children">
      {doctor.site_conflicts?.length > 0 && <div className="mk-doctor-conflicts">
        Сайт противоречит сам себе: {doctor.site_conflicts.join('; ')}
      </div>}
      {loaded?.loading && <div className="mk-tree-note"><Loader2 className="mk-spin" size={13}/> Загрузка сравнения…</div>}
      {loaded?.error && <div className="mk-doctor-error">{loaded.error}</div>}
      {PLATFORMS.map(platform => <PlatformRow key={platform} platform={platform} entry={full.comparisons?.[platform]}/>)}
    </div>}
  </div>;
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
  const [openDoctor, setOpenDoctor] = useState(null);
  return <section className="mk-doctors-section">
    <ClinicHeader source={source}/>
    {source.error && <div className="mk-doctor-error">{source.error}</div>}
    {!source.error && !doctors.length && <div className="mk-doctor-empty">Врачей не найдено.</div>}
    {doctors.length > 0 && <div className="mk-tree-clinic">
      {doctors.map(doctor => <DoctorRow key={doctor.index} doctor={doctor} scanId={scanId} sourceIndex={sourceIndex}
        open={openDoctor === doctor.index}
        onToggle={() => setOpenDoctor(openDoctor === doctor.index ? null : doctor.index)}/>)}
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
        else setRunning(current => ({ ...current, stage: data.stage }));
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
      <button className="ola-btn primary" onClick={start} disabled={starting || Boolean(running)}>
        {starting || running ? <Loader2 className="mk-spin" size={15}/> : <RefreshCw size={15}/>}
        {running ? 'Сверка идёт…' : 'Обновить сейчас'}
      </button>
    </MarketingTools>

    {error && <div className="mk-doctor-error">{error}</div>}
    {running && <div className="mk-doctor-stage">
      Идёт сверка (около часа): {running.stage}. {last && 'Пока показаны результаты предыдущей.'}
    </div>}
    {last?.platform_notice && <div className="mk-doctor-notice">{last.platform_notice}</div>}
    {loading && <div className="mk-doctor-empty"><Loader2 className="mk-spin" size={14}/> Загрузка…</div>}
    {!loading && !last && !running && !error && <div className="mk-doctor-empty">
      Сверок ещё не было. Нажмите «Обновить сейчас» — парсер соберёт врачей с сайтов клиник и найдёт их карточки на площадках.
    </div>}
    {last && needle && !sections.length && <div className="mk-doctor-empty">Врачей с таким ФИО не нашлось.</div>}

    {last && sections.map(({ source, sourceIndex, doctors }) =>
      <ClinicDoctors key={source.clinic} source={source} sourceIndex={sourceIndex} scanId={last.id} doctors={doctors}/>)}
  </section>;
}
