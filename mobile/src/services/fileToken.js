import {chat} from './api';
import {setFileToken} from '../config';

/**
 * Токен доступа к вложениям чатов.
 *
 * Запрашивается один раз при входе и обновляется заранее, до истечения суток:
 * приложение живёт в фоне неделями, и просроченный токен сломал бы картинки в
 * переписке без единого признака, что дело в нём. Почему токен вообще нужен —
 * в backend/services/fileAccess.js.
 */

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 30 * 1000;

let refreshTimer = null;
let retryTimer = null;

async function fetchToken() {
  const {data} = await chat.getFileToken();
  setFileToken(data.token);
}

export async function ensureFileToken() {
  clearTimeout(retryTimer);
  try {
    await fetchToken();
  } catch {
    // Нет сети на старте — не повод оставить человека без вложений до
    // перезапуска приложения
    retryTimer = setTimeout(() => { ensureFileToken(); }, RETRY_DELAY_MS);
  }

  if (!refreshTimer) {
    refreshTimer = setInterval(() => { fetchToken().catch(() => {}); }, REFRESH_INTERVAL_MS);
  }
}

export function resetFileToken() {
  clearInterval(refreshTimer);
  clearTimeout(retryTimer);
  refreshTimer = null;
  retryTimer = null;
  setFileToken(null);
}
