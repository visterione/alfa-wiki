import axios from 'axios';
import * as Keychain from 'react-native-keychain';
import CONFIG from '../config';
import deviceInfo from './deviceInfoLite';

const KEYCHAIN_OPTIONS = {service: 'alfa-wiki'};

// In-memory token cache — avoids Keychain read on every request.
// Android Keystore can take 100-500ms per read; caching reduces startup
// from 4+ sequential Keystore hits to a single one.
let _token = null;

export function setCachedToken(token) {
  _token = token;
}

export function clearCachedToken() {
  _token = null;
}

/**
 * Заголовок авторизации для запросов, которые уходят мимо axios.
 *
 * Такой запрос ровно один — картинка в <Image>: её грузит нативный загрузчик
 * платформы, а не JS, и токен ему надо передать руками. Гонять картинку через
 * axios нельзя: в JS она приезжает массивом байтов, а Image принимает только
 * строку, и перекладывание через Buffer на устройстве ломается (см. LabelPreview).
 */
export async function authHeader() {
  if (!_token) {
    const credentials = await Keychain.getGenericPassword(KEYCHAIN_OPTIONS);
    _token = credentials?.password ?? null;
  }
  return _token ? {Authorization: `Bearer ${_token}`} : {};
}

const api = axios.create({
  baseURL: CONFIG.API_URL,
  timeout: 30000,
});

// Attach JWT token on every request — use in-memory cache, read Keychain only once
api.interceptors.request.use(async config => {
  if (!_token) {
    const credentials = await Keychain.getGenericPassword(KEYCHAIN_OPTIONS);
    _token = credentials?.password ?? null;
  }
  if (_token) {
    config.headers.Authorization = `Bearer ${_token}`;
  }
  config.headers['X-Client-Type'] = 'mobile';
  // Сервер пишет это имя в реестр сессий, чтобы в «моих устройствах» было
  // «Samsung SM-G991B», а не безликое «Мобильное приложение»
  config.headers['X-Device-Name'] = deviceInfo.deviceName;
  return config;
});

// Handle 401 — clear token cache so next request re-reads from Keychain
api.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401) {
      clearCachedToken();
      await Keychain.resetGenericPassword(KEYCHAIN_OPTIONS);
    }
    return Promise.reject(error);
  },
);

// ── Auth ────────────────────────────────────────────────────────────────────
export const auth = {
  login: (username, password) =>
    api.post('/auth/login', {username, password}),
  me: () => api.get('/auth/me'),
  // Выход снимает сессию на сервере. Раньше он был чисто клиентским — токен
  // просто стирали из Keychain, а сам он оставался валидным ещё год.
  logout: () => api.post('/auth/logout'),
  sessions: () => api.get('/auth/sessions'),
  revokeSession: id => api.delete(`/auth/sessions/${id}`),
  revokeAllSessions: () => api.post('/auth/sessions/revoke-all'),
  verify2FA: (userId, code) =>
    api.post('/auth/verify-2fa', {userId, code}),
  resend2FA: userId =>
    api.post('/auth/resend-2fa', {userId}),
  updateProfile: data => api.put('/auth/profile', data),
  updateMobileSettings: data => api.patch('/auth/mobile-settings', data),
  changePassword: (currentPassword, newPassword) =>
    api.post('/auth/change-password', {currentPassword, newPassword}),
};

// ── Media ────────────────────────────────────────────────────────────────────
export const media = {
  upload: async file => {
    const formData = new FormData();
    formData.append('file', {
      uri: file.uri,
      type: file.type || 'application/octet-stream',
      name: file.name || 'file',
    });
    return api.post('/media/upload', formData, {
      headers: {'Content-Type': 'multipart/form-data'},
    });
  },
};

// ── Сотрудники ──────────────────────────────────────────────────────────────
// Лёгкий список для полей «кто»: председатель комиссии, МОЛ. Именно /users/list,
// а не /chat/users: тот исключает самого себя (в переписке с собой смысла нет),
// а МОЛ человек назначает и себя тоже.
export const users = {
  listBasic: () => api.get('/users/list'),
};

