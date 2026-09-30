import React, { useSyncExternalStore } from 'react';
import { users } from '../services/api';
import renovatioLogo from '../assets/images/renovatio.png';
import './MisBadge.css';

/**
 * Значок Renovatio на аватарке сотрудника, связанного с МИС (ver. 9.12).
 *
 * Кто связан — знает один список id с сервера (/users/mis-linked), а не поле в
 * каждом ответе: аватарки рисуют чаты, реакции, задачи, отзывы, и у каждого
 * места свой набор полей пользователя. Список грузится один раз на вкладку и
 * обновляется, когда в админке сохраняют пользователя.
 */

let linked = new Set();
let loaded = false;
let loading = null;
const listeners = new Set();

function emit() {
  listeners.forEach(fn => fn());
}

export function refreshMisLinked() {
  loading = users.misLinked()
    .then(({ data }) => {
      linked = new Set((Array.isArray(data) ? data : []).map(String));
      loaded = true;
      emit();
    })
    .catch(() => { /* без списка значков просто не будет — не повод для ошибки */ })
    .finally(() => { loading = null; });
  return loading;
}

function subscribe(fn) {
  listeners.add(fn);
  // Грузим лениво — при первой аватарке на экране. На странице входа их нет,
  // и запрос без токена туда бы не ушёл.
  if (!loaded && !loading && localStorage.getItem('token')) refreshMisLinked();
  return () => listeners.delete(fn);
}

const snapshot = () => linked;

export function useIsMisLinked(userId) {
  const set = useSyncExternalStore(subscribe, snapshot);
  return userId != null && set.has(String(userId));
}

/**
 * Сам значок. Родитель обязан быть position: relative и не обрезать края:
 * аватарки почти везде — круги с overflow: hidden, и значок внутри такого
 * круга срезался бы наполовину. Для этого есть MisAvatar ниже.
 *
 * size — диаметр аватарки. Значок — около трети от него, но не меньше 12 px
 * (мельче логотип не различить) и не больше 26 px (на крупной аватарке
 * профиля пропорциональный значок начинает спорить с лицом). На аватарках
 * мельче 24 px значок не рисуется вовсе — там он был бы соринкой.
 */
export function MisBadge({ userId, size = 40, on }) {
  const linked = useIsMisLinked(userId);
  // on — явный признак, мимо общего списка: форма пользователя в админке
  // показывает значок, как только выбрали сотрудника МИС, ещё до сохранения.
  const show = on ?? linked;
  if (!show || size < 24) return null;
  const d = Math.min(26, Math.max(12, Math.round(size * 0.38)));
  // Центр значка — на окружности аватарки под 45°, а не в углу описанного
  // квадрата: на крупной аватарке угол квадрата далеко от круга, и значок
  // висел бы в пустоте. 0.146 — это (1 − cos 45°) / 2 от диаметра.
  const inset = Math.round(size * 0.146 - d / 2);
  return (
    <span className="mis-badge" style={{ width: d, height: d, right: inset, bottom: inset }} title="Сотрудник из МИС Renovatio">
      <img className="mis-badge-logo" src={renovatioLogo} alt="" />
    </span>
  );
}

/**
 * Обёртка для аватарки, у которой нет своего не обрезающего контейнера.
 * Не меняет раскладку: занимает ровно место аватарки.
 */
export function MisAvatar({ userId, size, on, children, className = '', style }) {
  return (
    <span className={`mis-avatar ${className}`} style={style}>
      {children}
      <MisBadge userId={userId} size={size} on={on} />
    </span>
  );
}

export default MisBadge;
