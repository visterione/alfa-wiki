import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, RefreshCw, Pencil, Trash2, X, ChevronDown, ChevronRight, KeyRound
} from 'lucide-react';
import toast from 'react-hot-toast';
import { reviewCollector } from '../services/api';
import PlatformLogo from '../components/PlatformLogo';
import './ReviewPlatforms.css';

/**
 * «Площадки» — учётные записи площадок отзывов для Альфа Парсера (ver. 8.80).
 *
 * Страница рассчитана на маркетолога без доступа к серверу: пароли меняются,
 * и всё, что для этого нужно, — здесь. Учётка после сохранения сразу уходит
 * на проверку; парсер входит, сообщает итог и присылает места из выпадающего
 * списка кабинета. Место привязывается к медцентру и проходит два режима:
 * сверку (отзывы только связываются с карточками GetLoyalty) и работу.
 */

const STATUS = {
  new:          { label: 'Не проверена',    tone: 'muted' },
  ok:           { label: 'Работает',        tone: 'ok' },
  needs_login:  { label: 'Нужен вход',      tone: 'warn' },
  bad_password: { label: 'Неверный пароль', tone: 'bad' },
  error:        { label: 'Ошибка',          tone: 'bad' },
};

const MODES = [
  { key: 'off',    label: 'Выкл.',    title: 'Отзывы с этого места не берутся' },
  { key: 'shadow', label: 'Сверка',   title: 'Отзывы только связываются с карточками GetLoyalty, новые карточки не создаются' },
  { key: 'live',   label: 'Работает', title: 'Новые отзывы становятся карточками, ответы уходят напрямую' },
];

// Пока парсер проверяет учётку или ждёт подтверждения входа, страница сама
// перечитывает состояние: иначе цифры Яндекса пришлось бы ловить кнопкой F5.
const POLL_MS = 5000;