// ── Chat ────────────────────────────────────────────────────────────────────
export const chat = {
  list: () => api.get('/chat'),
  search: query => api.get('/chat/search', {params: {q: query}}),
  getUnreadCount: () => api.get('/chat/unread/count'),
  getMessages: (chatId, params) =>
    api.get(`/chat/${chatId}/messages`, {params}),
  // Токен доступа к вложениям: подставляется в ?t= к ссылкам на файлы,
  // заголовок Authorization в <Image> и в загрузчике Android не выставить
  getFileToken: () => api.get('/chat/file-token'),
  getMentionTargets: chatId => api.get(`/chat/${chatId}/mention-targets`),
  createPoll: (chatId, data) => api.post(`/chat/${chatId}/polls`, data),
  votePoll: (chatId, messageId, optionIds) =>
    api.post(`/chat/${chatId}/messages/${messageId}/poll-vote`, {optionIds}),
  getUsers: () => api.get('/chat/users'),
  sendMessage: (chatId, content, attachments = [], replyToId = null, mentions = []) =>
    api.post(`/chat/${chatId}/messages`, {content, attachments, replyToId, mentions}),
  markAsRead: chatId => api.post(`/chat/${chatId}/read`),
  startPrivate: userId => api.post('/chat/private', {userId}),
  createGroup: (name, memberIds) =>
    api.post('/chat/group', {name, memberIds}),
  editMessage: (chatId, messageId, content) =>
    api.put(`/chat/${chatId}/messages/${messageId}`, {content}),
  deleteMessage: (chatId, messageId) =>
    api.delete(`/chat/${chatId}/messages/${messageId}`),
  getPinned: chatId => api.get(`/chat/${chatId}/pinned`),
  // Галерея чата: kind = media | files | voice | links
  getChatMedia: (chatId, kind, params) =>
    api.get(`/chat/${chatId}/media`, {params: {kind, ...params}}),
  pinMessage: (chatId, messageId, pin) =>
    api.post(`/chat/${chatId}/messages/${messageId}/pin`, {pin}),
  // Групповое удаление. scope: 'me' — спрятать у себя, 'all' — стереть у всех
  deleteMessages: (chatId, messageIds, scope) =>
    api.post(`/chat/${chatId}/messages/delete`, {messageIds, scope}),
  hideChat: (chatId, hidden) => api.patch(`/chat/${chatId}/hide`, {hidden}),
  muteChat: (chatId, muted) => api.patch(`/chat/${chatId}/mute`, {muted}),
  pinChat: (chatId, pinned) => api.patch(`/chat/${chatId}/pin`, {pinned}),
  // Управление группой
  renameGroup: (chatId, name) => api.patch(`/chat/${chatId}/rename`, {name}),
  setMemberRole: (chatId, userId, role) =>
    api.patch(`/chat/${chatId}/members/${userId}/role`, {role}),
  setMemberReadOnly: (chatId, userId, isReadOnly) =>
    api.patch(`/chat/${chatId}/members/${userId}/readonly`, {isReadOnly}),
  bulkAddMembers: (chatId, userIds) => api.post(`/chat/${chatId}/members/bulk`, {userIds}),
  deleteGroup: chatId => api.delete(`/chat/${chatId}`),
  addReaction: (chatId, messageId, emoji) =>
    api.post(`/chat/${chatId}/messages/${messageId}/reactions`, {emoji}),
  removeReaction: (chatId, messageId) =>
    api.delete(`/chat/${chatId}/messages/${messageId}/reactions`),
  getReactionDetails: (chatId, messageId) =>
    api.get(`/chat/${chatId}/messages/${messageId}/reactions`),
  // Кнопка под сообщением бота: создать пациента в МИС, открыть реестр справок
  runMessageAction: (chatId, messageId, actionId) =>
    api.post(`/chat/${chatId}/messages/${messageId}/actions/${actionId}`),
  addMember: (chatId, userId) =>
    api.post(`/chat/${chatId}/members`, {userId}),
  removeMember: (chatId, userId) =>
    api.delete(`/chat/${chatId}/members/${userId}`),
  leave: chatId => api.delete(`/chat/${chatId}/leave`),
  forwardMessages: (targetChatId, messageIds) =>
    api.post('/chat/forward', {targetChatId, messageIds}),
  searchMessages: (chatId, q) =>
    api.get(`/chat/${chatId}/messages/search`, {params: {q}}),
  // Голосовое сообщение. Сервер приводит запись к общему для всех платформ
  // формату и определяет длительность.
  uploadVoice: (uri, duration) => {
    const formData = new FormData();
    formData.append('file', {
      uri,
      type: 'audio/mp4',
      name: 'voice.m4a',
    });
    // Запасной источник длительности, если ffprobe на сервере промолчит
    if (duration) formData.append('duration', String(duration));
    return api.post('/chat/voice', formData, {
      headers: {'Content-Type': 'multipart/form-data'},
    });
  },

  // Push-устройства
  registerDevice: payload => api.post('/chat/devices', payload),
  // DELETE с телом — axios требует передавать его через config.data
  unregisterDevice: token => api.delete('/chat/devices', {data: {token}}),

  uploadFiles: async (_chatId, files) => {
    const results = await Promise.all(
      files.map(file => {
        const formData = new FormData();
        formData.append('file', {
          uri: file.uri,
          type: file.type || 'application/octet-stream',
          name: file.name || 'file',
        });
        return api.post('/chat/upload', formData, {
          headers: {'Content-Type': 'multipart/form-data'},
        });
      }),
    );
    return {data: results.map(r => r.data)};
  },
};

