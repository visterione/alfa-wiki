/**
 * Регламентная рассылка складских отчётов (ver. 7.07).
 *
 * ── Кто получает письмо ──────────────────────────────────────────────────────
 *
 * Отдельного справочника подписчиков нет намеренно. Он повторил бы то, что уже
 * записано правами, и разошёлся бы с ними на второй неделе: человека переводят в
 * другой медцентр, права меняют, а в списке рассылки он остаётся. Получатель
 * выводится из трёх фактов, каждый из которых модуль уже знает:
 *
 *   1. ПРАВО НА ОТЧЁТ. Кандидаты — те, у кого право на этот отчёт не block
 *      (services/warehouse/permissions.js). Кто получает отчёт почтой — ровно
 *      тот, кто может открыть его в портале, и наоборот.
 *
 *   2. ЗОНА ВИДИМОСТИ. Отчёт строится от имени получателя тем же
 *      scopedRoomIds(), что и на экране: медцентры из прав плюс кабинеты, где
 *      человек записан МОЛ или заведующим. В письме — только его кабинеты.
 *
 *   3. ПУСТО — НЕ ОТПРАВЛЯТЬ. Если в его зоне за этот прогон нет ни одной
 *      значимой строки, письма нет. Это правило раздела 1.4 ТЗ («рассылается тем,
 *      у кого есть позиции в красной или оранжевой зоне»), поднятое до общего:
 *      рассылка, приходящая каждый день и чаще всего пустая, через месяц
 *      отправляется в папку «потом», и вместе с ней туда уходит красная зона.
 *
 * Поверх этого — личный отказ (warehouse_mail_optouts). Отписка не трогает доступ
 * к отчёту: человек по-прежнему открывает его в портале, просто не получает по
 * утрам. Отписаться можно от всего: письмо, которое нельзя выключить,
 * выключают правилом в почтовом клиенте, и тогда оно не доходит уже молча.
 *
 * ── Почему письмо и сокет — разные вещи ──────────────────────────────────────
 *
 * Почта несёт регламентный отчёт с вложением по расписанию из ТЗ. Сокет несёт
 * короткий сигнал «посмотри сейчас» и живёт в колокольчике. Дублировать одно
 * другим бессмысленно: у них разный срок годности.
 */

const { Op } = require('sequelize');
const { User, WhUserPermission, WhMailOptOut, WhMailLog } = require('../../models');
const perms = require('./permissions');
const access = require('./access');
const reportData = require('./reportData');
const exportsSvc = require('./exports');
const emailService = require('../emailService');

/**
 * Расписание из сводной матрицы ТЗ (ВИТ.md, раздел 1.12).
 *
 * `RPT-1C-RECON` из матрицы здесь нет: обмен с 1С выключен (oneCStatus всегда
 * 'disabled'), единственный источник — ОСВ в XLSX раз в месяц, и сверять
 * ежедневно нечего.
 *
 * Каждая рассылка описывается данными, а не кодом: чтобы добавить следующий
 * отчёт из матрицы, нужна ещё одна запись здесь и функция расчёта в reportData.
 */
const MAILINGS = {
  'RPT-EXPIRING': {
    label: 'Просроченные и истекающие позиции',
    schedule: 'ежедневно в 07:30',
    cron: '30 7 * * *',
    subject: 'Склад: сроки годности',
    // Значимо то, что требует действия. Жёлтая зона (31–90 дней) в письмо не
    // попадает: она есть на экране и не нуждается в ежедневном напоминании.
    build: buildExpiring,
  },
};

// ── Получатели ───────────────────────────────────────────────────────────────

/**
 * Кандидаты на рассылку отчёта: право есть, почта заполнена, отказа нет.
 *
 * Администраторы портала включаются наравне с остальными — права у них полные по
 * коду, строки в warehouse_user_permissions может не быть вовсе.
 */
async function recipientsFor(reportCode) {
  const [users, permissions, optOuts] = await Promise.all([
    User.findAll({
      where: { email: { [Op.ne]: null }, isActive: true },
      attributes: ['id', 'displayName', 'email', 'isAdmin', 'adminAccess'],
    }),
    WhUserPermission.findAll(),
    WhMailOptOut.findAll({ where: { reportCode } }),
  ]);

  const permByUser = new Map(permissions.map(p => [p.userId, p]));
  const refused = new Set(optOuts.map(o => o.userId));

  const out = [];
  for (const user of users) {
    if (refused.has(user.id)) continue;
    if (!String(user.email || '').includes('@')) continue;

    // Доступ к модулю целиком и право на конкретный отчёт — две разные проверки,
    // и обе уже реализованы. Повторять их логику здесь значит однажды разойтись
    // с экраном в том, кому что видно.
    const row = permByUser.get(user.id);
    const resolved = user.isAdmin
      ? { allowed: true, perms: perms.fullPerms(), medCenterIds: [] }
      : {
        allowed: Boolean(user.adminAccess?.warehouse),
        perms: perms.normalize(row?.perms),
        medCenterIds: Array.isArray(row?.medCenterIds) ? row.medCenterIds : [],
      };

    if (!resolved.allowed) continue;
    if (!perms.canReadReport(resolved.perms, reportCode)) continue;

    out.push({ user, resolved });
  }
  return out;
}

