'use strict';

/**
 * Отчёт провайдера о доставке: путь по каскаду и статус строки.
 *
 * Жил в routes/notifications.js рядом с приёмником отчётов; вынесен в 9.34,
 * когда от него стало зависеть, что журнал и сводка считают доставленным, —
 * такое должно быть покрыто тестами (tests/deliveryReport.test.js).
 */

// Соответствие статусов провайдера нашим. «sent» у них означает «передано
// оператору, окончательный статус не получен» — это ещё не доставка.
const DELIVERED = ['delivered', 'read'];
const FAILED = ['rejected', 'undelivered', 'expired', 'deleted', 'error'];

/**
 * Отчёт провайдера — в путь по каскаду (ver. 9.23).
 *
 * Каскад Имобиса (ВКонтакте → SMS) прогоняет сам Имобис, и у нас его ступени
 * отмечены «передано» (handed). Если отчёт называет канал, которым дошло или не дошло,
 * отмечаем ровно его, а ступени до него — непрошедшими: каскад идёт дальше,
 * только когда предыдущая не доставила. Без канала в отчёте и при маршруте из
 * одной ступени исход относится к ней; иначе какой канал сработал — неизвестно,
 * и выдумывать это нельзя: ступени остаются «передано», а итог виден значком
 * доставки.
 */
function withReport(attempts, report, status) {
  const list = Array.isArray(attempts) ? attempts.map(a => ({ ...a })) : [];
  const handed = list.filter(a => a.result === 'handed' || a.result === 'delivered' || a.result === 'undelivered');
  if (!handed.length) return list;

  const outcome = DELIVERED.includes(status) ? 'delivered' : (FAILED.includes(status) ? 'undelivered' : null);
  if (!outcome) return list;

  const channel = String(report.channel || report.channel_type || report.type || '').toLowerCase();
  let target = channel ? handed.find(a => a.step === `imobis:${channel}`) : null;
  if (!target && handed.length === 1) target = handed[0];

  // Отказ без канала при каскаде из нескольких ступеней (ver. 9.34). Имобис
  // шлёт такой отчёт про сообщение целиком, когда его каскад кончился ничем
  // («Delivery failure (routing is not configured)»), — значит, не прошла ни
  // одна из переданных ступеней. Раньше они оставались «передано», и строка
  // висела жёлтой без конца.
  if (!target && outcome === 'undelivered') {
    for (const a of handed) {
      if (a.result !== 'handed') continue;
      a.result = 'undelivered';
      a.at = new Date().toISOString();
      a.error = report.error || report.error_code || `провайдер: ${status}`;
    }
    return list;
  }
  if (!target) return list;

  target.result = outcome;
  target.at = new Date().toISOString();
  if (outcome === 'undelivered') target.error = report.error || report.error_code || `провайдер: ${status}`;
  // Ступени до сработавшей — не доставили, иначе каскад до неё не дошёл бы. А
  // после неё — не понадобились: журнал рисует их серыми, как каналы, до
  // которых каскад не дошёл.
  if (outcome === 'delivered') {
    let after = false;
    for (const a of handed) {
      if (a === target) { after = true; continue; }
      if (a.result !== 'handed') continue;
      if (after) a.result = 'unused';
      else { a.result = 'undelivered'; a.error = a.error || 'каскад перешёл к следующему каналу'; }
    }
  }
  return list;
}

/**
 * Статус строки после отчёта (ver. 9.34).
 *
 * До 9.34 отчёт статус не трогал: status отвечал на «отправили ли», отчёт — на
 * «дошло ли», и это казалось честным разделением. На деле журнал и сводка за
 * сутки считают «Доставлено» по status, и сообщение, которое провайдер отверг
 * на всех ступенях, стояло там с зелёной галочкой. Картина рассылки выходила
 * лучше настоящей ровно на те сообщения, что до людей не дошли.
 *
 * Теперь окончательный отказ переводит строку в failed, но только когда живых
 * ступеней не осталось: отказ одной ступени каскада, за которой ещё ждёт
 * следующая, — это ход каскада, а не его итог. Доставка возвращает строку в
 * sent, если её успели счесть неудачной по промежуточному отчёту. Повторной
 * отправки failed не вызывает: отправщик берёт только pending.
 */
function statusAfterReport(current, attempts, status) {
  if (current !== 'sent' && current !== 'failed') return current;
  if (DELIVERED.includes(status)) return 'sent';
  if (!FAILED.includes(status)) return current;
  const alive = (attempts || []).some(a => ['sent', 'handed', 'delivered'].includes(a.result));
  return alive ? current : 'failed';
}

module.exports = { DELIVERED, FAILED, withReport, statusAfterReport };
