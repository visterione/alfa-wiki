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
 * Составная задача остаётся контейнером: по колонкам движутся её части,
 * потому что у каждой собственные исполнитель, срок и статус.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { tasks as api } from '../../../services/api';
import { BOARD_COLUMNS, STATUS_LABEL, STATUS_TONE } from '../utils/labels';
import { hoursText } from '../utils/dates';
import { Badge, AvatarStack, Empty, Note } from './Bits';
import CustomSelect from './CustomSelect';

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

  useEffect(() => { reload(); }, [reload, ctx.tasksRevision]);

  const cards = list.flatMap(task => {
    const parts = [...(task.parts || [])].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    if (parts.length <= 1) return [{ task, part: parts[0] || null, isPart: false }];
    return parts.map((part, index) => ({ task, part, isPart: true, partIndex: index }));
  }).map(card => ({ ...card,
    columnStatus: card.part?.status === 'plan' ? 'work' : card.part?.status || card.task.status,
  }));

  return (
    <>
      <div className="tsk-ctl">
        <CustomSelect
          label="Команда"
          value={teamId}
          onChange={setTeamId}
          options={[{ value: '', label: 'Все команды' }, ...teams.map(team => ({ value: team.id, label: team.name }))]}
        />
        <CustomSelect
          label="Проект"
          value={projectId}
          onChange={setProjectId}
          options={[{ value: '', label: 'Все проекты' }, ...projects.map(project => ({ value: project.id, label: project.name, color: project.color }))]}
        />
        <span className="tsk-result-count">{cards.length === list.length
          ? `${list.length} задач`
          : `${cards.length} элементов · ${list.length} задач`}</span>
      </div>

      {loading ? <Empty compact>Загружаем…</Empty> : (
        <div className="tsk-board">
          {BOARD_COLUMNS.map(([key, label]) => {
            const column = cards.filter(card => card.columnStatus === key);
            return (
              <div className="tsk-col" key={key}>
                <div className="tsk-col-head">
                  <span>{label}</span>
                  <span>{column.length}</span>
                </div>
                {!column.length && (
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '6px 2px' }}>пусто</div>
                )}
                {column.map(({ task, part, isPart, partIndex, columnStatus }) => (
                  <div className="tsk-tcard" key={isPart ? part.id : task.id} onClick={() => ctx.openTask(task.id)}>
                    {isPart && <div className="tsk-tcard-parent">{task.title}</div>}
                    <div className="tsk-tcard-title">{isPart
                      ? part.title === task.title ? `Часть ${partIndex + 1}` : part.title
                      : task.title}</div>
                    <div className="tsk-tcard-meta">
                      <AvatarStack users={(isPart ? part.assignees || [] : (task.parts || []).flatMap(p => p.assignees || []))
                        .map(a => a.user)
                        .filter((u, i, arr) => u && arr.findIndex(x => x?.id === u.id) === i)} size={20} />
                      <Badge tone={STATUS_TONE[columnStatus]}>{hoursText(isPart
                        ? Number(part.estimateHours || 0) * Math.max(part.assignees?.length || 0, 1)
                        : task.totalEffortHours)}</Badge>
                      {isPart && <Badge tone={STATUS_TONE[part.status]}>{STATUS_LABEL[part.status]}</Badge>}
                      {!!task.attachments?.length && <span title="вложения">📎{task.attachments.length}</span>}
                      {isPart && <span className="tsk-part-index">{partIndex + 1}/{task.parts.length}</span>}
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
        Если задача разделена, каждая часть показана отдельной карточкой со своим статусом.
      </Note>
    </>
  );
}
