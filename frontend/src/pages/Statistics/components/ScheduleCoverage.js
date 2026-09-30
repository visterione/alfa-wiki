import { useState, useEffect, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { scheduleCoverage } from '../../../services/api';
import SearchableSelect from '../../ReferralBonuses/components/SearchableSelect';
import {
  LS_PROFESSION, DEFAULT_PROFESSION_NAME, WD_SHORT, isoLocal, wdOf, isWeekend, dayNum, dateLong,
  range, hours, shortName, plural, describeFinding,
} from './scheduleCoverageText';

// Статистика → Аналитика → Расписания (ver. 9.17): где по направлению не
// принимает ни один врач. Считает бэкенд (services/scheduleCoverage.js), здесь
// только показ: календарь «день × медцентр» слева, расписание выбранного дня
// справа и находки списком под ними.
//
// Вопрос, на который страница отвечает: «если сейчас придёт срочный пациент к
// гинекологу — примем ли мы его?». Поэтому главная единица — не врач, а
// медцентр в конкретный час, и отдельным столбцом «Сеть»: пациента можно
// направить в соседний филиал, и хуже всего день, когда закрыто везде.
//
// Порог дыры и часы проверки не настраиваются: заказчик убрал оба
// переключателя. Считаем от часа, в часы работы медцентров — короче часа это
// обеды и пересменки, а своё окно лишь подменяло бы вопрос «когда мы открыты».

const MAX_DAYS = 92;
const MIN_GAP = 60;

const logoSrc = (path) => (path ? (process.env.PUBLIC_URL || '') + path : null);

// Штриховка — «из-за отмены»: тот же цвет статуса, но видно, что дыру сделал
// не график, а отпуск или отгул. Цвет полос — от фона, чтобы жить в обеих темах.
const HATCH = 'repeating-linear-gradient(135deg, rgba(255,255,255,0.35) 0 3px, transparent 3px 7px)';

const STATUS = {
  none:      { bg: 'var(--red-500)',   fg: '#fff',                     label: 'Никого весь день' },
  gap:       { bg: 'var(--amber-200)', fg: 'var(--amber-800)',         label: 'Есть часы без врача' },
  single:    { bg: 'var(--green-100)', fg: 'var(--green-800)',         label: 'Покрыто одним врачом' },
  ok:        { bg: 'var(--green-200)', fg: 'var(--green-800)',         label: 'Покрыто' },
  closed:    { bg: 'var(--n-100)',     fg: 'var(--rb-text-secondary)', label: 'Медцентр закрыт' },
  unplanned: { bg: 'transparent',      fg: 'var(--rb-text-secondary)', label: 'График не заведён' },
};
const statusOf = (c) => (c.status === 'ok' && c.single ? 'single' : c.status);
const hasCancelGap = (c) => (c.gaps || []).some(g => g.cause === 'cancel');
const isClickable = (c) => c.status !== 'closed' && c.status !== 'unplanned';

// Инлайн-стилями медиазапрос не написать: на узком экране колонки встают друг
// под друга, и правую уже не к чему равнять по высоте — она растёт сама.
const LAYOUT_CSS = `
  .sc-layout { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 16px; align-items: stretch; }
  .sc-side { position: relative; min-height: 560px; }
  .sc-side-inner { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 16px; }
  @media (max-width: 900px) {
    .sc-layout { grid-template-columns: minmax(0, 1fr); }
    .sc-side { min-height: 0; }
    .sc-side-inner { position: static; }
  }
`;

const panelStyle = { background: 'var(--n-0)', border: '1px solid var(--rb-border)', borderRadius: 12, padding: 16 };
const mutedStyle = { color: 'var(--rb-text-secondary)' };
const iconBtn = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, border: '1px solid var(--rb-border-dark)', borderRadius: 7, background: 'var(--n-0)', cursor: 'pointer', color: 'var(--rb-text-secondary)', flexShrink: 0, padding: 0 };

