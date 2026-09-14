import { format, isToday, isYesterday } from 'date-fns';
import { ru } from 'date-fns/locale';

// Кто и во сколько увидел сообщение (ver. 8.26).
//
// Сервер отдаёт журнал прочтений чата один раз на открытие
// (GET /chat/:chatId/read-marks): по участнику — список отметок, каждая из
// которых значит «в этот момент человек открыл чат и увидел всё, что было до
// него». Время просмотра конкретного сообщения отсюда выводится, а не хранится:
// это первая отметка участника, которая не раньше отправки сообщения.
//
// Считается на клиенте, потому что запрос на сообщение означал бы полсотни
// запросов на экран. Те же правила в мобилке — mobile/src/utils/readReceipts.js;
// расхождение между ними сразу видно людям: один чат, два разных ответа на
// вопрос «прочитал ли он».

/**
 * Отметки участника отсортированы по возрастанию, поэтому первая подходящая —
 * и есть самая ранняя. Возвращает ISO-строку или null, если не прочитано.
 */
export function readTimeFor(marks, createdAt) {
  if (!marks || !marks.length || !createdAt) return null;
  const sentAt = new Date(createdAt).getTime();
  for (const mark of marks) {
    if (new Date(mark).getTime() >= sentAt) return mark;
  }
  return null;
}

/**
 * Список прочитавших сообщение — с временем просмотра у каждого.
 * members — то, что вернул /read-marks: участники чата кроме себя.
 */
export function readersOf(members, message) {
  if (!members || !message) return [];
  return members
    .map(member => {
      const at = readTimeFor(member.marks, message.createdAt);
      return at ? { ...member, at } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

/**
 * Дописывает отметку в журнал по событию messages_read: собеседник открыл чат
 * прямо сейчас. Участника может не оказаться в списке — он мог войти в группу
 * после того, как журнал загрузили.
 */
export function appendMark(members, reader, readAt) {
  if (!reader?.id || !readAt) return members;
  const id = String(reader.id);
  const known = (members || []).some(m => String(m.userId) === id);
  const withMark = (members || []).map(m => String(m.userId) === id
    ? { ...m, marks: [...(m.marks || []), readAt] }
    : m);
  if (known) return withMark;
  return [...withMark, {
    userId: reader.id,
    displayName: reader.displayName || '',
    avatar: reader.avatar || null,
    marks: [readAt]
  }];
}

/**
 * Время просмотра человеческими словами. Без года и без секунд: точность до
 * минуты — всё, что здесь можно обещать, отметка ставится в момент открытия
 * чата, а не на каждое сообщение.
 */
export function formatSeenAt(iso) {
  const d = new Date(iso);
  if (isToday(d)) return `сегодня в ${format(d, 'HH:mm')}`;
  if (isYesterday(d)) return `вчера в ${format(d, 'HH:mm')}`;
  return format(d, 'd MMMM в HH:mm', { locale: ru });
}
