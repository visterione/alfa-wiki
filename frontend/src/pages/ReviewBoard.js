import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  Plus, Settings, ArrowLeft, Star, Calendar, User, Paperclip,
  X, Search, Filter, Download, MessageSquare, BarChart2, Archive,
  Clock, ChevronDown, Check, Users as UsersIcon, Copy, Pencil, Send, Trash2, Reply
} from 'lucide-react';
import { reviews, users, BASE_URL } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  REVIEW_STATUSES,
  DECISION_CATEGORIES,
  REVIEW_ROLES,
  getStatusLabel,
  getStatusColor,
  getRatingStars,
  getCategoryLabel,
  HISTORY_ACTION_LABELS,
  PLATFORMS_REPLY_UNSUPPORTED,
  formatDuration,
  getStageUrgency
} from '../utils/reviewConstants';
import toast from 'react-hot-toast';
import './ReviewBoard.css';

/**
 * Проверяет, разрешён ли переход между статусами согласно workflow-сценарию.
 * Возвращает:
 *   null  — в сценарии нет ни одного triggerStatusChange нода → ограничений нет
 *   true  — переход явно разрешён одним из нодов
 *   false — нод(ы) есть, но ни один не допускает этот переход
 */
const isTransitionAllowedByWorkflow = (workflowConfig, fromStatus, toStatus, review) => {
  if (!workflowConfig) return null;
  const scenarios = Array.isArray(workflowConfig.scenarios) ? workflowConfig.scenarios : [];
  const allTriggers = [];
  for (const scenario of scenarios) {
    (scenario.nodes || []).filter(n => n.type === 'triggerStatusChange').forEach(n => allTriggers.push(n));
  }
  if (allTriggers.length === 0) return null; // сценарий не настроен → не ограничиваем

  const RATING_THRESHOLD = 4;
  for (const trigger of allTriggers) {
    const { fromStatus: tFrom = 'any', toStatus: tTo, reviewCondition = 'any' } = trigger.data || {};
    if (!tTo) continue; // нод не настроен (пустой toStatus)
    if (tTo !== toStatus) continue;
    if (tFrom !== 'any' && tFrom !== fromStatus) continue;
    if (reviewCondition === 'positive' && review.rating < RATING_THRESHOLD) continue;
    if (reviewCondition === 'negative' && review.rating >= RATING_THRESHOLD) continue;
    return true;
  }
  return null;
};

