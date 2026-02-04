import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { auth as authApi } from '../services/api';
import { LogIn, Eye, EyeOff, Shield, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import './Login.css';

import loginLogo from '../assets/images/logo.png';

export default function Login() {
  const [step, setStep] = useState('credentials'); // 'credentials' | 'twoFactor'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState(['', '', '', '', '', '']);
  const [userId, setUserId] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(5);
  const [codeStatus, setCodeStatus] = useState(''); // '' | 'success' | 'error'
  const inputRefs = useRef([]);
  const navigate = useNavigate();

  const handleCredentialsSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error('Введите логин и пароль');
      return;
    }

    setLoading(true);
    try {
      // Используем API напрямую
      const { data } = await authApi.login(username, password);
      
      console.log('Login response:', data); // Debug
      
      // Проверяем, требуется ли 2FA
      if (data.requiresTwoFactor) {
        setUserId(data.userId);
        setStep('twoFactor');
        toast.success(data.message || 'Код отправлен на вашу почту');
      } else if (data.token && data.user) {
        // Обычная авторизация без 2FA - сохраняем токен и перенаправляем
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        toast.success('Добро пожаловать!');
        // Небольшая задержка для отображения toast
        setTimeout(() => {
          navigate('/');
          window.location.reload(); // Перезагружаем для обновления AuthContext
        }, 100);
      } else {
        console.error('Unexpected response format:', data);
        toast.error('Неожиданный ответ сервера');
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error(error.response?.data?.error || 'Ошибка авторизации');
    } finally {
      setLoading(false);
    }
  };

  const handleTwoFactorSubmit = async (e) => {
    e.preventDefault();
    const code = twoFactorCode.join('');
    if (code.length !== 6) {
      toast.error('Введите 6-значный код');
      return;
    }

    setLoading(true);
    try {
      const { data } = await authApi.verify2FA(userId, code);

      if (data.token && data.user) {
        // Показываем успешную валидацию
        setCodeStatus('success');

        // Задержка для анимации успеха
        setTimeout(() => {
          localStorage.setItem('token', data.token);
          localStorage.setItem('user', JSON.stringify(data.user));
          toast.success('Добро пожаловать!');

          setTimeout(() => {
            navigate('/');
            window.location.reload(); // Перезагружаем для обновления AuthContext
          }, 100);
        }, 500);
      } else {
        toast.error('Неожиданный ответ сервера');
      }
    } catch (error) {
      console.error('2FA verification error:', error);
      const errorData = error.response?.data;

      // Показываем ошибку валидации
      setCodeStatus('error');

      // Сбрасываем код через короткую задержку
      setTimeout(() => {
        setTwoFactorCode(['', '', '', '', '', '']);
        setCodeStatus('');
        if (inputRefs.current[0]) {
          inputRefs.current[0].focus();
        }
      }, 600);

      if (errorData?.attemptsLeft !== undefined) {
        setAttemptsLeft(errorData.attemptsLeft);
        toast.error(`${errorData.error} (осталось попыток: ${errorData.attemptsLeft})`);
      } else {
        toast.error(errorData?.error || 'Неверный код');
      }

      // Если код истёк или слишком много попыток - возвращаемся на шаг 1
      if (errorData?.error?.includes('expired') || errorData?.error?.includes('Too many')) {
        setTimeout(() => {
          setStep('credentials');
          setTwoFactorCode(['', '', '', '', '', '']);
          setUserId(null);
          setPassword('');
        }, 600);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!userId) return;

    setLoading(true);
    try {
      await authApi.resend2FA(userId);
      toast.success('Новый код отправлен');
      setTwoFactorCode(['', '', '', '', '', '']);
      setCodeStatus('');
      setAttemptsLeft(5);
      if (inputRefs.current[0]) {
        inputRefs.current[0].focus();
      }
    } catch (error) {
      console.error('Resend error:', error);
      toast.error('Ошибка отправки кода');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setStep('credentials');
    setTwoFactorCode(['', '', '', '', '', '']);
    setCodeStatus('');
    setUserId(null);
    setAttemptsLeft(5);
  };

  // Обработка ввода в клеточки кода
  const handleCodeInput = (index, value) => {
    if (loading || codeStatus) return;

    // Разрешаем только цифры
    const digit = value.replace(/\D/g, '').slice(-1);

    const newCode = [...twoFactorCode];
    newCode[index] = digit;
    setTwoFactorCode(newCode);

    // Автоматический переход к следующему полю
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  // Обработка клавиш
  const handleCodeKeyDown = (index, e) => {
    if (loading || codeStatus) return;

    // Backspace - удаляем и переходим к предыдущему
    if (e.key === 'Backspace') {
      e.preventDefault();
      const newCode = [...twoFactorCode];

      if (twoFactorCode[index]) {
        newCode[index] = '';
        setTwoFactorCode(newCode);
      } else if (index > 0) {
        newCode[index - 1] = '';
        setTwoFactorCode(newCode);
        inputRefs.current[index - 1]?.focus();
      }
    }

    // Стрелки влево/вправо для навигации
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  // Обработка вставки кода
  const handleCodePaste = (e) => {
    e.preventDefault();
    if (loading || codeStatus) return;

    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const newCode = pastedData.split('').concat(Array(6).fill('')).slice(0, 6);
    setTwoFactorCode(newCode);

    // Фокус на последнюю заполненную клеточку или следующую пустую
    const nextIndex = Math.min(pastedData.length, 5);
    inputRefs.current[nextIndex]?.focus();
  };

  // Автоматическая отправка при заполнении всех клеточек
  useEffect(() => {
    const code = twoFactorCode.join('');
    if (code.length === 6 && !loading && !codeStatus && step === 'twoFactor') {
      // Небольшая задержка для UX
      const timer = setTimeout(() => {
        handleTwoFactorSubmit(new Event('submit'));
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [twoFactorCode]);

  return (
    <div className="login-page">
      <div className="lava-blob lava-blob-1"></div>
      <div className="lava-blob lava-blob-2"></div>
      <div className="lava-blob lava-blob-3"></div>
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <div className="login-logo-icon">
                <img 
                  src={loginLogo} 
                  alt="Альфа Вики" 
                  style={{ width: '48px', height: '48px', objectFit: 'contain' }}
                />
              </div>
            </div>
            <h1>Альфа Вики</h1>
            <p>
              {step === 'twoFactor' 
                ? 'Подтверждение входа' 
                : 'База знаний медицинского центра'}
            </p>
          </div>

          {step === 'credentials' ? (
            <form onSubmit={handleCredentialsSubmit} className="login-form">
              <div className="form-group">
                <label className="form-label">Логин</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Введите логин"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Пароль</label>
                <div className="password-input">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input"
                    placeholder="Введите пароль"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button 
                type="submit" 
                className="btn btn-primary login-btn"
                disabled={loading}
              >
                {loading ? (
                  <div className="loading-spinner" style={{ width: 20, height: 20 }} />
                ) : (
                  <>
                    <LogIn size={18} />
                    Войти
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleTwoFactorSubmit} className="login-form">
              <div className="two-factor-info">
                <Shield size={48} />
                <p>
                  Введите 6-значный код подтверждения, отправленный на вашу почту
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Код подтверждения</label>
                <div className={`code-input-grid ${codeStatus}`}>
                  {twoFactorCode.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el) => (inputRefs.current[index] = el)}
                      type="text"
                      inputMode="numeric"
                      pattern="\d*"
                      maxLength={1}
                      className="code-digit-input"
                      value={digit}
                      onChange={(e) => handleCodeInput(index, e.target.value)}
                      onKeyDown={(e) => handleCodeKeyDown(index, e)}
                      onPaste={handleCodePaste}
                      autoFocus={index === 0}
                      disabled={loading || codeStatus !== ''}
                    />
                  ))}
                </div>
                {attemptsLeft < 5 && (
                  <small className="form-hint text-warning">
                    Осталось попыток: {attemptsLeft}
                  </small>
                )}
              </div>

              <div className="two-factor-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleResendCode}
                  disabled={loading || codeStatus !== ''}
                >
                  <RefreshCw size={16} />
                  Отправить код повторно
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleBackToLogin}
                  disabled={loading || codeStatus !== ''}
                >
                  Назад к входу
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}