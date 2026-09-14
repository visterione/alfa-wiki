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
 *
 * Карточка отвечает на один вопрос: что за акция, на какой срок и на сколько.
 * Состав, описание и цены живут в окне акции — список из восьми филиалов, где
 * у каждой карточки развёрнут перечень услуг, читать невозможно.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarRange, Clock, ExternalLink, Loader2, Percent, Plus, Search, Tag, X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { marketing, mis as misApi } from '../../services/api';
import { MarketingTools } from './toolsSlot';
import PromoForm from './PromoForm';

const WEEK_DAY_NAMES = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

/** Деления фильтра. all идёт первым: это состояние «покажи всё, как есть». */
const FILTERS = [
  { key: 'all',     label: 'Все' },
  { key: 'active',  label: 'Действующие' },
  { key: 'future',  label: 'Будущие' },
  { key: 'expired', label: 'Завершённые' }
];

function fmtDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function fmtMoney(value) {
  return `${Number(value).toLocaleString('ru-RU')} ₽`;
}

/** Срок действия человеческой строкой. */
function periodLabel(promo) {
  const from = fmtDate(promo.dateFrom);
  const to = fmtDate(promo.dateTo);
  if (!from && !to) return 'Бессрочно';
  if (from && to) return `${from} — ${to}`;
  return to ? `до ${to}` : `с ${from}`;
}

/** Размер скидки без знака — в таком виде он встречается в названиях из МИС. */
function discountLabel(promo) {
  if (promo.discount != null) return `${promo.discount}%`;
  if (promo.absDiscount != null) return fmtMoney(promo.absDiscount);
  return null;
}

/**
 * То же значение для показа, со знаком минус: «−20%», «−1 500 ₽».
 *
 * Отдельно от discountLabel, потому что cleanTitle сопоставляет значение с
 * хвостом названия, а там оно записано без знака. Минус типографский (U+2212),
 * а не дефис: рядом с цифрами дефис короче и сидит ниже, отчего читается как
 * перенос, а не как вычитание.
 */
function discountDisplay(promo) {
  const value = discountLabel(promo);
  return value ? `−${value}` : null;
}

/**
 * Название без хвоста, повторяющего скидку.
 *
 * Акции заводят в Renovatio руками и часто дублируют размер скидки в скобках:
 * «Персональная скидка в размере 20% (20%)». Рядом со значением справа это
 * читается как опечатка интерфейса, хотя пришло из МИС.
 */
function cleanTitle(promo) {
  const value = discountLabel(promo);
  const title = (promo.title || '').trim();
  if (!value) return title;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return title.replace(new RegExp(`\\s*\\(\\s*${escaped}\\s*\\)\\s*$`, 'i'), '').trim() || title;
}

/** Время внутри дня МИС отдаёт с секундами — они здесь только мешают. */
function trimTime(value) {
  return value ? String(value).slice(0, 5) : null;
}

/**
 * Подробное описание приходит из МИС как HTML: там и &quot;, и <br />. Выводить
 * его разметкой значило бы вставлять в портал чужой HTML, поэтому разворачиваем
 * в текст.
 */
function htmlToText(html) {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n');
  return (el.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Цена со скидкой — по тому же правилу, по какому её считает МИС. */
function discounted(price, promo) {
  if (price == null || Number.isNaN(price)) return null;
  if (promo.discount != null) return Math.round(price * (1 - promo.discount / 100));
  if (promo.absDiscount != null) return Math.max(0, price - promo.absDiscount);
  return null;
}

function conditionsOf(promo) {
  const timeFrom = trimTime(promo.timeFrom);
  const timeTo = trimTime(promo.timeTo);
  // Условия — парами «иконка и текст»: иконку часов раньше вешали по номеру в
  // массиве, и у акции без дней недели время оставалось без неё.
  return [
    timeFrom || timeTo
      ? { icon: Clock, text: `${timeFrom || '00:00'}—${timeTo || '23:59'}` }
      : null
  ].filter(Boolean);
}

/**
 * Неделя семью клетками. Рисуется всегда, даже когда ограничения нет: акция без
 * дней — это акция на все семь, и «пусто» в этом месте читалось бы как «данные
 * не пришли». Пустой список в МИС как раз и означает все дни.
 *
 * Подписи внутри клеток оставлены: без них первые буквы дней неразличимы
 * (пн и пт, ср и сб), а порядок пришлось бы держать в голове.
 */
function WeekDays({ days }) {
  const all = !days.length || days.length === 7;
  const title = all
    ? 'Действует все дни недели'
    : `Действует: ${days.map(d => WEEK_DAY_NAMES[d - 1]).join(', ')}`;
  return (
    <span className="mk-week" title={title}>
      {WEEK_DAY_NAMES.map((name, i) => (
        <i key={name} className={all || days.includes(i + 1) ? 'on' : ''}>{name}</i>
      ))}
    </span>
  );
}

/**
 * Возраст короткой меткой к названию: «0–18», «65+».
 *
 * Отдельной строкой условий он занимал место наравне с днями и временем, хотя
 * отвечает на другой вопрос — кому акция вообще положена. Рядом с названием он
 * читается как уточнение к нему, а не как ещё одно ограничение.
 */
function ageLabel(promo) {
  const { ageFrom: from, ageTo: to } = promo;
  if (from == null && to == null) return null;
  if (to != null) return `${from ?? 0}–${to}`;
  return `${from}+`;
}

/* Символы пола рисуем сами: в lucide 0.303 Mars и Venus ещё нет, а подбирать
   вместо них человечка значит показывать не пол, а «кого-то». */
function MaleMark(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="10" cy="14" r="5" />
      <path d="M14 10l6-6M15 4h5v5" />
    </svg>
  );
}

function FemaleMark(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="9" r="5" />
      <path d="M12 14v7M9 18h6" />
    </svg>
  );
}

