import React, { useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle, RefreshCw, Search, Stethoscope } from 'lucide-react';
import { marketing } from '../../services/api';
import './Marketing.css';

const STATUS = {
  same: ['Совпадает', 'same'],
  no_data: ['Нет данных', 'missing'],
  different: ['Значения различаются — проверьте услугу', 'review'],
  review: ['Нужна ручная сверка', 'review']
};
const label = key => ({
  identity: 'ФИО', specialties: 'Специальности', experience: 'Стаж',
  price: 'Стоимость приёма', education: 'Образование', workplace: 'Место приёма'
}[key] || key);

function Comparison({ value }) {
  if (!value?.fields) return null;
  const format = item => Array.isArray(item) ? (item.join(', ') || '—') : (item ?? '—');
  return <div className="mk-doctor-comparison">
    <a href={value.url} target="_blank" rel="noreferrer">Открыть карточку <ExternalLink size={13}/></a>
    {Object.entries(value.fields).map(([key, field]) => {
      const status = STATUS[field.status] || STATUS.review;
      return <div className={'mk-doctor-field ' + status[1]} key={key}>
        <div><b>{label(key)}</b><span>{status[0]}</span></div>
        <small>На сайте: {format(field.source)} · На площадке: {format(field.external)}</small>
        {field.note && <small>{field.note}</small>}
      </div>;
    })}
  </div>;
}

export default function DoctorsTab() {
  const [scanId, setScanId] = useState(() => sessionStorage.getItem('marketingDoctorsScanId') || '');
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [urls, setUrls] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!scanId || scan?.finished) return undefined;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const { data } = await marketing.getDoctorScan(scanId);
        if (cancelled) return;
        setScan(data);
        if (!data.finished) timer = setTimeout(poll, 1500);
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.message || 'Не удалось получить состояние сканирования');
        timer = setTimeout(poll, 3000);
      }
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [scanId, scan?.finished]);

  const start = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await marketing.startDoctorScan();
      setScanId(data.scan_id);
      sessionStorage.setItem('marketingDoctorsScanId', data.scan_id);
      setScan({ id: data.scan_id, stage: data.stage, finished: false, results: [] });
    } catch (err) {
      setError(err.response?.data?.message || 'Не удалось запустить сбор врачей');
    } finally { setLoading(false); }
  };

  const compare = async (sourceIndex, doctorIndex, platform, key) => {
    setBusy(key); setError('');
    try {
      await marketing.compareDoctor(scanId, {
        source_index: sourceIndex, doctor_index: doctorIndex,
        platform, profile_url: urls[key] || ''
      });
      const { data } = await marketing.getDoctorScan(scanId);
      setScan(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Не удалось прочитать карточку площадки');
    } finally { setBusy(''); }
  };

  return <section className="mk-doctors">
    <div className="mk-doctors-heading">
      <div><h1><Stethoscope size={21}/> Врачи</h1>
        <p>Сверка карточек врачей клиник с медицинскими площадками.</p></div>
      <button className="ola-btn primary" onClick={start} disabled={loading}>
        {loading ? <LoaderCircle className="mk-spin" size={16}/> : <RefreshCw size={16}/>}
        {scanId ? 'Обновить список' : 'Собрать список врачей'}
      </button>
    </div>
    {error && <div className="mk-doctor-error">{error}</div>}
    {scan && <div className="mk-doctor-stage">{scan.stage}</div>}
    {!scan && !loading && <div className="mk-doctor-empty">
      Нажмите «Собрать список врачей». Парсер прочитает карточки с семи сайтов клиник.
    </div>}
    {(scan?.results || []).map((source, sourceIndex) => <section className="mk-doctor-source" key={source.clinic + '-' + sourceIndex}>
      <h2><a href={source.url} target="_blank" rel="noreferrer">{source.clinic} <ExternalLink size={13}/></a></h2>
      {source.error ? <div className="mk-doctor-error">{source.error}</div> : !source.doctors?.length
        ? <div className="mk-doctor-empty">На этой странице врачи автоматически не распознаны.</div>
        : source.doctors.map((doctor, doctorIndex) => <article className="mk-doctor-card" key={doctor.name + '-' + doctorIndex}>
          <a className="mk-doctor-name" href={doctor.profile_url} target="_blank" rel="noreferrer">{doctor.name}</a>
          <div className="mk-doctor-meta">
            {doctor.specialties?.join(', ') || 'Специальность не указана'}
            {doctor.experience_years != null && ' · стаж ' + doctor.experience_years + ' лет'}
            {doctor.price_from != null && ' · приём от ' + Number(doctor.price_from).toLocaleString('ru-RU') + ' ₽'}
          </div>
          {doctor.source_text && <details className="mk-doctor-source-text">
            <summary>Данные исходной карточки</summary><p>{doctor.source_text}</p>
          </details>}
          <div className="mk-doctor-platforms">
            {Object.entries(doctor.platform_searches || {}).map(([platform, searchUrl]) => {
              const key = sourceIndex + ':' + doctorIndex + ':' + platform;
              const comparison = doctor.comparisons?.[platform];
              return <div className="mk-doctor-platform" key={platform}>
                <div className="mk-doctor-platform-title">
                  <a className="ola-btn secondary" href={searchUrl} target="_blank" rel="noreferrer">
                    <Search size={14}/> Найти на {platform}
                  </a><span>Скопируйте URL подтверждённой карточки сюда</span>
                </div>
                <div className="mk-doctor-url-row">
                  <input type="url" value={urls[key] || ''} placeholder="Прямая ссылка на карточку"
                    onChange={event => setUrls(prev => ({ ...prev, [key]: event.target.value }))}/>
                  <button className="ola-btn primary" onClick={() => compare(sourceIndex, doctorIndex, platform, key)}
                    disabled={!urls[key] || busy === key}>
                    {busy === key ? <LoaderCircle className="mk-spin" size={15}/> : 'Сверить'}
                  </button>
                </div>
                {comparison?.error ? <div className="mk-doctor-error">{comparison.error}</div>
                  : <Comparison value={comparison}/>}
              </div>;
            })}
          </div>
        </article>)}
    </section>)}
  </section>;
}
