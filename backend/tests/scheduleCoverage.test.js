const test = require('node:test');
const assert = require('node:assert/strict');
const cov = require('../utils/scheduleCoverage');

// Запись getSchedulePeriods в том виде, в каком её отдаёт МИС
const rec = (user, clinic, date, from, to, type = 1) => {
  const [y, m, d] = date.split('-');
  const ru = `${d}.${m}.${y}`;
  return { date: ru, time_start: `${ru} ${from}`, time_end: `${ru} ${to}`, type, clinic_id: clinic, user_id: user };
};

const H = (hhmm) => cov.hhmmToMin(hhmm);
const clinics = [{ key: '2', name: 'Альфа' }, { key: '6', name: 'Линия' }];
const allDay = () => [H('08:00'), H('20:00')];

test('отмена поверх смены снимает приём, а смена остаётся «запланированной»', () => {
  const cells = cov.groupPeriods([
    rec(1, 2, '2026-10-05', '09:00', '18:00'),
    rec(1, 2, '2026-10-05', '12:00', '13:00', 3),
  ]);
  const lane = cells.get('2|2026-10-05').get('1');
  assert.deepEqual(lane.work, [[H('09:00'), H('18:00')]]);
  assert.deepEqual(lane.effective, [[H('09:00'), H('12:00')], [H('13:00'), H('18:00')]]);
  assert.deepEqual(lane.cancelled, [[H('12:00'), H('13:00')]]);
});

test('конец «00:00» — это конец суток', () => {
  const cells = cov.groupPeriods([rec(1, 2, '2026-10-05', '16:00', '00:00')]);
  assert.deepEqual(cells.get('2|2026-10-05').get('1').work, [[H('16:00'), 24 * 60]]);
});

test('обед короче порога дырой не считается', () => {
  const lanes = cov.groupPeriods([
    rec(1, 2, '2026-10-05', '08:00', '20:00'),
    rec(1, 2, '2026-10-05', '12:00', '12:30', 3),
  ]).get('2|2026-10-05');
  const cell = cov.analyzeCell(lanes, allDay(), 60);
  assert.equal(cell.status, 'ok');
  assert.equal(cell.gaps.length, 0);
});

test('вечер без врача — частичная дыра «по графику»', () => {
  const lanes = cov.groupPeriods([rec(1, 2, '2026-10-05', '08:00', '15:00')]).get('2|2026-10-05');
  const cell = cov.analyzeCell(lanes, allDay(), 60);
  assert.equal(cell.status, 'gap');
  assert.deepEqual(cell.gaps.map(g => [g.from, g.to, g.cause]), [[H('15:00'), H('20:00'), 'plan']]);
});

test('отпуск единственного врача — день без приёма из-за отмены', () => {
  const lanes = cov.groupPeriods([
    rec(7, 2, '2026-10-05', '08:00', '20:00'),
    rec(7, 2, '2026-10-05', '08:00', '20:00', 3),
  ]).get('2|2026-10-05');
  const cell = cov.analyzeCell(lanes, allDay(), 60);
  assert.equal(cell.status, 'none');
  assert.equal(cell.gaps[0].cause, 'cancel');
  assert.deepEqual(cell.gaps[0].cancelledBy, ['7']);
  assert.equal(cell.cancelledDoctors, 1);
});

test('день держится на одном враче без перекрытий', () => {
  const lanes = cov.groupPeriods([
    rec(1, 2, '2026-10-05', '08:00', '14:00'),
    rec(2, 2, '2026-10-05', '14:00', '20:00'),
  ]).get('2|2026-10-05');
  const cell = cov.analyzeCell(lanes, allDay(), 60);
  assert.equal(cell.status, 'ok');
  assert.equal(cell.single, true);
  assert.equal(cell.doctors, 2);
});

const october = cov.daysBetween('2026-10-01', '2026-10-31');

// Будни: Альфа и Линия покрыты целиком. Воскресенья: Альфа пуста, Линия работает.
function network({ sundayLinia = true, extra = [] } = {}) {
  const records = [];
  for (const date of october) {
    const wd = cov.weekdayKey(date);
    if (wd !== 'sun') records.push(rec(1, 2, date, '08:00', '20:00'));
    if (wd !== 'sun' || sundayLinia) records.push(rec(2, 6, date, '08:00', '20:00'));
  }
  return [...records, ...extra];
}

test('пустые воскресенья сворачиваются в одну находку по дню недели', () => {
  const report = cov.buildReport({
    days: october, records: network(), clinics, clinicKeyOf: String, windowOf: allDay, minGap: 60,
  });
  const weekly = report.findings.filter(f => f.kind === 'weekday');
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].clinic, '2');
  assert.deepEqual(weekly[0].weekdays.map(w => w.weekday), ['sun']);
  assert.equal(weekly[0].dates.length, 4);
  // По отдельности воскресенья не повторяются
  assert.equal(report.findings.filter(f => f.kind === 'day').length, 0);
  // Сеть в воскресенье покрыта Линией
  assert.equal(report.network['2026-10-11'].status, 'ok');
  assert.equal(report.summary.noneDays, 4);
});

test('воскресенье без никого во всей сети — находка уровня сети', () => {
  const report = cov.buildReport({
    days: october, records: network({ sundayLinia: false }), clinics, clinicKeyOf: String, windowOf: allDay, minGap: 60,
  });
  const top = report.findings[0];
  assert.equal(top.clinic, 'all');
  assert.equal(top.kind, 'weekday');
  assert.equal(report.summary.networkNoneDays, 4);
});

