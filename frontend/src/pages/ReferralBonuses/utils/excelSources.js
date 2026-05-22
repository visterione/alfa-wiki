// ─── Server-side storage for Excel source files ───────────────────────────────
// Данные хранятся на сервере в таблице rb_excel_sources (PostgreSQL).
// Доступны всем пользователям, у которых есть доступ к модулю.

import { rbExcelSources } from '../../../services/api';

export async function getSources() {
  const res = await rbExcelSources.list();
  return Array.isArray(res.data) ? res.data : [];
}

// data: { dateFrom, dateTo, periodLabel, fileName, fileData (ArrayBuffer), uploadedBy }
export async function addSource({ dateFrom, dateTo, periodLabel, fileName, fileData, uploadedBy }) {
  const fileBase64 = _bufferToBase64(fileData);
  const res = await rbExcelSources.create({ dateFrom, dateTo, periodLabel, fileName, fileBase64, uploadedBy });
  return res.data;
}

export async function updateSource(id, { dateFrom, dateTo, periodLabel, fileName }) {
  const res = await rbExcelSources.update(id, { dateFrom, dateTo, periodLabel, fileName });
  return res.data;
}

export async function deleteSource(id) {
  await rbExcelSources.delete(id);
}

// Загрузить файл с сервера и вернуть объект File
export async function fetchSourceFile(source) {
  const res = await rbExcelSources.getFile(source.id);
  return new File([res.data], source.fileName, { type: res.data.type });
}

// Читает File/Blob как ArrayBuffer (используется перед addSource)
export function readFileAsBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = e => reject(e.target.error);
    reader.readAsArrayBuffer(file);
  });
}

function _bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
