import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import { botSubscribers } from '../../../services/api';

// Категориальная палитра (валидирована): цвет закреплён за каналом, не за порядком.
const PLATFORM_META = {
  telegram: { label: 'Telegram', color: '#2a78d6' },
  max:      { label: 'MAX',      color: '#7c3aed' },
};

const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const ddmm = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
function fmtPeriod(p, gran) {
  if (gran === 'day') { const [, m, d] = p.split('-'); return `${d}.${m}`; }
  if (gran === 'week') {
    const s = new Date(`${p}T00:00:00`); const e = new Date(s); e.setDate(s.getDate() + 6);
    return `${ddmm(s)}–${ddmm(e)}`;
  }
  const [y, mo] = p.split('-'); return `${MONTHS_RU[Number(mo) - 1]} ${y.slice(2)}`;
}
const shortOrg = (name) => name.replace('Медцентр ', '');
// Локальная дата (без сдвига таймзоны, как у toISOString)
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Авто-детализация под длину периода
function autoGran(from, to) {
  if (!from || !to) return 'month';
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  if (days <= 62) return 'day';
  if (days <= 240) return 'week';
  return 'month';
}
const GRAN_LABEL = { day: 'по дням', week: 'по неделям', month: 'по месяцам' };

// Логотипы медцентров (public/lab-logos)
const LOGOS = {
  'alfa': 'alfa.png',
  'alfa-deti': 'alfa-kids.png',
  'alfa-liniya': 'alfa-liniya.png',
  'alfa-prof': 'alfa-prof.jpg',
  'alfa-smile': 'alfa-smile.jpeg',
  'alfa-3k': 'alfa-3k.png',
};
const logoSrc = (key) => `${process.env.PUBLIC_URL || ''}/lab-logos/${LOGOS[key]}`;

const AXIS = { fill: 'var(--rb-text-secondary, #64748b)', fontSize: 12 };
const GRID = 'var(--rb-border, #e2e8f0)';

const PLATFORM_TABS = [{ key: 'all', label: 'Все каналы' }, { key: 'telegram', label: 'Telegram' }, { key: 'max', label: 'MAX' }];
const GRAN_TABS = [{ key: 'day', label: 'Дни' }, { key: 'week', label: 'Недели' }, { key: 'month', label: 'Месяцы' }];

