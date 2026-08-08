import notifee, {
  AndroidImportance,
  AndroidVisibility,
  TriggerType,
  AlarmType,
} from '@notifee/react-native';
import {Platform} from 'react-native';
import {calendar as calendarApi} from './api';
import {readSettings, soundOption} from '../store/settingsStore';
import {formatTime, reminderLabel} from '../screens/Calendar/eventMeta';

/**
 * Локальные напоминания о событиях календаря.
 *
 * Почему локальные, а не серверные: cron на сервере уже шлёт напоминание
 * сообщением от Ассистента (backend/cron/calendarRemindersCron.js), но оно
 * зависит от сети и приходит как чат. Здесь же уведомление планируется прямо
 * на устройстве, поэтому срабатывает и в самолётном режиме, и когда приложение
 * выгружено.
 *
 * Оформление намеренно то же, что у сообщений: тот же звук из настроек, тот же
 * значок и цвет. Для человека это уведомление приложения, и различаться они
 * должны текстом, а не подачей.
 */

// Префикс в id запланированных уведомлений: по нему находим свои, чтобы при
// пересинхронизации снять устаревшие и не трогать чужие
const PREFIX = 'cal_';

// На сколько вперёд планируем. Дальше нет смысла: приложение открывают чаще,
// а список всё равно пересобирается при каждом запуске и правке события.
const HORIZON_DAYS = 30;

function notificationId(eventId, minutesBefore) {
  return `${PREFIX}${eventId}_${minutesBefore}`;
}

/** Снять все ранее запланированные напоминания календаря. */
async function cancelAll() {
  try {
    const ids = await notifee.getTriggerNotificationIds();
    const ours = ids.filter(id => id.startsWith(PREFIX));
    if (ours.length) await notifee.cancelTriggerNotifications(ours);
  } catch (e) {
    console.warn('[CalendarReminders] cancelAll error:', e);
  }
}

/**
 * Запланировать одно уведомление.
 * @returns {Promise<boolean>} удалось ли поставить
 */
async function schedule({id, timestamp, title, body, eventId, channelId, iosSound}) {
  try {
    await notifee.createTriggerNotification(
      {
        id,
        title,
        body,
        android: {
          channelId,
          smallIcon: 'ic_notification',
          color: '#2563EB',
          pressAction: {id: 'open_calendar', launchActivity: 'default'},
        },
        ios: {sound: iosSound},
        data: {calendarEventId: String(eventId)},
      },
      {
        type: TriggerType.TIMESTAMP,
        timestamp,
        // Точные будильники (SET_EXACT*) на Android 12+ требуют отдельного
        // разрешения, которое система выдаёт неохотно. SET_AND_ALLOW_WHILE_IDLE
        // разрешения не просит и пробивает режим сна — ценой возможного
        // сдвига на несколько минут, что для напоминания «за 15 минут»
        // приемлемо. Точность добирается серверным напоминанием в чат.
        alarmManager: {type: AlarmType.SET_AND_ALLOW_WHILE_IDLE},
      },
    );
    return true;
  } catch (e) {
    console.warn('[CalendarReminders] schedule error:', e);
    return false;
  }
}

/**
 * Пересобрать расписание уведомлений по ближайшим событиям.
 *
 * Полная пересборка, а не точечные правки: событие могли перенести, отменить
 * или удалить с другого устройства, и надёжнее снять всё и разложить заново,
 * чем угадывать, что именно изменилось.
 *
 * @returns {Promise<number>} сколько уведомлений запланировано
 */
export async function syncCalendarReminders() {
  try {
    const {data} = await calendarApi.getUpcoming(HORIZON_DAYS);
    const events = Array.isArray(data) ? data : [];

    await cancelAll();

    const {notificationSound} = await readSettings();
    const sound = soundOption(notificationSound);
    // На iOS каналов нет — там звук задаётся у самого уведомления
    const channelId = Platform.OS === 'android' ? sound.channelId : undefined;

    const now = Date.now();
    let planned = 0;

    for (const event of events) {
      const reminders = Array.isArray(event.reminders) ? event.reminders : [];
      const startAt = new Date(event.startTime).getTime();

      for (const reminder of reminders) {
        // Напоминания по email рассылает сервер, устройству здесь делать нечего
        if (reminder.type && reminder.type !== 'notification') continue;

        const minutesBefore = reminder.minutesBefore || 15;
        const fireAt = startAt - minutesBefore * 60 * 1000;
        // Прошедшее время система не примет, а «прямо сейчас» бесполезно
        if (fireAt <= now + 1000) continue;

        const when = formatTime(event.startTime);
        const ok = await schedule({
          id: notificationId(event.id, minutesBefore),
          timestamp: fireAt,
          title: `📅 ${event.title}`,
          body: event.allDay
            ? `Сегодня · ${reminderLabel(minutesBefore)}`
            : `В ${when} · ${reminderLabel(minutesBefore)}`,
          eventId: event.id,
          channelId,
          iosSound: sound.iosSound,
        });
        if (ok) planned++;
      }
    }

    return planned;
  } catch (e) {
    // Нет сети или сервер недоступен — уже разложенные уведомления остаются
    // в силе, пересоберём при следующем запуске
    console.warn('[CalendarReminders] sync error:', e);
    return 0;
  }
}

/**
 * Канал уведомлений тот же, что у сообщений, — заводить отдельный не нужно.
 * Функция оставлена точкой входа на случай, если каналы разъедутся.
 */
export async function ensureCalendarChannel() {
  if (Platform.OS !== 'android') return;
  try {
    const {notificationSound} = await readSettings();
    const sound = soundOption(notificationSound);
    await notifee.createChannel({
      id: sound.channelId,
      name: sound.key === 'default' ? 'Сообщения' : `Сообщения — ${sound.label}`,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      vibration: true,
      sound: sound.resource,
    });
  } catch (e) {
    console.warn('[CalendarReminders] ensureChannel error:', e);
  }
}

export default {syncCalendarReminders, ensureCalendarChannel};
