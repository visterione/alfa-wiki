import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AndroidStyle,
  EventType,
} from '@notifee/react-native';
import {Platform} from 'react-native';
import SocketService from './socket';
import {shouldNotify} from './activeChat';
import {readSettings, soundOption, SOUND_OPTIONS} from '../store/settingsStore';
import CONFIG from '../config';
import {stripFormatting} from '../utils/richText';

// Канал по умолчанию. Остальные заводятся под выбранный звук —
// см. SOUND_OPTIONS: у каждого свой channelId.
const CHANNEL_MESSAGES = 'messages';

// Куда перейти после тапа по уведомлению. Тап может случиться, когда навигатор
// ещё не смонтирован (приложение стартует из уведомления), поэтому цель
// складывается сюда, а App забирает её, когда будет готов.
let pendingChatId = null;

export function takePendingChat() {
  const id = pendingChatId;
  pendingChatId = null;
  return id;
}

// Тап по уведомлению задачи: открываем саму задачу, если её id известен, иначе
// раздел целиком. Как и с чатом, цель может появиться раньше навигатора.
let pendingTaskId = null;
let pendingTasks = false;

export function takePendingTask() {
  const id = pendingTaskId;
  const any = pendingTasks;
  pendingTaskId = null;
  pendingTasks = false;
  return any || id ? {taskId: id} : null;
}

// Отзыв: тап открывает конкретную карточку. Здесь, в отличие от отчётов,
// цель известна и одна — уведомление приходит про конкретный отзыв, и открывать
// вместо него список значило бы заставить искать его глазами.
let pendingReviewId = null;

export function takePendingReview() {
  const id = pendingReviewId;
  pendingReviewId = null;
  return id;
}

// Складской отчёт: тап открывает раздел отчётов целиком, а не конкретный
// отчёт. Их пока один, а когда станет больше, человек всё равно захочет
// увидеть рядом и остальные — он пришёл смотреть, что там за утро накопилось.
let pendingWarehouseReports = false;

export function takePendingWarehouseReports() {
  const flag = pendingWarehouseReports;
  pendingWarehouseReports = false;
  return flag;
}

// То же самое для напоминаний календаря: тап открывает вкладку календаря.
// Экран конкретного события не открываем — событие могли уже удалить или
// изменить, а календарь на нужную дату покажет актуальное положение дел.
let pendingCalendar = false;

export function takePendingCalendar() {
  const flag = pendingCalendar;
  pendingCalendar = false;
  return flag;
}

/**
 * Чаты, по которым уведомления заглушены.
 *
 * Нужно только iOS. На Android уведомление рождается из пуша, а пуши по
 * заглушённым чатам сервер просто не отправляет (pushService фильтрует
 * isNotificationMuted). На iOS пушей нет, уведомление рисуется из события
 * сокета — а сокет приходит всем участникам одинаково, без учёта того, кто
 * что заглушил. Поэтому фильтровать приходится на клиенте, и до сих пор этого
 * не делалось: заглушённые чаты на айфоне звенели наравне с остальными.
 */
let mutedChatIds = new Set();

export function setMutedChats(ids) {
  mutedChatIds = new Set((ids || []).map(String));
}

/**
 * Показать уведомление о новом сообщении.
 *
 * Данные приходят из data-payload FCM (все значения — строки) либо из события
 * сокета. Формат один и тот же, поэтому и путь отрисовки один.
 *
 * Оформление — стиль MESSAGING: Android рисует его как переписку, с круглой
 * аватаркой автора и именем отдельно от текста. Несколько сообщений из одного
 * чата система сама собирает в одно уведомление-диалог, как в мессенджерах.
 */
async function displayMessage({chatId, chatName, senderName, senderAvatar, body, chatType}) {
  const avatar = CONFIG.fileUrl(senderAvatar);
  // В шторке разметка не поддерживается: боты шлют *жирный* и [подпись](ссылка),
  // и без очистки в уведомлении торчали звёздочки и голые URL
  const text = stripFormatting(body);
  // Читаем настройку каждый раз: уведомление может рисоваться в фоне, когда
  // приложение выгружено и состояние в памяти отсутствует
  const {notificationSound} = await readSettings();
  const sound = soundOption(notificationSound);
  const channelId = sound.channelId;
  const isGroup = chatType === 'group';
  const author = senderName || 'Новое сообщение';

  try {
    await notifee.displayNotification({
      // title/body нужны и при MESSAGING: их показывают старые версии Android
      // и часть сторонних оболочек, которые этот стиль не поддерживают
      title: chatName || author,
      body: text,
      android: {
        channelId,
        style: {
          type: AndroidStyle.MESSAGING,
          // person — автор сообщения; icon принимает обычный https-URL
          person: {
            name: author,
            ...(avatar ? {icon: avatar} : {}),
          },
          // В группе показываем её название над перепиской
          ...(isGroup && chatName ? {title: chatName, group: true} : {}),
          messages: [{text, timestamp: Date.now()}],
        },
        // Крупная круглая иконка справа — та же аватарка
        ...(avatar ? {largeIcon: avatar, circularLargeIcon: true} : {}),
        // Сообщения одного чата складываются в стопку, а не засыпают шторку
        groupId: chatId ? String(chatId) : undefined,
        pressAction: {id: 'open_chat', launchActivity: 'default'},
        smallIcon: 'ic_notification',
        color: '#2563EB',
      },
      ios: {
        // Раньше здесь было жёстко 'default', и выбор звука в настройках на
        // iOS не значил ничего: приходил системный сигнал независимо от того,
        // что выбрал пользователь. Android слушался, потому что там звук живёт
        // в канале, а канал уже выбирался правильно.
        sound: sound.iosSound,
        threadId: chatId ? String(chatId) : undefined,
      },
      data: {chatId: chatId ? String(chatId) : ''},
    });
  } catch (e) {
    console.warn('[Notifications] displayMessage error:', e);
  }
}