const ReviewBoard = () => {
  const { id: boardId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAdmin } = useAuth();

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
    assignee: null,
    doctor: ''
  });
  const [showFilters, setShowFilters] = useState(false);

  // Comment form
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentAttachments, setCommentAttachments] = useState([]);
  const [uploadingCommentFile, setUploadingCommentFile] = useState(false);

  // Reply to review on platform (GetLoyalty)
  const [submittingReply, setSubmittingReply] = useState(false);
  const openedReviewIdRef = useRef(null);

  // Общий «тик» для таймеров на карточках — одно обновление на всю доску раз в минуту,
  // чтобы не считать длительность посекундно на каждой карточке.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // Assignment
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [selectedAssignee, setSelectedAssignee] = useState(null);
  const [assignComment, setAssignComment] = useState('');

  // Board members (users with any board role) — для секций Kanban
  const [boardMembers, setBoardMembers] = useState([]);

  // Состояние свёрнутости секций: { 'columnId-memberId': boolean }
  const [collapsedSections, setCollapsedSections] = useState({});

  // Assignee picker (при нескольких кандидатах из workflow)
  const [pickerState, setPickerState] = useState(null);
  // pickerState: { candidates: [{id,displayName,username,avatar}], draggableId, newStatus, newSortOrder }
  const [pickerComment, setPickerComment] = useState('');
  const [selectedPickerCandidate, setSelectedPickerCandidate] = useState(null);

  // Doctor autocomplete
  const [doctorSuggestions, setDoctorSuggestions] = useState([]);
  const [showDoctorSuggestions, setShowDoctorSuggestions] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const [boardRes, reviewsRes, platformsRes, usersRes, permsRes] = await Promise.all([
        reviews.getBoard(boardId),
        reviews.getReviews(boardId),
        reviews.getPlatforms(),
        users.listBasic(),
        reviews.getBoardPermissions(boardId)
      ]);

      setBoard(boardRes.data);
      setReviewsList(reviewsRes.data);
      setPlatforms(platformsRes.data);
      setUsersList(usersRes.data);

      // Собираем участников доски из прав доступа: владелец + все редакторы
      const memberMap = {};
      if (boardRes.data.owner) {
        memberMap[boardRes.data.owner.id] = boardRes.data.owner;
      }
      permsRes.data.forEach(perm => {
        if (perm.user && (perm.role === 'editor' || perm.role === 'owner')) {
          memberMap[perm.user.id] = perm.user;
        }
      });
      setBoardMembers(Object.values(memberMap));

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

  // Highlight review card from URL param ?review=:id (e.g. from bot notification link)
  const [highlightedReviewId, setHighlightedReviewId] = useState(null);

  useEffect(() => {
    if (!board || reviewsList.length === 0) return;
    const reviewId = searchParams.get('review');
    if (!reviewId) return;
    setSearchParams({}, { replace: true });

    const exists = reviewsList.some(r => r.id === reviewId);
    if (!exists) {
      toast.error('Отзыв не найден на этой доске');
      return;
    }

    setHighlightedReviewId(reviewId);

    // Scroll to card after a short delay to let React render
    setTimeout(() => {
      const el = document.getElementById(`review-card-${reviewId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);

    // Remove highlight after 3 seconds
    setTimeout(() => setHighlightedReviewId(null), 3000);
  }, [board, reviewsList]); // eslint-disable-line

  // Сокращает полное имя до формата "Фамилия И. О."
  const abbreviateName = (fullName) => {
    if (!fullName) return fullName;
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) return fullName;
    const [lastName, ...rest] = parts;
    return `${lastName} ${rest.map(p => p[0] + '.').join(' ')}`;
  };

  // Определяет первичного ответственного из числа участников доски
  const getPrimaryAssigneeId = (review) => {
    if (!review.assigneeIds || review.assigneeIds.length === 0) return null;
    const memberIds = boardMembers.map(m => m.id);
    return review.assigneeIds.find(id => memberIds.includes(id)) ?? null;
  };

  // Фильтры по активным полям
  const applyFilters = (list) =>
    list.filter(r => {
      if (filters.platform && r.platformId !== filters.platform) return false;
      if (filters.rating === 'positive' && r.rating < 4) return false;
      if (filters.rating === 'negative' && r.rating >= 4) return false;
      if (filters.assignee && !r.assigneeIds?.includes(filters.assignee)) return false;
      if (filters.doctor && !r.doctorName?.toLowerCase().includes(filters.doctor.toLowerCase())) return false;
      return true;
    });

  // Все карточки колонки (для счётчика в хедере)
  const getReviewsByColumn = (columnId) =>
    applyFilters(reviewsList.filter(r => r.status === columnId))
      .sort((a, b) => a.sortOrder - b.sortOrder);

  // Участники колонки: фильтруем по columnSettings, текущий пользователь первый если включён
  const getColumnMembers = (columnId) => {
    const visibleIds = board?.columnSettings?.[columnId]?.visibleUserIds;
    let members = boardMembers;
    if (visibleIds && visibleIds.length > 0) {
      members = boardMembers.filter(m => visibleIds.includes(m.id));
    }
    return [...members].sort((a, b) => {
      if (a.id === user?.id) return -1;
      if (b.id === user?.id) return 1;
      return 0;
    });
  };

  // IDs участников, явно заданных для колонки (для корректного роутинга отзывов в "Без назначения")
  const getColumnVisibleMemberIds = (columnId) => {
    const members = getColumnMembers(columnId);
    return new Set(members.map(m => m.id));
  };

  const sortWithUnread = (a, b) => {
    const aUnread = hasUnreadComments(a);
    const bUnread = hasUnreadComments(b);
    if (aUnread !== bUnread) return aUnread ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  };

  // Карточки секции участника
  const getReviewsBySection = (columnId, assigneeId) =>
    applyFilters(reviewsList.filter(r => r.status === columnId))
      .filter(r => getPrimaryAssigneeId(r) === assigneeId)
      .sort(sortWithUnread);

  // Карточки "без назначения" — включает отзывы без assignee И с assignee вне видимых участников колонки
  const getUnassignedReviews = (columnId) => {
    const visibleMemberIds = getColumnVisibleMemberIds(columnId);
    return applyFilters(reviewsList.filter(r => r.status === columnId))
      .filter(r => {
        const primaryId = getPrimaryAssigneeId(r);
        return primaryId === null || !visibleMemberIds.has(primaryId);
      })
      .sort(sortWithUnread);
  };

  // Управление сворачиванием секций
  const toggleSection = (columnId, memberId) => {
    const key = `${columnId}-${memberId}`;
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const COLLAPSED_PREVIEW = 3;

  const isSectionCollapsed = (columnId, memberId) => {
    const key = `${columnId}-${memberId}`;
    if (key in collapsedSections) return collapsedSections[key];
    return true; // по умолчанию все свёрнуты
  };


  // Вычислить кандидатов на назначение из workflow-сценариев (frontend-оценка)
  const evaluateWorkflowAssignees = useCallback((review, oldStatus, newStatus) => {
    const config = board?.workflowConfig;
    if (!config) return [];
    const scenarios = Array.isArray(config.scenarios)
      ? config.scenarios
      : (config.nodes?.length ? [{ nodes: config.nodes, edges: config.edges || [] }] : []);

    const ratingThreshold = 4;
    const candidateIds = new Set();

    for (const scenario of scenarios) {
      const { nodes = [], edges = [] } = scenario;
      const triggers = nodes.filter(n => n.type === 'triggerStatusChange');

      for (const trigger of triggers) {
        const { fromStatus = 'any', toStatus, reviewCondition = 'any' } = trigger.data || {};
        if (toStatus && toStatus !== newStatus) continue;
        if (fromStatus !== 'any' && fromStatus !== oldStatus) continue;
        if (reviewCondition === 'positive' && review.rating < ratingThreshold) continue;
        if (reviewCondition === 'negative' && review.rating >= ratingThreshold) continue;

        // BFS по edges начиная с trigger
        const visited = new Set();
        const queue = [trigger.id];
        while (queue.length > 0) {
          const nodeId = queue.shift();
          if (visited.has(nodeId)) continue;
          visited.add(nodeId);
          const node = nodes.find(n => n.id === nodeId);
          if (!node) continue;
          if (node.type === 'actionAssign') {
            (node.data?.userIds || []).forEach(id => candidateIds.add(id));
          }
          edges.filter(e => e.source === nodeId).forEach(e => queue.push(e.target));
        }
      }
    }

    return Array.from(candidateIds)
      .map(id => usersList.find(u => u.id === id) || boardMembers.find(u => u.id === id))
      .filter(Boolean);
  }, [board, usersList, boardMembers]);

  // Drag and drop handlers
  const handleDragEnd = async (result) => {
    if (!result.destination || !access.canWrite) return;

    const { draggableId, source, destination } = result;

    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // droppableId: "status" или "status__userId" / "status__none" — берём только статус
    const newStatus = destination.droppableId.split('__')[0];
    const oldStatus = source.droppableId.split('__')[0];
    const newSortOrder = destination.index;

    const review = reviewsList.find(r => r.id === draggableId);
    if (!review) return;

    // Только позитивные в final
    if (newStatus === 'final' && review.rating < 4) {
      toast.error('В финальный этап можно перемещать только позитивные отзывы (★★★★+)');
      return;
    }

    // Проверяем допустимость перехода по workflow-сценарию
    if (oldStatus !== newStatus) {
      const workflowAllowed = isTransitionAllowedByWorkflow(board?.workflowConfig, oldStatus, newStatus, review);
      if (workflowAllowed === false) {
        const fromLabel = getStatusLabel(oldStatus);
        const toLabel = getStatusLabel(newStatus);
        toast.error(`Переход «${fromLabel} → ${toLabel}» не предусмотрен сценарием доски`);
        return;
      }
    }

    // Оцениваем кандидатов на назначение из workflow
    const candidates = evaluateWorkflowAssignees(review, oldStatus, newStatus);

    if (candidates.length >= 1) {
      // Показываем picker — 1 кандидат для подтверждения, 2+ для выбора
      setPickerState({ candidates, draggableId, newStatus, newSortOrder, oldStatus });
      return;
    }

    // Нет кандидатов — двигаем без назначения
    await doMoveReview(draggableId, newStatus, newSortOrder);
  };

  const doMoveReview = async (draggableId, newStatus, newSortOrder, chosenAssigneeId = null, comment = '') => {
    // Оптимистичное обновление — обновляем статус и сразу assigneeIds если выбрали
    setReviewsList(prev =>
      prev.map(r => {
        if (r.id !== draggableId) return r;
        const update = { ...r, status: newStatus, sortOrder: newSortOrder };
        if (chosenAssigneeId) {
          update.assigneeIds = [chosenAssigneeId];
        }
        return update;
      })
    );
    try {
      // Комментарий в диалоге относится к передаче исполнителю. Если отправить его
      // ещё и со сменой статуса, оба endpoint-а создадут одинаковую запись истории.
      await reviews.moveReview(draggableId, newStatus, newSortOrder);
      if (chosenAssigneeId) {
        await reviews.assignReview(draggableId, chosenAssigneeId, comment || undefined);
      }
      toast.success('Отзыв перемещён');
      loadData();
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
  const hasUnreadComments = (review) => {
    if (!review.latestCommentAt) return false;
    const key = `review_viewed_${user?.id}_${review.id}`;
    const lastViewed = localStorage.getItem(key);
    if (!lastViewed) return true;
    return new Date(review.latestCommentAt) > new Date(lastViewed);
  };

  const openDetailsModal = async (review) => {
    try {
      // Текст ответа относится только к открываемому отзыву и не должен
      // переноситься из ранее открытой карточки.
      openedReviewIdRef.current = review.id;
      setCommentText('');
      localStorage.setItem(`review_viewed_${user?.id}_${review.id}`, new Date().toISOString());
      setReviewsList(prev => prev.map(r => r.id === review.id ? { ...r, _forceRead: Date.now() } : r));
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
    if (!commentText.trim() && commentAttachments.length === 0) return;

    try {
      setSubmittingComment(true);
      await reviews.addComment(selectedReview.id, {
        comment: commentText,
        attachments: commentAttachments
      });

      const response = await reviews.getReview(selectedReview.id);
      setSelectedReview(response.data);

      setCommentText('');
      setCommentAttachments([]);
      toast.success('Комментарий добавлен');
    } catch (err) {
      console.error('Error adding comment:', err);
      toast.error('Ошибка при добавлении комментария');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleSendReply = async () => {
    if (!commentText.trim()) return;
    const reviewId = selectedReview.id;
    const sentText = commentText.trim();
    setCommentText('');
    try {
      setSubmittingReply(true);
      await reviews.replyReview(reviewId, sentText);
      const response = await reviews.getReview(reviewId);
      setSelectedReview(current => current?.id === reviewId ? response.data : current);
      toast.success('Ответ отправлен в очередь на публикацию');
    } catch (err) {
      console.error('Error sending reply:', err);
      if (openedReviewIdRef.current === reviewId) {
        setCommentText(current => current || sentText);
      }
      toast.error(err.response?.data?.error || 'Ошибка при отправке ответа');
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleCommentFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingCommentFile(true);
      const response = await reviews.uploadFile(file);
      setCommentAttachments(prev => [...prev, response.data]);
      toast.success('Файл прикреплён');
    } catch (err) {
      console.error('Error uploading file:', err);
      toast.error('Ошибка при загрузке файла');
    } finally {
      setUploadingCommentFile(false);
      e.target.value = '';
    }
  };

  // Copy review text to clipboard
  const copyReviewText = () => {
    if (!selectedReview) return;

    const date = new Date(selectedReview.reviewDate).toLocaleDateString('ru-RU');
    const lines = [
      `${selectedReview.patientName} | ${date} | ${selectedReview.rating}/5 ${getRatingStars(selectedReview.rating)}`,
      '',
      selectedReview.reviewText,
      '',
    ];
    if (selectedReview.doctorName) {
      lines.push(`Лечащий врач: ${selectedReview.doctorName}`);
    }
    lines.push(`${selectedReview.platform?.name || ''} | ${board?.name || ''}`);

    const text = lines.join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast.success('Текст отзыва скопирован'))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  };

  const fallbackCopy = (text, successMsg = 'Текст отзыва скопирован') => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      if (document.execCommand('copy')) {
        toast.success(successMsg);
      } else {
        toast.error('Не удалось скопировать');
      }
    } catch (err) {
      toast.error('Копирование не поддерживается');
    } finally {
      document.body.removeChild(textArea);
    }
  };

  const copyPatientName = () => {
    if (!selectedReview) return;
    const text = selectedReview.patientName;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast.success('Имя пациента скопировано'))
        .catch(() => fallbackCopy(text, 'Имя пациента скопировано'));
    } else {
      fallbackCopy(text, 'Имя пациента скопировано');
    }
  };

  const copyBubbleText = () => {
    if (!selectedReview) return;
    const lines = [selectedReview.reviewText];
    if (selectedReview.doctorName) {
      lines.push('');
      lines.push(`Лечащий врач: ${selectedReview.doctorName}`);
    }
    const text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast.success('Текст отзыва скопирован'))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  };

  // Assignment
  const handleAssign = async () => {
    try {
      const response = await reviews.assignReview(selectedReview.id, selectedAssignee, assignComment);
      setReviewsList(prev => prev.map(r => r.id === selectedReview.id ? response.data : r));
      setShowAssignModal(false);
      setAssignComment('');
      toast.success(selectedAssignee ? 'Ответственный назначен' : 'Назначение снято');
    } catch (err) {
      console.error('Error assigning:', err);
      toast.error('Ошибка при назначении');
    }
  };

  // Archive review
  const handleDeleteReview = async (reviewId) => {
    if (!window.confirm('Удалить отзыв? Это действие нельзя отменить.')) return;

    try {
      await reviews.deleteReview(reviewId);
      setReviewsList(prev => prev.filter(r => r.id !== reviewId));
      setShowDetailsModal(false);
      toast.success('Отзыв удалён');
    } catch (err) {
      console.error('Error deleting review:', err);
      toast.error('Ошибка при удалении');
    }
  };

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
    if (avatarPath.startsWith('http://localhost') || avatarPath.startsWith('https://localhost')) {
      const path = avatarPath.replace(/^https?:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
    if (avatarPath.startsWith('http')) return avatarPath;
    const normalised = avatarPath.startsWith('/') ? avatarPath.slice(1) : avatarPath;
    return `${BASE_URL}/${normalised}`;
  };

  const clearFilters = () => {
    setFilters({ platform: null, rating: null, assignee: null, doctor: '' });
  };

  const hasActiveFilters = filters.platform || filters.rating || filters.assignee || filters.doctor;

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
          {isAdmin && (
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
            <label>Тональность</label>
            <select
              value={filters.rating || ''}
              onChange={(e) => setFilters(prev => ({ ...prev, rating: e.target.value || null }))}
            >
              <option value="">Все</option>
              <option value="positive">Положительные</option>
              <option value="negative">Отрицательные</option>
            </select>
          </div>
          {boardMembers.length > 0 && (
            <div className="filter-group">
              <label>Исполнитель</label>
              <select
                value={filters.assignee || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, assignee: e.target.value || null }))}
              >
                <option value="">Все</option>
                {boardMembers.map(m => (
                  <option key={m.id} value={m.id}>{m.displayName || m.username}</option>
                ))}
              </select>
            </div>
          )}
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
          {REVIEW_STATUSES.map(column => {
            // Секции только для промежуточных колонок (не new, не final)
            const columnMembers = getColumnMembers(column.id);
            const useSections = boardMembers.length > 0 && column.id !== 'final' && column.id !== 'new';
            // Явно настроенные пользователи для этой колонки (показываем секцию даже если 0 карточек)
            const configuredIds = new Set(board?.columnSettings?.[column.id]?.visibleUserIds || []);

            // final принимает только позитивные отзывы — разрешаем дроп,
            // но блокируем негативные в handleDragEnd
            const isDropDisabled = !access.canWrite;

            // Все карточки колонки (для глобальной индексации при Draggable)
            const allCards = getReviewsByColumn(column.id);

            // Рендер одной карточки как Draggable
            const renderCard = (review, index) => (
              <Draggable
                key={review.id}
                draggableId={review.id}
                index={index}
                isDragDisabled={!access.canWrite || review.status === 'final' || (!isAdmin && !review.assigneeIds?.includes(user?.id))}
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    id={`review-card-${review.id}`}
                    className={`review-card ${snapshot.isDragging ? 'dragging' : ''} ${review.rating <= 3 ? 'negative' : 'positive'}${highlightedReviewId === review.id ? ' highlighted' : ''}${(!isAdmin && !review.assigneeIds?.includes(user?.id)) ? ' drag-locked' : ''}`}
                    onClick={() => openDetailsModal(review)}
                  >
                    <div className="card-header">
                      <div className="card-header-top">
                        <span className="patient-name">{review.patientName}</span>
                        <div className="card-header-right">
                          {hasUnreadComments(review) && (
                            <span className={`card-unread-badge ${review.rating <= 3 ? 'card-unread-badge--negative' : 'card-unread-badge--positive'}`} title="Есть непрочитанные комментарии">
                              <span className="card-unread-count">{review.commentCount}</span>
                              <MessageSquare size={13} className="card-unread-icon" />
                            </span>
                          )}
                          <span className={`rating ${review.rating <= 3 ? 'negative' : 'positive'}`}>
                            {getRatingStars(review.rating)}
                          </span>
                        </div>
                      </div>
                      <div className="card-meta">
                        <span className="platform">{review.platform?.name}</span>
                        <span className="date">
                          <Calendar size={12} />
                          {new Date(review.reviewDate).toLocaleDateString('ru-RU')}
                        </span>
                      </div>
                    </div>

                    {review.doctorName && (
                      <div className="card-doctor">
                        <User size={12} />
                        {review.doctorName}
                      </div>
                    )}

                    <p className="card-text">{review.reviewText}</p>

                    <div className="card-footer">
                      {review.status !== 'final' && review.stageEnteredAt && (() => {
                        const urgency = getStageUrgency(review.stageEnteredAt, nowTick);
                        return (
                          <span
                            className={`card-stage-timer card-stage-timer--${urgency.level}`}
                            title={`На этапе «${getStatusLabel(review.status)}»: ${formatDuration(review.stageEnteredAt, nowTick)} · ${urgency.label}`}
                          >
                            <Clock size={12} />
                            {formatDuration(review.stageEnteredAt, nowTick)}
                          </span>
                        );
                      })()}
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
            );

            return (
              <div key={column.id} className="review-column">
                <div className="column-header" style={{ borderTopColor: column.color }}>
                  <h3>{board?.columnNames?.[column.id] || column.label}</h3>
                  <div className="column-header-right">
                    {column.id === 'final' && (
                      <span className="column-positive-hint" title="Только позитивные отзывы">★★★★+</span>
                    )}
                    <span className="column-count">{allCards.length}</span>
                  </div>
                </div>

                {/* Один Droppable на колонку — секции внутри только визуальные */}
                <Droppable droppableId={column.id} isDropDisabled={isDropDisabled}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`column-content-wrap ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                    >
                      {useSections ? (
                        <div className="column-sections">
                          {columnMembers.map(member => {
                            const memberCards = getReviewsBySection(column.id, member.id);
                            // Скрываем секцию только если:
                            // — у участника 0 карточек И он не настроен явно для этой колонки И он не текущий пользователь
                            const isExplicitlyConfigured = configuredIds.has(member.id);
                            const isCurrentUser = member.id === user?.id;
                            if (memberCards.length === 0 && !isExplicitlyConfigured && !isCurrentUser) return null;
                            const isCollapsed = isSectionCollapsed(column.id, member.id);
                            const visibleCards = isCollapsed ? memberCards.slice(0, COLLAPSED_PREVIEW) : memberCards;
                            const hasMore = isCollapsed && memberCards.length > COLLAPSED_PREVIEW;
                            return (
                              <div key={member.id} className="person-section">
                                <div
                                  className="person-section-header person-section-header--toggle"
                                  onClick={() => toggleSection(column.id, member.id)}
                                >
                                  <div
                                    className="person-section-avatar"
                                    title="Открыть профиль"
                                    onClick={(e) => { e.stopPropagation(); navigate(`/users/${member.id}`); }}
                                  >
                                    {getAvatarUrl(member.avatar) ? (
                                      <img src={getAvatarUrl(member.avatar)} alt="" />
                                    ) : (
                                      <User size={13} />
                                    )}
                                  </div>
                                  <div className="person-section-nameblock">
                                    <span className="person-section-name">{abbreviateName(member.displayName || member.username)}</span>
                                    {board?.columnSettings?.[column.id]?.userLabels?.[member.id] && (
                                      <span className="person-section-label">{board.columnSettings[column.id].userLabels[member.id]}</span>
                                    )}
                                  </div>
                                  <span className="person-section-count">{memberCards.length}</span>
                                  {memberCards.length > 0 && (
                                    <ChevronDown
                                      size={13}
                                      className={`section-chevron ${isCollapsed ? '' : 'section-chevron--open'}`}
                                    />
                                  )}
                                </div>
                                {memberCards.length > 0 && (
                                  <div className="section-cards">
                                    {visibleCards.map(review =>
                                      renderCard(review, allCards.findIndex(c => c.id === review.id))
                                    )}
                                    {hasMore && (
                                      <div
                                        className="section-show-more"
                                        onClick={() => toggleSection(column.id, member.id)}
                                      >
                                        ещё {memberCards.length - COLLAPSED_PREVIEW}...
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {(() => {
                            const unassigned = getUnassignedReviews(column.id);
                            if (unassigned.length === 0) return null;
                            const isCollapsed = isSectionCollapsed(column.id, 'unassigned');
                            const visibleUnassigned = isCollapsed ? unassigned.slice(0, COLLAPSED_PREVIEW) : unassigned;
                            const hasMoreUnassigned = isCollapsed && unassigned.length > COLLAPSED_PREVIEW;
                            return (
                              <div className="person-section unassigned-section">
                                <div
                                  className="person-section-header person-section-header--toggle"
                                  onClick={() => toggleSection(column.id, 'unassigned')}
                                >
                                  <div className="person-section-avatar unassigned-avatar">
                                    <UsersIcon size={14} />
                                  </div>
                                  <div className="person-section-nameblock">
                                    <span className="person-section-name">Без назначения</span>
                                  </div>
                                  <span className="person-section-count">{unassigned.length}</span>
                                  <ChevronDown
                                    size={13}
                                    className={`section-chevron ${isCollapsed ? '' : 'section-chevron--open'}`}
                                  />
                                </div>
                                <div className="section-cards">
                                  {visibleUnassigned.map(review =>
                                    renderCard(review, allCards.findIndex(c => c.id === review.id))
                                  )}
                                  {hasMoreUnassigned && (
                                    <div
                                      className="section-show-more"
                                      onClick={() => toggleSection(column.id, 'unassigned')}
                                    >
                                      ещё {unassigned.length - COLLAPSED_PREVIEW}...
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      ) : (
                        allCards.map((review, index) => renderCard(review, index))
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      {/* Assignee Picker — диалог выбора при нескольких кандидатах из workflow */}
      {pickerState && (
        <div className="modal-overlay" onClick={() => { setPickerState(null); setPickerComment(''); setSelectedPickerCandidate(null); }}>
          <div className="assignee-picker-modal" onClick={e => e.stopPropagation()}>
            <div className="assignee-picker-modal__header">
              <span className="assignee-picker-modal__title">Кому передать отзыв?</span>
              <button className="assignee-picker-modal__close" onClick={() => { setPickerState(null); setPickerComment(''); setSelectedPickerCandidate(null); }}><X size={16} /></button>
            </div>
            <div className="assignee-picker-body">
              <div className="assignee-picker-list">
                {pickerState.candidates.map(candidate => (
                  <button
                    key={candidate.id}
                    className={`assignee-picker-item${selectedPickerCandidate?.id === candidate.id ? ' assignee-picker-item--selected' : ''}`}
                    onClick={() => {
                      if (selectedPickerCandidate?.id === candidate.id) {
                        setSelectedPickerCandidate(null);
                        setPickerComment('');
                      } else {
                        setSelectedPickerCandidate(candidate);
                        setPickerComment('');
                      }
                    }}
                  >
                    <div className="assignee-picker-avatar">
                      {getAvatarUrl(candidate.avatar)
                        ? <img src={getAvatarUrl(candidate.avatar)} alt="" />
                        : <User size={16} />
                      }
                    </div>
                    <span>{candidate.displayName || candidate.username}</span>
                    {selectedPickerCandidate?.id === candidate.id && <Check size={14} className="assignee-picker-item__check" />}
                  </button>
                ))}
              </div>

              <div className={`assignee-picker-confirm${selectedPickerCandidate ? ' assignee-picker-confirm--open' : ''}`}>
                <div className="assignee-picker-confirm-inner">
                  <textarea
                    className="assignee-picker-comment"
                    placeholder="Комментарий при передаче (необязательно)..."
                    value={pickerComment}
                    onChange={e => setPickerComment(e.target.value)}
                    rows={2}
                  />
                  <button
                    className="assignee-picker-submit"
                    onClick={() => {
                      doMoveReview(pickerState.draggableId, pickerState.newStatus, pickerState.newSortOrder, selectedPickerCandidate.id, pickerComment);
                      setPickerState(null);
                      setPickerComment('');
                      setSelectedPickerCandidate(null);
                    }}
                  >
                    <Check size={14} />
                    {pickerComment.trim() ? 'Назначить с комментарием' : 'Назначить'}
                  </button>
                </div>
              </div>

              <button
                className="assignee-picker-skip"
                onClick={() => {
                  doMoveReview(pickerState.draggableId, pickerState.newStatus, pickerState.newSortOrder, null, undefined);
                  setPickerState(null);
                  setPickerComment('');
                  setSelectedPickerCandidate(null);
                }}
              >
                Переместить без назначения
              </button>
            </div>
          </div>
        </div>
      )}

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
                {access.canWrite && selectedReview.status === 'verification_done' && (
                  <button className="btn-finalize" onClick={() => { setShowDetailsModal(false); openFinalizeModal(selectedReview); }}>
                    Финализировать
                  </button>
                )}
                <button className="btn-close" onClick={() => setShowDetailsModal(false)}>
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="details-content">
              <div className="details-main">
                <div className="review-message">
                  <div className="review-message-avatar">
                    <User size={22} />
                  </div>
                  <div className="review-message-content">
                    <div className="review-message-header">
                      <span className="patient-name" onClick={copyPatientName} title="Копировать имя пациента">{selectedReview.patientName}</span>
                      <span className="date">{new Date(selectedReview.reviewDate).toLocaleDateString('ru-RU')}</span>
                      <span className={`rating ${selectedReview.rating <= 3 ? 'negative' : 'positive'}`}>
                        {selectedReview.rating}/5 {getRatingStars(selectedReview.rating)}
                      </span>
                    </div>
                    <div className="review-bubble" onClick={copyBubbleText} title="Копировать текст отзыва">
                      {selectedReview.reviewText}
                    </div>
                    <div className="review-message-footer">
                      <div className="footer-info">
                        {selectedReview.doctorName && (
                          <span className="doctor-line">Лечащий врач: {selectedReview.doctorName}</span>
                        )}
                        <span className="source-line">{selectedReview.platform?.name} | {board?.name}</span>
                      </div>
                      <button className="btn-copy-inline" onClick={copyReviewText} title="Копировать текст отзыва">
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
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
                        setSelectedAssignee(selectedReview.assigneeIds?.[0] || null);
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
                                <User size={14} />
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
                  {selectedReview.history && [...selectedReview.history]
                    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
                    .map(entry => {
                      const isComment = entry.action === 'comment';
                      const date = new Date(entry.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                      const userName = entry.user?.displayName || entry.user?.username;
                      const colorByLabel = (label) => REVIEW_STATUSES.find(s => s.label === label)?.color || '#6b7280';

                      if (isComment) {
                        const avatarUrl = getAvatarUrl(entry.user?.avatar);
                        return (
                          <div key={entry.id} className="history-comment">
                            <div className="comment-avatar" style={entry.user?.id ? { cursor: 'pointer' } : {}} onClick={entry.user?.id ? () => navigate(`/users/${entry.user.id}`) : undefined}>
                              {avatarUrl
                                ? <img src={avatarUrl} alt="" />
                                : <div className="comment-avatar-placeholder"><User size={16} /></div>
                              }
                            </div>
                            <div className="comment-body">
                              <div className="history-comment-header">
                                <span className="comment-user" style={entry.user?.id ? { cursor: 'pointer' } : {}} onClick={entry.user?.id ? () => navigate(`/users/${entry.user.id}`) : undefined}>{userName}</span>
                                <span className="comment-date">{date}</span>
                              </div>
                              {entry.comment && <div className="comment-bubble">{entry.comment}</div>}
                              {entry.attachments && entry.attachments.length > 0 && (
                                <div className="comment-attachments-list">
                                  {entry.attachments.map((file, idx) => (
                                    <a
                                      key={idx}
                                      href={`${BASE_URL}/${file.path}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="comment-attachment-link"
                                    >
                                      <Paperclip size={12} />
                                      <span>{file.filename}</span>
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      }

                      let systemContent;
                      switch (entry.action) {
                        case 'created':
                          systemContent = <>Отзыв создан — {userName} | {date}</>;
                          break;
                        case 'status_change':
                          systemContent = (
                            <>
                              Статус изменён:{' '}
                              <span style={{ color: colorByLabel(entry.oldValue), fontWeight: 500 }}>{entry.oldValue}</span>
                              {' → '}
                              <span style={{ color: colorByLabel(entry.newValue), fontWeight: 600 }}>{entry.newValue}</span>
                              {' | '}{userName} | {date}
                            </>
                          );
                          break;
                        case 'assignment':
                          systemContent = <>Назначены: <strong>{entry.newValue}</strong> | {userName} | {date}</>;
                          break;
                        case 'file_upload':
                          systemContent = <>{userName} загрузил файл | {date}</>;
                          break;
                        case 'finalized':
                          systemContent = <>Отзыв финализирован: <strong>{entry.newValue}</strong> | {userName} | {date}</>;
                          break;
                        case 'replied':
                          return (
                            <div key={entry.id} className="history-comment history-reply">
                              <div className="comment-avatar" style={entry.user?.id ? { cursor: 'pointer' } : {}} onClick={entry.user?.id ? () => navigate(`/users/${entry.user.id}`) : undefined}>
                                {entry.user?.avatar
                                  ? <img src={getAvatarUrl(entry.user.avatar)} alt="" />
                                  : <div className="comment-avatar-placeholder"><Reply size={16} /></div>
                                }
                              </div>
                              <div className="comment-body">
                                <div className="history-comment-header">
                                  <span className="comment-user" style={entry.user?.id ? { cursor: 'pointer' } : {}} onClick={entry.user?.id ? () => navigate(`/users/${entry.user.id}`) : undefined}>{userName}</span>
                                  <span className="reply-badge"><Reply size={11} /> Ответ на площадке</span>
                                  <span className="comment-date">{date}</span>
                                </div>
                                {entry.comment && <div className="comment-bubble comment-bubble--reply">{entry.comment}</div>}
                              </div>
                            </div>
                          );
                        default:
                          systemContent = <>{HISTORY_ACTION_LABELS[entry.action] || entry.action} | {userName} | {date}</>;
                      }

                      return (
                        <div key={entry.id} className="history-system">
                          <span className="system-text">{systemContent}</span>
                        </div>
                      );
                    })}
                </div>

                {/* Reply to review on platform (GetLoyalty) — display only */}
                {selectedReview.externalId?.startsWith('gl_') && !PLATFORMS_REPLY_UNSUPPORTED.includes(selectedReview.platform?.name) && (() => {
                  const meta = selectedReview.syncMeta || {};
                  const platformReply = meta.replyText || null;
                  const historyReply = !platformReply
                    ? selectedReview.history?.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).find(e => e.action === 'replied')
                    : null;
                  const hasReply = !!(platformReply || historyReply);
                  if (!hasReply) return null;
                  const replyText_ = platformReply || historyReply?.comment || '';
                  const replyDate_ = platformReply
                    ? (meta.replyDate ? new Date(meta.replyDate).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null)
                    : (historyReply ? new Date(historyReply.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null);
                  const isFailed = meta.replyFailed;
                  const isUnverified = meta.replyUnverified && !isFailed;
                  const isPending = meta.replyPending && !isUnverified && !isFailed;
                  return (
                    <div className={`reply-to-platform${isFailed ? ' reply-to-platform--failed' : ''}`}>
                      <div className="reply-to-platform__header">
                        <Reply size={14} />
                        <span>Официальный ответ</span>
                        {isFailed && <span className="reply-failed-badge">Не опубликовано</span>}
                        {isUnverified && <span className="reply-pending-badge">Проверяется публикация</span>}
                        {isPending && <span className="reply-pending-badge">На модерации</span>}
                        {replyDate_ && <span className="reply-header-date">{replyDate_}</span>}
                      </div>
                      <div className="reply-sent">{replyText_}</div>
                      {isFailed && (
                        <div className="reply-failed-note">
                          Ответ не зафиксирован на площадке. Отправьте его повторно.
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Add comment */}
                {access.canWrite && selectedReview.status !== 'final' && (
                  <div className="add-comment">
                    {commentAttachments.length > 0 && (
                      <div className="comment-attachments-preview">
                        {commentAttachments.map(file => (
                          <div key={file.id} className="comment-attachment-chip">
                            <Paperclip size={12} />
                            <span>{file.filename}</span>
                            <button type="button" onClick={() => setCommentAttachments(prev => prev.filter(f => f.id !== file.id))}>
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="add-comment-row">
                      <input
                        type="file"
                        id="comment-file-input"
                        onChange={handleCommentFileUpload}
                        style={{ display: 'none' }}
                      />
                      <label htmlFor="comment-file-input" className="btn-attach" title="Прикрепить файл">
                        <Paperclip size={16} />
                      </label>
                      <textarea
                        value={commentText}
                        onChange={(e) => {
                          setCommentText(e.target.value);
                          e.target.style.height = 'auto';
                          e.target.style.height = e.target.scrollHeight + 'px';
                        }}
                        placeholder="Добавить комментарий..."
                        rows={1}
                      />
                      <button
                        onClick={handleAddComment}
                        disabled={(!commentText.trim() && commentAttachments.length === 0) || submittingComment || uploadingCommentFile}
                        title="Отправить комментарий"
                      >
                        <Send size={16} />
                      </button>
                      {isAdmin && selectedReview.externalId?.startsWith('gl_') && !PLATFORMS_REPLY_UNSUPPORTED.includes(selectedReview.platform?.name) && (
                        <button
                          onClick={handleSendReply}
                          disabled={!commentText.trim() || submittingReply}
                          title="Ответить на площадке"
                          className="btn-send-reply"
                        >
                          {submittingReply ? <Clock size={16} /> : <User size={16} />}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              {access.canWrite && selectedReview.status !== 'final' && (
                <button className="btn-edit" onClick={() => { setShowDetailsModal(false); openCreateModal(selectedReview); }}>
                  <Pencil size={16} />
                  Редактировать отзыв
                </button>
              )}
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
              {access.canWrite && (
                <button className="btn-delete-review" onClick={() => handleDeleteReview(selectedReview.id)}>
                  <Trash2 size={16} />
                  Удалить
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
              <h2>Назначить ответственного</h2>
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
                {/* Опция "Снять назначение" */}
                <div
                  className={`user-item ${selectedAssignee === null ? 'user-item--selected' : ''}`}
                  onClick={() => setSelectedAssignee(null)}
                >
                  <div className="user-info">
                    <div className="avatar-placeholder"><User size={14} /></div>
                    <span style={{ color: 'var(--text-secondary)' }}>Без назначения</span>
                  </div>
                  {selectedAssignee === null && <Check size={16} style={{ color: 'var(--primary-color, #6366f1)', flexShrink: 0 }} />}
                </div>
                {getColumnMembers(selectedReview?.status)
                  .filter(u => {
                    const search = assigneeSearch.toLowerCase();
                    return (u.displayName || '').toLowerCase().includes(search) ||
                      (u.username || '').toLowerCase().includes(search);
                  })
                  .map(u => (
                    <div
                      key={u.id}
                      className={`user-item ${selectedAssignee === u.id ? 'user-item--selected' : ''}`}
                      onClick={() => setSelectedAssignee(u.id)}
                    >
                      <div className="user-info">
                        {getAvatarUrl(u.avatar) ? (
                          <img src={getAvatarUrl(u.avatar)} alt="" />
                        ) : (
                          <div className="avatar-placeholder"><User size={14} /></div>
                        )}
                        <span>{u.displayName || u.username}</span>
                      </div>
                      {selectedAssignee === u.id && <Check size={16} style={{ color: 'var(--primary-color, #6366f1)', flexShrink: 0 }} />}
                    </div>
                  ))}
              </div>
            </div>

            <div className="assign-comment">
              <textarea
                placeholder="Комментарий при передаче (необязательно)..."
                value={assignComment}
                onChange={(e) => setAssignComment(e.target.value)}
                rows={3}
              />
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => { setShowAssignModal(false); setAssignComment(''); }}>
                Отмена
              </button>
              <button className="btn-submit" onClick={handleAssign}>
                {selectedAssignee ? 'Назначить' : 'Снять назначение'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewBoard;
