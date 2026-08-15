/** Компактный справочник проектов. Доступен только администраторам задач. */
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Archive, RotateCcw } from 'lucide-react';
import { tasks as api } from '../../../services/api';
import { Empty } from './Bits';

const PROJECT_COLORS = ['#007AFF', '#5856D6', '#AF52DE', '#34C759', '#FF9500', '#FF3B30', '#697386'];

export default function ProjectsAdmin({ ctx }) {
  const [projects, setProjects] = useState([]);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.getProjects(true);
      setProjects(data || []);
    } catch {
      toast.error('Не удалось получить проекты');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload, ctx.projectsRevision]);

  if (!ctx.access?.canManageProjects) return <Empty>У вас нет права управлять проектами.</Empty>;
  if (loading) return <Empty compact>Загружаем…</Empty>;

  const visible = projects.filter(project => !!project.isArchived === archived);

  const archive = async project => {
    try {
      await api.updateProject(project.id, { isArchived: true });
      toast.success('Проект перемещён в архив');
      reload();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Не удалось убрать проект');
    }
  };

  const restore = async project => {
    try {
      await api.updateProject(project.id, { isArchived: false });
      toast.success('Проект восстановлен');
      reload();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Не удалось восстановить проект');
    }
  };

  return <>
    <div className="tsk-project-switch" role="tablist" aria-label="Состояние проектов">
      <button className={!archived ? 'is-on' : ''} onClick={() => setArchived(false)}>Активные</button>
      <button className={archived ? 'is-on' : ''} onClick={() => setArchived(true)}>Архив</button>
    </div>

    <div className="tsk-project-list">
      {visible.length ? visible.map(project => <div className="tsk-project-row" key={project.id}>
        <span className="tsk-project-color" style={{ background: project.color || 'var(--text-tertiary)' }} />
        <button className="tsk-project-name" onClick={() => setEditing(project)}>{project.name}</button>
        <div className="tsk-project-actions">
          {archived
            ? <button className="tsk-btn is-sm" onClick={() => restore(project)}><RotateCcw size={14} />Восстановить</button>
            : <><button className="tsk-btn is-sm" onClick={() => setEditing(project)}>Изменить</button>
              <button className="tsk-project-archive" aria-label={`Убрать ${project.name} в архив`} title="В архив"
                onClick={() => archive(project)}><Archive size={16} /></button></>}
        </div>
      </div>) : <Empty compact>{archived ? 'Архив пуст.' : 'Проектов пока нет.'}</Empty>}
    </div>

    {editing && <ProjectModal project={editing} onClose={() => setEditing(null)} onSaved={() => {
      setEditing(null);
      reload();
    }} />}
  </>;
}

export function ProjectModal({ project, onClose, onSaved }) {
  const [name, setName] = useState(project?.name || '');
  const [color, setColor] = useState(/^#[0-9a-f]{6}$/i.test(project?.color || '') ? project.color : PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    const cleanName = name.trim();
    if (!cleanName) { toast.error('Нужно название проекта'); return; }
    setSaving(true);
    try {
      const { data } = project
        ? await api.updateProject(project.id, { name: cleanName, color })
        : await api.createProject({ name: cleanName, color });
      toast.success(project ? 'Проект обновлён' : 'Проект создан');
      onSaved(data);
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Не удалось сохранить проект');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(<div className="tsk-mask tsk-project-mask" onClick={event => event.target === event.currentTarget && onClose()}>
    <div className="tsk-modal tsk-project-modal">
      <div className="tsk-modal-head">
        <div className="tsk-modal-title">{project ? 'Проект' : 'Новый проект'}</div>
        <button className="tsk-x" onClick={onClose}>×</button>
      </div>
      <div className="tsk-modal-body">
        <label className="tsk-project-name-field">
          <span>Название</span>
          <input className="tsk-input" autoFocus value={name} placeholder="Название проекта"
            onChange={event => setName(event.target.value)} onKeyDown={event => event.key === 'Enter' && save()} />
        </label>
        <label className="tsk-project-color-field">
          <span>Цвет</span>
          <span className="tsk-project-palette">
            {PROJECT_COLORS.map(value => <button type="button" key={value} aria-label={`Цвет ${value}`}
              className={color.toLowerCase() === value.toLowerCase() ? 'is-on' : ''}
              style={{ '--project-color': value }} onClick={() => setColor(value)} />)}
          </span>
        </label>
      </div>
      <div className="tsk-modal-foot">
        <span />
        <div className="tsk-modal-btns">
          <button className="tsk-btn" onClick={onClose}>Отмена</button>
          <button className="tsk-btn is-primary" disabled={saving} onClick={save}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  </div>, document.body);
}