export default function BotSubscribers({ periodStart, periodEnd }) {
  const [platform, setPlatform] = useState('all');
  const [granOverride, setGranOverride] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [overlap, setOverlap] = useState(null);
  const [prevTotal, setPrevTotal] = useState(null);

  // Период берём из общего селектора StepKpi (локальная дата — без сдвига таймзоны)
  const dateFrom = periodStart ? isoLocal(periodStart) : '';
  const dateTo = periodEnd ? isoLocal(periodEnd) : '';
  const effGran = granOverride || autoGran(dateFrom, dateTo);

  // При смене периода сбрасываем ручной выбор детализации на авто
  useEffect(() => { setGranOverride(null); }, [dateFrom, dateTo]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    const params = { granularity: effGran };
    if (dateFrom) params.from = dateFrom;
    if (dateTo) params.to = dateTo;
    botSubscribers.stats(params)
      .then(res => { if (alive) setData(res.data); })
      .catch(() => { if (alive) setError('Не удалось загрузить статистику подписчиков'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [dateFrom, dateTo, effGran]);

  // Экосистема: распределение по числу медцентров за выбранный период и канал.
  useEffect(() => {
    let alive = true;
    const params = {};
    if (dateFrom) params.from = dateFrom;
    if (dateTo) params.to = dateTo;
    if (platform === 'telegram' || platform === 'max') params.platform = platform;
    botSubscribers.overlap(params)
      .then(res => { if (alive) setOverlap(res.data); })
      .catch(() => { if (alive) setOverlap(null); });
    return () => { alive = false; };
  }, [dateFrom, dateTo, platform]);

  const visiblePlatforms = platform === 'all' ? ['telegram', 'max'] : [platform];

  // Итог за предыдущий равный по длине отрезок — для сравнения (▲/▼).
  useEffect(() => {
    if (!dateFrom || !dateTo) { setPrevTotal(null); return; }
    const fromD = new Date(`${dateFrom}T00:00:00`);
    const toD = new Date(`${dateTo}T00:00:00`);
    const days = Math.round((toD - fromD) / 86400000) + 1;
    const prevToD = new Date(fromD); prevToD.setDate(fromD.getDate() - 1);
    const prevFromD = new Date(fromD); prevFromD.setDate(fromD.getDate() - days);
    let alive = true;
    botSubscribers.stats({ from: isoLocal(prevFromD), to: isoLocal(prevToD), granularity: 'month' })
      .then(res => {
        if (!alive) return;
        const t = (res.data.rows || [])
          .filter(r => visiblePlatforms.includes(r.platform))
          .reduce((s, r) => s + r.count, 0);
        setPrevTotal(t);
      })
      .catch(() => { if (alive) setPrevTotal(null); });
    return () => { alive = false; };
  }, [dateFrom, dateTo, platform]);
  const gran = data?.granularity || effGran;

  const derived = useMemo(() => {
    if (!data) return null;
    const rows = data.rows.filter(r => visiblePlatforms.includes(r.platform));

    const orgData = data.organizations.map(o => {
      const rec = { key: o.key, short: shortOrg(o.name), telegram: 0, max: 0, total: 0 };
      for (const r of rows) if (r.organization === o.key) { rec[r.platform] += r.count; rec.total += r.count; }
      return rec;
    }).sort((a, b) => b.total - a.total);

    const periodData = data.periods.map(p => {
      const rec = { period: p, short: fmtPeriod(p, gran), telegram: 0, max: 0, total: 0 };
      for (const r of rows) if (r.period === p) { rec[r.platform] += r.count; rec.total += r.count; }
      return rec;
    });

    const cell = {}, orgTotals = {}, periodTotals = {};
    let grand = 0, maxCell = 0;
    for (const r of rows) {
      const k = `${r.period}|${r.organization}`;
      cell[k] = (cell[k] || 0) + r.count;
      if (cell[k] > maxCell) maxCell = cell[k];
      orgTotals[r.organization] = (orgTotals[r.organization] || 0) + r.count;
      periodTotals[r.period] = (periodTotals[r.period] || 0) + r.count;
      grand += r.count;
    }
    return { orgData, periodData, cell, orgTotals, periodTotals, grand, maxCell };
  }, [data, platform]); // eslint deps intentionally limited

  const empty = derived && derived.grand === 0;
  const rangeActive = dateFrom || dateTo;

  return (
    <div style={{ padding: '16px 20px 40px' }}>
      {/* Итог + переключатель канала */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {derived ? derived.grand.toLocaleString('ru-RU') : '—'}
          </span>
          <span style={{ color: 'var(--rb-text-secondary, #64748b)', fontSize: 14 }}>
            подписчиков{platform !== 'all' ? ` · ${PLATFORM_META[platform].label}` : ''}
          </span>
          {derived && prevTotal != null && <DeltaBadge current={derived.grand} prev={prevTotal} />}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--rb-text-secondary, #64748b)' }}>Детализация:</span>
            <Segmented options={GRAN_TABS} value={effGran} onChange={setGranOverride} />
          </div>
          <Segmented options={PLATFORM_TABS} value={platform} onChange={setPlatform} />
        </div>
      </div>

      {/* Легенда каналов */}
      {platform === 'all' && (
        <div style={{ display: 'flex', gap: 18, marginBottom: 8 }}>
          {['telegram', 'max'].map(p => (
            <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--rb-text-secondary, #64748b)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: PLATFORM_META[p].color }} />
              {PLATFORM_META[p].label}
            </span>
          ))}
        </div>
      )}

      {loading && <div style={{ opacity: 0.6, padding: 20 }}>Загрузка…</div>}
      {error && <div style={{ color: 'var(--rb-danger, #dc2626)', padding: 20 }}>{error}</div>}


      {!loading && !error && derived && (empty ? (
        <div style={{ opacity: 0.6, padding: 20 }}>Нет данных за выбранный период.</div>
      ) : (
        <div style={{ display: 'grid', gap: 20 }}>
          {/* Сравнение медцентров */}
          <Panel title={`Подписчики по медцентрам${rangeActive ? ' за период' : ''}`}>
            <ResponsiveContainer width="100%" height={Math.max(200, derived.orgData.length * 46)}>
              <BarChart data={derived.orgData} layout="vertical" margin={{ left: 4, right: 40, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="short" width={104} tick={{ ...AXIS, fill: 'var(--rb-text, #1e293b)', fontSize: 13 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(128,128,128,0.08)' }} content={<ChartTip />} />
                {visiblePlatforms.map((p, i) => {
                  const last = i === visiblePlatforms.length - 1;
                  return (
                    <Bar key={p} dataKey={p} stackId="s" fill={PLATFORM_META[p].color} radius={last ? [0, 4, 4, 0] : 0} maxBarSize={30}>
                      {last && <LabelList dataKey="total" position="right" fill="var(--rb-text-secondary, #64748b)" fontSize={12} />}
                    </Bar>
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          {/* Экосистема: на сколько медцентров подписан человек */}
          {overlap && overlap.totalPeople > 0 && <EcosystemPanel overlap={overlap} />}

          {/* Динамика по периодам */}
          <Panel title={`Динамика подписок ${GRAN_LABEL[gran]}`}>
            <ResponsiveContainer width="100%" height={280}>
              {gran === 'month' ? (
                <BarChart data={derived.periodData} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="short" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'rgba(128,128,128,0.08)' }} content={<ChartTip />} />
                  {visiblePlatforms.map(p => (
                    <Bar key={p} dataKey={p} fill={PLATFORM_META[p].color} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  ))}
                </BarChart>
              ) : (
                <LineChart data={derived.periodData} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="short" tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                  <Tooltip content={<ChartTip />} />
                  {visiblePlatforms.map(p => (
                    <Line key={p} type="monotone" dataKey={p} stroke={PLATFORM_META[p].color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </Panel>

          {/* Детализация: период × медцентр */}
          <Panel title="Детализация">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640, fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left', minWidth: 84 }}>{gran === 'day' ? 'Дата' : gran === 'week' ? 'Неделя' : 'Месяц'}</th>
                    {derived.orgData.map(o => (
                      <th key={o.key} style={thStyle}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          {LOGOS[o.key] && (
                            <img src={logoSrc(o.key)} alt="" style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 4 }}
                                 onError={e => { e.currentTarget.style.display = 'none'; }} />
                          )}
                          <span>{o.short}</span>
                        </div>
                      </th>
                    ))}
                    <th style={{ ...thStyle, fontWeight: 700 }}>Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {data.periods.map((p, i) => (
                    <tr key={p} style={{ background: i % 2 ? 'rgba(128,128,128,0.04)' : 'transparent' }}>
                      <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 500 }}>{fmtPeriod(p, gran)}</td>
                      {derived.orgData.map(o => {
                        const v = derived.cell[`${p}|${o.key}`] || 0;
                        return (
                          <td key={o.key} style={{ ...tdStyle, background: heat(v, derived.maxCell) }}>
                            {v || <span style={{ opacity: 0.25 }}>—</span>}
                          </td>
                        );
                      })}
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{derived.periodTotals[p] || 0}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${GRID}`, fontWeight: 700 }}>
                    <td style={{ ...tdStyle, textAlign: 'left' }}>Итого</td>
                    {derived.orgData.map(o => <td key={o.key} style={tdStyle}>{derived.orgTotals[o.key] || 0}</td>)}
                    <td style={tdStyle}>{derived.grand}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>
        </div>
      ))}
    </div>
  );
}

// Разница с предыдущим равным периодом: ▲ рост (зелёный) / ▼ падение (красный).
function DeltaBadge({ current, prev }) {
  const diff = current - prev;
  const pct = prev > 0 ? Math.round((diff / prev) * 100) : null;
  const color = diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : 'var(--rb-text-secondary, #64748b)';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '→';
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  const abs = Math.abs(diff);
  return (
    <span
      title="К предыдущему периоду такой же длины"
      style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, fontSize: 14, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ fontSize: 12 }}>{arrow}</span>
      {sign}{abs.toLocaleString('ru-RU')}
      {pct != null && <span style={{ opacity: 0.8 }}>({sign}{Math.abs(pct)}%)</span>}
    </span>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 10, background: 'rgba(128,128,128,0.10)' }}>
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)} style={{
          border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 7, fontSize: 14,
          fontWeight: value === o.key ? 600 : 400,
          background: value === o.key ? 'var(--rb-card-bg, #fff)' : 'transparent',
          color: 'inherit', boxShadow: value === o.key ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
        }}>{o.label}</button>
      ))}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ border: `1px solid ${GRID}`, borderRadius: 12, background: 'var(--rb-card-bg, #fff)', padding: '14px 16px' }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--rb-text, #1e293b)' }}>{title}</div>
      {children}
    </div>
  );
}

// Секвенциальная палитра одного тона (голубой → тёмно-синий): больше центров = насыщеннее.
const CENTERS_RAMP = ['#cfe0f7', '#9dc3ef', '#6ba3e5', '#3d82d6', '#245fac', '#123f7a'];
const centersWord = (n) => (n === 1 ? 'центр' : n >= 5 ? 'центров' : 'центра');

function EcosystemPanel({ overlap }) {
  const chart = useMemo(() => {
    if (!overlap || !overlap.totalPeople) return null;
    const total = overlap.totalPeople;
    return overlap.distribution.map(d => ({
      centers: d.centers,
      label: `${d.centers} ${centersWord(d.centers)}`,
      subscribers: d.subscribers,
      pct: total ? (d.subscribers / total) * 100 : 0,
    }));
  }, [overlap]);

  return (
    <Panel title="Экосистема">
      {!chart ? (
        <div style={{ opacity: 0.6, padding: '8px 0' }}>Нет данных.</div>
      ) : (
        <>
          {/* Ключевые цифры */}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
            <Stat
              value={`${((overlap.multiCenter / overlap.totalPeople) * 100).toFixed(0)}%`}
              label="пользуются 2+ медцентрами"
            />
            <Stat value={overlap.avgCenters.toFixed(2)} label="медцентров на человека в среднем" />
            <Stat value={overlap.totalPeople.toLocaleString('ru-RU')} label="опознанных подписчиков" />
          </div>

          <ResponsiveContainer width="100%" height={chart.length * 40 + 16}>
            <BarChart data={chart} layout="vertical" margin={{ left: 4, right: 64, top: 4, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={92}
                     tick={{ ...AXIS, fill: 'var(--rb-text, #1e293b)', fontSize: 13 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(128,128,128,0.08)' }} content={<EcoTip />} />
              <Bar dataKey="subscribers" radius={[0, 4, 4, 0]} maxBarSize={26}>
                {chart.map(d => <Cell key={d.centers} fill={CENTERS_RAMP[d.centers - 1] || CENTERS_RAMP[CENTERS_RAMP.length - 1]} />)}
                <LabelList dataKey="subscribers" content={<EcoLabel data={chart} />} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </Panel>
  );
}

function Stat({ value, label }) {
  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--rb-text-secondary, #64748b)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

// Прямая подпись: «count · pct%» справа от столбца
function EcoLabel({ x, y, width, height, value, index, data }) {
  if (!value) return null;
  const row = data[index];
  return (
    <text x={x + width + 8} y={y + height / 2} dy={4} fontSize={12} fill="var(--rb-text, #1e293b)">
      {value.toLocaleString('ru-RU')} · {row.pct.toFixed(0)}%
    </text>
  );
}

function EcoTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div style={{ background: 'var(--rb-card-bg, #fff)', border: `1px solid ${GRID}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rb-text, #1e293b)' }}>{row.label}</div>
      <div style={{ color: 'var(--rb-text-secondary, #64748b)' }}>
        Подписчиков: <b style={{ color: 'var(--rb-text, #1e293b)' }}>{row.subscribers.toLocaleString('ru-RU')}</b> · {row.pct.toFixed(1)}%
      </div>
    </div>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  const title = row.short || label;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{ background: 'var(--rb-card-bg, #fff)', border: `1px solid ${GRID}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rb-text, #1e293b)' }}>{title}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--rb-text-secondary, #64748b)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color || p.fill }} />
          {PLATFORM_META[p.dataKey]?.label || p.dataKey}: <b style={{ color: 'var(--rb-text, #1e293b)' }}>{p.value}</b>
        </div>
      ))}
      {payload.length > 1 && <div style={{ marginTop: 4, fontWeight: 600, color: 'var(--rb-text, #1e293b)' }}>Итого: {total}</div>}
    </div>
  );
}

function heat(v, max) {
  if (!v || !max) return 'transparent';
  const a = 0.08 + 0.42 * (v / max);
  return `rgba(42, 120, 214, ${a.toFixed(3)})`;
}

const tdStyle = { padding: '7px 10px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const thStyle = { ...tdStyle, fontWeight: 600, color: 'var(--rb-text-secondary, #64748b)', borderBottom: `2px solid ${GRID}` };