/**
 * Пол, для которого действует акция: 1 — мужской, 2 — женский (кодировка МИС,
 * см. PromoForm). Оба знака рисуются всегда: отсутствие ограничения — тоже
 * сведение, и пустое место на его месте читалось бы как «не загрузилось».
 */
function GenderMarks({ gender }) {
  const male = gender == null || gender === 1;
  const female = gender == null || gender === 2;
  const title = gender == null ? 'Без ограничения по полу' : gender === 1 ? 'Только мужчины' : 'Только женщины';
  return (
    <span className="mk-promo-gender" title={title}>
      <MaleMark className={male ? 'on' : ''} width="18" height="18" />
      <FemaleMark className={female ? 'on' : ''} width="18" height="18" />
    </span>
  );
}

/* ── Окно акции ──────────────────────────────────────────────────────────── */

function PromoDetails({ promo, onClose }) {
  const [services, setServices] = useState(null);
  const text = useMemo(() => htmlToText(promo.desc || promo.shortDesc), [promo.desc, promo.shortDesc]);
  const value = discountDisplay(promo);
  const conditions = conditionsOf(promo);

  // Цены запрашиваются с clinic_id акции: у филиалов прейскуранты разные, и
  // цена чужой клиники здесь хуже, чем никакой.
  useEffect(() => {
    if (!promo.services.length) { setServices([]); return; }
    let alive = true;
    misApi.getServicesByIds(promo.services, promo.clinicId || undefined)
      .then(({ data }) => { if (alive) setServices(Array.isArray(data?.data) ? data.data : []); })
      .catch(() => { if (alive) setServices([]); });
    return () => { alive = false; };
  }, [promo.services, promo.clinicId]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mk-modal-overlay" onClick={onClose}>
      {/* Тон филиала передаётся и окну: оно открывается из полки, и цена со
          скидкой в нём подсвечена тем же цветом, что и карточка. */}
      <div
        className="mk-modal mk-promo-modal"
        style={{ '--mk-tone': promo.medCenterColor || 'var(--accent-500)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mk-modal-head">
          <h3>
            {cleanTitle(promo)}
            {ageLabel(promo) && <span className="mk-promo-age">({ageLabel(promo)})</span>}
          </h3>
          <button className="ola-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="mk-modal-body">
          <div className="mk-promo-facts">
            <div><dt>Срок</dt><dd>{periodLabel(promo)}</dd></div>
            {value && <div><dt>Скидка</dt><dd>{value}</dd></div>}
            <div><dt>Где действует</dt><dd>{promo.medCenterName || 'Вся сеть'}</dd></div>
            <div><dt>Дни недели</dt><dd><WeekDays days={promo.weekDays} /></dd></div>
            {conditions.length > 0 && (
              <div><dt>Время</dt><dd>{conditions.map(c => c.text).join(' · ')}</dd></div>
            )}
            <div>
              <dt>Кому</dt>
              <dd>{promo.gender == null ? 'Любой пол' : promo.gender === 1 ? 'Мужчины' : 'Женщины'}</dd>
            </div>
          </div>

          {text && <p className="mk-promo-text">{text}</p>}

          {promo.services.length > 0 && (
            <div className="mk-services">
              <div className="mk-services-head">
                Услуги акции <span>{promo.services.length}</span>
              </div>

              {services === null && (
                <div className="mk-loading"><Loader2 size={18} className="mk-spin" /> Загружаем цены из МИС…</div>
              )}

              {services !== null && !services.length && (
                <p className="mk-muted">Названия услуг не удалось получить из МИС</p>
              )}

              {services !== null && services.length > 0 && (
                <div className="mk-services-scroll">
                  <table className="mk-services-table">
                    <thead>
                      <tr>
                        <th>Код</th>
                        <th>Услуга</th>
                        <th className="num">Цена</th>
                        <th className="num">Со скидкой</th>
                      </tr>
                    </thead>
                    <tbody>
                      {services.map(s => {
                        const price = s.price == null || s.price === '' ? null : Number(s.price);
                        const final = discounted(price, promo);
                        return (
                          <tr key={s.service_id || s.id || s.code}>
                            {/* Артикул в справочниках МИС зовётся по-разному,
                                поэтому берём первый непустой. */}
                            <td className="code">{s.code || s.sub_code || s.service_id || s.id || '—'}</td>
                            <td>{s.title}</td>
                            <td className="num">{price != null ? fmtMoney(price) : '—'}</td>
                            <td className="num final">{final != null ? fmtMoney(final) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mk-modal-foot">
          {promo.link && (
            <a className="ola-btn" href={promo.link} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> Страница на сайте
            </a>
          )}
          <div className="mk-foot-right">
            <button className="ola-btn" onClick={onClose}>Закрыть</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Карточка ────────────────────────────────────────────────────────────── */

function PromoCard({ promo, onOpen }) {
  const value = discountDisplay(promo);
  const dated = !!(promo.dateFrom || promo.dateTo);
  const conditions = conditionsOf(promo);
  const age = ageLabel(promo);

  return (
    <article
      className={`mk-promo ${promo.status}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      {/* Знак процента во всю высоту карточки, цветом филиала: он держит её
          левый край и отделяет карточку от соседней в полке. */}
      <span className="mk-promo-mark"><Percent size={26} /></span>

      <div className="mk-promo-body">
        <div className="mk-promo-headings">
          <h4>
            {cleanTitle(promo)}
            {age && <span className="mk-promo-age">({age})</span>}
            {promo.link && (
              <a
                className="mk-promo-link"
                href={promo.link}
                target="_blank"
                rel="noreferrer"
                title="Страница акции на сайте"
                onClick={e => e.stopPropagation()}
              >
                <ExternalLink size={13} />
              </a>
            )}
          </h4>
        </div>

        <div className="mk-promo-cond">
          <WeekDays days={promo.weekDays} />
          {conditions.map((c, i) => (
            <span key={i}>{c.icon ? <c.icon size={12} /> : null}{c.text}</span>
          ))}
        </div>

        {/* Срок стоит по нижнему краю: у карточек ряда он оказывается на одной
            линии, и взгляд идёт по датам, а не прыгает за высотой названий. */}
        <div className="mk-promo-period">
          {dated && <CalendarRange size={13} />}
          {periodLabel(promo)}
        </div>
      </div>

      <div className="mk-promo-right">
        {value && <span className="mk-promo-value">{value}</span>}
        <GenderMarks gender={promo.gender} />
      </div>
    </article>
  );
}

export default function PromotionsTab({ level }) {
  const canEdit = level === 'edit';
  const [promos, setPromos] = useState(null);
  const [query, setQuery] = useState('');
  // Действующие показываются первыми: просроченных почти половина списка, и все
  // они — прошлое, на которое маркетолог смотрит редко и намеренно.
  const [filter, setFilter] = useState('active');
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState(null);
  // Справочник филиалов нужен, чтобы сетевая акция попала и на полку клиники,
  // у которой своих акций нет вовсе: по одному только списку акций такой
  // филиал не из чего было бы завести.
  const [clinics, setClinics] = useState([]);

  const load = useCallback(async () => {
    try {
      const { data } = await marketing.getPromos();
      setPromos(data.promos || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось получить акции из МИС');
      setPromos([]);
    }
  }, []);

  useEffect(() => {
    marketing.getPromoClinics()
      .then(({ data }) => setClinics(Array.isArray(data) ? data : []))
      .catch(() => setClinics([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const acc = { all: (promos || []).length, active: 0, future: 0, expired: 0 };
    (promos || []).forEach(p => { acc[p.status] += 1; });
    return acc;
  }, [promos]);

  // Полки по медцентрам: акция всегда принадлежит одному филиалу либо всей
  // сети, и маркетолог думает именно филиалами.
  //
  // Отдельной полки «Вся сеть» больше нет. Сетевая акция (clinic_id = null в
  // МИС) действует в каждом филиале, и вынесенная наверх она отвечала на вопрос
  // «что есть в сети», тогда как смотрят сюда с вопросом «что сейчас у меня в
  // клинике» — и половину ответа приходилось искать в чужом разделе.
  const shelves = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = (promos || [])
      .filter(p => filter === 'all' || p.status === filter)
      .filter(p => !term || p.title.toLowerCase().includes(term));

    const network = list.filter(p => !p.clinicId);
    const byClinic = new Map();

    for (const c of clinics) {
      byClinic.set(String(c.clinicId), { key: String(c.clinicId), name: c.name, color: c.color, logo: c.logo, items: [] });
    }

    for (const promo of list) {
      if (!promo.clinicId) continue;
      const key = String(promo.clinicId);
      if (!byClinic.has(key)) {
        // Филиала нет в справочнике портала — показываем как есть, а не прячем
        // акцию: в МИС клиники заводят раньше, чем у нас.
        byClinic.set(key, {
          key,
          name: promo.medCenterName || `Клиника №${key}`,
          color: promo.medCenterColor,
          logo: promo.medCenterLogo,
          items: []
        });
      }
      byClinic.get(key).items.push(promo);
    }

    for (const shelf of byClinic.values()) shelf.items.push(...network);

    // Справочник не ответил, а все акции сетевые — иначе экран остался бы пуст.
    if (!byClinic.size && network.length) {
      byClinic.set('all', { key: 'all', name: 'Вся сеть', color: null, logo: null, items: network });
    }

    const shelves = [...byClinic.values()].filter(shelf => shelf.items.length);

    // Внутри полки сначала срочные, потом бессрочные. Бессрочная акция — это
    // фон, который не меняется годами (скидки инвалидам, сотрудникам), и держать
    // её над той, что заканчивается через неделю, значит прятать единственное,
    // за чем сюда заходят следить.
    for (const shelf of shelves) {
      shelf.items.sort((a, b) => {
        const aDated = !!(a.dateFrom || a.dateTo);
        const bDated = !!(b.dateFrom || b.dateTo);
        if (aDated !== bDated) return aDated ? -1 : 1;
        if (aDated && a.dateTo !== b.dateTo) return (a.dateTo || '9999-12-31').localeCompare(b.dateTo || '9999-12-31');
        return a.title.localeCompare(b.title, 'ru');
      });
    }

    return shelves.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [promos, clinics, filter, query]);

  return (
    <section className="mk-promos">
      <MarketingTools>
        <div className="ola-log-search mk-search">
          <Search size={15} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск по названию акции"
          />
          {query && <button className="ola-icon-btn" onClick={() => setQuery('')}><X size={14} /></button>}
        </div>

        {/* Отбор по сроку — одним списком. Развёрнутые деления занимали половину
            строки ради выбора, который делают раз за сессию. */}
        <select
          className="ola-select mk-filter"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          aria-label="Отбор по сроку акции"
        >
          {FILTERS.map(f => (
            <option key={f.key} value={f.key}>{f.label} ({counts[f.key]})</option>
          ))}
        </select>

        {canEdit && (
          <button className="ola-btn primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> Акция
          </button>
        )}
      </MarketingTools>

      {promos === null && <div className="mk-loading"><Loader2 size={18} className="mk-spin" /> Загружаем акции из МИС…</div>}

      {promos !== null && !shelves.length && (
        <div className="ola-empty">
          <Tag size={30} />
          <h3>Акций не найдено</h3>
          <p>{promos.length ? 'Попробуйте изменить отбор или поисковый запрос.' : 'В МИС нет ни одной акции.'}</p>
        </div>
      )}

      {shelves.map(shelf => (
        <div className="mk-shelf" key={shelf.key} style={{ '--mk-tone': shelf.color || 'var(--accent-500)' }}>
          <header>
            {shelf.logo
              ? <img className="mk-shelf-logo" src={shelf.logo} alt="" />
              : <span className="mk-shelf-logo letter">{shelf.name.charAt(0)}</span>}
            <h3>{shelf.name}</h3>
          </header>
          <div className="mk-shelf-body">
            {shelf.items.map(promo => (
              <PromoCard key={`${shelf.key}-${promo.id}`} promo={promo} onOpen={() => setOpened(promo)} />
            ))}
          </div>
        </div>
      ))}

      {opened && <PromoDetails promo={opened} onClose={() => setOpened(null)} />}

      {creating && (
        <PromoForm
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}
    </section>
  );
}
