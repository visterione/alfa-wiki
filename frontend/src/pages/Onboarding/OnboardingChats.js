/**
 * Рабочие чаты филиала.
 *
 * Список ссылок, который уходит врачу письмом, когда закрыт последний шаг
 * чек-листа. Раньше их кидали руками — кто вспомнил, тот и кинул, — и врач
 * регулярно оказывался не в том чате или ни в одном.
 *
 * Строки нарисованы так же, как карточки в письме: аватарка, название, подпись,
 * адрес. Это не украшательство — настраивающий должен видеть ровно то, что
 * получит врач, иначе проверить письмо можно только отправив его человеку.
 *
 * Превью (название и фотография группы) читает бэкенд: страницу приглашения
 * телеграм отдаёт без CORS, из браузера её не прочитать.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Building2, Plus, RefreshCw, Trash2, Eye, EyeOff, AlertTriangle, Send, ImagePlus, Info,
} from 'lucide-react';

import { onboarding as api, BASE_URL } from '../../services/api';
import OnbSelect from './OnbSelect';
import './Onboarding.css';

export default function OnboardingChats() {
  const [data, setData] = useState(null);
  const [branch, setBranch] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.chats();
      setData(res);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось загрузить список чатов');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="onb-empty">Загружаем…</div>;
  if (!data.medCenters.length) return <div className="onb-empty">В справочнике нет ни одного филиала</div>;

  const medCenterId = branch || data.medCenters[0].id;
  const rows = data.chats.filter(chat => chat.medCenterId === medCenterId);

  const add = async (event) => {
    event.preventDefault();
    setAdding(true);
    try {
      const { data: created } = await api.addChat({ url: url.trim(), medCenterId });
      setUrl('');
      await load();
      if (created.fetchError) {
        toast(`Чат добавлен, но превью не прочиталось: ${created.fetchError}. Подпишите его вручную.`,
          { icon: '⚠️' });
      } else {
        toast.success(`Добавлен «${created.title}»`);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось добавить чат');
    } finally {
      setAdding(false);
    }
  };

  const patch = async (id, body) => {
    try {
      await api.saveChat(id, body);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось сохранить');
    }
    await load();
  };

  const refresh = async (id) => {
    try {
      const { data: fresh } = await api.refreshChat(id);
      await load();
      if (fresh.fetchError) toast.error(fresh.fetchError);
      else toast.success('Превью обновлено');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось обновить превью');
    }
  };

  const setAvatar = async (id, file) => {
    const form = new FormData();
    form.append('avatar', file);
    try {
      await api.chatAvatar(id, form);
      await load();
      toast.success('Картинка обновлена');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось сохранить картинку');
    }
  };

  const remove = async (chat) => {
    if (!window.confirm(`Убрать «${chat.title}» из письма врачу?`)) return;
    try {
      await api.deleteChat(chat.id);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось удалить');
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const { data: res } = await api.testChatMail({ medCenterId });
      toast.success(`Письмо с ${res.chats} чатами ушло на ${res.email}`);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось отправить пробное письмо');
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <div className="onb-branchbar">
        <Building2 size={15} />
        <span>Филиал</span>
        <OnbSelect
          value={medCenterId}
          onChange={setBranch}
          options={data.medCenters.map(mc => ({ value: mc.id, label: mc.name }))}
        />
        {/* Пробное письмо — проверка настройки, а не действие над списком,
            поэтому стоит в шапке, а не под строками. */}
        <button className="onb-btn is-sm onb-branchbar-act" onClick={sendTest} disabled={testing}>
          <Send size={13} /> {testing ? 'Отправляем…' : 'Пробное письмо себе'}
        </button>
      </div>

      <form className="onb-invite" onSubmit={add}>
        <div className="onb-invite-row">
          <input
            className="onb-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://t.me/+ссылка-приглашение"
            required
          />
          <button className="onb-btn is-primary is-sm" type="submit" disabled={adding || !url.trim()}>
            <Plus size={13} /> {adding ? 'Читаем чат…' : 'Добавить'}
          </button>
        </div>
      </form>

      <div className="onb-chats">
        {rows.map(chat => (
          <ChatRow
            key={chat.id}
            chat={chat}
            onPatch={(body) => patch(chat.id, body)}
            onRefresh={() => refresh(chat.id)}
            onAvatar={(file) => setAvatar(chat.id, file)}
            onRemove={() => remove(chat)}
          />
        ))}

        {!rows.length && (
          <div className="onb-empty is-compact">
            Чатов для этого филиала нет — письмо врачу уйдёт без приглашений.
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Строка чата. Название и подпись правятся прямо в списке и сохраняются по
 * уходу из поля: отдельная форма редактирования ради двух полей — лишний экран,
 * а из письма всё равно видно только их.
 */
function ChatRow({ chat, onPatch, onRefresh, onAvatar, onRemove }) {
  const [title, setTitle] = useState(chat.title);
  const [subtitle, setSubtitle] = useState(chat.subtitle || '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  // Строку могли обновить извне — по кнопке «обновить превью» или после
  // перезагрузки списка. Тогда поля должны показать пришедшее, а не то, что
  // осталось в состоянии от прошлого рендера.
  useEffect(() => { setTitle(chat.title); }, [chat.title]);
  useEffect(() => { setSubtitle(chat.subtitle || ''); }, [chat.subtitle]);

  const commit = (field, value, previous) => {
    if (value.trim() === (previous || '').trim()) return;
    onPatch({ [field]: value.trim() });
  };

  const refresh = async () => {
    setBusy(true);
    await onRefresh();
    setBusy(false);
  };

  return (
    <div className={`onb-chat${chat.isActive ? '' : ' is-off'}`}>
      {/* Картинку меняют кликом по ней самой: отдельная кнопка «загрузить
          аватарку» в строке — четвёртая иконка ради редкого действия. */}
      <button
        type="button"
        className="onb-chat-avatarbtn"
        title="Загрузить картинку"
        onClick={() => fileRef.current?.click()}
      >
        <ChatAvatar chat={chat} />
        <span><ImagePlus size={15} /></span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Сбрасываем значение: иначе повторный выбор того же файла (например,
          // после неудачной загрузки) не поднимет change.
          event.target.value = '';
          if (file) onAvatar(file);
        }}
      />

      <div className="onb-chat-body">
        <input
          className="onb-chat-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => commit('title', title, chat.title)}
          placeholder="Название чата"
        />
        <input
          className="onb-chat-sub"
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          onBlur={() => commit('subtitle', subtitle, chat.subtitle)}
          placeholder="Подпись: зачем этот чат"
        />
        <a className="onb-chat-url" href={chat.url} target="_blank" rel="noreferrer">{chat.url}</a>

        {chat.fetchError && (
          <div className="onb-chat-warn">
            <AlertTriangle size={13} /> {chat.fetchError}
          </div>
        )}

        {chat.isPortal && (
          <div className="onb-chat-note">
            <Info size={13} /> Чат портала — откроется после входа, а учётной записи у врача нет
          </div>
        )}
      </div>

      <div className="onb-chat-acts">
        <button
          type="button"
          title={chat.isActive ? 'Уходит врачу — выключить' : 'Выключен — включить'}
          className={chat.isActive ? 'is-on' : ''}
          onClick={() => onPatch({ isActive: !chat.isActive })}
        >
          {chat.isActive ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button type="button" title="Перечитать название и аватарку" onClick={refresh} disabled={busy}>
          <RefreshCw size={15} className={busy ? 'onb-spin' : ''} />
        </button>
        <button type="button" title="Удалить" className="is-danger" onClick={onRemove}>
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

/** Аватарка чата, а если её не удалось скачать — кружок с первой буквой, как в письме. */
function ChatAvatar({ chat }) {
  if (chat.avatarUrl) {
    return <img className="onb-chat-avatar" src={`${BASE_URL}${chat.avatarUrl}`} alt="" />;
  }
  return (
    <div className="onb-chat-avatar is-empty">
      {(chat.title || '#').trim().charAt(0).toUpperCase()}
    </div>
  );
}