export default function ScheduleCoverage({ periodStart, periodEnd }) {
  const [professions, setProfessions] = useState([]);
  const [professionId, setProfessionId] = useState(() => {
    try { return localStorage.getItem(LS_PROFESSION) || ''; } catch { return ''; }
  });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState(null); // { clinic, date }

  const from = periodStart ? isoLocal(periodStart) : '';
  const to = periodEnd ? isoLocal(periodEnd) : '';
  const days = from && to ? Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000) + 1 : 0;
  const tooLong = days > MAX_DAYS;

  useEffect(() => {
    scheduleCoverage.professions()
      .then(res => {
        const list = res.data?.professions || [];
        setProfessions(list);
        setProfessionId(prev => {
          if (prev && list.some(p => p.id === prev)) return prev;
          return (list.find(p => p.name === DEFAULT_PROFESSION_NAME) || list[0])?.id || '';
        });
      })
      .catch(err => setError(err.response?.data?.error || 'Не удалось получить специальности из МИС'));
  }, []);

  useEffect(() => {
    if (!professionId) return;
    try { localStorage.setItem(LS_PROFESSION, professionId); } catch { /* приватное окно */ }
  }, [professionId]);

  useEffect(() => {
    if (!from || !to || tooLong || !professionId) return;
    let alive = true;
    setLoading(true);
    setError('');
    scheduleCoverage.report({ from, to, professionId, minGap: MIN_GAP })
      .then(res => { if (alive) setReport(res.data); })
      .catch(err => {
        if (!alive) return;
        setReport(null);
        setError(err.response?.data?.error || 'Не удалось построить отчёт');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [from, to, professionId, tooLong, reloadKey]);

  // Правая панель не должна стоять пустой: пока день не выбран, открываем
  // первую находку — это и есть то место, куда человек посмотрел бы первым.
  // Выбор переживает перезагрузку отчёта (исключили врача — день остался тем
  // же), но не смену периода, где его даты может просто не быть.
  useEffect(() => {
    if (!report) return;
    setSelected(prev => {
      if (prev && report.days.includes(prev.date) && (prev.clinic === 'all' || report.cells[prev.clinic])) return prev;
      const f = report.findings[0];
      return f ? { clinic: f.clinic, date: f.dates[0] } : { clinic: 'all', date: report.days[0] };
    });
  }, [report]);

  const toggleExcluded = async (doctorId) => {
    const next = report.doctors.filter(d => (d.id === doctorId ? !d.excluded : d.excluded)).map(d => d.id);
    try {
      await scheduleCoverage.setExclusions(professionId, next);
      setReloadKey(k => k + 1);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить состав группы');
    }
  };

  if (tooLong) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', ...mutedStyle, fontSize: 14 }}>
        Период {days} дней — расписание проверяется не больше чем за {MAX_DAYS} дня.<br />
        Выберите месяц или квартал.
      </div>
    );
  }

  const professionOptions = professions.map(p => ({ value: p.id, label: p.name }));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <SearchableSelect value={professionId} onChange={setProfessionId} options={professionOptions} style={{ width: 320, position: 'relative' }} />
        {report && <GroupMenu report={report} onToggle={toggleExcluded} />}
        {report && !error && <Notices report={report} to={to} />}
        <button onClick={() => setReloadKey(k => k + 1)} disabled={loading} title="Забрать расписание из МИС заново"
          style={{ ...iconBtn, marginLeft: 'auto', cursor: loading ? 'default' : 'pointer' }}>
          {loading
            ? <span className="rb-spinner" style={{ width: 13, height: 13 }} />
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-4.5" /></svg>}
        </button>
      </div>

      {loading && !report && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '70px 0', gap: 12, ...mutedStyle }}>
          <span className="rb-spinner" style={{ width: 22, height: 22 }} />
          <span style={{ fontSize: 14 }}>Забираю расписание из МИС…</span>
        </div>
      )}

      {!loading && error && (
        <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--red-500)', fontSize: 13 }}>{error}</div>
      )}

      {report && !error && (
        <div style={{ display: 'grid', gap: 16, opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          {report.clinics.length === 0 ? (
            <div style={{ ...panelStyle, textAlign: 'center', ...mutedStyle, fontSize: 14, padding: 40 }}>
              У врачей этой специальности нет ни одной смены за период
            </div>
          ) : (
            // Правая колонка по высоте равна календарю: её содержимое лежит
            // абсолютно и в высоту строки сетки не вмешивается, а длинные списки
            // врачей и находок прокручиваются внутри своих секций. Так низ
            // находок и последний день месяца заканчиваются на одной линии.
            <div className="sc-layout">
              <style>{LAYOUT_CSS}</style>
              <CalendarGrid report={report} selected={selected} onSelect={(clinic, date) => setSelected({ clinic, date })} />
              <div className="sc-side">
                <div className="sc-side-inner">
                  {selected && (
                    <DayDetail report={report} clinic={selected.clinic} date={selected.date}
                      onDate={(date) => setSelected(s => ({ ...s, date }))} />
                  )}
                  <Findings report={report} onSelect={(clinic, date) => setSelected({ clinic, date })} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Состав группы ────────────────────────────────────────────────────────────

// Специальность в МИС стоит не только у врачей: «КТГ Дневной стационар» — это
// кабинет, заведённый пользователем, а у совместителя направление может быть
// второй специальностью без права вести приём. Такие «врачи» закрывают дыры,
// которых на деле никто не закрывает, поэтому их можно исключить. Выбор общий
// для всех, кто смотрит отчёт, и хранится на сервере.
function GroupMenu({ report, onToggle }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const withShifts = report.doctors.filter(d => d.shifts > 0);
  const without = report.doctors.filter(d => d.shifts === 0);
  const excluded = report.doctors.filter(d => d.excluded).length;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="Состав группы"
        style={{ ...iconBtn, position: 'relative', color: open ? 'var(--rb-primary)' : iconBtn.color, borderColor: open ? 'var(--rb-primary)' : 'var(--rb-border-dark)' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        {/* Точка — напоминание, что часть группы исключена и цифры это учитывают */}
        {excluded > 0 && <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: 3, background: 'var(--amber-500)' }} />}
      </button>
      {open && (
        <div className="rb-ss-dropdown" style={{ right: 'auto', width: 380, maxHeight: 460, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--rb-border)', background: 'var(--n-50)' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Состав группы</div>
            <div style={{ fontSize: 12, ...mutedStyle, marginTop: 2 }}>
              {withShifts.length} со сменами{without.length ? `, ${without.length} без смен` : ''}{excluded ? ` · исключено ${excluded}` : ''}.
              {' '}Снимите галочку у тех, кто не ведёт приём: служебные записи, кабинеты, совместители.
            </div>
          </div>
          <div style={{ overflowY: 'auto', padding: '4px 0' }}>
            {[...withShifts, ...without].map(d => (
              <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 12px', cursor: 'pointer', opacity: d.shifts ? 1 : 0.55 }}>
                <input type="checkbox" checked={!d.excluded} onChange={() => onToggle(d.id)} />
                <span style={{ textDecoration: d.excluded ? 'line-through' : 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.name}>{d.name}</span>
                <span style={{ fontSize: 11, ...mutedStyle, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  {d.secondary && 'доп. · '}{d.shifts ? `${d.shifts} ${plural(d.shifts, 'смена', 'смены', 'смен')}` : 'нет смен'}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Оговорки, без которых цифры читаются неверно
function Notices({ report, to }) {
  const notes = [];
  if (!report.horizon) {
    notes.push('На этот период у врачей специальности нет ни одной смены — похоже, график ещё не составлен.');
  } else if (report.horizon < to) {
    notes.push(`Смены заведены по ${dateLong(report.horizon)}. Дальше дни не проверяются — отмечены пунктиром.`);
  }
  const fallback = report.clinics.filter(c => c.hoursSource === 'fallback').map(c => c.name);
  if (fallback.length) {
    notes.push(`Часы работы ${fallback.join(', ')} не заполнены в карточке медцентра — взяты типовые. Точнее будет, если заполнить их в справочнике медцентров.`);
  }
  if (!notes.length) return null;
  // Живёт в строке выбора специальности, а не отдельной плашкой над отчётом:
  // оговорка нужна, но не должна отодвигать сам отчёт вниз
  return (
    <div style={{ flex: '1 1 auto', minWidth: 0, minHeight: 32, padding: '6px 12px', border: '1px solid var(--amber-200)', background: 'var(--amber-50)', borderRadius: 7, fontSize: 12, lineHeight: 1.35, color: 'var(--amber-800)', display: 'grid', alignContent: 'center', gap: 2 }}>
      {notes.map((n, i) => <div key={i}>{n}</div>)}
    </div>
  );
}

// ── Календарь ────────────────────────────────────────────────────────────────

function ClinicLogo({ clinic, size = 24 }) {
  const src = logoSrc(clinic.logo);
  if (!src) {
    return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: 6, background: clinic.color }} />;
  }
  return <img src={src} alt={clinic.name} style={{ width: size, height: size, borderRadius: 6, objectFit: 'contain', background: '#fff', display: 'block' }} />;
}

// Сеть — не медцентр, логотипа у неё нет; знак «несколько точек на карте»
function NetworkMark({ size = 24 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: 6, background: 'var(--n-100)', color: 'var(--rb-text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="19" r="2.5" /><circle cx="19" cy="19" r="2.5" /><path d="M12 7.5v4M12 11.5l-5.5 5.5M12 11.5l5.5 5.5" /></svg>
    </span>
  );
}

// Дни идут сверху вниз, медцентры — столбцами. Так календарь узкий и рядом
// помещается расписание выбранного дня: смотреть их приходится вместе.
function CalendarGrid({ report, selected, onSelect }) {
  const cols = [
    { key: 'all', name: 'Вся сеть', data: report.network },
    ...report.clinics.map(c => ({ key: c.key, name: c.name, clinic: c, data: report.cells[c.key] })),
  ];
  const CELL_W = 36, CELL_H = 26;

  return (
    <div style={{ ...panelStyle, minWidth: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 3, fontSize: 12 }}>
          <thead>
            <tr>
              <th />
              {cols.map(col => (
                <th key={col.key} title={col.name} style={{ width: CELL_W, paddingBottom: 4 }}>
                  <span style={{ display: 'inline-flex' }}>
                    {col.clinic ? <ClinicLogo clinic={col.clinic} /> : <NetworkMark />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.days.map(d => (
              <tr key={d}>
                <td style={{ paddingRight: 8, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: isWeekend(d) ? 'var(--red-500)' : 'var(--rb-text)' }}>
                  <span style={{ display: 'inline-block', width: 18, textAlign: 'right', fontWeight: 600 }}>{dayNum(d)}</span>
                  <span style={{ marginLeft: 6, fontSize: 11, color: isWeekend(d) ? 'var(--red-500)' : 'var(--rb-text-secondary)' }}>{WD_SHORT[wdOf(d)]}</span>
                </td>
                {cols.map(col => {
                  const c = col.data[d];
                  const st = STATUS[statusOf(c)];
                  const isSel = selected && selected.clinic === col.key && selected.date === d;
                  const clickable = isClickable(c);
                  return (
                    <td key={col.key}>
                      <button
                        onClick={() => clickable && onSelect(col.key, d)}
                        title={cellTitle(col.name, d, c)}
                        style={{
                          width: CELL_W, height: CELL_H, border: c.status === 'unplanned' ? '1px dashed var(--rb-border-dark)' : 'none',
                          borderRadius: 6, padding: 0, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, display: 'block',
                          fontVariantNumeric: 'tabular-nums', cursor: clickable ? 'pointer' : 'default',
                          background: hasCancelGap(c) ? `${HATCH}, ${st.bg}` : st.bg, color: st.fg,
                          outline: isSel ? '2px solid var(--rb-primary)' : 'none', outlineOffset: 1,
                        }}
                      >
                        {c.status === 'closed' ? '–' : c.status === 'unplanned' ? '' : c.doctors}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Legend />
    </div>
  );
}

function cellTitle(name, date, c) {
  const head = `${name} · ${dateLong(date)}`;
  if (c.status === 'closed') return `${head}\nМедцентр закрыт`;
  if (c.status === 'unplanned') return `${head}\nГрафик ещё не заведён`;
  const lines = [head, `Врачей: ${c.doctors}`];
  for (const g of c.gaps || []) lines.push(`Без врача ${range(g.from, g.to)}${g.cause === 'cancel' ? ' — из-за отмены' : ''}`);
  if (c.single) lines.push('Весь день держится на одном враче');
  return lines.join('\n');
}

function Legend() {
  const item = (bg, label, extra = {}) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, background: bg, flexShrink: 0, ...extra }} />{label}
    </span>
  );
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 12, fontSize: 11, ...mutedStyle }}>
      {['none', 'gap', 'single', 'ok', 'closed'].map(k => <span key={k}>{item(STATUS[k].bg, STATUS[k].label)}</span>)}
      {item(`${HATCH}, var(--amber-200)`, 'Из-за отмены')}
      {item('transparent', STATUS.unplanned.label, { border: '1px dashed var(--rb-border-dark)' })}
    </div>
  );
}

// ── Расписание дня ───────────────────────────────────────────────────────────

function DayDetail({ report, clinic, date, onDate }) {
  const isNet = clinic === 'all';
  const cell = isNet ? report.network[date] : report.cells[clinic][date];
  const clinicInfo = report.clinics.find(c => c.key === clinic);

  // Соседний день, который вообще есть смысл открыть: выходные медцентра и дни
  // без графика стрелки перескакивают, иначе листать пришлось бы по пустым
  const data = isNet ? report.network : report.cells[clinic];
  const idx = report.days.indexOf(date);
  const step = (dir) => {
    for (let i = idx + dir; i >= 0 && i < report.days.length; i += dir) {
      if (isClickable(data[report.days[i]])) return report.days[i];
    }
    return null;
  };
  const prev = step(-1);
  const next = step(1);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowLeft' && prev) onDate(prev);
      if (e.key === 'ArrowRight' && next) onDate(next);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [prev, next, onDate]);

  const lanes = useMemo(() => {
    const doctors = Object.fromEntries(report.doctors.map(d => [d.id, d]));
    const byUser = new Map();
    for (const c of isNet ? report.clinics : [clinicInfo]) {
      for (const l of report.lanes[c.key]?.[date] || []) {
        if (doctors[l.userId]?.excluded) continue;
        // В сети врач, работавший в двух филиалах за день, — одна строка
        const prevLane = byUser.get(l.userId);
        if (prevLane) {
          prevLane.work = [...prevLane.work, ...l.work];
          prevLane.cancel = [...prevLane.cancel, ...l.cancel];
        } else {
          byUser.set(l.userId, { userId: l.userId, work: [...l.work], cancel: [...l.cancel], name: doctors[l.userId]?.name || `#${l.userId}` });
        }
      }
    }
    return [...byUser.values()].sort((a, b) => (Math.min(...a.work.map(w => w[0])) || 0) - (Math.min(...b.work.map(w => w[0])) || 0));
  }, [report, date, isNet, clinicInfo]);

  const win = cell.window || { from: 8 * 60, to: 20 * 60 };
  let lo = win.from, hi = win.to;
  for (const l of lanes) for (const [s, e] of l.work) { lo = Math.min(lo, s); hi = Math.max(hi, e); }
  lo = Math.floor(lo / 60) * 60;
  hi = Math.ceil(hi / 60) * 60;
  const pct = (m) => `${((m - lo) / (hi - lo)) * 100}%`;
  const width = (s, e) => `${((e - s) / (hi - lo)) * 100}%`;
  const ticks = [];
  for (let h = lo; h <= hi; h += 60) ticks.push(h);
  const tickStep = hi - lo > 14 * 60 ? 2 : 1;

  const LABEL_W = 170;
  const track = { position: 'relative', height: 22, flex: 1, borderRadius: 5, background: 'var(--n-50)' };
  const arrow = (target, dir) => (
    <button onClick={() => target && onDate(target)} disabled={!target}
      title={target ? dateLong(target) : ''}
      style={{ ...iconBtn, width: 28, height: 28, cursor: target ? 'pointer' : 'default', opacity: target ? 1 : 0.35 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {dir < 0 ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
      </svg>
    </button>
  );

  return (
    <div style={{ ...panelStyle, flex: '0 1 auto', minHeight: 200, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        {isNet ? <NetworkMark size={28} /> : <ClinicLogo clinic={clinicInfo} size={28} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{dateLong(date)}</div>
          <div style={{ fontSize: 12, ...mutedStyle }}>{isNet ? 'Вся сеть' : clinicInfo?.name}</div>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {arrow(prev, -1)}
          {arrow(next, 1)}
        </span>
      </div>

      {/* Прокрутка только вертикальная. Шкалы тянутся в процентах и по ширине
          помещаются всегда, а горизонтальная полоса возникала от пары пикселей:
          появлялась вертикальная полоса прокрутки, отъедала ширину, и
          минимальная ширина содержимого переставала влезать. */}
      <div style={{ overflowX: 'hidden', overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          {/* Шкала */}
          <div style={{ display: 'flex' }}>
            <div style={{ width: LABEL_W, flexShrink: 0 }} />
            <div style={{ position: 'relative', flex: 1, height: 16 }}>
              {ticks.map((t, i) => ((i % tickStep === 0 && hi - t >= 60 * tickStep) || t === hi) && (
                <span key={t} style={{ position: 'absolute', left: pct(t), transform: t === hi ? 'translateX(-100%)' : t === lo ? 'none' : 'translateX(-50%)', fontSize: 10, ...mutedStyle }}>{Math.floor(t / 60)}</span>
              ))}
            </div>
          </div>

          {/* Итог: где никого */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: LABEL_W, flexShrink: 0, fontSize: 12, fontWeight: 600 }}>Без врача</div>
            <div style={track}>
              <div style={{ position: 'absolute', left: pct(win.from), width: width(win.from, win.to), top: 0, bottom: 0, background: 'var(--green-100)', borderRadius: 5 }} />
              {(cell.gaps || []).map((g, i) => (
                <div key={i} title={`${range(g.from, g.to)}${g.cause === 'cancel' ? ' — из-за отмены' : ''}`}
                  style={{ position: 'absolute', left: pct(g.from), width: width(g.from, g.to), top: 0, bottom: 0, borderRadius: 5, background: g.cause === 'cancel' ? `${HATCH}, var(--red-500)` : 'var(--red-500)', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {range(g.from, g.to)}
                </div>
              ))}
              {!(cell.gaps || []).length && <span style={{ position: 'absolute', left: 8, top: 3, fontSize: 11, color: 'var(--green-800)' }}>все часы работы покрыты</span>}
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--rb-border)', margin: '4px 0' }} />

          {lanes.length === 0 && <div style={{ fontSize: 13, ...mutedStyle, padding: '6px 0' }}>В графике на этот день никого нет</div>}
          {lanes.map(l => (
            <div key={l.userId} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: LABEL_W, flexShrink: 0, fontSize: 12, paddingRight: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.name}>
                {shortName(l.name)}
              </div>
              <div style={track}>
                <div style={{ position: 'absolute', left: pct(win.from), width: width(win.from, win.to), top: 0, bottom: 0, border: '1px dashed var(--rb-border)', borderRadius: 5 }} />
                {l.work.map(([s, e], j) => (
                  <div key={j} title={`Смена ${range(s, e)}`}
                    style={{ position: 'absolute', left: pct(s), width: width(s, e), top: 3, bottom: 3, borderRadius: 4, background: 'var(--rb-primary)', opacity: 0.85 }} />
                ))}
                {l.cancel.map(([s, e], j) => (
                  <div key={`c${j}`} title={`Отмена ${range(s, e)}`}
                    style={{ position: 'absolute', left: pct(s), width: width(s, e), top: 3, bottom: 3, borderRadius: 4, background: `${HATCH}, var(--red-400)` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, ...mutedStyle, flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 14, height: 8, borderRadius: 3, background: 'var(--rb-primary)', marginRight: 6 }} />смена</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 8, borderRadius: 3, background: `${HATCH}, var(--red-400)`, marginRight: 6 }} />отмена поверх смены</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 8, borderRadius: 3, border: '1px dashed var(--rb-border-dark)', marginRight: 6 }} />часы работы</span>
      </div>
    </div>
  );
}

// ── Находки ──────────────────────────────────────────────────────────────────

function Findings({ report, onSelect }) {
  const names = useMemo(() => Object.fromEntries(report.doctors.map(d => [d.id, d.name])), [report]);
  // null — все находки, вместе с находками по сети в целом; иначе ключ медцентра
  const [only, setOnly] = useState(null);
  useEffect(() => {
    if (only && !report.clinics.some(c => c.key === only)) setOnly(null);
  }, [report, only]);
  const list = only ? report.findings.filter(f => f.clinic === only) : report.findings;
  const who = (ids) => ids.map(id => shortName(names[id] || `#${id}`)).join(', ');

  return (
    <div style={{ ...panelStyle, flex: '1 1 0', minHeight: 220, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Рекомендации</div>
        <ClinicFilter report={report} value={only} onChange={setOnly} />
      </div>
      {list.length === 0 && only && (
        <div style={{ padding: '18px 0', fontSize: 13, color: 'var(--green-700)' }}>
          По {report.clinics.find(c => c.key === only)?.name} замечаний нет.
        </div>
      )}
      {report.findings.length === 0 && (
        <div style={{ padding: '18px 0', fontSize: 13, color: 'var(--green-700)' }}>
          Направление покрыто во все часы работы — дыр длиннее {hours(report.minGap)} нет.
        </div>
      )}
      <div style={{ display: 'grid', alignContent: 'start', overflowY: 'auto', flex: '1 1 auto', minHeight: 0, marginRight: -8, paddingRight: 8 }}>
        {list.map((f, i) => {
          const { title, detail } = describeFinding(f, who);
          const tone = f.severity >= 3 ? 'var(--red-500)' : f.severity === 2 ? 'var(--amber-500)' : 'var(--rb-border-dark)';
          return (
            <button key={i} onClick={() => onSelect(f.clinic, f.dates[0])}
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', border: 'none', borderTop: i ? '1px solid var(--rb-border)' : 'none', background: 'none', padding: '10px 0', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' }}>
              <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: tone, flexShrink: 0 }} />
              {/* При отборе по медцентру его название в каждой строке — повтор */}
              {!only && <span style={{ minWidth: 110, fontSize: 13, fontWeight: f.clinic === 'all' ? 700 : 600, flexShrink: 0 }}>{f.clinicName}</span>}
              <span style={{ display: 'grid', gap: 2 }}>
                <span style={{ fontSize: 13 }}>{title}</span>
                {detail && <span style={{ fontSize: 12, ...mutedStyle }}>{detail}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


// Какой медцентр смотреть в находках — выпадающим списком, чтобы шапка секции
// оставалась в одну строку. Логотипы те же, что над столбцами календаря.
//
// Отдельного пункта «Сеть» нет: находки по сети в целом видны в «Все
// медцентры», а двумя пунктами подряд они читались как одно и то же.
function ClinicFilter({ report, value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const counts = {};
  for (const f of report.findings) counts[f.clinic] = (counts[f.clinic] || 0) + 1;
  const options = [
    { key: null, label: 'Все медцентры', mark: <NetworkMark size={18} />, n: report.findings.length },
    ...report.clinics.map(c => ({ key: c.key, label: c.name, mark: <ClinicLogo clinic={c} size={18} />, n: counts[c.key] || 0 })),
  ];
  const current = options.find(o => o.key === value) || options[0];

  return (
    <div ref={wrapRef} className={`rb-ss-wrap${open ? ' open' : ''}`} style={{ marginLeft: 'auto', position: 'relative', width: 200 }}>
      <button type="button" className="rb-ss-trigger has-value" onClick={() => setOpen(o => !o)} style={{ padding: '5px 10px' }}>
        {current.mark}
        <span className="rb-ss-value">{current.label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="rb-ss-dropdown" style={{ left: 'auto', right: 0, width: 240 }}>
          <div className="rb-ss-list">
            {options.map(o => (
              <div key={o.key ?? 'any'} className={`rb-ss-item${o.key === value ? ' selected' : ''}`}
                onClick={() => { onChange(o.key); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: o.n ? 1 : 0.5 }}>
                {o.mark}
                <span style={{ flex: 1 }}>{o.label}</span>
                <span style={{ fontSize: 11, ...mutedStyle, fontVariantNumeric: 'tabular-nums' }}>{o.n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
