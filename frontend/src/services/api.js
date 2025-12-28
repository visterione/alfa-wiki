import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' }
});

// Add auth token to requests
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
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
  me: () => api.get('/auth/me'),
  changePassword: (currentPassword, newPassword) => 
    api.post('/auth/change-password', { currentPassword, newPassword }),
  updateProfile: (data) => api.put('/auth/profile', data)
};

// Users
export const users = {
  list: () => api.get('/users'),
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
  uploadMultiple: (files) => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    return api.post('/media/upload-multiple', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  update: (id, data) => api.put(`/media/${id}`, data),
  delete: (id) => api.delete(`/media/${id}`)
};

// Search
export const search = {
  query: (q, type) => api.get('/search', { params: { q, type } }),
  fulltext: (q) => api.get('/search/fulltext', { params: { q } }),
  suggest: (q) => api.get('/search/suggest', { params: { q } }),
  index: (data) => api.post('/search/index', data),
  removeIndex: (entityType, entityId) => api.delete(`/search/index/${entityType}/${entityId}`)
};

// Settings
export const settings = {
  list: () => api.get('/settings'),
  get: (key) => api.get(`/settings/${key}`),
  update: (key, value) => api.put(`/settings/${key}`, { value }),
  bulkUpdate: (settings) => api.post('/settings/bulk', { settings }),
  init: () => api.post('/settings/init')
};

// Backup
export const backup = {
  list: () => api.get('/backup'),
  create: () => api.post('/backup/create'),
  download: (filename) => `${API_URL}/backup/download/${filename}`,
  delete: (filename) => api.delete(`/backup/${filename}`),
  cleanup: () => api.post('/backup/cleanup')
};

// Chat
export const chat = {
  list: () => api.get('/chat'),
  getPrivate: (userId) => api.post(`/chat/private/${userId}`),
  createGroup: (name, memberIds) => api.post('/chat/group', { name, memberIds }),
  getMessages: (chatId, params) => api.get(`/chat/${chatId}/messages`, { params }),
  sendMessage: (chatId, content, type = 'text', replyToId = null) => 
    api.post(`/chat/${chatId}/messages`, { content, type, replyToId }),
  getUsers: () => api.get('/chat/users/list'),
  addMember: (chatId, userId) => api.post(`/chat/${chatId}/members`, { userId }),
  leaveChat: (chatId) => api.delete(`/chat/${chatId}/leave`)
};

export default api;