/**
 * Показать уведомление модуля «Задачи».
 *
 * Стиль обычный, а не MESSAGING: это не переписка, автора-собеседника у события
 * нет, и собирать такие уведомления в диалог нечего. Канал и звук те же, что у
 * сообщений — заводить отдельный ради пары событий в день значит заставить
 * человека настраивать два списка вместо одного.
 */
async function displayTask({title, body, taskId, code}) {
  const {notificationSound} = await readSettings();
  const sound = soundOption(notificationSound);

  try {
    await notifee.displayNotification({
      title: title || 'Задачи',
      body: [code, stripFormatting(body || '')].filter(Boolean).join(' · '),
      android: {
        channelId: sound.channelId,
        groupId: 'tasks',
        pressAction: {id: 'open_task', launchActivity: 'default'},
        smallIcon: 'ic_notification',
        color: '#2563EB',
      },
      ios: {
        sound: sound.iosSound,
        threadId: 'tasks',
      },
      data: {taskId: taskId ? String(taskId) : '', kind: 'task'},
    });
  } catch (e) {
    console.warn('[Notifications] displayTask error:', e);
  }
}

const NotificationService = {
  /**
   * Создаёт канал под конкретный звук. Идемпотентно: повторный вызов с тем же
   * id ничего не меняет. Менять звук существующего канала Android не позволяет,
   * поэтому вариантов ровно столько, сколько заранее объявленных каналов.
   */
  async ensureChannel(soundKey) {
    if (Platform.OS !== 'android') return CHANNEL_MESSAGES;
    const option = soundOption(soundKey);
    try {
      await notifee.createChannel({
        id: option.channelId,
        name: option.key === 'default' ? 'Сообщения' : `Сообщения — ${option.label}`,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        vibration: true,
        sound: option.resource,
      });
    } catch (e) {
      console.warn('[Notifications] createChannel error:', e);
      return CHANNEL_MESSAGES;
    }
    return option.channelId;
  },

  /**
   * Удаляет каналы прошлых версий.
   *
   * Звук у созданного канала Android менять не даёт, поэтому при смене набора
   * мелодий заводятся каналы с новым суффиксом версии — а старые надо убрать,
   * иначе в системных настройках приложения копится мусор.
   */
  async cleanupOldChannels() {
    if (Platform.OS !== 'android') return;
    try {
      const current = new Set(SOUND_OPTIONS.map(o => o.channelId));
      const existing = await notifee.getChannels();
      for (const ch of existing) {
        const ours = ch.id === CHANNEL_MESSAGES || ch.id.startsWith('messages_');
        if (ours && !current.has(ch.id)) {
          await notifee.deleteChannel(ch.id);
        }
      }
    } catch (e) {
      console.warn('[Notifications] cleanupOldChannels error:', e);
    }
  },

  async setup() {
    try {
      if (Platform.OS === 'android') {
        // Заводим каналы сразу под все звуки: тогда в системных настройках
        // приложения пользователь видит их список и может донастроить вручную
        for (const option of SOUND_OPTIONS) {
          await this.ensureChannel(option.key);
        }
        await this.cleanupOldChannels();
      }

      // Разрешение на уведомления (iOS / Android 13+)
      await notifee.requestPermission();
    } catch (e) {
      console.warn('[Notifications] setup error:', e);
    }
  },

  displayMessage,
  displayTask,

  /**
   * Обработка входящего FCM-сообщения. Используется и в foreground, и в фоне.
   * Возвращает true, если уведомление показано.
   */
  async handleRemoteMessage(remoteMessage) {
    const data = remoteMessage?.data || {};

    if (data.kind === 'task') {
      await displayTask({
        title: data.title,
        body: data.body,
        taskId: data.taskId,
        code: data.code,
      });
      return true;
    }

    // Отзыв: назначили, сменили этап, прокомментировали. Тот же текст, что
    // уходит сообщением от бота «Работа с негативом», но по нажатию
    // открывается сама карточка, а не чат с ботом.
    if (data.kind === 'review') {
      await displayTask({
        title: data.title || 'Отзывы',
        body: data.body,
        taskId: null,
        code: data.reviewId,
      });
      return true;
    }

    // Складской отчёт: тот же текст, что уходит в колокольчик портала. Файл
    // сюда не кладётся — по нажатию открывается раздел отчётов, откуда его
    // можно скачать (см. MailingsScreen).
    if (data.kind === 'warehouse_report') {
      await displayTask({
        title: data.title || 'Склад',
        body: data.body,
        taskId: null,
        code: data.reportCode,
      });
      return true;
    }

    if (data.kind !== 'new_message') return false;

    // Открытый чат не дёргаем: сообщение уже видно в ленте
    if (!shouldNotify(data.chatId)) return false;

    await displayMessage({
      chatId: data.chatId,
      chatType: data.chatType,
      chatName: data.chatName || data.title,
      senderName: data.senderName,
      senderAvatar: data.senderAvatar,
      body: data.body,
    });
    return true;
  },

  /**
   * Тап по уведомлению, когда приложение живо (foreground/background).
   * Холодный старт из уведомления разбирается отдельно — getInitialNotification.
   */
  registerForegroundEvents() {
    return notifee.onForegroundEvent(({type, detail}) => {
      if (type === EventType.PRESS) {
        const data = detail.notification?.data || {};
        if (data.chatId) pendingChatId = String(data.chatId);
        if (data.calendarEventId) pendingCalendar = true;
        if (data.kind === 'warehouse_report') pendingWarehouseReports = true;
        if (data.kind === 'review' && data.reviewId) pendingReviewId = String(data.reviewId);
        if (data.kind === 'task') {
          pendingTasks = true;
          if (data.taskId) pendingTaskId = String(data.taskId);
        }
      }
    });
  },

  /**
   * Тап по уведомлению, когда JS-контекст поднят в фоне.
   * Регистрируется в index.js, вне дерева React.
   */
  registerBackgroundHandler() {
    notifee.onBackgroundEvent(async ({type, detail}) => {
      if (type === EventType.PRESS) {
        const data = detail.notification?.data || {};
        if (data.chatId) pendingChatId = String(data.chatId);
        if (data.calendarEventId) pendingCalendar = true;
        if (data.kind === 'warehouse_report') pendingWarehouseReports = true;
        if (data.kind === 'review' && data.reviewId) pendingReviewId = String(data.reviewId);
        if (data.kind === 'task') {
          pendingTasks = true;
          if (data.taskId) pendingTaskId = String(data.taskId);
        }
      }
    });
  },

  /**
   * Уведомления через сокет — запасной путь для iOS.
   *
   * На Android всё делает FCM: он доставляет сообщение и когда приложение
   * свёрнуто, и когда выгружено из памяти. На iOS push-канала пока нет (нет
   * платной подписки Apple → нет APNs-ключа), поэтому единственный источник —
   * живой сокет, а он живёт только пока приложение открыто. Это осознанное
   * временное ограничение, а не недоделка: свёрнутый iOS уведомлений не получит.
   */
  attachSocketListeners(currentUserId) {
    if (Platform.OS !== 'ios') return;

    SocketService.on('notify:new_message', 'new_message', async data => {
      if (String(data.message?.senderId) === String(currentUserId)) return;

      const chatId = data.chat?.id;
      if (!shouldNotify(chatId)) return;
      if (mutedChatIds.has(String(chatId))) return;

      const sender = data.message?.sender;
      const senderName = sender?.displayName || sender?.username || '';
      const isGroup = data.chat?.type === 'group';
      const text = data.message?.content
        || (data.message?.attachments?.length ? '📎 Вложение' : 'Новое сообщение');

      // Поля те же, что в data-payload FCM, — оформление уведомления
      // на обеих платформах собирается одним и тем же кодом
      await displayMessage({
        chatId,
        chatType: data.chat?.type,
        chatName: isGroup ? data.chat?.displayName || 'Группа' : senderName,
        senderName,
        senderAvatar: sender?.avatar,
        body: text,
      });
    });

    // События модуля «Задачи» приходят тем же путём: на iOS сокет — вообще
    // единственный источник уведомлений, а на Android этот слушатель не нужен,
    // там задачу доставит FCM (и доставит даже выгруженному приложению).
    SocketService.on('notify:task', 'task:notify', async data => {
      await displayTask({
        title: data?.title,
        body: data?.body,
        taskId: data?.taskId,
        code: data?.code,
      });
    });
  },

  detachSocketListeners() {
    SocketService.off('notify:new_message');
    SocketService.off('notify:task');
  },
};

export default NotificationService;
