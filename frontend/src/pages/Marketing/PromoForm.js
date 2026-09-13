/**
 * Форма создания акции в МИС (ver. 8.22).
 *
 * Отправка необратима: изменить или удалить акцию через API МИС нельзя, только
 * руками в Renovatio. Поэтому форма устроена в два шага — заполнение и сводка.
 * Сводка не «вы уверены?», а перечисление того, что именно уйдёт в МИС: у
 * акции десяток необязательных условий, и опечатка в проценте или забытый
 * филиал не видны, пока их не выписать отдельным списком.
 *
 * Поля, которых нет в форме, — не забытые. Из 44 акций сети рекламные каналы,
 * категории пациента, суммы и количества услуг, минимальная и максимальная
 * скидка и признак «применимо с дисконтом» не заполнены ни у одной. Возраст
 * заполнен у одной, поэтому он есть, но убран в «Дополнительные условия».
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Loader2, Plus, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { marketing, mis as misApi } from '../../services/api';

const WEEK_DAYS = [
  { n: 1, label: 'Пн' }, { n: 2, label: 'Вт' }, { n: 3, label: 'Ср' }, { n: 4, label: 'Чт' },
  { n: 5, label: 'Пт' }, { n: 6, label: 'Сб' }, { n: 7, label: 'Вс' }
];

function fmtDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export default function PromoForm({ onClose, onCreated }) {
  const [clinics, setClinics] = useState([]);
  const [step, setStep] = useState('form');
  const [saving, setSaving] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);

  const [form, setForm] = useState({
    title: '',
    clinicId: '',
    dateFrom: '',
    dateTo: '',
    discountKind: 'percent',
    discountValue: '',
    weekDays: [],
    timeFrom: '',
    timeTo: '',
    link: '',
    shortDesc: '',
    desc: '',
    ageFrom: '',
    ageTo: '',
    gender: ''
  });
  const [services, setServices] = useState([]);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  useEffect(() => {
    marketing.getPromoClinics()
      .then(({ data }) => setClinics(data || []))
      .catch(() => toast.error('Не удалось получить список медцентров'));
  }, []);

  const clinicName = useMemo(
    () => clinics.find(c => c.clinicId === form.clinicId)?.name || 'Все медцентры',
    [clinics, form.clinicId]
  );

  const problems = useMemo(() => {
    const list = [];
    if (!form.title.trim()) list.push('Не заполнено название акции');
    if (form.dateFrom && form.dateTo && form.dateFrom > form.dateTo) list.push('Дата начала позже даты окончания');
    if (form.discountValue !== '') {
      const n = Number(form.discountValue);
      if (!Number.isFinite(n) || n <= 0) list.push('Скидка должна быть положительным числом');
      else if (form.discountKind === 'percent' && n > 100) list.push('Скидка в процентах не может быть больше 100');
    }
    if (form.timeFrom && form.timeTo && form.timeFrom > form.timeTo) list.push('Время начала позже времени окончания');
    return list;
  }, [form]);

  const buildPayload = () => {
    const n = form.discountValue === '' ? null : Number(form.discountValue);
    return {
      title: form.title.trim(),
      clinicId: form.clinicId || null,
      dateFrom: form.dateFrom || null,
      dateTo: form.dateTo || null,
      discount: form.discountKind === 'percent' ? n : null,
      absDiscount: form.discountKind === 'rub' ? n : null,
      weekDays: form.weekDays.length === 7 ? [] : [...form.weekDays].sort(),
      timeFrom: form.timeFrom || null,
      timeTo: form.timeTo || null,
      services: services.map(s => String(s.service_id)),
      link: form.link.trim() || null,
      shortDesc: form.shortDesc.trim() || null,
      desc: form.desc.trim() || null,
      ageFrom: form.ageFrom === '' ? null : Number(form.ageFrom),
      ageTo: form.ageTo === '' ? null : Number(form.ageTo),
      gender: form.gender === '' ? null : Number(form.gender)
    };
  };

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await marketing.createPromo(buildPayload());
      toast.success(data.id ? `Акция заведена в МИС (id ${data.id})` : 'Акция заведена в МИС');
      onCreated();
    } catch (err) {
      toast.error(err.response?.data?.error || 'МИС не принял акцию');
      setStep('form');
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(() => {
    const rows = [['Название', form.title.trim() || '—'], ['Медцентр', clinicName]];
    rows.push(['Срок', form.dateFrom || form.dateTo
      ? [fmtDate(form.dateFrom) && `с ${fmtDate(form.dateFrom)}`, fmtDate(form.dateTo) && `по ${fmtDate(form.dateTo)}`].filter(Boolean).join(' ')
      : 'Бессрочно']);
    rows.push(['Скидка', form.discountValue === ''
      ? 'Не задана'
      : form.discountKind === 'percent' ? `${form.discountValue}%` : `${form.discountValue} ₽`]);
    rows.push(['Услуги', services.length ? `${services.length} шт.` : 'Все услуги']);
    if (form.weekDays.length && form.weekDays.length < 7) {
      rows.push(['Дни недели', WEEK_DAYS.filter(d => form.weekDays.includes(d.n)).map(d => d.label).join(', ')]);
    }
    if (form.timeFrom || form.timeTo) rows.push(['Время', `${form.timeFrom || '00:00'} — ${form.timeTo || '23:59'}`]);
    if (form.ageFrom !== '' || form.ageTo !== '') {
      rows.push(['Возраст', [form.ageFrom !== '' && `от ${form.ageFrom}`, form.ageTo !== '' && `до ${form.ageTo}`].filter(Boolean).join(' ')]);
    }
    if (form.gender) rows.push(['Пол', form.gender === '1' ? 'Мужской' : 'Женский']);
    if (form.link.trim()) rows.push(['Ссылка', form.link.trim()]);
    return rows;
  }, [form, clinicName, services]);

  return (
    <div className="mk-modal-overlay" onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="mk-modal">
        <header className="mk-modal-head">
          <h3>{step === 'form' ? 'Новая акция в МИС' : 'Проверьте акцию перед отправкой'}</h3>
          <button className="ola-icon-btn" onClick={onClose} disabled={saving}><X size={17} /></button>
        </header>

        {step === 'form' ? (
          <div className="mk-modal-body">
            <div className="ola-field">
              <label>Название акции</label>
              <input
                className="ola-input"
                value={form.title}
                onChange={e => set('title', e.target.value)}
                placeholder="Скидка 10% на анализы"
                maxLength={255}
                autoFocus
              />
            </div>

            <div className="ola-row">
              <div className="ola-field">
                <label>Медцентр</label>
                <select className="ola-select" value={form.clinicId} onChange={e => set('clinicId', e.target.value)}>
                  {/* «Все медцентры» — это clinic_id = null в МИС; так заведены
                      персональные скидки сети. Несколько филиалов сразу МИС не
                      принимает: либо один, либо все. */}
                  <option value="">Все медцентры</option>
                  {clinics.map(c => <option key={c.clinicId} value={c.clinicId}>{c.name}</option>)}
                </select>
              </div>
              <div className="ola-field narrow">
                <label>Скидка</label>
                <div className="mk-discount">
                  <input
                    className="ola-input"
                    type="number"
                    min="0"
                    value={form.discountValue}
                    onChange={e => set('discountValue', e.target.value)}
                    placeholder="10"
                  />
                  <div className="mk-seg">
                    <button
                      className={form.discountKind === 'percent' ? 'on' : ''}
                      onClick={() => set('discountKind', 'percent')}
                    >%</button>
                    <button
                      className={form.discountKind === 'rub' ? 'on' : ''}
                      onClick={() => set('discountKind', 'rub')}
                    >₽</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="ola-row">
              <div className="ola-field">
                <label>Действует с</label>
                <input className="ola-input" type="date" value={form.dateFrom} onChange={e => set('dateFrom', e.target.value)} />
              </div>
              <div className="ola-field">
                <label>по</label>
                <input className="ola-input" type="date" value={form.dateTo} onChange={e => set('dateTo', e.target.value)} />
              </div>
            </div>
            <p className="mk-hint">Обе даты пустые — акция бессрочная.</p>

            <ServicePicker
              clinicId={form.clinicId}
              services={services}
              onChange={setServices}
            />

            <div className="ola-field">
              <label>Дни недели</label>
              <div className="mk-days">
                {WEEK_DAYS.map(d => (
                  <button
                    key={d.n}
                    className={form.weekDays.includes(d.n) ? 'on' : ''}
                    /* Список пересчитывается внутри обновления состояния, а не
                       снаружи: два клика подряд React объединяет в одну
                       отрисовку, и вариант с form.weekDays из замыкания терял
                       первый из них — выбрать «Сб» и «Вс» быстрым тычком было
                       нельзя. */
                    onClick={() => setForm(f => ({
                      ...f,
                      weekDays: f.weekDays.includes(d.n)
                        ? f.weekDays.filter(x => x !== d.n)
                        : [...f.weekDays, d.n]
                    }))}
                  >{d.label}</button>
                ))}
              </div>
              <p className="mk-hint">Ничего не выбрано — акция действует во все дни.</p>
            </div>

            <div className="ola-row">
              <div className="ola-field">
                <label>Время в течение дня с</label>
                <input className="ola-input" type="time" value={form.timeFrom} onChange={e => set('timeFrom', e.target.value)} />
              </div>
              <div className="ola-field">
                <label>по</label>
                <input className="ola-input" type="time" value={form.timeTo} onChange={e => set('timeTo', e.target.value)} />
              </div>
            </div>

            <div className="ola-field">
              <label>Краткое описание</label>
              <input className="ola-input" value={form.shortDesc} onChange={e => set('shortDesc', e.target.value)} />
            </div>

            <div className="ola-field">
              <label>Подробное описание</label>
              <textarea className="ola-textarea" rows={3} value={form.desc} onChange={e => set('desc', e.target.value)} />
            </div>

            <div className="ola-field">
              <label>Ссылка на страницу акции</label>
              <input className="ola-input" value={form.link} onChange={e => set('link', e.target.value)} placeholder="https://medcentralfa.ru/stock/…" />
            </div>

            <button className="mk-extra-toggle" onClick={() => setExtraOpen(v => !v)}>
              {extraOpen ? '− ' : '+ '}Дополнительные условия
            </button>
            {extraOpen && (
              <div className="ola-row mk-extra">
                <div className="ola-field narrow">
                  <label>Возраст от</label>
                  <input className="ola-input" type="number" min="0" value={form.ageFrom} onChange={e => set('ageFrom', e.target.value)} />
                </div>
                <div className="ola-field narrow">
                  <label>Возраст до</label>
                  <input className="ola-input" type="number" min="0" value={form.ageTo} onChange={e => set('ageTo', e.target.value)} />
                </div>
                <div className="ola-field narrow">
                  <label>Пол</label>
                  <select className="ola-select" value={form.gender} onChange={e => set('gender', e.target.value)}>
                    <option value="">Любой</option>
                    <option value="1">Мужской</option>
                    <option value="2">Женский</option>
                  </select>
                </div>
              </div>
            )}

            {problems.length > 0 && (
              <div className="ola-warning">
                <AlertTriangle size={15} />
                <div>{problems.map((p, i) => <div key={i}>{p}</div>)}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="mk-modal-body">
            <div className="ola-warning">
              <AlertTriangle size={15} />
              <div>
                <strong>Акцию нельзя будет отменить из портала.</strong> В API МИС нет
                ни изменения, ни удаления — ошибку придётся править вручную в Renovatio.
              </div>
            </div>
            <dl className="mk-summary">
              {summary.map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
            {services.length > 0 && (
              <details className="mk-summary-services">
                <summary>Услуги ({services.length})</summary>
                <ul>{services.map(s => <li key={s.service_id}>{s.title}</li>)}</ul>
              </details>
            )}
          </div>
        )}

        <footer className="mk-modal-foot">
          {step === 'summary' && (
            <button className="ola-btn" onClick={() => setStep('form')} disabled={saving}>
              <ArrowLeft size={15} /> Назад
            </button>
          )}
          <div className="mk-foot-right">
            <button className="ola-btn" onClick={onClose} disabled={saving}>Отмена</button>
            {step === 'form' ? (
              <button
                className="ola-btn primary"
                disabled={problems.length > 0}
                onClick={() => setStep('summary')}
              >Далее</button>
            ) : (
              <button className="ola-btn primary" onClick={submit} disabled={saving}>
                {saving ? <><Loader2 size={15} className="mk-spin" /> Отправляем…</> : <><Plus size={15} /> Завести в МИС</>}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Выбор услуг поиском по прейскуранту МИС.
 *
 * Именно поиском, а не деревом категорий: прейскурант — это тысячи строк, и
 * загрузка его целиком занимает десятки секунд (см. /mis/all-services, который
 * ходит по категориям как раз потому, что целиком МИС его не отдаёт).
 */
function ServicePicker({ clinicId, services, onChange }) {
  const [term, setTerm] = useState('');
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (term.trim().length < 2) { setFound([]); return; }
    timer.current = setTimeout(() => {
      setBusy(true);
      misApi.searchServices(term.trim(), clinicId || undefined)
        .then(({ data }) => setFound(data?.success ? data.data : []))
        .catch(() => setFound([]))
        .finally(() => setBusy(false));
    }, 350);
    return () => clearTimeout(timer.current);
  }, [term, clinicId]);

  const add = (service) => {
    if (services.some(s => String(s.service_id) === String(service.service_id))) return;
    onChange([...services, service]);
    setTerm('');
    setFound([]);
  };

  return (
    <div className="ola-field">
      <label>Услуги</label>
      <div className="ola-log-search">
        <Search size={15} />
        <input
          value={term}
          onChange={e => setTerm(e.target.value)}
          placeholder="Найти услугу в прейскуранте МИС"
        />
        {busy && <Loader2 size={14} className="mk-spin" />}
      </div>

      {found.length > 0 && (
        <ul className="mk-service-results">
          {found.slice(0, 20).map(s => (
            <li key={s.service_id}>
              <button onClick={() => add(s)}>
                <span>{s.title}</span>
                <b>{s.price ? `${s.price.toLocaleString('ru-RU')} ₽` : ''}</b>
              </button>
            </li>
          ))}
        </ul>
      )}

      {services.length > 0 && (
        <div className="ola-chips mk-service-chips">
          {services.map(s => (
            <span className="ola-chip" key={s.service_id}>
              {s.title}
              <button onClick={() => onChange(services.filter(x => x.service_id !== s.service_id))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="mk-hint">Ни одной услуги не выбрано — скидка распространится на весь прейскурант.</p>
    </div>
  );
}
