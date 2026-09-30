import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { User, Lock, KeyRound, ChevronDown, Check, X } from 'lucide-react';
import { rbMisExport } from '../../../services/api';
import DateRangePicker from './DateRangePicker';
import renovatioLogo from '../../../assets/images/renovatio.png';

/**
 * Выгрузка услуг из МИС прямо в источники (ver. 9.12).
 *
 * Заменяет ручной ритуал: восемь выгрузок в «Кассе → Выгрузке по услугам» и
 * склейку файлов. Всё тяжёлое делает бэкенд; здесь — вход в МИС, параметры и
 * ход выгрузки.
 *
 * Во вкладке видна только квадратная кнопка с логотипом Renovatio: выгрузка
 * нужна раз в месяц, и постоянная панель над списком источников мешала бы
 * остальные тридцать дней. Всё остальное живёт в модалке.
 *
 * Вход — с кодом из письма, потому что учётка личная. Сессия потом живёт около
 * месяца, так что экран входа появляется редко.
 */

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const pad = n => String(n).padStart(2, '0');
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = iso => (iso ? iso.split('-').reverse().join('.') : '');
const fmtDateTime = iso => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const fmtNum = n => (n ?? 0).toLocaleString('ru-RU');

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

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${pad(s % 60)} с`;
}

const errText = e => e?.response?.data?.error || e?.message || 'Ошибка';

const RESEND_COOLDOWN_S = 60;
const ACTIVE = ['running', 'merging'];

// ── Выпадающий список медцентров ────────────────────────────────────────────
//
// Меню рисуется порталом в body: модалка прокручивается, и абсолютно
// позиционированный список обрезался бы её краем. Портал обёрнут в .rb-app —
// токены модуля (--rb-*) объявлены на нём, и за его пределами меню осталось
// бы без рамок и без цвета отмеченных пунктов.

function ClinicMultiSelect({ clinics, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = menuRef.current?.offsetHeight || 0;
    // Не хватает места снизу — открываем вверх, как делает системный select.
    const below = window.innerHeight - r.bottom;
    const top = menuH && below < menuH + 12 && r.top > menuH + 12 ? r.top - menuH - 4 : r.bottom + 4;
    setPos({ top, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => {
      if (!menuRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const toggle = id => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  const all = value.length === clinics.length;
  const names = clinics.filter(c => value.includes(c.id)).map(c => c.name);
  const text = all ? 'Все медцентры' : names.length === 0 ? 'Не выбраны' : names.join(', ');

  return (
    <>
      <button type="button" ref={triggerRef} className={`rb-mis-select${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="rb-mis-select-text" style={names.length ? undefined : { color: 'var(--rb-text-secondary)' }}>{text}</span>
        <span className="rb-mis-select-count">{value.length}</span>
        <ChevronDown size={16} />
      </button>
      {open && createPortal(
        <div className="rb-app rb-mis-layer"><div ref={menuRef} className="rb-mis-menu" role="listbox" aria-multiselectable="true"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0, width: Math.max(pos?.width || 0, 240) }}>
          <div className="rb-mis-menu-top">
            <button type="button" className="rb-mis-link" disabled={all} onClick={() => onChange(clinics.map(c => c.id))}>Выбрать все</button>
            <button type="button" className="rb-mis-link" disabled={!value.length} onClick={() => onChange([])}>Снять все</button>
          </div>
          {clinics.map(c => {
            const on = value.includes(c.id);
            return (
              <button type="button" key={c.id} role="option" aria-selected={on}
                className={`rb-mis-option${on ? ' on' : ''}`} onClick={() => toggle(c.id)}>
                <span className="rb-mis-check">{on && <Check size={12} strokeWidth={3} />}</span>
                {c.name}
              </button>
            );
          })}
        </div></div>,
        document.body,
      )}
    </>
  );
}

// ── Вход в МИС ──────────────────────────────────────────────────────────────

