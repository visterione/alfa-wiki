import { useState, useEffect, useMemo, useRef } from 'react';
import { AlertOctagon, AlertTriangle, Info, ChevronRight, Star, Pencil, Trash2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { scheduleCoverage } from '../../../services/api';
import {
  LS_PROFESSIONS, LS_EXCLUDED, LS_ANCHOR, readLs, writeLs, storedProfessions, excludedFor, WD_SHORT, isoLocal, wdOf, isWeekend, dayNum, dateLong,
  range, hours, shortName, describeFinding, describeElsewhere,
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
//
// Сводный режим (ver. 9.19): специальностей можно выбрать несколько, и тогда
// они считаются одной группой — так сравнивают смежные направления, между
// которыми пациента передают из рук в руки (флеболог → УЗИ). Тем же списком
// выбирают и отдельных врачей: вторым уровнем под специальностью.
//
// Ver. 9.20: эталон, свой медцентр прежде соседнего и шаблоны выбора.
// Эталон — специальность, чьи смены должны быть прикрыты остальными (флеболог
// и УЗИ: важно, чтобы УЗИ было, пока принимает флеболог, а не наоборот).
// Дыра в своём медцентре остаётся дырой, даже если соседний её закрывает, —
// пациенту туда ещё ехать; соседи только смягчают находку и видны логотипами.

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
  idle:      { bg: 'var(--n-100)',     fg: 'var(--rb-text-secondary)', label: 'Эталон не принимает' },
};
// С эталоном те же цвета говорят о другом: красное — эталон принимает, а
// смежных рядом нет ни часа
const ANCHOR_LABELS = { none: 'Эталон весь приём без смежных', gap: 'Есть часы эталона без смежных', single: 'Прикрыто одним врачом', ok: 'Прикрыто' };
const statusLabel = (report, key) => (report.mode === 'anchor' && ANCHOR_LABELS[key]) || STATUS[key].label;
const statusOf = (c) => (c.status === 'ok' && c.single ? 'single' : c.status);
const hasCancelGap = (c) => (c.gaps || []).some(g => g.cause === 'cancel');
const isClickable = (c) => c.status !== 'closed' && c.status !== 'unplanned' && c.status !== 'idle';

// С эталоном медцентр, где он за период ни разу не принимал, — пустой серый
// столбец: проверять там нечего. Соседние медцентры при этом остаются в
// отчёте — на них указывают находки («можно направить в Кидс»).
const visibleClinics = (report) => (report.mode !== 'anchor'
  ? report.clinics
  : report.clinics.filter(c => report.days.some(d => !['idle', 'unplanned'].includes(report.cells[c.key][d].status))));

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
  const [catalog, setCatalog] = useState(null); // { professions, clinics, savedExcluded }
  const [professionIds, setProfessionIds] = useState([]);
  const [ownExcluded, setOwnExcluded] = useState(() => readLs(LS_EXCLUDED, {}));
  const [anchor, setAnchor] = useState(() => readLs(LS_ANCHOR, '') || '');
  const [presets, setPresets] = useState([]);
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
        setCatalog({
          professions: list,
          clinics: Object.fromEntries((res.data?.clinics || []).map(c => [c.key, c])),
          savedExcluded: res.data?.savedExcluded || {},
        });
        setProfessionIds(storedProfessions(list));
      })
      .catch(err => setError(err.response?.data?.error || 'Не удалось получить специальности из МИС'));
  }, []);

  useEffect(() => {
    scheduleCoverage.presets().then(res => setPresets(res.data?.presets || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (professionIds.length) writeLs(LS_PROFESSIONS, professionIds);
  }, [professionIds]);
  useEffect(() => writeLs(LS_ANCHOR, anchor), [anchor]);

  // Эталон действует, только пока рядом есть кого с ним сравнивать
  const anchorId = anchor && professionIds.includes(anchor) && professionIds.length > 1 ? anchor : '';

  const excluded = useMemo(
    () => excludedFor(professionIds, ownExcluded, catalog?.savedExcluded),
    [professionIds, ownExcluded, catalog],
  );

  const professionsKey = professionIds.join(',');
  const excludedKey = [...excluded].sort().join(',');

  useEffect(() => {
    if (!from || !to || tooLong || !catalog || !professionsKey) return;
    let alive = true;
    // Галочки щёлкают подряд — запрос уходит, когда человек остановился.
    // Расписание МИС при этом не перезапрашивается: сервер держит его в кэше,
    // а исключения накладывает сверху.
    const t = setTimeout(() => {
      setLoading(true);
      setError('');
      scheduleCoverage.report({ from, to, professionIds: professionsKey, exclude: excludedKey, anchor: anchorId || undefined, minGap: MIN_GAP })
        .then(res => { if (alive) setReport(res.data); })
        .catch(err => {
          if (!alive) return;
          setReport(null);
          setError(err.response?.data?.error || 'Не удалось построить отчёт');
        })
        .finally(() => { if (alive) setLoading(false); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [from, to, professionsKey, excludedKey, anchorId, tooLong, reloadKey, catalog]);

  // Правая панель не должна стоять пустой: пока день не выбран, открываем
  // первую находку — это и есть то место, куда человек посмотрел бы первым.
  // Выбор переживает перезагрузку отчёта (исключили врача — день остался тем
  // же), но не смену периода, где его даты может просто не быть.
  useEffect(() => {
    if (!report) return;
    setSelected(prev => {
      const cellOf = (sel) => (sel.clinic === 'all' ? report.network : report.cells[sel.clinic])?.[sel.date];
      if (prev && report.days.includes(prev.date) && cellOf(prev) && isClickable(cellOf(prev))) return prev;
      const f = report.findings[0];
      if (f) return { clinic: f.clinic, date: f.dates[0] };
      // Без находок — первый день, который вообще есть что показать
      const day = report.days.find(d => isClickable(report.network[d])) || report.days[0];
      return { clinic: 'all', date: day };
    });
  }, [report]);

  const updateExcluded = (fn) => setOwnExcluded(prev => {
    const next = fn(prev);
    writeLs(LS_EXCLUDED, next);
    return next;
  });

  // Врач в двух выбранных специальностях — один человек: галочка снимается и
  // ставится в обеих сразу, иначе в сводной группе он был бы «наполовину».
  const toggleDoctor = (doctorId) => {
    const drop = !excluded.has(doctorId);
    updateExcluded(prev => {
      const next = { ...prev };
      for (const p of catalog.professions) {
        if (!professionIds.includes(p.id) || !p.doctors.some(d => d.id === doctorId)) continue;
        const cur = excludedFor([p.id], prev, catalog.savedExcluded);
        if (drop) cur.add(doctorId); else cur.delete(doctorId);
        next[p.id] = [...cur];
      }
      return next;
    });
  };
  const setProfessionAll = (pid, include) => {
    const p = catalog.professions.find(x => x.id === pid);
    updateExcluded(prev => ({ ...prev, [pid]: include ? [] : p.doctors.map(d => d.id) }));
  };
  // Только врачи одного медцентра: «УЗИ Альфы для флеболога Альфы». Медцентр
  // врача — по сменам за период, а без смен — по карточке, как и логотипы.
  const setProfessionClinic = (pid, clinicKey, clinicsOf) => {
    const p = catalog.professions.find(x => x.id === pid);
    updateExcluded(prev => ({ ...prev, [pid]: p.doctors.filter(d => !clinicsOf(d).includes(clinicKey)).map(d => d.id) }));
  };
  const toggleProfession = (pid) => setProfessionIds(prev => {
    if (!prev.includes(pid)) return [...prev, pid];
    // Пустой выбор отчёту не задать — последняя специальность остаётся
    return prev.length > 1 ? prev.filter(id => id !== pid) : prev;
  });
  const toggleAnchor = (pid) => setAnchor(a => (a === pid ? '' : pid));

  // ── Шаблоны ──
  const currentSelection = () => ({
    professionIds,
    anchor: anchorId || null,
    excluded: Object.fromEntries(professionIds.map(pid => [pid, [...excludedFor([pid], ownExcluded, catalog?.savedExcluded)]])),
  });
  const persistPresets = async (next) => {
    const prev = presets;
    setPresets(next);
    try {
      const res = await scheduleCoverage.savePresets(next);
      setPresets(res.data?.presets || next);
    } catch (err) {
      setPresets(prev);
      toast.error(err.response?.data?.error || 'Не удалось сохранить шаблон');
    }
  };
  // id даём сразу: шаблон виден в списке до ответа сервера, и без id его
  // нельзя было бы отличить от соседних
  const savePreset = (name) => persistPresets([...presets, { id: `p${Date.now().toString(36)}`, name, ...currentSelection() }]);
  const renamePreset = (id, name) => persistPresets(presets.map(p => (p.id === id ? { ...p, name } : p)));
  const deletePreset = (id) => persistPresets(presets.filter(p => p.id !== id));
  const applyPreset = (preset) => {
    const known = preset.professionIds.filter(pid => catalog.professions.some(p => p.id === pid));
    if (!known.length) { toast.error('Специальностей шаблона больше нет в МИС'); return; }
    setProfessionIds(known);
    setAnchor(preset.anchor || '');
    updateExcluded(prev => {
      const next = { ...prev };
      for (const pid of known) next[pid] = preset.excluded?.[pid] || [];
      return next;
    });
  };
  const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const activePreset = catalog && presets.find(p => {
    const cur = currentSelection();
    return sameSet(p.professionIds, cur.professionIds)
      && (p.anchor || null) === cur.anchor
      && cur.professionIds.every(pid => sameSet(p.excluded?.[pid] || [], cur.excluded[pid]));
  });

  if (tooLong) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', ...mutedStyle, fontSize: 14 }}>
        Период {days} дней — расписание проверяется не больше чем за {MAX_DAYS} дня.<br />
        Выберите месяц или квартал.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <ProfessionPicker catalog={catalog} report={report} selectedIds={professionIds} excluded={excluded} anchorId={anchorId}
          onProfession={toggleProfession} onDoctor={toggleDoctor} onAll={setProfessionAll} onClinic={setProfessionClinic} onAnchor={toggleAnchor}
          presets={presets} activePreset={activePreset} onApplyPreset={applyPreset} onSavePreset={savePreset}
          onRenamePreset={renamePreset} onDeletePreset={deletePreset} />
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
              У выбранных врачей нет ни одной смены за период
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

// ── Выбор специальностей и врачей ────────────────────────────────────────────

// Специальность в МИС стоит не только у врачей: «КТГ Дневной стационар» — это
// кабинет, заведённый пользователем, а у совместителя направление может быть
// второй специальностью без права вести приём. Такие «врачи» закрывают дыры,
// которых на деле никто не закрывает, поэтому у каждого есть галочка. Ею же
// оставляют в отчёте нескольких конкретных врачей, чтобы сравнить их графики.
//
// Вторая вкладка — шаблоны: настраивать «флеболог Альфы + УЗИ» из списка в
// шестьдесят специальностей каждый раз никто не будет.
function ProfessionPicker(props) {
  const { catalog, selectedIds, activePreset, presets } = props;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('select');
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

  const professions = catalog?.professions || [];
  const names = selectedIds.map(id => professions.find(p => p.id === id)?.name).filter(Boolean);
  // Совпал с шаблоном — показываем его имя: «Флебология → УЗИ» короче и
  // понятнее двух длинных названий из справочника МИС
  const label = activePreset?.name || names.join(', ') || (catalog ? 'Выберите специальность' : 'Загружаю специальности…');

  const tabBtn = (key, text) => (
    <button type="button" onClick={() => setTab(key)}
      style={{ flex: 1, border: 'none', background: 'none', padding: '9px 0', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', fontWeight: tab === key ? 600 : 400, color: tab === key ? 'var(--rb-primary)' : 'var(--rb-text-secondary)', boxShadow: tab === key ? 'inset 0 -2px 0 var(--rb-primary)' : 'none' }}>
      {text}
    </button>
  );

  return (
    <div ref={wrapRef} className={`rb-ss-wrap${open ? ' open' : ''}`} style={{ width: 360, flexShrink: 0 }}>
      <button type="button" className="rb-ss-trigger has-value" onClick={() => setOpen(o => !o)} disabled={!catalog} title={names.join('\n')}>
        {activePreset && <Star size={13} style={{ color: 'var(--amber-500)', fill: 'var(--amber-500)' }} />}
        <span className="rb-ss-value">{label}</span>
        {names.length > 1 && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 9, background: 'var(--accent-100)', color: 'var(--rb-primary)', flexShrink: 0 }}>{names.length}</span>
        )}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="rb-ss-dropdown" style={{ width: 460, right: 'auto' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--rb-border)', background: 'var(--n-50)' }}>
            {tabBtn('select', 'Специальности и врачи')}
            {tabBtn('presets', presets.length ? `Шаблоны · ${presets.length}` : 'Шаблоны')}
          </div>
          {tab === 'select'
            ? <SelectTab {...props} />
            : <PresetsTab {...props} onApplied={() => setOpen(false)} />}
        </div>
      )}
    </div>
  );
}

// Пояснений и числа смен в списке нет — заказчик убрал их как шум. Врач без
// смен за период лишь приглушён: понять, почему он ничего не меняет в отчёте.
function SelectTab({ catalog, report, selectedIds, excluded, anchorId, onProfession, onDoctor, onAll, onClinic, onAnchor }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  // Порядок фиксируется при открытии: выбранные сверху, но строка не должна
  // убегать из-под курсора в момент щелчка по ней
  const [pinned] = useState(selectedIds);
  const searchRef = useRef(null);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const professions = useMemo(() => catalog?.professions || [], [catalog]);
  const reportDoctors = useMemo(() => new Map((report?.doctors || []).map(d => [d.id, d])), [report]);
  const clinicOf = (key) => report?.clinics.find(c => c.key === key) || catalog?.clinics[key];
  // Медцентры врача: по сменам за период, без смен — по карточке МИС
  const clinicsOfDoctor = (d) => {
    const rd = reportDoctors.get(d.id);
    return rd?.clinics?.length ? rd.clinics : d.clinics;
  };

  const q = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const order = new Map(pinned.map((id, i) => [id, i]));
    const list = [...professions].sort((a, b) =>
      (order.has(a.id) ? order.get(a.id) : 1e6) - (order.has(b.id) ? order.get(b.id) : 1e6));
    if (!q) return list.map(p => ({ p, doctors: p.doctors, byDoctor: false }));
    // Поиск идёт и по фамилиям: «найти Иванову» — обычный путь к отдельному
    // врачу, и специальность при этом раскрывается сама
    return list.flatMap(p => {
      if (p.name.toLowerCase().includes(q)) return [{ p, doctors: p.doctors, byDoctor: false }];
      const doctors = p.doctors.filter(d => d.name.toLowerCase().includes(q));
      return doctors.length ? [{ p, doctors, byDoctor: true }] : [];
    });
  }, [professions, pinned, q]);

  const toggleExpand = (pid) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    return next;
  });

  const sortDoctors = (list) => [...list].sort((a, b) => {
    const sa = reportDoctors.get(a.id)?.shifts > 0, sb = reportDoctors.get(b.id)?.shifts > 0;
    return (sb - sa) || a.name.localeCompare(b.name, 'ru');
  });
  const multi = selectedIds.length > 1;

  return (
    <>
      <div className="rb-ss-search-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input ref={searchRef} className="rb-ss-search" type="text" placeholder="Специальность или фамилия врача"
          value={search} onChange={e => setSearch(e.target.value)} />
        {search && <button className="rb-ss-clear" type="button" onClick={() => setSearch('')}>×</button>}
      </div>
      <div style={{ maxHeight: 440, overflowY: 'auto', padding: '4px 0' }}>
        {rows.map(({ p, doctors, byDoctor }) => {
          const on = selectedIds.includes(p.id);
          const isOpen = on && (expanded.has(p.id) || byDoctor);
          const isAnchor = anchorId === p.id;
          // Медцентры специальности — для «оставить только врачей Альфы»
          const groupClinics = isOpen && !byDoctor
            ? [...new Set(p.doctors.flatMap(clinicsOfDoctor))].map(clinicOf).filter(Boolean)
            : [];
          return (
            <div key={p.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px 0 4px', background: on ? 'var(--accent-50)' : 'none' }}>
                <button type="button" onClick={() => on && toggleExpand(p.id)} disabled={!on}
                  title={on ? (isOpen ? 'Свернуть врачей' : 'Показать врачей') : ''}
                  style={{ border: 'none', background: 'none', padding: 4, display: 'flex', cursor: on ? 'pointer' : 'default', color: 'var(--rb-text-secondary)', visibility: on ? 'visible' : 'hidden' }}>
                  <ChevronRight size={14} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, fontSize: 13, padding: '7px 0', cursor: 'pointer', fontWeight: on ? 600 : 400 }}>
                  <input type="checkbox" checked={on} onChange={() => onProfession(p.id)} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                </label>
                {/* Эталон — только когда выбрано несколько: сравнивать не с кем */}
                {on && multi && (
                  <button type="button" onClick={() => onAnchor(p.id)}
                    title={isAnchor ? 'Эталон: остальные проверяются на часы его приёма. Нажмите, чтобы снять' : 'Сделать эталоном: проверять, есть ли остальные, пока принимает эта специальность'}
                    style={{ border: 'none', background: isAnchor ? 'var(--amber-100)' : 'none', borderRadius: 6, padding: '3px 6px', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, color: isAnchor ? 'var(--amber-800)' : 'var(--rb-text-secondary)', flexShrink: 0 }}>
                    <Star size={13} style={isAnchor ? { fill: 'var(--amber-500)', color: 'var(--amber-500)' } : undefined} />
                    {isAnchor && 'эталон'}
                  </button>
                )}
              </div>
              {isOpen && !byDoctor && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 34px', fontSize: 12, ...mutedStyle }}>
                  <button type="button" onClick={() => onAll(p.id, true)} style={linkBtn}>все</button>
                  <button type="button" onClick={() => onAll(p.id, false)} style={linkBtn}>никого</button>
                  {groupClinics.length > 1 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                      только
                      {groupClinics.map(c => (
                        <button key={c.key} type="button" title={`Только врачи ${c.name}`}
                          onClick={() => onClinic(p.id, c.key, clinicsOfDoctor)}
                          style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}>
                          <ClinicLogo clinic={c} size={18} />
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              )}
              {isOpen && sortDoctors(doctors).map(d => {
                const rd = reportDoctors.get(d.id);
                const off = excluded.has(d.id);
                return (
                  <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '5px 10px 5px 34px', cursor: 'pointer', opacity: rd && !rd.shifts ? 0.55 : 1 }}>
                    <input type="checkbox" checked={!off} onChange={() => onDoctor(d.id)} />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: off ? 'var(--rb-text-secondary)' : 'inherit' }} title={d.name}>{d.name}</span>
                    <ClinicLogos clinics={clinicsOfDoctor(d).map(clinicOf).filter(Boolean)} />
                  </label>
                );
              })}
            </div>
          );
        })}
        {catalog && rows.length === 0 && <div className="rb-ss-empty">Ничего не найдено</div>}
      </div>
    </>
  );
}

