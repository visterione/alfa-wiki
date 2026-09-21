'use strict';

/**
 * Оценка визита кнопкой в боте (ver. 8.49).
 *
 * Просьба об отзыве с 7.86 уходила в один конец: текст «расскажите, всё ли
 * понравилось» и ничего, чем на него ответить, кроме обычного сообщения. Оно
 * попадало оператору в открытую линию, и оценки как числа у сети не оставалось —
 * ни средней по филиалу, ни по врачу, ни даже счёта ответивших.
 *
 * Здесь появляется второй, числовой ответ. Кнопки 1–5 те же на вид, что у
 * открытой линии при закрытии обращения, но считаются отдельно и в другой
 * таблице: там оценивают работу оператора, здесь — приём и врача. Сложить их в
 * одну среднюю значило бы ответить на вопрос, которого никто не задавал.
 *
 * ПОЧЕМУ НИЗКАЯ ОЦЕНКА ПРЕВРАЩАЕТСЯ В КАРТОЧКУ. Разбор негатива в сети уже
 * устроен — доска отзывов филиала со столбцами, ответственным, запросом
 * сведений и отчётом. Заводить рядом второй порядок работы с недовольным
 * пациентом только потому, что он пришёл из бота, а не из 2ГИС, незачем:
 * разбирают их одни и те же люди и одинаково.
 */

const { Op } = require('sequelize');
const {
  NotifOutbox, NotifAppointment, NotifVisitRating,
  Review, ReviewBoard, ReviewPlatform
} = require('../../models');
const branches = require('./branches');
const workflowEngine = require('../workflowEngine');
const notificationService = require('../notificationService');

// Оценка, ниже которой спрашиваем причину. Тройка included: «удовлетворительно»
// от человека, которого попросили оценить приём, — это вежливая двойка.
const LOW_SCORE = 3;

// Сколько ждём рассказ о причине. Два часа, а не сутки: следующее сообщение
// после этого срока — почти наверняка новый вопрос оператору, а не ответ на
// заданный утром вопрос. Ошибиться здесь в другую сторону дороже — вопрос
// пациента молча уехал бы в карточку отзыва вместо колл-центра.
const COMMENT_WAIT_HOURS = 2;

// Площадка для карточек из бота. Заводится миграцией 8.49; findOrCreate здесь
// на случай базы, куда её добавили руками или откатили.
const PLATFORM_NAME = 'Наш бот';

const PLATFORM_TITLES = { telegram: 'Telegram-бот', max: 'MAX-бот' };

/**
 * Ряд кнопок под просьбой об отзыве.
 *
 * В кнопке едет id строки очереди, а не визита. Просьба «раз в день» переезжает
 * с визита на визит (detector, moveIfExists), и apptId в уже отправленном
 * сообщении к моменту нажатия успел бы устареть — оценка легла бы на чужой
 * приём. Строка очереди же не переиспользуется никогда.
 */
function buttonRow(outboxId) {
  return [1, 2, 3, 4, 5].map(n => ({ text: String(n), data: `vrate:${outboxId}:${n}` }));
}

/** Оценка, по которой спрашиваем причину. */
function isLow(score) {
  return Number(score) <= LOW_SCORE;
}

/**
 * Записывает нажатие. Переписывать оценку разрешаем — по той же причине, по
 * которой это разрешено в открытой линии: промах по соседней цифре человек
 * никак не отзовёт, а кнопки под сообщением остаются на месте.
 *
 * @returns {Promise<{rating: Object, low: boolean}|null>} null — кнопка не от нас
 *   или устарела: строки очереди уже нет.
 */
async function record({ outboxId, score, subscriber, platform }) {
  const value = Number(score);
  if (!Number.isInteger(value) || value < 1 || value > 5) return null;

  const outbox = await NotifOutbox.findByPk(outboxId);
  if (!outbox) return null;

  const appt = outbox.apptId ? await NotifAppointment.findByPk(outbox.apptId) : null;

  // Филиал ищем общим для модуля сопоставлением: названия клиник в МИС и в
  // справочнике портала расходятся, и собственный запрос по имени промахнулся бы
  // молча — см. branches.js.
  const medCenterId = appt ? await branches.idFor(appt) : null;

  const existing = await NotifVisitRating.findOne({ where: { outboxId } });
  const patch = {
    score: value,
    ratedAt: new Date(),
    // Низкая оценка открывает окно ожидания причины, высокая — закрывает его:
    // человек мог сперва поставить двойку, а потом передумать и нажать пять,
    // и ждать после этого рассказа о плохом уже не от чего.
    commentWaitUntil: isLow(value)
      ? new Date(Date.now() + COMMENT_WAIT_HOURS * 3600 * 1000)
      : null
  };

  if (existing) {
    await existing.update(patch);
    return { rating: existing, low: isLow(value) };
  }

  const rating = await NotifVisitRating.create({
    ...patch,
    outboxId,
    apptId: outbox.apptId || null,
    patientId: outbox.patientId || null,
    medCenterId,
    doctorName: appt ? appt.doctorName : null,
    visitAt: appt ? (appt.dateCompleted || appt.timeStart) : null,
    platform: platform || (subscriber ? subscriber.platform : null),
    subscriberId: subscriber ? subscriber.id : null
  });

  return { rating, low: isLow(value) };
}