function formatDateTime(value) {
  if (!value) return null;
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function AccountModal({ platforms, account, onClose, onSaved }) {
  const isEdit = !!account;
  const [form, setForm] = useState({
    platform: account?.platform || platforms[0]?.key || '',
    label: account?.label || '',
    login: account?.login || '',
    password: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      if (isEdit) {
        const patch = { label: form.label, login: form.login };
        if (form.password) patch.password = form.password;
        await reviewCollector.updateAccount(account.id, patch);
      } else {
        await reviewCollector.createAccount(form);
      }
      toast.success(isEdit ? 'Сохранено' : 'Учётная запись добавлена и ушла на проверку');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rp-modal-overlay" onClick={onClose}>
      <form className="rp-modal" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="rp-modal-header">
          <h2>{isEdit ? 'Учётная запись' : 'Новая учётная запись'}</h2>
          <button type="button" className="rp-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {!isEdit && (
          <label className="rp-field">
            <span>Площадка</span>
            <select value={form.platform} onChange={set('platform')}>
              {platforms.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
        )}
        <label className="rp-field">
          <span>Название</span>
          <input value={form.label} onChange={set('label')} placeholder="Например, «Альфа и 3К»" />
        </label>
        <label className="rp-field">
          <span>Логин</span>
          <input value={form.login} onChange={set('login')} autoComplete="off" required />
        </label>
        <label className="rp-field">
          <span>{isEdit ? 'Новый пароль' : 'Пароль'}</span>
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
            placeholder={isEdit ? 'Оставьте пустым, чтобы не менять' : ''}
            required={!isEdit}
          />
        </label>

        <div className="rp-modal-actions">
          <button type="button" className="rp-btn rp-btn--ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="rp-btn rp-btn--primary" disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
}

function PlaceRow({ place, boards, onChange }) {
  const [open, setOpen] = useState(false);
  const stats = place.stats || {};
  const samples = stats.unmatchedSamples || [];

  const update = async (patch) => {
    try {
      await reviewCollector.updatePlace(place.id, patch);
      onChange();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить');
    }
  };

  return (
    <div className="rp-place">
      <div className="rp-place-main">
        <div className="rp-place-name">
          <span>{place.name || place.externalId}</span>
          {place.address && <small>{place.address}</small>}
        </div>

        <select
          className="rp-place-board"
          value={place.boardId || ''}
          onChange={e => update({ boardId: e.target.value || null, ...(e.target.value ? {} : { mode: 'off' }) })}
        >
          <option value="">Медцентр не выбран</option>
          {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <div className="rp-modes" role="group">
          {MODES.map(m => (
            <button
              key={m.key}
              type="button"
              title={m.title}
              className={`rp-mode${place.mode === m.key ? ' rp-mode--active' : ''} rp-mode--${m.key}`}
              disabled={m.key !== 'off' && !place.boardId}
              onClick={() => place.mode !== m.key && update({ mode: m.key })}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {stats.at && (
        <div className="rp-place-stats">
          <span>Связано с карточками: <b>{stats.linked || 0}</b></span>
          <span>За последний проход — совпало {stats.matched || 0}, новых {stats.created || 0}</span>
          {stats.unmatched > 0 && (
            <button type="button" className="rp-link" onClick={() => setOpen(v => !v)}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              не нашлось у GetLoyalty: {stats.unmatched}
            </button>
          )}
          <span className="rp-muted">{formatDateTime(stats.at)}</span>
        </div>
      )}

      {open && samples.length > 0 && (
        <ul className="rp-samples">
          {samples.map(s => (
            <li key={s.id}>
              <span className="rp-muted">{new Date(s.date).toLocaleDateString('ru-RU')}</span>
              {s.rating && <span>★ {s.rating}</span>}
              {s.doctor && <span className="rp-muted">{s.doctor}</span>}
              <span className="rp-sample-text">{s.text || 'без текста'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountCard({ account, boards, onEdit, onChange }) {
  const status = STATUS[account.status] || STATUS.new;
  const challenge = account.challenge;

  const check = async () => {
    try {
      await reviewCollector.checkAccount(account.id);
      onChange();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось поставить проверку');
    }
  };

  const toggle = async () => {
    try {
      await reviewCollector.updateAccount(account.id, { isEnabled: !account.isEnabled });
      onChange();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить');
    }
  };

  const remove = async () => {
    if (!window.confirm(`Удалить учётную запись ${account.login}? Места и их привязки к медцентрам удалятся вместе с ней; уже собранные отзывы останутся.`)) return;
    try {
      await reviewCollector.deleteAccount(account.id);
      onChange();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось удалить');
    }
  };

  return (
    <div className={`rp-account${account.isEnabled ? '' : ' rp-account--disabled'}`}>
      <div className="rp-account-head">
        <div className="rp-account-title">
          <span className="rp-account-name">{account.label || account.login}</span>
          {account.label && <span className="rp-muted">{account.login}</span>}
        </div>

        <span className={`rp-status rp-status--${account.checking ? 'muted' : status.tone}`}>
          {account.checking ? 'Проверяется…' : status.label}
        </span>

        <div className="rp-account-actions">
          <button type="button" className="rp-icon-btn" title="Проверить вход" onClick={check} disabled={account.checking}>
            <RefreshCw size={16} className={account.checking ? 'rp-spin' : ''} />
          </button>
          <button type="button" className="rp-icon-btn" title="Изменить логин или пароль" onClick={onEdit}>
            <Pencil size={16} />
          </button>
          <label className="rp-switch" title={account.isEnabled ? 'Выключить сбор' : 'Включить сбор'}>
            <input type="checkbox" checked={account.isEnabled} onChange={toggle} />
            <span />
          </label>
          <button type="button" className="rp-icon-btn rp-icon-btn--danger" title="Удалить" onClick={remove}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {challenge?.kind === 'confirm' && (
        <div className="rp-challenge">
          <KeyRound size={16} />
          <span>
            Подтвердите вход на телефоне
            {challenge.digits && <> — цифры <b className="rp-digits">{challenge.digits}</b></>}
          </span>
        </div>
      )}

      {account.statusMessage && account.status !== 'ok' && !account.checking && (
        <div className="rp-account-message">{account.statusMessage}</div>
      )}

      {account.lastCollectedAt && (
        <div className="rp-muted rp-account-collected">Отзывы собраны {formatDateTime(account.lastCollectedAt)}</div>
      )}

      {account.places?.length > 0 ? (
        <div className="rp-places">
          {account.places.map(p => (
            <PlaceRow key={p.id} place={p} boards={boards} onChange={onChange} />
          ))}
        </div>
      ) : (
        account.status === 'ok' && <div className="rp-muted rp-account-message">Кабинет не показал ни одного медцентра</div>
      )}
    </div>
  );
}

const ReviewPlatforms = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(null); // { account } | { account: null }
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await reviewCollector.load();
      setData(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось загрузить площадки');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const waiting = !!data?.accounts?.some(a => a.checking || a.status === 'needs_login');
  useEffect(() => {
    if (!waiting) return undefined;
    pollRef.current = setInterval(load, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [waiting, load]);

  const toggleExcluded = async (name) => {
    const current = data.getloyalty.excluded;
    const next = current.includes(name) ? current.filter(n => n !== name) : [...current, name];
    try {
      const res = await reviewCollector.setGetLoyaltyExcluded(next);
      setData(prev => ({ ...prev, getloyalty: { ...prev.getloyalty, excluded: res.data.excluded } }));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить');
    }
  };

  if (!data) {
    return (
      <div className="rp-page rp-loading">
        <div className="loading-spinner" />
      </div>
    );
  }

  const glAll = data.getloyalty.platformNames.every(n => data.getloyalty.excluded.includes(n));

  return (
    <div className="rp-page">
      <div className="rp-header">
        <button className="rp-back" onClick={() => navigate('/reviews?all')} title="К доскам">
          <ArrowLeft size={20} />
        </button>
        <h1>Площадки</h1>
        <button className="rp-btn rp-btn--primary rp-header-add" onClick={() => setModal({ account: null })}>
          <Plus size={16} />
          Учётная запись
        </button>
      </div>

      {data.platforms.map(platform => {
        const accounts = data.accounts.filter(a => a.platform === platform.key);
        return (
          <section key={platform.key} className="rp-section">
            <div className="rp-section-head">
              <PlatformLogo name={platform.reviewPlatform} size={20} />
              <h2>{platform.label}</h2>
              {!platform.canReply && <span className="rp-muted">только чтение</span>}
            </div>
            {accounts.length === 0 ? (
              <div className="rp-muted rp-empty">Учётных записей нет</div>
            ) : (
              accounts.map(a => (
                <AccountCard
                  key={a.id}
                  account={a}
                  boards={data.boards}
                  onEdit={() => setModal({ account: a })}
                  onChange={load}
                />
              ))
            )}
          </section>
        );
      })}

      <section className="rp-section">
        <div className="rp-section-head">
          <h2>GetLoyalty</h2>
        </div>
        <p className="rp-muted rp-gl-note">
          Отмеченные площадки больше не берутся из GetLoyalty — их отзывы собирает парсер.
          {glAll && ' Отмечены все: GetLoyalty можно отключать.'}
        </p>
        <div className="rp-gl-list">
          {data.getloyalty.platformNames.map(name => (
            <label key={name} className="rp-gl-item">
              <input
                type="checkbox"
                checked={data.getloyalty.excluded.includes(name)}
                onChange={() => toggleExcluded(name)}
              />
              <PlatformLogo name={name} size={16} />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </section>

      {modal && (
        <AccountModal
          platforms={data.platforms}
          account={modal.account}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
};

export default ReviewPlatforms;
