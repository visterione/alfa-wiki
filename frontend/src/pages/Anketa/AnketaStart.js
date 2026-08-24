import React, { useState } from 'react';
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
  const [code, setCode] = useState('');
  const [stage, setStage] = useState('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
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
      setStage('code');
      startCountdown();
    } catch (e) {
      setError(e.response?.data?.message || 'Не удалось отправить код. Попробуйте позже.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await anketa.verifyCode({ email: email.trim(), code: code.trim() });
      navigate(`/anketa/${data.token}`, { replace: true });
    } catch (e) {
      setError(e.response?.data?.message || 'Не удалось подтвердить код.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ank">
      <div className="ank__wrap">
        <div className="ank__head">
          <h1>Анкета врача</h1>
          <p>Сеть медицинских центров «Альфа»</p>
        </div>

        {error && <div className="ank__note ank__note--bad">{error}</div>}

        {stage === 'email' ? (
          <form className="ank__card" onSubmit={requestCode}>
            <h2>Начнём с почты</h2>
            <p className="ank__hint">На неё придёт код и ссылка для возврата к анкете.</p>

            <div className="ank__field">
              <label htmlFor="ank-email">Электронная почта</label>
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
            <h2>Код из письма</h2>
            <p className="ank__hint">Отправили на {email}. Проверьте папку «Спам».</p>

            <div className="ank__field">
              <label htmlFor="ank-code">Код</label>
              <input
                id="ank-code"
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoComplete="one-time-code"
                required
              />
            </div>

            <div className="ank__actions">
              <button className="ank__btn" type="submit" disabled={busy || code.length < 6}>
                {busy ? 'Проверяем…' : 'Продолжить'}
              </button>
              <button
                className="ank__btn ank__btn--ghost"
                type="button"
                onClick={requestCode}
                disabled={busy || resendIn > 0}
              >
                {resendIn > 0 ? `Отправить ещё раз через ${resendIn} с` : 'Письмо не пришло'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
