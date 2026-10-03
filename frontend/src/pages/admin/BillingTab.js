import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  RefreshCw, Receipt, Download, Check, Clock, AlertTriangle, Loader2, CheckCircle2
} from 'lucide-react';
import { imobisBilling as api } from '../../services/api';
import MedCenterMark from '../../components/openline/MedCenterMark';
import toast from 'react-hot-toast';
import './BillingTab.css';

/**
 * Счета Имобиса (ver. 9.33).
 *
 * Шесть медцентров — шесть учётных записей у Имобиса, и пополнять каждую
 * приходилось руками: войти, выписать счёт, скачать PDF. Хуже того, кабинет при
 * смене аккаунта держал сессию старого сайта, и счёт молча выписывался на
 * предыдущий — приходилось каждый раз открывать окно инкогнито.
 *
 * Режим ручной, и это решение заказчика: сумму видит и вписывает человек,
 * сервер только подсказывает её и обходит кабинеты. Подсказка считается на
 * сервере (services/imobisBilling.js) — здесь её не повторяем, чтобы формула
 * жила в одном месте. Показывается она подсказкой в пустом поле суммы, а не
 * отдельной кнопкой: так решил заказчик — карточка должна быть тише.
 *
 * Цвет серии — фирменный цвет медцентра из его настроек, тот же, что у знака
 * медцентра в открытой линии. Сначала стояла проверенная категориальная
 * палитра, но заказчик попросил узнаваемые цвета, а не «случайные». Различать
 * медцентры по одному цвету при этом не приходится: в легенде и в шапке карточки
 * стоит логотип. Палитра осталась запасной — для медцентра без цвета.
 */

const FALLBACK = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];

const rub = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const shortDay = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const WEEKDAY = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const weekdayOf = (iso) => WEEKDAY[new Date(`${iso}T12:00:00Z`).getUTCDay()];

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/**
 * Логотип медцентра в кольце цвета его серии. Точку цвета рядом заказчик
 * попросил заменить логотипом, а связь «этот медцентр — эти столбики» должна
 * остаться: её и держит кольцо.
 */
function Mark({ branch, large = false }) {
  return (
    <span className={`bill-ring ${large ? 'lg' : ''}`} style={{ '--bill-ring': branch.seriesColor }}>
      <MedCenterMark medCenter={branch} className="bill-mark" />
    </span>
  );
}

// ── График сети ───────────────────────────────────────────────────────────

