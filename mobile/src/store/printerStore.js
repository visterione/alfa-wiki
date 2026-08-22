import {useCallback, useEffect, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Настройки принтера этикеток.
 *
 * Лежат только на устройстве и на сервер не уезжают намеренно: принтер стоит в
 * отделении, а не у человека, и телефон, который сегодня печатает в Троещине, а
 * завтра на Позняках, должен помнить адрес того принтера, к которому он сейчас
 * подключён. Общая настройка «на пользователя» здесь только мешала бы.
 */
const STORAGE_KEY = 'warehouse-printer-v1';

// Адрес принтера в его собственной сети (Wireless Direct). Значение одинаковое у
// всех P-touch и меняется только если сеть перенастроили: подставляем как
// подсказку, чтобы не заставлять человека лезть в меню принтера ради того, что
// и так известно.
export const DIRECT_MODE_HOST = '192.168.118.1';

const DEFAULTS = {
  host: '',
  port: 9100,
  // Поворот и зеркало — калибровка под конкретный принтер, а не вкус. Какой
  // стороной этикетка выходит из приёмника, из документации Brother не следует;
  // подбирается один раз на первой ленте (см. services/ptouchPrint.js).
  rotate: 90,
  mirror: false,
};

export async function loadPrinter() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? {...DEFAULTS, ...JSON.parse(raw)} : {...DEFAULTS};
  } catch {
    return {...DEFAULTS};
  }
}

export async function savePrinter(patch) {
  const next = {...(await loadPrinter()), ...patch};
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** Настройки принтера с перечитыванием: экран печати открывают сразу после правки адреса. */
export function usePrinter() {
  const [printer, setPrinter] = useState(null);

  const reload = useCallback(() => { loadPrinter().then(setPrinter); }, []);
  useEffect(reload, [reload]);

  const update = useCallback(async (patch) => {
    setPrinter(await savePrinter(patch));
  }, []);

  return {printer, update, reload};
}
