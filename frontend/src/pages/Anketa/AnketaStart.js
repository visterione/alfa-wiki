import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { anketa } from '../../services/api';
import './Anketa.css';

/**
 * Вход в анкету по постоянной публичной ссылке.
 *
 * Ссылка одна на всех: её отправляют сразу нескольким врачам, вешают в вакансию,
 * дают по QR на собеседовании. Поэтому первым делом — подтверждение адреса
 * кодом: это и отсекает спам (вместе со скрытым полем-приманкой и лимитом по IP
 * на бэкенде), и гарантирует, что e-mail, по которому считается уникальность
 * заявки, настоящий.
 *
 * Внешнюю капчу не ставим намеренно: она тянет чужой скрипт, а значит правки CSP
 * и nginx, аккаунт и ключи — ради задачи, которую подтверждение адреса решает
 * лучше.
 */
export default function AnketaStart() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [stage, setStage] = useState('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const codeRefs = useRef([]);
  // Приманка: настоящий посетитель это поле не видит и не заполняет.
  const [website, setWebsite] = useState('');

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
      await anketa.requestCode({ email: email.trim(), website });
      setCode(['', '', '', '', '', '']);
      setStage('code');
      startCountdown();
      setTimeout(() => codeRefs.current[0]?.focus(), 0);
    } catch (e) {
      setError(e.response?.data?.message || 'Не удалось отправить код. Попробуйте позже.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event) => {
    event.preventDefault();
    const value = code.join('');
    if (value.length !== 6) return;
    setError('');
    setBusy(true);
    try {
      const { data } = await anketa.verifyCode({ email: email.trim(), code: value });
      navigate(`/anketa/${data.token}`, { replace: true });
    } catch (e) {
      setError(e.response?.data?.message || 'Не удалось подтвердить код.');
      setCode(['', '', '', '', '', '']);
      setTimeout(() => codeRefs.current[0]?.focus(), 0);
    } finally {
      setBusy(false);
    }
  };

  const setCodeDigit = (index, rawValue) => {
    if (error) setError('');
    const digits = String(rawValue || '').replace(/\D/g, '');

    // iOS и менеджеры паролей могут вставить весь одноразовый код в первую
    // ячейку. Раскладываем его целиком, иначе автозаполнение выглядит сломанным.
    if (digits.length > 1) {
      const next = digits.slice(0, 6).split('').concat(Array(6).fill('')).slice(0, 6);
      setCode(next);
      codeRefs.current[Math.min(digits.length, 5)]?.focus();
      return;
    }

    const next = [...code];
    next[index] = digits.slice(-1);
    setCode(next);
    if (digits && index < 5) codeRefs.current[index + 1]?.focus();
  };

  const handleCodeKeyDown = (index, event) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const next = [...code];
      if (next[index]) {
        next[index] = '';
      } else if (index > 0) {
        next[index - 1] = '';
        codeRefs.current[index - 1]?.focus();
      }
      setCode(next);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      codeRefs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < 5) {
      codeRefs.current[index + 1]?.focus();
    }
  };

  const handleCodePaste = (event) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    setCode(pasted.split('').concat(Array(6).fill('')).slice(0, 6));
    codeRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="ank ank--start">
      <div className="ank__wrap ank__start-wrap">
        <div className="ank__start-head">
          <span className="ank__brand">АЛЬФА</span>
          <h1>Анкета врача</h1>
          <p>{stage === 'email' ? 'Вход по электронной почте' : email}</p>
        </div>

        {error && <div className="ank__note ank__note--bad">{error}</div>}

        {stage === 'email' ? (
          <form className="ank__card" onSubmit={requestCode}>
            <div className="ank__card-head">
              <h2>Открыть анкету</h2>
              <p className="ank__hint">Пришлём короткий код для входа.</p>
            </div>

            <div className="ank__field">
              <label htmlFor="ank-email">Почта</label>
              <input
                id="ank-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="doctor@example.com"
                autoComplete="email"
                required
              />
            </div>

            {/* Скрыто от человека и доступно боту. Заполненное поле — верный
                признак автозаполнения, и заявка просто не создаётся. */}
            <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
              <label htmlFor="ank-website">Сайт</label>
              <input
                id="ank-website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>

            <button className="ank__btn ank__btn--wide" type="submit" disabled={busy || !email}>
              {busy ? 'Отправляем…' : 'Получить код'}
            </button>
          </form>
        ) : (
          <form className="ank__card" onSubmit={verify}>
            <div className="ank__card-head">
              <h2>Код из письма</h2>
              <p className="ank__hint">Введите 6 цифр.</p>
            </div>

            <div className="ank__code-grid" role="group" aria-label="Код из шести цифр">
              {Array.from({ length: 6 }, (_, index) => (
                <input
                  key={index}
                  ref={(element) => { codeRefs.current[index] = element; }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={index === 0 ? 6 : 1}
                  value={code[index] || ''}
                  onChange={(event) => setCodeDigit(index, event.target.value)}
                  onKeyDown={(event) => handleCodeKeyDown(index, event)}
                  onPaste={handleCodePaste}
                  autoComplete={index === 0 ? 'one-time-code' : 'off'}
                  autoFocus={index === 0}
                  aria-label={`Цифра ${index + 1}`}
                  disabled={busy}
                />
              ))}
            </div>

            <div className="ank__actions ank__start-actions">
              <button className="ank__btn ank__btn--wide" type="submit" disabled={busy || code.some(digit => !digit)}>
                {busy ? 'Проверяем…' : 'Продолжить'}
              </button>
              <button
                className="ank__start-link"
                type="button"
                onClick={requestCode}
                disabled={busy || resendIn > 0}
              >
                {resendIn > 0 ? `Повторно через ${resendIn} с` : 'Отправить код ещё раз'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
