import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, ExternalLink, Info, Phone, Smartphone, Stethoscope } from 'lucide-react';
import { doctorCards, mis } from '../services/api';
import './DoctorProfileTab.css';

const CLINICS = [
  { id: 2, name: 'Альфа', color: '#de64a1' },
  { id: 3, name: 'Кидс', color: '#ed9121' },
  { id: 1, name: 'Проф', color: '#9999ff' },
  { id: 6, name: 'Линия', color: '#c4aa88' },
  { id: 4, name: '3К', color: '#800080' },
  { id: 7, name: 'Смайл', color: '#777' },
  { id: 11, name: 'Сукко', color: '#2d7055' }
];
const OLD_TO_NEW = { 1: 2, 2: 3, 3: 1, 4: 6, 5: 4, 6: 7 };
const clinicIdsFor = card => (card?.metadata?.clinics || []).map(id => OLD_TO_NEW[id] || Number(id));
const pad = n => String(n).padStart(2, '0');
const apiDate = date => `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
const mondayOf = date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
};
const normalizePeriodDate = value => {
  const raw = String(value || '').split(' ')[0];
  if (!raw.includes('-')) return raw;
  const [year, month, day] = raw.split('-');
  return `${day}.${month}.${year}`;
};
const priceText = (prices, clinicIds) => {
  const entries = clinicIds
    .map(id => ({ id, price: Number(prices?.[id] || 0) }))
    .filter(item => item.price > 0);
  if (!entries.length && Number(prices?.default) > 0) return `${Number(prices.default).toLocaleString('ru-RU')} ₽`;
  if (!entries.length) return '—';
  if (entries.every(item => item.price === entries[0].price)) return `${entries[0].price.toLocaleString('ru-RU')} ₽`;
  return entries.map(item => `${item.price.toLocaleString('ru-RU')} ₽ (${CLINICS.find(c => c.id === item.id)?.name || item.id})`).join(', ');
};

function ServicesTable({ services, loading, emptyText = 'Услуги не найдены' }) {
  if (loading) return <div className="doctor-profile-empty">Загрузка услуг…</div>;
  if (!services.length) return emptyText ? <div className="doctor-profile-empty">{emptyText}</div> : null;
  return (
    <div className="doctor-profile-table-wrap">
      <table className="doctor-profile-table">
        <thead><tr><th>Артикул</th><th>Услуга</th><th>Длит.</th><th>Цена</th></tr></thead>
        <tbody>{services.map(service => (
          <tr key={service.id}>
            <td>{service.code || '—'}</td>
            <td>
              <span>{service.title || '—'}</span>
              {service.info && <span className="doctor-service-info" title={service.info}>?</span>}
            </td>
            <td>{service.duration || '—'}</td>
            <td>{service.price || '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ScheduleTimeline({ periods, slots, cancellations }) {
  const parseMinutes = value => {
    const time = String(value || '').split(' ')[1]?.slice(0, 5);
    if (!time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };
  const clinicGroups = periods.reduce((groups, period) => {
    const key = String(period.clinic_id || 'unknown');
    if (!groups[key]) groups[key] = [];
    groups[key].push(period);
    return groups;
  }, {});
  return Object.entries(clinicGroups).map(([clinicId, clinicPeriods]) => {
    const starts = clinicPeriods.map(p => parseMinutes(p.time_start)).filter(Number.isFinite);
    const ends = clinicPeriods.map(p => parseMinutes(p.time_end)).filter(Number.isFinite);
    const start = Math.min(...starts);
    const end = Math.max(...ends);
    const duration = end - start;
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const clinic = CLINICS.find(item => item.id === Number(clinicId));
    const relevantSlots = slots.filter(slot => String(slot.clinic_id || 'unknown') === clinicId && slot.is_busy);
    const relevantCancellations = cancellations.filter(period => !period.clinic_id || String(period.clinic_id) === clinicId);
    const position = (from, to) => ({ left: `${((from - start) / duration) * 100}%`, width: `${((to - from) / duration) * 100}%` });
    const label = minutes => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    return (
      <div className="doctor-timeline-group" key={clinicId}>
        <div className="doctor-timeline-header"><b style={{ background: clinic?.color || '#94a3b8' }}>{clinic?.name || `Клиника ${clinicId}`}</b><span>{label(start)}–{label(end)}</span></div>
        <div className="doctor-timeline-labels"><span>{label(start)}</span><span>{label(end)}</span></div>
        <div className="doctor-timeline">
          {clinicPeriods.map((period, index) => {
            const from = parseMinutes(period.time_start); const to = parseMinutes(period.time_end);
            return <i className="work" key={`work-${index}`} style={position(from, to)} />;
          })}
          {relevantSlots.map((slot, index) => {
            const from = parseMinutes(slot.time_start); const to = parseMinutes(slot.time_end);
            const title = [`ЗАНЯТО: ${label(from)}–${label(to)}`, slot.patient_name && `Пациент: ${slot.patient_name}`, slot.appointment_type && `Тип: ${slot.appointment_type}`, slot.room && `Кабинет: ${slot.room}`, slot.comment && `Комментарий: ${slot.comment}`].filter(Boolean).join('\n');
            return <i className="busy" key={`busy-${index}`} style={position(from, to)} title={title} />;
          })}
          {relevantCancellations.map((period, index) => {
            const from = Math.max(start, parseMinutes(period.time_start)); const to = Math.min(end, parseMinutes(period.time_end));
            return from < to ? <i className="cancel" key={`cancel-${index}`} style={position(from, to)} title={`Отмена расписания: ${label(from)}–${label(to)}`} /> : null;
          })}
        </div>
      </div>
    );
  });
}

function DoctorSchedule({ misUserId }) {
  const days = useMemo(() => {
    const monday = mondayOf(new Date());
    return Array.from({ length: 14 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return date;
    });
  }, []);
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [dayData, setDayData] = useState({ loading: false, periods: [], slots: [] });

  useEffect(() => {
    if (!misUserId) return;
    setLoading(true);
    mis.getSchedulePeriods({
      user_id: misUserId,
      time_start: `${apiDate(days[0])} 00:00`,
      time_end: `${apiDate(days[days.length - 1])} 23:59`
    }).then(({ data }) => {
      const rows = data?.error === 0 && Array.isArray(data.data) ? data.data : [];
      setPeriods(rows.filter(row => String(row.user_id) === String(misUserId)));
    }).catch(() => setPeriods([])).finally(() => setLoading(false));
  }, [days, misUserId]);

  const loadDay = async date => {
    const dateText = apiDate(date);
    setSelectedDate(date);
    setDayData({ loading: true, periods: [], slots: [] });
    try {
      const [periodResult, slotResult] = await Promise.all([
        mis.getSchedulePeriods({ user_id: misUserId, time_start: `${dateText} 00:00`, time_end: `${dateText} 23:59` }),
        mis.getSchedule({ user_id: misUserId, time_start: `${dateText} 00:00`, time_end: `${dateText} 23:59`, show_busy: true, show_past: false, step: 30 })
      ]);
      const periodRows = Array.isArray(periodResult.data?.data) ? periodResult.data.data : [];
      const rawSlots = slotResult.data?.data;
      const slotRows = Array.isArray(rawSlots) ? rawSlots : (rawSlots?.[misUserId] || []);
      setDayData({ loading: false, periods: periodRows, slots: slotRows });
    } catch {
      setDayData({ loading: false, periods: [], slots: [] });
    }
  };

  const availableDates = new Set(periods.filter(p => Number(p.type) !== 3).map(p => normalizePeriodDate(p.time_start)));
  const clickableDates = new Set(periods.map(p => normalizePeriodDate(p.time_start)));
  const cancellations = dayData.periods.filter(p => Number(p.type) === 3);
  const workPeriods = dayData.periods.filter(p => Number(p.type) !== 3);
  const timeOf = value => String(value || '').split(' ')[1]?.slice(0, 5) || '—';

  if (!misUserId) return <div className="doctor-profile-empty">Врач не привязан к МИС</div>;
  return (
    <div className="doctor-schedule">
      <div className="doctor-calendar-title">{days[0].toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</div>
      <div className="doctor-calendar-weekdays">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day => <span key={day}>{day}</span>)}</div>
      <div className="doctor-calendar-grid">
        {days.map(date => {
          const key = apiDate(date);
          const available = availableDates.has(key);
          const clickable = clickableDates.has(key);
          const today = new Date().toDateString() === date.toDateString();
          return <button key={key} className={`${available ? 'available' : ''} ${today ? 'today' : ''} ${selectedDate?.toDateString() === date.toDateString() ? 'selected' : ''}`} disabled={!clickable && !loading} onClick={() => loadDay(date)}>{date.getDate()}</button>;
        })}
      </div>
      {loading && <div className="doctor-profile-empty compact">Загрузка календаря…</div>}
      {selectedDate && (
        <div className="doctor-day-details">
          <h4>{selectedDate.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</h4>
          {dayData.loading ? <div className="doctor-profile-empty compact">Загрузка расписания…</div> : (
            <>
              {cancellations.length > 0 && <div className="doctor-cancellation">Отмена приёма: {cancellations.map(p => `${timeOf(p.time_start)}–${timeOf(p.time_end)}`).join(', ')}</div>}
              <ScheduleTimeline periods={workPeriods} slots={dayData.slots} cancellations={cancellations} />
              {!workPeriods.length && !cancellations.length && <div className="doctor-profile-empty compact">Расписание на день отсутствует</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function DoctorProfileTab({ isAdmin }) {
  const [options, setOptions] = useState([]);
  const [selectedCardId, setSelectedCardId] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [section, setSection] = useState('info');
  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);

  const loadCard = useCallback(cardId => {
    setLoading(true);
    setError('');
    setSection('info');
    doctorCards.getMyProfile(cardId)
      .then(({ data }) => setResult(data))
      .catch(error => { setResult(null); setError(error.response?.data?.error || 'Не удалось загрузить карточку врача'); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isAdmin) { loadCard(); return; }
    doctorCards.getProfileOptions().then(({ data }) => {
      setOptions(data || []);
      if (data?.length) {
        setSelectedCardId(data[0].id);
        loadCard(data[0].id);
      } else {
        setLoading(false);
        setError('Карточки врачей не найдены');
      }
    }).catch(() => { setLoading(false); setError('Не удалось загрузить список карточек'); });
  }, [isAdmin, loadCard]);

  const card = result?.card;
  const meta = card?.metadata || {};
  const clinicIds = useMemo(() => clinicIdsFor(card), [card]);

  useEffect(() => {
    const misUserId = meta.misUserId;
    if (!card || !misUserId) { setServices([]); return; }
    let active = true;
    setServicesLoading(true);
    mis.getDoctorInfo(misUserId).then(async ({ data }) => {
      const ids = data?.success ? data.data?.services || [] : [];
      if (!ids.length) return [];
      const targets = clinicIds.length ? clinicIds : [null];
      const responses = await Promise.all(targets.map(clinicId => mis.getServicesByIds(ids, clinicId)));
      const byId = new Map();
      responses.forEach((response, responseIndex) => {
        const clinicId = targets[responseIndex];
        const rows = Array.isArray(response.data?.data) ? response.data.data : [];
        rows.forEach(row => {
          const id = String(row.service_id || row.id);
          const existing = byId.get(id) || { raw: row, prices: {} };
          existing.prices[clinicId || 'default'] = Number(row.price || 0);
          byId.set(id, existing);
        });
      });
      const overrides = meta.serviceOverrides || {};
      return [...byId.entries()].map(([id, item], index) => {
        const override = overrides[id] || {};
        return {
          id,
          code: item.raw.code || item.raw.sub_code || '',
          title: override.aliasName || item.raw.title || '',
          duration: override.aliasDuration || (item.raw.duration ? `${item.raw.duration} мин` : '—'),
          info: override.aliasInfo || '',
          price: priceText(item.prices, clinicIds),
          hidden: Boolean(override.isHidden),
          favorite: Boolean(override.isFavorite),
          sortOrder: override.sortOrder ?? (10000 + index)
        };
      }).filter(item => !item.hidden).sort((a, b) => a.sortOrder - b.sortOrder);
    }).then(rows => { if (active) setServices(rows || []); })
      .catch(() => { if (active) setServices([]); })
      .finally(() => { if (active) setServicesLoading(false); });
    return () => { active = false; };
  }, [card, clinicIds, meta.misUserId, meta.serviceOverrides]);

  if (loading) return <div className="card"><div className="card-body doctor-profile-empty">Загрузка карточки врача…</div></div>;
  return (
    <div className="doctor-profile-tab">
      {isAdmin && options.length > 0 && <div className="doctor-admin-picker"><div><b>Проверка карточки врача</b><span>Диагностический режим администратора</span></div><select value={selectedCardId} onChange={event => { setSelectedCardId(event.target.value); loadCard(event.target.value); }}>{options.map(option => <option key={option.id} value={option.id}>{option.fullName}{option.specialty ? ` — ${option.specialty}` : ''}</option>)}</select></div>}
      {error ? <div className="card"><div className="card-body doctor-profile-empty">{error}</div></div> : card && (
        <div className="doctor-card-readonly">
          <div className="doctor-clinics">{CLINICS.map(clinic => <span key={clinic.id} className={clinicIds.includes(clinic.id) ? 'active' : ''} style={clinicIds.includes(clinic.id) ? { background: clinic.color } : undefined}>{clinic.name}</span>)}<div className="doctor-tags">{(meta.tags || []).map(tag => <em key={tag}>#{tag}</em>)}</div></div>
          <div className="doctor-card-heading"><div><h2>{card.fullName}</h2><div className="doctor-specialty">{card.specialty}</div><div className="doctor-details">{meta.ageRange && <span><Stethoscope size={14}/>{meta.ageRange}</span>}{card.experience && <span><CalendarDays size={14}/>{card.experience}</span>}{meta.internalNumber && <span><Phone size={14}/>вн. {meta.internalNumber}</span>}{meta.mobileNumber && <span><Smartphone size={14}/>{meta.mobileNumber}</span>}{card.profileUrl && <a href={card.profileUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/>Профиль врача</a>}</div></div><div className="doctor-section-tabs"><button className={section === 'info' ? 'active' : ''} onClick={() => setSection('info')} title="Информация"><Info size={18}/></button><button className={section === 'services' ? 'active' : ''} onClick={() => setSection('services')} title="Услуги"><Stethoscope size={18}/></button><button className={section === 'schedule' ? 'active' : ''} onClick={() => setSection('schedule')} title="Расписание"><Clock3 size={18}/></button></div></div>
          <div className="doctor-card-content">
            {section === 'info' && <><ServicesTable services={services.filter(item => item.favorite)} loading={servicesLoading} emptyText="" />{card.description ? <div className="doctor-notes" dangerouslySetInnerHTML={{ __html: card.description }} /> : <div className="doctor-profile-empty">Заметки отсутствуют</div>}</>}
            {section === 'services' && <ServicesTable services={services} loading={servicesLoading} />}
            {section === 'schedule' && <DoctorSchedule misUserId={meta.misUserId} />}
          </div>
        </div>
      )}
    </div>
  );
}
