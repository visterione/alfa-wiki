/**
 * Пригласительная ссылка группы (ver. 7.58).
 *
 * Отдельным файлом, а не ещё одной сотней строк в Dashboard.js: у модалки своё
 * состояние (ссылка приезжает запросом) и свой набор действий, а Dashboard и
 * без того на две с половиной тысячи строк.
 *
 * Замысел — в backend/services/chatInvites.js. Здесь важно одно: приём по
 * ссылке выключен, пока его не включили, и первое, что видит админ, — это
 * выключатель, а не готовый адрес. Показать сразу сгенерированную ссылку значит
 * фактически включить её за человека.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { X, Link2, Copy, RefreshCw, Check } from 'lucide-react';
import toast from 'react-hot-toast';

import { chat as chatApi } from '../services/api';

export default function ChatInviteModal({ chatId, onClose }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    chatApi.getInvite(chatId)
      .then(({ data }) => setState(data))
      .catch((e) => {
        toast.error(e.response?.data?.error || 'Не удалось получить ссылку');
        onClose();
      });
  }, [chatId, onClose]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      const { data } = await fn();
      setState(data);
      setCopied(false);
      if (okText) toast.success(okText);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Копирование. navigator.clipboard живёт только в защищённом контексте —
   * на бою это https, но в dev по адресу вида http://192.168.x.x его нет,
   * и без запасного пути кнопка там молча ничего не делала бы.
   */
  const copy = async () => {
    if (!state?.url) return;
    try {
      await navigator.clipboard.writeText(state.url);
    } catch {
      const field = document.createElement('textarea');
      field.value = state.url;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    setCopied(true);
    toast.success('Ссылка скопирована');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Приглашение по ссылке</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          {!state ? (
            <div className="chat-loading"><div className="loading-spinner" /></div>
          ) : !state.enabled ? (
            <>
              <p className="text-muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
                По ссылке в группу сможет вступить любой сотрудник портала, у кого
                она окажется. Посторонним ссылка бесполезна — она требует входа
                в портал.
              </p>
              <button
                className="btn btn-primary"
                disabled={busy}
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => run(() => chatApi.enableInvite(chatId), 'Ссылка готова')}
              >
                <Link2 size={16} /> Включить приглашение по ссылке
              </button>
              {/* У выключенной, но уже выданной ссылки адрес остаётся прежним —
                  об этом стоит сказать заранее, иначе включение выглядит как
                  выпуск новой */}
              {state.url && (
                <p className="text-muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
                  Включится прежняя ссылка. Чтобы разосланная раньше перестала работать,
                  обновите её после включения.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="chat-search" style={{ marginBottom: 10 }}>
                <Link2 size={18} />
                <input readOnly value={state.url || ''} onFocus={e => e.target.select()} />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={copy}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? 'Скопировано' : 'Копировать'}
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => run(() => chatApi.rotateInvite(chatId), 'Ссылка обновлена')}
                  title="Старая ссылка перестанет работать"
                >
                  <RefreshCw size={16} /> Обновить
                </button>
              </div>

              <p className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 0 }}>
                «Обновить» выдаёт новый адрес, а разосланный раньше перестаёт
                работать — так забирают доступ у тех, кому ссылку переслали дальше.
              </p>

              <button
                className="btn btn-ghost"
                disabled={busy}
                style={{ width: '100%', justifyContent: 'center', color: 'var(--error)' }}
                onClick={() => run(() => chatApi.disableInvite(chatId), 'Приглашение выключено')}
              >
                Выключить приглашение
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
