/**
 * «Задачи» — плоский список с фильтрами. Раздел «Моё», и только он.
 *
 * Нужен там, где доска бесполезна: найти задачу по проекту, посмотреть всё, что
 * поставил сам, вытащить задачи на нескольких человек. Колонка «Трудозатраты»
 * считает оценку с умножением на число исполнителей — общая часть на троих это
 * не два часа, а шесть.
 *
 * Список ходит со scope=own. Раньше он спрашивал маршрут без этого параметра и
 * получал полную область видимости — а у руководителя команды в неё входят и
 * задачи его участников. В разделе с заголовком «Моё» это выглядело как
 * необъяснимая чужая работа: человек открывал свои задачи и видел те, где он
 * ни исполнитель, ни автор. Чужое теперь смотрят там, где это и есть вопрос, —
 * на доске и в командах.
 *
 * ── Что изменено в ver. 8.44 ─────────────────────────────────────────────
 *
 * Состояние стоит последним столбцом, после срока, и показано бейджем с
 * названием внутри. Голый значок в начале строки экономил ширину, но требовал
 * знания: шесть фигурок без подписей читаются только тем, кто их уже выучил.
 * Подпись вернула столбцу ширину, а ширина вернула его в конец строки — туда,
 * где он не отодвигает названия, ради которых таблицу и открывают.
 *
 * Срок составной задачи показан диапазоном: по одной только крайней дате
 * нельзя было отличить дело на один день от цепочки на неделю.
 *
 * Составная задача раскрывается шевроном в свои части. До этого о том, что
 * задача из четырёх кусков с разными исполнителями и сроками, в списке
 * сообщало только слово «Разделена» в колонке формата — а ответ на «кто и
 * когда» приходилось искать, открывая карточку.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { ChevronRight } from 'lucide-react';
import { tasks as api } from '../../../services/api';
import { MODE_LABEL, MODE_ICON, peopleText, partCode } from '../utils/labels';
import { hoursText, dnum, dateRange } from '../utils/dates';
import { AvatarStack, Empty, StatusBadge } from './Bits';
import CustomSelect from './CustomSelect';

/**
 * Первые три фильтра отвечают на вопрос «чьё это», остальные — «в каком оно
 * состоянии». «Все мои» это объединение первых двух: задача, которую человек
 * поставил сам себе, попадает в оба.
 */
const FILTERS = [
  ['all', 'Все мои'],
  ['assigned', 'Где я исполнитель'],
  ['mine', 'Поставленные мной'],
  ['multi', 'На нескольких человек'],
  ['new', 'Не обработано'],
  ['stuck', 'Анализируется'],
  ['done', 'Готово'],
];

const usersOf = parts => (parts || [])
  .flatMap(p => (p.assignees || []).map(a => a.user))
  .filter((u, i, arr) => u && arr.findIndex(x => x?.id === u.id) === i);

