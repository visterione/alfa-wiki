import {useEffect, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {warehouse as warehouseApi} from '../services/api';

/**
 * Права на складской модуль — один ответ сервера на всё приложение.
 *
 * Раньше каждый экран спрашивал GET /warehouse/access сам, и на один заход в
 * кабинет уходило три одинаковых запроса: главный экран, карточка актива,
 * дашборд кабинета. Хуже того, права понадобились навигационной панели: кнопку
 * склада нельзя показывать тому, кому раздел закрыт, а панель живёт вне любого
 * экрана и дождаться чужого запроса не может.
 *
 * Магазин вне React по образцу unreadStore: подписчики (панель и экраны) лежат
 * в разных ветках дерева, а источник один.
 *
 * Значение кэшируется до конца сессии. Права меняет администратор в вебе, и
 * узнать об этом на телефоне всё равно можно только перезапуском — опрашивать
 * ручку по таймеру ради события раз в полгода незачем.
 */

let access = null;
let pending = null;
const listeners = new Set();

const publish = value => {
  access = value;
  listeners.forEach(fn => fn(value));
};

/**
 * Загрузка прав. Повторные вызовы во время запроса возвращают тот же промис —
 * иначе четыре экрана, открывшиеся разом, снова дали бы четыре запроса.
 */
export function loadWarehouseAccess({force = false} = {}) {
  if (access && !force) return Promise.resolve(access);
  if (pending) return pending;

  pending = warehouseApi.access()
    .then(({data}) => data)
    // Сеть отвалилась — это не «доступ запрещён». Но и показать раздел мы не
    // можем, поэтому отвечаем закрытым доступом и не запоминаем его: следующий
    // вызов попробует ещё раз.
    .catch(() => ({allowed: false, offline: true}))
    .then((data) => {
      pending = null;
      if (!data.offline) publish(data);
      return data;
    });

  return pending;
}

export function getWarehouseAccess() {
  return access;
}

/**
 * Дерево локаций — тоже на всё приложение.
 *
 * Понадобилось, когда кабинеты стали выбираться спуском «медцентр → корпус →
 * этаж»: каждый уровень это отдельный экран стека, и без общего ответа спуск
 * на три шага означал три одинаковых запроса и три мигания индикатора подряд.
 * Дерево вдобавок спрашивают размещение и открытие описи.
 *
 * В отличие от прав, здесь срок годности: локации правят в вебе заметно чаще,
 * чем раздают права, и держать список кабинетов до перезапуска приложения
 * значило бы не видеть новый кабинет весь рабочий день.
 */
const LOCATIONS_TTL = 5 * 60 * 1000;

let locations = null;
let locationsAt = 0;
let locationsPending = null;

/** Дерево из кэша или null, если его нет или оно протухло. Без запроса. */
export function getLocationTree() {
  return Date.now() - locationsAt < LOCATIONS_TTL ? locations : null;
}

export function loadLocationTree({force = false} = {}) {
  const fresh = getLocationTree();
  if (fresh && !force) return Promise.resolve(fresh);
  if (locationsPending) return locationsPending;

  locationsPending = warehouseApi.tree()
    .then(({data}) => {
      locations = data;
      locationsAt = Date.now();
      return data;
    })
    // Сеть отвалилась — отдаём прошлое дерево, если оно было: показать вчерашний
    // список кабинетов полезнее, чем пустой экран. Времени не обновляем, чтобы
    // следующий заход попробовал ещё раз.
    .catch(() => locations || {medCenters: []})
    .finally(() => { locationsPending = null; });

  return locationsPending;
}

/** Сброс при выходе из аккаунта: следующий человек не должен унаследовать чужие права. */
export function resetWarehouseAccess() {
  access = null;
  pending = null;
  setWarehouseBadge(0);
  locations = null;
  locationsAt = 0;
  locationsPending = null;
  // Выбранный медцентр стирается вместе с правами и из памяти телефона тоже:
  // следующий, кто войдёт на этом аппарате, не должен увидеть чужой склад.
  medCenter = null;
  medCenterPending = null;
  AsyncStorage.removeItem(MED_CENTER_KEY).catch(() => {});
  medCenterListeners.forEach(fn => fn(null));
  listeners.forEach(fn => fn(null));
}

/**
 * Права в компоненте. null означает «ещё не знаем» — это отличается от
 * «доступа нет», и панель на этой разнице держится: пока права не пришли,
 * кнопки склада в дуге нет, но и надписи «нет доступа» тоже.
 */
export function useWarehouseAccess() {
  const [value, setValue] = useState(access);

  useEffect(() => {
    setValue(access);
    listeners.add(setValue);
    loadWarehouseAccess();
    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}

/**
 * Счётчик на кнопке склада в колесе.
 *
 * Считаются открытые описи — единственное в модуле, что прямо ждёт действия
 * человека и имеет однозначное число. Очередь размещения сюда не входит
 * намеренно: она измеряется в позициях ведомости, счёт там идёт на тысячи, и
 * рядом с «2» от чатов такое число читалось бы как авария.
 *
 * Значение публикуется тем же способом, что непрочитанные сообщения: магазин вне
 * React, потому что подписчик (панель навигации) и источник (экран склада) живут
 * в разных ветках дерева.
 */
let badge = 0;
const badgeListeners = new Set();

export function setWarehouseBadge(value) {
  const next = Math.max(0, Math.trunc(value) || 0);
  if (next === badge) return;
  badge = next;
  badgeListeners.forEach(fn => fn(badge));
}

export function useWarehouseBadge() {
  const [value, setValue] = useState(badge);

  useEffect(() => {
    setValue(badge);
    badgeListeners.add(setValue);
    return () => { badgeListeners.delete(setValue); };
  }, []);

  return value;
}

/**
 * Обновить счётчик, не открывая раздел.
 *
 * Панель навигации зовёт это, как только приходят права: иначе цифра появлялась
 * бы только после того, как человек хотя бы раз заглянул на склад, — то есть
 * ровно тогда, когда она уже не нужна.
 */
export function refreshWarehouseBadge() {
  return warehouseApi.inventorySessions()
    .then(({data}) => {
      const open = (data || []).filter(s => s.status !== 'closed' && s.status !== 'cancelled');
      setWarehouseBadge(open.length);
      return open.length;
    })
    .catch(() => badge);
}

/** Короткая проверка возможности: `useWarehouseCan('canIssue')`. */
export function useWarehouseCan(capability) {
  const value = useWarehouseAccess();
  return Boolean(value?.allowed && value.capabilities?.[capability]);
}


/**
 * Выбранный медцентр — один на весь раздел.
 *
 * Раньше медцентр спрашивали в каждом месте по-своему: в кабинетах это был
 * первый шаг спуска, в оборудовании — строка в листе отбора, в материалах его
 * не было вовсе. Три разных ответа на один вопрос «где я работаю», который за
 * смену не меняется. Теперь ответ один и живёт здесь.
 *
 * Пустая строка означает всю сеть — это полноценный режим, а не «ничего не
 * выбрано»: снабжению и тем, кто ведёт сеть целиком, нужен именно он.
 *
 * Значение переживает перезапуск, поэтому магазин отвечает не сразу, и у него
 * есть третье состояние — «ещё читаем». Экраны обязаны его дождаться: запрос,
 * ушедший до чтения памяти, вернул бы всю сеть, и человек увидел бы чужие
 * кабинеты, которые через миг сменились бы своими.
 */
const MED_CENTER_KEY = 'warehouse.medCenterId';

/** '' — вся сеть, null — ещё не прочитали из памяти. */
let medCenter = null;
let medCenterPending = null;
const medCenterListeners = new Set();

const publishMedCenter = value => {
  medCenter = value;
  medCenterListeners.forEach(fn => fn(value));
};

/**
 * Первый выбор человек не делает — его делает за него зона ответственности.
 *
 * В складских правах администратор перечисляет медцентры, за которые человек
 * отвечает. Если он там один, спрашивать нечего: это и есть тот медцентр, куда
 * человек ходит на работу. Пустой список означает доступ ко всей сети — тогда
 * и стартуем со всей сети.
 */
const defaultMedCenter = () => {
  const scoped = access?.medCenterIds;
  return Array.isArray(scoped) && scoped.length === 1 ? scoped[0] : '';
};

export function loadWarehouseMedCenter() {
  if (medCenter !== null) return Promise.resolve(medCenter);
  if (medCenterPending) return medCenterPending;

  medCenterPending = Promise.all([
    // Память недоступна — это не повод залипнуть в «ещё читаем» навсегда:
    // отвечаем значением по умолчанию, просто не запомним его.
    AsyncStorage.getItem(MED_CENTER_KEY).catch(() => null),
    // Права ждём намеренно: выбор по умолчанию берётся из зоны
    // ответственности, а она приезжает с ними. Без ожидания человек с одним
    // медцентром получал бы всю сеть — и до самого перезапуска, потому что
    // умолчание вычисляется единожды. Запроса это не добавляет: права
    // кэшируются на всё приложение.
    loadWarehouseAccess(),
  ])
    .then(([saved]) => {
      publishMedCenter(saved === null ? defaultMedCenter() : saved);
      medCenterPending = null;
      return medCenter;
    });

  return medCenterPending;
}

export function getWarehouseMedCenter() {
  return medCenter;
}

export function setWarehouseMedCenter(value) {
  const next = value || '';
  if (next === medCenter) return;
  publishMedCenter(next);
  AsyncStorage.setItem(MED_CENTER_KEY, next).catch(() => {});
}

/**
 * Сверка выбора с тем, что вообще есть.
 *
 * Медцентр могли закрыть, а права — сузить. Молча показывать пустые списки
 * из-за выбора, сделанного полгода назад, нельзя: человек решит, что пропал
 * склад, а не что пропал медцентр.
 */
export function reconcileWarehouseMedCenter(availableIds) {
  if (!medCenter) return;
  if (availableIds.includes(medCenter)) return;
  setWarehouseMedCenter('');
}

/**
 * Выбранный медцентр в компоненте.
 *
 * ready отделяет «вся сеть» от «ещё не прочитали»: обе величины — пустая
 * строка и null — ложны, и без отдельного признака экран не отличил бы их.
 */
export function useWarehouseMedCenter() {
  const [value, setValue] = useState(medCenter);

  useEffect(() => {
    setValue(medCenter);
    medCenterListeners.add(setValue);
    loadWarehouseMedCenter();
    return () => { medCenterListeners.delete(setValue); };
  }, []);

  return {medCenterId: value || '', ready: value !== null};
}