function NetworkTip({ active, payload, label, branches }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="bill-tip">
      <div className="bill-tip-head">{shortDay(label)}, {weekdayOf(label)}</div>
      {branches.map(b => {
        const p = payload.find(x => x.dataKey === b.medCenterId);
        if (!p) return null;
        return (
          <div key={b.medCenterId} className="bill-tip-row">
            <span className="bill-dot" style={{ background: b.seriesColor }} />
            <span className="bill-tip-name">{b.name}</span>
            <span className="bill-tip-val">{rub(p.value || 0)}</span>
          </div>
        );
      })}
      {payload.length > 1 && (
        <div className="bill-tip-row total">
          <span className="bill-tip-name">Всего</span>
          <span className="bill-tip-val">{rub(total)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Легенда слева и кликабельная: нажатие прячет медцентр с графика. Так
 * смотрят один медцентр отдельно — спрятать остальных быстрее, чем искать
 * его столбик в стопке из шести.
 */
function NetworkChart({ branches, from, today }) {
  const withDays = branches.filter(b => b.days.length);
  const [hidden, setHidden] = useState(() => new Set());
  const shown = withDays.filter(b => !hidden.has(b.medCenterId));

  const rows = useMemo(() => {
    const out = [];
    const byBranch = new Map(withDays.map(b => [b.medCenterId, new Map(b.days.map(d => [d.day, d.cost]))]));
    for (let d = from; d < today; d = addDays(d, 1)) {
      const row = { day: d };
      for (const b of withDays) {
        const v = byBranch.get(b.medCenterId).get(d);
        if (v != null) row[b.medCenterId] = v;
      }
      out.push(row);
    }
    return out;
  }, [withDays, from, today]);

  if (!withDays.length) return null;

  const toggle = (id) => setHidden(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <section className="ola-card bill-chart-card">
      <div className="ola-card-body bill-chart">
        <ul className="bill-legend">
          {withDays.map(b => {
            const off = hidden.has(b.medCenterId);
            return (
              <li key={b.medCenterId}>
                <button
                  className={`bill-legend-item ${off ? 'off' : ''}`}
                  aria-pressed={!off}
                  onClick={() => toggle(b.medCenterId)}
                >
                  <Mark branch={b} />
                  <span className="bill-legend-name">{b.name}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="bill-chart-plot">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} barCategoryGap="18%">
              <CartesianGrid vertical={false} stroke="var(--border-light)" />
              <XAxis
                dataKey="day" tickFormatter={shortDay} minTickGap={18}
                tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false}
              />
              <YAxis
                width={52} tickFormatter={v => v.toLocaleString('ru-RU')}
                tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(128,128,128,0.08)' }}
                content={<NetworkTip branches={shown} />}
              />
              {shown.map((b, i) => (
                <Bar
                  key={b.medCenterId}
                  dataKey={b.medCenterId}
                  stackId="s"
                  fill={b.seriesColor}
                  stroke="var(--bg-primary)"
                  strokeWidth={1}
                  radius={i === shown.length - 1 ? [4, 4, 0, 0] : 0}
                  maxBarSize={26}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

// ── Карточка медцентра ────────────────────────────────────────────────────

function MiniTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { day, cost, messages } = payload[0].payload;
  return (
    <div className="bill-tip">
      <div className="bill-tip-head">{shortDay(day)}, {weekdayOf(day)}</div>
      <div className="bill-tip-row">
        <span className="bill-tip-name">{messages.toLocaleString('ru-RU')} сообщ.</span>
        <span className="bill-tip-val">{rub(cost)}</span>
      </div>
    </div>
  );
}

const JOB_VIEW = {
  queued:  { icon: Clock,         cls: 'wait', text: 'в очереди' },
  running: { icon: Loader2,       cls: 'wait', text: 'выписывается…' },
  done:    { icon: Check,         cls: 'ok',   text: 'счёт выписан' },
  error:   { icon: AlertTriangle, cls: 'bad',  text: '' }
};

function BranchBill({ branch, rules, amount, onAmount, busy, onDownload }) {
  const rec = branch.recommendation;
  const days = branch.days.slice(-31);
  const enough = rec && rec.amount === 0;

  let tone = 'ok';
  if (branch.daysLeft != null && rec) {
    if (branch.daysLeft < rules.payLagDays) tone = 'bad';
    else if (branch.daysLeft < rec.horizon) tone = 'wait';
  }

  const job = branch.job && JOB_VIEW[branch.job.state];
  const JobIcon = job?.icon;

  return (
    <section className="ola-card bill-card">
      <header>
        <Mark branch={branch} large />
        <h3>{branch.name}</h3>
        {branch.cabinetReady
          ? <span className="ola-badge">{branch.login}</span>
          : <span className="ola-badge warn">нет входа в кабинет</span>}
        {enough && (
          <span className="bill-head-ok" title="Пополнять не нужно" aria-label="Пополнять не нужно">
            <CheckCircle2 size={18} />
          </span>
        )}
      </header>

      <div className="ola-card-body">
        <div className="bill-figures">
          <div>
            <div className="bill-balance">
              {branch.balance != null ? rub(branch.balance) : '—'}
            </div>
            {branch.balanceError && <div className="ola-bot-state bad">{branch.balanceError}</div>}
          </div>
          {branch.daysLeft != null && (
            <span className={`ola-badge ${tone}`}>
              {/* С дробью форма всегда «дня»: «21,5 дня», а не «21,5 день». */}
              ≈ {branch.daysLeft.toLocaleString('ru-RU')} {Number.isInteger(branch.daysLeft)
                ? plural(branch.daysLeft, 'день', 'дня', 'дней')
                : 'дня'}
            </span>
          )}
        </div>

        <div className="bill-sub">
          {branch.avgDaily != null
            ? <>в среднем {rub(branch.avgDaily)} в день · за {branch.avgDays} {plural(branch.avgDays, 'день', 'дня', 'дней')}</>
            : 'расходов ещё нет'}
        </div>

        {days.length > 0 && (
          <div className="bill-mini">
            <ResponsiveContainer width="100%" height={56}>
              <BarChart data={days} margin={{ left: 0, right: 0, top: 4, bottom: 0 }} barCategoryGap="14%">
                <Tooltip cursor={{ fill: 'rgba(128,128,128,0.08)' }} content={<MiniTip />} />
                <Bar dataKey="cost" fill={branch.seriesColor} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="bill-order">
          <div className="bill-amount">
            <input
              className="ola-input" inputMode="numeric"
              placeholder={rec && rec.amount > 0 ? rec.amount.toLocaleString('ru-RU') : 'сумма'}
              title={rec && rec.amount > 0
                ? `${rec.horizon} ${plural(rec.horizon, 'день', 'дня', 'дней')} расхода + ${Math.round(rules.reserve * 100)}%, за вычетом остатка${branch.unpaid ? ' и неоплаченных счетов' : ''}`
                : undefined}
              disabled={!branch.cabinetReady || busy}
              value={amount}
              onChange={e => onAmount(e.target.value.replace(/\D/g, '').slice(0, 7))}
            />
            <span>₽</span>
          </div>
        </div>

        {job && (
          <div className={`ola-bot-state ${job.cls} bill-job`}>
            <JobIcon size={13} className={branch.job.state === 'running' ? 'bill-spin' : ''} />
            {branch.job.state === 'error' ? branch.job.error : job.text}
          </div>
        )}
        {branch.sync && !branch.sync.ok && (
          <div className="ola-bot-state bad bill-job">
            <AlertTriangle size={13} /> {branch.sync.error}
          </div>
        )}

        {branch.invoices.length > 0 && (
          <ul className="bill-invoices">
            {branch.invoices.map(inv => (
              <li key={inv.id}>
                <span className="bill-inv-num">{inv.number}</span>
                <span className="bill-inv-sum">{rub(inv.amount)}</span>
                <span className={`ola-badge ${inv.paid ? 'ok' : 'wait'}`}>
                  {inv.paid ? 'оплачен' : 'не оплачен'}
                </span>
                <button className="ola-icon-btn" title="Скачать PDF" onClick={() => onDownload(inv)}>
                  <Download size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── Вкладка ───────────────────────────────────────────────────────────────

export default function BillingTab() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [amounts, setAmounts] = useState({});
  const [syncRequested, setSyncRequested] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data: next } = await api.overview();
      setData(next);
      setFailed(false);
      return next;
    } catch {
      toast.error('Не удалось загрузить счета');
      setFailed(true);
      return null;
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Пока сервер обходит кабинеты, спрашиваем его каждые три секунды: выписка и
  // обновление идут в фоне, и иначе об их конце не узнать.
  const busy = !!(data && (data.running.invoices || data.running.sync)) || syncRequested;
  useEffect(() => {
    if (!busy) return undefined;
    timer.current = setTimeout(async () => {
      const next = await load();
      if (next && !next.running.sync) setSyncRequested(false);
    }, 3000);
    return () => clearTimeout(timer.current);
  }, [busy, data, load]);

  // Когда выписка закончилась, вписанные суммы больше не нужны: оставленные,
  // они приглашали бы выписать то же самое второй раз.
  const wasInvoicing = useRef(false);
  useEffect(() => {
    const now = !!data?.running.invoices;
    if (wasInvoicing.current && !now) {
      const failedIds = new Set(data.branches.filter(b => b.job?.state === 'error').map(b => b.medCenterId));
      setAmounts(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => failedIds.has(id))));
      if (failedIds.size) toast.error(`Не выписано: ${failedIds.size}`);
      else toast.success('Счета выписаны');
    }
    wasInvoicing.current = now;
  }, [data]);

  // Цвет серии считаем один раз здесь, чтобы график, легенда и мини-график
  // карточки не разошлись в выборе запасного цвета.
  const branches = useMemo(() => (data?.branches || []).map((b, i) => ({
    ...b,
    seriesColor: b.color || FALLBACK[i % FALLBACK.length]
  })), [data]);

  const sync = async () => {
    try {
      await api.sync();
      setSyncRequested(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось запустить обновление');
    }
  };

  const items = Object.entries(amounts)
    .map(([medCenterId, v]) => ({ medCenterId, amount: Number(v) }))
    .filter(i => i.amount > 0);
  const total = items.reduce((s, i) => s + i.amount, 0);

  const createInvoices = async () => {
    const names = items.map(i => branches.find(b => b.medCenterId === i.medCenterId)?.name).join(', ');
    if (!window.confirm(`Выписать ${items.length} ${plural(items.length, 'счёт', 'счёта', 'счетов')} на ${rub(total)}?\n${names}`)) return;
    try {
      await api.createInvoices(items);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось запустить выписку');
    }
  };

  const download = async (inv) => {
    try {
      const { data: blob } = await api.invoicePdf(inv.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Счет ${inv.number.replace('/', '_')} в системе смс-рассылок Imobis.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Не удалось скачать счёт');
    }
  };

  // Без этой развилки упавшая загрузка выглядела бы вечной: спиннер крутится,
  // и непонятно, ждать или обновлять страницу.
  if (!data && failed) {
    return (
      <div className="bill-loading">
        <button className="ola-btn" onClick={load}><RefreshCw size={14} /> Повторить</button>
      </div>
    );
  }
  if (!data) return <div className="bill-loading"><Loader2 size={18} className="bill-spin" /></div>;

  if (!branches.length) {
    return (
      <div className="ola-card"><div className="ola-card-body bill-empty">
        Ни у одного медцентра не задан счёт Имобиса — вкладка «Рассылка», карточка медцентра.
      </div></div>
    );
  }

  const lastSync = branches.map(b => b.sync?.at).filter(Boolean).sort().pop();

  return (
    <div className="bill-tab">
      <div className="bill-toolbar">
        {lastSync && (
          <span className="bill-muted">
            {new Date(lastSync).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <button className="ola-btn" onClick={sync} disabled={busy}>
          <RefreshCw size={14} className={data.running.sync || syncRequested ? 'bill-spin' : ''} />
          {data.running.sync || syncRequested ? 'Обновляется…' : 'Обновить'}
        </button>
        <button className="ola-btn primary" onClick={createInvoices} disabled={!items.length || busy}>
          <Receipt size={14} />
          {items.length ? `Выписать ${items.length} · ${rub(total)}` : 'Выписать счета'}
        </button>
      </div>

      <NetworkChart branches={branches} from={data.from} today={data.today} />

      <div className="bill-grid">
        {branches.map(b => (
          <BranchBill
            key={b.medCenterId}
            branch={b}
            rules={data.rules}
            amount={amounts[b.medCenterId] || ''}
            onAmount={v => setAmounts(prev => ({ ...prev, [b.medCenterId]: v }))}
            busy={!!data.running.invoices}
            onDownload={download}
          />
        ))}
      </div>
    </div>
  );
}