// ── Calendar ─────────────────────────────────────────────────────────────────
// Тот же набор ручек, что использует веб (frontend/src/services/api.js):
// приложение работает с общими событиями, а не со своей копией календаря.
export const calendar = {
  // params: {start, end, types, statuses, priorities} — ISO-даты периода.
  // Экземпляры повторяющихся событий сервер разворачивает сам.
  getEvents: params => api.get('/calendar/events', {params}),
  getEvent: id => api.get(`/calendar/events/${id}`),
  createEvent: data => api.post('/calendar/events', data),
  updateEvent: (id, data) => api.put(`/calendar/events/${id}`, data),
  deleteEvent: id => api.delete(`/calendar/events/${id}`),
  // Удаление одного повтора: сервер вносит дату в исключения серии
  deleteEventInstance: (id, instanceDate) =>
    api.delete(`/calendar/events/${id}/instance`, {data: {instanceDate}}),
  // Аккредитации и ТО транспорта — только на просмотр, редактируются в вебе
  getIntegratedEvents: (start, end, types = 'accreditation,vehicle') =>
    api.get('/calendar/integrated-events', {params: {start, end, types}}),
  getUpcoming: (days = 7) => api.get('/calendar/upcoming', {params: {days}}),
};

// ── Задачи (ver. 6.75) ───────────────────────────────────────────────────────
// Модуль пришёл на смену канбану и занял в мобилке место вкладки «Календарь»:
// его главный экран и есть календарь, только с загрузкой в часах.
//
// Набор ручек урезан относительно веба сознательно. Настройка команд, правка
// чужих норм и отчёты остались в вебе — это работа за столом, а не с телефона.
// Здесь только то, что делают на ходу: разобрать входящие, посмотреть свой
// день и отметить сделанное.
export const tasks = {
  getAccess: () => api.get('/tasks/access'),

  // Мне на решение и те, кого жду я
  getInbox: () => api.get('/tasks/inbox'),

  getTasks: params => api.get('/tasks', {params}),
  getTask: id => api.get(`/tasks/${id}`),
  getPartTask: id => api.get(`/tasks/parts/${id}/task`),
  getTeams: () => api.get('/tasks/teams'),
  getTeamLoad: (id, start, end) => api.get(`/tasks/teams/${id}/load`, {params: {start, end}}),
  createTask: data => api.post('/tasks', data),

  // Загрузка человека за период: часы и цвет, без содержания дел
  getPersonLoad: (id, start, end) =>
    api.get(`/tasks/people/${id}/load`, {params: {start, end}}),
  setSchedule: (id, workSchedule) =>
    api.put(`/tasks/people/${id}/schedule`, {workSchedule}),

  // Действия над своей частью. Здесь и только здесь часть превращается в блок
  // времени и начинает занимать часы.
  planPart: (id, date, force) => api.post(`/tasks/parts/${id}/plan`, {date, force}),
  proposeDate: (id, date) => api.post(`/tasks/parts/${id}/propose`, {date}),
  acceptDate: id => api.post(`/tasks/parts/${id}/accept`),
  declinePart: (id, reason) => api.post(`/tasks/parts/${id}/decline`, {reason}),
  movePart: (id, date) => api.post(`/tasks/parts/${id}/move`, {date}),
  extendPart: (id, hours = 0.5) => api.post(`/tasks/parts/${id}/extend`, {hours}),
  splitPart: (id, data) => api.post(`/tasks/parts/${id}/split`, data),
  setPartStatus: (id, status) => api.put(`/tasks/parts/${id}/status`, {status}),
  getNextFit: (id, params) => api.get(`/tasks/parts/${id}/next-fit`, {params}),
  cancelTask: id => api.delete(`/tasks/${id}`),
};

