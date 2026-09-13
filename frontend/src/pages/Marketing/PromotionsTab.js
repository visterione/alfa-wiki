/**
 * Вкладка «Акции» модуля «Маркетинг» (ver. 8.22).
 *
 * Источник данных — МИС, своей таблицы у акций больше нет. Отсюда два решения,
 * которые иначе выглядели бы странно:
 *
 *   1. Акцию нельзя ни изменить, ни удалить. В API МИС есть getPromos и
 *      createPromo — и всё. Поэтому на карточке нет кнопок правки, а форма
 *      создания заканчивается сводкой: заведённую по ошибке акцию придётся
 *      гасить вручную в Renovatio, и лучше увидеть её состав до отправки, чем
 *      после.
 *
 *   2. Срок считается здесь, а не спрашивается у МИС. МИС не гасит акции по
 *      истечении даты: на момент перехода из 44 акций 19 были просрочены, и у
 *      всех, включая прошлогодние, status = true. Показывать этот список как
 *      есть — значит показывать пополам с мусором.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, Clock, Infinity as InfinityIcon,
  Loader2, Plus, RefreshCw, Search, Tag, X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { marketing, mis as misApi } from '../../services/api';
import PromoForm from './PromoForm';

const WEEK_DAY_NAMES = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const STATUS_META = {
  active:  { label: 'Действующие', badge: 'ok',    icon: CheckCircle2 },
  future:  { label: 'Будущие',     badge: 'wait',  icon: CalendarClock },
  expired: { label: 'Завершённые', badge: 'muted', icon: Clock }
};

function fmtDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Срок действия человеческой строкой. */
function periodLabel(promo) {
  const from = fmtDate(promo.dateFrom);
  const to = fmtDate(promo.dateTo);
  if (!from && !to) return 'Бессрочно';
  if (from && to) return `${from} — ${to}`;
  return to ? `до ${to}` : `с ${from}`;
}

function discountLabel(promo) {
  if (promo.discount != null) return `${promo.discount}%`;
  if (promo.absDiscount != null) return `${promo.absDiscount.toLocaleString('ru-RU')} ₽`;
  return null;
}

/** Время внутри дня МИС отдаёт с секундами — они здесь только мешают. */
function trimTime(value) {
  return value ? String(value).slice(0, 5) : null;
}

/**
 * Подробное описание приходит из МИС как HTML: там и &quot;, и <br />. Выводить
 * его разметкой значило бы вставлять в портал чужой HTML, поэтому разворачиваем
 * в текст — на карточке он всё равно показывается одной-двумя строками.
 */
