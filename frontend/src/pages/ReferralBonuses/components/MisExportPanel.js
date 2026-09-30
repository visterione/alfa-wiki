import React, { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { rbMisExport } from '../../../services/api';
import DateRangePicker from './DateRangePicker';

/**
 * Выгрузка услуг из МИС прямо в источники (ver. 9.12).
 *
 * Заменяет ручной ритуал: восемь выгрузок в «Кассе → Выгрузке по услугам» и
 * склейку файлов. Всё тяжёлое делает бэкенд; панель только задаёт период и
 * клиники, проводит вход в МИС и показывает, как идут дела.
 *
 * Вход — с кодом из письма, потому что учётка личная. Код вводится здесь же,
 * а сессия потом живёт около месяца, так что форма входа появляется редко.
 */

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const pad = n => String(n).padStart(2, '0');
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = iso => (iso ? iso.split('-').reverse().join('.') : '');
const fmtDateTime = iso => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// Зарплату считают за прошедший месяц — его и предлагаем по умолчанию.
function prevMonth() {
  const now = new Date();
  return {
    from: isoLocal(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    to: isoLocal(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
}

// То же правило, что у бэкенда: ровно месяц — «Сентябрь 2026», иначе даты.
function autoLabel(from, to) {
  if (!from || !to) return '';
  const f = new Date(from + 'T00:00:00');
  const last = isoLocal(new Date(f.getFullYear(), f.getMonth() + 1, 0));
  if (from.endsWith('-01') && to === last) return `${MONTHS[f.getMonth()]} ${f.getFullYear()}`;
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

function elapsed(fromIso, toIso) {
  if (!fromIso) return '';
  const s = Math.max(0, Math.round(((toIso ? new Date(toIso) : new Date()) - new Date(fromIso)) / 1000));
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${pad(s % 60)} с`;
}

const errText = e => e?.response?.data?.error || e?.message || 'Ошибка';

const inputStyle = {
  height: 32, border: '1px solid var(--rb-border-dark)', borderRadius: 7,
  padding: '0 10px', fontSize: 13, fontFamily: 'inherit',
  background: 'var(--n-0)', color: 'var(--rb-text)', outline: 'none', boxSizing: 'border-box',
};
const btn = (primary, disabled) => ({
  height: 32, padding: '0 14px', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', whiteSpace: 'nowrap',
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
  border: primary ? 'none' : '1px solid var(--rb-border-dark)',
  background: primary ? 'var(--rb-primary)' : 'var(--n-0)',
  color: primary ? '#fff' : 'var(--rb-text)',
});
const linkBtn = {
  border: 'none', background: 'none', padding: 0, fontSize: 12, fontFamily: 'inherit',
  color: 'var(--rb-primary)', cursor: 'pointer', textDecoration: 'underline dotted',
};
const label = { fontSize: 11, color: 'var(--rb-text-secondary)' };

const PART_STATUS = {
  waiting: 'ожидает',
  running: 'выгружается',
  done: 'готово',
  failed: 'ошибка',
};

const RESEND_COOLDOWN_S = 60;

export default function MisExportPanel({ onDone }) {
  const [info, setInfo] = useState(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('credentials'); // credentials | code
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const init = prevMonth();
  const [dateFrom, setDateFrom] = useState(init.from);
  const [dateTo, setDateTo] = useState(init.to);
  const [dateType, setDateType] = useState(2);
  const [clinicIds, setClinicIds] = useState(null); // null — пока не пришёл список: все
  const [periodLabel, setPeriodLabel] = useState('');

  const lastStatus = useRef(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const { data } = await rbMisExport.state();
      setInfo(data);
      if (data.pendingCode) { setLoginOpen(true); setStep('code'); }
      setClinicIds(prev => prev ?? data.clinics.map(c => c.id));
      return data;
    } catch (e) {
      toast.error(`Выгрузка из МИС: ${errText(e)}`);
      return null;
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const job = info?.job;
  const jobActive = job && ['running', 'merging'].includes(job.status);

  // Опрос только пока задача идёт: выгрузка месяца — это минуты, и вкладка
  // должна показывать, на какой клинике робот сейчас.
  useEffect(() => {
    if (!jobActive) return undefined;
    const t = setInterval(() => { load(); tick(n => n + 1); }, 3000);
    return () => clearInterval(t);
  }, [jobActive, load]);

  // Итог задачи сообщаем один раз — в момент, когда она закончилась, а не при
  // каждом открытии вкладки.
  useEffect(() => {
    if (!job) return;
    const prev = lastStatus.current;
    lastStatus.current = `${job.id}:${job.status}`;
    const wasActive = prev === `${job.id}:running` || prev === `${job.id}:merging`;
    if (!wasActive) return;
    if (job.status === 'done') {
      toast.success(`Источник «${job.params.periodLabel}» добавлен: ${job.rows.toLocaleString('ru-RU')} строк`);
      onDone?.();
    } else if (job.status === 'needs_login') {
      toast.error('Сессия МИС закончилась — войдите заново и запустите выгрузку ещё раз');
      setLoginOpen(true); setStep('credentials');
    } else if (job.status === 'failed') {
      toast.error(`Выгрузка остановилась: ${job.error}`);
    }
  }, [job, onDone]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const session = info?.session || { connected: false };

  const submitCredentials = async () => {
    if (!login.trim() || !password) { toast.error('Введите логин и пароль МИС'); return; }
    setBusy(true);
    try {
      const { data } = await rbMisExport.login(login.trim(), password);
      setPassword('');
      if (data.step === 'done') {
        toast.success('Вход в МИС выполнен');
        setLoginOpen(false);
      } else {
        setStep('code');
        setResendIn(RESEND_COOLDOWN_S);
      }
      await load();
    } catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };

  const submitCode = async () => {
    if (!code.trim()) { toast.error('Введите код из письма'); return; }
    setBusy(true);
    try {
      await rbMisExport.code(code.trim());
      toast.success('Вход в МИС выполнен');
      setLoginOpen(false); setStep('credentials'); setCode('');
      await load();
    } catch (e) {
      toast.error(errText(e));
      if (e?.response?.data?.restart) { setStep('credentials'); setCode(''); }
    } finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true);
    try {
      await rbMisExport.resend();
      toast.success('Код отправлен ещё раз');
      setResendIn(RESEND_COOLDOWN_S);
    } catch (e) {
      toast.error(errText(e));
      if (e?.response?.data?.restart) setStep('credentials');
    } finally { setBusy(false); }
  };

  const cancelLogin = async () => {
    setLoginOpen(false); setStep('credentials'); setCode(''); setPassword('');
    await rbMisExport.cancelLogin().catch(() => {});
  };

  const check = async () => {
    setBusy(true);
    try {
      const { data } = await rbMisExport.checkSession();
      if (data.alive) toast.success('МИС пускает — выгружать можно');
      else toast.error('Сессия МИС закончилась — нужно войти заново');
      await load();
    } catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };

  const forget = async () => {
    if (!window.confirm('Забыть вход в МИС? Для следующей выгрузки понадобится снова ввести пароль и код.')) return;
    await rbMisExport.forget().catch(e => toast.error(errText(e)));
    await load();
  };

  const toggleClinic = id => setClinicIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));

  const start = async () => {
    if (!dateFrom || !dateTo) { toast.error('Укажите период'); return; }
    if (!clinicIds?.length) { toast.error('Выберите хотя бы одну клинику'); return; }
    setBusy(true);
    try {
      const order = info.clinics.map(c => c.id).filter(id => clinicIds.includes(id));
      await rbMisExport.start({ dateFrom, dateTo, dateType, clinicIds: order, periodLabel: periodLabel.trim() });
      lastStatus.current = null;
      await load();
    } catch (e) {
      toast.error(errText(e));
      if (e?.response?.data?.code === 'MIS_SESSION_EXPIRED') { setLoginOpen(true); setStep('credentials'); await load(); }
    } finally { setBusy(false); }
  };

  const cancelJob = async () => {
    if (!window.confirm('Остановить выгрузку? Уже скачанное будет выброшено.')) return;
    await rbMisExport.cancel().catch(e => toast.error(errText(e)));
    await load();
  };

  if (!info) return null;

  const statusLine = session.connected
    ? <>Вход в МИС: <b>{session.login}</b>{session.connectedAt && <> · с {fmtDateTime(session.connectedAt)}</>}</>
    : session.expiredAt
      ? <>Сессия МИС <b>{session.login}</b> закончилась {fmtDateTime(session.expiredAt)}</>
      : <>Вход в МИС не выполнен</>;

  return (
    <div style={{ margin: '0 12px 8px', padding: '12px 16px', background: 'var(--n-50)', borderRadius: 10, border: '1px solid var(--rb-border)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--rb-text-secondary)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Выгрузка из МИС
        </div>
        <div style={{ fontSize: 12, color: session.connected ? 'var(--rb-text)' : 'var(--red-500)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: session.connected ? 'var(--green-600)' : 'var(--red-500)', flexShrink: 0 }} />
          <span>{statusLine}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
          {session.connected && !loginOpen && <button style={linkBtn} disabled={busy} onClick={check}>Проверить</button>}
          {!loginOpen && <button style={linkBtn} onClick={() => { setLoginOpen(true); setStep('credentials'); }}>{session.connected ? 'Войти заново' : 'Войти'}</button>}
          {session.connected && !loginOpen && <button style={linkBtn} onClick={forget}>Выйти</button>}
        </div>
      </div>

      {/* ── Вход ── */}
      {loginOpen && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginBottom: 10 }}>
          {step === 'credentials' ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Логин МИС</span>
                <input style={{ ...inputStyle, width: 170 }} value={login} autoComplete="off" onChange={e => setLogin(e.target.value)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Пароль</span>
                <input style={{ ...inputStyle, width: 170 }} type="password" value={password} autoComplete="new-password"
                  onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitCredentials()} />
              </div>
              <button style={btn(true, busy)} disabled={busy} onClick={submitCredentials}>{busy ? 'Вход…' : 'Получить код'}</button>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Код из письма</span>
                <input style={{ ...inputStyle, width: 130, letterSpacing: '.1em' }} value={code} autoFocus inputMode="numeric" autoComplete="one-time-code"
                  onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitCode()} />
              </div>
              <button style={btn(true, busy)} disabled={busy} onClick={submitCode}>{busy ? 'Проверка…' : 'Войти'}</button>
              <button style={btn(false, busy || resendIn > 0)} disabled={busy || resendIn > 0} onClick={resend}>
                {resendIn > 0 ? `Прислать ещё раз · ${resendIn} с` : 'Прислать ещё раз'}
              </button>
            </>
          )}
          <button style={btn(false, false)} onClick={cancelLogin}>Отмена</button>
        </div>
      )}

      {/* ── Параметры ── */}
      {session.connected && !jobActive && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={label}>Период</span>
              <DateRangePicker dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={label}>Считать</span>
              <select style={{ ...inputStyle, width: 190 }} value={dateType} onChange={e => setDateType(Number(e.target.value))}>
                <option value={2}>по дате оплаты</option>
                <option value={1}>по дате выставления счёта</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={label}>Название</span>
              <input style={{ ...inputStyle, width: 170 }} value={periodLabel} placeholder={autoLabel(dateFrom, dateTo)} onChange={e => setPeriodLabel(e.target.value)} />
            </div>
            <button style={btn(true, busy)} disabled={busy} onClick={start}>Выгрузить</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {info.clinics.map(c => {
              const on = clinicIds?.includes(c.id);
              return (
                <button key={c.id} onClick={() => toggleClinic(c.id)}
                  style={{ height: 26, padding: '0 10px', border: '1px solid var(--rb-border-dark)', borderRadius: 20, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', background: on ? 'var(--rb-primary)' : 'var(--n-0)', color: on ? '#fff' : 'var(--rb-text-secondary)' }}>
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Ход выгрузки ── */}
      {job && (
        <div style={{ marginTop: session.connected && !jobActive ? 12 : 0, paddingTop: session.connected && !jobActive ? 10 : 0, borderTop: session.connected && !jobActive ? '1px solid var(--rb-border)' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, marginBottom: 6, flexWrap: 'wrap' }}>
            <b style={{ color: 'var(--rb-text)' }}>{job.params.periodLabel}</b>
            <span style={{ color: 'var(--rb-text-secondary)' }}>
              {fmtDate(job.params.dateFrom)} – {fmtDate(job.params.dateTo)} · {job.params.dateType === 1 ? 'по дате выставления' : 'по дате оплаты'}
              {job.startedBy && <> · {job.startedBy}</>} · {elapsed(job.startedAt, job.finishedAt)}
            </span>
            <span style={{ marginLeft: 'auto', fontWeight: 600, color: job.status === 'done' ? 'var(--green-600)' : ['failed', 'needs_login'].includes(job.status) ? 'var(--red-500)' : 'var(--rb-text)' }}>
              {{
                running: 'Идёт выгрузка',
                merging: 'Склеиваю файлы',
                done: `Готово · ${job.rows?.toLocaleString('ru-RU')} строк в источниках`,
                failed: 'Остановилась с ошибкой',
                needs_login: 'Нужен новый вход в МИС',
                cancelled: 'Остановлена',
              }[job.status]}
            </span>
            {jobActive && <button style={btn(false, false)} onClick={cancelJob}>Остановить</button>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 4 }}>
            {job.parts.map(p => (
              <div key={p.clinicId} style={{ fontSize: 12, padding: '5px 8px', borderRadius: 7, background: 'var(--n-0)', border: `1px solid ${p.status === 'running' ? 'var(--rb-primary)' : p.status === 'failed' ? 'var(--red-300)' : 'var(--rb-border)'}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: 'var(--rb-text)', fontWeight: 500 }}>{p.name}</span>
                <span style={{ color: p.status === 'done' ? 'var(--green-600)' : p.status === 'failed' ? 'var(--red-500)' : 'var(--rb-text-secondary)', whiteSpace: 'nowrap' }}>
                  {p.status === 'done' && p.rows != null ? `${p.rows.toLocaleString('ru-RU')} стр.`
                    : p.status === 'running' && p.current ? `${fmtDate(p.current.dateFrom).slice(0, 5)}–${fmtDate(p.current.dateTo).slice(0, 5)}${p.current.attempt > 1 ? ', повтор' : ''}`
                    : PART_STATUS[p.status]}
                </span>
              </div>
            ))}
          </div>
          {job.error && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--red-500)' }}>{job.error}</div>}
          {job.log?.length > 0 && job.status !== 'done' && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--rb-text-secondary)' }}>
              {job.log.slice(-3).map((l, i) => <div key={i}>{new Date(l.at).toLocaleTimeString('ru-RU')} — {l.msg}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