function AuthScreen({ step, setStep, onDone, onClose, lastLogin }) {
  const [login, setLogin] = useState(lastLogin || '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(step === 'code' ? RESEND_COOLDOWN_S : 0);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const submitCredentials = async e => {
    e.preventDefault();
    if (!login.trim() || !password) { setError('Введите логин и пароль'); return; }
    setBusy(true); setError('');
    try {
      const { data } = await rbMisExport.login(login.trim(), password);
      setPassword('');
      if (data.step === 'done') { onDone(); return; }
      setStep('code');
      setResendIn(RESEND_COOLDOWN_S);
    } catch (err) { setError(errText(err)); }
    finally { setBusy(false); }
  };

  const submitCode = async e => {
    e.preventDefault();
    if (!code.trim()) { setError('Введите код из письма'); return; }
    setBusy(true); setError('');
    try {
      await rbMisExport.code(code.trim());
      onDone();
    } catch (err) {
      setError(errText(err));
      setCode('');
      if (err?.response?.data?.restart) setStep('credentials');
    } finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true); setError('');
    try {
      await rbMisExport.resend();
      toast.success('Код отправлен ещё раз');
      setResendIn(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(errText(err));
      if (err?.response?.data?.restart) setStep('credentials');
    } finally { setBusy(false); }
  };

  const back = async () => {
    setStep('credentials'); setCode(''); setError('');
    await rbMisExport.cancelLogin().catch(() => {});
  };

  return (
    <div className="rb-mis-auth">
      <button type="button" className="rb-modal-close rb-mis-close" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
      <div className="rb-mis-auth-title">Медицинская<br />информационная система</div>
      <div className="rb-mis-brand">
        <img src={renovatioLogo} alt="" />
        <span>Renovatio</span>
      </div>

      {step === 'credentials' ? (
        <form onSubmit={submitCredentials}>
          <label className="rb-mis-field">
            <User size={20} strokeWidth={1.5} />
            <input value={login} onChange={e => setLogin(e.target.value)} placeholder="Логин" autoComplete="off" autoFocus={!login} />
          </label>
          <label className="rb-mis-field">
            <Lock size={20} strokeWidth={1.5} />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Пароль" autoComplete="new-password" autoFocus={!!login} />
          </label>
          <button type="submit" className="rb-mis-submit" disabled={busy}>{busy ? 'Вход…' : 'Войти'}</button>
        </form>
      ) : (
        <form onSubmit={submitCode}>
          <div className="rb-mis-hint">Код отправлен на почту, привязанную к учётке МИС</div>
          <label className="rb-mis-field code">
            <KeyRound size={20} strokeWidth={1.5} />
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="Код" inputMode="numeric" autoComplete="one-time-code" autoFocus />
          </label>
          <button type="submit" className="rb-mis-submit" disabled={busy}>{busy ? 'Проверка…' : 'Войти'}</button>
          <div className="rb-mis-links">
            <button type="button" className="rb-mis-link" onClick={back}>Назад</button>
            <button type="button" className="rb-mis-link" disabled={busy || resendIn > 0} onClick={resend}>
              {resendIn > 0 ? `Отправить повторно через 0:${pad(resendIn)}` : 'Отправить повторно'}
            </button>
          </div>
        </form>
      )}
      {error && <div className="rb-mis-error">{error}</div>}
    </div>
  );
}

// ── Ход выгрузки ────────────────────────────────────────────────────────────

/**
 * Доля готовности клиники. МИС отдаёт файл целиком и молча, так что внутри
 * куска прогресса нет. Если бэкенд помнит скорость клиники, ведём полосу по
 * ожидаемому времени, но не дальше 95 %: остаток она проходит, только когда
 * файл действительно пришёл. Без оценки полоса «бегущая».
 */
function partProgress(p, now) {
  if (p.status === 'done') return { frac: 1 };
  if (p.status !== 'running') return { frac: p.status === 'failed' ? 1 : 0 };
  const elapsed = p.startedAt ? (now - new Date(p.startedAt)) / 1000 : 0;
  if (p.estimateSec) {
    return { frac: Math.min(0.95, elapsed / p.estimateSec), left: Math.max(0, p.estimateSec - elapsed), elapsed };
  }
  if (p.chunksTotal > 1) return { frac: p.chunksDone / p.chunksTotal, elapsed };
  return { frac: null, elapsed };
}