/**
 * Кабинеты получателя. Считается тем же кодом, что и для запроса с экрана, —
 * иначе письмо однажды покажет человеку то, чего он в портале не видит.
 */
async function scopeOf({ user, resolved }) {
  return access.visibleRoomIds(user, resolved);
}

// ── Сборка письма ────────────────────────────────────────────────────────────

const money = n => Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ruDate = iso => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—');

const EXPIRING_COLUMNS = [
  { key: 'zoneLabel', title: 'Зона', width: 12 },
  { key: 'nomenclatureName', title: 'Наименование', width: 42 },
  { key: 'code', title: 'Код', width: 14 },
  { key: 'batchNumber', title: 'Серия / партия', width: 18 },
  { key: 'expiryDate', title: 'Годен до', type: 'date', width: 12 },
  { key: 'daysLeft', title: 'Осталось дней', type: 'number', width: 14 },
  { key: 'quantity', title: 'Кол-во', type: 'qty', width: 10 },
  { key: 'unit', title: 'Ед.', width: 8 },
  { key: 'amount', title: 'Сумма, ₽', type: 'money', width: 14 },
  { key: 'location', title: 'Локация', width: 38 },
  { key: 'responsibleName', title: 'МОЛ', width: 22 },
  { key: 'avgMonthly', title: 'Средний расход/мес', type: 'qty', width: 18 },
  { key: 'recommendation', title: 'Рекомендация', width: 40 },
  { key: 'supplierName', title: 'Поставщик', width: 24 },
];

const ZONE_LABEL = { red: 'Просрочено / ≤7 дней', orange: '8–30 дней', yellow: '31–90 дней', green: '>90 дней' };

/**
 * Письмо по срокам годности. Возвращает null, если получателю писать не о чем.
 */
