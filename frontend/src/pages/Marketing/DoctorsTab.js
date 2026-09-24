import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Stethoscope } from 'lucide-react';
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
  price: 'Стоимость приёма', education: 'Образование', workplace: 'Место приёма',
  services: 'Манипуляции и услуги'
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

  return <section className="mk-doctors">
    <div className="mk-doctors-heading">
      <div><h1><Stethoscope size={21}/> Врачи</h1>
        <p>Сверка карточек врачей клиник с медицинскими площадками.</p></div>
      <button className="ola-btn primary" onClick={start} disabled={loading}>
        {loading ? <Loader2 className="mk-spin" size={16}/> : <RefreshCw size={16}/>}
        {scanId ? 'Обновить список' : 'Собрать список врачей'}
      </button>
    </div>
    {error && <div className="mk-doctor-error">{error}</div>}
    {scan && <div className="mk-doctor-stage">{scan.stage}</div>}
    {!scan && !loading && !error && <div className="mk-doctor-empty">
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
            {['ПроДокторов', 'Яндекс', 'НаПоправку', 'СберЗдоровье', 'ДокТу'].map(platform => {
              const comparison = doctor.comparisons?.[platform];
              const found = comparison?.status === 'found';
              const pending = !comparison || comparison.status === 'searching';
              return <div className="mk-doctor-platform" key={platform}>
                <div className="mk-doctor-platform-title">
                  {found ? <CheckCircle2 size={15} className="mk-doctor-found-icon"/> :
                    <AlertTriangle size={15} className="mk-doctor-review-icon"/>}
                  <b>{platform}</b>
                  <span>{pending ? 'Поиск…' : found ? 'Найдено автоматически' : 'Нужна проверка'}</span>
                </div>
                {comparison?.error ? <div className="mk-doctor-platform-message">{comparison.error}</div>
                  : <Comparison value={comparison}/>}
                {comparison?.review_note && <div className="mk-doctor-review-note">⚠ {comparison.review_note}</div>}
              </div>;
            })}
          </div>
        </article>)}
    </section>)}
  </section>;
}
