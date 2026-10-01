// Общие слова вкладки «Расписания» (ver. 9.17): их говорят и сама страница, и
// PDF-отчёт аналитики. Одна находка не должна звучать на экране одним образом,
// а в распечатке другим — поэтому формулировки живут здесь, а не в компоненте.

// Специальности, которые смотрели последними. PDF берёт их же: печатают обычно
// то, что только что разглядывали на экране. До 9.19 специальность была одна и
// лежала строкой под LS_PROFESSION — её подхватываем как выбор из одной.
export const LS_PROFESSION = 'alfa.scheduleCoverage.profession';
export const LS_PROFESSIONS = 'alfa.scheduleCoverage.professions';
// Снятые галочки у врачей: { [professionId]: [userId] }. Свои у каждого, см.
// routes/schedule-coverage.js.
export const LS_EXCLUDED = 'alfa.scheduleCoverage.excluded';

export const readLs = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
export const writeLs = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватное окно */ }
};

/** Выбранные специальности из браузера: те, что есть в списке МИС, иначе гинекология. */
export function storedProfessions(list) {
  let ids = readLs(LS_PROFESSIONS, null);
  if (!Array.isArray(ids) || !ids.length) {
    try { const legacy = localStorage.getItem(LS_PROFESSION); ids = legacy ? [legacy] : []; } catch { ids = []; }
  }
  const kept = ids.map(String).filter(id => list.some(p => p.id === id));
  if (kept.length) return kept;
  const def = (list.find(p => p.name === DEFAULT_PROFESSION_NAME) || list[0])?.id;
  return def ? [def] : [];
}

/**
 * Кого не считать: свои снятые галочки по специальности, если человек их уже
 * трогал, иначе общий список, сохранённый до 9.19 (служебные записи вроде КТГ).
 */
export function excludedFor(professionIds, own, saved) {
  const set = new Set();
  for (const pid of professionIds) for (const id of own[pid] ?? saved?.[pid] ?? []) set.add(String(id));
  return set;
}
export const DEFAULT_PROFESSION_NAME = 'Акушерство и гинекология';

export const WD_SHORT = { mon: 'пн', tue: 'вт', wed: 'ср', thu: 'чт', fri: 'пт', sat: 'сб', sun: 'вс' };
export const WD_PLURAL = { mon: 'понедельникам', tue: 'вторникам', wed: 'средам', thu: 'четвергам', fri: 'пятницам', sat: 'субботам', sun: 'воскресеньям' };
export const WD_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const wdOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return WD_KEYS[new Date(y, m - 1, d).getDay()]; };
export const isWeekend = (iso) => ['sat', 'sun'].includes(wdOf(iso));
export const dayNum = (iso) => Number(iso.slice(8, 10));
export const dateShort = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const range = (a, b) => `${hhmm(a)}–${hhmm(b)}`;
export const hours = (min) => {
  const h = min / 60;
  return (Number.isInteger(h) ? String(h) : h.toFixed(1).replace('.', ',')) + ' ч';
};
// «Иванова Анна Петровна» → «Иванова А. П.» — в строке находки полные ФИО не помещаются
export const shortName = (name) => {
  const [last, ...rest] = String(name || '').trim().split(/\s+/);
  return [last, ...rest.map(p => p[0] + '.')].join(' ');
};
export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

export const dateLong = (iso) => `${WD_SHORT[wdOf(iso)]}, ${dayNum(iso)} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`;

/** Заголовок и пояснение находки. who(ids) превращает id врачей в фамилии. */
export function describeFinding(f, who) {
  const cause = (ids) => (ids.length ? `Отмена в графике: ${who(ids)}` : 'В графике на это время никого');
  switch (f.kind) {
    case 'weekday': {
      const all = f.weekdays.every(w => w.dates.length === w.open);
      const title = f.weekdays.length === 1
        ? `По ${WD_PLURAL[f.weekdays[0].weekday]} нет ни одного врача`
        : `Нет ни одного врача по ${f.weekdays.map(w => WD_SHORT[w.weekday]).join(', ')}`;
      const detail = all
        ? 'Так заложено графиком на весь период'
        : f.weekdays.map(w => `${WD_SHORT[w.weekday]} — ${w.dates.length} из ${w.open}`).join(', ') + ' · заложено графиком';
      return { title, detail };
    }
    case 'day':
      return { title: `${dateLong(f.date)} — весь день без врача`, detail: cause(f.cancelledBy) };
    case 'recurring': {
      const n = f.dates.length;
      return {
        title: `${range(f.from, f.to)} без врача — ${n} ${plural(n, 'день', 'дня', 'дней')}`,
        detail: `${f.dates.slice(0, 12).map(dateShort).join(', ')}${n > 12 ? ' …' : ''} · `
          + (f.cause === 'cancel' ? `отмена в графике: ${who(f.cancelledBy)}` : 'заложено графиком'),
      };
    }
    default:
      return {
        title: `${dateLong(f.date)} — без врача ${f.gaps.map(g => range(g.from, g.to)).join(', ')}`,
        detail: cause(f.cancelledBy),
      };
  }
}