test('исключённый «сотрудник» не закрывает дыру', () => {
  // Служебный пользователь «КТГ» стоит в графике Альфы по воскресеньям
  const ktg = october.filter(d => cov.weekdayKey(d) === 'sun').map(d => rec(99, 2, d, '08:00', '20:00'));
  const base = { days: october, records: network({ extra: ktg }), clinics, clinicKeyOf: String, windowOf: allDay, minGap: 60 };
  assert.equal(cov.buildReport(base).cells['2']['2026-10-11'].status, 'ok');
  assert.equal(cov.buildReport({ ...base, excluded: new Set(['99']) }).cells['2']['2026-10-11'].status, 'none');
});

test('после последней заведённой смены дни — «не заведено», а не дыра', () => {
  const records = network().filter(r => r.date.slice(0, 2) <= '20');
  const report = cov.buildReport({ days: october, records, clinics, clinicKeyOf: String, windowOf: allDay, minGap: 60 });
  assert.equal(report.horizon, '2026-10-20');
  assert.equal(report.cells['2']['2026-10-25'].status, 'unplanned');
  assert.equal(report.cells['2']['2026-10-18'].status, 'none');
});

test('выходной медцентра не считается дырой', () => {
  const windowOf = (key, date) => (cov.weekdayKey(date) === 'sun' && key === '2' ? null : allDay());
  const report = cov.buildReport({ days: october, records: network(), clinics, clinicKeyOf: String, windowOf, minGap: 60 });
  assert.equal(report.cells['2']['2026-10-11'].status, 'closed');
  assert.equal(report.findings.length, 0);
});

test('одно воскресенье с врачом не отменяет правила «по воскресеньям никого»', () => {
  const report = cov.buildReport({
    days: october, records: network({ extra: [rec(5, 2, '2026-10-04', '10:00', '14:00')] }),
    clinics, clinicKeyOf: String, windowOf: allDay, minGap: 60,
  });
  const weekly = report.findings.find(f => f.kind === 'weekday' && f.clinic === '2');
  assert.deepEqual(weekly.weekdays[0], { weekday: 'sun', dates: ['2026-10-11', '2026-10-18', '2026-10-25'], open: 4 });
});

test('одна и та же вечерняя дыра — одна находка, отпуск — отдельной строкой', () => {
  const records = [];
  for (const date of october) records.push(rec(1, 6, date, '08:00', '18:00'));
  records.push(rec(1, 6, '2026-10-14', '08:00', '18:00', 3));
  const report = cov.buildReport({
    days: october, records, clinics: [{ key: '6', name: 'Линия' }], clinicKeyOf: String, windowOf: allDay, minGap: 60,
  });
  const linia = report.findings.filter(f => f.clinic === '6');
  const evening = linia.find(f => f.kind === 'recurring');
  assert.equal(evening.from, H('18:00'));
  assert.equal(evening.dates.length, 30);
  const vacation = linia.find(f => f.kind === 'day');
  assert.equal(vacation.date, '2026-10-14');
  assert.equal(vacation.cause, 'cancel');
  assert.equal(linia.length, 2);
});

// ── Эталон и соседние медцентры (ver. 9.20) ─────────────────────────────────

test('эталон: окно — смены эталонного врача, покрывают только остальные', () => {
  // Флеболог (10) в Альфе 14–18, УЗИ (20) там же 08–16: без УЗИ остаются 16–18.
  // Часы, когда УЗИ есть, а флеболога нет, дырой не считаются вовсе.
  const day = '2026-10-05';
  const report = cov.buildReport({
    days: [day],
    records: [rec(10, 2, day, '14:00', '18:00'), rec(20, 2, day, '08:00', '16:00')],
    anchor: { lead: new Set(['10']), cover: new Set(['20']) },
    clinics: [clinics[0]], clinicKeyOf: String, windowOf: allDay, minGap: 60,
  });
  const cell = report.cells['2'][day];
  assert.equal(report.mode, 'anchor');
  assert.equal(cell.status, 'gap');
  assert.deepEqual(cell.gaps.map(g => [g.from, g.to]), [[H('16:00'), H('18:00')]]);
});

test('эталон не принимает — день не проверяется', () => {
  const day = '2026-10-05';
  const report = cov.buildReport({
    days: [day],
    records: [rec(10, 6, day, '09:00', '12:00'), rec(20, 2, day, '08:00', '20:00')],
    anchor: { lead: new Set(['10']), cover: new Set(['20']) },
    clinics, clinicKeyOf: String, windowOf: allDay, minGap: 60,
  });
  assert.equal(report.cells['2'][day].status, 'idle');
  // В Линии флеболог один, но УЗИ есть в Альфе — сеть покрыта
  assert.equal(report.cells['6'][day].status, 'none');
  assert.equal(report.network[day].status, 'ok');
});

test('дыра, закрытая соседним медцентром, помечена и мягче на ступень', () => {
  const day = '2026-10-05';
  const base = { days: [day], clinics, clinicKeyOf: String, windowOf: allDay, minGap: 60 };
  const alone = cov.buildReport({ ...base, records: [rec(1, 2, day, '08:00', '14:00')] });
  const helped = cov.buildReport({ ...base, records: [rec(1, 2, day, '08:00', '14:00'), rec(2, 6, day, '12:00', '20:00')] });
  const gap = helped.cells['2'][day].gaps[0];
  assert.deepEqual(gap.elsewhere, [{ clinic: '6', minutes: 6 * 60 }]);
  assert.equal(gap.elsewhereFull, true);
  const fAlone = alone.findings.find(f => f.clinic === '2');
  const fHelped = helped.findings.find(f => f.clinic === '2');
  assert.equal(fHelped.severity, Math.max(1, fAlone.severity - 1));
  assert.deepEqual(fHelped.elsewhere, ['6']);
});
