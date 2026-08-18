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

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Clock } from 'lucide-react';
import { tasks as api } from '../../../services/api';
import { BOARD_COLUMNS, shortName, partCode } from '../utils/labels';
import { clockText } from '../utils/dates';
import { AvatarStack, Empty, Note } from './Bits';
import CustomSelect from './CustomSelect';

export default function Board({ ctx }) {
  const [list, setList] = useState([]);
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState('');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [personId, setPersonId] = useState('');
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

  /**
   * Люди для фильтра берутся из того, что уже на доске, а не из справочника
   * сотрудников: выбирать из полного списка компании человека, у которого здесь
   * ничего нет, — это пустая доска в ответ на осмысленное действие.
   */
  const people = useMemo(() => {
    const seen = new Map();
    list.forEach(task => (task.parts || []).forEach(part => (part.assignees || []).forEach(a => {
      if (a.user && !seen.has(a.user.id)) seen.set(a.user.id, a.user);
    })));
    return [...seen.values()].sort((a, b) => shortName(a).localeCompare(shortName(b), 'ru'));
  }, [list]);

  // Выбранный человек мог пропасть с доски после смены команды или проекта.
  // Молча оставленный фильтр показывал бы пустые колонки без всякой причины.
  useEffect(() => {
    if (personId && !people.some(user => String(user.id) === String(personId))) setPersonId('');
  }, [people, personId]);

  const cards = list.flatMap(task => {
    const parts = [...(task.parts || [])].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    if (parts.length <= 1) return [{ task, part: parts[0] || null, isPart: false }];
    return parts.map((part, index) => ({ task, part, isPart: true, partIndex: index }));
  }).filter(card => {
    if (!personId) return true;
    // У неразделённой задачи исполнители лежат в её единственной части, у
    // разделённой — каждый в своей: фильтр смотрит ровно ту часть, которой
    // карточка и является.
    const assignees = card.isPart
      ? card.part?.assignees || []
      : (card.task.parts || []).flatMap(part => part.assignees || []);
    return assignees.some(a => String(a.user?.id) === String(personId));
  }).map(card => ({ ...card,
    columnStatus: card.part?.status === 'plan' ? 'work' : card.part?.status || card.task.status,
  }));

  /**
   * Фильтры уезжают в шапку модуля, к названию раздела: на доске и так пять
   * колонок во всю высоту, и отдельная строка над ними съедала место у карточек.
   * Пока слот не смонтирован (первый рендер оболочки), фильтры не рисуются
   * вовсе — мигание пустой строки хуже, чем их появление кадром позже.
   */
  const filters = (
    <>
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
        <CustomSelect
          label="Сотрудник"
          value={personId}
          onChange={setPersonId}
          options={[{ value: '', label: 'Все сотрудники' }, ...people.map(user => ({ value: user.id, label: shortName(user) }))]}
        />
    </>
  );

  return (
    <>
      {ctx.headerSlot && createPortal(filters, ctx.headerSlot)}

      {loading ? <Empty compact>Загружаем…</Empty> : (
        <div className="tsk-board">
          {BOARD_COLUMNS.map(([key, label]) => {
            const column = cards.filter(card => card.columnStatus === key);
            return (
              <div className={`tsk-col is-${key}`} key={key}>
                <div className="tsk-col-head">
                  <span>{label}</span>
                  <span>{column.length}</span>
                </div>
                {/* Пустая колонка ничего не подписывает: цветная шапка с нулём
                    уже сказала всё, а слово «пусто» в четырёх колонках из пяти
                    превращало доску в список отрицаний. */}
                <div className="tsk-col-body">
                  {column.map(({ task, part, isPart, partIndex }) => (
                    <div className="tsk-tcard" key={isPart ? part.id : task.id} onClick={() => ctx.openTask(task.id)}>
                      {/* Верхняя строка: слева то, к чему карточка относится
                          (проект или родительская задача), справа — часы.
                          Статус отсюда убран: карточка лежит в колонке своего
                          статуса, и бейдж повторял её заголовок. */}
                      <div className="tsk-tcard-top">
                        <span className="tsk-tcard-parent">
                          {isPart ? task.title : task.project?.name || ''}
                        </span>
                        <span className="tsk-hours-chip">
                          <Clock size={12} strokeWidth={1.9} />
                          {clockText(isPart
                            ? Number(part.estimateHours || 0) * Math.max(part.assignees?.length || 0, 1)
                            : task.totalEffortHours)}
                        </span>
                      </div>
                      <div className="tsk-tcard-title">{isPart
                        ? part.title === task.title ? `Часть ${partIndex + 1}` : part.title
                        : task.title}</div>
                      <div className="tsk-tcard-meta">
                        <AvatarStack users={(isPart ? part.assignees || [] : (task.parts || []).flatMap(p => p.assignees || []))
                          .map(a => a.user)
                          .filter((u, i, arr) => u && arr.findIndex(x => x?.id === u.id) === i)} size={20} />
                        {!!task.attachments?.length && <span title="вложения">📎{task.attachments.length}</span>}
                        {/* Код вместо прежнего «2/3»: он говорит то же самое про
                            номер части и вдобавок называет саму задачу. */}
                        <span className="tsk-part-index">{partCode(task.code, isPart ? partIndex : null)}</span>
                      </div>
                    </div>
                  ))}
                </div>
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
