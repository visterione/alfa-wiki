import React, { useState, useEffect } from 'react';
import { Newspaper, Plus, Edit, Trash2, Send, EyeOff, X, Star } from 'lucide-react';
import { releaseNotes as releaseNotesApi } from '../../services/api';
import Editor from '../../components/Editor';
import toast from 'react-hot-toast';
import './AdminReleaseNotes.css';

const emptyForm = {
  id: null,
  title: '',
  content: '',
  version: '',
  severity: 'info',
  targetRoleIds: [],
  targetMedCenterIds: []
};

export default function AdminReleaseNotes() {
  const [notes, setNotes] = useState([]);
  const [roles, setRoles] = useState([]);
  const [medCenters, setMedCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = список, {...} = форма
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    try {
      const [notesRes, optsRes] = await Promise.all([
        releaseNotesApi.adminList(),
        releaseNotesApi.audienceOptions()
      ]);
      setNotes(notesRes.data || []);
      setRoles(optsRes.data?.roles || []);
      setMedCenters(optsRes.data?.medCenters || []);
    } catch (error) {
      console.error('Ошибка загрузки:', error);
      toast.error('Ошибка загрузки нововведений');
    } finally {
      setLoading(false);
    }
  };

  const startCreate = () => setEditing({ ...emptyForm });

  const startEdit = (note) => setEditing({
    id: note.id,
    title: note.title || '',
    content: note.content || '',
    version: note.version || '',
    severity: note.severity || 'info',
    targetRoleIds: Array.isArray(note.targetRoleIds) ? note.targetRoleIds : [],
    targetMedCenterIds: Array.isArray(note.targetMedCenterIds) ? note.targetMedCenterIds : []
  });

  const toggleId = (field, id) => {
    setEditing(prev => {
      const set = new Set(prev[field]);
      if (set.has(id)) set.delete(id); else set.add(id);
      return { ...prev, [field]: Array.from(set) };
    });
  };

  const handleSave = async () => {
    if (!editing.title.trim()) {
      toast.error('Укажите заголовок');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: editing.title,
        content: editing.content,
        version: editing.version,
        severity: editing.severity,
        targetRoleIds: editing.targetRoleIds,
        targetMedCenterIds: editing.targetMedCenterIds
      };
      if (editing.id) {
        await releaseNotesApi.update(editing.id, payload);
        toast.success('Сохранено');
      } else {
        await releaseNotesApi.create(payload);
        toast.success('Черновик создан');
      }
      setEditing(null);
      loadAll();
    } catch (error) {
      console.error('Ошибка сохранения:', error);
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async (note) => {
    try {
      await releaseNotesApi.publish(note.id);
      toast.success('Опубликовано, уведомления разосланы');
      loadAll();
    } catch (error) {
      toast.error('Ошибка публикации');
    }
  };

  const handleUnpublish = async (note) => {
    try {
      await releaseNotesApi.unpublish(note.id);
      toast.success('Снято с публикации');
      loadAll();
    } catch (error) {
      toast.error('Ошибка');
    }
  };

  const handleDelete = async (note) => {
    if (!window.confirm(`Удалить «${note.title}»?`)) return;
    try {
      await releaseNotesApi.delete(note.id);
      toast.success('Удалено');
      loadAll();
    } catch (error) {
      toast.error('Ошибка удаления');
    }
  };

  const audienceLabel = (note) => {
    const roleCnt = (note.targetRoleIds || []).length;
    const mcCnt = (note.targetMedCenterIds || []).length;
    if (roleCnt === 0 && mcCnt === 0) return 'Все пользователи';
    const parts = [];
    if (roleCnt > 0) parts.push(`роли: ${roleCnt}`);
    if (mcCnt > 0) parts.push(`МЦ: ${mcCnt}`);
    return parts.join(', ');
  };

  if (loading) {
    return <div className="arn-page"><div className="arn-empty">Загрузка…</div></div>;
  }

  // ── Форма создания/редактирования ─────────────────────────────
  if (editing) {
    return (
      <div className="arn-page">
        <div className="arn-header">
          <div className="arn-header-title">
            <Newspaper size={24} />
            <h1>{editing.id ? 'Редактирование' : 'Новое нововведение'}</h1>
          </div>
          <button className="arn-btn arn-btn-ghost" onClick={() => setEditing(null)}>
            <X size={16} /> Отмена
          </button>
        </div>

        <div className="arn-form">
          <label className="arn-field">
            <span>Заголовок</span>
            <input
              type="text"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              placeholder="Например: Новый модуль расписаний"
            />
          </label>

          <div className="arn-row">
            <label className="arn-field">
              <span>Версия (необязательно)</span>
              <input
                type="text"
                value={editing.version}
                onChange={(e) => setEditing({ ...editing, version: e.target.value })}
                placeholder="5.57"
              />
            </label>
            <label className="arn-field">
              <span>Важность</span>
              <select
                value={editing.severity}
                onChange={(e) => setEditing({ ...editing, severity: e.target.value })}
              >
                <option value="info">Обычное</option>
                <option value="important">Важное (модалка при входе)</option>
              </select>
            </label>
          </div>

          <div className="arn-field">
            <span>Содержимое</span>
            <Editor
              content={editing.content}
              onChange={(content) => setEditing({ ...editing, content })}
              placeholder="Опишите нововведение…"
            />
          </div>

          <div className="arn-audience">
            <div className="arn-audience-col">
              <div className="arn-audience-head">
                Роли-получатели
                <span className="arn-hint">пусто = все роли</span>
              </div>
              <div className="arn-chips">
                {roles.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    className={`arn-chip${editing.targetRoleIds.includes(r.id) ? ' arn-chip--on' : ''}`}
                    onClick={() => toggleId('targetRoleIds', r.id)}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="arn-audience-col">
              <div className="arn-audience-head">
                Медцентры-получатели
                <span className="arn-hint">пусто = все МЦ</span>
              </div>
              <div className="arn-chips">
                {medCenters.map(mc => (
                  <button
                    key={mc.id}
                    type="button"
                    className={`arn-chip${editing.targetMedCenterIds.includes(mc.id) ? ' arn-chip--on' : ''}`}
                    onClick={() => toggleId('targetMedCenterIds', mc.id)}
                  >
                    {mc.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="arn-form-actions">
            <button className="arn-btn arn-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Сохранение…' : (editing.id ? 'Сохранить' : 'Создать черновик')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Список ────────────────────────────────────────────────────
  return (
    <div className="arn-page">
      <div className="arn-header">
        <div className="arn-header-title">
          <Newspaper size={24} />
          <h1>Нововведения</h1>
        </div>
        <button className="arn-btn arn-btn-primary" onClick={startCreate}>
          <Plus size={16} /> Добавить
        </button>
      </div>

      {notes.length === 0 ? (
        <div className="arn-empty">Пока нет ни одного нововведения</div>
      ) : (
        <div className="arn-table">
          {notes.map(note => (
            <div key={note.id} className="arn-item">
              <div className="arn-item-main">
                <div className="arn-item-title">
                  {note.severity === 'important' && (
                    <Star size={16} className="arn-star" title="Важное" />
                  )}
                  {note.title}
                  {note.version && <span className="arn-badge arn-badge-ver">v{note.version}</span>}
                  {note.isPublished
                    ? <span className="arn-badge arn-badge-pub">Опубликовано</span>
                    : <span className="arn-badge arn-badge-draft">Черновик</span>}
                </div>
                <div className="arn-item-meta">Аудитория: {audienceLabel(note)}</div>
              </div>
              <div className="arn-item-actions">
                {note.isPublished ? (
                  <button className="arn-icon-btn" title="Снять с публикации" onClick={() => handleUnpublish(note)}>
                    <EyeOff size={16} />
                  </button>
                ) : (
                  <button className="arn-icon-btn arn-icon-btn-pub" title="Опубликовать" onClick={() => handlePublish(note)}>
                    <Send size={16} />
                  </button>
                )}
                <button className="arn-icon-btn" title="Редактировать" onClick={() => startEdit(note)}>
                  <Edit size={16} />
                </button>
                <button className="arn-icon-btn arn-icon-btn-danger" title="Удалить" onClick={() => handleDelete(note)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
