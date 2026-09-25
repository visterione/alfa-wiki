import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, Search, Stethoscope } from 'lucide-react';
import { marketing } from '../../services/api';
import './Marketing.css';

// Сверка карточек врачей сети с медицинскими площадками.
//
// Дерево: клиника → врач → площадка → сравнение сайта и площадки. Оценка —
// процент совпадения (100% — всё сходится), её считает парсер: среднее по
// полям карточки, по площадкам врача и по врачам клиники. Сверку раз в месяц
// запускает таймер на сервере парсера; кнопка «Обновить» — внеочередная.

// Яндекс первым: остальные площадки находятся по ссылкам из его карточки.
const PLATFORMS = ['Яндекс', 'ПроДокторов', 'НаПоправку', 'СберЗдоровье', 'ДокТу'];

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

const TONE_LABEL = {
  match: 'совпадает',
  conflict: 'расходится',
  partial: 'есть только с одной стороны или частично',
  empty: 'нет данных'
};

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

const scoreKind = score => score == null ? 'none' : score >= 90 ? 'good' : score >= 70 ? 'mid' : 'bad';

function Score({ value, title }) {
  return <span className={'mk-score ' + scoreKind(value)} title={title}>
    {value == null ? '—' : value + '%'}
  </span>;
}

const formatDate = iso => iso ? new Date(iso).toLocaleString('ru-RU', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
}) : '';

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
          <tr className={'mk-diff-row ' + tone} title={TONE_LABEL[tone]}>
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

