/**
 * Вход кандидата (ver. 8.21).
 *
 * Два адреса ведут сюда, и они для разных случаев.
 *
 * `/vacancy/:код-филиала` — табличка в регистратуре: человек видит список
 * вакансий этого медцентра и выбирает. Место работы дальше нигде не
 * спрашивается: оно известно из адреса, по которому он пришёл.
 *
 * `/vacancy/j/:код-вакансии` — прямая ссылка, её отправляют лично. Список тогда
 * пропускается: человек уже знает, на что откликается, и лишний экран ему
 * только мешает.
 *
 * Дальше в обоих случаях одно и то же: почта, код из письма, анкета. Почта
 * спрашивается после выбора вакансии, а не до: код выдаётся под конкретную
 * вакансию, потому что на одну заявка у человека уже может быть, а на соседнюю
 * он вправе откликнуться.
 *
 * Внешнюю капчу не ставим намеренно: она тянет чужой скрипт, а значит правки
 * CSP и nginx, аккаунт и ключи — ради задачи, которую подтверждение адреса
 * решает лучше.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { vacancyPublic as api } from '../../services/api';
import Shell from './Shell';

export default function VacancyStart({ direct = false }) {
  const { code } = useParams();
  const navigate = useNavigate();

  const [branch, setBranch] = useState(null);
  const [vacancies, setVacancies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');

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
    const request = direct ? api.direct(code) : api.branch(code);

    request
      .then(({ data }) => {
        if (!alive) return;
        setBranch(data.branch);
        if (direct) {
          setVacancies([data.vacancy]);
          setChosen(data.vacancy);
          setStage('email');
        } else {
          setVacancies(data.vacancies || []);
        }
      })
      .catch(err => {
        if (!alive) return;
        setProblem(err.response?.data?.message || 'Страница не найдена');
      })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [code, direct]);

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

  if (problem) {
    return (
      <Shell branch={branch}>
        <h1>Страница не открылась</h1>
        <p className="vcy-lead">{problem}</p>
        <p className="vcy-note">
          Возможно, набор уже закрыт или в ссылке опечатка. Уточните адрес у того,
          кто её прислал.
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
        {Boolean(vacancies.length) && (
          <p className="vcy-lead">Выберите подходящую — анкету заполните здесь же.</p>
        )}

        <div className="vcy-vacancies">
          {vacancies.map(v => (
            <button
              type="button"
              className="vcy-vacancy"
              key={v.id}
              onClick={() => { setChosen(v); setStage('email'); setError(''); }}
            >
              <span className="vcy-vacancy-text">
                <b>{v.title}</b>
                {/* Зарплата — первое, что ищут глазами в списке, поэтому стоит
                    до описания и отдельной строкой, а не в его конце. */}
                {v.salary && <em className="vcy-salary">{v.salary}</em>}
                {v.description && <span>{v.description}</span>}
              </span>
              <i aria-hidden="true">›</i>
            </button>
          ))}
        </div>
      </Shell>
    );
  }

  if (stage === 'email') {
    return (
      <Shell branch={branch}>
        {!direct && (
          <button type="button" className="vcy-back" onClick={() => setStage('list')}>← К списку вакансий</button>
        )}
        <h1>{chosen.title}</h1>
        {chosen.salary && <p className="vcy-salary is-big">{chosen.salary}</p>}
        {chosen.description && <p className="vcy-lead is-text">{chosen.description}</p>}

        <form onSubmit={requestCode} className="vcy-form">
          <label className="vcy-field">
            <span>Ваша электронная почта</span>
            <input
              id="vcy-email"
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
            id="vcy-website"
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
            id={`vcy-code-${index}`}
            ref={el => { codeRefs.current[index] = el; }}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={digit}
            disabled={busy}
            aria-label={`Цифра ${index + 1}`}
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
