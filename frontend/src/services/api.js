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
  // Оформление общее с мобильным приложением: сервер кладёт его в
  // users.settings.appearance и рассылает по сокету на другие устройства
  updatePreferences: (data) => api.patch('/auth/preferences', data),
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
  // Массовая правка прав (ver. 8.31). Тело разреженное: в patch лежат только
  // тронутые ключи, всё остальное у выбранных людей остаётся как было.
  bulkPermissions: (data) => api.post('/users/bulk-permissions', data),
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
  // Журнал прочтений чата (ver. 8.26). since — дата самого старого
  // загруженного сообщения: более ранние отметки ничего из показанного
  // не накрывают
  getReadMarks: (chatId, since) => api.get(`/chat/${chatId}/read-marks`, { params: since ? { since } : {} }),
  
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

  // Пригласительные ссылки (ver. 7.58). Выключены по умолчанию — см.
  // backend/services/chatInvites.js
  getInvite: (chatId) => api.get(`/chat/${chatId}/invite`),
  enableInvite: (chatId) => api.post(`/chat/${chatId}/invite`),
  rotateInvite: (chatId) => api.post(`/chat/${chatId}/invite/rotate`),
  disableInvite: (chatId) => api.delete(`/chat/${chatId}/invite`),
  previewInvite: (token) => api.get(`/chat/invite/${token}`),
  joinByInvite: (token) => api.post(`/chat/invite/${token}/join`),
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

// Маркетинг (ver. 8.22). Акции не хранятся у портала: читаем и заводим их прямо
// в МИС, поэтому здесь нет ни update, ни delete — таких методов в API МИС нет.
export const marketing = {
  getPromos:      ()      => api.get('/marketing/promos'),
  getPromoClinics:()      => api.get('/marketing/promo-clinics'),
  createPromo:    (data)  => api.post('/marketing/promos', data),
  startDoctorScan:()      => api.post('/marketing/doctors/scans'),
  getDoctorScan:  id      => api.get('/marketing/doctors/scans/' + encodeURIComponent(id)),
  getLatestDoctorScan: () => api.get('/marketing/doctors/scans/latest'),
  getDoctorScanPhotos: (id, sourceIndex) => api.get('/marketing/doctors/scans/'
    + encodeURIComponent(id) + '/sources/' + sourceIndex + '/photos'),
  getDoctorScanDoctor: (id, sourceIndex, doctorIndex) => api.get('/marketing/doctors/scans/'
    + encodeURIComponent(id) + '/sources/' + sourceIndex + '/doctors/' + doctorIndex)
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
  // В ответе accessGranted: true, если человеку этим же действием открыли
  // модуль «Задачи». Приглашений по ссылке больше нет — состав правится напрямую.
  addTeamMember: (id, data) => api.post(`/tasks/teams/${id}/members`, data),
  removeTeamMember: (id, userId) => api.delete(`/tasks/teams/${id}/members/${userId}`),
  getTeamLoad: (id, start, end) =>
    api.get(`/tasks/teams/${id}/load`, { params: { start, end } }),
  // Кто за что отвечает внутри команды: люди со своими активными частями и три
  // сигнала. Только командные задачи — личные дела участников сюда не попадают.
  getTeamOverview: (id) => api.get(`/tasks/teams/${id}/overview`),
  // Показатели команды за период: сроки, оценки, авральность, скорость разбора
  // и то же самое по людям. Считается по истории командных задач.
  getTeamStats: (id, start, end) =>
    api.get(`/tasks/teams/${id}/stats`, { params: { start, end } }),

  // === ЛЮДИ И НОРМЫ ===
  getPeople: (params) => api.get('/tasks/people', { params }),
  // Кому можно поручить: только заведённые в модуле, то есть с рабочим
  // расписанием. Всем остальным постановка задачи отвечает 409, и предлагать
  // их в выборе исполнителя значит обещать то, чего не будет.
  getAssignable: () => api.get('/tasks/people/assignable'),
  // Загрузка всех людей области видимости одной таблицей — вкладка
  // «Сотрудники» на экране загрузки, где команды не разделяют людей.
  getPeopleLoad: (start, end) =>
    api.get('/tasks/people/load', { params: { start, end } }),
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
  // Отдельно от остального редактирования: это не правка реквизита, а смена
  // того, кто видит задачу. teamId: null снимает привязку.
  setTaskTeam: (id, teamId) => api.put(`/tasks/${id}/team`, { teamId }),

  // Мне на решение и те, кого жду я
  getInbox: () => api.get('/tasks/inbox'),
  getBadge: () => api.get('/tasks/badge'),

  // === ДЕЙСТВИЯ НАД ЧАСТЬЮ ===
  // Здесь и только здесь часть превращается в блок времени и занимает часы.
  //
  // У многодневной подзадачи (ver. 8.48) вместо дня передаётся раскладка —
  // [{date, hours}] по дням окна, — и в календаре появляется по блоку на день.
  // 409 с requiresLayout означает, что раскладка не сошлась: в ответе окно, дни
  // с остатком по каждому и текст, что именно не так. 409 с requiresConfirm —
  // раскладка верна, но какой-то день уходит в переработку: повторить с force.
  planPart: (id, date, force) => api.post(`/tasks/parts/${id}/plan`, { date, force }),
  planPartLayout: (id, layout, force) =>
    api.post(`/tasks/parts/${id}/plan`, { layout, force }),
  // Календарь исполнителя не меняется: задача в него не попала.
  // У многодневной окно сдвигается целиком, сохраняя длину: from задаёт начало
  // явно, без него оно считается от предложенного срока назад.
  proposeDate: (id, date, from) => api.post(`/tasks/parts/${id}/propose`, { date, from }),
  acceptDate: (id) => api.post(`/tasks/parts/${id}/accept`),
  declinePart: (id, reason) => api.post(`/tasks/parts/${id}/decline`, { reason }),
  // Перенос сохраняет длительность: у работы в несколько дней until задаёт новый
  // конец, и сервер откажет, если длина изменилась — это уже другое действие
  // (stretchPart). Раскладка при переносе снимается: в новых днях другая
  // занятость, и прежние часы молча перегрузили бы дни, которых человек не видел.
  // 409 после третьего переноса: дальше нужно решение, а не перенос.
  movePart: (id, date, until) => api.post(`/tasks/parts/${id}/move`, { date, until }),
  extendPart: (id, hours = 0.5) => api.post(`/tasks/parts/${id}/extend`, { hours }),
  splitPart: (id, data) => api.post(`/tasks/parts/${id}/split`, data),
  // Изменить длительность работы: другое число дней или обратно в один день
  // (from === to). Как и разбиение, обнуляет счётчик переносов и возвращает во
  // входящие. Длина обязана измениться — сдвиг без смены длины это movePart.
  stretchPart: (id, from, to) => api.post(`/tasks/parts/${id}/stretch`, { from, to }),
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
  // Заводить и удалять доски нельзя с ver. 8.56: доска есть у каждого медцентра
  // и появляется вместе с ним. Через updateBoard правится только архивность.
  updateBoard: (id, data) => api.put(`/reviews/boards/${id}`, data),

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
  suggestDoctors: (query) => api.get('/reviews/doctors/suggest', { params: { q: query } })
};

