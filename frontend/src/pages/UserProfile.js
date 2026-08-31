import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  User, Phone, Briefcase, FileText, Building2, Calendar,
  ArrowLeft, Clock, BookOpen, CheckCircle2, Award, Star
} from 'lucide-react';
import { users, BASE_URL } from '../services/api';
import './UserProfile.css';

const COURSE_COLORS = [
  { bg: '#eff6ff', icon: '#3b82f6', border: 'var(--accent-200)' },
  { bg: '#f0fdf4', icon: '#16a34a', border: 'var(--green-200)' },
  { bg: '#faf5ff', icon: '#9333ea', border: 'var(--violet-200)' },
  { bg: '#fffbeb', icon: '#d97706', border: 'var(--amber-200)' },
  { bg: '#fff1f2', icon: '#e11d48', border: 'var(--red-200)' },
  { bg: '#f0fdfa', icon: '#0d9488', border: 'var(--green-300)' },
];

function getAvatarUrl(avatar) {
  if (!avatar) return null;
  if (avatar.startsWith('http://localhost')) {
    const path = avatar.replace(/^http:\/\/localhost:\d+\//, '');
    return `${BASE_URL}/${path}`;
  }
  if (avatar.startsWith('http')) return avatar;
  return `${BASE_URL}/${avatar}`;
}

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatLastSeen(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 2) return 'только что';
  if (min < 60) return `${min} мин. назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч. назад`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'вчера';
  if (d < 7) return `${d} дн. назад`;
  return formatDate(iso);
}

export default function UserProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    users.getPublicProfile(id)
      .then(({ data }) => setProfile(data))
      .catch(() => setError('Профиль не найден'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="up-loading">
      <div className="loading-spinner" />
    </div>
  );

  if (error) return (
    <div className="up-error">
      <div className="up-error-icon"><User size={36} /></div>
      <p>{error}</p>
      <button className="btn btn-ghost" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} /> Назад
      </button>
    </div>
  );

  const avatarUrl = getAvatarUrl(profile.avatar);
  const roleLabel = profile.isAdmin
    ? 'Администратор'
    : profile.roles?.length > 0
      ? profile.roles.map(r => r.name).join(', ')
      : profile.role?.name || 'Пользователь';
  const medCenters = profile.medCenters || [];
  const completedCourses = profile.completedCourses || [];
  // isOnline приходит с сервера из presence-сервиса. Одного lastSeen мало:
  // у активного пользователя метка обновляется раз в минуту и всегда чуть в
  // прошлом, так что он показывался бы «5 мин. назад», сидя в чате.
  const lastSeen = profile.isOnline ? 'в сети' : formatLastSeen(profile.lastSeen);

  return (
    <div className="up-page">

      <button className="up-back btn btn-ghost" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} />
        Назад
      </button>

      {/* ── Hero ─────────────────────────────────────── */}
      <div className="up-hero">
        <div className="up-hero-left">
          <div className="up-avatar">
            {avatarUrl
              ? <img src={avatarUrl} alt="" />
              : <User size={40} className="up-avatar-icon" />
            }
          </div>
          {lastSeen && (
            <div className="up-lastseen">
              <span className={`up-lastseen-dot ${profile.isOnline ? 'is-online' : ''}`} />
              {lastSeen}
            </div>
          )}
        </div>

        <div className="up-hero-info">
          <div className="up-name">{profile.displayName || profile.username}</div>
          <div className="up-username">@{profile.username}</div>

          {profile.position && (
            <div className="up-position">
              <Briefcase size={13} />
              {profile.position}
            </div>
          )}

          <div className="up-badges">
            <span className="up-role-badge">{roleLabel}</span>
            {medCenters.map(mc => (
              <span key={mc.id} className="up-medcenter-badge">
                <Building2 size={11} />
                {mc.name}
              </span>
            ))}
          </div>

          <div className="up-hero-footer">
            {profile.createdAt && (
              <span className="up-meta-item">
                <Calendar size={12} />
                В системе с {formatDate(profile.createdAt)}
              </span>
            )}
            {profile.phone && (
              <a href={`tel:${profile.phone}`} className="up-meta-item up-phone">
                <Phone size={12} />
                {profile.phone}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── Bio ──────────────────────────────────────── */}
      {profile.bio && (
        <div className="up-bio-card">
          <div className="up-bio-icon"><FileText size={15} /></div>
          <p className="up-bio-text">{profile.bio}</p>
        </div>
      )}

      {/* ── Courses / Achievements ────────────────────── */}
      <div className="up-section">
        <div className="up-section-header">
          <Award size={17} />
          <h2>Пройденные курсы</h2>
          {completedCourses.length > 0 && (
            <span className="up-section-count">{completedCourses.length}</span>
          )}
        </div>

        {completedCourses.length === 0 ? (
          <div className="up-courses-empty">
            <div className="up-courses-empty-icon">
              <BookOpen size={32} />
            </div>
            <div className="up-courses-empty-text">Курсов пока нет</div>
            <div className="up-courses-empty-sub">Здесь будут появляться пройденные курсы</div>
          </div>
        ) : (
          <div className="up-courses-grid">
            {completedCourses.map((cp, i) => {
              const color = COURSE_COLORS[i % COURSE_COLORS.length];
              const hasScore = cp.testScore != null && cp.testScore > 0;
              const isExcellent = cp.testScore >= 90;
              return (
                <div key={cp.id} className="up-course-card" style={{ '--course-bg': color.bg, '--course-icon': color.icon, '--course-border': color.border }}>
                  <div className="up-course-icon-wrap">
                    <BookOpen size={22} />
                    {isExcellent && <Star size={12} className="up-course-star" />}
                  </div>
                  <div className="up-course-body">
                    <div className="up-course-title">{cp.course?.title || 'Курс'}</div>
                    <div className="up-course-meta">
                      <span className="up-course-date">
                        <CheckCircle2 size={11} />
                        {formatDate(cp.completedAt)}
                      </span>
                      {hasScore && (
                        <span className={`up-course-score ${isExcellent ? 'excellent' : ''}`}>
                          {cp.testScore}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
