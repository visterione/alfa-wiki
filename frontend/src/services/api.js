import axios from 'axios';

// Динамическое определение API URL
const getBaseUrl = () => {
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }
  // В Tauri production hostname = 'tauri.localhost', а не 'localhost'
  // Поэтому для desktop-приложения всегда явно используем localhost
  const isTauriApp = typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
  if (isTauriApp) {
    return 'http://localhost:9001';
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
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  getMedCenters: () => api.get('/users/medcenters/list')
};

// Roles
export const roles = {
  list: () => api.get('/roles'),
  get: (id) => api.get(`/roles/${id}`),
  create: (data) => api.post('/roles', data),
  update: (id, data) => api.put(`/roles/${id}`, data),
  delete: (id) => api.delete(`/roles/${id}`)
};

// Pages
export const pages = {
  list: (params) => api.get('/pages', { params }),
  get: (identifier) => api.get(`/pages/${identifier}`),
  create: (data) => api.post('/pages', data),
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

// Folders
export const folders = {
  browse: (parentId) => api.get('/folders/browse', { params: { parentId } }),
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
  getUsers: () => api.get('/chat/users'),
  getBots: () => api.get('/chat/bots'),
  sendMessage: (chatId, content, attachments = []) => {
    const type = attachments.length > 0 
      ? (attachments.every(a => a.mimeType?.startsWith('image/')) ? 'image' : 'file')
      : 'text';
    return api.post(`/chat/${chatId}/messages`, { content, type, attachments });
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
  
  addMember: (chatId, userId) => api.post(`/chat/${chatId}/members`, { userId }),
  removeMember: (chatId, userId) => api.delete(`/chat/${chatId}/members/${userId}`),
  leave: (chatId) => api.delete(`/chat/${chatId}/leave`),
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
  hideChat: (chatId, hidden = true) => api.patch(`/chat/${chatId}/hide`, { hidden }),

  // Message reactions
  addReaction: (chatId, messageId, emoji) => api.post(`/chat/${chatId}/messages/${messageId}/reactions`, { emoji }),
  removeReaction: (chatId, messageId) => api.delete(`/chat/${chatId}/messages/${messageId}/reactions`),
  getReactionDetails: (chatId, messageId) => api.get(`/chat/${chatId}/messages/${messageId}/reactions`),

  // Forward messages
  forwardMessages: (targetChatId, messageIds) => api.post('/chat/forward', { targetChatId, messageIds })
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

// Kanban
export const kanban = {
  // === BOARDS ===
  // Получить все доски пользователя
  getBoards: () => api.get('/kanban/boards'),

  // Получить конкретную доску
  getBoard: (id) => api.get(`/kanban/boards/${id}`),

  // Создать новую доску
  createBoard: (data) => api.post('/kanban/boards', data),

  // Обновить доску
  updateBoard: (id, data) => api.put(`/kanban/boards/${id}`, data),

  // Удалить доску
  deleteBoard: (id) => api.delete(`/kanban/boards/${id}`),

  // === BOARD PERMISSIONS ===
  // Получить разрешения доски
  getBoardPermissions: (boardId) => api.get(`/kanban/boards/${boardId}/permissions`),

  // Добавить пользователя к доске
  addBoardPermission: (boardId, data) => api.post(`/kanban/boards/${boardId}/permissions`, data),

  // Изменить роль пользователя
  updateBoardPermission: (boardId, permId, data) => api.put(`/kanban/boards/${boardId}/permissions/${permId}`, data),

  // Удалить доступ пользователя
  deleteBoardPermission: (boardId, permId) => api.delete(`/kanban/boards/${boardId}/permissions/${permId}`),

  // === TASKS ===
  // Получить все задачи конкретной доски
  getTasks: (boardId) => api.get(`/kanban/tasks?boardId=${boardId}`),

  // Получить одну задачу
  getTask: (id) => api.get(`/kanban/tasks/${id}`),

  // Создать задачу
  createTask: (data) => api.post('/kanban/tasks', data),

  // Обновить задачу
  updateTask: (id, data) => api.put(`/kanban/tasks/${id}`, data),

  // Удалить задачу
  deleteTask: (id) => api.delete(`/kanban/tasks/${id}`),

  // Переместить задачу
  moveTask: (id, status, sortOrder) => api.post(`/kanban/tasks/${id}/move`, { status, sortOrder }),

  // Архивировать задачу вручную
  archiveTask: (id) => api.post(`/kanban/tasks/${id}/archive`),

  // === FILES ===
  // Загрузить файл
  uploadFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/kanban/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  // Удалить файл
  deleteFile: (fileId, taskId) => api.delete(`/kanban/files/${fileId}?taskId=${taskId}`),

  // === ARCHIVE ===
  // Получить архивные задачи конкретной доски
  getArchive: (boardId) => api.get(`/kanban/archive?boardId=${boardId}`),

  // Восстановить задачу из архива
  restoreTask: (id) => api.post(`/kanban/tasks/${id}/restore`),

  // === LEGACY ===
  // Проверить доступ текущего пользователя (устарело)
  checkAccess: () => api.get('/kanban/check-access')
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
  moveReview: (id, status, sortOrder) => api.post(`/reviews/${id}/move`, { status, sortOrder }),
  assignReview: (id, assigneeIds) => api.post(`/reviews/${id}/assign`, { assigneeIds }),
  addComment: (id, data) => api.post(`/reviews/${id}/comment`, data),
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
  runSyncProvider: (boardId, provider) => api.post(`/reviews/sync/run/${boardId}/${provider}`)
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

export const referralBonusAccess = {
  getUsers: () => api.get('/referral-bonuses/permissions/users'),
  saveUserPerm: (userId, data) => api.put(`/referral-bonuses/permissions/${userId}`, data),
};

// === REFERRAL BONUSES MODULE ===
export const referralBonuses = {
  getByDoctor: (misUserId) => api.get('/referral-bonuses', { params: { misUserId } }),
  getByService: (serviceCode) => api.get('/referral-bonuses/by-service', { params: { serviceCode } }),
  save: (data) => api.post('/referral-bonuses', data),
  saveBulk: (data) => api.post('/referral-bonuses/bulk', data),
  delete: (id) => api.delete(`/referral-bonuses/${id}`),
  getMyPermissions: () => api.get('/referral-bonuses/permissions/my'),
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
};

export const salaryRecords = {
  getByDoctor: (misUserId) => api.get('/salary-records', { params: { misUserId } }),
  getAssistanceIncome: (params) => api.get('/salary-records/assistance-income', { params }),
  create: (data) => api.post('/salary-records', data),
  delete: (id) => api.delete(`/salary-records/${id}`),
  downloadExcel: (id) => api.get(`/salary-records/${id}/excel`, { responseType: 'blob' }),
};

export const mis = {
  getClinics: () => api.get('/mis/clinics'),
  getDoctors: (data) => api.post('/mis/doctors', data),
  getServices: (params) => api.get('/mis/services', { params }),
  getDoctorInfo: (userId) => api.post('/mis/doctor-info', { userId }),
  getServicesByIds: (serviceIds) => api.post('/mis/services', { service_ids: serviceIds, show_all: true }),
  getServiceCategories: () => api.post('/mis/get-service-categories', {}),
  getServicesByCategory: (categoryId) => api.post('/mis/get-services', { category_id: categoryId, show_children: true }),
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

export default api;