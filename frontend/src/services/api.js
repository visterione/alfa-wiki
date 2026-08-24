import axios from 'axios';

// Динамическое определение API URL
const getBaseUrl = () => {
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }
  // В Tauri production hostname = 'tauri.localhost', а не 'localhost'
  // Поэтому для desktop-приложения всегда явно используем адрес сервера
  const isTauriApp = typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
  if (isTauriApp) {
    return 'http://192.168.22.39:9001';
  }
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:9001`;
};

export const BASE_URL = getBaseUrl();

const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !window.location.pathname.includes('/login')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // Куда человек шёл — в sessionStorage: переход жёсткий, и состояние
      // роутера его не переживёт. Страница входа заберёт адрес оттуда и вернёт
      // человека на место. Чаще всего это как раз протухший токен на телефоне,
      // с которого только что перешли по QR-коду с двери кабинета.
      const { pathname, search, hash } = window.location;
      sessionStorage.setItem('afterLogin', `${pathname}${search}${hash}`);
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const auth = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  verify2FA: (userId, code) => api.post('/auth/verify-2fa', { userId, code }),
  resend2FA: (userId) => api.post('/auth/resend-2fa', { userId }),
  register: (data) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
  // Выход снимает сессию на сервере. Раньше он был чисто клиентским — токен
  // просто стирали, а сам он оставался валидным до exp.
  logout: () => api.post('/auth/logout'),
  sessions: () => api.get('/auth/sessions'),
  revokeSession: (id) => api.delete(`/auth/sessions/${id}`),
  revokeAllSessions: () => api.post('/auth/sessions/revoke-all'),
  changePassword: (currentPassword, newPassword) => api.post('/auth/change-password', { currentPassword, newPassword }),
  updateProfile: (data) => api.put('/auth/profile', data),
  uploadAvatar: (file) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.post('/auth/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }
};

// Users
export const users = {
  list: (params) => api.get('/users', { params }), // Admin only - full user list with all details
  listBasic: (params) => api.get('/users/list', { params }), // All authenticated users - basic list for assignee selection
  get: (id) => api.get(`/users/${id}`),
  getPublicProfile: (id) => api.get(`/users/${id}/public`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  trash: () => api.get('/users/trash'),
  restore: (id) => api.post(`/users/${id}/restore`),
  getMedCenters: () => api.get('/users/medcenters/list'),
  misSearch: (q) => api.get('/users/mis-search', { params: { q } }),
  misAvatar: (avatarUrl) => api.post('/users/mis-avatar', { avatarUrl }),
  uploadAvatar: (file) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.post('/users/upload-avatar', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  }
};

// Roles
export const roles = {
  list: () => api.get('/roles'),
  get: (id) => api.get(`/roles/${id}`),
  create: (data) => api.post('/roles', data),
  update: (id, data) => api.put(`/roles/${id}`, data),
  delete: (id) => api.delete(`/roles/${id}`)
};

// Справочник медцентров: названия, фирменные цвета, логотипы, адреса, графики,
// главврачи и связь с clinic_id из МИС. Читать может любой авторизованный.
export const medCenters = {
  // includeVirtual — со служебными группировками («Направители», «АУП»),
  // includeInactive — с закрытыми клиниками (нужно отчётам за прошлые периоды).
  list: ({ includeVirtual, includeInactive } = {}) => api.get('/med-centers', {
    params: {
      ...(includeVirtual ? { includeVirtual: '1' } : {}),
      ...(includeInactive ? { includeInactive: '1' } : {})
    }
  }),
  get: (id) => api.get(`/med-centers/${id}`),
  create: (data) => api.post('/med-centers', data),
  update: (id, data) => api.put(`/med-centers/${id}`, data),
  delete: (id) => api.delete(`/med-centers/${id}`)
};

// Юрлица (ООО / ИП), которым принадлежат медцентры
export const organizations = {
  list: () => api.get('/organizations'),
  create: (data) => api.post('/organizations', data),
  update: (id, data) => api.put(`/organizations/${id}`, data),
  delete: (id) => api.delete(`/organizations/${id}`)
};

// Pages
export const pages = {
  list: (params) => api.get('/pages', { params }),
  get: (identifier) => api.get(`/pages/${identifier}`),
  create: (data) => api.post('/pages', data),
  createFile: async ({ file, title, description, isPublished, allowedRoles, folderId, onProgress }) => {
    // 1. Upload the file to /media/upload
    const formData = new FormData();
    formData.append('file', file);
    const { data: mediaData } = await api.post('/media/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: e => onProgress?.(Math.round((e.loaded * 100) / e.total))
    });
    // 2. Create a page with contentType='file' referencing the uploaded media
    return api.post('/pages', {
      title: title || mediaData.originalName,
      contentType: 'file',
      mediaId: mediaData.id,
      description,
      isPublished: isPublished || false,
      allowedRoles: allowedRoles || [],
      folderId: folderId || null,
      metadata: {
        mimeType: mediaData.mimeType,
        size: mediaData.size,
        originalName: mediaData.originalName,
        path: mediaData.path
      }
    });
  },
  update: (id, data) => api.put(`/pages/${id}`, data),
  delete: (id) => api.delete(`/pages/${id}`),
  toggleFavorite: (id) => api.post(`/pages/${id}/favorite`),
  getHistory: (id) => api.get(`/pages/${id}/history`),
  exportHistoryPdf: (id) => api.get(`/pages/${id}/history/pdf`),
  importXlsx: (id, formData) =>
    api.post(`/pages/${id}/import-xlsx`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    }),
  exportXlsx: (id) =>
    api.get(`/pages/${id}/export-xlsx`, { responseType: 'blob' })
};

// Journal
export const journal = {
  list: (params) => api.get('/journal', { params }),
  activities: (params) => api.get('/journal/activities', { params }),
  activityModules: () => api.get('/journal/activity-modules'),
  pageAuthors: () => api.get('/journal/page-authors')
};

export const rbActivityLog = {
  list:  (params) => api.get('/rb-activity-log',       { params: { ...params, includeDiff: false } }),
  get:   (id)     => api.get(`/rb-activity-log/${encodeURIComponent(id)}`),
  tabs:  ()       => api.get('/rb-activity-log/tabs'),
  users: ()       => api.get('/rb-activity-log/users'),
};

// Folders
export const folders = {
  browse: (parentId) => api.get('/folders/browse', { params: { parentId } }),
  resolve: (path) => api.get('/folders/resolve', { params: { path } }),
  tree: () => api.get('/folders/tree'),
  get: (id) => api.get(`/folders/${id}`),
  create: (data) => api.post('/folders', data),
  update: (id, data) => api.put(`/folders/${id}`, data),
  move: (items) => api.post('/folders/move', { items }),
  reorder: (data) => api.post('/folders/reorder', data),
  delete: (id) => api.delete(`/folders/${id}`)
};

// Favorites
export const favorites = {
  list: () => api.get('/favorites'),
  check: (pageId) => api.get(`/favorites/check/${pageId}`),
  add: (pageId) => api.post(`/favorites/${pageId}`),
  remove: (pageId) => api.delete(`/favorites/${pageId}`),
  toggle: (pageId) => api.post(`/favorites/${pageId}/toggle`),
  reorder: (order) => api.put('/favorites/reorder', { order })
};

// Sidebar
export const sidebar = {
  list: () => api.get('/sidebar'),
  listAll: () => api.get('/sidebar/all'),
  create: (data) => api.post('/sidebar', data),
  update: (id, data) => api.put(`/sidebar/${id}`, data),
  reorder: (data) => api.post('/sidebar/reorder', data),
  reorderFolderPages: (folderId, pages) => api.post('/sidebar/reorder-folder-pages', { folderId, pages }),
  delete: (id) => api.delete(`/sidebar/${id}`)
};

// Media
export const media = {
  list: (params) => api.get('/media', { params }),
  asUniver: (id) => api.get(`/media/${id}/as-univer`),
  upload: (file, onProgress) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/media/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: e => onProgress?.(Math.round((e.loaded * 100) / e.total))
    });
  },
  delete: (id) => api.delete(`/media/${id}`)
};

// Search
export const search = {
  query: (q) => api.get('/search', { params: { q } }),
  fulltext: (q) => api.get('/search/fulltext', { params: { q } }),
  suggest: (q) => api.get('/search/suggest', { params: { q } }),
  reindex: () => api.post('/search/reindex')
};

// Settings
export const settings = {
  list: () => api.get('/settings'),
  update: (key, value) => api.put(`/settings/${key}`, { value }),
  bulkUpdate: (data) => api.post('/settings/bulk', { settings: data }),
  init: () => api.post('/settings/init')
};

// Backup
export const backup = {
  list: () => api.get('/backup'),
  create: () => api.post('/backup'),
  upload: (file) => {
    const formData = new FormData();
    formData.append('backup', file);
    return api.post('/backup/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  restore: (filename, options = {}) => api.post(`/backup/restore/${filename}`, options),
  download: (filename) => `${BASE_URL}/api/backup/download/${filename}`,
  delete: (filename) => api.delete(`/backup/${filename}`),
  cleanup: () => api.post('/backup/cleanup')
};

// Chat
export const chat = {
  list: () => api.get('/chat'),
  search: (query) => api.get('/chat/search', { params: { q: query } }),
  getUnreadCount: () => api.get('/chat/unread/count'),
  getMessages: (chatId, params) => api.get(`/chat/${chatId}/messages`, { params }),
  // Токен доступа к вложениям: подставляется в ?t= к ссылкам на файлы,
  // потому что заголовок Authorization в <img src> не выставить
  getFileToken: () => api.get('/chat/file-token'),
  getCommands: (chatId) => api.get(`/chat/${chatId}/commands`),
  getMentionTargets: (chatId) => api.get(`/chat/${chatId}/mention-targets`),
  createPoll: (chatId, data) => api.post(`/chat/${chatId}/polls`, data),
  votePoll: (chatId, messageId, optionIds) => api.post(`/chat/${chatId}/messages/${messageId}/poll-vote`, { optionIds }),
  getUsers: () => api.get('/chat/users'),
  getBots: () => api.get('/chat/bots'),
  sendMessage: (chatId, content, attachments = [], replyToId = null, mentions = []) => {
    const type = attachments.length > 0
      ? (attachments.every(a => a.mimeType?.startsWith('image/')) ? 'image' : 'file')
      : 'text';
    const body = { content, type, attachments };
    if (replyToId) body.replyToId = replyToId;
    if (mentions.length) body.mentions = mentions;
    return api.post(`/chat/${chatId}/messages`, body);
  },
  markAsRead: (chatId) => api.post(`/chat/${chatId}/read`),
  
  startPrivate: (userId) => api.post('/chat/private', { userId }),
  
  createGroup: (name, memberIds) => api.post('/chat/group', { name, memberIds }),
  updateGroup: (chatId, data) => api.put(`/chat/${chatId}`, data),
  
  updateAvatar: (chatId, file) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.post(`/chat/${chatId}/avatar`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteAvatar: (chatId) => api.delete(`/chat/${chatId}/avatar`),
  
  renameGroup: (chatId, name) => api.patch(`/chat/${chatId}/rename`, { name }),
  setMemberRole: (chatId, userId, role) => api.patch(`/chat/${chatId}/members/${userId}/role`, { role }),
  setMemberReadOnly: (chatId, userId, isReadOnly) => api.patch(`/chat/${chatId}/members/${userId}/readonly`, { isReadOnly }),
  addMember: (chatId, userId) => api.post(`/chat/${chatId}/members`, { userId }),
  bulkAddMembers: (chatId, userIds) => api.post(`/chat/${chatId}/members/bulk`, { userIds }),
  removeMember: (chatId, userId) => api.delete(`/chat/${chatId}/members/${userId}`),
  leave: (chatId) => api.delete(`/chat/${chatId}/leave`),
  deleteGroup: (chatId) => api.delete(`/chat/${chatId}`),
  deleteChat: (chatId) => api.delete(`/chat/${chatId}`),
  
  uploadFiles: (chatId, files) => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    return api.post(`/chat/${chatId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  editMessage: (chatId, messageId, content) => api.put(`/chat/${chatId}/messages/${messageId}`, { content }),
  deleteMessage: (chatId, messageId) => api.delete(`/chat/${chatId}/messages/${messageId}`),
  getPinned: (chatId) => api.get(`/chat/${chatId}/pinned`),
  // Галерея чата: kind = media | files | voice | links
  getChatMedia: (chatId, kind, params) => api.get(`/chat/${chatId}/media`, { params: { kind, ...params } }),
  pinMessage: (chatId, messageId, pin) => api.post(`/chat/${chatId}/messages/${messageId}/pin`, { pin }),
  // Групповое удаление. scope: 'me' — спрятать у себя, 'all' — стереть у всех
  deleteMessages: (chatId, messageIds, scope) => api.post(`/chat/${chatId}/messages/delete`, { messageIds, scope }),
  hideChat: (chatId, hidden = true) => api.patch(`/chat/${chatId}/hide`, { hidden }),
  muteChat: (chatId, muted) => api.patch(`/chat/${chatId}/mute`, { muted }),
  pinChat: (chatId, pinned) => api.patch(`/chat/${chatId}/pin`, { pinned }),
  reorderPinnedChats: (chatIds) => api.patch('/chat/pins/reorder', { chatIds }),

  // Message reactions
  addReaction: (chatId, messageId, emoji) => api.post(`/chat/${chatId}/messages/${messageId}/reactions`, { emoji }),
  removeReaction: (chatId, messageId) => api.delete(`/chat/${chatId}/messages/${messageId}/reactions`),
  getReactionDetails: (chatId, messageId) => api.get(`/chat/${chatId}/messages/${messageId}/reactions`),

  // Кнопка под сообщением бота: создать пациента в МИС, открыть реестр справок
  runMessageAction: (chatId, messageId, actionId) =>
    api.post(`/chat/${chatId}/messages/${messageId}/actions/${actionId}`),

  // Forward messages
  forwardMessages: (targetChatId, messageIds) => api.post('/chat/forward', { targetChatId, messageIds }),

  // Голосовое сообщение. Отдельный маршрут: сервер приводит запись к общему
  // для всех платформ формату и определяет длительность.
  uploadVoice: (blob, filename = 'voice.webm', duration) => {
    const formData = new FormData();
    formData.append('file', blob, filename);
    // Запасной источник длительности, если ffprobe на сервере промолчит
    if (duration) formData.append('duration', String(duration));
    return api.post('/chat/voice', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }
};

// Accreditations
export const accreditations = {
  list: (params) => api.get('/accreditations', { params }),
  get: (id) => api.get(`/accreditations/${id}`),
  create: (data) => api.post('/accreditations', data),
  update: (id, data) => api.put(`/accreditations/${id}`, data),
  delete: (id) => api.delete(`/accreditations/${id}`),
  stats: () => api.get('/accreditations/stats'),
  specialties: () => api.get('/accreditations/specialties')
};

// Vehicles
export const vehicles = {
  list: (params) => api.get('/vehicles', { params }),
  get: (id) => api.get(`/vehicles/${id}`),
  create: (data) => api.post('/vehicles', data),
  update: (id, data) => api.put(`/vehicles/${id}`, data),
  delete: (id) => api.delete(`/vehicles/${id}`),
  stats: () => api.get('/vehicles/stats'),
  organizations: () => api.get('/vehicles/organizations'),
  brands: () => api.get('/vehicles/brands')
};

// Map
export const map = {
  getMarkers: (params) => api.get('/map/markers', { params }),
  getMarker: (id) => api.get(`/map/markers/${id}`),
  createMarker: (data) => api.post('/map/markers', data),
  updateMarker: (id, data) => api.put(`/map/markers/${id}`, data),
  deleteMarker: (id) => api.delete(`/map/markers/${id}`),
  upload: (formData) => api.post('/map/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  getCategories: () => api.get('/map/categories'),
  reindex: () => api.post('/map/reindex')
};

// Courses
export const courses = {
  // User endpoints
  list: () => api.get('/courses'),
  get: (id) => api.get(`/courses/${id}`),
  getLesson: (courseId, lessonId) => api.get(`/courses/${courseId}/lessons/${lessonId}`),
  completeLesson: (courseId, lessonId) => api.post(`/courses/${courseId}/lessons/${lessonId}/complete`),
  setCurrentLesson: (courseId, lessonId) => api.post(`/courses/${courseId}/current-lesson`, { lessonId }),
  getTest: (courseId) => api.get(`/courses/${courseId}/test`),
  submitTest: (courseId, answers) => api.post(`/courses/${courseId}/test/submit`, { answers }),
  resetProgress: (courseId) => api.post(`/courses/${courseId}/reset`),
  
  // Admin endpoints
  adminList: () => api.get('/courses/admin/all'),
  adminGet: (id) => api.get(`/courses/admin/${id}/edit`),
  create: (data) => api.post('/courses/admin', data),
  update: (id, data) => api.put(`/courses/admin/${id}`, data),
  delete: (id) => api.delete(`/courses/admin/${id}`),
  
  // Lessons
  createLesson: (courseId, data) => api.post(`/courses/admin/${courseId}/lessons`, data),
  updateLesson: (id, data) => api.put(`/courses/admin/lessons/${id}`, data),
  deleteLesson: (id) => api.delete(`/courses/admin/lessons/${id}`),
  reorderLessons: (courseId, lessonIds) => api.post(`/courses/admin/${courseId}/lessons/reorder`, { lessonIds }),
  
  // Test questions
  createQuestion: (courseId, data) => api.post(`/courses/admin/${courseId}/questions`, data),
  updateQuestion: (id, data) => api.put(`/courses/admin/questions/${id}`, data),
  deleteQuestion: (id) => api.delete(`/courses/admin/questions/${id}`),
  reorderQuestions: (courseId, questionIds) => api.post(`/courses/admin/${courseId}/questions/reorder`, { questionIds }),
  
  // Stats
  getStats: (courseId) => api.get(`/courses/admin/${courseId}/stats`)
};

// ═══════════════════════════════════════════════════════════════
// CALENDAR API
// ═══════════════════════════════════════════════════════════════

export const calendar = {
  // Получить события за период
  getEvents: (params) => api.get('/calendar/events', { params }),

  // Получить индикаторы событий для календаря
  getEventIndicators: (start, end) =>
    api.get('/calendar/event-indicators', { params: { start, end } }),

  // Получить одно событие
  getEvent: (id) => api.get(`/calendar/events/${id}`),

  // Создать событие
  createEvent: (data) => api.post('/calendar/events', data),

  // Обновить событие
  updateEvent: (id, data) => api.put(`/calendar/events/${id}`, data),

  // Удалить событие
  deleteEvent: (id) => api.delete(`/calendar/events/${id}`),

  // Удалить отдельный экземпляр повторяющегося события
  deleteEventInstance: (id, instanceDate) => api.delete(`/calendar/events/${id}/instance`, {
    data: { instanceDate }
  }),

  // Получить интегрированные события (аккредитации, ТО)
  getIntegratedEvents: (start, end, types) =>
    api.get('/calendar/integrated-events', { params: { start, end, types } }),

  // Получить предстоящие события
  getUpcoming: (days = 7) =>
    api.get('/calendar/upcoming', { params: { days } }),

  // Получить настройки календаря
  getSettings: () => api.get('/calendar/settings'),

  // Обновить настройки календаря
  updateSettings: (settings) => api.put('/calendar/settings', settings)
};


// === ЗАДАЧИ (ver. 6.75) ===
// Пришли на смену канбану. Ключевое отличие видно прямо здесь: у задачи нет
// метода «назначить исполнителя» — есть постановка с частями и отдельные
// действия исполнителя над своей частью. Срок это согласование, а не поле.
export const tasks = {
  // Что доступно текущему пользователю и заведён ли он в модуле (есть ли норма)
  getAccess: () => api.get('/tasks/access'),

  // === ПРОЕКТЫ ===
  getProjects: (includeArchived) =>
    api.get('/tasks/projects', { params: { includeArchived } }),
  createProject: (data) => api.post('/tasks/projects', data),
  updateProject: (id, data) => api.put(`/tasks/projects/${id}`, data),
  deleteProject: (id) => api.delete(`/tasks/projects/${id}`),

  // === КОМАНДЫ ===
  // closedCount в ответе — сколько команд закрыто. Скрытые в него не входят:
  // счётчик выдал бы ровно то, что они прячут.
  getTeams: () => api.get('/tasks/teams'),
  getTeam: (id) => api.get(`/tasks/teams/${id}`),
  createTeam: (data) => api.post('/tasks/teams', data),
  updateTeam: (id, data) => api.put(`/tasks/teams/${id}`, data),
  deleteTeam: (id) => api.delete(`/tasks/teams/${id}`),
  addTeamMember: (id, data) => api.post(`/tasks/teams/${id}/members`, data),
  removeTeamMember: (id, userId) => api.delete(`/tasks/teams/${id}/members/${userId}`),
  createTeamInvite: (id, data) => api.post(`/tasks/teams/${id}/invites`, data),
  getTeamInvite: (token) => api.get(`/tasks/teams/invites/${token}`),
  acceptTeamInvite: (token) => api.post(`/tasks/teams/invites/${token}/accept`),
  getTeamLoad: (id, start, end) =>
    api.get(`/tasks/teams/${id}/load`, { params: { start, end } }),

  // === ЛЮДИ И НОРМЫ ===
  getPeople: (params) => api.get('/tasks/people', { params }),
  getPersonLoad: (id, start, end) =>
    api.get(`/tasks/people/${id}/load`, { params: { start, end } }),
  getPersonSlots: (id, date) => api.get(`/tasks/people/${id}/slots`, { params: { date } }),
  setSchedule: (id, workSchedule) => api.put(`/tasks/people/${id}/schedule`, { workSchedule }),
  getScheduleHistory: (id) => api.get(`/tasks/people/${id}/schedule/history`),

  // === ЗАДАЧИ ===
  getTasks: (params) => api.get('/tasks', { params }),
  getTask: (id) => api.get(`/tasks/${id}`),
  getPartTask: (id) => api.get(`/tasks/parts/${id}/task`),
  // Ответ 409 с requiresExplanation означает, что кто-то не помещается:
  // повторить с полем explanation. Обойти можно всегда, но не молча.
  createTask: (data) => api.post('/tasks', data),
  cancelTask: (id) => api.delete(`/tasks/${id}`),

  // Мне на решение и те, кого жду я
  getInbox: () => api.get('/tasks/inbox'),
  getBadge: () => api.get('/tasks/badge'),

  // === ДЕЙСТВИЯ НАД ЧАСТЬЮ ===
  // Здесь и только здесь часть превращается в блок времени и занимает часы
  planPart: (id, date, force) => api.post(`/tasks/parts/${id}/plan`, { date, force }),
  // Календарь исполнителя не меняется: задача в него не попала
  proposeDate: (id, date) => api.post(`/tasks/parts/${id}/propose`, { date }),
  acceptDate: (id) => api.post(`/tasks/parts/${id}/accept`),
  declinePart: (id, reason) => api.post(`/tasks/parts/${id}/decline`, { reason }),
  // 409 после третьего переноса: дальше нужно решение, а не перенос
  movePart: (id, date) => api.post(`/tasks/parts/${id}/move`, { date }),
  extendPart: (id, hours = 0.5) => api.post(`/tasks/parts/${id}/extend`, { hours }),
  splitPart: (id, data) => api.post(`/tasks/parts/${id}/split`, data),
  setPartStatus: (id, status) => api.put(`/tasks/parts/${id}/status`, { status }),
  getNextFit: (id, params) => api.get(`/tasks/parts/${id}/next-fit`, { params }),

  // === ОТЧЁТЫ ===
  getReports: (params) => api.get('/tasks/reports', { params })
};


// === REVIEWS API ===
export const reviews = {
  // === PLATFORMS ===
  getPlatforms: () => api.get('/reviews/platforms'),
  createPlatform: (data) => api.post('/reviews/platforms', data),
  updatePlatform: (id, data) => api.put(`/reviews/platforms/${id}`, data),
  deletePlatform: (id) => api.delete(`/reviews/platforms/${id}`),

  // === BOARDS ===
  getBoards: () => api.get('/reviews/boards'),
  getBoard: (id) => api.get(`/reviews/boards/${id}`),
  createBoard: (data) => api.post('/reviews/boards', data),
  updateBoard: (id, data) => api.put(`/reviews/boards/${id}`, data),
  deleteBoard: (id) => api.delete(`/reviews/boards/${id}`),

  // === BOARD PERMISSIONS ===
  getBoardPermissions: (boardId) => api.get(`/reviews/boards/${boardId}/permissions`),
  addBoardPermission: (boardId, data) => api.post(`/reviews/boards/${boardId}/permissions`, data),
  updateBoardPermission: (boardId, permId, data) => api.put(`/reviews/boards/${boardId}/permissions/${permId}`, data),
  deleteBoardPermission: (boardId, permId) => api.delete(`/reviews/boards/${boardId}/permissions/${permId}`),

  // === BOARD ROLES ===
  getBoardRoles: (boardId) => api.get(`/reviews/boards/${boardId}/roles`),
  addBoardRole: (boardId, data) => api.post(`/reviews/boards/${boardId}/roles`, data),
  deleteBoardRole: (boardId, roleId) => api.delete(`/reviews/boards/${boardId}/roles/${roleId}`),

  // === BOARD SETTINGS ===
  getBoardSettings: (boardId) => api.get(`/reviews/boards/${boardId}/settings`),
  updateBoardSettings: (boardId, data) => api.put(`/reviews/boards/${boardId}/settings`, data),

  // === REVIEWS ===
  getReviews: (boardId) => api.get(`/reviews?boardId=${boardId}`),
  getReview: (id) => api.get(`/reviews/${id}`),
  createReview: (data) => api.post('/reviews', data),
  updateReview: (id, data) => api.put(`/reviews/${id}`, data),
  deleteReview: (id) => api.delete(`/reviews/${id}`),
  getAssignedCount: () => api.get('/reviews/assigned-count'),
  moveReview: (id, status, sortOrder, comment) => api.post(`/reviews/${id}/move`, { status, sortOrder, comment }),
  assignReview: (id, assigneeId, comment) => api.post(`/reviews/${id}/assign`, { assigneeId, comment }),
  addComment: (id, data) => api.post(`/reviews/${id}/comment`, data),
  replyReview: (id, text) => api.post(`/reviews/${id}/reply`, { text }),
  finalizeReview: (id, data) => api.post(`/reviews/${id}/finalize`, data),
  getReviewPdf: (id) => api.get(`/reviews/${id}/pdf`, { responseType: 'blob' }),

  // === ARCHIVE ===
  getArchive: (params) => api.get('/reviews/archive', { params }),
  archiveReview: (id) => api.post(`/reviews/${id}/archive`),
  restoreReview: (id) => api.post(`/reviews/${id}/restore`),

  // === STATISTICS ===
  getStats: (params) => api.get('/reviews/stats', { params }),

  // === FILES ===
  uploadFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/reviews/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteFile: (fileId, reviewId) => api.delete(`/reviews/files/${fileId}?reviewId=${reviewId}`),

  // === DOCTORS AUTOCOMPLETE ===
  suggestDoctors: (query) => api.get('/reviews/doctors/suggest', { params: { q: query } }),

  // === SYNC ===
  getSyncProviders: () => api.get('/reviews/sync/providers'),
  getSyncConfigs: (boardId) => api.get(`/reviews/sync/configs/${boardId}`),
  saveSyncConfig: (boardId, provider, data) => api.put(`/reviews/sync/configs/${boardId}/${provider}`, data),
  testSyncConnection: (boardId, provider, credentials) =>
    api.post(`/reviews/sync/test/${boardId}/${provider}`, { credentials }),
  runSync: (boardId) => api.post(`/reviews/sync/run/${boardId}`),
  runSyncProvider: (boardId, provider) => api.post(`/reviews/sync/run/${boardId}/${provider}`),
  backfillSync: (boardId) => api.post(`/reviews/sync/backfill/${boardId}`)
};

// === EMAIL API ===
export const email = {
  // === TEMPLATES ===
  getTemplates: () => api.get('/email/templates'),
  createTemplate: (data) => api.post('/email/templates', data),
  updateTemplate: (id, data) => api.put(`/email/templates/${id}`, data),
  deleteTemplate: (id) => api.delete(`/email/templates/${id}`),

  // === SENDING ===
  send: (data) => api.post('/email/send', data),
  getJobStatus: (jobId) => api.get(`/email/send/status/${jobId}`),

  // === HISTORY ===
  getHistory: (params) => api.get('/email/history', { params }),
  getHistoryDetail: (id) => api.get(`/email/history/${id}`),

  // === RECIPIENTS ===
  getUsers: () => api.get('/email/recipients/users'),
  getUsersByRole: (roleId) => api.get(`/email/recipients/by-role/${roleId}`),
  parseExcel: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/email/recipients/parse-excel', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },

  // === FAVORITES ===
  getFavoriteRecipients: () => api.get('/email/favorites/recipients'),
  addFavoriteRecipient: (data) => api.post('/email/favorites/recipients', data),
  removeFavoriteRecipient: (id) => api.delete(`/email/favorites/recipients/${id}`),
  getFavoriteTemplates: () => api.get('/email/favorites/templates'),
  toggleFavoriteTemplate: (templateId) => api.post(`/email/favorites/templates/${templateId}`)
};

/**
 * Права складского модуля. Настраиваются в дереве прав карточки пользователя,
 * поэтому живут рядом с правами зарплаты, а не в warehouseApi: тот про работу
 * со складом, а это про администрирование доступа.
 */
export const warehouseAccessApi = {
  catalogue:    ()               => api.get('/warehouse/permissions/catalogue'),
  getUserPerm:  (userId)         => api.get(`/warehouse/permissions/${userId}`),
  saveUserPerm: (userId, data)   => api.put(`/warehouse/permissions/${userId}`, data),
};

export const referralBonusAccess = {
  getUsers: () => api.get('/referral-bonuses/permissions/users'),
  getUserPerm: (userId) => api.get(`/referral-bonuses/permissions/${userId}`),
  saveUserPerm: (userId, data) => api.put(`/referral-bonuses/permissions/${userId}`, data),
};

// === REFERRAL BONUSES MODULE ===
export const referralBonuses = {
  getByDoctor: (misUserId) => api.get('/referral-bonuses', { params: { misUserId, compact: true } }),
  getByDoctorPage: (misUserId, params) => api.get('/referral-bonuses', { params: { misUserId, ...params } }),
  getByService: (serviceCode) => api.get('/referral-bonuses/by-service', { params: { serviceCode } }),
  getByServices: (serviceCodes, misUserIds) => api.post('/referral-bonuses/by-services', { serviceCodes, misUserIds }),
  getByDoctorServices: (misUserId, serviceCodes) => api.post('/referral-bonuses/by-doctor-services', { misUserId, serviceCodes }),
  save: (data) => api.post('/referral-bonuses', data),
  saveBulk: (data) => api.post('/referral-bonuses/bulk', data),
  delete: (id) => api.delete(`/referral-bonuses/${id}`),
  getMyPermissions: () => api.get('/referral-bonuses/permissions/my'),
  getSuggests: () => api.get('/referral-bonuses/suggests'),
  saveSuggests: (data) => api.put('/referral-bonuses/suggests', data),
};

export const performedServiceBonuses = {
  getByDoctor: (misUserId) => api.get('/performed-service-bonuses', { params: { misUserId } }),
  save: (data) => api.post('/performed-service-bonuses', data),
  delete: (id) => api.delete(`/performed-service-bonuses/${id}`),
  deleteByService: (misUserId, serviceCode) => api.delete(`/performed-service-bonuses/by-service/${misUserId}/${serviceCode}`),
};

export const executorSettings = {
  get: (misUserId) => api.get('/executor-settings', { params: { misUserId } }),
  save: (data) => api.post('/executor-settings', data),
  getResetPreview: (clinicIds) => api.get('/executor-settings/reset-preview', { params: { clinicIds: clinicIds.join(',') } }),
  resetAll: (clinicIds) => api.post('/executor-settings/reset-all', { clinicIds }),
  getResetBackups: () => api.get('/executor-settings/reset-backups'),
  getResetBackup: (id) => api.get(`/executor-settings/reset-backups/${encodeURIComponent(id)}`),
  restoreResetBackup: (id) => api.post(`/executor-settings/reset-backups/${encodeURIComponent(id)}/restore`),
  getAllDisabledClinics: () => api.get('/executor-settings/disabled-clinics'),
  getScheduleFill: () => api.get('/executor-settings/schedule-fill'),
  setScheduleFill: (misUserId, doctorName, status) => api.post('/executor-settings/schedule-fill', { misUserId, doctorName, status }),
  getAupMembers: () => api.get('/executor-settings/aup-members'),
};

export const cashPayments = {
  getByMisUser: (misUserId) => api.get('/cash-payments', { params: { misUserId } }),
  getAll: () => api.get('/cash-payments'),
  create: (data) => api.post('/cash-payments', data),
  update: (id, data) => api.put(`/cash-payments/${id}`, data),
  delete: (id) => api.delete(`/cash-payments/${id}`),
};

export const salaryRecords = {
  getByDoctor: (misUserId) => api.get('/salary-records', { params: { misUserId } }),
  getAll: (params) => api.get('/salary-records/all', params ? { params } : undefined),
  find: (misUserId, dateFrom) => api.get('/salary-records/find', { params: { misUserId, dateFrom } }),
  getAssistanceIncome: (params) => api.get('/salary-records/assistance-income', { params }),
  create: (data) => api.post('/salary-records', data),
  update: (id, data) => api.put(`/salary-records/${id}`, data),
  delete: (id) => api.delete(`/salary-records/${id}`),
  downloadExcel: (id) => api.get(`/salary-records/${id}/excel`, { responseType: 'blob' }),
};

export const mis = {
  getClinics: () => api.get('/mis/clinics'),
  getClinicsFromMIS: (params) => api.post('/mis/get-clinics', params || {}),
  getDoctors: (data) => api.post('/mis/doctors', data),
  getServices: (params) => api.get('/mis/services', { params }),
  searchServices: (term, clinic_id) => api.post('/mis/search-mis', { term, ...(clinic_id ? { clinic_id } : {}) }),
  getDoctorInfo: (userId) => api.post('/mis/doctor-info', { userId }),
  getSchedulePeriods: (data) => api.post('/mis/schedule-periods', data),
  getSchedule: (data) => api.post('/mis/schedule', data),
  getServicesByIds: (serviceIds, clinicId) => api.post('/mis/services', {
    service_ids: serviceIds,
    show_all: true,
    ...(clinicId ? { clinic_id: clinicId } : {})
  }),
  getServiceCategories: () => api.post('/mis/get-service-categories', {}),
  getServicesByCategory: (categoryId, clinicId) => api.post('/mis/get-services', {
    category_id: categoryId,
    show_children: true,
    ...(clinicId ? { clinic_id: clinicId } : {})
  }),
  getAllServices: (clinicId) => api.post('/mis/all-services', clinicId ? { clinic_id: clinicId } : {}),
  getAppointments: (params) => api.post('/mis/appointments', params),
  getDebtors: (params) => api.post('/mis/debtors', params || {}),
};

export const doctorCards = {
  getMyProfile: (cardId) => api.get('/doctor-cards/profile/me', { params: cardId ? { cardId } : undefined }),
  getProfileOptions: () => api.get('/doctor-cards/profile/options')
};

export const directories = {
  getAll: (type) => api.get(`/directories/${type}`),
  save: (type, id, data) => api.put(`/directories/${type}/${id}`, data),
  create: (type, data) => api.post(`/directories/${type}`, data),
  remove: (type, id) => api.delete(`/directories/${type}/${id}`),
};

export const misAppointments = {
  syncStatus: () => api.get('/mis-appointments/sync/status'),
  syncTrigger: (params) => api.post('/mis-appointments/sync/trigger', params || {}),
  query: (params) => api.get('/mis-appointments', { params }),
};

export const misPayments = {
  syncStatus: () => api.get('/mis-payments/sync/status'),
  syncTrigger: (params) => api.post('/mis-payments/sync/trigger', params || {}),
  query: (params) => api.get('/mis-payments', { params }),
};

export const hourNorms = {
  get: (year, month) => api.get('/hour-norms', { params: { year, month } }),
  getPeriods: () => api.get('/hour-norms/periods'),
  saveBulk: (year, month, norms) => api.post('/hour-norms/bulk', { year, month, norms }),
};

export const roleNorms = {
  get: (year, month) => api.get('/role-norms', { params: { year, month } }),
  getPeriods: () => api.get('/role-norms/periods'),
  saveBulk: (year, month, norms) => api.post('/role-norms/bulk', { year, month, norms }),
};

export const categoryNorms = {
  get: (year, month) => api.get('/category-norms', { params: { year, month } }),
  getPeriods: () => api.get('/category-norms/periods'),
  saveBulk: (year, month, norms) => api.post('/category-norms/bulk', { year, month, norms }),
};

export const referralReports = {
  list: (params) => api.get('/referral-reports', { params }),
  get: (id) => api.get(`/referral-reports/${id}`),
  create: (data) => api.post('/referral-reports', data),
  delete: (id) => api.delete(`/referral-reports/${id}`),
};

export const bots = {
  list:            ()         => api.get('/bots'),
  create:          (data)     => api.post('/bots', data),
  update:          (id, data) => api.put(`/bots/${id}`, data),
  delete:          (id)       => api.delete(`/bots/${id}`),
  regenerateToken: (id)       => api.post(`/bots/${id}/regenerate-token`),
};

// Ключи публичного API: внешние системы, которым разрешено слать нам данные
export const apiClients = {
  list:        ()         => api.get('/api-clients'),
  meta:        ()         => api.get('/api-clients/meta'),
  create:      (data)     => api.post('/api-clients', data),
  update:      (id, data) => api.patch(`/api-clients/${id}`, data),
  rotate:      (id)       => api.post(`/api-clients/${id}/rotate`),
  revoke:      (id)       => api.delete(`/api-clients/${id}`),
  logs:        (id)       => api.get(`/api-clients/${id}/logs`),
  submissions: (params)   => api.get('/api-clients/submissions', { params }),
  redeliver:   (id)       => api.post(`/api-clients/submissions/${id}/redeliver`),
};

// Парсер прайсов конкурентов. Всё идёт через наш бэкенд: парсер работает
// по HTTP в локальной сети, и обратиться к нему со страницы напрямую нельзя —
// браузер запретит смешанный контент.
export const priceParser = {
  ping:      ()               => api.get('/parser/ping'),
  sources:   ()               => api.get('/parser/sources'),
  source:    (id)             => api.get(`/parser/sources/${id}`),
  services:  (id, params)     => api.get(`/parser/sources/${id}/services`, { params }),
  // каталог из нашей копии — то, что видит сопоставление, а не сайт конкурента
  catalog:   (id, params)     => api.get(`/parser/sources/${id}/catalog`, { params }),
  analyze:   (url, city)      => api.post('/parser/analyze', { url, city }),
  job:       (jobId)          => api.get(`/parser/jobs/${jobId}`),
  confirm:   (jobId, cities)  => api.post(`/parser/jobs/${jobId}/confirm`, { cities }),
  refresh:   (id)             => api.post(`/parser/sources/${id}/refresh`),
  syncStatus:()               => api.get('/parser/sync/status'),
  sync:      ()               => api.post('/parser/sync'),
  // логотипы приходят готовыми data-URI: <img> не умеет слать JWT-заголовок
  logos:     ()               => api.get('/parser/logos'),
  rename:    (id, displayName) => api.patch(`/parser/sources/${id}`, { displayName }),
  setCity:   (id, city)       => api.patch(`/parser/sources/${id}`, { city }),
  // очередь: список ссылок разбирается по одной, человек возвращается к готовым
  queueAdd:     (urls)        => api.post('/parser/queue', { urls }),
  queueList:    ()            => api.get('/parser/queue'),
  queueConfirm: (id, cities)  => api.post(`/parser/queue/${id}/confirm`, { cities }),
  queueDrop:    (id)          => api.delete(`/parser/queue/${id}`),
  queueClear:   ()            => api.post('/parser/queue/clear'),
  // филиалы всех источников разом — третий уровень дерева на странице парсера
  filials:   ()               => api.get('/parser/filials'),
  // адреса точек: для карты в сравнении цен и просто чтобы знать, куда идти
  locations:        (id)          => api.get(`/parser/sources/${id}/locations`),
  collectLocations: (id)          => api.post(`/parser/sources/${id}/locations/collect`),
  addLocation:      (id, data)    => api.post(`/parser/sources/${id}/locations`, data),
  editLocation:     (lid, data)   => api.patch(`/parser/locations/${lid}`, data),
  dropLocation:     (lid)         => api.delete(`/parser/locations/${lid}`),
  // координаты для карты: автоопределение по адресу и правка мышью
  geocodeLocations: (id, recheck) => api.post(`/parser/sources/${id}/locations/geocode`, { recheck: !!recheck }),
  setLocationPos:   (lid, lat, lon) => api.patch(`/parser/locations/${lid}/position`, { lat, lon }),
  setLocationFilial:(lid, filialId) => api.patch(`/parser/locations/${lid}/filial`, { filialId }),
  branding:  (id)             => api.post(`/parser/sources/${id}/branding`),
  // свой значок — там, где с сайта снять нечего; автосбор его потом не трогает
  uploadLogo: (id, file) => {
    const form = new FormData();
    form.append('logo', file);
    return api.post(`/parser/sources/${id}/logo/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  dropLogo:  (id)             => api.delete(`/parser/sources/${id}/logo`),
  remove:    (id)             => api.delete(`/parser/sources/${id}`),
};

// Сравнения цен — нужен только список, всё остальное живёт на своей странице
export const priceComparisons = {
  list: () => api.get('/price-comparisons'),
};

// Автосопоставление запускается при обычном добавлении конкурента.
// Вручную принимать/отклонять спорные пары можно с доступом «Парсер цен».
export const competitorMatching = {
  list:    (comparisonId)          => api.get(`/competitor-matching/${comparisonId}/matches`),
  suggest: (comparisonId)          => api.post(`/competitor-matching/${comparisonId}/matches/suggest`),
  confirm: (comparisonId, matchId) => api.post(`/competitor-matching/${comparisonId}/matches/${matchId}/confirm`),
  reject:  (comparisonId, matchId) => api.post(`/competitor-matching/${comparisonId}/matches/${matchId}/reject`),
  fill:    (comparisonId)          => api.post(`/competitor-matching/${comparisonId}/fill`),
};

export const doctorSchedules = {
  list:                 (misUserId)              => api.get('/doctor-schedules', { params: { misUserId } }),
  create:               (data)                   => api.post('/doctor-schedules', data),
  update:               (id, data)               => api.put(`/doctor-schedules/${id}`, data),
  delete:               (id)                     => api.delete(`/doctor-schedules/${id}`),
  importFromMis:           (misUserId, month)          => api.post('/doctor-schedules/import-from-mis', { misUserId, month }),
  cancelMisImport:         (misUserId)                 => api.delete(`/doctor-schedules/mis-import/for-user/${misUserId}`),
  getMisCategoryMap:       ()                          => api.get('/doctor-schedules/mis-category-map'),
  updateMisCategoryMap:    (misId, rbCategoryId)       => api.put(`/doctor-schedules/mis-category-map/${misId}`, { rbCategoryId }),
  setMisCategoryMapForRb:  (rbCategoryId, misCategoryId) => api.put(`/doctor-schedules/mis-category-map/for-rb-category/${rbCategoryId}`, { misCategoryId }),
};

export const rbScheduleDicts = {
  listCategories:   ()          => api.get('/rb-schedule-dicts/categories'),
  createCategory:   (data)      => api.post('/rb-schedule-dicts/categories', data),
  updateCategory:   (id, data)  => api.put(`/rb-schedule-dicts/categories/${id}`, data),
  deleteCategory:   (id)        => api.delete(`/rb-schedule-dicts/categories/${id}`),
  listCabinets:     ()          => api.get('/rb-schedule-dicts/cabinets'),
  createCabinet:    (data)      => api.post('/rb-schedule-dicts/cabinets', data),
  updateCabinet:    (id, data)  => api.put(`/rb-schedule-dicts/cabinets/${id}`, data),
  deleteCabinet:    (id)        => api.delete(`/rb-schedule-dicts/cabinets/${id}`),
};

export const tabelRecords = {
  list:      ()           => api.get('/tabel-records'),
  get:       (id)         => api.get(`/tabel-records/${id}`),
  byDoctor:  (misUserId)  => api.get('/tabel-records/by-doctor', { params: { misUserId } }),
  create:    (data)       => api.post('/tabel-records', data),
  update:    (id, data)   => api.put(`/tabel-records/${id}`, data),
  delete:    (id)         => api.delete(`/tabel-records/${id}`),
};

export const structuralDivisions = {
  list:         ()                 => api.get('/structural-divisions'),
  create:       (data)             => api.post('/structural-divisions', data),
  update:       (id, data)         => api.put(`/structural-divisions/${id}`, data),
  delete:       (id)               => api.delete(`/structural-divisions/${id}`),
  getAccess:    (id)               => api.get(`/structural-divisions/${id}/access`),
  addAccess:    (id, userId, perm) => api.post(`/structural-divisions/${id}/access`, { userId, permission: perm }),
  removeAccess: (id, userId)       => api.delete(`/structural-divisions/${id}/access/${userId}`),
};

export const rbHolidays = {
  list:   ()         => api.get('/rb-holidays'),
  create: (data)     => api.post('/rb-holidays', data),
  delete: (id)       => api.delete(`/rb-holidays/${id}`),
};

export const rbDoctorHeaders = {
  list:   ()                   => api.get('/rb-doctor-headers'),
  upsert: (misUserId, data)    => api.put(`/rb-doctor-headers/${misUserId}`, data),
};

export const rbExcelSources = {
  list:       ()               => api.get('/rb-excel-sources'),
  create:     (data)           => api.post('/rb-excel-sources', data),
  update:     (id, data)       => api.put(`/rb-excel-sources/${id}`, data),
  delete:     (id)             => api.delete(`/rb-excel-sources/${id}`),
  getFile:    (id)             => api.get(`/rb-excel-sources/${id}/file`, { responseType: 'blob' }),
};

export const releaseNotes = {
  // Пользовательские
  list:            (params) => api.get('/release-notes', { params }),
  importantUnread: ()       => api.get('/release-notes/important-unread'),
  unreadCount:     ()       => api.get('/release-notes/unread-count'),
  markRead:        (id)     => api.post(`/release-notes/${id}/read`),
  markAllRead:     ()       => api.post('/release-notes/read-all'),
  // Админские
  adminList:       ()       => api.get('/release-notes/admin/all'),
  audienceOptions: ()       => api.get('/release-notes/admin/audience-options'),
  create:      (data)       => api.post('/release-notes', data),
  update:      (id, data)   => api.put(`/release-notes/${id}`, data),
  publish:     (id)         => api.post(`/release-notes/${id}/publish`),
  unpublish:   (id)         => api.post(`/release-notes/${id}/unpublish`),
  delete:      (id)         => api.delete(`/release-notes/${id}`),
};

export const botSubscribers = {
  // Статистика подписчиков ботов (Telegram/MAX) по медцентрам и месяцам
  stats: (params) => api.get('/bot-subscribers/stats', { params }),
  // Распределение подписчиков по числу медцентров (экосистема ботов)
  overlap: (params) => api.get('/bot-subscribers/overlap', { params }),
  // Охват среди реальных пациентов: сколько пациентов с визитами подписаны на боты
  penetration: (params) => api.get('/bot-subscribers/penetration', { params }),
};

// ── Складской учёт (ver. 6.68) ──────────────────────────────────────────────
// Публичные карточки по QR живут на /api/wh-public и НЕ требуют токена, поэтому
// вынесены в отдельный axios-клиент без интерцептора авторизации: с ним
// неавторизованный посетитель получил бы редирект на /login вместо карточки.
const publicApi = axios.create({
  baseURL: `${BASE_URL}/api/wh-public`,
  headers: { 'Content-Type': 'application/json' },
});

export const warehouseApi = {
  access: () => api.get('/warehouse/access'),

  // Локации
  tree:            ()             => api.get('/warehouse/locations/tree'),
  specialties:     ()             => api.get('/warehouse/locations/specialties'),
  createSpecialty: (data)         => api.post('/warehouse/locations/specialties', data),
  createBuilding:  (data)         => api.post('/warehouse/locations/buildings', data),
  updateBuilding:  (id, data)     => api.put(`/warehouse/locations/buildings/${id}`, data),
  deleteBuilding:  (id)           => api.delete(`/warehouse/locations/buildings/${id}`),
  createFloor:     (data)         => api.post('/warehouse/locations/floors', data),
  updateFloor:     (id, data)     => api.put(`/warehouse/locations/floors/${id}`, data),
  deleteFloor:     (id)           => api.delete(`/warehouse/locations/floors/${id}`),
  floorPlan:       (id)           => api.get(`/warehouse/locations/floors/${id}/plan`),
  saveFloorPlan:   (id, data)     => api.put(`/warehouse/locations/floors/${id}/plan`, data),
  medCenterPlan:   (id)           => api.get(`/warehouse/locations/med-centers/${id}/plan`),
  saveMedCenterPlan:(id, data)     => api.put(`/warehouse/locations/med-centers/${id}/plan`, data),
  departments:     (params)       => api.get('/warehouse/locations/departments', { params }),
  createDepartment:(data)         => api.post('/warehouse/locations/departments', data),
  updateDepartment:(id, data)     => api.put(`/warehouse/locations/departments/${id}`, data),
  deleteDepartment:(id)           => api.delete(`/warehouse/locations/departments/${id}`),
  createRoom:      (data)         => api.post('/warehouse/locations/rooms', data),
  updateRoom:      (id, data)     => api.put(`/warehouse/locations/rooms/${id}`, data),
  deleteRoom:      (id)           => api.delete(`/warehouse/locations/rooms/${id}`),
  misSuggestions:  (params)       => api.get('/warehouse/locations/rooms/mis-suggestions', { params }),
  createStorage:   (data)         => api.post('/warehouse/locations/storages', data),
  updateStorage:   (id, data)     => api.put(`/warehouse/locations/storages/${id}`, data),

  // Справочники и остатки
  categories:      ()             => api.get('/warehouse/catalog/categories'),
  createCategory:  (data)         => api.post('/warehouse/catalog/categories', data),
  contractors:     (params)       => api.get('/warehouse/catalog/contractors', { params }),
  createContractor:(data)         => api.post('/warehouse/catalog/contractors', data),
  updateContractor:(id, data)     => api.put(`/warehouse/catalog/contractors/${id}`, data),
  nomenclature:    (params)       => api.get('/warehouse/catalog/nomenclature', { params }),
  createNomenclature: (data)      => api.post('/warehouse/catalog/nomenclature', data),
  updateNomenclature: (id, data)  => api.put(`/warehouse/catalog/nomenclature/${id}`, data),
  batches:         (params)       => api.get('/warehouse/catalog/batches', { params }),
  createBatch:     (data)         => api.post('/warehouse/catalog/batches', data),
  blockBatch:      (id, data)     => api.patch(`/warehouse/catalog/batches/${id}/block`, data),
  stock:           (params)       => api.get('/warehouse/catalog/stock', { params }),
  reconcileStock:  ()             => api.get('/warehouse/catalog/stock/reconcile'),
  reorderRules:    ()             => api.get('/warehouse/catalog/reorder-rules'),
  createReorderRule: (data)       => api.post('/warehouse/catalog/reorder-rules', data),
  deleteReorderRule: (id)         => api.delete(`/warehouse/catalog/reorder-rules/${id}`),
  norms:           ()             => api.get('/warehouse/catalog/norms'),
  createNorm:      (data)         => api.post('/warehouse/catalog/norms', data),
  deleteNorm:      (id)           => api.delete(`/warehouse/catalog/norms/${id}`),

  // Активы
  assets:          (params)       => api.get('/warehouse/assets', { params }),
  asset:           (id)           => api.get(`/warehouse/assets/${id}`),
  createAsset:     (data)         => api.post('/warehouse/assets', data),
  updateAsset:     (id, data)     => api.put(`/warehouse/assets/${id}`, data),
  lookup:          (code)         => api.get(`/warehouse/assets/lookup/${encodeURIComponent(code)}`),
  assetQrUrl:      (id)           => `${BASE_URL}/api/warehouse/assets/${id}/qr.svg`,
  labelUrl:        (id, size)     => `${BASE_URL}/api/warehouse/assets/${id}/label.svg?size=${size || '80x24'}`,
  labelsBatch:     (data)         => api.post('/warehouse/assets/labels/batch', data),
  labelsBatchZpl:  (data)         => api.post('/warehouse/assets/labels/batch.zpl', data),
  zpl:             (id, copies)   => api.get(`/warehouse/assets/${id}/label.zpl`, { params: { copies } }),
  uploadAssetFiles:(id, formData) => api.post(`/warehouse/assets/${id}/files`, formData, {
                                      headers: { 'Content-Type': 'multipart/form-data' } }),
  patchAssetFile:  (fileId, data) => api.patch(`/warehouse/assets/files/${fileId}`, data),
  deleteAssetFile: (fileId)       => api.delete(`/warehouse/assets/files/${fileId}`),

  // Операции
  documents:       (params)       => api.get('/warehouse/operations/documents', { params }),
  document:        (id)           => api.get(`/warehouse/operations/documents/${id}`),
  createDocument:  (data)         => api.post('/warehouse/operations/documents', data),
  movements:       (params)       => api.get('/warehouse/operations/movements', { params }),
  maintenance:     (params)       => api.get('/warehouse/operations/maintenance', { params }),
  createMaintenance: (data)       => api.post('/warehouse/operations/maintenance', data),
  closeMaintenance:(id, data)     => api.patch(`/warehouse/operations/maintenance/${id}/close`, data),
  createRepair:    (data)         => api.post('/warehouse/operations/repairs', data),
  closeRepair:     (id, data)     => api.patch(`/warehouse/operations/repairs/${id}/close`, data),
  inventorySessions: ()           => api.get('/warehouse/operations/inventory'),
  frozenRooms:      ()            => api.get('/warehouse/operations/inventory/frozen-rooms'),

  // ── Регламентная рассылка ──────────────────────────────────────────────────
  mailSubscriptions: ()           => api.get('/warehouse/mailing/subscriptions'),
  setMailSubscription: (code, enabled) =>
    api.put(`/warehouse/mailing/subscriptions/${code}`, { enabled }),
  mailPreview:      (code)        => api.get(`/warehouse/mailing/preview/${code}`),
  mailLog:          ()            => api.get('/warehouse/mailing/log'),
  createInventory: (data)         => api.post('/warehouse/operations/inventory', data),
  inventory:       (id)           => api.get(`/warehouse/operations/inventory/${id}`),
  countInventory:  (id, data)     => api.post(`/warehouse/operations/inventory/${id}/count`, data),
  closeInventory:  (id, data)     => api.patch(`/warehouse/operations/inventory/${id}/close`, data),
  // Отмена, а не закрытие: закрытие превращает непересчитанные строки в
  // недостачу, и описи, заведённой по ошибке, оно не подходит.
  cancelInventory: (id, data)     => api.patch(`/warehouse/operations/inventory/${id}/cancel`, data),
  postInventoryDifferences: (id, data) => api.post(`/warehouse/operations/inventory/${id}/post-differences`, data),
  rfqList:         ()             => api.get('/warehouse/operations/rfq'),
  createRfq:       (data)         => api.post('/warehouse/operations/rfq', data),
  addQuote:        (id, data)     => api.post(`/warehouse/operations/rfq/${id}/quotes`, data),
  rfqComparison:   (id)           => api.get(`/warehouse/operations/rfq/${id}/comparison`),
  decideRfq:       (id, data)     => api.patch(`/warehouse/operations/rfq/${id}/decide`, data),

  // Ведомость 1С
  osvImports:      ()             => api.get('/warehouse/osv/imports'),
  osvImport:       (id, params)   => api.get(`/warehouse/osv/imports/${id}`, { params }),
  osvDiff:         (id)           => api.get(`/warehouse/osv/imports/${id}/diff`),
  uploadOsv:       (formData)     => api.post('/warehouse/osv/imports', formData, {
                                      headers: { 'Content-Type': 'multipart/form-data' } }),
  applyOsv:        (id)           => api.post(`/warehouse/osv/imports/${id}/apply`),
  deleteOsv:       (id)           => api.delete(`/warehouse/osv/imports/${id}`),
  osvReview:       (params)       => api.get('/warehouse/osv/review', { params }),
  osvReviewLines:  (params)       => api.get('/warehouse/osv/review/lines', { params }),
  saveOsvMapping:  (data)         => api.put('/warehouse/osv/mapping', data),
  deleteOsvMapping:(id)           => api.delete(`/warehouse/osv/mapping/${id}`),
  materializeOsv:  (id, data)     => api.post(`/warehouse/osv/imports/${id}/materialize`, data),

  // Словарь предметов (ver. 6.79)
  itemRules:       ()             => api.get('/warehouse/item-rules'),
  saveItemRule:    (data)         => api.put('/warehouse/item-rules', data),
  deleteItemRule:  (id)           => api.delete(`/warehouse/item-rules/${id}`),
  itemRuleHeads:   (params)       => api.get('/warehouse/item-rules/heads', { params }),
  probeItemRule:   (params)       => api.get('/warehouse/item-rules/probe', { params }),

  // Размещение по кабинетам (ver. 6.80)
  placementQueue:  (params)       => api.get('/warehouse/placements/queue', { params }),
  placementsInRoom:(roomId)       => api.get(`/warehouse/placements/room/${roomId}`),
  placeItems:      (data)         => api.post('/warehouse/placements', data),
  parseAssetNames: (data)         => api.post('/warehouse/assets/parse-names', data),
  bulkUpdateAssets:(data)         => api.post('/warehouse/assets/bulk', data),
  bulkReorderRules:(data)         => api.post('/warehouse/catalog/reorder-rules/bulk', data),
  createRoomsFromMis: (data)      => api.post('/warehouse/locations/rooms/from-mis', data),
  misRoomSuggestions: (params)    => api.get('/warehouse/locations/rooms/mis-suggestions', { params }),
  updatePlacement: (id, data)     => api.patch(`/warehouse/placements/${id}`, data),
  deletePlacement: (id)           => api.delete(`/warehouse/placements/${id}`),
  // Отмена размещения по кабинету — временный инструмент отладки для
  // администратора, см. backend/services/warehouse/osvRollback.js
  rollbackRoom:    (roomId)       => api.post(`/warehouse/placements/room/${roomId}/rollback`),

  // Отчёты
  turnover:        (params)       => api.get('/warehouse/reports/turnover', { params }),
  consumption:     (params)       => api.get('/warehouse/reports/consumption', { params }),
  expiring:        (params)       => api.get('/warehouse/reports/expiring', { params }),
  depreciation:    (params)       => api.get('/warehouse/reports/depreciation', { params }),
  reliability:     ()             => api.get('/warehouse/reports/reliability'),
  transferMatrix:  (params)       => api.get('/warehouse/reports/transfer-matrix', { params }),
  roomDashboard:   (roomId)       => api.get(`/warehouse/reports/room/${roomId}/dashboard`),
  setStockBatch:   (stockId, body) => api.patch(`/warehouse/catalog/stock/${stockId}/batch`, body),
  roomQrUrl:       (roomId)       => `${BASE_URL}/api/warehouse/locations/rooms/${roomId}/qr.svg`,
  // Карточка на дверь приходит разметкой, а не картинкой: тем же SVG рисуется и
  // превью в модалке, и лист в окне печати — иначе на печать уходил бы скриншот
  // превью со своим разрешением.
  roomDoorCard:    (roomId, size) => api.get(`/warehouse/locations/rooms/${roomId}/door-card.svg`, { params: { size } }),
  roomDoorCardPng: (roomId, size, rotate) => api.get(`/warehouse/locations/rooms/${roomId}/door-card.svg`, {
                                      params: { size, format: 'png', rotate: rotate || undefined },
                                      responseType: 'blob',
                                    }),
  roomDoorCardZpl: (roomId)       => api.get(`/warehouse/locations/rooms/${roomId}/door-card.zpl`),
  // Пачка дверных этикеток. В отличие от одиночной карточки приходит готовыми
  // PNG: страниц в пачке десятки, и растеризовать их по одной в браузере значило
  // бы столько же запросов подряд.
  roomDoorCardsBatch:    (data)   => api.post('/warehouse/locations/rooms/door-cards/batch', data),
  roomDoorCardsBatchZpl: (data)   => api.post('/warehouse/locations/rooms/door-cards/batch.zpl', data),
  inventoryReport: (id)           => api.get(`/warehouse/reports/inventory/${id}`),
  exportReport:    (data)         => api.post('/warehouse/reports/export', data, { responseType: 'blob' }),

  // Сохранённые отчёты. Список приходит без строк и страницами: снимок оборотки
  // весит мегабайты, и тянуть их все ради перечня названий незачем.
  savedReports:    (params)       => api.get('/warehouse/reports/saved', { params }),
  savedReport:     (id)           => api.get(`/warehouse/reports/saved/${id}`),
  saveReport:      (data)         => api.post('/warehouse/reports/saved', data),
  deleteSavedReport: (id)         => api.delete(`/warehouse/reports/saved/${id}`),

  // Права доступа
  accessMatrix:    ()             => api.get('/warehouse/permissions/matrix'),
  roleGrants:      ()             => api.get('/warehouse/permissions/role-grants'),
  setRoleGrants:   (roleId, data) => api.put(`/warehouse/permissions/role-grants/${roleId}`, data),
  effectiveAccess: (userId)       => api.get(`/warehouse/permissions/effective/${userId}`),
  accessUsers:     ()             => api.get('/warehouse/permissions/users'),

  // Аналитика
  heatmap:         (params)       => api.get('/warehouse/analytics/heatmap', { params }),
  recomputeUtilization: (data)    => api.post('/warehouse/analytics/utilization/recompute', data),
  idleAssets:      (params)       => api.get('/warehouse/analytics/idle-assets', { params }),
  overview:        ()             => api.get('/warehouse/analytics/overview'),

  // Публичная карточка актива (без авторизации). Кабинеты публичными быть
  // перестали: их QR ведёт в портал и требует входа.
  publicAsset:     (token)        => publicApi.get(`/a/${token}`),
};

export default api;
