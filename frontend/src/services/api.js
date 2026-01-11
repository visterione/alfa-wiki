import axios from 'axios';

// Динамическое определение API URL
const getBaseUrl = () => {
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
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
  list: (params) => api.get('/users', { params }),
  get: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`)
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
  toggleFavorite: (id) => api.post(`/pages/${id}/favorite`)
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
  getUnreadCount: () => api.get('/chat/unread/count'),
  getMessages: (chatId, params) => api.get(`/chat/${chatId}/messages`, { params }),
  sendMessage: (chatId, content, attachments = []) => {
    const type = attachments.length > 0 
      ? (attachments.every(a => a.mimeType?.startsWith('image/')) ? 'image' : 'file')
      : 'text';
    return api.post(`/chat/${chatId}/messages`, { content, type, attachments });
  },
  markAsRead: (chatId) => api.post(`/chat/${chatId}/read`),
  
  startPrivate: (userId) => api.post(`/chat/private/${userId}`),
  
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
  deleteMessage: (chatId, messageId) => api.delete(`/chat/${chatId}/messages/${messageId}`)
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
  
  // Получить интегрированные события (аккредитации, ТО)
  getIntegratedEvents: (start, end, types) => 
    api.get('/calendar/integrated-events', { params: { start, end, types } }),
  
  // Получить предстоящие события
  getUpcoming: (days = 7) => 
    api.get('/calendar/upcoming', { params: { days } })
};

export default api;