function JobProgress({ job, now }) {
  const parts = job.parts || [];
  const fracs = parts.map(p => partProgress(p, now));
  const overall = job.status === 'done' || job.status === 'merging'
    ? 1
    : parts.length ? fracs.reduce((a, f) => a + (f.frac ?? 0), 0) / parts.length : 0;
  const doneCount = parts.filter(p => p.status === 'done').length;
  const total = (job.finishedAt ? new Date(job.finishedAt) : now) - new Date(job.startedAt);

  const title = {
    running: `${doneCount} из ${parts.length} медцентров`,
    merging: 'Склеиваю файлы в один',
    done: `Готово · ${fmtNum(job.rows)} строк в источниках`,
    failed: 'Выгрузка остановилась с ошибкой',
    needs_login: 'Сессия МИС закончилась',
    cancelled: 'Выгрузка остановлена',
  }[job.status];

  return (
    <div>
      <div className="rb-mis-overall">
        <div className="rb-mis-overall-line">
          <b>{title}</b>
          <span style={{ color: 'var(--rb-text-secondary)', fontSize: 12 }}>{fmtDuration(total / 1000)}</span>
        </div>
        <div className={`rb-mis-bar thick${ACTIVE.includes(job.status) ? ' active' : ''}`}>
          <div className="rb-mis-bar-fill" style={{
            width: `${overall * 100}%`,
            background: ['failed', 'needs_login'].includes(job.status) ? 'var(--red-400)' : undefined,
          }} />
        </div>
      </div>

      <div className="rb-mis-clinics">
        {parts.map((p, i) => {
          const f = fracs[i];
          let note;
          if (p.status === 'done') note = p.rows != null ? `${fmtNum(p.rows)} строк` : 'скачано';
          else if (p.status === 'failed') note = 'ошибка';
          else if (p.status === 'waiting') note = job.status === 'running' ? 'в очереди' : '—';
          else if (f.left != null) note = f.left > 5 ? `≈ ${fmtDuration(f.left)}` : 'почти готово';
          else note = fmtDuration(f.elapsed || 0);
          if (p.status === 'running' && p.current?.attempt > 1) note = `повтор · ${note}`;
          if (p.status === 'running' && p.chunksTotal > 1) note = `месяц ${p.chunksDone + 1} из ${p.chunksTotal} · ${note}`;

          const indeterminate = p.status === 'running' && f.frac == null;
          return (
            <div key={p.clinicId} className={`rb-mis-clinic ${p.status}`}>
              <div className="rb-mis-clinic-line">
                <span className={`rb-mis-state ${p.status}`}>
                  {p.status === 'done' && <Check size={15} strokeWidth={3} />}
                  {p.status === 'failed' && <X size={15} strokeWidth={3} />}
                </span>
                <span className="rb-mis-clinic-name">{p.name}</span>
                <span className="rb-mis-clinic-note">{note}</span>
              </div>
              <div className={`rb-mis-bar${p.status === 'running' ? ' active' : ''}${indeterminate ? ' indeterminate' : ''}`}>
                <div className="rb-mis-bar-fill" style={{ width: `${(f.frac ?? 0) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {job.error && <div className="rb-mis-error" style={{ textAlign: 'left' }}>{job.error}</div>}
      {job.log?.length > 0 && job.status !== 'done' && (
        <div className="rb-mis-log">
          {job.log.slice(-3).map((l, i) => <div key={i}>{new Date(l.at).toLocaleTimeString('ru-RU')} — {l.msg}</div>)}
        </div>
      )}
    </div>
  );
}

// ── Кнопка и модалка ────────────────────────────────────────────────────────

export default function MisExportPanel({ onDone }) {
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [authStep, setAuthStep] = useState('credentials');
  const [forceAuth, setForceAuth] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clockSkew, setClockSkew] = useState(0);
  const [, setTick] = useState(0);

  const init = prevMonth();
  const [dateFrom, setDateFrom] = useState(init.from);
  const [dateTo, setDateTo] = useState(init.to);
  const [dateType, setDateType] = useState(2);
  const [clinicIds, setClinicIds] = useState(null); // null — пока не пришёл список: все
  const [periodLabel, setPeriodLabel] = useState('');

  const lastStatus = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await rbMisExport.state();
      setInfo(data);
      if (data.serverNow) setClockSkew(new Date(data.serverNow) - Date.now());
      if (data.pendingCode) setAuthStep('code');
      setClinicIds(prev => prev ?? (data.clinics || []).map(c => c.id));
      return data;
    } catch (e) {
      toast.error(`Выгрузка из МИС: ${errText(e)}`);
      return null;
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const job = info?.job;
  const jobActive = !!job && ACTIVE.includes(job.status);

  // Опрос только пока задача идёт — и когда модалка закрыта тоже: итог надо
  // сообщить, а точка на кнопке должна погаснуть.
  useEffect(() => {
    if (!jobActive) return undefined;
    const poll = setInterval(load, 3000);
    const tick = setInterval(() => setTick(n => n + 1), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [jobActive, load]);

  // Итог сообщаем один раз — когда задача закончилась у нас на глазах, а не
  // при каждом открытии вкладки.
  useEffect(() => {
    if (!job) return;
    const prev = lastStatus.current;
    lastStatus.current = `${job.id}:${job.status}`;
    const wasActive = prev === `${job.id}:running` || prev === `${job.id}:merging`;
    if (!wasActive || ACTIVE.includes(job.status)) return;
    if (job.status === 'done') {
      toast.success(`Источник «${job.params.periodLabel}» добавлен: ${fmtNum(job.rows)} строк`);
      onDone?.();
    } else if (job.status === 'needs_login') {
      toast.error('Сессия МИС закончилась — войдите заново и запустите выгрузку ещё раз');
    } else if (job.status === 'failed') {
      toast.error(`Выгрузка остановилась: ${job.error}`);
    }
  }, [job, onDone]);

  const session = info?.session || { connected: false };
  const needAuth = !session.connected || forceAuth;

  // Итог закончившейся выгрузки показываем, пока его не увидели; после
  // закрытия модалки она открывается сразу с формой для новой.
  const seenJob = useRef(null);

  const openModal = () => {
    setShowForm(!jobActive && (!job || seenJob.current === job.id));
    setOpen(true);
    load();
  };

  const closeModal = useCallback(() => {
    if (job && !ACTIVE.includes(job.status)) seenJob.current = job.id;
    setOpen(false);
  }, [job]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closeModal]);

  const afterLogin = async () => {
    toast.success('Вход в МИС выполнен');
    setForceAuth(false); setAuthStep('credentials'); setShowForm(true);
    await load();
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
    if (!window.confirm('Выйти из МИС? Для следующей выгрузки понадобится снова ввести пароль и код.')) return;
    await rbMisExport.forget().catch(e => toast.error(errText(e)));
    await load();
  };

  const start = async () => {
    if (!dateFrom || !dateTo) { toast.error('Укажите период'); return; }
    if (!clinicIds?.length) { toast.error('Выберите хотя бы один медцентр'); return; }
    setBusy(true);
    try {
      const order = info.clinics.map(c => c.id).filter(id => clinicIds.includes(id));
      await rbMisExport.start({ dateFrom, dateTo, dateType, clinicIds: order, periodLabel: periodLabel.trim() });
      lastStatus.current = null;
      setShowForm(false);
      await load();
    } catch (e) {
      toast.error(errText(e));
      if (e?.response?.data?.code === 'MIS_SESSION_EXPIRED') await load();
    } finally { setBusy(false); }
  };

  const cancelJob = async () => {
    if (!window.confirm('Остановить выгрузку? Уже скачанное будет выброшено.')) return;
    await rbMisExport.cancel().catch(e => toast.error(errText(e)));
    await load();
  };

  const now = new Date(Date.now() + clockSkew);
  const showProgress = job && !needAuth && (jobActive || !showForm);

  let body;
  if (!info) {
    body = null;
  } else if (needAuth && !jobActive) {
    body = (
      <AuthScreen step={authStep} setStep={setAuthStep} onDone={afterLogin}
        onClose={closeModal} lastLogin={session.login} />
    );
  } else {
    body = (
      <>
        <div className="rb-modal-header">
          <div className="rb-mis-head">
            <img src={renovatioLogo} alt="" />
            <div>
              <h3>Выгрузка услуг из МИС</h3>
              <div className="rb-mis-head-sub">
                {session.connected
                  ? <>Вход: {session.login}{session.connectedAt && <> · с {fmtDateTime(session.connectedAt)}</>}</>
                  : <span style={{ color: 'var(--red-500)' }}>Сессия МИС закончилась</span>}
              </div>
            </div>
          </div>
          <div className="rb-mis-head-actions">
            {!jobActive && session.connected && <button type="button" className="rb-mis-link" disabled={busy} onClick={check}>Проверить</button>}
            {!jobActive && session.connected && <button type="button" className="rb-mis-link" onClick={forget}>Выйти</button>}
            <button type="button" className="rb-modal-close" onClick={closeModal} aria-label="Закрыть"><X size={18} /></button>
          </div>
        </div>

        <div className="rb-modal-body">
          {showProgress ? (
            <JobProgress job={job} now={now} />
          ) : (
            <div className="rb-mis-form">
              <div>
                <span className="rb-mis-label">Период</span>
                <DateRangePicker dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />
              </div>
              <div>
                <span className="rb-mis-label">Медцентры</span>
                <ClinicMultiSelect clinics={info.clinics} value={clinicIds || []} onChange={setClinicIds} />
              </div>
              <div className="rb-mis-row">
                <div>
                  <span className="rb-mis-label">Считать</span>
                  <select className="rb-mis-input" value={dateType} onChange={e => setDateType(Number(e.target.value))}>
                    <option value={2}>по дате оплаты</option>
                    <option value={1}>по дате выставления счёта</option>
                  </select>
                </div>
                <div>
                  <span className="rb-mis-label">Название источника</span>
                  <input className="rb-mis-input" value={periodLabel} placeholder={autoLabel(dateFrom, dateTo)} onChange={e => setPeriodLabel(e.target.value)} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rb-modal-footer">
          {showProgress && jobActive && (
            <button type="button" className="rb-btn rb-btn-secondary" onClick={cancelJob}>Остановить</button>
          )}
          {showProgress && !jobActive && (
            <>
              {job.status === 'needs_login' ? (
                <button type="button" className="rb-mis-submit" style={{ width: 'auto', margin: 0, padding: '0 20px', height: 36, fontSize: 14 }}
                  onClick={() => { setForceAuth(true); setAuthStep('credentials'); }}>Войти заново</button>
              ) : (
                <button type="button" className="rb-btn rb-btn-secondary" onClick={() => setShowForm(true)}>Новая выгрузка</button>
              )}
              <button type="button" className="rb-btn rb-btn-secondary" onClick={closeModal}>Закрыть</button>
            </>
          )}
          {!showProgress && (
            <button type="button" className="rb-mis-submit" disabled={busy || !session.connected}
              style={{ width: 'auto', margin: 0, padding: '0 22px', height: 36, fontSize: 14 }} onClick={start}>
              {busy ? 'Запуск…' : 'Выгрузить'}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <button type="button" className="rb-mis-btn" onClick={openModal}
        title={jobActive ? 'Идёт выгрузка из МИС' : 'Выгрузить из МИС Renovatio'} aria-label="Выгрузка из МИС Renovatio">
        <img src={renovatioLogo} alt="" />
        {jobActive && <span className="rb-mis-btn-dot" />}
      </button>
      {open && createPortal(
        <div className="rb-app rb-mis-layer"><div className="rb-modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className={`rb-modal rb-mis-modal${needAuth && !jobActive ? '' : ' wide'}`} role="dialog" aria-modal="true" aria-label="Выгрузка из МИС">
            {body}
          </div>
        </div></div>,
        document.body,
      )}
    </>
  );
}
