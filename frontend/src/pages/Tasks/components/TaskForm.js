/**
 * Форма постановки задачи.
 *
 * Главное здесь — не поля, а разбор внизу. Если задача не помещается в день
 * исполнителя, автор видит это до отправки и обязан выбрать, что изменится:
 * сдвинуть срок, отдать свободному или продавить с объяснением. Решение
 * принимается здесь, а не всплывает через неделю чередой переносов.
 *
 * Обойти проверку можно всегда — запрет означал бы, что модулем перестанут
 * пользоваться в первый же настоящий аврал. Но не молча: объяснение уходит
 * исполнителю и остаётся в истории задачи.
 *
 * ── Что переделано в ver. 8.43 и почему ──────────────────────────────────
 *
 * Вкладок больше нет. Их было три — «Основное», «Части», «Схема», — и части
 * оказывались за вкладкой, в которую не заходили: на них жаловались как на
 * «перемудрено», хотя перемудрена была не работа с частями, а то, что её
 * прятали. Форма стала одной колонкой сверху вниз: что за задача, кто её
 * делает и когда, чем она описана.
 *
 * Схема цепочки тоже перестала быть вкладкой и рисуется прямо под частями —
 * там, где её и составляют. Смотреть на схему в отрыве от полей, которые её
 * порождают, незачем.
 *
 * Переключателя формата («Один / На всех / По частям / Смешанная») не стало
 * вовсе. Формат нигде не хранится — сервер выводит его из состава частей, — и
 * четыре кнопки были надстройкой над данными, которую приходилось держать в
 * согласии с ними руками. Теперь формат получается сам: один исполнитель в
 * одной части — обычная задача, несколько в одной части — общая, несколько
 * частей — разделённая.
 *
 * Поля «Оценка» больше нет. Часы теперь берутся из шкалы рабочего дня: автор
 * выделяет на ней интервал, и это одновременно отвечает на «сколько» и
 * показывает, куда именно работа встанет. Шкала рисуется сама, как только
 * известны исполнитель и день, — раньше она пряталась за ссылкой «Выбрать», и
 * про неё не знали.
 *
 * Слово «часть» осталось в коде и в комментариях, в интерфейсе она называется
 * подзадачей (ver. 8.46). Переименовывать TaskPart и маршруты /parts ради одной
 * надписи не стали — это миграция и правка всего модуля разом.
 */

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Paperclip, Upload, X, GitBranch, Users as UsersIcon } from 'lucide-react';
import { tasks as api, media } from '../../../services/api';
import { today, addDays, dfull, hoursText, estimateText, clockText } from '../utils/dates';
import { userName, shortName } from '../utils/labels';
import { Avatar, Badge, useMaskClose } from './Bits';
import CustomSelect from './CustomSelect';
import { ProjectModal } from './ProjectsAdmin';

/**
 * Шаг сетки — четверть часа, и он не настраивается.
 *
 * Переключатель шага (15/30/60) убран: он предлагал выбрать точность измерения
 * там, где от неё ничего не зависит. Час — слишком грубо, чтобы поместить
 * получасовой созвон, а разные шаги у разных задач делали несопоставимыми сами
 * оценки. Пятнадцать минут — то, чем в этой компании и так меряют приёмы.
 */
const STEP = 15;

/** Границы полотна шкалы, когда расписание исполнителя ничего не подсказало. */
const FALLBACK_DAY = { start: '08:00', end: '20:00' };