// ── Курсы ────────────────────────────────────────────────────────────────────
// Только пользовательские ручки: создание и правка курсов остаются в вебе.
// Набор совпадает с frontend/src/services/api.js, поэтому прогресс у человека
// один и тот же, с какого бы устройства он ни учился.
export const courses = {
  list: () => api.get('/courses'),
  get: id => api.get(`/courses/${id}`),
  getLesson: (courseId, lessonId) =>
    api.get(`/courses/${courseId}/lessons/${lessonId}`),
  completeLesson: (courseId, lessonId) =>
    api.post(`/courses/${courseId}/lessons/${lessonId}/complete`),
  setCurrentLesson: (courseId, lessonId) =>
    api.post(`/courses/${courseId}/current-lesson`, {lessonId}),
  getTest: courseId => api.get(`/courses/${courseId}/test`),
  // Сервер проверяет ответы разом и сам считает балл — правильные варианты в
  // GET /test не приходят, поэтому телефон не может подсветить ошибку сразу
  submitTest: (courseId, answers) =>
    api.post(`/courses/${courseId}/test/submit`, {answers}),
  resetProgress: courseId => api.post(`/courses/${courseId}/reset`),
};

// ── Склад (ver. 6.81) ────────────────────────────────────────────────────────
// Набор ручек урезан относительно веба сознательно, и урезан по одному признаку:
// здесь только то, что делают НА НОГАХ, стоя в кабинете с телефоном в руке.
//
// Сканирование, пересчёт по описи, размещение имущества по кабинетам — работа
// глазами и руками в помещении. Настройка локаций, планы этажей, словарь
// предметов, отчёты и закупки остаются в вебе: это работа за столом, и телефон
/**
 * Модуль отзывов (ver. 7.26).
 *
 * Доступ раздаётся досками, а не отдельным правом, поэтому проверять его
 * заранее нечем: пустой список досок и есть ответ «модуль не для вас».
 */
export const reviews = {
  boards: () => api.get('/reviews/boards'),
  list: boardId => api.get('/reviews', {params: {boardId}}),
  // Назначенное мне по всем доскам разом: на телефоне доска целиком не
  // помещается, и первый экран — «что висит на мне», а висеть может где угодно
  assigned: () => api.get('/reviews/assigned'),
  assignedCount: () => api.get('/reviews/assigned-count'),
  review: id => api.get(`/reviews/${id}`),
  move: (id, data) => api.post(`/reviews/${id}/move`, data),
  comment: (id, data) => api.post(`/reviews/${id}/comment`, data),
  assign: (id, data) => api.post(`/reviews/${id}/assign`, data),
};