// Площадки для Альфа Парсера (ver. 8.80): учётки и места
export const reviewCollector = {
  load: () => api.get('/review-collector'),
  createAccount: (data) => api.post('/review-collector/accounts', data),
  updateAccount: (id, data) => api.patch(`/review-collector/accounts/${id}`, data),
  deleteAccount: (id) => api.delete(`/review-collector/accounts/${id}`),
  checkAccount: (id) => api.post(`/review-collector/accounts/${id}/check`),
  updatePlace: (id, data) => api.patch(`/review-collector/places/${id}`, data)
};

// === EMAIL API ===
export const email = {
  // === TEMPLATES ===
  getTemplates: () => api.get('/email/templates'),
  createTemplate: (data) => api.post('/email/templates', data),
  updateTemplate: (id, data) => api.put(`/email/templates/${id}`, data),
  deleteTemplate: (id) => api.delete(`/email/templates/${id}`),

  // === КОНСТРУКТОР (ver. 8.43) ===
  // Предпросмотр собирает письмо на сервере той же функцией, что и отправка:
  // у письма должен быть один способ превратиться в HTML, иначе холст и
  // настоящее письмо разойдутся, и узнают об этом получатели.
  preview: (data) => api.post('/email/preview', data),
  // Картинки письма идут своим маршрутом, а не через общий /media/upload: там
  // файл ложится как есть, а письму нужен ужатый до 1200px и с известным весом.
  uploadImage: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/email/image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  testSend: (data) => api.post('/email/test-send', data),

  // === МОДУЛИ КОНСТРУКТОРА ===
  getModules: () => api.get('/email/modules'),
  saveModule: (data) => api.post('/email/modules', data),
  renameModule: (id, name) => api.put(`/email/modules/${id}`, { name }),
  deleteModule: (id) => api.delete(`/email/modules/${id}`),

  // === ОТПИСКИ ===
  getOptouts: (params) => api.get('/email/optouts', { params }),
  addOptout: (data) => api.post('/email/optouts', data),
  removeOptout: (mail) => api.delete(`/email/optouts/${encodeURIComponent(mail)}`),

  // === ПОЧТОВЫЙ КЛУБ (ver. 8.79) ===
  // Подписчики приходят с сайтов медцентров; список у каждого медцентра свой.
  getClub: () => api.get('/email/club'),
  getClubSubscribers: (params) => api.get('/email/club/subscribers', { params }),
  addClubSubscriber: (data) => api.post('/email/club/subscribers', data),
  unsubscribeClubSubscriber: (id) => api.post(`/email/club/subscribers/${id}/unsubscribe`),
  resubscribeClubSubscriber: (id) => api.post(`/email/club/subscribers/${id}/resubscribe`),
  deleteClubSubscriber: (id) => api.delete(`/email/club/subscribers/${id}`),
  getClubRecipients: (medCenterIds) => api.get('/email/club/recipients', { params: { medCenterIds: medCenterIds.join(',') } }),

  // === SENDING ===
  send: (data) => api.post('/email/send', data),
  getJobStatus: (jobId) => api.get(`/email/send/status/${jobId}`),

  // === СУТОЧНЫЙ ПРЕДЕЛ (ver. 8.57) ===
  // Рассылка, которая не помещается в сутки, растягивается по дням. План
  // спрашиваем заранее, чтобы человек увидел расклад до нажатия «Отправить»,
  // а не узнал о нём из ответа сервера.
  getLimit: (days) => api.get('/email/limit', { params: days ? { days } : undefined }),
  setLimit: (perDay) => api.put('/email/limit', { perDay }),
  getPlan: (data) => api.post('/email/plan', data),

  // === HISTORY ===
  getHistory: (params) => api.get('/email/history', { params }),
  getHistoryDetail: (id) => api.get(`/email/history/${id}`),
  cancelScheduled: (id) => api.post(`/email/history/${id}/cancel`),

  // === RECIPIENTS ===
  getUsers: () => api.get('/email/recipients/users'),
  getRoles: () => api.get('/email/recipients/roles'),
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

export const inpatientReport = {
  // Стационар: услуги поднимаются из МИС по каждому пациенту требования, и
  // отчёт за месяц собирается десятками секунд — таймаут здесь свой, общий
  // клиент столько ждать не рассчитан.
  report: (params) => api.get('/inpatient-report/report', { params, timeout: 300000 }),
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
  chats:           (id)       => api.get(`/bots/${id}/chats`),
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
  // Чем в действительности доставлялись уведомления: ступени каскада по нашему
  // журналу отправок, а не по отчёту агрегатора (ver. 8.02).
  channels: (params) => api.get('/bot-subscribers/channels', { params }),
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
  // Корпусами интерфейс больше не управляет (ver. 7.48): этаж принадлежит
  // медцентру напрямую. Маршруты на сервере остались — по ним видно, из какого
  // корпуса пришёл этаж, — но вызывать их отсюда больше нечему.

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
  // Быстрый переезд оборудования (ver. 7.47): {serviceKind} — на склад этого
  // вида, пустое тело — обратно в кабинет, откуда актив приехал.
  placeAsset:      (id, body)     => api.post(`/warehouse/operations/assets/${id}/place`, body || {}),
  // Отмена проведённой операции встречным документом (ver. 7.50).
  reverseDocument: (id)           => api.post(`/warehouse/operations/documents/${id}/reverse`),
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

// ── Вакансии (ver. 8.20) ──────────────────────────────────────────────────

/**
 * Наём: вакансии, анкеты кандидатов, задачи исполнителей. Второе поколение
 * онбординга — первое удалено целиком в ver. 8.39.
 */
export const vacancies = {
  // Чем бывает поле, какие бывают шаги и письма. Реестр приходит с сервера —
  // второй его список на фронте разошёлся бы с первым на ближайшей правке.
  meta:       ()     => api.get('/vacancies/meta'),
  medCenters: ()     => api.get('/vacancies/med-centers'),
  materials:  (code) => api.get(`/vacancies/materials/${encodeURIComponent(code)}`),

  // Вакансия — единственная настраиваемая сущность раздела: анкета, процесс,
  // письма, исполнители и чаты лежат прямо в ней.
  openings:        ()         => api.get('/vacancies/openings'),
  opening:         (id)       => api.get(`/vacancies/openings/${id}`),
  createOpening:   (data)     => api.post('/vacancies/openings', data),
  saveOpening:     (id, data) => api.put(`/vacancies/openings/${id}`, data),
  saveProcess:     (id, data) => api.put(`/vacancies/openings/${id}/process`, data),
  saveEmails:      (id, data) => api.put(`/vacancies/openings/${id}/emails`, data),
  emailPreview:    (id, key)  => api.get(`/vacancies/openings/${id}/email-preview/${key}`),
  specialities:    (id)       => api.get(`/vacancies/openings/${id}/specialities`),
  openingMaterials:(id)       => api.get(`/vacancies/openings/${id}/materials`),
  sendInvite:      (id, data) => api.post(`/vacancies/openings/${id}/send-invite`, data),
  setStatus:       (id, data) => api.post(`/vacancies/openings/${id}/status`, data),
  deleteOpening:   (id)       => api.delete(`/vacancies/openings/${id}`),

  assignments:    (id)                => api.get(`/vacancies/openings/${id}/assignments`),
  saveAssignment: (id, stepKey, data) => api.put(`/vacancies/openings/${id}/assignments/${stepKey}`, data),

  chats:      (id)          => api.get(`/vacancies/openings/${id}/chats`),
  addChat:    (id, data)    => api.post(`/vacancies/openings/${id}/chats`, data),
  deleteChat: (id, chatId)  => api.delete(`/vacancies/openings/${id}/chats/${chatId}`),

  // Шаблон должности (ver. 8.34): анкета, процесс и письма, с которых
  // начинается вакансия. Вакансия получает копию и дальше живёт сама по себе,
  // поэтому ссылок между ними в API нет — только templateId при создании.
  templates:        ()         => api.get('/vacancies/templates'),
  template:         (id)       => api.get(`/vacancies/templates/${id}`),
  createTemplate:   (data)     => api.post('/vacancies/templates', data),
  templateFromOpening: (vacancyId, data) => api.post(`/vacancies/templates/from-opening/${vacancyId}`, data),
  saveTemplate:     (id, data) => api.put(`/vacancies/templates/${id}`, data),
  saveTemplateProcess: (id, data) => api.put(`/vacancies/templates/${id}/process`, data),
  templateAssignments: (id) => api.get(`/vacancies/templates/${id}/assignments`),
  saveTemplateAssignment: (id, stepKey, data) => api.put(`/vacancies/templates/${id}/assignments/${stepKey}`, data),
  saveTemplateEmails:  (id, data) => api.put(`/vacancies/templates/${id}/emails`, data),
  templateEmailPreview:(id, key)  => api.get(`/vacancies/templates/${id}/email-preview/${key}`),
  deleteTemplate:   (id)       => api.delete(`/vacancies/templates/${id}`),

  // Наши файлы у поля анкеты — образец заявления и подобное. Заголовок нужен
  // явно: у нашего экземпляра axios по умолчанию стоит application/json, а с
  // ним FormData ушла бы пустым объектом вместо файла.
  addAttachment: (id, formData) => api.post(`/vacancies/openings/${id}/attachments`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  deleteAttachment: (id, attachmentId) => api.delete(`/vacancies/openings/${id}/attachments/${attachmentId}`),

  addTemplateAttachment: (id, formData) => api.post(`/vacancies/templates/${id}/attachments`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  deleteTemplateAttachment: (id, attachmentId) => api.delete(`/vacancies/templates/${id}/attachments/${attachmentId}`),

  // Ссылка на образец, а не запрос: файл открывают в новой вкладке, и
  // заголовок авторизации туда не подставить. Маршрут публичный намеренно —
  // это наш пустой бланк, его же скачивает кандидат.
  attachmentUrl: (attachmentId) => `${BASE_URL}/api/public/v1/vacancies/attachments/${attachmentId}`,

  // Ежедневная работа. Её видит не только админ, но и тот, кто назначен
  // исполнителем хоть на один шаг, — маршруты лежат в отдельном роутере.
  overview:     ()              => api.get('/vacancies/overview'),
  applications: (params)        => api.get('/vacancies/applications', { params }),
  application:  (id)            => api.get(`/vacancies/applications/${id}`),
  approve:      (id, data)      => api.post(`/vacancies/applications/${id}/approve`, data),
  revision:     (id, data)      => api.post(`/vacancies/applications/${id}/revision`, data),
  reject:       (id, data)      => api.post(`/vacancies/applications/${id}/reject`, data),
  cancelApp:    (id, data)      => api.post(`/vacancies/applications/${id}/cancel`, data),
  appServices:  (id)            => api.get(`/vacancies/applications/${id}/services`),

  myTasks:      ()              => api.get('/vacancies/tasks/my'),
  claimTask:    (taskId)        => api.post(`/vacancies/tasks/${taskId}/claim`),
  completeTask: (taskId, data)  => api.post(`/vacancies/tasks/${taskId}/complete`, data),
  // Вернуть работу назад с шага проверки: кандидат дозаполняет свою часть
  // заново, задача проверяющего придёт снова.
  returnTask:   (taskId, data)  => api.post(`/vacancies/tasks/${taskId}/return`, data)
};

// Публичный контур вакансий (ver. 8.20). Отдельный клиент без Authorization:
// анкету заполняет человек без аккаунта в портале, и подставлять сюда токен
// залогиненного в том же браузере сотрудника нельзя.
const vacancyApi = axios.create({
  baseURL: `${BASE_URL}/api/public/v1/vacancies`,
  headers: { 'Content-Type': 'application/json' },
});

export const vacancyPublic = {
  branch:      (code)             => vacancyApi.get(`/b/${encodeURIComponent(code)}`),
  // Прямая ссылка на одну вакансию, в обход списка филиала.
  direct:      (code)             => vacancyApi.get(`/j/${encodeURIComponent(code)}`),
  requestCode: (data)             => vacancyApi.post('/request-code', data),
  verifyCode:  (data)             => vacancyApi.post('/verify-code', data),

  load:        (token)            => vacancyApi.get(`/a/${token}`),
  saveDraft:   (token, data)      => vacancyApi.put(`/a/${token}`, data),
  submit:      (token, data)      => vacancyApi.post(`/a/${token}/submit`, data),
  // Вторая часть анкеты (ver. 8.37): документы для трудоустройства, которые
  // спрашивают уже после согласования. Закрывает шаг процесса, а не меняет
  // статус заявки, — отсюда отдельный маршрут.
  submitExtra: (token, data)      => vacancyApi.post(`/a/${token}/extra`, data),
  deleteFile:  (token, fileId)    => vacancyApi.delete(`/a/${token}/files/${fileId}`),
  uploadFile:  (token, formData)  => vacancyApi.post(`/a/${token}/files`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),

  // Наш образец у поля анкеты (ver. 8.34): заявление, памятку или бланк
  // согласия человек скачивает по ссылке, а не получает ответом запроса.
  attachmentUrl:  (id)          => `${BASE_URL}/api/public/v1/vacancies/attachments/${id}`,

  // Экран выбора услуг: шаг, который кандидат закрывает сам.
  services:       (token)       => vacancyApi.get(`/a/${token}/services`),
  saveServices:   (token, data) => vacancyApi.post(`/a/${token}/services`, data),
  submitServices: (token)       => vacancyApi.post(`/a/${token}/services/submit`),
};

export default api;

// Открытая линия (ver. 7.85): обращения пациентов из ботов Telegram/MAX.
// Смена одна на все линии сотрудника — очередь у него общая.
export const openLine = {
  state: () => api.get('/open-line/state'),
  shift: (on) => api.post('/open-line/shift', { on }),

  conversations: (scope = 'queue', q = '') => api.get('/open-line/conversations', { params: { scope, q } }),
  conversation: (id) => api.get(`/open-line/conversations/${id}`),
  // Дочитал до конца (ver. 8.27). Зовётся только когда чат открыт и вкладка
  // на переднем плане — см. OpenLine.js.
  markRead: (id) => api.post(`/open-line/conversations/${id}/read`),
  assign: (id) => api.post(`/open-line/conversations/${id}/assign`),
  // Закрытие несёт тему обращения (ver. 8.29): без неё показатели отвечают на
  // «как быстро», но не на «о чём».
  close: (id, topicId = null) => api.post(`/open-line/conversations/${id}/close`, { topicId }),
  send: (id, text) => api.post(`/open-line/conversations/${id}/messages`, { text }),

  // Файл от оператора (ver. 8.09). Заголовок обязателен, хотя границу multipart
  // в итоге проставляет браузер: у нашего экземпляра axios по умолчанию стоит
  // application/json, а с ним FormData отправился бы как JSON — то есть пустым
  // объектом вместо файла. Отсюда же и общий вид со всеми остальными
  // загрузками в этом файле.
  sendFile: (id, file, caption = '') => {
    const form = new FormData();
    form.append('file', file);
    if (caption) form.append('caption', caption);
    return api.post(`/open-line/conversations/${id}/files`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  // Справочник тем: читают все, кто на линии, правит старший оператор.
  topics: (all = false) => api.get('/open-line/topics', { params: all ? { all: 1 } : {} }),
  createTopic: (data) => api.post('/open-line/topics', data),
  updateTopic: (id, data) => api.put(`/open-line/topics/${id}`, data),

  transferTargets: (id) => api.get(`/open-line/conversations/${id}/transfer-targets`),
  transfer: (id, userId) => api.post(`/open-line/conversations/${id}/transfer`, { userId }),

  // Быстрые ответы: комплект один на сеть, правит их сам оператор.
  quickReplies: () => api.get('/open-line/quick-replies'),
  createQuickReply: (data) => api.post('/open-line/quick-replies', data),
  updateQuickReply: (id, data) => api.put(`/open-line/quick-replies/${id}`, data),
  deleteQuickReply: (id) => api.delete(`/open-line/quick-replies/${id}`),

  // Настройка линий — администратору
  lines: () => api.get('/open-line/lines'),

  // Боты: заводятся в интерфейсе, а не скриптом (ver. 8.04). Токен наружу не
  // отдаётся — только хвост и состояние вебхука у платформы.
  bots: () => api.get('/open-line/bots'),
  addBot: (data) => api.post('/open-line/bots', data),
  updateBot: (id, data) => api.put(`/open-line/bots/${id}`, data),
  deleteBot: (id) => api.delete(`/open-line/bots/${id}`),

  createLine: (data) => api.post('/open-line/lines', data),
  updateLine: (id, data) => api.put(`/open-line/lines/${id}`, data),
  deleteLine: (id) => api.delete(`/open-line/lines/${id}`),
  addOperator: (lineId, userId) => api.post(`/open-line/lines/${lineId}/operators`, { userId }),
  removeOperator: (lineId, userId) => api.delete(`/open-line/lines/${lineId}/operators/${userId}`),
  // Старший оператор линии: единственное отличие — ему виден архив обращений.
  setSenior: (lineId, userId, isSenior) =>
    api.put(`/open-line/lines/${lineId}/operators/${userId}`, { isSenior }),
  bindBot: (lineId, botId) => api.put(`/open-line/lines/${lineId}/bots/${botId}`),

  // Рейтинг сотрудников и KPI (ver. 7.99): считается по обращениям и сменам.
  stats: (params) => api.get('/open-line/stats', { params })
};

// Виджеты связи для сайтов клиник (ver. 8.06). Настройка здесь, а сам виджет
// отдаётся публичным контуром /api/widget — туда фронтенд портала не ходит.
export const siteWidgets = {
  list: () => api.get('/site-widgets'),
  sources: () => api.get('/site-widgets/sources'),
  create: (data) => api.post('/site-widgets', data),
  update: (id, data) => api.put(`/site-widgets/${id}`, data),
  remove: (id) => api.delete(`/site-widgets/${id}`)
};

// Рекламные рассылки подписчикам ботов (ver. 8.07). Отправляет не этот контур,
// а движок в процессе notifier: две тысячи сообщений идут минутами, и держать
// ради них открытым запрос значит потерять рассылку на первом же таймауте.
// Здесь только черновик, запуск и остановка.
export const broadcasts = {
  list: (kind) => api.get('/broadcasts', { params: kind ? { kind } : undefined }),
  get: (id) => api.get(`/broadcasts/${id}`),
  create: (data) => api.post('/broadcasts', data),
  update: (id, data) => api.put(`/broadcasts/${id}`, data),
  remove: (id) => api.delete(`/broadcasts/${id}`),

  // Медцентры с их ботами: медцентр без бота видно в списке, потому что это
  // настройка, а не забытая галка.
  sources: () => api.get('/broadcasts/sources'),
  audience: (medCenterIds) => api.post('/broadcasts/audience', { medCenterIds }),

  uploadImage: (id, file) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post(`/broadcasts/${id}/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  test: (id, data) => api.post(`/broadcasts/${id}/test`, data),
  start: (id) => api.post(`/broadcasts/${id}/start`),
  pause: (id) => api.post(`/broadcasts/${id}/pause`),
  schedule: (id, scheduledAt) => api.post(`/broadcasts/${id}/schedule`, { scheduledAt }),
  unschedule: (id) => api.post(`/broadcasts/${id}/unschedule`),
  copy: (id, asTemplate = false) => api.post(`/broadcasts/${id}/copy`, { asTemplate })
};

// Уведомления пациентам (ver. 7.86): шаблоны текстов и журнал отправок.
export const notifications = {
  templates: () => api.get('/notifications/templates'),
  blockedDoctors: (medCenterId) => api.get('/notifications/blocked-doctors', { params: { medCenterId } }),
  saveBlockedDoctors: (medCenterId, doctors) => api.put('/notifications/blocked-doctors', { medCenterId, doctors }),
  createTemplate: (data) => api.post('/notifications/templates', data),
  updateTemplate: (id, data) => api.put(`/notifications/templates/${id}`, data),
  deleteTemplate: (id) => api.delete(`/notifications/templates/${id}`),
  preview: (text) => api.post('/notifications/templates/preview', { text }),
  outbox: (params) => api.get('/notifications/outbox', { params }),
  // Заявки на догоняющий ИИ-звонок (ver. 8.52). Отдельно от журнала сообщений,
  // потому что отвечают на другой вопрос: не «дошло ли», а «почему не
  // позвонили», и причин не звонить больше, чем причин позвонить.
  callRequests: (params) => api.get('/notifications/call-requests', { params }),

  settings: () => api.get('/notifications/settings'),
  saveSettings: (data) => api.put('/notifications/settings', data),

  // Отличия филиала от общих настроек (ver. 8.03): свой каскад, свои тихие
  // часы, своё имя отправителя, признак «подключён к рассылке портала».
  // Предохранители: кому разрешено отправлять наружу и на какие номера
  // (ver. 8.06). Отдельно от общих настроек намеренно — снятие предохранителя
  // не должно случайно уехать вместе с сохранением формы тихих часов.
  safety: () => api.get('/notifications/safety'),
  saveSafety: (data) => api.put('/notifications/safety', data),

  branches: () => api.get('/notifications/branches'),
  saveBranch: (medCenterId, data) => api.put(`/notifications/branches/${medCenterId}`, data),

  test: (data) => api.post('/notifications/test', data),

  // Остаток на счету у Имобиса — единственная цифра о деньгах, которую их API
  // отдаёт: отчёта о расходах и прайса по каналам в нём нет.
  // Счёт у Имобиса спрашивается у филиала: с 8.25 общего счёта сети нет, у
  // каждого медцентра своя учётная запись и свой API-ключ.
  checkImobis: (medCenterId) => api.get(`/notifications/branches/${medCenterId}/imobis`)
};

// ── Почта (ver. 8.58) ──────────────────────────────────────────────────────
//
// Зеркало IMAP-ящиков сети. Ящики заводит администратор, человек получает
// доступ к готовому — своих паролей здесь никто не вводит.
export const mail = {
  // Ящики, к которым есть доступ, вместе с непрочитанными по каждому.
  accounts: () => api.get('/mail/accounts'),
  folders: (accountId) => api.get(`/mail/accounts/${accountId}/folders`),

  // Без accountId ищет по всем доступным ящикам сразу — человеку с пятью
  // ящиками это главное удобство.
  messages: (params) => api.get('/mail/messages', { params }),
  message: (id) => api.get(`/mail/messages/${id}`),
  senderLogo: (domain) => api.get('/mail/sender-logo', {
    params: { domain },
    responseType: 'blob'
  }),
  // Остальные письма той же переписки. Собираются по всем доступным ящикам:
  // письмо ушло с одного адреса, ответ пришёл на другой — для человека это одна
  // история, хотя для IMAP два разных ящика.
  thread: (id) => api.get(`/mail/messages/${id}/thread`),

  // Настоящий поиск по зеркалу. Без accountId ищет сразу по всем доступным
  // ящикам — в IMAP такого запроса не существует в принципе, там поиск живёт
  // внутри одной папки одного ящика, и ровно ради этого модуль и затевался.
  search: (params) => api.get('/mail/search', { params }),
  // Только разбор строки, без обращения к письмам: подсказка под полем должна
  // показывать, что поиск понял, пока человек ещё печатает.
  parseQuery: (q) => api.get('/mail/search/parse', { params: { q } }),

  // Черновики. Ответ и пересылка заполняются на сервере: получатели, тема с
  // приставкой и цитата должны выглядеть одинаково у всех, а не так, как сумел
  // собрать конкретный браузер.
  drafts: () => api.get('/mail/drafts'),
  createDraft: (data) => api.post('/mail/drafts', data),
  saveDraft: (id, data) => api.put(`/mail/drafts/${id}`, data),
  removeDraft: (id) => api.delete(`/mail/drafts/${id}`),
  sendDraft: (id) => api.post(`/mail/drafts/${id}/send`),
  // Суточный предел отправки: у reg.ru он общий с модулем рассылок, и упереться
  // в него значит остаться без исходящей почты до утра.
  quota: (accountId) => api.get('/mail/quota', { params: { accountId } }),

  attachToDraft: (id, file) => {
    const form = new FormData();
    form.append('file', file);
    // Заголовок обязателен, хотя границу multipart проставляет браузер: у
    // нашего экземпляра axios по умолчанию стоит application/json, и с ним
    // FormData уехала бы пустым объектом.
    return api.post(`/mail/drafts/${id}/attachments`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  detachFromDraft: (id, attachmentId) => api.delete(`/mail/drafts/${id}/attachments/${attachmentId}`),

  savedSearches: () => api.get('/mail/saved-searches'),
  saveSearch: (data) => api.post('/mail/saved-searches', data),
  removeSearch: (id) => api.delete(`/mail/saved-searches/${id}`),

  // Отметка уходит на сервер через очередь, а не сразу: соединений с reg.ru
  // мало, и ждать свободного внутри запроса значит подвесить интерфейс.
  setFlag: (id, op) => api.post(`/mail/messages/${id}/flags`, { op }),
  setTaken: (id, taken) => api.post(`/mail/messages/${id}/taken`, { taken }),

  // Удаление настоящее: письмо уезжает в «Корзину» на reg.ru и пропадает у всех,
  // включая тех, кто работает через Roundcube. Отдельное право, отдельный
  // вопрос человеку и запись в журнале.
  removeMessage: (id) => api.delete(`/mail/messages/${id}`),

  // Авторизация живёт в заголовке axios; обычная ссылка не передаёт токен.
  attachment: (messageId, attachmentId) => api.get(
    `/mail/messages/${messageId}/attachments/${attachmentId}`, { responseType: 'blob' }
  ),
  attachmentPreview: (messageId, attachmentId) => api.get(
    `/mail/messages/${messageId}/attachments/${attachmentId}/preview`, { responseType: 'blob' }
  ),
  refreshFolders: (accountId) => api.post(`/mail/accounts/${accountId}/folders/refresh`),
  createFolder: (accountId, data) => api.post(`/mail/accounts/${accountId}/folders`, data),
  updateFolderRules: (folderId, data) => api.put(`/mail/folders/${folderId}/rules`, data),
  deleteFolder: (folderId) => api.delete(`/mail/folders/${folderId}`),
  moveMessage: (id, folderId) => api.post(`/mail/messages/${id}/move`, { folderId }),

  admin: {
    accounts: () => api.get('/mail/admin/accounts'),
    accessOptions: () => api.get('/mail/admin/access-options'),
    create: (data) => api.post('/mail/admin/accounts', data),
    update: (id, data) => api.put(`/mail/admin/accounts/${id}`, data),
    remove: (id) => api.delete(`/mail/admin/accounts/${id}`),
    // Проверка отвечает 200 и при отказе сервера: опечатка в пароле — это
    // рабочий ответ формы, а не сбой портала, и админу надо видеть, какой
    // именно отказ пришёл от reg.ru.
    test: (id) => api.post(`/mail/admin/accounts/${id}/test`),
    sync: (id) => api.post(`/mail/admin/accounts/${id}/sync`),
    grant: (id, data) => api.post(`/mail/admin/accounts/${id}/access`, data),
    revoke: (id, userId) => api.delete(`/mail/admin/accounts/${id}/access/${userId}`),
    saveAccessRule: (id, data) => api.post(`/mail/admin/accounts/${id}/access-rules`, data),
    revokeAccessRule: (id, ruleId) => api.delete(`/mail/admin/accounts/${id}/access-rules/${ruleId}`),
    audit: (params) => api.get('/mail/admin/audit', { params })
  }
};
