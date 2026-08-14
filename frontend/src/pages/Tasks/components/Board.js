/**
 * Доска.
 *
 * От канбана здесь остались только колонки. Разница в том, что первые две из
 * них честные: «Не обработано» — исполнитель ещё не решил, когда это делать, а
 * «Анализируется» — задача переносится третий раз и требует решения. На обычной
 * доске обе эти пачки лежат в «К выполнению» и выглядят как начатая работа.
 *
 * Колонки не переименовываются: это не ярлыки, а состояния, на которых висит
 * логика модуля.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { tasks as api } from '../../../services/api';
import { BOARD_COLUMNS, MODE_SHORT, STATUS_TONE } from '../utils/labels';
import { hoursText } from '../utils/dates';
import { Badge, AvatarStack, Empty, Note } from './Bits';

export default function Board({ ctx }) {
  const [list, setList] = useState([]);
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState('');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getTeams().then(r => setTeams(r.data.teams || [])).catch(() => {});
    api.getProjects().then(r => setProjects(r.data || [])).catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.getTasks({
        teamId: teamId || undefined,
        projectId: projectId || undefined,
      });
      setList(data || []);
    } catch {
      toast.error('Не удалось получить задачи');
    } finally {
      setLoading(false);
    }
  }, [teamId, projectId]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <>
      <div className="tsk-ctl">
        <select className="tsk-select" value={teamId} onChange={e => setTeamId(e.target.value)}>
          <option value="">Все команды</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="tsk-select" value={projectId} onChange={e => setProjectId(e.target.value)}>
          <option value="">Все проекты</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{list.length} задач</span>
      </div>

      {loading ? <Empty compact>Загружаем…</Empty> : (
        <div className="tsk-board">
          {BOARD_COLUMNS.map(([key, label]) => {
            const column = list.filter(t => t.status === key);
            return (
              <div className="tsk-col" key={key}>
                <div className="tsk-col-head">
                  <span>{label}</span>
                  <span>{column.length}</span>
                </div>
                {!column.length && (
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '6px 2px' }}>пусто</div>
                )}
                {column.map(task => (
                  <div className="tsk-tcard" key={task.id} onClick={() => ctx.openTask(task.id)}>
                    <div className="tsk-tcard-title">{task.title}</div>
                    <div className="tsk-tcard-meta">
                      <AvatarStack users={(task.parts || [])
                        .flatMap(p => (p.assignees || []).map(a => a.user))
                        .filter((u, i, arr) => u && arr.findIndex(x => x?.id === u.id) === i)} size={20} />
                      <Badge tone={STATUS_TONE[key]}>{hoursText(task.totalEffortHours)}</Badge>
                      {task.mode !== 'single' && <Badge tone="violet">{MODE_SHORT[task.mode]}</Badge>}
                      {!!task.attachments?.length && <span title="вложения">📎{task.attachments.length}</span>}
                      {task.parts?.length > 1 && <span title="несколько частей">⌗{task.parts.length}</span>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <Note>
        <b>Не обработано</b> — исполнитель ещё не решил, когда это делать, и
        задача не занимает у него времени.<br />
        <b>Анализируется</b> — часть переносится третий раз подряд и требует
        решения: разбить, передоговориться или отменить.<br />
        <b>на всех</b> — одна задача, время тратит каждый участник.
        <b> по частям</b> — разделена, у каждого свой кусок и срок.
      </Note>
    </>
  );
}
