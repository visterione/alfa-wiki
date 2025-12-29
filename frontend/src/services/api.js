import axios from 'axios';

// Динамическое определение API URL
const getBaseUrl = () => {
  // Если задана переменная окружения — используем её
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }
  
  // Иначе используем тот же хост, но порт 5000
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
    // Не редиректим на /login если мы уже на странице логина
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

// Sidebar
export const sidebar = {
  list: () => api.get('/sidebar'),
  listAll: () => api.get('/sidebar/all'),
  create: (data) => api.post('/sidebar', data),
  update: (id, data) => api.put(`/sidebar/${id}`, data),
  reorder: (items) => api.post('/sidebar/reorder', { items }),
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
  restore: (filename) => api.post(`/backup/restore/${filename}`),
  download: (filename) => `${BASE_URL}/api/backup/download/${filename}`,
  delete: (filename) => api.delete(`/backup/${filename}`)
};

// Chat
export const chat = {
  list: () => api.get('/chat'),
  getMessages: (chatId, params) => api.get(`/chat/${chatId}/messages`, { params }),
  sendMessage: (chatId, content, attachments = []) => {
    const type = attachments.length > 0 
      ? (attachments.every(a => a.mimeType?.startsWith('image/')) ? 'image' : 'file')
      : 'text';
    return api.post(`/chat/${chatId}/messages`, { content, attachments, type });
  },
  startPrivate: (userId) => api.post(`/chat/private/${userId}`),
  createGroup: (name, memberIds) => api.post('/chat/group', { name, memberIds }),
  get: (chatId) => api.get(`/chat/${chatId}`),
  addMember: (chatId, userId) => api.post(`/chat/${chatId}/members`, { userId }),
  removeMember: (chatId, userId) => api.delete(`/chat/${chatId}/members/${userId}`),
  leave: (chatId) => api.delete(`/chat/${chatId}/leave`),
  markRead: (chatId) => api.post(`/chat/${chatId}/read`),
  updateAvatar: (chatId, file) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.post(`/chat/${chatId}/avatar`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  deleteAvatar: (chatId) => api.delete(`/chat/${chatId}/avatar`)
};

export default api;