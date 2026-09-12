/**
 * Вход по QR-коду филиала (ver. 8.20).
 *
 * У каждого медцентра свой код, и человек, отсканировавший табличку в
 * регистратуре, видит вакансии только этого филиала. Место работы дальше нигде
 * не спрашивается: оно известно из адреса, по которому он пришёл, и ошибиться
 * он не может — в первом поколении филиал выбирался в анкете, и это был первый
 * же вопрос, на который человек с улицы не знал ответа.
 *
 * Порядок шагов: выбрать вакансию → подтвердить почту кодом → анкета. Почта
 * спрашивается после выбора, а не до: код выдаётся под конкретную вакансию,
 * потому что на одну заявка у человека уже может быть, а на соседнюю он вправе
 * откликнуться.
 *
 * Внешнюю капчу не ставим намеренно: она тянет чужой скрипт, а значит правки
 * CSP и nginx, аккаунт и ключи — ради задачи, которую подтверждение адреса
 * решает лучше.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { vacancyPublic as api } from '../../services/api';
import './Vacancy.css';

export default function VacancyStart() {
  const { code } = useParams();
  const navigate = useNavigate();

  const [branch, setBranch] = useState(null);
  const [vacancies, setVacancies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [chosen, setChosen] = useState(null);
  const [stage, setStage] = useState('list');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const codeRefs = useRef([]);

  // Приманка: настоящий посетитель это поле не видит и не заполняет.
  const [website, setWebsite] = useState('');

  useEffect(() => {
    let alive = true;
    api.branch(code)
      .then(({ data }) => {
        if (!alive) return;
        setBranch(data.branch);
        setVacancies(data.vacancies || []);
      })
      .catch(() => { if (alive) setNotFound(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code]);

  const startCountdown = () => {
    setResendIn(60);
    const timer = setInterval(() => {
      setResendIn(prev => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const requestCode = async (event) => {
    event?.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.requestCode({ vacancyId: chosen.id, email: email.trim(), website });
      setDigits(['', '', '', '', '', '']);
      setStage('code');
      startCountdown();
      setTimeout(() => codeRefs.current[0]?.focus(), 0);
    } catch (err) {
      setError(err.response?.data?.message || 'Не удалось отправить код');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value) => {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.verifyCode({ vacancyId: chosen.id, email: email.trim(), code: value });
      navigate(`/vacancy/a/${data.token}`, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Не удалось подтвердить адрес');
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => codeRefs.current[0]?.focus(), 0);
    } finally {
      setBusy(false);
    }
  };

  const setDigit = (index, value) => {
    const clean = value.replace(/\D/g, '').slice(-1);
    const next = digits.slice();
    next[index] = clean;
    setDigits(next);
    if (clean && index < 5) codeRefs.current[index + 1]?.focus();
    const joined = next.join('');
    if (joined.length === 6 && !next.includes('')) verify(joined);
  };

  // Код из письма чаще вставляют целиком, чем набирают по цифре.
  const pasteCode = (event) => {
    const text = (event.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    event.preventDefault();
    const next = ['', '', '', '', '', ''];
    [...text].forEach((ch, i) => { next[i] = ch; });
    setDigits(next);
    if (text.length === 6) verify(text);
    else codeRefs.current[text.length]?.focus();
  };

  if (loading) return <Shell><div className="vcy-note">Загружаем…</div></Shell>;

  if (notFound) {
    return (
      <Shell>
        <h1>Страница не найдена</h1>
        <p className="vcy-lead">
          Ссылка не открывается — возможно, в ней опечатка или этот медцентр
          больше не набирает сотрудников. Уточните адрес у того, кто дал вам QR-код.
        </p>
      </Shell>
    );
  }

  if (stage === 'list') {
    return (
      <Shell branch={branch}>
        <h1>Открытые вакансии</h1>
        {!vacancies.length && (
          <p className="vcy-lead">
            Сейчас в этом медцентре открытых вакансий нет. Загляните позже —
            ссылка не меняется, её можно сохранить.
          </p>
        )}

        <div className="vcy-vacancies">
          {vacancies.map(v => (
            <button
              type="button"
              className="vcy-vacancy"
              key={v.id}
              onClick={() => { setChosen(v); setStage('email'); setError(''); }}
            >
              <b>{v.title}</b>
              {v.description && <span>{v.description}</span>}
            </button>
          ))}
        </div>
      </Shell>
    );
  }

  if (stage === 'email') {
    return (
      <Shell branch={branch}>
        <button type="button" className="vcy-back" onClick={() => setStage('list')}>← К списку вакансий</button>
        <h1>{chosen.title}</h1>
        {chosen.description && <p className="vcy-lead">{chosen.description}</p>}

        <form onSubmit={requestCode} className="vcy-form">
          <label className="vcy-field">
            <span>Ваша электронная почта</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              placeholder="name@example.com"
              onChange={e => setEmail(e.target.value)}
            />
            <small>На неё придёт код и ссылка, по которой можно вернуться к анкете.</small>
          </label>

          {/* Поле-приманка: человек его не видит, бот заполняет. */}
          <input
            className="vcy-honeypot"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={e => setWebsite(e.target.value)}
          />

          {error && <div className="vcy-error">{error}</div>}

          <button type="submit" className="vcy-btn" disabled={busy || !email.trim()}>
            {busy ? 'Отправляем…' : 'Получить код'}
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell branch={branch}>
      <button type="button" className="vcy-back" onClick={() => setStage('email')}>← Изменить адрес</button>
      <h1>Код из письма</h1>
      <p className="vcy-lead">Отправили шестизначный код на {email}. Он действует 15 минут.</p>

      <div className="vcy-code" onPaste={pasteCode}>
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={el => { codeRefs.current[index] = el; }}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={digit}
            disabled={busy}
            onChange={e => setDigit(index, e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Backspace' && !digits[index] && index > 0) codeRefs.current[index - 1]?.focus();
            }}
          />
        ))}
      </div>

      {error && <div className="vcy-error">{error}</div>}

      <button
        type="button"
        className="vcy-btn is-ghost"
        disabled={busy || resendIn > 0}
        onClick={requestCode}
      >
        {resendIn > 0 ? `Отправить ещё раз через ${resendIn} с` : 'Отправить код ещё раз'}
      </button>
    </Shell>
  );
}

function Shell({ branch, children }) {
  return (
    <div className="vcy">
      <div className="vcy-card">
        {branch && (
          <div className="vcy-branch">
            {branch.name}
            {branch.address && <small>{branch.address}</small>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