export default function TaskList({ ctx }) {
  const [list, setList] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  /** Какие составные задачи раскрыты. Множеством: раскрытых может быть много. */
  const [opened, setOpened] = useState(() => new Set());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = { scope: 'own' };
      if (filter === 'mine') params.mine = true;
      else if (filter === 'assigned') params.assigned = true;
      else if (filter === 'multi') params.multi = true;
      else if (filter !== 'all') params.status = filter;
      const { data } = await api.getTasks(params);
      setList(data || []);
    } catch {
      toast.error('Не удалось получить задачи');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { reload(); }, [reload]);
  // Сменили фильтр — раскрытые строки больше не те же самые: оставленные
  // ключи раскрывали бы в новом списке случайные задачи.
  useEffect(() => { setOpened(new Set()); }, [filter]);

  const toggle = taskId => setOpened(current => {
    const next = new Set(current);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    return next;
  });

  // Фильтр стоит в шапке модуля рядом с названием раздела — там же, где фильтры
  // доски. Свою строку над таблицей он занимал целиком ради одного поля.
  const filters = (
    <CustomSelect
      label="Показывать"
      value={filter}
      onChange={setFilter}
      options={FILTERS.map(([value, label]) => ({ value, label }))}
      className="is-wide"
    />
  );

  return (
    <>
      {ctx.headerSlot && createPortal(filters, ctx.headerSlot)}

      {loading ? <Empty compact>Загружаем…</Empty>
        : !list.length ? <Empty>В этом фильтре пусто.</Empty> : (
        <div className="tsk-task-table-wrap">
          <table className="tsk-table">
            <thead>
              <tr>
                <th>Задача</th>
                <th>Исполнители</th>
                <th>Формат</th>
                <th>Трудозатраты</th>
                <th>Срок</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {list.map(task => {
                const parts = [...(task.parts || [])]
                  .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
                const users = usersOf(parts);
                // Не только крайний срок, но и начало: по одной дате нельзя
                // отличить дело на день от цепочки на неделю, а в списке это
                // первое, что хочется знать о составной задаче.
                const dates = parts.map(p => String(p.dueDate)).sort();
                const due = dateRange(dates[0], dates[dates.length - 1]);
                const complex = parts.length > 1;
                const isOpen = opened.has(task.id);

                return (
                  <React.Fragment key={task.id}>
                    <tr className="is-clickable" onClick={() => ctx.openTask(task.id)}>
                      <td>
                        <div className="tsk-task-cell">
                          {/* Шеврон занимает место и у простой задачи: без
                              распорки названия составных и простых задач стояли
                              бы в разных колонках, и список рябил бы уступами. */}
                          {complex ? (
                            <button
                              type="button"
                              className={`tsk-row-toggle ${isOpen ? 'is-open' : ''}`}
                              aria-label={isOpen ? 'Свернуть подзадачи' : `Показать подзадачи · ${parts.length}`}
                              aria-expanded={isOpen}
                              title={isOpen ? 'Свернуть подзадачи' : `Показать подзадачи · ${parts.length}`}
                              // Шеврон раскрывает строку, а не открывает
                              // карточку: без этого нажатие на него делало бы
                              // сразу два разных дела.
                              onClick={event => { event.stopPropagation(); toggle(task.id); }}
                            >
                              <ChevronRight size={15} strokeWidth={2} />
                            </button>
                          ) : <span className="tsk-row-toggle is-blank" />}

                          <span className="tsk-task-name">
                            {/* Код перед названием, а не отдельным столбцом:
                                столбец из шести знаков забрал бы ширину у самих
                                названий, ради которых таблицу и открывают. */}
                            {task.code && <span className="tsk-code">{task.code}</span>}
                            {task.title}
                            {/* Вторая строка — только проект. Число частей,
                                вложения и автор есть в карточке задачи, а в
                                списке они сливались в серую строку, которую
                                никто не дочитывал до конца. */}
                            {task.project?.name && (
                              <span className="tsk-task-project">{task.project.name}</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td>
                        <Assignees users={users} />
                      </td>
                      <td><Mode mode={task.mode} /></td>
                      <td>{hoursText(task.totalEffortHours)}</td>
                      <td className="tsk-due">{due}</td>
                      <td><StatusBadge status={task.status} /></td>
                    </tr>

                    {complex && isOpen && parts.map((part, index) => {
                      const partUsers = usersOf([part]);
                      return (
                        <tr
                          key={part.id}
                          className="tsk-subrow is-clickable"
                          onClick={() => ctx.openTask(task.id)}
                        >
                          <td>
                            <div className="tsk-task-cell is-sub">
                              <span className="tsk-row-toggle is-blank" />
                              <span className="tsk-sub-rail" />
                              <span className="tsk-task-name">
                                {/* Полный код части, а не её номер: «АЛЬ-1/2»
                                    называет и задачу, и место в ней, и именно
                                    так часть называют вслух и ищут поиском.
                                    Голая «2» вне своей строки не значит
                                    ничего. */}
                                <span className="tsk-code">{partCode(task.code, index)}</span>
                                {part.title}
                              </span>
                            </div>
                          </td>
                          <td><Assignees users={partUsers} size={18} /></td>
                          {/* У части формат сводится к «одна на всех или нет»:
                              разделить часть ещё раз нельзя, она и есть
                              неделимая единица работы. */}
                          <td><Mode mode={partUsers.length > 1 ? 'shared' : 'single'} size={15} /></td>
                          <td>
                            {/* Часы части умножаются на исполнителей по тому же
                                правилу, что и «Трудозатраты» задачи: общий кусок
                                на троих это не два часа, а шесть. */}
                            {hoursText(Number(part.estimateHours || 0) * Math.max(partUsers.length, 1))}
                          </td>
                          {/* У части срок всегда один день: диапазон у неё
                              взяться неоткуда, она и есть единица работы. */}
                          <td className="tsk-due">{part.dueDate ? dnum(part.dueDate) : '—'}</td>
                          <td><StatusBadge status={part.status} /></td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * Формат задачи значком.
 *
 * Подпись занимала здесь четырнадцать процентов ширины ради одного из четырёх
 * слов, которые к тому же повторялись в столбце сверху вниз почти без
 * изменений. Название осталось в подсказке: значок отвечает на вопрос
 * взглядом, а прочесть его словами можно наведением.
 */
function Mode({ mode, size = 17 }) {
  const Icon = MODE_ICON[mode];
  if (!Icon) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  return (
    <span className="tsk-mode-icon" title={MODE_LABEL[mode]} aria-label={MODE_LABEL[mode]}>
      <Icon size={size} strokeWidth={1.8} />
    </span>
  );
}

/**
 * Исполнители: аватарки и имена.
 *
 * Число рядом с аватарками («3») отвечало не на тот вопрос. К этой колонке
 * обращаются, чтобы узнать, кто делает работу, а сколько их — видно по самим
 * аватаркам. Полный список уезжает в подсказку: в строке он не помещается, но
 * узнать его без открытия карточки всё же должно быть можно.
 */
function Assignees({ users, size = 20 }) {
  if (!users.length) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  return (
    <div className="tsk-assignees" title={users.map(u => u.displayName || u.username).join(', ')}>
      <AvatarStack users={users} size={size} />
      <span>{peopleText(users)}</span>
    </div>
  );
}
