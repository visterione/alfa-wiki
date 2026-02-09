import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  Plus, Settings, ArrowLeft, Star, Calendar, User, Paperclip,
  X, Search, Filter, Download, MessageSquare, BarChart2, Archive,
  Clock, ChevronDown, Check, Users as UsersIcon
} from 'lucide-react';
import { reviews, users } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  REVIEW_STATUSES,
  DECISION_CATEGORIES,
  getStatusLabel,
  getStatusColor,
  getRatingStars,
  getCategoryLabel,
  HISTORY_ACTION_LABELS
} from '../utils/reviewConstants';
import toast from 'react-hot-toast';
import './ReviewBoard.css';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:9001';

const ReviewBoard = () => {
  const { id: boardId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [board, setBoard] = useState(null);
  const [reviewsList, setReviewsList] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState({ canRead: false, canWrite: false });

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [selectedReview, setSelectedReview] = useState(null);
  const [editingReview, setEditingReview] = useState(null);

  // Form states
  const [formData, setFormData] = useState({
    patientName: '',
    reviewDate: new Date().toISOString().split('T')[0],
    platformId: '',
    doctorName: '',
    rating: 5,
    reviewText: '',
    additionalInfo: '',
    attachments: []
  });

  const [finalizeData, setFinalizeData] = useState({
    decisionCategory: '',
    decisionDescription: ''
  });

  // Filters
  const [filters, setFilters] = useState({
    platform: null,
    rating: null,
    doctor: ''
  });
  const [showFilters, setShowFilters] = useState(false);

  // Comment form
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Assignment
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [selectedAssignees, setSelectedAssignees] = useState([]);

  // Doctor autocomplete
  const [doctorSuggestions, setDoctorSuggestions] = useState([]);
  const [showDoctorSuggestions, setShowDoctorSuggestions] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const [boardRes, reviewsRes, platformsRes, usersRes] = await Promise.all([
        reviews.getBoard(boardId),
        reviews.getReviews(boardId),
        reviews.getPlatforms(),
        users.listBasic()
      ]);

      setBoard(boardRes.data);
      setReviewsList(reviewsRes.data);
      setPlatforms(platformsRes.data);
      setUsersList(usersRes.data);

      const userRole = boardRes.data.userRole;
      setAccess({
        canRead: true,
        canWrite: userRole === 'owner' || userRole === 'editor'
      });

      if (platformsRes.data.length > 0 && !formData.platformId) {
        setFormData(prev => ({ ...prev, platformId: platformsRes.data[0].id }));
      }
    } catch (err) {
      console.error('Error loading data:', err);
      toast.error('Ошибка при загрузке данных');
      if (err.response?.status === 403 || err.response?.status === 404) {
        navigate('/reviews');
      }
    } finally {
      setLoading(false);
    }
  }, [boardId, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Get reviews by status column
  const getReviewsByColumn = (columnId) => {
    return reviewsList
      .filter(r => r.status === columnId)
      .filter(r => {
        if (filters.platform && r.platformId !== filters.platform) return false;
        if (filters.rating && r.rating !== parseInt(filters.rating)) return false;
        if (filters.doctor && !r.doctorName?.toLowerCase().includes(filters.doctor.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  };

  // Drag and drop handler
  const handleDragEnd = async (result) => {
    if (!result.destination || !access.canWrite) return;

    const { draggableId, source, destination } = result;

    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    const reviewId = draggableId;
    const newStatus = destination.droppableId;
    const newSortOrder = destination.index;

    // Optimistic update
    setReviewsList(prevReviews => {
      return prevReviews.map(review =>
        review.id === reviewId
          ? { ...review, status: newStatus, sortOrder: newSortOrder }
          : review
      );
    });

    try {
      await reviews.moveReview(reviewId, newStatus, newSortOrder);

      // If moving to request_info, show assignment modal
      if (newStatus === 'request_info') {
        const review = reviewsList.find(r => r.id === reviewId);
        if (review) {
          setSelectedReview(review);
          setSelectedAssignees(review.assigneeIds || []);
          setShowAssignModal(true);
        }
      }

      toast.success('Отзыв перемещён');
    } catch (err) {
      console.error('Error moving review:', err);
      toast.error('Ошибка при перемещении');
      loadData();
    }
  };

  // Create/Edit review
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.patientName.trim() || !formData.reviewText.trim()) {
      toast.error('Заполните обязательные поля');
      return;
    }

    try {
      if (editingReview) {
        const response = await reviews.updateReview(editingReview.id, formData);
        setReviewsList(prev => prev.map(r => r.id === editingReview.id ? response.data : r));
        toast.success('Отзыв обновлён');
      } else {
        const response = await reviews.createReview({ ...formData, boardId });
        setReviewsList(prev => [...prev, response.data]);
        toast.success('Отзыв создан');
      }

      closeCreateModal();
    } catch (err) {
      console.error('Error saving review:', err);
      toast.error(err.response?.data?.error || 'Ошибка при сохранении');
    }
  };

  const openCreateModal = (review = null) => {
    if (review) {
      setEditingReview(review);
      setFormData({
        patientName: review.patientName,
        reviewDate: review.reviewDate,
        platformId: review.platformId,
        doctorName: review.doctorName || '',
        rating: review.rating,
        reviewText: review.reviewText,
        additionalInfo: review.additionalInfo || '',
        attachments: review.attachments || []
      });
    } else {
      setEditingReview(null);
      setFormData({
        patientName: '',
        reviewDate: new Date().toISOString().split('T')[0],
        platformId: platforms[0]?.id || '',
        doctorName: '',
        rating: 5,
        reviewText: '',
        additionalInfo: '',
        attachments: []
      });
    }
    setShowCreateModal(true);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setEditingReview(null);
    setFormData({
      patientName: '',
      reviewDate: new Date().toISOString().split('T')[0],
      platformId: platforms[0]?.id || '',
      doctorName: '',
      rating: 5,
      reviewText: '',
      additionalInfo: '',
      attachments: []
    });
  };

  // View review details
  const openDetailsModal = async (review) => {
    try {
      const response = await reviews.getReview(review.id);
      setSelectedReview(response.data);
      setShowDetailsModal(true);
    } catch (err) {
      console.error('Error loading review details:', err);
      toast.error('Ошибка при загрузке деталей');
    }
  };

  // Finalize review
  const openFinalizeModal = (review) => {
    setSelectedReview(review);
    setFinalizeData({ decisionCategory: '', decisionDescription: '' });
    setShowFinalizeModal(true);
  };

  const handleFinalize = async (e) => {
    e.preventDefault();

    if (!finalizeData.decisionCategory) {
      toast.error('Выберите категорию решения');
      return;
    }

    try {
      const response = await reviews.finalizeReview(selectedReview.id, finalizeData);
      setReviewsList(prev => prev.map(r => r.id === selectedReview.id ? response.data : r));
      setShowFinalizeModal(false);
      toast.success('Отзыв финализирован');
    } catch (err) {
      console.error('Error finalizing review:', err);
      toast.error(err.response?.data?.error || 'Ошибка при финализации');
    }
  };

  // Add comment
  const handleAddComment = async () => {
    if (!commentText.trim()) return;

    try {
      setSubmittingComment(true);
      await reviews.addComment(selectedReview.id, { comment: commentText });

      // Reload review details
      const response = await reviews.getReview(selectedReview.id);
      setSelectedReview(response.data);

      setCommentText('');
      toast.success('Комментарий добавлен');
    } catch (err) {
      console.error('Error adding comment:', err);
      toast.error('Ошибка при добавлении комментария');
    } finally {
      setSubmittingComment(false);
    }
  };

  // Assignment
  const handleAssign = async () => {
    try {
      const response = await reviews.assignReview(selectedReview.id, selectedAssignees);
      setReviewsList(prev => prev.map(r => r.id === selectedReview.id ? response.data : r));
      setShowAssignModal(false);
      toast.success('Ответственные назначены');
    } catch (err) {
      console.error('Error assigning:', err);
      toast.error('Ошибка при назначении');
    }
  };

  const toggleAssignee = (userId) => {
    setSelectedAssignees(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  // Archive review
  const handleArchive = async (reviewId) => {
    if (!window.confirm('Архивировать отзыв?')) return;

    try {
      await reviews.archiveReview(reviewId);
      setReviewsList(prev => prev.filter(r => r.id !== reviewId));
      toast.success('Отзыв архивирован');
    } catch (err) {
      console.error('Error archiving:', err);
      toast.error('Ошибка при архивации');
    }
  };

  // Doctor autocomplete
  const handleDoctorInputChange = async (value) => {
    setFormData(prev => ({ ...prev, doctorName: value }));

    if (value.length >= 2) {
      try {
        const response = await reviews.suggestDoctors(value);
        setDoctorSuggestions(response.data);
        setShowDoctorSuggestions(true);
      } catch (err) {
        console.error('Error fetching doctor suggestions:', err);
      }
    } else {
      setDoctorSuggestions([]);
      setShowDoctorSuggestions(false);
    }
  };

  // File upload
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const response = await reviews.uploadFile(file);
      setFormData(prev => ({
        ...prev,
        attachments: [...prev.attachments, response.data]
      }));
      toast.success('Файл загружен');
    } catch (err) {
      console.error('Error uploading file:', err);
      toast.error('Ошибка при загрузке файла');
    }
    e.target.value = '';
  };

  const removeAttachment = (fileId) => {
    setFormData(prev => ({
      ...prev,
      attachments: prev.attachments.filter(f => f.id !== fileId)
    }));
  };

  // Download PDF
  const handleDownloadPdf = async (review) => {
    try {
      const response = await reviews.getReviewPdf(review.id);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `review-${review.id}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading PDF:', err);
      toast.error('Ошибка при скачивании PDF');
    }
  };

  const getAvatarUrl = (avatarPath) => {
    if (!avatarPath) return null;
    if (avatarPath.startsWith('http')) return avatarPath;
    return `${BASE_URL}/${avatarPath}`;
  };

  const clearFilters = () => {
    setFilters({ platform: null, rating: null, doctor: '' });
  };

  const hasActiveFilters = filters.platform || filters.rating || filters.doctor;

  if (loading) {
    return (
      <div className="review-board-loading">
        <div className="loading-spinner" />
        <p>Загрузка доски...</p>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="review-board-error">
        <p>Доска не найдена</p>
        <button onClick={() => navigate('/reviews')}>К списку досок</button>
      </div>
    );
  }

  return (
    <div className="review-board-page">
      {/* Header */}
      <div className="review-board-header">
        <div className="header-left">
          <button className="btn-back" onClick={() => navigate('/reviews')}>
            <ArrowLeft size={20} />
          </button>
          <div className="header-info">
            <h1>{board.name}</h1>
            {board.description && <p>{board.description}</p>}
          </div>
        </div>
        <div className="header-actions">
          <button
            className={`btn-filter ${showFilters ? 'active' : ''} ${hasActiveFilters ? 'has-filters' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={18} />
            Фильтры
          </button>
          <button
            className="btn-stats"
            onClick={() => navigate(`/reviews/board/${boardId}/stats`)}
          >
            <BarChart2 size={18} />
            Статистика
          </button>
          {board.userRole === 'owner' && (
            <button
              className="btn-settings"
              onClick={() => navigate(`/reviews/board/${boardId}/settings`)}
            >
              <Settings size={18} />
            </button>
          )}
          {access.canWrite && (
            <button className="btn-create" onClick={() => openCreateModal()}>
              <Plus size={18} />
              Новый отзыв
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="review-board-filters">
          <div className="filter-group">
            <label>Площадка</label>
            <select
              value={filters.platform || ''}
              onChange={(e) => setFilters(prev => ({ ...prev, platform: e.target.value || null }))}
            >
              <option value="">Все</option>
              {platforms.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Оценка</label>
            <select
              value={filters.rating || ''}
              onChange={(e) => setFilters(prev => ({ ...prev, rating: e.target.value || null }))}
            >
              <option value="">Все</option>
              {[5, 4, 3, 2, 1].map(r => (
                <option key={r} value={r}>{r} {getRatingStars(r)}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Врач</label>
            <input
              type="text"
              placeholder="Поиск по врачу..."
              value={filters.doctor}
              onChange={(e) => setFilters(prev => ({ ...prev, doctor: e.target.value }))}
            />
          </div>
          {hasActiveFilters && (
            <button className="btn-clear-filters" onClick={clearFilters}>
              Сбросить
            </button>
          )}
        </div>
      )}

      {/* Kanban Board */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="review-board-columns">
          {REVIEW_STATUSES.map(column => (
            <div key={column.id} className="review-column">
              <div className="column-header" style={{ borderTopColor: column.color }}>
                <h3>{column.label}</h3>
                <span className="column-count">{getReviewsByColumn(column.id).length}</span>
              </div>

              <Droppable droppableId={column.id} isDropDisabled={!access.canWrite}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`column-content ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                  >
                    {getReviewsByColumn(column.id).map((review, index) => (
                      <Draggable
                        key={review.id}
                        draggableId={review.id}
                        index={index}
                        isDragDisabled={!access.canWrite || review.status === 'final'}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`review-card ${snapshot.isDragging ? 'dragging' : ''} ${review.rating <= 3 ? 'negative' : 'positive'}`}
                            onClick={() => openDetailsModal(review)}
                          >
                            <div className="card-header">
                              <span className="patient-name">{review.patientName}</span>
                              <span className={`rating ${review.rating <= 3 ? 'negative' : 'positive'}`}>
                                {getRatingStars(review.rating)}
                              </span>
                            </div>

                            <div className="card-meta">
                              <span className="platform">{review.platform?.name}</span>
                              <span className="date">
                                <Calendar size={12} />
                                {new Date(review.reviewDate).toLocaleDateString('ru-RU')}
                              </span>
                            </div>

                            {review.doctorName && (
                              <div className="card-doctor">
                                <User size={12} />
                                {review.doctorName}
                              </div>
                            )}

                            <p className="card-text">{review.reviewText}</p>

                            <div className="card-footer">
                              {review.assignees && review.assignees.length > 0 && (
                                <div className="card-assignees">
                                  {review.assignees.slice(0, 3).map((assignee, idx) => (
                                    <div
                                      key={assignee.id}
                                      className="assignee-avatar"
                                      title={assignee.displayName || assignee.username}
                                    >
                                      {getAvatarUrl(assignee.avatar) ? (
                                        <img src={getAvatarUrl(assignee.avatar)} alt="" />
                                      ) : (
                                        <span>{(assignee.displayName || assignee.username).substring(0, 2).toUpperCase()}</span>
                                      )}
                                    </div>
                                  ))}
                                  {review.assignees.length > 3 && (
                                    <div className="assignee-avatar more">+{review.assignees.length - 3}</div>
                                  )}
                                </div>
                              )}

                              {review.attachments && review.attachments.length > 0 && (
                                <div className="card-attachments">
                                  <Paperclip size={12} />
                                  {review.attachments.length}
                                </div>
                              )}

                              {review.reportPdfPath && (
                                <button
                                  className="btn-pdf"
                                  onClick={(e) => { e.stopPropagation(); handleDownloadPdf(review); }}
                                  title="Скачать PDF"
                                >
                                  <Download size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={closeCreateModal}>
          <div className="modal-content review-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingReview ? 'Редактировать отзыв' : 'Новый отзыв'}</h2>
              <button className="btn-close" onClick={closeCreateModal}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="review-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Имя пациента *</label>
                  <input
                    type="text"
                    value={formData.patientName}
                    onChange={(e) => setFormData(prev => ({ ...prev, patientName: e.target.value }))}
                    placeholder="ФИО пациента"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Дата отзыва *</label>
                  <input
                    type="date"
                    value={formData.reviewDate}
                    onChange={(e) => setFormData(prev => ({ ...prev, reviewDate: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Площадка *</label>
                  <select
                    value={formData.platformId}
                    onChange={(e) => setFormData(prev => ({ ...prev, platformId: e.target.value }))}
                    required
                  >
                    {platforms.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Оценка *</label>
                  <div className="rating-selector stars">
                    {[1, 2, 3, 4, 5].map(r => (
                      <button
                        key={r}
                        type="button"
                        className={`rating-star-btn ${formData.rating >= r ? 'filled' : ''}`}
                        onClick={() => setFormData(prev => ({ ...prev, rating: r }))}
                        title={`${r} из 5`}
                      >
                        <Star size={28} fill={formData.rating >= r ? '#f59e0b' : 'none'} color={formData.rating >= r ? '#f59e0b' : '#d1d5db'} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="form-group doctor-group">
                <label>Врач</label>
                <input
                  type="text"
                  value={formData.doctorName}
                  onChange={(e) => handleDoctorInputChange(e.target.value)}
                  onBlur={() => setTimeout(() => setShowDoctorSuggestions(false), 200)}
                  placeholder="ФИО врача (необязательно)"
                />
                {showDoctorSuggestions && doctorSuggestions.length > 0 && (
                  <div className="doctor-suggestions">
                    {doctorSuggestions.map((doc, idx) => (
                      <div
                        key={idx}
                        className="suggestion-item"
                        onClick={() => {
                          setFormData(prev => ({ ...prev, doctorName: doc }));
                          setShowDoctorSuggestions(false);
                        }}
                      >
                        {doc}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Текст отзыва *</label>
                <textarea
                  value={formData.reviewText}
                  onChange={(e) => setFormData(prev => ({ ...prev, reviewText: e.target.value }))}
                  placeholder="Текст отзыва пациента"
                  rows={4}
                  required
                />
              </div>

              <div className="form-group">
                <label>Дополнительная информация</label>
                <textarea
                  value={formData.additionalInfo}
                  onChange={(e) => setFormData(prev => ({ ...prev, additionalInfo: e.target.value }))}
                  placeholder="Дополнительные сведения (необязательно)"
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label>Вложения</label>
                <div className="attachments-section">
                  <input
                    type="file"
                    id="file-upload"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                  <label htmlFor="file-upload" className="btn-upload">
                    <Plus size={16} />
                    Добавить файл
                  </label>

                  {formData.attachments.length > 0 && (
                    <div className="attachments-list">
                      {formData.attachments.map(file => (
                        <div key={file.id} className="attachment-item">
                          <Paperclip size={14} />
                          <span>{file.filename}</span>
                          <button type="button" onClick={() => removeAttachment(file.id)}>
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={closeCreateModal}>
                  Отмена
                </button>
                <button type="submit" className="btn-submit">
                  {editingReview ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Details Modal */}
      {showDetailsModal && selectedReview && (
        <div className="modal-overlay" onClick={() => setShowDetailsModal(false)}>
          <div className="modal-content details-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Детали отзыва</h2>
              <div className="header-actions">
                {access.canWrite && selectedReview.status !== 'final' && (
                  <>
                    <button className="btn-edit" onClick={() => { setShowDetailsModal(false); openCreateModal(selectedReview); }}>
                      Редактировать
                    </button>
                    {selectedReview.status === 'verification_done' && (
                      <button className="btn-finalize" onClick={() => { setShowDetailsModal(false); openFinalizeModal(selectedReview); }}>
                        Финализировать
                      </button>
                    )}
                  </>
                )}
                <button className="btn-close" onClick={() => setShowDetailsModal(false)}>
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="details-content">
              <div className="details-main">
                <div className="detail-row">
                  <span className="label">Пациент:</span>
                  <span className="value">{selectedReview.patientName}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Дата:</span>
                  <span className="value">{new Date(selectedReview.reviewDate).toLocaleDateString('ru-RU')}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Площадка:</span>
                  <span className="value">{selectedReview.platform?.name}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Оценка:</span>
                  <span className={`value rating ${selectedReview.rating <= 3 ? 'negative' : 'positive'}`}>
                    {selectedReview.rating}/5 {getRatingStars(selectedReview.rating)}
                  </span>
                </div>
                {selectedReview.doctorName && (
                  <div className="detail-row">
                    <span className="label">Врач:</span>
                    <span className="value">{selectedReview.doctorName}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="label">Статус:</span>
                  <span className="value status" style={{ color: getStatusColor(selectedReview.status) }}>
                    {getStatusLabel(selectedReview.status)}
                  </span>
                </div>

                <div className="detail-section">
                  <h4>Текст отзыва</h4>
                  <p>{selectedReview.reviewText}</p>
                </div>

                {selectedReview.additionalInfo && (
                  <div className="detail-section">
                    <h4>Дополнительная информация</h4>
                    <p>{selectedReview.additionalInfo}</p>
                  </div>
                )}

                {selectedReview.decisionCategory && (
                  <div className="detail-section decision">
                    <h4>Принятое решение</h4>
                    <p><strong>Категория:</strong> {getCategoryLabel(selectedReview.decisionCategory)}</p>
                    {selectedReview.decisionDescription && (
                      <p>{selectedReview.decisionDescription}</p>
                    )}
                  </div>
                )}

                {/* Assignees */}
                {selectedReview.status === 'request_info' && access.canWrite && (
                  <div className="detail-section assignees-section">
                    <div className="section-header">
                      <h4>Назначенные</h4>
                      <button className="btn-assign" onClick={() => {
                        setSelectedAssignees(selectedReview.assigneeIds || []);
                        setShowAssignModal(true);
                      }}>
                        <UsersIcon size={14} />
                        Назначить
                      </button>
                    </div>
                    {selectedReview.assignees && selectedReview.assignees.length > 0 ? (
                      <div className="assignees-list">
                        {selectedReview.assignees.map(a => (
                          <div key={a.id} className="assignee-item">
                            {getAvatarUrl(a.avatar) ? (
                              <img src={getAvatarUrl(a.avatar)} alt="" />
                            ) : (
                              <div className="avatar-placeholder">
                                {(a.displayName || a.username).substring(0, 2).toUpperCase()}
                              </div>
                            )}
                            <span>{a.displayName || a.username}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="no-assignees">Нет назначенных</p>
                    )}
                  </div>
                )}
              </div>

              {/* History */}
              <div className="details-history">
                <h4>История</h4>
                <div className="history-timeline">
                  {selectedReview.history && selectedReview.history.map(entry => (
                    <div key={entry.id} className="history-entry">
                      <div className="entry-header">
                        <span className="entry-action">{HISTORY_ACTION_LABELS[entry.action] || entry.action}</span>
                        <span className="entry-date">
                          {new Date(entry.createdAt).toLocaleString('ru-RU')}
                        </span>
                      </div>
                      <div className="entry-user">
                        {entry.user?.displayName || entry.user?.username}
                      </div>
                      {entry.oldValue && entry.newValue && (
                        <div className="entry-change">
                          {entry.oldValue} → {entry.newValue}
                        </div>
                      )}
                      {entry.comment && (
                        <div className="entry-comment">{entry.comment}</div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add comment */}
                {access.canWrite && selectedReview.status !== 'final' && (
                  <div className="add-comment">
                    <textarea
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Добавить комментарий..."
                      rows={2}
                    />
                    <button
                      onClick={handleAddComment}
                      disabled={!commentText.trim() || submittingComment}
                    >
                      {submittingComment ? 'Отправка...' : 'Добавить'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              {access.canWrite && selectedReview.status === 'final' && (
                <button className="btn-archive" onClick={() => { handleArchive(selectedReview.id); setShowDetailsModal(false); }}>
                  <Archive size={16} />
                  Архивировать
                </button>
              )}
              {selectedReview.reportPdfPath && (
                <button className="btn-download-pdf" onClick={() => handleDownloadPdf(selectedReview)}>
                  <Download size={16} />
                  Скачать PDF
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Finalize Modal */}
      {showFinalizeModal && selectedReview && (
        <div className="modal-overlay" onClick={() => setShowFinalizeModal(false)}>
          <div className="modal-content finalize-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Финализация отзыва</h2>
              <button className="btn-close" onClick={() => setShowFinalizeModal(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleFinalize}>
              <div className="form-group">
                <label>Категория решения *</label>
                <select
                  value={finalizeData.decisionCategory}
                  onChange={(e) => setFinalizeData(prev => ({ ...prev, decisionCategory: e.target.value }))}
                  required
                >
                  <option value="">Выберите категорию</option>
                  {DECISION_CATEGORIES.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Описание решения</label>
                <textarea
                  value={finalizeData.decisionDescription}
                  onChange={(e) => setFinalizeData(prev => ({ ...prev, decisionDescription: e.target.value }))}
                  placeholder="Опишите принятое решение..."
                  rows={4}
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowFinalizeModal(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn-submit">
                  Финализировать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assignment Modal */}
      {showAssignModal && (
        <div className="modal-overlay" onClick={() => setShowAssignModal(false)}>
          <div className="modal-content assign-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Назначить ответственных</h2>
              <button className="btn-close" onClick={() => setShowAssignModal(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="assign-content">
              <div className="search-box">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Поиск пользователей..."
                  value={assigneeSearch}
                  onChange={(e) => setAssigneeSearch(e.target.value)}
                />
              </div>

              <div className="users-list">
                {usersList
                  .filter(u => {
                    const search = assigneeSearch.toLowerCase();
                    return (u.displayName || '').toLowerCase().includes(search) ||
                      (u.username || '').toLowerCase().includes(search);
                  })
                  .map(u => (
                    <label key={u.id} className="user-item">
                      <div className="user-info">
                        {getAvatarUrl(u.avatar) ? (
                          <img src={getAvatarUrl(u.avatar)} alt="" />
                        ) : (
                          <div className="avatar-placeholder">
                            {(u.displayName || u.username).substring(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span>{u.displayName || u.username}</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={selectedAssignees.includes(u.id)}
                        onChange={() => toggleAssignee(u.id)}
                      />
                    </label>
                  ))}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setShowAssignModal(false)}>
                Отмена
              </button>
              <button className="btn-submit" onClick={handleAssign}>
                Назначить ({selectedAssignees.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewBoard;
