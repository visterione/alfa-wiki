// Общие слова вкладки «Расписания» (ver. 9.17): их говорят и сама страница, и
// PDF-отчёт аналитики. Одна находка не должна звучать на экране одним образом,
// а в распечатке другим — поэтому формулировки живут здесь, а не в компоненте.

// Специальность, которую смотрели последней. PDF берёт её же: печатают обычно
// то, что только что разглядывали на экране.
export const LS_PROFESSION = 'alfa.scheduleCoverage.profession';
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
