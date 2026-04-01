import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pin, PinOff, Plus, Pencil, Trash2, Search, ChevronLeft, ChevronRight,
  X, Check, Users, Building2, ArrowUpDown, User
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { announcements as announcementsApi, calendar as calendarApi, users as usersApi, roles as rolesApi } from '../services/api';
import { MiniCalendar, UpcomingEvents } from '../components/calendar';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { BASE_URL } from '../services/api';
import Editor from '../components/Editor';
import ContentRenderer from '../components/ContentRenderer';
import './Calendar.css';
import './Home.css';

const COLLAPSE_LINES = 5;
const LINE_HEIGHT_PX = 22;
const COLLAPSE_HEIGHT = COLLAPSE_LINES * LINE_HEIGHT_PX;

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function AnnouncementCard({ announcement, canEdit, onEdit, onDelete, onTogglePin }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = React.useRef(null);

  useEffect(() => {
    if (bodyRef.current) {
      setOverflows(bodyRef.current.scrollHeight > COLLAPSE_HEIGHT + 4);
    }
  }, [announcement.body]);

  const avatarSrc = announcement.author?.avatar
    ? `${BASE_URL}/${announcement.author.avatar}`
    : null;

  const authorName = announcement.author?.displayName || announcement.author?.username || 'Неизвестно';

  const formattedDate = format(new Date(announcement.createdAt), 'd MMM yyyy, HH:mm', { locale: ru });

  return (
    <div className={`announcement-card${announcement.pinned ? ' announcement-card--pinned' : ''}`}>
      {announcement.pinned && (
        <div className="announcement-pin-badge">
          <Pin size={12} /> Закреплено
        </div>
      )}
      <div className="announcement-card__header">
        <div className="announcement-card__author">
          {avatarSrc ? (
            <img src={avatarSrc} alt={authorName} className="announcement-card__avatar" />
          ) : (
            <div className="announcement-card__avatar announcement-card__avatar--placeholder">
              <User size={18} />
            </div>
          )}
          <div>
            <span className="announcement-card__author-name">{authorName}</span>
            <span className="announcement-card__date">{formattedDate}</span>
          </div>
        </div>
        {canEdit && (
          <div className="announcement-card__actions">
            <button
              className="announcement-action-btn"
              title={announcement.pinned ? 'Открепить' : 'Закрепить'}
              onClick={() => onTogglePin(announcement)}
            >
              {announcement.pinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
            <button className="announcement-action-btn" title="Редактировать" onClick={() => onEdit(announcement)}>
              <Pencil size={15} />
            </button>
            <button className="announcement-action-btn announcement-action-btn--danger" title="Удалить" onClick={() => onDelete(announcement)}>
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>

      <h3 className="announcement-card__title">{announcement.title}</h3>

      <div
        ref={bodyRef}
        className="announcement-card__body"
        style={{ maxHeight: expanded || !overflows ? 'none' : `${COLLAPSE_HEIGHT}px` }}
      >
        <ContentRenderer content={announcement.body} />
      </div>

      {overflows && (
        <button className="announcement-expand-btn" onClick={() => setExpanded(e => !e)}>
          {expanded ? 'Свернуть' : 'Читать далее'}
        </button>
      )}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <span
      className={`ann-toggle-track${checked ? ' on' : ''}`}
      onClick={e => { e.stopPropagation(); onChange(); }}
    />
  );
}

function DropdownFilter({ icon, label, items, selected, onToggle, onClose }) {
  return (
    <div className="ann-filter-dropdown" onClick={e => e.stopPropagation()}>
      <div className="ann-filter-dropdown__header">
        {label}
        <button className="ann-filter-dropdown__close" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="ann-filter-dropdown__list">
        {items.map(item => (
          <div key={item.id} className="ann-filter-dropdown__item" onClick={() => onToggle(item.id)}>
            <Toggle checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} />
            <span>{item.name}</span>
          </div>
        ))}
        {items.length === 0 && <div className="ann-filter-dropdown__empty">Нет данных</div>}
      </div>
    </div>
  );
}

function AnnouncementModal({ announcement, onClose, onSave }) {
  const [title, setTitle] = useState(announcement?.title || '');
  const [body, setBody] = useState(announcement?.body || '');
  const [targetRoles, setTargetRoles] = useState(announcement?.targetRoles || []);
  const [targetMedCenterIds, setTargetMedCenterIds] = useState(announcement?.targetMedCenterIds || []);
  const [targetUserIds, setTargetUserIds] = useState(announcement?.targetUserIds || []);
  const [rolesList, setRolesList] = useState([]);
  const [medCentersList, setMedCentersList] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [openFilter, setOpenFilter] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    rolesApi.list().then(r => setRolesList(r.data || [])).catch(() => {});
    usersApi.getMedCenters().then(r => setMedCentersList(r.data || [])).catch(() => {});
    usersApi.listBasic().then(r => setUsersList(r.data || [])).catch(() => {});
  }, []);

  // Вычисляем пользователей, подходящих под текущие фильтры (роли AND медцентры)
  const filterMatchedIds = React.useMemo(() => {
    if (targetRoles.length === 0 && targetMedCenterIds.length === 0) return new Set();
    return new Set(
      usersList.filter(u => {
        const userRoleIds = (u.roles || []).map(r => r.id);
        const userMCIds = (u.medCenters || []).map(m => m.id);
        const rolesMatch = targetRoles.length === 0 || targetRoles.some(rId => userRoleIds.includes(rId));
        const mcMatch = targetMedCenterIds.length === 0 || targetMedCenterIds.some(mId => userMCIds.includes(mId));
        return rolesMatch && mcMatch;
      }).map(u => u.id)
    );
  }, [targetRoles, targetMedCenterIds, usersList]);

  // Пользователь "выбран" если: совпадает с фильтрами ИЛИ добавлен вручную
  const isUserOn = (userId) => filterMatchedIds.has(userId) || targetUserIds.includes(userId);

  // Ручное переключение: только для пользователей вне фильтров
  const toggleUser = (userId) => {
    if (filterMatchedIds.has(userId)) return; // управляется фильтром
    setTargetUserIds(prev => prev.includes(userId) ? prev.filter(x => x !== userId) : [...prev, userId]);
  };

  const toggleRole = (id) =>
    setTargetRoles(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleMedCenter = (id) =>
    setTargetMedCenterIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Заполните заголовок');
      return;
    }
    setSaving(true);
    try {
      await onSave({ title, body, pinned: announcement?.pinned || false, targetRoles, targetMedCenterIds, targetUserIds });
      onClose();
    } catch {
      toast.error('Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  const isForAll = targetRoles.length === 0 && targetMedCenterIds.length === 0 && targetUserIds.length === 0;
  const matchedCount = filterMatchedIds.size + targetUserIds.filter(id => !filterMatchedIds.has(id)).length;

  const filteredUsers = usersList.filter(u =>
    (u.displayName || u.username || '').toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <div className="home-modal-overlay" onClick={onClose}>
      <div className="home-modal" onClick={e => { e.stopPropagation(); setOpenFilter(null); }}>
        <div className="home-modal__header">
          <h2>{announcement ? 'Редактировать объявление' : 'Новое объявление'}</h2>
          <button className="home-modal__close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="home-modal__body">
          {/* Заголовок — на всю ширину */}
          <div className="home-modal__top">
            <label className="home-modal__label">Заголовок</label>
            <input
              className="home-modal__input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Заголовок объявления"
              maxLength={255}
            />
          </div>

          {/* Две колонки */}
          <div className="home-modal__columns">
            {/* Левая: редактор */}
            <div className="home-modal__col-editor">
              <label className="home-modal__label">Текст</label>
              <div className="home-modal__editor-wrap">
                <Editor
                  content={body}
                  onChange={setBody}
                  placeholder="Текст объявления..."
                />
              </div>
            </div>

            {/* Правая: получатели */}
            <div className="home-modal__col-recipients">
              <div className="home-modal__section-title">
                <Users size={15} />
                Получатели
                {isForAll
                  ? <span className="home-modal__audience-hint">— все</span>
                  : <span className="home-modal__audience-hint">— {matchedCount} чел.</span>
                }
              </div>

              <div className="ann-recipients-toolbar">
                <div className="ann-recipients-search">
                  <Search size={14} className="ann-recipients-search__icon" />
                  <input
                    className="ann-recipients-search__input"
                    placeholder="Поиск..."
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                  />
                </div>

                <div className="ann-filter-wrap" onClick={e => e.stopPropagation()}>
                  <button
                    className={`ann-filter-btn${targetRoles.length > 0 ? ' active' : ''}${openFilter === 'roles' ? ' open' : ''}`}
                    title="Фильтр по ролям"
                    onClick={() => setOpenFilter(f => f === 'roles' ? null : 'roles')}
                  >
                    <Users size={15} />
                    {targetRoles.length > 0 && <span className="ann-filter-badge">{targetRoles.length}</span>}
                  </button>
                  {openFilter === 'roles' && (
                    <DropdownFilter
                      label="Роли"
                      items={rolesList}
                      selected={targetRoles}
                      onToggle={toggleRole}
                      onClose={() => setOpenFilter(null)}
                    />
                  )}
                </div>

                <div className="ann-filter-wrap" onClick={e => e.stopPropagation()}>
                  <button
                    className={`ann-filter-btn${targetMedCenterIds.length > 0 ? ' active' : ''}${openFilter === 'medcenters' ? ' open' : ''}`}
                    title="Фильтр по медцентрам"
                    onClick={() => setOpenFilter(f => f === 'medcenters' ? null : 'medcenters')}
                  >
                    <Building2 size={15} />
                    {targetMedCenterIds.length > 0 && <span className="ann-filter-badge">{targetMedCenterIds.length}</span>}
                  </button>
                  {openFilter === 'medcenters' && (
                    <DropdownFilter
                      label="Медцентры"
                      items={medCentersList}
                      selected={targetMedCenterIds}
                      onToggle={toggleMedCenter}
                      onClose={() => setOpenFilter(null)}
                    />
                  )}
                </div>
              </div>

              <div className="ann-users-list">
                {filteredUsers.length === 0 && (
                  <div className="ann-users-empty">Сотрудники не найдены</div>
                )}
                {filteredUsers.map(u => {
                  const on = isForAll || isUserOn(u.id);
                  const autoMatched = filterMatchedIds.has(u.id);
                  return (
                    <div
                      key={u.id}
                      className={`ann-user-item${autoMatched ? ' ann-user-item--auto' : ''}`}
                      onClick={() => toggleUser(u.id)}
                    >
                      <Toggle checked={on} onChange={() => toggleUser(u.id)} />
                      <span className="ann-user-item__name">{u.displayName || u.username}</span>
                      <span className="ann-user-item__meta">
                        {(u.roles || []).map(r => (
                          <span key={r.id} className="ann-user-item__chip ann-user-item__chip--role">{r.name}</span>
                        ))}
                        {(u.medCenters || []).map(m => (
                          <span key={m.id} className="ann-user-item__chip ann-user-item__chip--mc">{m.name}</span>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="home-modal__footer">
          <button className="home-modal__btn home-modal__btn--secondary" onClick={onClose}>Отмена</button>
          <button className="home-modal__btn home-modal__btn--primary" onClick={handleSave} disabled={saving}>
            <Check size={15} />
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const canEdit = user?.isAdmin || user?.adminAccess?.announcements;

  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [order, setOrder] = useState('desc');

  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [eventIndicators, setEventIndicators] = useState({});
  const [selectedDate, setSelectedDate] = useState(new Date());

  const [modal, setModal] = useState({ open: false, announcement: null });
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const handleToggleOrder = () => {
    const newOrder = order === 'desc' ? 'asc' : 'desc';
    setOrder(newOrder);
    fetchAnnouncements(1, search, newOrder);
  };

  const fetchAnnouncements = useCallback(async (p = 1, s = search, o = order) => {
    setLoading(true);
    try {
      const params = { page: p, order: o };
      if (s) params.search = s;
      const res = await announcementsApi.list(params);
      setAnnouncements(res.data.announcements);
      setTotalPages(res.data.totalPages || 1);
      setPage(p);
    } catch {
      toast.error('Ошибка загрузки объявлений');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchAnnouncements(1);
  }, []);

  useEffect(() => {
    calendarApi.getUpcoming(14).then(r => setUpcomingEvents(r.data || [])).catch(() => {});
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const end = new Date(now.getFullYear() + 1, now.getMonth(), 0, 23, 59, 59).toISOString();
    calendarApi.getEventIndicators(start, end).then(r => setEventIndicators(r.data || {})).catch(() => {});
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    fetchAnnouncements(1, searchInput);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearch('');
    fetchAnnouncements(1, '');
  };

  const handleSave = async (data) => {
    if (modal.announcement) {
      await announcementsApi.update(modal.announcement.id, data);
      toast.success('Объявление обновлено');
    } else {
      await announcementsApi.create(data);
      toast.success('Объявление создано');
    }
    fetchAnnouncements(page);
  };

  const handleDelete = async (announcement) => {
    try {
      await announcementsApi.delete(announcement.id);
      toast.success('Объявление удалено');
      setDeleteConfirm(null);
      fetchAnnouncements(page);
    } catch {
      toast.error('Ошибка при удалении');
    }
  };

  const handleTogglePin = async (announcement) => {
    try {
      await announcementsApi.update(announcement.id, { pinned: !announcement.pinned });
      fetchAnnouncements(page);
    } catch {
      toast.error('Ошибка');
    }
  };

  const firstName = user?.displayName
    ? user.displayName.trim().split(' ').slice(1, 3).join(' ')
    : user?.username;

  return (
    <div className="home-page">
      <div className="home-greeting">
        {getGreeting()}, {firstName}
      </div>

      <div className="home-layout">
        {/* Левая колонка — объявления */}
        <div className="home-announcements">
          <div className="home-announcements__box">
            <h2 className="home-announcements__title">Объявления</h2>
            <div className="home-announcements__toolbar">
              <form className="home-search" onSubmit={handleSearch}>
                <Search size={15} className="home-search__icon" />
                <input
                  className="home-search__input"
                  placeholder="Поиск..."
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                />
                {searchInput && (
                  <button type="button" className="home-search__clear" onClick={handleClearSearch}>
                    <X size={14} />
                  </button>
                )}
              </form>
              <button
                className="home-btn-sort"
                onClick={handleToggleOrder}
                title={order === 'desc' ? 'Сначала новые' : 'Сначала старые'}
              >
                <ArrowUpDown size={15} />
                {order === 'desc' ? 'Новые' : 'Старые'}
              </button>
              {canEdit && (
                <button className="home-btn-create" onClick={() => setModal({ open: true, announcement: null })}>
                  <Plus size={16} /> Создать
                </button>
              )}
            </div>

          {loading ? (
            <div className="home-loading"><div className="loading-spinner" /></div>
          ) : announcements.length === 0 ? (
            <div className="home-empty">
              {search ? 'Ничего не найдено' : 'Объявлений пока нет'}
            </div>
          ) : (
            <>
              <div className="home-announcements__list">
                {announcements.map(a => (
                  <AnnouncementCard
                    key={a.id}
                    announcement={a}
                    canEdit={canEdit}
                    onEdit={(a) => setModal({ open: true, announcement: a })}
                    onDelete={(a) => setDeleteConfirm(a)}
                    onTogglePin={handleTogglePin}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="home-pagination">
                  <button
                    className="home-pagination__btn"
                    disabled={page <= 1}
                    onClick={() => fetchAnnouncements(page - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="home-pagination__info">{page} / {totalPages}</span>
                  <button
                    className="home-pagination__btn"
                    disabled={page >= totalPages}
                    onClick={() => fetchAnnouncements(page + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
          </div>
        </div>

        {/* Правая колонка — календарь */}
        <div className="home-sidebar">
          <MiniCalendar
            selectedDate={selectedDate}
            eventIndicators={eventIndicators}
            onDateSelect={(date) => {
              setSelectedDate(date);
              navigate(`/calendar?date=${date.toISOString().split('T')[0]}`);
            }}
          />
          <UpcomingEvents
            events={upcomingEvents}
            onEventClick={(event) => navigate(`/calendar?date=${event.startTime.split('T')[0]}`)}
          />
        </div>
      </div>

      {modal.open && (
        <AnnouncementModal
          announcement={modal.announcement}
          onClose={() => setModal({ open: false, announcement: null })}
          onSave={handleSave}
        />
      )}

      {deleteConfirm && (
        <div className="home-modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="home-modal home-modal--confirm" onClick={e => e.stopPropagation()}>
            <h3>Удалить объявление?</h3>
            <p>«{deleteConfirm.title}» будет удалено безвозвратно.</p>
            <div className="home-modal__footer">
              <button className="home-modal__btn home-modal__btn--secondary" onClick={() => setDeleteConfirm(null)}>Отмена</button>
              <button className="home-modal__btn home-modal__btn--danger" onClick={() => handleDelete(deleteConfirm)}>Удалить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