/**
 * Ждём ли от этого человека рассказ о причине низкой оценки.
 *
 * Спрашивается на каждое входящее сообщение бота, поэтому запрос должен быть
 * дешёвым: частичный индекс по (subscriber_id, comment_wait_until) покрывает
 * его целиком, а строк в таком состоянии единицы.
 */
async function awaitingComment(subscriberId) {
  if (!subscriberId) return null;
  return NotifVisitRating.findOne({
    where: {
      subscriberId,
      commentWaitUntil: { [Op.gt]: new Date() },
      commentedAt: null
    },
    order: [['ratedAt', 'DESC']]
  });
}

/**
 * Карточка на доске отзывов филиала.
 *
 * Доска ищется по филиалу, а не по названию: привязка medCenterId появилась на
 * доске ровно для таких запросов. Доски нет — карточки не будет, и это не
 * ошибка: у филиала может не быть доски вовсе. Сама оценка с причиной при этом
 * уже сохранена, то есть в статистике она есть и ничего не потеряно.
 */
async function createCard(rating, appt) {
  if (!rating.medCenterId) {
    console.warn(`[visit-ratings] оценка ${rating.id}: филиал не сопоставлен, карточка не заведена`);
    return null;
  }

  const board = await ReviewBoard.findOne({
    where: { medCenterId: rating.medCenterId, archived: false }
  });
  if (!board) {
    console.warn(`[visit-ratings] оценка ${rating.id}: у филиала нет доски отзывов, карточка не заведена`);
    return null;
  }

  const [platform] = await ReviewPlatform.findOrCreate({
    where: { name: PLATFORM_NAME },
    defaults: { name: PLATFORM_NAME, isActive: true, sortOrder: 5 }
  });

  const visitAt = rating.visitAt ? new Date(rating.visitAt) : null;
  const where = PLATFORM_TITLES[rating.platform] || 'бот';

  // Дата отзыва — день приёма, а не день нажатия кнопки. Просьба уходит через
  // заданный интервал после визита и может перевалить за полночь, а доска
  // отбирается по датам, и «отзыв о вчерашнем приёме» должен лежать под
  // вчерашним числом.
  const reviewDate = (visitAt || new Date()).toISOString().slice(0, 10);

  const review = await Review.create({
    boardId: board.id,
    platformId: platform.id,
    patientName: (appt && appt.patientName) || 'Пациент',
    reviewDate,
    rating: rating.score,
    reviewText: rating.comment,
    doctorName: rating.doctorName || null,
    status: 'new',
    // Внешний ключ ведёт на нашу же оценку. Нужен не для сверки с площадкой, а
    // чтобы повторный разбор не завёл вторую карточку по одному нажатию.
    externalId: `visit-rating:${rating.id}`,
    isAutoImported: true,
    importSource: 'bot',
    syncedAt: new Date(),
    additionalInfo: [
      `Оценка ${rating.score} из 5, поставлена в ${where}.`,
      visitAt ? `Приём: ${visitAt.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}.` : null,
      rating.patientId ? `Карта в МИС: ${rating.patientId}.` : null
    ].filter(Boolean).join(' ')
  });

  try {
    await workflowEngine.executeWorkflow(board, 'review_created', review, notificationService);
  } catch (err) {
    // Сценарии доски — надстройка над карточкой. Карточка уже заведена, и
    // ронять из-за них ответ пациенту нельзя.
    console.error('[visit-ratings] сценарии доски:', err.message);
  }

  return review;
}

/**
 * Принимает рассказ о причине и заводит по нему карточку.
 *
 * @returns {Promise<{review: Object|null}>}
 */
async function attachComment(rating, text) {
  const comment = String(text || '').trim();
  if (!comment) return { review: null };

  const appt = rating.apptId ? await NotifAppointment.findByPk(rating.apptId) : null;

  await rating.update({
    comment: comment.slice(0, 4000),
    commentedAt: new Date(),
    // Окно закрываем сразу: следующее сообщение — уже обычный вопрос оператору,
    // даже если пришло через минуту.
    commentWaitUntil: null
  });

  let review = null;
  try {
    review = await createCard(rating, appt);
    if (review) await rating.update({ reviewId: review.id });
  } catch (err) {
    // Причина уже сохранена, и потерять её из-за неудачи на доске нельзя:
    // карточку можно завести руками, а второй раз спросить человека — нет.
    console.error('[visit-ratings] карточка по оценке:', err.message);
  }

  return { review };
}

module.exports = {
  record, awaitingComment, attachComment, buttonRow, isLow,
  LOW_SCORE, COMMENT_WAIT_HOURS
};
