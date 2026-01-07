import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { auth as authApi } from '../services/api';
import { LogIn, Eye, EyeOff, Shield, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import './Login.css';

export default function Login() {
  const [step, setStep] = useState('credentials'); // 'credentials' | 'twoFactor'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [userId, setUserId] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(5);
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
    if (twoFactorCode.length !== 6) {
      toast.error('Введите 6-значный код');
      return;
    }

    setLoading(true);
    try {
      const { data } = await authApi.verify2FA(userId, twoFactorCode);
      
      if (data.token && data.user) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        toast.success('Добро пожаловать!');
        // Небольшая задержка для отображения toast
        setTimeout(() => {
          navigate('/');
          window.location.reload(); // Перезагружаем для обновления AuthContext
        }, 100);
      } else {
        toast.error('Неожиданный ответ сервера');
      }
    } catch (error) {
      console.error('2FA verification error:', error);
      const errorData = error.response?.data;
      
      if (errorData?.attemptsLeft !== undefined) {
        setAttemptsLeft(errorData.attemptsLeft);
        toast.error(`${errorData.error} (осталось попыток: ${errorData.attemptsLeft})`);
      } else {
        toast.error(errorData?.error || 'Неверный код');
      }
      
      // Если код истёк или слишком много попыток - возвращаемся на шаг 1
      if (errorData?.error?.includes('expired') || errorData?.error?.includes('Too many')) {
        setStep('credentials');
        setTwoFactorCode('');
        setUserId(null);
        setPassword('');
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
      setTwoFactorCode('');
      setAttemptsLeft(5);
    } catch (error) {
      console.error('Resend error:', error);
      toast.error('Ошибка отправки кода');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setStep('credentials');
    setTwoFactorCode('');
    setUserId(null);
    setAttemptsLeft(5);
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <div className="login-logo-icon">
                {step === 'twoFactor' ? <Shield size={28} /> : <LogIn size={28} />}
              </div>
            </div>
            <h1>Alfa Wiki</h1>
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
                <input
                  type="text"
                  className="input code-input"
                  placeholder="000000"
                  value={twoFactorCode}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setTwoFactorCode(value);
                  }}
                  maxLength={6}
                  autoFocus
                  disabled={loading}
                />
                {attemptsLeft < 5 && (
                  <small className="form-hint text-warning">
                    Осталось попыток: {attemptsLeft}
                  </small>
                )}
              </div>

              <button 
                type="submit" 
                className="btn btn-primary login-btn"
                disabled={loading || twoFactorCode.length !== 6}
              >
                {loading ? (
                  <div className="loading-spinner" style={{ width: 20, height: 20 }} />
                ) : (
                  <>
                    <Shield size={18} />
                    Подтвердить
                  </>
                )}
              </button>

              <div className="two-factor-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleResendCode}
                  disabled={loading}
                >
                  <RefreshCw size={16} />
                  Отправить код повторно
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleBackToLogin}
                  disabled={loading}
                >
                  Назад к входу
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="login-footer">
          <p>Альфа Вики - 2026</p>
        </div>
      </div>
    </div>
  );
}