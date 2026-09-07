import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import { inpatientReport } from '../../../services/api';

// Отчёт по стационару жил отдельной страницей в backend/bot/inpatient-report.html
// и переехал сюда целиком: данные те же (требование + счета МИС), изменилась
// только оболочка — период берётся из общего селектора аналитики, а оформление
// от вкладок «Возвраты» и «Боты», чтобы модуль читался как одно целое.

// Больше трёх месяцев за раз сервер не считает: на каждого пациента требования
// уходит отдельный запрос в МИС. Проверяем здесь же, чтобы на «Год» человек
// получил внятное объяснение, а не ошибку 400 после минуты ожидания.
const MAX_DAYS = 92;

// Ссылка на карточку пациента в веб-интерфейсе Renovatio — как в «Задолженностях»
const MIS_WEB_BASE = 'https://rnova.medcentralfa.ru:3010';
const patientCardUrl = (patientId) => `${MIS_WEB_BASE}/patients/default/detail/id/${patientId}`;

// Локальная дата (toISOString сдвинул бы на часовой пояс и потерял крайний день)
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU');
const fmtRub = (n) => fmt(n) + ' ₽';
const fmtOne = (n) => (Number(n) || 0).toFixed(1).replace('.', ',');
const fmtPct = (n) => Math.round((Number(n) || 0) * 100) + '%';
const dateFull = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : String(iso || '');
};
const dateShort = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}` : String(iso || '');
};

// Одна серия — один тон: койко-дни и выручка живут разными графиками с общей
// датой внизу, двух шкал на одной оси нигде нет.
const C_BED = '#6366f1';
const C_MONEY = '#0d9488';
const AXIS = { fill: 'var(--rb-text-secondary, #64748b)', fontSize: 11 };
const GRID = 'var(--rb-border, #e2e8f0)';

const cell = { padding: '8px 12px', border: '1px solid var(--rb-border)', color: 'var(--rb-text)', background: 'var(--n-0)' };
const cellNum = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const cellHead = { ...cell, background: 'var(--n-50)', fontWeight: 600, fontSize: 12, textAlign: 'left', whiteSpace: 'nowrap' };
const cellHeadNum = { ...cellHead, textAlign: 'right' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13, color: 'var(--rb-text)' };
const linkStyle = { color: 'var(--rb-primary)', textDecoration: 'none', cursor: 'pointer' };
const mutedStyle = { color: 'var(--rb-text-secondary)' };

const SECTIONS = [
  { key: 'episodes', label: 'Случаи' },
  { key: 'services', label: 'Услуги' },
  { key: 'doctors',  label: 'Исполнители' },
  { key: 'patients', label: 'Пациенты' },
  { key: 'dynamics', label: 'Динамика' },
  { key: 'money',    label: 'Деньги' },
];

export default function Inpatient({ periodStart, periodEnd }) {
  const [section, setSection] = useState('episodes');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openEpisodes, setOpenEpisodes] = useState({});
  const [reloadKey, setReloadKey] = useState(0);

  const from = periodStart ? isoLocal(periodStart) : '';
  const to   = periodEnd ? isoLocal(periodEnd) : '';
  const days = from && to
    ? Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000) + 1
    : 0;
  const tooLong = days > MAX_DAYS;

  useEffect(() => {
    if (!from || !to || tooLong) { setReport(null); return; }
    let alive = true;
    setLoading(true);
    setError('');
    setOpenEpisodes({});
    inpatientReport.report({ from, to })
      .then(res => { if (alive) setReport(res.data); })
      .catch(err => {
        if (!alive) return;
        setReport(null);
        setError(err.response?.data?.error || 'Не удалось построить отчёт');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [from, to, tooLong, reloadKey]);

  const toggleEpisode = (idx) => setOpenEpisodes(prev => ({ ...prev, [idx]: !prev[idx] }));

  if (tooLong) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 14 }}>
        Период {days} дней — стационар считается не больше чем за {MAX_DAYS} дней.<br />
        Выберите месяц или квартал.
      </div>
    );
  }

  const s = report?.summary;

  return (
    <div>
      {/* Разделы отчёта. Уровнем выше уже две линейки вкладок, поэтому здесь
          переключатель-сегменты, как на «Ботах», а не третий ряд вкладок. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Segmented options={SECTIONS} value={section} onChange={setSection} />
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {report && (
            <span style={{ fontSize: 12, color: 'var(--rb-text-secondary)' }}>
              {dateFull(from)} — {dateFull(to)}
            </span>
          )}
          <button onClick={() => setReloadKey(k => k + 1)} disabled={loading} title="Пересобрать отчёт"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, border: '1px solid var(--rb-border-dark)', borderRadius: 7, background: 'var(--n-0)', cursor: loading ? 'default' : 'pointer', color: 'var(--rb-text-secondary)', opacity: loading ? 0.5 : 1 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-4.5" /></svg>
          </button>
        </span>
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '70px 0', color: 'var(--rb-text-secondary)', gap: 12 }}>
          <span className="rb-spinner" style={{ width: 22, height: 22 }} />
          <span style={{ fontSize: 14 }}>Поднимаю услуги пациентов из МИС…</span>
          <span style={{ fontSize: 12 }}>Запрос идёт по каждому пациенту требования, это до минуты</span>
        </div>
      )}

      {!loading && error && (
        <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--red-500)', fontSize: 13 }}>{error}</div>
      )}

      {!loading && !error && report && (
        <>
          {/* Сводка */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <KpiCard label="Выручка" value={fmtRub(s.revenue)} sub={`стационарные услуги ${fmtRub(s.inpatientRevenue)}`} accent="var(--rb-primary)" />
            <KpiCard label="Случаев лечения" value={fmt(s.episodes)} sub={`пациентов ${fmt(s.patients)}`} />
            <KpiCard label="Койко-дней" value={fmt(s.bedDays)} sub={`выставлено ${fmt(s.bedDaysBilled)}`} />
            <KpiCard label="Средняя длительность" value={`${fmtOne(s.avgStay)} дн.`} />
            <KpiCard label="Средний чек" value={fmtRub(s.avgCheck)} sub={`на койко-день ${fmtRub(s.revenuePerBedDay)}`} />
            <KpiCard label="Не оплачено" value={fmtRub(s.payment.unpaidSum)} sub={`счетов ${fmt(s.payment.unpaid)}`} accent={s.payment.unpaidSum ? 'var(--red-500)' : undefined} />
          </div>

          {/* Пациенты, по которым МИС не ответил, занижают выручку — молчать об
              этом нельзя, иначе цифры выглядят полными, а они неполные */}
          {s.failedPatients > 0 && (
            <div style={{ marginBottom: 16, padding: '10px 14px', border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: 10, fontSize: 13, color: '#9a3412' }}>
              МИС не ответил по {s.failedPatients} пациенту(ам) — их услуги в суммы не вошли. Обновите отчёт.
            </div>
          )}

          {s.episodes === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 14 }}>
              За период нет случаев стационарного лечения
            </div>
          ) : (
            <>
              {section === 'episodes' && <EpisodesSection report={report} open={openEpisodes} onToggle={toggleEpisode} />}
              {section === 'services' && <ServicesSection report={report} />}
              {section === 'doctors'  && <DoctorsSection report={report} />}
              {section === 'patients' && <PatientsSection report={report} />}
              {section === 'dynamics' && <DynamicsSection report={report} />}
              {section === 'money'    && <MoneySection report={report} />}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Разделы ───────────────────────────────────────────────────────────────────

const DIST_LABELS = { '1': '1 день', '2': '2 дня', '3-5': '3–5 дней', '6-10': '6–10 дней', '11+': '11 и больше' };

function EpisodesSection({ report, open, onToggle }) {
  const dist = useMemo(
    () => Object.keys(DIST_LABELS).map(k => ({ label: DIST_LABELS[k], count: report.distribution[k] || 0 })),
    [report]
  );

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Panel title="Случаи стационарного лечения">
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={cellHead}>Пациент</th>
                <th style={cellHead}>Палата</th>
                <th style={cellHead}>Период лечения</th>
                <th style={cellHeadNum}>Койко-дней</th>
                <th style={cellHeadNum}>Выставлено</th>
                <th style={cellHeadNum}>Выручка</th>
                <th style={cellHeadNum}>Себестоимость</th>
                <th style={cellHeadNum}>Не оплачено</th>
              </tr>
            </thead>
            <tbody>
              {report.episodes.map((e, idx) => {
                const missed = e.bedDays - e.bedDaysBilled;
                return (
                  <React.Fragment key={idx}>
                    <tr onClick={() => onToggle(idx)} style={{ cursor: 'pointer' }} title="Показать услуги случая">
                      <td style={cell}>
                        <span style={{ display: 'inline-block', width: 14, color: 'var(--rb-text-secondary)', transform: open[idx] ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
                        {e.patientId
                          ? <a href={patientCardUrl(e.patientId)} target="_blank" rel="noopener noreferrer" style={linkStyle} onClick={ev => ev.stopPropagation()} title="Открыть карточку пациента в Renovatio">{e.patient}</a>
                          : e.patient}
                      </td>
                      <td style={cell}>{e.rooms || ''}</td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        {dateFull(e.start)}{e.end !== e.start ? ` — ${dateFull(e.end)}` : ''}
                      </td>
                      <td style={cellNum}>{e.bedDays}</td>
                      {/* Выставлено меньше факта — койко-день не попал в счёт: ровно
                          то расхождение, ради которого требование связали с МИС */}
                      <td style={cellNum}>{missed > 0 ? <Badge tone="danger">{e.bedDaysBilled}</Badge> : e.bedDaysBilled}</td>
                      <td style={cellNum}>{fmtRub(e.revenue)}</td>
                      <td style={{ ...cellNum, ...mutedStyle }}>{e.cost ? fmtRub(e.cost) : '—'}</td>
                      <td style={{ ...cellNum, color: e.unpaid ? 'var(--red-500)' : undefined }}>{e.unpaid ? fmtRub(e.unpaid) : ''}</td>
                    </tr>
                    {open[idx] && (
                      <tr>
                        <td colSpan={8} style={{ ...cell, background: 'var(--n-50)', padding: '4px 12px 10px 34px' }}>
                          <table style={{ ...tableStyle, fontSize: 12.5 }}>
                            <tbody>
                              {e.services.map((sv, i) => (
                                <tr key={i}>
                                  <td style={{ padding: '4px 8px', width: 70, ...mutedStyle, whiteSpace: 'nowrap' }}>{dateFull(sv.date)}</td>
                                  <td style={{ padding: '4px 8px' }}>{sv.title}</td>
                                  <td style={{ padding: '4px 8px', width: 150, ...mutedStyle }}>{sv.doctor || ''}</td>
                                  <td style={{ padding: '4px 8px', width: 110, ...mutedStyle }}>{sv.profession || ''}</td>
                                  <td style={{ padding: '4px 8px', width: 90, ...mutedStyle }}>{sv.clinic || ''}</td>
                                  <td style={{ padding: '4px 8px', width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(sv.count)}</td>
                                  <td style={{ padding: '4px 8px', width: 90, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtRub(sv.value)}</td>
                                  <td style={{ padding: '4px 8px', width: 90, textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...mutedStyle }}>{sv.cost ? fmtRub(sv.cost) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Пациента внесли в требование, но карточку МИС не выбрали — его деньги в
          отчёт не попали, поэтому список показываем отдельно */}
      {report.unlinked?.length > 0 && (
        <Panel title="Без карточки МИС">
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={cellHead}>Запись в требовании</th>
                <th style={cellHead}>Палата</th>
                <th style={cellHeadNum}>Дней</th>
              </tr>
            </thead>
            <tbody>
              {report.unlinked.map((u, i) => (
                <tr key={i}>
                  <td style={cell}>{u.name}</td>
                  <td style={cell}>{u.rooms || ''}</td>
                  <td style={cellNum}>{u.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel title="Длительность лечения">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dist} layout="vertical" margin={{ left: 4, right: 40, top: 4, bottom: 4 }}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={100} tick={{ ...AXIS, fill: 'var(--rb-text, #1e293b)', fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'rgba(128,128,128,0.08)' }} formatter={(v) => [fmt(v), 'Случаев']} />
            <Bar dataKey="count" fill={C_BED} radius={[0, 4, 4, 0]} maxBarSize={22}>
              <LabelList dataKey="count" position="right" fill="var(--rb-text-secondary, #64748b)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}

function ServicesSection({ report }) {
  const topSum = useMemo(
    () => report.services.slice(0, 10).map(r => ({ name: r.title, value: r.sum })).reverse(),
    [report]
  );

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Panel title="Топ-10 услуг по сумме">
        <TopBars data={topSum} color={C_MONEY} format={fmtRub} tipLabel="Сумма" />
      </Panel>

      <Panel title="Услуги по сумме">
        <RankTable
          head={['Услуга', 'Количество', 'Сумма', 'Себестоимость', 'Пациентов']}
          rows={report.services}
          cells={(r) => [r.title, fmt(r.count), fmtRub(r.sum), r.cost ? fmtRub(r.cost) : <span style={mutedStyle}>—</span>, fmt(r.patients)]}
        />
      </Panel>

      <Panel title="Услуги по количеству">
        <RankTable
          head={['Услуга', 'Количество', 'Сумма', 'Пациентов']}
          rows={report.servicesByCount}
          cells={(r) => [r.title, fmt(r.count), fmtRub(r.sum), fmt(r.patients)]}
        />
      </Panel>
    </div>
  );
}

function DoctorsSection({ report }) {
  const top = useMemo(
    () => report.doctors.slice(0, 10).map(r => ({ name: r.name, value: r.sum })).reverse(),
    [report]
  );

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Panel title="Топ-10 исполнителей по сумме">
        <TopBars data={top} color={C_MONEY} format={fmtRub} tipLabel="Сумма" />
      </Panel>

      <Panel title="Исполнители">
        <RankTable
          head={['Исполнитель', 'Услуг', 'Сумма', 'Пациентов']}
          rows={report.doctors}
          cells={(r) => [r.name, fmt(r.count), fmtRub(r.sum), fmt(r.patients)]}
        />
      </Panel>

      <Panel title="Структура по направлениям">
        <RankTable
          head={['Направление', 'Услуг', 'Сумма']}
          rows={report.professions}
          cells={(r) => [r.title, fmt(r.count), fmtRub(r.sum)]}
        />
      </Panel>
    </div>
  );
}

function PatientsSection({ report }) {
  return (
    <Panel title="Топ пациентов по тратам">
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellHead}>Пациент</th>
              <th style={cellHeadNum}>Койко-дней</th>
              <th style={cellHeadNum}>Случаев</th>
              <th style={cellHeadNum}>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {report.patientsTop.map((r, i) => (
              <tr key={i}>
                <td style={cell}>
                  {r.patientId
                    ? <a href={patientCardUrl(r.patientId)} target="_blank" rel="noopener noreferrer" style={linkStyle} title="Открыть карточку пациента в Renovatio">{r.patient}</a>
                    : r.patient}
                </td>
                <td style={cellNum}>{fmt(r.bedDays)}</td>
                <td style={cellNum}>{fmt(r.episodes)}</td>
                <td style={cellNum}>{fmtRub(r.sum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function DynamicsSection({ report }) {
  const daily = useMemo(() => report.daily.map(d => ({ ...d, short: dateShort(d.date) })), [report]);
  if (!daily.length) {
    return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 14 }}>Нет данных за период</div>;
  }
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Panel title="Занято коек по дням">
        <DailyChart data={daily} dataKey="bedDays" color={C_BED} tipLabel="Койко-дней" format={fmt} />
      </Panel>
      {/* Второй график, а не вторая шкала: койко-дни и рубли несоизмеримы, общая
          у них только дата внизу */}
      <Panel title="Выручка по дням">
        <DailyChart data={daily} dataKey="revenue" color={C_MONEY} tipLabel="Выручка" format={fmtRub} />
      </Panel>
    </div>
  );
}

function MoneySection({ report }) {
  const p = report.summary.payment;
  const s = report.summary;
  const total = p.paid + p.partial + p.unpaid;
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Panel title="Оплата счетов">
        <table style={tableStyle}>
          <tbody>
            <tr><td style={cell}>Оплачено полностью</td><td style={cellNum}>{p.paid} из {total}</td></tr>
            <tr><td style={cell}>Оплачено частично</td><td style={cellNum}>{p.partial}</td></tr>
            <tr><td style={cell}>Не оплачено</td><td style={{ ...cellNum, color: p.unpaid ? 'var(--red-500)' : undefined }}>{p.unpaid} · {fmtRub(p.unpaidSum)}</td></tr>
            <tr><td style={cell}>Плательщик — физлицо</td><td style={cellNum}>{fmtRub(p.personSum)}</td></tr>
            <tr><td style={cell}>Плательщик — компания (ДМС, договор)</td><td style={cellNum}>{fmtRub(p.companySum)}</td></tr>
          </tbody>
        </table>
      </Panel>

      <Panel title="Себестоимость">
        <table style={tableStyle}>
          <tbody>
            <tr><td style={cell}>Выручка за дни пребывания</td><td style={cellNum}>{fmtRub(s.revenue)}</td></tr>
            <tr><td style={cell}>Себестоимость там, где заполнена</td><td style={cellNum}>{fmtRub(s.cost)}</td></tr>
            <tr>
              <td style={cell}>Выручка по услугам без себестоимости</td>
              <td style={cellNum}>
                {fmtRub(s.revenueNoCost)} <Badge tone="warn">{fmtPct(s.noCostShare)} выручки</Badge>
              </td>
            </tr>
            <tr><td style={cell}>Услуг оказано</td><td style={cellNum}>{fmt(s.servicesCount)}</td></tr>
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

// ── Мелочи оформления ─────────────────────────────────────────────────────────

function Panel({ title, children }) {
  return (
    <div style={{ border: `1px solid ${GRID}`, borderRadius: 12, background: 'var(--rb-card-bg, var(--n-0))', padding: '14px 16px' }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--rb-text, var(--n-800))' }}>{title}</div>
      {children}
    </div>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 10, background: 'rgba(128,128,128,0.10)', flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)} style={{
          border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 7, fontSize: 13, fontFamily: 'inherit',
          fontWeight: value === o.key ? 600 : 400,
          background: value === o.key ? 'var(--rb-card-bg, #fff)' : 'transparent',
          color: 'inherit', boxShadow: value === o.key ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
        }}>{o.label}</button>
      ))}
    </div>
  );
}

function KpiCard({ label, value, sub, accent }) {
  return (
    <div style={{ flex: '1 1 180px', minWidth: 160, background: 'var(--n-0)', border: '1px solid var(--rb-border)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--rb-text-secondary)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent || 'var(--rb-text)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--rb-text-secondary)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const BADGE_TONES = {
  warn:   { background: '#fef3c7', color: '#92400e' },
  danger: { background: '#fee2e2', color: '#b91c1c' },
};
function Badge({ tone, children }) {
  return (
    <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600, ...BADGE_TONES[tone] }}>
      {children}
    </span>
  );
}

// Топ-список: горизонтальные столбики, подпись значения прямо у конца столбика —
// сравнивать позиции по длине быстрее, чем читать колонку чисел
function TopBars({ data, color, format, tipLabel }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34 + 20)}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 90, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} />
        <YAxis type="category" dataKey="name" width={230} tick={{ ...AXIS, fill: 'var(--rb-text, #1e293b)', fontSize: 12 }} axisLine={false} tickLine={false}
          tickFormatter={v => (v.length > 34 ? v.slice(0, 33) + '…' : v)} />
        <Tooltip cursor={{ fill: 'rgba(128,128,128,0.08)' }} formatter={(v) => [format(v), tipLabel]} />
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={20}>
          <LabelList dataKey="value" position="right" formatter={format} fill="var(--rb-text-secondary, #64748b)" fontSize={12} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DailyChart({ data, dataKey, color, tipLabel, format }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="short" tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={52} tickFormatter={v => fmt(v)} />
        <Tooltip cursor={{ fill: 'rgba(128,128,128,0.08)' }} formatter={(v) => [format(v), tipLabel]} />
        <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Таблица топа: первая колонка — название, остальные числовые
function RankTable({ head, rows, cells }) {
  if (!rows?.length) {
    return <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--rb-text-secondary)', fontSize: 13 }}>Нет данных</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>{head.map((h, i) => <th key={i} style={i ? cellHeadNum : cellHead}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cells(r).map((c, j) => <td key={j} style={j ? cellNum : cell}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
