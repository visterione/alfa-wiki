import {useEffect, useState} from 'react';

import {mail as mailApi} from '../services/api';

// Панель навигации живёт отдельно от экрана почты. Этот небольшой магазин даёт
// ей право скрыть раздел тем, кому не выдан ни один общий ящик, и показывает
// непрочитанные ещё до первого захода в раздел.
let accounts = null;
let pending = null;
const listeners = new Set();

const publish = value => {
  accounts = value;
  listeners.forEach(listener => listener(value));
};

export function loadMailAccounts({force = false} = {}) {
  if (accounts && !force) return Promise.resolve(accounts);
  if (pending) return pending;

  pending = mailApi.accounts()
    .then(({data}) => Array.isArray(data?.accounts) ? data.accounts : [])
    .catch(() => null)
    .then(value => {
      pending = null;
      // Сетевой сбой не запоминаем как отсутствие доступа: следующий заход
      // должен повторить попытку, а не спрятать почту до перезапуска.
      if (value) publish(value);
      return value || [];
    });
  return pending;
}

export function useMailAccounts() {
  const [value, setValue] = useState(accounts);
  useEffect(() => {
    setValue(accounts);
    listeners.add(setValue);
    loadMailAccounts();
    return () => listeners.delete(setValue);
  }, []);
  return value;
}

export function setMailUnread(accountId, unread) {
  if (!accounts) return;
  publish(accounts.map(item => item.id === accountId ? {...item, unread: Math.max(0, unread)} : item));
}

export function resetMail() {
  accounts = null;
  pending = null;
  listeners.forEach(listener => listener(null));
}