// в ней не помогает, а мешает.
export const warehouse = {
  access: () => api.get('/warehouse/access'),
  tree: () => api.get('/warehouse/locations/tree'),

  // Сканер: принимает и инвентарный номер с этикетки, и полную ссылку из QR —
  // разбирает сервер, чтобы телефон не знал про формат публичных ссылок.
  lookup: code => api.get(`/warehouse/assets/lookup/${encodeURIComponent(code)}`),
  asset: id => api.get(`/warehouse/assets/${id}`),
  assets: params => api.get('/warehouse/assets', {params}),
  roomDashboard: roomId => api.get(`/warehouse/reports/room/${roomId}/dashboard`),

  // Правка карточек с телефона (ver. 7.24). Кабинета, места хранения и МОЛ среди
  // полей нет и здесь: их меняет документ перемещения, иначе актив сменил бы
  // место без следа в журнале. То же ограничение действует в вебе.
  createAsset: data => api.post('/warehouse/assets', data),
  updateAsset: (id, data) => api.put(`/warehouse/assets/${id}`, data),
  createNomenclature: data => api.post('/warehouse/catalog/nomenclature', data),
  // Приход: количество материала кладётся на полку документом, а не правкой
  // остатка — иначе склад разошёлся бы с журналом молча
  createDocument: data => api.post('/warehouse/operations/documents', data),
  updateNomenclature: (id, data) => api.put(`/warehouse/catalog/nomenclature/${id}`, data),
  categories: () => api.get('/warehouse/catalog/categories'),
  nomenclature: params => api.get('/warehouse/catalog/nomenclature', {params}),
  stock: params => api.get('/warehouse/catalog/stock', {params}),
  documents: params => api.get('/warehouse/operations/documents', {params}),
  contractors: () => api.get('/warehouse/catalog/contractors'),

  // Инвентаризация
  inventorySessions: () => api.get('/warehouse/operations/inventory'),
  inventory: id => api.get(`/warehouse/operations/inventory/${id}`),
  // Открытие описи с телефона (ver. 7.22). Раньше её заводили только в вебе, и
  // человек, пришедший считать кабинет, упирался в пустой список.
  createInventory: data => api.post('/warehouse/operations/inventory', data),
  countInventory: (id, data) =>
    api.post(`/warehouse/operations/inventory/${id}/count`, data),
  closeInventory: (id, data) =>
    api.patch(`/warehouse/operations/inventory/${id}/close`, data),
  // Отмена, а не закрытие: опись, заведённую по ошибке, закрывать нельзя —
  // непересчитанные строки станут недостачей на весь кабинет. Отмена ничего не
  // проводит, поэтому её и можно нажать с телефона.
  cancelInventory: (id, reason) =>
    api.patch(`/warehouse/operations/inventory/${id}/cancel`, {reason}),

  // Этикетки для Brother P-touch.
  //
  // Сервер отдаёт не картинку, а готовое задание печати в base64: телефон
  // выкладывает его в сокет принтера как есть. Задание нарочно приезжает одним
  // куском и целиком — в отделении человек может уйти в сеть самого принтера,
  // где портала уже не видно, и к этому моменту печатать должно быть уже нечем
  // рисковать. Подробности формата — backend/services/warehouse/ptouchRaster.js.
  assetLabelsPrn: data => api.post('/warehouse/assets/labels/batch.prn', data),
  roomLabelsPrn: data => api.post('/warehouse/locations/rooms/door-cards/batch.prn', data),
  // Отметку «напечатано» ставит телефон после того, как принтер принял задание,
  // а не сервер при его подготовке: подготовка ещё не печать.
  markLabelsPrinted: ids => api.post('/warehouse/assets/labels/printed', {ids}),

  // Схема этажа — только чтение: мобильный дашборд кабинета показывает, где он
  // на плане. Редактор планов остался в вебе.
  floorPlan: floorId => api.get(`/warehouse/locations/floors/${floorId}/plan`),

  /**
   * Адреса предпросмотра этикеток. Именно адреса, а не запросы: картинку тянет
   * нативный загрузчик <Image> (см. LabelPreview), поэтому здесь только ссылка.
   *
   * PNG, а не SVG. Телефон нарисовал бы SVG своими шрифтами, а кегли на этикетке
   * подогнаны по метрикам Arial на сервере: предпросмотр разошёлся бы с тем, что
   * уходит в принтер, ровно в том месте, где человек решает, печатать или нет.
   * PNG приходит из того же растеризатора, что готовит задание печати.
   */
  doorCardUrl: roomId =>
    `${CONFIG.API_URL}/warehouse/locations/rooms/${roomId}/door-card.svg?format=png`,
  assetLabelUrl: assetId =>
    `${CONFIG.API_URL}/warehouse/assets/${assetId}/label.svg?format=png`,

  // Размещение позиций ведомости по кабинетам (ver. 6.80)
  // Рассылки складских отчётов: что приходит, куда и как это выключить
  mailings: () => api.get('/warehouse/mailing/subscriptions'),
  setMailing: (code, enabled) => api.put(`/warehouse/mailing/subscriptions/${code}`, {enabled}),
  mailingReport: code => api.get(`/warehouse/mailing/report/${code}`),
  mailingReportFileUrl: code =>
    `${CONFIG.API_URL}/warehouse/mailing/report/${code}?format=file`,

  placementQueue: params => api.get('/warehouse/placements/queue', {params}),
  // Отмена размещения по кабинету — временный инструмент отладки для
  // администратора, см. backend/services/warehouse/osvRollback.js
  rollbackRoom: roomId => api.post(`/warehouse/placements/room/${roomId}/rollback`),
  placementsInRoom: roomId => api.get(`/warehouse/placements/room/${roomId}`),
  placeItems: data => api.post('/warehouse/placements', data),
  deletePlacement: id => api.delete(`/warehouse/placements/${id}`),
};

export default api;