// Название шаблона по умолчанию — из коротких имён специальностей: в МИС они
// длинные («Флебология, сердечно-сосудистая хирургия»), а в строке выбора
// нужна суть. Эталон впереди стрелкой — так и читается: «кого прикрывают кем».
function defaultPresetName(catalog, selectedIds, anchorId, excluded) {
  const short = (id) => (catalog.professions.find(p => p.id === id)?.name || '').split(/[,(]/)[0].trim();
  const rest = selectedIds.filter(id => id !== anchorId).map(short);
  const base = anchorId ? `${short(anchorId)} → ${rest.join(' + ')}` : rest.join(' + ');
  // «Выборочно» — когда галочки снимал сам человек; служебные записи вроде
  // КТГ, снятые для всех ещё до шаблонов, выбором не считаются
  const saved = new Set(Object.values(catalog.savedExcluded || {}).flat().map(String));
  const partial = selectedIds.some(pid => catalog.professions.find(p => p.id === pid)?.doctors.some(d => excluded.has(d.id) && !saved.has(d.id)));
  return partial ? `${base}, выборочно` : base;
}

function PresetsTab({ catalog, selectedIds, anchorId, excluded, presets, activePreset, onApplyPreset, onSavePreset, onRenamePreset, onDeletePreset, onApplied }) {
  const [name, setName] = useState(() => defaultPresetName(catalog, selectedIds, anchorId, excluded));
  const [editing, setEditing] = useState(null); // { id, name }
  const shortList = (ids) => ids.map(id => catalog.professions.find(p => p.id === id)?.name.split(/[,(]/)[0].trim() || '—').join(', ');

  const save = () => {
    const n = name.trim();
    if (!n) return;
    onSavePreset(n);
  };
  const commitRename = () => {
    if (editing?.name.trim()) onRenamePreset(editing.id, editing.name.trim());
    setEditing(null);
  };

  return (
    <div>
      {/* Сохранить можно только то, чего ещё нет: второй такой же шаблон
          отличался бы от первого лишь именем */}
      {!activePreset && (
        <div style={{ display: 'flex', gap: 6, padding: 10, borderBottom: '1px solid var(--rb-border)' }}>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()}
            placeholder="Название шаблона" className="rb-input"
            style={{ flex: 1, minWidth: 0, padding: '6px 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 7, fontFamily: 'inherit', fontSize: 13, background: 'var(--n-0)', color: 'var(--rb-text)' }} />
          <button type="button" onClick={save} disabled={!name.trim()} className="rb-btn rb-btn-primary"
            style={{ padding: '6px 12px', fontSize: 13, whiteSpace: 'nowrap' }}>
            Сохранить выбор
          </button>
        </div>
      )}
      <div style={{ maxHeight: 400, overflowY: 'auto', padding: '4px 0' }}>
        {presets.length === 0 && <div className="rb-ss-empty">Шаблонов пока нет</div>}
        {presets.map(p => {
          const isActive = activePreset?.id === p.id;
          if (editing?.id === p.id) {
            return (
              <div key={p.id} style={{ display: 'flex', gap: 6, padding: '6px 10px' }}>
                <input autoFocus value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }}
                  onBlur={commitRename}
                  style={{ flex: 1, minWidth: 0, padding: '5px 8px', border: '1px solid var(--rb-primary)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, background: 'var(--n-0)', color: 'var(--rb-text)' }} />
              </div>
            );
          }
          return (
            <div key={p.id} className="rb-ss-item" style={{ gap: 8, background: isActive ? 'var(--accent-50)' : undefined }}
              onClick={() => { onApplyPreset(p); onApplied(); }}>
              <span style={{ display: 'grid', gap: 1, minWidth: 0, flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: isActive ? 600 : 400 }}>
                  {p.anchor && <Star size={12} style={{ color: 'var(--amber-500)', fill: 'var(--amber-500)', flexShrink: 0 }} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  {isActive && <Check size={13} style={{ color: 'var(--rb-primary)', flexShrink: 0 }} />}
                </span>
                <span style={{ fontSize: 11, ...mutedStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortList(p.professionIds)}</span>
              </span>
              <button type="button" title="Переименовать" onClick={e => { e.stopPropagation(); setEditing({ id: p.id, name: p.name }); }} style={presetIconBtn}>
                <Pencil size={13} />
              </button>
              <button type="button" title="Удалить" onClick={e => { e.stopPropagation(); onDeletePreset(p.id); }} style={presetIconBtn}>
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const presetIconBtn = { border: 'none', background: 'none', padding: 4, display: 'flex', cursor: 'pointer', color: 'var(--rb-text-secondary)', flexShrink: 0 };
const linkBtn = { border: 'none', background: 'none', padding: 0, color: 'var(--rb-primary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 };

// Чей врач — логотипами медцентров. Больше трёх не помещается в строку, и
// врач «во всех филиалах» читается по «+N» не хуже, чем по восьми значкам.
function ClinicLogos({ clinics }) {
  const shown = clinics.slice(0, 3);
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto', flexShrink: 0 }}
      title={clinics.map(c => c.name).join(', ')}>
      {shown.map(c => <ClinicLogo key={c.key} clinic={c} size={18} />)}
      {clinics.length > 3 && <span style={{ fontSize: 11, ...mutedStyle }}>+{clinics.length - 3}</span>}
    </span>
  );
}

// Оговорки, без которых цифры читаются неверно
function Notices({ report, to }) {
  const notes = [];
  if (!report.horizon) {
    notes.push('На этот период у выбранных врачей нет ни одной смены — похоже, график ещё не составлен.');
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
    ...visibleClinics(report).map(c => ({ key: c.key, name: c.name, clinic: c, data: report.cells[c.key] })),
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
                        title={cellTitle(report, col.name, d, c)}
                        style={{
                          width: CELL_W, height: CELL_H, border: c.status === 'unplanned' ? '1px dashed var(--rb-border-dark)' : 'none',
                          borderRadius: 6, padding: 0, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, display: 'block',
                          fontVariantNumeric: 'tabular-nums', cursor: clickable ? 'pointer' : 'default',
                          background: hasCancelGap(c) ? `${HATCH}, ${st.bg}` : st.bg, color: st.fg,
                          outline: isSel ? '2px solid var(--rb-primary)' : 'none', outlineOffset: 1,
                        }}
                      >
                        {c.status === 'closed' || c.status === 'idle' ? '–' : c.status === 'unplanned' ? '' : c.doctors}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Legend report={report} />
    </div>
  );
}

function cellTitle(report, name, date, c) {
  const anchor = report.mode === 'anchor';
  const head = `${name} · ${dateLong(date)}`;
  if (c.status === 'closed') return `${head}\nМедцентр закрыт`;
  if (c.status === 'idle') return `${head}\nЭталон не принимает`;
  if (c.status === 'unplanned') return `${head}\nГрафик ещё не заведён`;
  const lines = [head, anchor ? `Смежных в часы эталона: ${c.doctors}` : `Врачей: ${c.doctors}`];
  for (const g of c.gaps || []) lines.push(`${anchor ? 'Без смежных' : 'Без врача'} ${range(g.from, g.to)}${g.cause === 'cancel' ? ' — из-за отмены' : ''}`);
  if (c.single) lines.push(anchor ? 'Приём эталона прикрывает один врач' : 'Весь день держится на одном враче');
  return lines.join('\n');
}

function Legend({ report }) {
  const item = (bg, label, extra = {}) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, background: bg, flexShrink: 0, ...extra }} />{label}
    </span>
  );
  const keys = report.mode === 'anchor' ? ['none', 'gap', 'single', 'ok', 'idle'] : ['none', 'gap', 'single', 'ok', 'closed'];
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 12, fontSize: 11, ...mutedStyle }}>
      {keys.map(k => <span key={k}>{item(STATUS[k].bg, statusLabel(report, k))}</span>)}
      {item(`${HATCH}, var(--amber-200)`, 'Из-за отмены')}
      {item('transparent', STATUS.unplanned.label, { border: '1px dashed var(--rb-border-dark)' })}
    </div>
  );
}

// ── Расписание дня ───────────────────────────────────────────────────────────

// Цвет смены — по специальности, чтобы в сводном графике УЗИ отличалось от
// флеболога с первого взгляда. Красный и зелёный заняты дырами и покрытием,
// поэтому в наборе их нет; эталон всегда получает первый цвет.
const PROFESSION_COLORS = ['var(--rb-primary)', 'var(--violet-500)', 'var(--cyan-500)', 'var(--pink-500)', 'var(--amber-500)', 'var(--n-500)'];
function professionColors(report) {
  const ids = (report.professions || []).map(p => p.id);
  const ordered = report.anchor ? [report.anchor, ...ids.filter(id => id !== report.anchor)] : ids;
  return Object.fromEntries(ordered.map((id, i) => [id, PROFESSION_COLORS[i % PROFESSION_COLORS.length]]));
}

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

  const anchorMode = report.mode === 'anchor';
  const multi = report.professions?.length > 1;
  const professionColor = useMemo(() => professionColors(report), [report]);
  const professionName = (id) => (report.professions || []).find(p => p.id === id)?.name.split(/[,(]/)[0].trim() || '';

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
          if (!prevLane.clinics.includes(c)) prevLane.clinics.push(c);
        } else {
          const profession = doctors[l.userId]?.professions?.[0] || null;
          byUser.set(l.userId, {
            userId: l.userId, work: [...l.work], cancel: [...l.cancel], clinics: [c], profession,
            name: doctors[l.userId]?.name || `#${l.userId}`,
            lead: anchorMode && profession === report.anchor,
          });
        }
      }
    }
    // Эталон сверху, дальше — специальностями в порядке выбора, внутри — по
    // началу смены: в сводном графике врачи одной специальности стоят рядом
    const order = new Map((report.professions || []).map((p, i) => [p.id, i]));
    const start = (l) => Math.min(...l.work.map(w => w[0]));
    return [...byUser.values()].sort((a, b) =>
      (b.lead - a.lead)
      || ((order.get(a.profession) ?? 99) - (order.get(b.profession) ?? 99))
      || ((start(a) || 0) - (start(b) || 0)));
  }, [report, date, isNet, clinicInfo, anchorMode]);

  const win = cell.window || { from: 8 * 60, to: 20 * 60 };
  // С эталоном «должно быть покрыто» — не сплошные часы медцентра, а его смены
  const windows = cell.windows || [[win.from, win.to]];
  const clinicName = (key) => report.clinics.find(c => c.key === key)?.name || key;
  let lo = win.from, hi = win.to;
  for (const l of lanes) for (const [s, e] of l.work) { lo = Math.min(lo, s); hi = Math.max(hi, e); }
  lo = Math.floor(lo / 60) * 60;
  hi = Math.ceil(hi / 60) * 60;
  const pct = (m) => `${((m - lo) / (hi - lo)) * 100}%`;
  const width = (s, e) => `${((e - s) / (hi - lo)) * 100}%`;
  const ticks = [];
  for (let h = lo; h <= hi; h += 60) ticks.push(h);
  const tickStep = hi - lo > 14 * 60 ? 2 : 1;

  const LABEL_W = 210;
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
            <div style={{ width: LABEL_W, flexShrink: 0, fontSize: 12, fontWeight: 600 }}>{anchorMode ? 'Без смежных' : 'Без врача'}</div>
            <div style={track}>
              {windows.map(([a, b], i) => (
                <div key={`w${i}`} style={{ position: 'absolute', left: pct(a), width: width(a, b), top: 0, bottom: 0, background: 'var(--green-100)', borderRadius: 5 }} />
              ))}
              {(cell.gaps || []).map((g, i) => (
                <div key={i} title={[
                  `${range(g.from, g.to)}${g.cause === 'cancel' ? ' — из-за отмены' : ''}`,
                  g.elsewhere?.length ? `${g.elsewhereFull ? 'Можно направить' : 'Частично есть'}: ${g.elsewhere.map(e => clinicName(e.clinic)).join(', ')}` : '',
                ].filter(Boolean).join('\n')}
                  style={{ position: 'absolute', left: pct(g.from), width: width(g.from, g.to), top: 0, bottom: 0, borderRadius: 5, background: g.cause === 'cancel' ? `${HATCH}, var(--red-500)` : 'var(--red-500)', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {range(g.from, g.to)}
                </div>
              ))}
              {!(cell.gaps || []).length && <span style={{ position: 'absolute', left: 8, top: 3, fontSize: 11, color: 'var(--green-800)' }}>{anchorMode ? 'весь приём эталона прикрыт' : 'все часы работы покрыты'}</span>}
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--rb-border)', margin: '4px 0' }} />

          {lanes.length === 0 && <div style={{ fontSize: 13, ...mutedStyle, padding: '6px 0' }}>В графике на этот день никого нет</div>}
          {lanes.map(l => {
            const color = (multi && professionColor[l.profession]) || 'var(--rb-primary)';
            return (
              <div key={l.userId} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ width: LABEL_W, flexShrink: 0, paddingRight: 8, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {/* Логотип — где врач принимал в этот день; в сети их бывает два */}
                  <span style={{ display: 'flex', gap: 2, flexShrink: 0 }} title={l.clinics.map(c => c.name).join(', ')}>
                    {l.clinics.slice(0, 2).map(c => <ClinicLogo key={c.key} clinic={c} size={18} />)}
                  </span>
                  <span style={{ display: 'grid', minWidth: 0, lineHeight: 1.2 }}>
                    <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: l.lead ? 600 : 400 }} title={l.name}>
                      {l.lead && <Star size={10} style={{ color: 'var(--amber-500)', fill: 'var(--amber-500)', marginRight: 3, verticalAlign: -1 }} />}
                      {shortName(l.name)}
                    </span>
                    {multi && (
                      <span style={{ fontSize: 10.5, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {professionName(l.profession)}
                      </span>
                    )}
                  </span>
                </div>
                <div style={track}>
                  <div style={{ position: 'absolute', left: pct(win.from), width: width(win.from, win.to), top: 0, bottom: 0, border: '1px dashed var(--rb-border)', borderRadius: 5 }} />
                  {l.work.map(([a, b], j) => (
                    <div key={j} title={`Смена ${range(a, b)}`}
                      style={{ position: 'absolute', left: pct(a), width: width(a, b), top: 3, bottom: 3, borderRadius: 4, background: color, opacity: 0.85 }} />
                  ))}
                  {l.cancel.map(([a, b], j) => (
                    <div key={`c${j}`} title={`Отмена ${range(a, b)}`}
                      style={{ position: 'absolute', left: pct(a), width: width(a, b), top: 3, bottom: 3, borderRadius: 4, background: `${HATCH}, var(--red-400)` }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, ...mutedStyle, flexWrap: 'wrap' }}>
        {multi
          ? report.professions.map(p => (
            <span key={p.id}><span style={{ display: 'inline-block', width: 14, height: 8, borderRadius: 3, background: professionColor[p.id], marginRight: 6 }} />{p.id === report.anchor && '★ '}{professionName(p.id)}</span>
          ))
          : <span><span style={{ display: 'inline-block', width: 14, height: 8, borderRadius: 3, background: 'var(--rb-primary)', marginRight: 6 }} />смена</span>}
        <span><span style={{ display: 'inline-block', width: 14, height: 8, borderRadius: 3, background: `${HATCH}, var(--red-400)`, marginRight: 6 }} />отмена поверх смены</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 8, borderRadius: 3, border: '1px dashed var(--rb-border-dark)', marginRight: 6 }} />часы работы</span>
      </div>
    </div>
  );
}

// ── Находки ──────────────────────────────────────────────────────────────────

// Уровень находки — значком. Цветная полоса слева читалась как цвет
// медцентра: у филиалов свои фирменные цвета, и красная «Альфа» от красной
// тревоги на глаз не отличалась.
const SEVERITY = {
  3: { Icon: AlertOctagon, color: 'var(--red-500)', label: 'Срочно: никого во всей сети' },
  2: { Icon: AlertTriangle, color: 'var(--amber-500)', label: 'Важно' },
  1: { Icon: Info, color: 'var(--rb-text-secondary)', label: 'К сведению' },
};

function Findings({ report, onSelect }) {
  const names = useMemo(() => Object.fromEntries(report.doctors.map(d => [d.id, d.name])), [report]);
  // null — все находки, вместе с находками по сети в целом; иначе ключ медцентра
  const [only, setOnly] = useState(null);
  useEffect(() => {
    if (only && !report.clinics.some(c => c.key === only)) setOnly(null);
  }, [report, only]);
  const list = only ? report.findings.filter(f => f.clinic === only) : report.findings;
  const who = (ids) => ids.map(id => shortName(names[id] || `#${id}`)).join(', ');
  const clinicByKey = useMemo(() => Object.fromEntries(report.clinics.map(c => [c.key, c])), [report]);
  const clinicName = (key) => clinicByKey[key]?.name || key;

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
          {report.mode === 'anchor'
            ? `Приём эталона прикрыт смежными — дыр длиннее ${hours(report.minGap)} нет.`
            : `Направление покрыто во все часы работы — дыр длиннее ${hours(report.minGap)} нет.`}
        </div>
      )}
      <div style={{ display: 'grid', alignContent: 'start', overflowY: 'auto', flex: '1 1 auto', minHeight: 0, marginRight: -8, paddingRight: 8 }}>
        {list.map((f, i) => {
          const { title, detail } = describeFinding(f, who, { anchor: report.mode === 'anchor' });
          const sev = SEVERITY[Math.min(3, f.severity)] || SEVERITY[1];
          const clinic = report.clinics.find(c => c.key === f.clinic);
          return (
            <button key={i} onClick={() => onSelect(f.clinic, f.dates[0])}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', border: 'none', borderTop: i ? '1px solid var(--rb-border)' : 'none', background: 'none', padding: '10px 0', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' }}>
              <span title={sev.label} style={{ display: 'inline-flex', flexShrink: 0, marginTop: 3 }}><sev.Icon size={16} color={sev.color} /></span>
              {/* При отборе по медцентру его логотип в каждой строке — повтор */}
              {!only && (
                <span title={f.clinicName} style={{ flexShrink: 0, display: 'inline-flex' }}>
                  {clinic ? <ClinicLogo clinic={clinic} size={22} /> : <NetworkMark size={22} />}
                </span>
              )}
              <span style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13 }}>{title}</span>
                {detail && <span style={{ fontSize: 12, ...mutedStyle }}>{detail}</span>}
              </span>
              {/* Куда направить, пока здесь никого: свой медцентр важнее, но
                  соседний лучше, чем ничего. Бледнее — когда закрывает не всё */}
              {f.elsewhere?.length > 0 && (
                <span title={describeElsewhere(f, clinicName)}
                  style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, marginTop: 1, opacity: f.elsewhereFull ? 1 : 0.5, ...mutedStyle, fontSize: 12 }}>
                  →
                  {f.elsewhere.slice(0, 3).map(k => clinicByKey[k] && <ClinicLogo key={k} clinic={clinicByKey[k]} size={18} />)}
                  {f.elsewhere.length > 3 && <span style={{ fontSize: 11 }}>+{f.elsewhere.length - 3}</span>}
                </span>
              )}
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
    ...visibleClinics(report).map(c => ({ key: c.key, label: c.name, mark: <ClinicLogo clinic={c} size={18} />, n: counts[c.key] || 0 })),
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