async function buildExpiring({ scopedRoomIds, displayName }) {
  const { items, summary } = await reportData.expiring({ scopedRoomIds, horizonDays: 90 });

  // В письмо идут только красная и оранжевая зоны — то, что требует действия на
  // этой неделе. Жёлтая остаётся на экране отчёта.
  const urgent = items.filter(i => i.zone === 'red' || i.zone === 'orange');
  if (!urgent.length) return null;

  const rows = urgent.map(i => ({
    ...i,
    zoneLabel: ZONE_LABEL[i.zone],
    location: [i.medCenterName, i.departmentName, i.roomNumber && `каб. ${i.roomNumber}`, i.storageName]
      .filter(Boolean).join(' / '),
  }));

  const expired = urgent.filter(i => i.daysLeft < 0);
  const week = urgent.filter(i => i.daysLeft >= 0 && i.daysLeft <= 7);
  const month = urgent.filter(i => i.daysLeft > 7);

  const line = (title, list) => (list.length
    ? `<li><b>${title}:</b> ${list.length} ${plural(list.length)} на ${money(list.reduce((s, i) => s + i.amount, 0))} ₽</li>`
    : '');


  const top = urgent.slice(0, 10).map(i => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;">${esc(i.nomenclatureName)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;">${esc(i.batchNumber || '—')}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;white-space:nowrap;">${ruDate(i.expiryDate)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${i.daysLeft < 0 ? `просрочено ${-i.daysLeft} дн.` : `${i.daysLeft} дн.`}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;">${esc(i.location)}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#111;">
      <p>${esc(displayName)}, доброе утро.</p>
      <p>В ваших кабинетах ${urgent.length === 1 ? 'требует' : 'требуют'} внимания
         <b>${urgent.length}</b> ${plural(urgent.length)}:</p>
      <ul style="margin:8px 0 16px;padding-left:20px;">
        ${line('Просрочено', expired)}
        ${line('Истекает в течение недели', week)}
        ${line('Истекает в течение месяца', month)}
      </ul>
      <table style="border-collapse:collapse;font-size:13px;">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Наименование</th>
          <th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Серия</th>
          <th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Годен до</th>
          <th style="text-align:right;padding:4px 8px;border-bottom:2px solid #333;">Осталось</th>
          <th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Локация</th>
        </tr></thead>
        <tbody>${top}</tbody>
      </table>
      ${urgent.length > 10 ? `<p style="color:#666;">…и ещё ${urgent.length - 10} — полный список во вложении.</p>` : ''}
      <p style="color:#666;font-size:12px;margin-top:20px;">
        Полный отчёт с прогнозом расхода — во вложении и в портале, раздел «Склад» → «Отчёты» →
        «Просроченные и истекающие позиции». Отписаться от этой рассылки можно там же,
        в настройках рассылок.
      </p>
    </div>`;

  // Строки сохраняют поле zone: по нему выгрузка подсвечивает красную зону тем
  // же условным форматированием, что и в отчёте с экрана.
  const xlsx = await exportsSvc.toXlsx({
    code: 'RPT-EXPIRING',
    header: await reportData.headerFor({
      code: 'RPT-EXPIRING',
      title: 'Просроченные и истекающие позиции',
      generatedBy: `${displayName} (регламентная рассылка)`,
      filterText: 'Горизонт = 90 дней; зоны = просрочено и до 30 дней',
    }),
    items: rows,
    totals: {
      expired: `${summary.expired.count} на ${money(summary.expired.amount)} ₽`,
      within30: `${summary.within30.count} на ${money(summary.within30.amount)} ₽`,
    },
    columns: EXPIRING_COLUMNS,
  });

  return {
    // Тема строится именительным падежом через тире: «истекает срок у 1 позиция»
    // было бы неверно, а падеж, зависящий от числа, — лишняя развилка ради темы
    // письма.
    subject: expired.length
      ? `Склад: просрочено — ${expired.length} ${plural(expired.length)}`
      : `Склад: истекает срок — ${urgent.length} ${plural(urgent.length)}`,
    html,
    itemCount: urgent.length,
    attachments: [{
      filename: `Сроки годности ${new Date().toISOString().slice(0, 10)}.xlsx`,
      content: xlsx,
    }],
    // Короткий текст для колокольчика в портале.
    alert: {
      level: expired.length ? 'critical' : 'warning',
      title: 'Сроки годности',
      text: expired.length
        ? `Просрочено ${expired.length} ${plural(expired.length)}, ещё ${week.length} истекает за неделю`
        : `${urgent.length} ${plural(urgent.length)} с истекающим сроком`,
      link: '/warehouse?tab=reports&report=expiring',
    },
  };
}

const plural = (n) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'позиция';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'позиции';
  return 'позиций';
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Прогон ───────────────────────────────────────────────────────────────────

/**
 * Отправляет один отчёт всем, кому он положен.
 *
 * @param {string} reportCode
 * @param {object} [options]
 * @param {string} [options.runKey]  ключ прогона; по умолчанию сегодняшняя дата
 * @param {boolean}[options.dryRun]  посчитать, но не отправлять и не писать в журнал
 * @param {function}[options.onAlert] вызывается на каждого получателя для сокета
 */
async function runMailing(reportCode, options = {}) {
  const config = MAILINGS[reportCode];
  if (!config) throw new Error(`Рассылка ${reportCode} не описана`);

  const runKey = options.runKey || `${new Date().toISOString().slice(0, 10)}`;
  const report = { reportCode, runKey, candidates: 0, sent: 0, skipped: 0, failed: 0, details: [] };

  const candidates = await recipientsFor(reportCode);
  report.candidates = candidates.length;

  for (const candidate of candidates) {
    const { user } = candidate;
    try {
      // Защита от повтора стоит ДО тяжёлой сборки отчёта: перезапуск воркера в
      // 07:31 не должен заново считать три тысячи строк на каждого.
      if (!options.dryRun) {
        const already = await WhMailLog.findOne({
          where: { reportCode, userId: user.id, runKey },
        });
        if (already) { report.skipped += 1; continue; }
      }

      const scopedRoomIds = await scopeOf(candidate);
      // Пустая зона — это не «вся сеть»: человеку с правом, но без единого
      // кабинета, писать нечего. visibleRoomIds отдаёт null только когда
      // ограничений нет вовсе.
      if (Array.isArray(scopedRoomIds) && !scopedRoomIds.length) {
        report.skipped += 1;
        continue;
      }

      const letter = await config.build({ scopedRoomIds, displayName: user.displayName || '' });
      if (!letter) {
        // Нечего сообщать — письма нет. Отметку в журнале всё равно ставим:
        // иначе повторный запуск пересчитает отчёт заново.
        if (!options.dryRun) {
          await WhMailLog.create({ reportCode, userId: user.id, runKey, status: 'skipped', itemCount: 0 });
        }
        report.skipped += 1;
        continue;
      }

      if (!options.dryRun) {
        await emailService.sendReportEmail({
          to: user.email,
          subject: letter.subject || config.subject,
          html: letter.html,
          attachments: letter.attachments || [],
        });
        await WhMailLog.create({
          reportCode, userId: user.id, runKey, status: 'sent', itemCount: letter.itemCount,
        });
      }

      if (letter.alert && options.onAlert) options.onAlert(user.id, letter.alert);

      report.sent += 1;
      report.details.push({ user: user.displayName, email: user.email, items: letter.itemCount });
    } catch (err) {
      report.failed += 1;
      report.details.push({ user: user.displayName, error: err.message });
      console.error(`Рассылка ${reportCode} → ${user.email}:`, err.message);
      if (!options.dryRun) {
        await WhMailLog.create({
          reportCode, userId: user.id, runKey, status: 'failed', error: err.message.slice(0, 500),
        }).catch(() => {});
      }
    }
  }

  return report;
}

module.exports = { MAILINGS, recipientsFor, runMailing };