function htmlToText(html) {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n');
  return (el.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function PromoCard({ promo }) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState(null);
  const discount = discountLabel(promo);
  const timeFrom = trimTime(promo.timeFrom);
  const timeTo = trimTime(promo.timeTo);
  const text = useMemo(() => htmlToText(promo.desc || promo.shortDesc), [promo.desc, promo.shortDesc]);

  // Названия услуг тянем только у раскрытой карточки: у иной акции их под две
  // сотни, а на полке таких карточек десяток — запрашивать всё вперёд значит
  // положить открытие вкладки ради строки, которую, может, и не развернут.
  useEffect(() => {
    if (!open || services !== null || !promo.services.length) return;
    let alive = true;
    misApi.getServicesByIds(promo.services, promo.clinicId || undefined)
      .then(({ data }) => {
        if (!alive) return;
        setServices(Array.isArray(data?.data) ? data.data.map(s => s.title).filter(Boolean) : []);
      })
      .catch(() => { if (alive) setServices([]); });
    return () => { alive = false; };
  }, [open, services, promo.services, promo.clinicId]);

  const hasDetails = !!(text || promo.services.length || promo.link || promo.ageFrom != null || promo.ageTo != null);

  return (
    <article className={`mk-promo ${promo.status}`} style={{ '--mk-promo-tone': promo.medCenterColor || 'var(--n-400)' }}>
      <div className="mk-promo-top">
        <h4>{promo.title}</h4>
        {discount && <span className="mk-promo-discount">{discount}</span>}
      </div>

      <div className="mk-promo-meta">
        <span className={`ola-badge ${STATUS_META[promo.status].badge}`}>
          {promo.dateFrom || promo.dateTo
            ? React.createElement(STATUS_META[promo.status].icon, { size: 12 })
            : <InfinityIcon size={12} />}
          {periodLabel(promo)}
        </span>
        {promo.weekDays.length > 0 && promo.weekDays.length < 7 && (
          <span className="ola-badge muted">{promo.weekDays.map(d => WEEK_DAY_NAMES[d - 1]).join(', ')}</span>
        )}
        {(timeFrom || timeTo) && (
          <span className="ola-badge muted"><Clock size={12} />{timeFrom || '00:00'}—{timeTo || '23:59'}</span>
        )}
        {promo.services.length > 0 && (
          <span className="ola-badge muted">{promo.services.length} усл.</span>
        )}
      </div>

      {hasDetails && (
        <button className={`mk-promo-more ${open ? 'open' : ''}`} onClick={() => setOpen(v => !v)}>
          <ChevronDown size={14} /> {open ? 'Свернуть' : 'Подробнее'}
        </button>
      )}

      {open && (
        <div className="mk-promo-details">
          {text && <p>{text}</p>}
          {(promo.ageFrom != null || promo.ageTo != null) && (
            <p className="mk-promo-cond">
              Возраст: {promo.ageFrom != null ? `от ${promo.ageFrom}` : ''}
              {promo.ageFrom != null && promo.ageTo != null ? ' ' : ''}
              {promo.ageTo != null ? `до ${promo.ageTo}` : ''}
            </p>
          )}
          {promo.link && <a href={promo.link} target="_blank" rel="noreferrer">Страница акции на сайте</a>}
          {promo.services.length > 0 && (
            <div className="mk-promo-services">
              {services === null
                ? <span className="mk-muted"><Loader2 size={13} className="mk-spin" /> Загружаем услуги…</span>
                : services.length
                  ? <ul>{services.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  : <span className="mk-muted">Услуги не удалось получить из МИС</span>}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function PromotionsTab({ level }) {
  const canEdit = level === 'edit';
  const [promos, setPromos] = useState(null);
  const [query, setQuery] = useState('');
  // Просроченные скрыты по умолчанию: их почти половина списка, и все они —
  // прошлое, на которое маркетолог смотрит редко и намеренно.
  const [shown, setShown] = useState({ active: true, future: true, expired: false });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await marketing.getPromos();
      setPromos(data.promos || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось получить акции из МИС');
      setPromos([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const acc = { active: 0, future: 0, expired: 0 };
    (promos || []).forEach(p => { acc[p.status] += 1; });
    return acc;
  }, [promos]);

  // Полки по медцентрам: акция всегда принадлежит одному филиалу либо всей
  // сети, и маркетолог думает именно филиалами.
  const shelves = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = (promos || [])
      .filter(p => shown[p.status])
      .filter(p => !term || p.title.toLowerCase().includes(term));

    const byCenter = new Map();
    for (const promo of list) {
      const key = promo.medCenterName || (promo.clinicId ? `Клиника №${promo.clinicId}` : 'Вся сеть');
      if (!byCenter.has(key)) byCenter.set(key, { name: key, color: promo.medCenterColor, items: [] });
      byCenter.get(key).items.push(promo);
    }
    return [...byCenter.values()].sort((a, b) => {
      // «Вся сеть» вверх: это акции, действующие в каждом филиале.
      if (a.name === 'Вся сеть') return -1;
      if (b.name === 'Вся сеть') return 1;
      return a.name.localeCompare(b.name, 'ru');
    });
  }, [promos, shown, query]);

  const toggle = key => setShown(s => ({ ...s, [key]: !s[key] }));

  return (
    <section className="mk-promos">
      <div className="mk-toolbar">
        <div className="ola-log-search mk-search">
          <Search size={15} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск по названию акции"
          />
          {query && <button className="ola-icon-btn" onClick={() => setQuery('')}><X size={14} /></button>}
        </div>

        <div className="mk-filters">
          {Object.entries(STATUS_META).map(([key, meta]) => (
            <button
              key={key}
              className={`ola-check ${shown[key] ? 'on' : ''}`}
              onClick={() => toggle(key)}
            >
              <input type="checkbox" readOnly checked={shown[key]} />
              {meta.label}
              <b>{counts[key]}</b>
            </button>
          ))}
        </div>

        <div className="mk-toolbar-actions">
          <button className="ola-btn" onClick={load} title="Обновить"><RefreshCw size={15} /></button>
          {canEdit && (
            <button className="ola-btn primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> Новая акция
            </button>
          )}
        </div>
      </div>

      {promos === null && <div className="mk-loading"><Loader2 size={18} className="mk-spin" /> Загружаем акции из МИС…</div>}

      {promos !== null && !shelves.length && (
        <div className="ola-empty">
          <Tag size={30} />
          <h3>Акций не найдено</h3>
          <p>{promos.length ? 'Попробуйте изменить отбор или поисковый запрос.' : 'В МИС нет ни одной акции.'}</p>
        </div>
      )}

      {shelves.map(shelf => (
        <div className="ola-card mk-shelf" key={shelf.name}>
          <header>
            <span className="mk-shelf-dot" style={{ background: shelf.color || 'var(--n-400)' }} />
            <h3>{shelf.name}</h3>
            <span className="ola-badge muted">{shelf.items.length}</span>
          </header>
          <div className="ola-card-body mk-shelf-body">
            {shelf.items.map(promo => <PromoCard key={promo.id} promo={promo} />)}
          </div>
        </div>
      ))}

      {creating && (
        <PromoForm
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}

      {canEdit && promos !== null && (
        <p className="mk-footnote">
          <AlertTriangle size={13} />
          Акцию в МИС нельзя изменить или удалить через портал — таких методов в API МИС нет.
          Заведённая акция правится только в интерфейсе Renovatio.
        </p>
      )}
    </section>
  );
}