const minutesOf = value => {
  const [h, m] = String(value || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};
const timeText = minutes =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const newPart = (patch = {}) => ({
  key: `p${Date.now()}${Math.random().toString(16).slice(2, 6)}`,
  title: '',
  assignees: [],
  dueDate: addDays(today(), 1),
  slot: null,
  after: [],
  ...patch,
});

/** Часы части выводятся из выделения на шкале — своего поля у них больше нет. */
const partHours = part => (part.slot
  ? ((part.slot.end - part.slot.start + 1) * STEP) / 60
  : 0);

export default function TaskForm({ preset, ctx, onClose, onCreated }) {
  const maskProps = useMaskClose(onClose);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  /**
   * Команда, которой задача будет открыта целиком (ver. 8.42).
   *
   * Предустанавливается, когда задачу ставят со страницы команды: там вопрос
   * «чья это задача» уже задан и отвечен, переспрашивать его в форме незачем.
   */
  const [teamId, setTeamId] = useState(preset.teamId || '');
  const [parts, setParts] = useState(() => [newPart({
    assignees: preset.assignee ? [preset.assignee] : [],
    dueDate: preset.date || addDays(today(), 1),
  })]);

  const [people, setPeople] = useState([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [loads, setLoads] = useState({});
  const [choice, setChoice] = useState(null);
  const [explanation, setExplanation] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    /**
     * Не весь список портала, а только заведённые в модуле.
     *
     * Постановка задачи человеку без рабочего расписания отвечает 409, и из
     * полутора сотен имён больше сотни приводили к ошибке, о которой автор
     * узнавал, заполнив форму до конца. Кого показывать, решает сервер.
     */
    api.getAssignable()
      .then(r => setPeople(r.data || []))
      .catch(() => toast.error('Не удалось получить список исполнителей'))
      .finally(() => setPeopleLoading(false));
    api.getProjects().then(r => setProjects(r.data || [])).catch(() => {});
  }, []);

  /**
   * Загрузка каждого исполнителя на его день.
   *
   * Тянется по мере того, как автор выбирает людей и даты: показать «станет 8,2
   * из 6,4 ч» нужно до отправки, иначе весь смысл проверки теряется.
   */
  useEffect(() => {
    const wanted = parts.flatMap(p => p.assignees.map(id => `${id}|${p.dueDate}`));
    const missing = [...new Set(wanted)].filter(k => !(k in loads));
    if (!missing.length) return undefined;

    let alive = true;
    Promise.all(missing.map(async key => {
      const [userId, date] = key.split('|');
      try {
        const { data } = await api.getPersonLoad(userId, date, date);
        return [key, data.days?.[0] || null];
      } catch {
        return [key, null];
      }
    })).then(entries => {
      if (alive) setLoads(prev => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { alive = false; };
  }, [parts, loads]);

  /** Разбор: кто и насколько не помещается. */
  const overloads = useMemo(() => {
    const out = [];
    for (const part of parts) {
      const hours = partHours(part);
      for (const userId of part.assignees) {
        const day = loads[`${userId}|${part.dueDate}`];
        if (!day) continue;
        if (day.onVacation) { out.push({ userId, date: part.dueDate, reason: 'vacation' }); continue; }
        if (day.onDayOff) { out.push({ userId, date: part.dueDate, reason: 'day_off' }); continue; }
        if (day.norm === null || day.norm === undefined) {
          out.push({ userId, date: part.dueDate, reason: 'no_norm' });
          continue;
        }
        const after = day.hours + hours;
        if (after > day.norm + 1e-9) {
          out.push({ userId, date: part.dueDate, reason: 'overload', after, norm: day.norm, over: after - day.norm });
        }
      }
    }
    return out;
  }, [parts, loads]);

  const totalEffort = parts.reduce(
    (sum, p) => sum + partHours(p) * Math.max(p.assignees.length, 1), 0
  );

  const setPart = useCallback((key, patch) => setParts(list =>
    list.map(p => (p.key === key ? { ...p, ...patch } : p))), []);

  const addPart = () => setParts(list => [...list, newPart({
    dueDate: addDays(list[list.length - 1].dueDate, 1),
    // Новая часть по умолчанию встаёт в конец цепочки. Это самый частый случай
    // — «сначала одно, потом другое», — и именно ради него части и заводят.
    after: [list[list.length - 1].key],
  })]);

  const removePart = key => setParts(list => list
    .filter(p => p.key !== key)
    .map(p => ({ ...p, after: p.after.filter(x => x !== key) })));

  const shiftToNextFit = async () => {
    const first = parts[0];
    const userId = first.assignees[0];
    if (!userId) return;
    try {
      const start = addDays(first.dueDate, 1);
      const end = addDays(first.dueDate, 30);
      const { data } = await api.getPersonLoad(userId, start, end);
      const fit = (data.days || []).find(day =>
        !day.onVacation && day.norm !== null
        && Number(day.hours) + partHours(first) <= Number(day.norm)
      );
      if (!fit) { toast.error('В ближайшие 30 дней подходящего окна нет'); return; }
      setChoice('shift');
      // Сдвигается только та часть, которая не помещается, а не все разом:
      // цепочка «сначала одно, потом другое» от сдвига первого звена не должна
      // складываться в один день.
      setParts(list => list.map(p => (p.key === first.key
        ? { ...p, dueDate: fit.date, slot: null }
        : p)));
      toast.success(`Срок перенесён на ${dfull(fit.date)} — там задача помещается`);
    } catch {
      toast.error('Не удалось найти свободный день');
    }
  };

  const giveToFreePerson = async () => {
    const first = parts[0];
    const hours = partHours(first);
    const current = new Set(first.assignees);
    try {
      const checks = await Promise.all(people
        .filter(person => !current.has(person.id))
        .map(async person => {
          const { data } = await api.getPersonLoad(person.id, first.dueDate, first.dueDate);
          return { person, day: data.days?.[0] };
        }));
      const fit = checks.find(({ day }) =>
        day && !day.onVacation && day.norm !== null
        && Number(day.hours) + hours <= Number(day.norm));
      if (!fit) { toast.error('На этот день свободного исполнителя не найдено'); return; }
      setChoice('give');
      // Слот сбрасывается вместе с исполнителем: у нового человека свой день,
      // и оставленное выделение показывало бы занятость предыдущего.
      setPart(first.key, { assignees: [fit.person.id], slot: null });
      toast.success(`Передано: ${shortName(fit.person)}`);
    } catch {
      toast.error('Не удалось проверить загрузку коллег');
    }
  };

  const addFiles = async files => {
    const list = [...files];
    if (!list.length) return;
    if (attachments.length + list.length > 10) {
      toast.error('К задаче можно прикрепить не больше 10 файлов');
      return;
    }
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of list) {
        const { data } = await media.upload(file);
        uploaded.push({
          id: data.id,
          filename: data.originalName || file.name,
          path: data.path,
          size: data.size || file.size,
          mimeType: data.mimeType || file.type,
        });
      }
      setAttachments(prev => [...prev, ...uploaded]);
    } catch {
      toast.error('Не удалось прикрепить файл');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const byId = Object.fromEntries(people.map(u => [u.id, u]));
  const projectOptions = [
    { value: '', label: 'Без проекта' },
    ...projects.map(project => ({ value: project.id, label: project.name, color: project.color })),
    ...(ctx.access?.canManageProjects ? [{ value: '__new_project__', label: '+ Создать проект' }] : []),
  ];
  const myTeams = (ctx.access?.teams || []).filter(team => team.isMember || team.isLead);
  const teamOptions = [
    { value: '', label: 'Личная задача' },
    ...myTeams.map(team => ({ value: team.id, label: team.name })),
  ];

  const needsExplanation = overloads.some(o => o.reason === 'overload');
  const missingSlot = parts.some(p => p.assignees.length && !p.slot);
  const canSend = title.trim()
    && parts.every(p => p.assignees.length && p.dueDate && p.slot);

  const submit = async () => {
    if (!canSend) return;
    if (needsExplanation && explanation.trim().length < 8) {
      toast.error('Впишите, почему это всё равно должно быть сделано в этот срок');
      return;
    }
    setSaving(true);
    try {
      await api.createTask({
        title: title.trim(),
        description: description.trim() || null,
        projectId: projectId || null,
        teamId: teamId || null,
        attachments,
        explanation: needsExplanation ? explanation.trim() : undefined,
        parts: parts.map(p => ({
          id: p.key,
          title: p.title.trim() || title.trim(),
          assignees: p.assignees,
          estimateHours: partHours(p),
          dueDate: p.dueDate,
          after: p.after,
        })),
      });
      const selfTask = parts.length === 1
        && parts[0].assignees.length === 1
        && parts[0].assignees[0] === ctx.me?.id;
      toast.success(selfTask
        ? 'Ваша задача сразу добавлена в календарь'
        : parts.length === 1 && parts[0].assignees.length === 1
          ? 'Отправлено во входящие. В календарь исполнителя задача попадёт после обработки'
          : `Задача создана: ${parts.length} подзадач, ${hoursText(totalEffort)} трудозатрат. Каждый получил свою подзадачу`);
      onCreated();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Не удалось создать задачу');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Окно рисуется порталом в body, а не на месте.
   *
   * У .tsk стоит isolation: isolate — свой контекст наложения, — и пока
   * модалка жила внутри него, её z-index действовал только в пределах раздела:
   * затемнение обрывалось по краю рабочего полотна, а шапка портала и боковая
   * панель оставались поверх незатемнёнными. Выглядело это как «блюр накрыл
   * пол-экрана». Портал выносит окно из этого контекста целиком.
   */
  return createPortal(
    <div className="tsk-mask" {...maskProps}>
      <div className="tsk-modal tsk-task-modal">
        <div className="tsk-modal-head">
          <div className="tsk-modal-title">Новая задача</div>
          <button className="tsk-x" onClick={onClose}>×</button>
        </div>

        {/* Две колонки, а не одна лента.
            В столбик форма выходила на полтора экрана: шкала дня занимает
            четыре сотни точек по высоте, а под ней ещё описание и файлы, и
            автор заполнял её прокруткой, теряя из виду то, что уже ввёл.
            Слева — что за задача, справа — кто и когда её делает. Эти два
            вопроса заполняют независимо, и держать их рядом полезнее, чем
            подряд. */}
        <div className="tsk-modal-body tsk-task-modal-body">
          <div className="tsk-form-grid">

            <div className="tsk-form-col">
              <input
                className="tsk-input tsk-task-title-input"
                placeholder="Название задачи"
                value={title}
                onChange={e => setTitle(e.target.value)}
                autoFocus
              />

              {/* Команда и проект стоят между названием и описанием: это
                  короткие поля, и заполняются они заодно с названием, одним
                  движением. Описание — длинный текст, и всё, что идёт после
                  него, читается как отдельный раздел формы.

                  Команда левее проекта: она решает, кто задачу увидит, а
                  проект — только к чему её отнести. */}
              <div className="tsk-task-fields">
                {myTeams.length > 0 && (
                  <CustomSelect label="Команда" value={teamId} options={teamOptions} onChange={setTeamId} />
                )}
                <CustomSelect label="Проект" value={projectId} options={projectOptions} onChange={value => {
                  if (value === '__new_project__') setProjectFormOpen(true);
                  else setProjectId(value);
                }} />
              </div>

              <textarea
                className="tsk-textarea tsk-task-description"
                placeholder="Что нужно сделать и что считается результатом"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />

              <Files
                attachments={attachments}
                uploading={uploading}
                dragOver={dragOver}
                setDragOver={setDragOver}
                fileRef={fileRef}
                onAdd={addFiles}
                onRemove={index => setAttachments(list => list.filter((_, i) => i !== index))}
              />

              {/* Схема и итог живут в левой колонке, хотя цепочку составляют в
                  правой. Это сводка: «что за задача получилась» — тот же вопрос,
                  на который отвечают название и описание над ними. Заодно она
                  занимает место, которое при разбиении на части пустует, и
                  колонки перестают расходиться по высоте вдвое. */}
              {parts.length > 1 && <Chain parts={parts} byId={byId} taskTitle={title} />}

            </div>

            <div className="tsk-form-col">
              <div className="tsk-task-section-head">
                {parts.length > 1 ? `Подзадачи · ${parts.length}` : 'Исполнитель и время'}
              </div>

              {parts.map((part, index) => (
                <PartCard
                  key={part.key}
                  part={part}
                  index={index}
                  total={parts.length}
                  taskTitle={title}
                  people={people}
                  peopleLoading={peopleLoading}
                  byId={byId}
                  earlier={parts.slice(0, index)}
                  onChange={patch => setPart(part.key, patch)}
                  onRemove={parts.length > 1 ? () => removePart(part.key) : null}
                />
              ))}

              <button type="button" className="tsk-btn is-wide tsk-add-part" onClick={addPart}>
                + Подзадача
              </button>

              <Assessment
                overloads={overloads}
                parts={parts}
                loads={loads}
                byId={byId}
                me={ctx.me}
                choice={choice}
                setChoice={setChoice}
                explanation={explanation}
                setExplanation={setExplanation}
                onShift={shiftToNextFit}
                onGive={giveToFreePerson}
              />
            </div>

          </div>
        </div>

        <div className="tsk-modal-foot tsk-task-modal-foot">
          <div className="tsk-modal-hint">
            {!title.trim() ? 'Нужно название задачи'
              : !parts.every(p => p.assignees.length) ? 'У каждой подзадачи должен быть исполнитель'
              : missingSlot ? 'Не выбрано время в дне'
              : ''}
          </div>
          <div className="tsk-modal-btns">
            <button className="tsk-btn" onClick={onClose}>Отмена</button>
            <button className="tsk-btn is-primary" onClick={submit} disabled={!canSend || saving}>
              Создать задачу
            </button>
          </div>
        </div>
      </div>

      {projectFormOpen && <ProjectModal onClose={() => setProjectFormOpen(false)} onSaved={project => {
        setProjects(list => [...list, project].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
        setProjectId(project.id);
        setProjectFormOpen(false);
      }} />}
    </div>,
    document.body,
  );
}

/* ──────────────────────────── карточка части ──────────────────────────── */

/**
 * Одна часть: кто, когда и в какие часы.
 *
 * У задачи из одной части поля «название части» нет вовсе, и это не экономия
 * места. Пока оно рисовалось всегда, форма начиналась с подписи «Название
 * части — совпадает с названием задачи»: она спрашивала про сущность, которой
 * в задаче ещё не существует, и первым делом предлагала переписать то, что
 * только что ввели строкой выше. Часть появляется в тот момент, когда задачу
 * разбивают, — тогда же появляется и имя у неё.
 *
 * Внутри карточка разделена чертой: сверху кто делает, снизу когда. Это
 * разные вопросы, их и заполняют по отдельности.
 */
function PartCard({ part, index, total, taskTitle, people, peopleLoading, byId, earlier, onChange, onRemove }) {
  const hours = partHours(part);

  return (
    <div className="tsk-part">
      {total > 1 && (
        <div className="tsk-part-head">
          <span className="tsk-part-num">{index + 1}</span>
          <input
            className="tsk-input"
            placeholder={`Название подзадачи ${index + 1}`}
            value={part.title}
            onChange={e => onChange({ title: e.target.value })}
          />
          {onRemove && (
            <button type="button" className="tsk-x" aria-label="Убрать подзадачу" onClick={onRemove}>×</button>
          )}
        </div>
      )}

      <PeoplePicker
        people={people}
        loading={peopleLoading}
        selected={part.assignees}
        byId={byId}
        onChange={assignees => onChange({
          assignees,
          // День у нового человека свой: оставленное выделение показывало бы
          // занятость предыдущего.
          slot: assignees.join() === part.assignees.join() ? part.slot : null,
        })}
      />

      {part.assignees.length > 1 && (
        <div className="tsk-part-shared">
          <Badge tone="violet"><UsersIcon size={12} strokeWidth={2} /> Общая подзадача</Badge>
          <span>
            {hours > 0
              ? `${estimateText(hours)} занимают у каждого, ${hoursText(hours * part.assignees.length)} суммарно`
              : 'выбранный интервал займёт время у каждого из них'}
          </span>
        </div>
      )}

      <DayScale
        assignees={part.assignees}
        date={part.dueDate}
        slot={part.slot}
        onDate={dueDate => onChange({ dueDate, slot: null })}
        onSlot={slot => onChange({ slot })}
      />

      {/* Связь «после»: часть не появится во входящих, пока предыдущая не
          завершена. Показывается со второй части — у первой её быть не может. */}
      {index > 0 && (
        <div className="tsk-part-after">
          <span>Начинается после</span>
          <div className="tsk-chips">
            {earlier.map((prev, prevIndex) => (
              <button
                type="button"
                key={prev.key}
                className={`tsk-chip ${part.after.includes(prev.key) ? 'is-on' : ''}`}
                onClick={() => onChange({
                  after: part.after.includes(prev.key)
                    ? part.after.filter(x => x !== prev.key)
                    : [...part.after, prev.key],
                })}
              >
                {prev.title || taskTitle || `подзадача ${prevIndex + 1}`}
              </button>
            ))}
            {!part.after.length && <span className="tsk-part-after-none">ни от чего не зависит</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── шкала дня ───────────────────────────── */

/**
 * Рабочий день исполнителя в клетках по 15 минут.
 *
 * Заменила собой поле «Оценка». Число часов, вбитое отдельно от дня, ничего не
 * говорило о том, помещается ли работа: «2 ч» у человека с двумя свободными
 * окнами по часу — это не два часа. Выделяя интервал, автор отвечает на оба
 * вопроса сразу и видит, во что упирается.
 *
 * Занятость нескольких исполнителей объединяется: клетка занята, если она
 * занята хотя бы у одного. Общую часть нельзя поставить туда, где свободен
 * только один из троих, — и именно это шкала должна показывать, а не среднее
 * по команде.
 *
 * Содержания чужих дел здесь нет и быть не может: сервер отдаёт только границы
 * интервалов. Это то же обещание, что на экранах загрузки.
 */
function DayScale({ assignees, date, slot, onDate, onSlot }) {
  const [days, setDays] = useState({});
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(null);
  /**
   * Первое из двух нажатий: начало диапазона, конец которого ещё не выбран.
   *
   * Протаскивание мышью осталось, но одним им обойтись нельзя: чтобы понять,
   * что клетки надо тянуть, нужно сначала это откуда-то узнать, а до тех пор
   * шкала на нажатие отвечала выделением в одну клетку — пятнадцать минут
   * вместо часа. Нажатие по началу и нажатие по концу — то, что человек
   * пробует первым.
   */
  const [anchor, setAnchor] = useState(null);
  /** Где курсор — чтобы после первого нажатия диапазон тянулся за ним. */
  const [hover, setHover] = useState(null);
  /**
   * Мышь уже обработала это нажатие.
   *
   * Клетки — обычные кнопки, и с клавиатуры их жмут пробелом: браузер шлёт
   * только click, без mousedown и mouseup, на которых держится протаскивание.
   * Без этой отметки шкала работала бы одной мышью, а с ней click подхватывает
   * то, что мышь не обработала, и не срабатывает дважды после неё.
   */
  const byPointer = useRef(false);

  const key = `${[...assignees].sort().join(',')}|${date}`;
  useEffect(() => {
    if (!assignees.length || !date) return undefined;
    let alive = true;
    setLoading(true);
    Promise.all(assignees.map(id => api.getPersonSlots(id, date)
      .then(r => r.data)
      .catch(() => null)))
      .then(list => { if (alive) { setDays({ [key]: list.filter(Boolean) }); setLoading(false); } });
    return () => { alive = false; };
    // key собирает исполнителей и дату в одну строку: массив в зависимостях
    // менял бы идентичность на каждый рендер и тянул бы слоты бесконечно.
  }, [key, assignees, date]);

  const data = days[key];

  const grid = useMemo(() => {
    if (!data) return null;
    const starts = data.map(d => minutesOf(d.workDay?.start)).filter(v => v !== null);
    const ends = data.map(d => minutesOf(d.workDay?.end)).filter(v => v !== null);
    const anyWorking = data.some(d => d.workDay?.isWorking);

    // Полотно — по самой широкой смене, общее окно — по самой узкой: у двоих
    // исполнителей работа помещается только туда, где рабочее время у обоих.
    const from = starts.length ? Math.min(...starts) : minutesOf(FALLBACK_DAY.start);
    const to = ends.length ? Math.max(...ends) : minutesOf(FALLBACK_DAY.end);
    const openFrom = starts.length ? Math.max(...starts) : from;
    const openTo = ends.length ? Math.min(...ends) : to;

    const busy = data.flatMap(d => (d.slots || []).map(s => {
      const a = new Date(s.startTime);
      const b = new Date(s.endTime);
      return [a.getHours() * 60 + a.getMinutes(), b.getHours() * 60 + b.getMinutes()];
    }));

    const count = Math.max(Math.ceil((to - from) / STEP), 0);
    const cells = Array.from({ length: count }, (_, index) => {
      const startMinutes = from + index * STEP;
      const endMinutes = startMinutes + STEP;
      return {
        index,
        startMinutes,
        // Нерабочее время — вне общей смены: у человека с 10 до 19 утренние
        // клетки должны быть видимо чужими, а не просто свободными.
        outside: !anyWorking || startMinutes < openFrom || endMinutes > openTo,
        busy: busy.some(([a, b]) => a < endMinutes && b > startMinutes),
      };
    });
    return { cells, anyWorking };
  }, [data]);

  const commit = (from, to) => {
    if (!grid) return;
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    if (grid.cells.slice(start, end + 1).some(c => c.outside || c.busy)) {
      toast.error('В выделение попало занятое или нерабочее время');
      setAnchor(null);
      return;
    }
    setAnchor(null);
    onSlot({ start, end });
  };

  /**
   * Нажали по одной клетке: первое нажатие ставит начало, второе закрывает
   * диапазон, повторное по началу — отменяет.
   */
  const step = index => {
    if (anchor === null) { setAnchor(index); return; }
    if (anchor === index) { setAnchor(null); return; }
    commit(anchor, index);
  };

  /**
   * Что произошло — протаскивание или нажатие — видно только на отпускании
   * кнопки: до него оба начинаются одинаково.
   */
  const release = () => {
    if (!dragging) return;
    const { from, to } = dragging;
    setDragging(null);
    byPointer.current = true;
    if (from !== to) commit(from, to);
    else step(from);
  };

  if (!assignees.length) {
    return <div className="tsk-scale-hint">Выберите исполнителя</div>;
  }

  // Что подсвечено прямо сейчас: тянущийся диапазон, начатый двумя нажатиями
  // (хвост тянется за курсором) или уже выбранное время.
  const pending = anchor === null ? null : { from: anchor, to: hover === null ? anchor : hover };
  const live = (dragging && dragging.from !== dragging.to) ? dragging : pending;
  const selection = live
    ? { start: Math.min(live.from, live.to), end: Math.max(live.from, live.to) }
    : slot;
  const label = selection && grid
    ? `${timeText(grid.cells[selection.start].startMinutes)}–${timeText(grid.cells[selection.end].startMinutes + STEP)}`
    : null;
  const chosenHours = selection ? ((selection.end - selection.start + 1) * STEP) / 60 : 0;

  return (
    <div className="tsk-scale">
      <div className="tsk-scale-top">
        <input
          className="tsk-input tsk-scale-date"
          type="date"
          value={date}
          onChange={e => onDate(e.target.value)}
        />
        {/* Пока ничего не выделено, здесь пусто. Стояла подпись «Выделите
            время на шкале» — наставление в том месте, где и так видно, что
            выбирать: под ней лежит сама шкала. */}
        <div className={`tsk-scale-chosen ${selection ? 'is-set' : ''}`}>
          {selection && <><b>{label}</b><span>{clockText(chosenHours)}</span></>}
        </div>
        {(slot || anchor !== null) && (
          <button type="button" className="tsk-link-btn"
            onClick={() => { setAnchor(null); onSlot(null); }}>сбросить</button>
        )}
      </div>

      {loading || !grid ? (
        <div className="tsk-scale-hint">Смотрим занятое время…</div>
      ) : !grid.anyWorking ? (
        <div className="tsk-scale-hint is-bad">
          В этот день у исполнителя нет смены — выходной или расписание не настроено.
          Выберите другой день.
        </div>
      ) : (
        <>
          <div
            className="tsk-scale-grid"
            onMouseLeave={() => { setDragging(null); setHover(null); }}
            onMouseUp={release}
          >
            {grid.cells.map(cell => {
              const on = selection && cell.index >= selection.start && cell.index <= selection.end;
              return (
                <button
                  type="button"
                  key={cell.index}
                  title={`${timeText(cell.startMinutes)}–${timeText(cell.startMinutes + STEP)}${
                    cell.outside ? ' · нерабочее время' : cell.busy ? ' · занято' : ''}`}
                  className={[
                    'tsk-cell',
                    cell.outside ? 'is-outside' : cell.busy ? 'is-busy' : 'is-free',
                    on ? 'is-on' : '',
                    anchor === cell.index ? 'is-anchor' : '',
                    cell.startMinutes % 60 === 0 ? 'is-hour' : '',
                  ].filter(Boolean).join(' ')}
                  disabled={cell.outside || cell.busy}
                  onMouseDown={() => setDragging({ from: cell.index, to: cell.index })}
                  onMouseEnter={() => {
                    setHover(cell.index);
                    if (dragging) setDragging(d => ({ ...d, to: cell.index }));
                  }}
                  onClick={() => {
                    if (byPointer.current) { byPointer.current = false; return; }
                    step(cell.index);
                  }}
                >
                  {cell.startMinutes % 60 === 0 && (
                    <span>{String(Math.floor(cell.startMinutes / 60)).padStart(2, '0')}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="tsk-scale-legend">
            <span><i className="is-free" />свободно</span>
            <span><i className="is-busy" />занято</span>
            <span><i className="is-outside" />нерабочее</span>
            <span><i className="is-on" />выбрано</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ──────────────────────────── цепочка частей ──────────────────────────── */

/**
 * Схема цепочки — под частями, а не за вкладкой.
 *
 * Показывает то, чего не видно в списке карточек: что от чего зависит.
 * Часть без связей рисуется в своей колонке — значит, её можно делать
 * параллельно, и это единственный способ заметить, что цепочка на самом деле
 * распалась на два независимых потока.
 */
function Chain({ parts, byId, taskTitle }) {
  // Уровни: часть встаёт правее всех, от кого она зависит.
  const level = new Map();
  const depth = part => {
    if (level.has(part.key)) return level.get(part.key);
    const value = part.after.length
      ? 1 + Math.max(...part.after.map(k => {
        const prev = parts.find(p => p.key === k);
        return prev ? depth(prev) : -1;
      }))
      : 0;
    level.set(part.key, value);
    return value;
  };
  parts.forEach(depth);

  const columns = [];
  parts.forEach((part, index) => {
    const at = level.get(part.key);
    (columns[at] = columns[at] || []).push({ part, index });
  });

  return (
    <div className="tsk-chain">
      <div className="tsk-chain-head">
        <GitBranch size={14} strokeWidth={1.9} />
        Схема цепочки
      </div>
      <div className="tsk-chain-body">
        {columns.map((column, at) => (
          <React.Fragment key={at}>
            {at > 0 && <div className="tsk-chain-arrow">→</div>}
            <div className="tsk-chain-col">
              {column.map(({ part, index }) => (
                <div
                  className={`tsk-chain-node ${part.assignees.length > 1 ? 'is-shared' : ''} ${
                    part.assignees.length ? '' : 'is-empty'}`}
                  key={part.key}
                >
                  <div className="tsk-chain-title">
                    <b>{index + 1}</b>
                    {part.title || taskTitle || `Подзадача ${index + 1}`}
                  </div>
                  <div className="tsk-chain-meta">
                    {part.assignees.map(id => shortName(byId[id])).join(', ') || 'без исполнителя'}
                    {partHours(part) > 0 && ` · ${estimateText(partHours(part))}`}
                  </div>
                </div>
              ))}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────── файлы ──────────────────────────────── */

/**
 * Вложения заметной зоной, а не строчкой «Файлы · Прикрепить».
 *
 * Жаловались, что файлов не видно: прежний блок был подписью с маленькой
 * кнопкой справа, визуально неотличимой от служебных подписей формы, и его
 * просто не замечали. Здесь это площадка с рамкой, в которую можно бросить
 * файл мышью, — она занимает место ровно потому, что должна попадаться на
 * глаза.
 */
function Files({ attachments, uploading, dragOver, setDragOver, fileRef, onAdd, onRemove }) {
  const sizeText = size => {
    const bytes = Number(size) || 0;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${bytes} Б`;
  };

  return (
    <>
      <div className="tsk-task-section-head">
        Файлы{attachments.length ? ` · ${attachments.length}` : ''}
      </div>
      <div
        className={`tsk-dropzone ${dragOver ? 'is-over' : ''} ${uploading ? 'is-busy' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          onAdd(e.dataTransfer.files);
        }}
        onClick={() => !uploading && fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" multiple hidden
          onChange={e => onAdd(e.target.files)} />
        <Upload size={22} strokeWidth={1.7} />
        <div className="tsk-dropzone-text">
          {uploading
            ? 'Загружаем…'
            : <>Перетащите файлы сюда или <b>выберите на компьютере</b></>}
        </div>
        <div className="tsk-dropzone-sub">до 10 файлов</div>
      </div>

      {!!attachments.length && (
        <div className="tsk-files">
          {attachments.map((file, index) => (
            <div className="tsk-file" key={`${file.id}-${index}`}>
              <span className="tsk-file-icon"><Paperclip size={13} strokeWidth={1.9} /></span>
              <span className="tsk-file-name">{file.filename}</span>
              <span className="tsk-file-size">{sizeText(file.size)}</span>
              <button type="button" className="tsk-x" aria-label={`Убрать ${file.filename}`}
                onClick={() => onRemove(index)}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ─────────────────────────── выбор исполнителей ─────────────────────────── */

function PeoplePicker({ people, loading, selected, byId, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  // Ищем по полному ФИО, а показываем коротко: набрать отчество — законный
  // способ отличить двух однофамильцев, и отбирать его из-за того, что мы его
  // не рисуем, незачем.
  const matches = people.filter(person => !selected.includes(person.id)
    && (!query.trim() || userName(person).toLowerCase().includes(query.trim().toLowerCase()))).slice(0, 12);

  useEffect(() => {
    if (!open) return undefined;
    const close = event => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const position = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(window.innerWidth - 16, Math.max(rect.width, 280));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 210 && above > below;
      const maxHeight = Math.max(120, Math.min(260, (up ? above : below) - 8));
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setMenuStyle(up
        ? { position: 'fixed', left, bottom: window.innerHeight - rect.top + 6, width, maxHeight }
        : { position: 'fixed', left, top: rect.bottom + 6, width, maxHeight });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);

  const add = userId => {
    onChange([...selected, userId]);
    setQuery('');
    setOpen(false);
  };

  return <div className="tsk-people-picker" ref={rootRef}>
    {/* Фамилия и имя, как во всём модуле. Полное ФИО с отчеством не помещалось
        ни в бейдж, ни в строку списка и обрывалось многоточием ровно там, где
        начинается отчество, — то есть на месте, которое ничего не различает.
        Целиком его показывает подсказка. */}
    {!!selected.length && <div className="tsk-picker-selected">
      {selected.map(userId => { const user = byId[userId]; return <div key={userId} title={userName(user)}>
        <Avatar user={user} size={24} /><span>{shortName(user)}</span>
        <button type="button" aria-label={`Убрать ${shortName(user)}`}
          onClick={() => onChange(selected.filter(id => id !== userId))}>×</button>
      </div>; })}
    </div>}
    <input className="tsk-input" value={query}
      placeholder={loading ? 'Загружаем сотрудников…'
        : selected.length ? 'Добавить ещё исполнителя' : 'Найти сотрудника'}
      disabled={loading}
      onFocus={() => { setMenuStyle(null); setOpen(true); }}
      // Клик открывает список наравне с фокусом, и это не дубль. Выбрав
      // человека, поле фокус не теряет — список закрылся, а фокус остался, — и
      // на повторное нажатие onFocus уже не приходит. Второго исполнителя
      // приходилось добывать, щёлкнув мимо поля и вернувшись, или вслепую начав
      // печатать. Выглядело это как «поле перестало работать».
      //
      // Позицию здесь НЕ сбрасываем, в отличие от onFocus. При обычном нажатии
      // мышью события идут подряд: focus открывает меню и считает координаты,
      // click приходит следом — и если бы он тоже обнулял menuStyle, меню
      // исчезало бы сразу после появления. Пересчитать координаты эффект не
      // может: open к тому моменту уже true и повторно он не срабатывает.
      onClick={() => setOpen(true)}
      onChange={event => { setQuery(event.target.value); setOpen(true); }} />
    {open && menuStyle && createPortal(<div className="tsk-people-menu" ref={menuRef} style={menuStyle}>
      {matches.length ? matches.map(person => <button type="button" key={person.id}
        title={userName(person)}
        onClick={() => add(person.id)}>
          <Avatar user={person} size={26} />
          <span>
            {shortName(person)}
            {person.position && <em>{person.position}</em>}
          </span>
        </button>)
        : <div className="tsk-people-menu-empty">
          {query.trim()
            ? 'Никого не найдено среди заведённых в модуле'
            : 'В модуле пока никого не завели: нужно рабочее расписание в разделе «Люди»'}
        </div>}
    </div>, document.body)}
  </div>;
}

/* ─────────────────── разбор загрузки и выбор компромисса ─────────────────── */

function Assessment({ overloads, parts, loads, byId, me, choice, setChoice, explanation, setExplanation, onShift, onGive }) {
  const first = parts[0];
  if (!first.assignees.length || !first.slot) return null;

  // Разбор показывается, только когда что-то не так. Зелёная плашка
  // «Помещается» стояла под каждой задачей и сообщала, что всё в порядке, —
  // а это и так состояние по умолчанию: непомещающихся задач единицы, и
  // подтверждение нормы висело постоянным фоном, на котором предупреждение
  // переставало выделяться.
  if (!overloads.length) return null;

  const vacation = overloads.filter(o => o.reason === 'vacation');
  const dayOff = overloads.filter(o => o.reason === 'day_off');
  const noNorm = overloads.filter(o => o.reason === 'no_norm');
  const over = overloads.filter(o => o.reason === 'overload');

  return (
    <div className="tsk-assessment-panel">
      <div className="tsk-assessment-title">Не помещается</div>
      <div className="tsk-assessment-details">
        {vacation.map(o => <div key={`v${o.userId}`}>{shortName(byId[o.userId])}: отпуск</div>)}
        {dayOff.map(o => <div key={`d${o.userId}`}>{shortName(byId[o.userId])}: выходной</div>)}
        {noNorm.map(o => (
          <div key={`n${o.userId}`}>{shortName(byId[o.userId])}: рабочее расписание не настроено.</div>
        ))}
        {over.map(o => (
          <div key={`o${o.userId}${o.date}`}>
            {shortName(byId[o.userId])}: станет <b>{hoursText(o.after)}</b> при норме {hoursText(o.norm)} —
            переработка {hoursText(o.over)}.
          </div>
        ))}
      </div>

      {!!over.length && (
        <>
          <div className="tsk-assessment-actions">
            <button type="button" className={choice === 'shift' ? 'is-on' : ''} onClick={onShift}>Другой день</button>
            {parts.length === 1 && first.assignees.length === 1 && (
              <button type="button" className={choice === 'give' ? 'is-on' : ''} onClick={onGive}>Другой сотрудник</button>
            )}
            <button type="button" className={choice === 'force' ? 'is-on' : ''}
              onClick={() => setChoice('force')}>Всё равно</button>
          </div>
          {choice === 'force' && (
            <textarea
              className="tsk-textarea"
              placeholder="Почему это всё равно должно быть сделано в этот срок"
              value={explanation}
              onChange={event => setExplanation(event.target.value)}
            />
          )}
        </>
      )}
    </div>
  );
}