function PlatformRow({ platform, entry }) {
  const [open, setOpen] = useState(false);
  const status = entry?.status || 'searching';
  const comparable = entry?.fields && Object.keys(entry.fields).length > 0;
  return <div className={'mk-tree-platform ' + status}>
    <div className="mk-tree-line" onClick={() => comparable && setOpen(!open)} role={comparable ? 'button' : undefined}>
      {comparable ? (open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>) : <span className="mk-tree-spacer"/>}
      <b>{platform}</b>
      {comparable ? <Score value={entry.score}/> : <span className={'mk-status ' + status}>{PLATFORM_STATUS[status]}</span>}
      {entry?.url && <a href={entry.url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>
        карточка <ExternalLink size={12}/>
      </a>}
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

function DoctorRow({ doctor, scanId, sourceIndex, open, onToggle }) {
  const loaded = useDoctorDetails(scanId, sourceIndex, doctor.index, open);
  const full = loaded?.doctor || doctor;
  return <div className="mk-tree-doctor">
    <div className="mk-tree-line" onClick={onToggle} role="button">
      {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
      <span className="mk-tree-name">{doctor.name}</span>
      <span className="mk-tree-meta">{(doctor.specialties || []).join(', ')}</span>
      <span className="mk-tree-dots">
        {PLATFORMS.map(platform => {
          const entry = doctor.comparisons?.[platform];
          const kind = entry?.score != null ? scoreKind(entry.score) : 'absent';
          return <i key={platform} className={'mk-dot ' + kind}
            title={platform + ': ' + (entry?.score != null ? entry.score + '%' : PLATFORM_STATUS[entry?.status || 'searching'])}/>;
        })}
      </span>
      <Score value={doctor.score} title="Среднее по площадкам, где есть карточка врача"/>
    </div>
    {open && <div className="mk-tree-children">
      <div className="mk-tree-source">
        <a href={doctor.profile_url} target="_blank" rel="noreferrer">Страница врача на сайте клиники <ExternalLink size={12}/></a>
        {doctor.site_conflicts?.length > 0 && <div className="mk-doctor-conflicts">
          Сайт противоречит сам себе: {doctor.site_conflicts.join('; ')}
        </div>}
      </div>
      {loaded?.loading && <div className="mk-tree-note"><Loader2 className="mk-spin" size={13}/> Загрузка сравнения…</div>}
      {loaded?.error && <div className="mk-doctor-error">{loaded.error}</div>}
      {PLATFORMS.map(platform => <PlatformRow key={platform} platform={platform} entry={full.comparisons?.[platform]}/>)}
    </div>}
  </div>;
}

function ClinicSection({ source, sourceIndex, scanId, doctors, forceOpen }) {
  const [open, setOpen] = useState(false);
  const [openDoctor, setOpenDoctor] = useState(null);
  const expanded = open || forceOpen;
  return <section className="mk-tree-clinic">
    <div className="mk-tree-line mk-tree-clinic-line" onClick={() => setOpen(!expanded)} role="button">
      {expanded ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
      <span className="mk-tree-name">{source.clinic}</span>
      <span className="mk-tree-meta">врачей {source.doctors?.length || 0}</span>
      <a href={source.url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}><ExternalLink size={13}/></a>
      <Score value={source.score} title="Среднее по врачам клиники"/>
    </div>
    {expanded && <div className="mk-tree-children">
      {source.error && <div className="mk-doctor-error">{source.error}</div>}
      {!source.error && !doctors.length && <div className="mk-doctor-empty">Врачей не найдено.</div>}
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

  const needle = query.trim().toLowerCase();
  const sources = useMemo(() => (last?.results || []).map(source => {
    // Номер врача в сверке нужен для запроса подробностей — до сортировки.
    const doctors = (source.doctors || []).map((doctor, index) => ({ ...doctor, index }))
      .filter(doctor => !needle || doctor.name.toLowerCase().includes(needle))
      // Сначала те, у кого расхождений больше: с них и начинают правку.
      .sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || a.name.localeCompare(b.name, 'ru'));
    return { source, doctors };
  }), [last, needle]);

  return <section className="mk-doctors">
    <div className="mk-doctors-heading">
      <div>
        <h1><Stethoscope size={21}/> Врачи на площадках</h1>
        <p>{last
          ? <>Сверка от {formatDate(last.finished_at || last.started_at)} · обновляется автоматически раз в месяц</>
          : 'Сверка карточек врачей на сайтах клиник с медицинскими площадками.'}</p>
      </div>
      <button className="ola-btn primary" onClick={start} disabled={starting || Boolean(running)}>
        {starting || running ? <Loader2 className="mk-spin" size={16}/> : <RefreshCw size={16}/>}
        {running ? 'Сверка идёт…' : 'Обновить сейчас'}
      </button>
    </div>

    {error && <div className="mk-doctor-error">{error}</div>}
    {running && <div className="mk-doctor-stage">
      Идёт сверка (около часа): {running.stage}. {last && 'Пока показаны результаты предыдущей.'}
    </div>}
    {last?.platform_notice && <div className="mk-doctor-notice">{last.platform_notice}</div>}
    {loading && <div className="mk-doctor-empty"><Loader2 className="mk-spin" size={14}/> Загрузка…</div>}
    {!loading && !last && !running && !error && <div className="mk-doctor-empty">
      Сверок ещё не было. Нажмите «Обновить сейчас» — парсер соберёт врачей с сайтов клиник и найдёт их карточки на площадках.
    </div>}

    {last && <>
      <div className="mk-tree-toolbar">
        <label className="mk-tree-search">
          <Search size={15}/>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти врача"/>
        </label>
        <div className="mk-diff-legend">
          <span className="mk-diff-item match">совпадает</span>
          <span className="mk-diff-item conflict">расходится</span>
          <span className="mk-diff-item partial">есть только с одной стороны</span>
          <span className="mk-diff-item neutral">к сравнению не относится</span>
        </div>
      </div>
      <div className="mk-tree">
        {sources.map(({ source, doctors }, index) => (!needle || doctors.length > 0) &&
          <ClinicSection key={source.clinic + index} source={source} sourceIndex={index} scanId={last.id}
            doctors={doctors} forceOpen={Boolean(needle)}/>)}
      </div>
    </>}
  </section>;
}
