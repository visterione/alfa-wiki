import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import './Login.css';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error('Введите логин и пароль');
      return;
    }

    setLoading(true);
    try {
      await login(username, password);
      toast.success('Добро пожаловать!');
      navigate('/');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка авторизации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <div className="login-logo-icon">
                <LogIn size={28} />
              </div>
            </div>
            <h1>Alfa Wiki</h1>
            <p>База знаний медицинского центра</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
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
        </div>

        <div className="login-footer">
          <p>© 2024 Alfa Wiki. Все права защищены.</p>
        </div>
      </div>
    </div>
  );
}