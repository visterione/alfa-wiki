/**
 * Карточка задачи.
 *
 * Отличается от карточки на доске одним разделом — историей. Срок здесь не
 * поле, а результат переговоров: кто предложил, кто перенёс, кто согласовал и
 * какое объяснение приложил автор, продавивший задачу в переполненный день.
 * Без этой ленты «срок сдвинулся» выглядит как факт природы.
 */

import React, { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import {
  CalendarClock, CheckCircle2, ClipboardCheck, Clock, Clock3, RotateCcw,
  FileText, GitBranch, History, Shield, Lock,
} from 'lucide-react';
import { tasks as api, BASE_URL } from '../../../services/api';
import {
  STATUS_LABEL, STATUS_ICON, STATUS_COLOR, userName, shortName, partCode,
} from '../utils/labels';
import { hoursText, ddate, dfull, dnum, dateRange, addDays, clockText } from '../utils/dates';
import { Badge, Avatar, AvatarStack, Empty, useMaskClose } from './Bits';
import LayoutEditor from './LayoutEditor';
import DueRange, { spanDays } from './DueRange';

/**
 * Продление: не одна кнопка «+30 минут», а выбор.
 * Полчаса хватало не всегда, и человек нажимал её по четыре раза подряд —
 * каждый раз с запросом на сервер и пересчётом дня.
 */
const EXTEND_OPTIONS = [
  [0.25, '15 мин'],
  [0.5, '30 мин'],
  [1, '1 ч'],
  [2, '2 ч'],
  [4, '4 ч'],
];

/** Человеческие формулировки событий истории. */
function historyText(row) {
  const p = row.payload || {};
  switch (row.action) {
    case 'created':
      return p.parts > 1
        ? `создал задачу из ${p.parts} подзадач на ${p.people} чел.`
        : 'создал задачу';
    case 'planned':
      // Многодневная подзадача пишет в историю раскладку, а не день: «взял в
      // план на 22-е» у работы на неделю — неправда, и по такой записи нельзя
      // понять, сколько человек на неё отвёл.
      if (p.until && p.until !== p.date) {
        const spread = (p.layout || []).map(row => `${dnum(row.date)} — ${hoursText(row.hours)}`).join(', ');
        return p.overload
          ? `разложил на ${(p.layout || []).length} дн. сверх нормы: ${spread}`
          : `разложил на ${(p.layout || []).length} дн.: ${spread}`;
      }
      return p.overload
        ? `взял в план на ${ddate(p.date)} сверх нормы — стало ${hoursText(p.after)} из ${hoursText(p.norm)}`
        : `поставил в план на ${ddate(p.date)}`;
    case 'proposed_date':
      return `предложил срок ${p.toStart ? `${dnum(p.toStart)} — ${dnum(p.to)}` : ddate(p.to)}${
        p.busyHours !== null && p.busyHours !== undefined
          ? ` — было занято ${hoursText(p.busyHours)} из ${hoursText(p.norm)}` : ''}`;
    case 'accepted_date': return `согласовал срок ${ddate(p.date)}`;
    case 'declined': return 'вернул задачу автору с пометкой «не моя зона»';
    case 'moved': {
      const where = p.toStart && p.toStart !== p.to
        ? `на ${dnum(p.toStart)} — ${dnum(p.to)}`
        : `на ${ddate(p.to)}`;
      return p.becameStuck
        ? `перенёс ${where} — третий перенос, задача требует решения`
        : `перенёс ${where}`;
    }
    case 'stretched':
      return p.from
        ? `изменил срок: работа идёт ${dnum(p.from)} — ${dnum(p.to)}`
        : `изменил срок: снова один день, ${ddate(p.to)}`;
    case 'extended': return `продлил: ${hoursText(p.from)} → ${hoursText(p.to)}`;
    case 'split': return `разбил подзадачу: ${hoursText(p.head)} + ${hoursText(p.tail)}`;
    case 'forced': return `продавил проверку загрузки: «${p.explanation}»`;
    case 'status_changed': return `${STATUS_LABEL[p.from] || p.from} → ${STATUS_LABEL[p.to] || p.to}`;
    case 'team_changed':
      return p.to
        ? `открыл задачу команде «${p.to}»`
        : `убрал задачу из команды${p.from ? ` «${p.from}»` : ''} — снова видят только участники`;
    default: return row.action;
  }
}

function historyTone(row) {
  if (row.action === 'declined' || row.action === 'forced') return 'bad';
  // Смена видимости — не хорошее и не плохое событие, но заметное: круг
  // читающих задачу изменился, и в ленте это должно бросаться в глаза.
  if (row.action === 'team_changed') return 'violet';
  if (row.action === 'moved' || row.action === 'extended' || row.action === 'proposed_date'
    || row.action === 'stretched') return 'warn';
  if (row.action === 'planned' || row.action === 'accepted_date') return 'ok';
  if (row.action === 'status_changed') {
    if (row.payload?.to === 'done') return 'ok';
    if (row.payload?.to === 'review') return 'violet';
    return 'info';
  }
  if (row.action === 'split') return 'violet';
  return 'info';
}

/**
 * Что означает новый срок: перенос или другую длительность работы.
 *
 * Различие не косметическое, и потому его считают, а не спрашивают. Перенос —
 * «эта работа делается не на той неделе, а на следующей», и он идёт в счётчик
 * трёх переносов. Другая длительность — «работа идёт не день, а пять», и она
 * счётчик обнуляет: условия переписаны, и наследовать новой работе приговор
 * предыдущей неправильно.
 *
 * Ту же границу держит сервер: /move отказывает, если длина изменилась, а
 * /stretch — если не изменилась. Без второй проверки «растягиванием» на ту же
 * длину можно было бы двигать работу сколько угодно, ни разу не дойдя до
 * разговора о том, почему она не делается.
 */
function rescheduleKind(part, from, to) {
  if (!to) return null;
  const was = spanDays(part.startDate || part.dueDate, part.dueDate);
  const now = spanDays(from || to, to);
  if (was !== now) return 'stretch';
  const sameStart = String(part.startDate || part.dueDate) === String(from || to);
  return sameStart ? null : 'move';
}

export default function TaskCard({ taskId, ctx, onClose, onChanged }) {
  const maskProps = useMaskClose(onClose);
  const [task, setTask] = useState(null);
  const [busy, setBusy] = useState(false);
  /**
   * Какая подзадача сейчас меняет срок и на какой.
   *
   * Один набор состояния, а не два. Раньше рядом стояли «Перенести» и
   * «Растянуть» с двумя панелями и двумя парами полей — две кнопки про одно и то
   * же поле. Теперь срок меняют одним контролом, а перенос это или другая
   * длительность, выводится из того, изменилась ли длина: см. rescheduleKind.
   */
  const [reschedulePart, setReschedulePart] = useState(null);
  const [dueFrom, setDueFrom] = useState(null);
  const [dueTo, setDueTo] = useState('');
  // Какая часть сейчас спрашивает «завершаем или на проверку» и какая — «на
  // сколько продлить». Строкой с id, а не флагом: частей в задаче несколько.
  const [finishingPart, setFinishingPart] = useState(null);
  const [extendingPart, setExtendingPart] = useState(null);
  // Какая подзадача сейчас раскладывается по дням и какая — растягивается на
  // окно. Обе строкой с id, по той же причине: подзадач в задаче несколько.
  const [layoutPart, setLayoutPart] = useState(null);
  const [tab, setTab] = useState('main');
  const [teamOpen, setTeamOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.getTask(taskId);
      setTask(data);
    } catch {
      toast.error('Не удалось открыть задачу');
      onClose();
    }
  }, [taskId, onClose]);

  useEffect(() => { reload(); }, [reload]);

  const act = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      toast.success(message);
      await reload();
      onChanged?.();
    } catch (error) {
      const payload = error?.response?.data;
      // 409 после третьего переноса — не ошибка, а требование решения.
      toast.error(payload?.error || 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Смена команды подтверждается вопросом, и это не лишний клик.
   *
   * Привязка открывает описание и файлы десятку человек разом, снятие — так же
   * молча их закрывает. Оба действия необратимы по сути: прочитанное обратно не
   * забудешь. Поэтому здесь спрашивают, хотя в остальной карточке подтверждений
   * почти нет.
   */
  const changeTeam = async (nextTeamId, nextName) => {
    const question = nextTeamId
      ? `Открыть задачу команде «${nextName}»? Её состав увидит название, описание и файлы.`
      : 'Убрать задачу из команды? Её снова будут видеть только исполнители, автор и руководитель над исполнителем.';
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      await api.setTaskTeam(taskId, nextTeamId);
      toast.success(nextTeamId ? `Задача открыта команде «${nextName}»` : 'Задача снова личная');
      setTeamOpen(false);
      await reload();
      onChanged?.();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Не удалось изменить команду задачи');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Открыть правку срока.
   *
   * Второй аргумент — предложенный конец: им пользуется выход из «анализируется»,
   * где человеку сразу предлагают срок подлиннее, потому что именно за этим он
   * туда и пришёл. В обычном случае срок открывается тем, какой есть, и
   * предлагать за человека нечего.
   */
  const openReschedule = (part, suggestedTo) => {
    const from = part.startDate || String(part.dueDate);
    const to = suggestedTo || String(part.dueDate);
    setReschedulePart(part.id);
    setDueFrom(from === to ? null : from);
    setDueTo(to);
    setFinishingPart(null);
    setExtendingPart(null);
    setLayoutPart(null);
  };

  const cancel = async () => {
    if (!window.confirm('Отменить задачу? Запланированное время вернётся людям в свободное.')) return;
    try {
      await api.cancelTask(taskId);
      toast.success('Задача отменена. После нескольких переносов это чаще всего верное решение');
      onChanged?.();
      onClose();
    } catch {
      toast.error('Не удалось отменить задачу');
    }
  };

  // Порталом в body: у .tsk свой контекст наложения, и внутри него затемнение
  // обрывалось по краю рабочего полотна — шапка портала и боковая панель
  // оставались поверх окна незатемнёнными.
  if (!task) {
    return createPortal(
      <div className="tsk-mask" {...maskProps}>
        <div className="tsk-modal"><div className="tsk-modal-body"><Empty compact>Загружаем…</Empty></div></div>
      </div>,
      document.body,
    );
  }

  const users = (task.parts || [])
    .flatMap(p => (p.assignees || []).map(a => a.user))
    .filter((u, i, arr) => u && arr.findIndex(x => x?.id === u.id) === i);
  const isAuthor = task.authorId === ctx.me?.id;
  /**
   * Менять круг читающих вправе автор и руководитель команды, в которой задача
   * сейчас лежит. Второе — чтобы было кому убрать из команды то, что попало
   * туда по ошибке: иначе это мог бы сделать только автор, а его может уже и не
   * быть в компании. Это же правило проверяет сервер, здесь оно только прячет
   * кнопку, которая всё равно получила бы 403.
   */
  const canChangeTeam = isAuthor || (task.team
    && (ctx.access?.teams || []).some(team => team.id === task.team.id && team.isLead));

  return createPortal(
    <div className="tsk-mask tsk-task-card-mask" {...maskProps}>
      <div className="tsk-modal tsk-task-card-modal">
        <div className="tsk-modal-head">
          <div className="tsk-modal-title">
            {/* Код над названием: именно им задачу называют вслух, и в открытой
                карточке он должен читаться сразу, а не искаться по мелочи. */}
            {task.code && <span className="tsk-code is-lead">{task.code}</span>}
            {task.title}
          </div>
          <button className="tsk-x" onClick={onClose}>×</button>
        </div>

        {/* Карточка разложена по вкладкам: раньше это была одна лента, в
            которой части, схема и история шли подряд, и до истории добирались
            прокруткой мимо всего остального. Схемы нет у задачи из одной части
            — рисовать вкладку с одной строкой незачем. */}
        <TaskTabs tab={tab} onTab={setTab} hasScheme={(task.parts?.length || 0) > 1} />

        <div className="tsk-modal-body tsk-task-card-body">
          {tab === 'main' && (<>
          <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <div>
              Автор
              <div style={{ color: 'var(--text-primary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
                <Avatar user={task.author} size={20} /> <span title={userName(task.author)}>{shortName(task.author)}</span>
              </div>
            </div>
            <div>
              Исполнители
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AvatarStack users={users} size={20} />
                <span style={{ color: 'var(--text-primary)' }}>{users.length}</span>
              </div>
            </div>
            {/* Кому задача видна — такой же реквизит, как автор и исполнители, и
                стоять должен рядом с ними. Прятать это в настройки нельзя: круг
                читающих — первое, что человек должен узнать об открытой
                карточке, особенно если он в ней что-то пишет. */}
            {/* Одна дата, а не две. Стояли «Срок задачи» и рядом «по
                подзадачам» — два ответа на один вопрос, причём у обычной задачи
                на один день второй превращался в «25.09.26 — 25.09.26» и сбивал
                с толку. Свой срок у задачи есть — показываем его; нет —
                показываем, на какие дни она расписана. Расхождение важно только
                когда оно есть, и тогда о нём говорит бейдж, а какая именно
                подзадача вылезла — отметка на ней самой, ниже. */}
            {(task.dueDate || task.span) && (
              <div>
                {task.dueDate ? 'Срок задачи' : 'Расписана на'}
                <div style={{ color: 'var(--text-primary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
                  {task.dueDate
                    ? dateRange(task.startDate || task.dueDate, task.dueDate)
                    : dateRange(task.span.from, task.span.to)}
                  {task.breaksDeadline && <Badge tone="bad">срок нарушен</Badge>}
                </div>
              </div>
            )}
            <div>
              Кому видна
              <div style={{ color: 'var(--text-primary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
                {task.team
                  ? <><Shield size={14} strokeWidth={1.9} /> {task.team.name}</>
                  : <><Lock size={14} strokeWidth={1.9} /> Без команды</>}
                {canChangeTeam && (
                  <button type="button" className="tsk-link-btn" onClick={() => setTeamOpen(true)}>
                    изменить
                  </button>
                )}
              </div>
            </div>
          </div>

          {teamOpen && (
            <TeamBinding
              task={task}
              ctx={ctx}
              busy={busy}
              onClose={() => setTeamOpen(false)}
              onPick={changeTeam}
            />
          )}

          {task.description && (
            <>
              <div className="tsk-sect">Описание</div>
              <div className="tsk-task-card-description">
                {task.description}
              </div>
            </>
          )}

          {!!task.attachments?.length && (
            <>
              <div className="tsk-sect">Файлы · {task.attachments.length}</div>
              <div className="tsk-files">
                {task.attachments.map((file, index) => (
                  <a
                    className="tsk-file"
                    key={file.id || file.path || index}
                    href={`${BASE_URL}/${String(file.path || '').replace(/^\//, '')}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="tsk-file-icon">{String(file.filename || 'file').split('.').pop()?.slice(0, 4)}</span>
                    <span className="tsk-file-name">{file.filename || file.originalName || 'Вложение'}</span>
                    <span className="tsk-file-open">Открыть</span>
                  </a>
                ))}
              </div>
            </>
          )}

          <div className="tsk-sect">Подзадачи · {task.parts?.length || 0}</div>
          {/* Тот же порядок, что и в схеме: номер части — это её место в
              задаче, и в двух вкладках он обязан совпадать. */}
          {[...(task.parts || [])]
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
            .map((part, index) => {
            const notPlanned = (part.assignees || []).filter(a => !a.plannedDate);
            const mine = (part.assignees || []).find(a => a.userId === ctx.me?.id);
            // Многодневная подзадача: окно [startDate..dueDate]. Совпадающие
            // концы — это по-прежнему один день, и рисовать для них диапазон
            // значило бы сообщать о протяжённости, которой нет.
            const windowed = !!part.startDate && String(part.startDate) !== String(part.dueDate);
            const frame = { from: part.startDate || part.dueDate, to: String(part.dueDate) };
            const windowDays = Math.round(
              (new Date(`${frame.to}T00:00:00`) - new Date(`${frame.from}T00:00:00`)) / 86400000
            ) + 1;
            const partHistory = (task.history || []).filter(row => row.partId === part.id);
            const lastProposal = partHistory.map(row => row.action).lastIndexOf('proposed_date');
            const lastAccept = partHistory.map(row => row.action).lastIndexOf('accepted_date');
            const hasPendingProposal = lastProposal > lastAccept;
            const StatusIcon = STATUS_ICON[part.status];
            return (
              <div className="tsk-part" key={part.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    {task.code && <div className="tsk-code">{partCode(task.code, task.parts.length > 1 ? index : null)}</div>}
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{part.title}</div>
                  </div>
                  {/* Статус иконкой, как в таблице задач: подпись повторяла то,
                      что и так видно по кнопкам действий ниже. */}
                  <span className="tsk-part-status" title={STATUS_LABEL[part.status]}>
                    {StatusIcon && <StatusIcon size={18} strokeWidth={1.8} color={STATUS_COLOR[part.status]} />}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <AvatarStack users={(part.assignees || []).map(a => a.user).filter(Boolean)} size={18} />
                  {(part.assignees || []).map(a => shortName(a.user)).join(', ')}
                  <span className="tsk-hours-chip">
                    <Clock size={13} strokeWidth={1.9} />{clockText(part.estimateHours)}
                  </span>
                  {' · '}{windowed
                    ? <>{dateRange(frame.from, frame.to)} <Badge tone="muted">{windowDays} дн.</Badge></>
                    : ddate(String(part.dueDate))}
                  {part.assignees?.length > 1 && <Badge tone="violet">общая</Badge>}
                  {/* Раскладка своей подзадачи: на какие дни человек её
                      разложил. Срок говорит, к чему она должна быть сделана, а
                      это — когда он над ней сидит. */}
                  {windowed && mine?.plannedDate && mine?.plannedUntil && (
                    <Badge tone="ok">в плане {dateRange(mine.plannedDate, mine.plannedUntil)}</Badge>
                  )}
                  {part.moveCount > 0 && (
                    <Badge tone={part.moveCount >= 3 ? 'bad' : 'warn'}>
                      переносов: {part.moveCount}
                    </Badge>
                  )}
                </div>

                {/* Какая подзадача вышла за срок задачи — видно на ней самой.
                    Признак считает сервер (partsService.partOutsideTask): в
                    карточке он должен совпадать с тем, что видит автор в форме. */}
                {part.outsideTask && (
                  <div className="tsk-part-outside">
                    {part.outsideTask === 'after'
                      ? `выходит за срок задачи${task.dueDate ? ` — ${dnum(task.dueDate)}` : ''}`
                      : `начинается раньше срока задачи${task.startDate ? ` — ${dnum(task.startDate)}` : ''}`}
                  </div>
                )}

                {!!notPlanned.length && (
                  <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
                    Не обработали: {notPlanned.map(a => shortName(a.user)).join(', ')}
                  </div>
                )}

                {/* Застрявшая часть: кнопки «перенести ещё раз» здесь нет
                    специально — после третьего переноса нужен выбор. */}
                {part.status === 'stuck' && (
                  <div className="tsk-trade is-bad" style={{ marginTop: 12 }}>
                    <div className="tsk-trade-title">Требует решения</div>
                    <div className="tsk-trade-text">
                      Подзадача переносится третий раз подряд. Обычно это значит, что
                      она слишком крупная, идёт дольше одного дня или на самом деле
                      не нужна.
                    </div>
                    <div className="tsk-acts" style={{ marginTop: 10 }}>
                      <button className="tsk-btn" disabled={busy}
                        onClick={() => act(() => api.splitPart(part.id, {}), 'Разбито надвое — теперь подзадачи мельче и помещаются в день')}>
                        Разбить на подзадачи
                      </button>
                      {/* Третий выход (ver. 8.48): работа и не должна была
                          помещаться в день. Раньше это приходилось изображать
                          четырьмя подзадачами «Вёрстка (1/4)», и три переноса
                          считались каждому куску отдельно. Ведёт в тот же
                          контрол срока, что и обычное изменение: отдельной
                          возможности «растянуть» в модуле нет. */}
                      <button className="tsk-btn" disabled={busy}
                        onClick={() => openReschedule(part, addDays(frame.to, 4))}>
                        Работа идёт несколько дней
                      </button>
                      {isAuthor && (
                        <button className="tsk-btn is-danger" onClick={cancel}>Отменить задачу</button>
                      )}
                    </div>
                  </div>
                )}

                {mine && part.status !== 'stuck' && (
                  <div className="tsk-part-actions">
                    {!mine.plannedDate ? (
                      <button className="tsk-part-action is-plan" disabled={busy}
                        onClick={() => (windowed
                          ? setLayoutPart(layoutPart === part.id ? null : part.id)
                          : act(
                            () => api.planPart(part.id, String(part.dueDate)),
                            `В плане на ${dfull(String(part.dueDate))}`
                          ))}>
                        <CalendarClock size={15} />
                        {windowed ? 'Разложить по дням' : 'Взять в план'}
                      </button>
                    ) : (
                      <>
                        {/* «Готово» вместо двух кнопок «Завершить» и «На
                            проверку». Это один и тот же момент — работа сделана,
                            — и разница только в том, смотрит ли её кто-то после.
                            Спрашиваем один раз вместо того, чтобы держать на
                            виду обе кнопки. */}
                        {part.status !== 'done' && (
                          <button className="tsk-part-action is-complete" disabled={busy}
                            onClick={() => {
                              setFinishingPart(finishingPart === part.id ? null : part.id);
                              setExtendingPart(null);
                            }}>
                            <CheckCircle2 size={15} />Готово
                          </button>
                        )}
                        {part.status !== 'done' && (
                          <button className="tsk-part-action" disabled={busy}
                            onClick={() => {
                              setExtendingPart(extendingPart === part.id ? null : part.id);
                              setFinishingPart(null);
                            }}>
                            <Clock3 size={15} />Продлить
                          </button>
                        )}
                        {/* Одна кнопка на перенос и на другую длительность:
                            и то и другое — новый срок, и спрашивать об этом
                            дважды незачем. Чем обернётся правка, показывает сама
                            панель по ходу выбора. */}
                        {part.status !== 'done' && (
                          <button className="tsk-part-action" disabled={busy}
                            onClick={() => openReschedule(part)}>
                            <CalendarClock size={15} />Изменить срок
                          </button>
                        )}
                        {part.status === 'done' && (
                          <button className="tsk-part-action" disabled={busy}
                            onClick={() => act(() => api.setPartStatus(part.id, 'work'), 'Возвращено в работу')}>
                            <RotateCcw size={15} />Вернуть в работу
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

                {isAuthor && !mine && part.status === 'new' && hasPendingProposal && (
                  <div className="tsk-acts" style={{ marginTop: 10 }}>
                    <button className="tsk-btn is-sm" disabled={busy}
                      onClick={() => act(() => api.acceptDate(part.id),
                        `Срок согласован: ${dfull(String(part.dueDate))}`)}>
                      Согласовать срок
                    </button>
                  </div>
                )}

                {finishingPart === part.id && (
                  <div className="tsk-choice">
                    <span className="tsk-choice-title">Работа сделана —</span>
                    <button className="tsk-part-action is-complete" disabled={busy}
                      onClick={() => act(
                        () => api.setPartStatus(part.id, 'done'),
                        'Завершено. Время освободилось — день пересчитан'
                      ).then(() => setFinishingPart(null))}>
                      <CheckCircle2 size={15} />Завершить
                    </button>
                    <button className="tsk-part-action is-review" disabled={busy || part.status === 'review'}
                      onClick={() => act(
                        () => api.setPartStatus(part.id, 'review'),
                        'Отправлено на проверку'
                      ).then(() => setFinishingPart(null))}>
                      <ClipboardCheck size={15} />
                      {part.status === 'review' ? 'Уже на проверке' : 'На проверку'}
                    </button>
                    <button className="tsk-part-action" onClick={() => setFinishingPart(null)}>Отмена</button>
                  </div>
                )}

                {extendingPart === part.id && (
                  <div className="tsk-choice">
                    <span className="tsk-choice-title">Добавить к оценке</span>
                    {EXTEND_OPTIONS.map(([hours, label]) => (
                      <button className="tsk-part-action" key={hours} disabled={busy}
                        onClick={() => act(
                          () => api.extendPart(part.id, hours),
                          `Продлено на ${label} — загрузка пересчитана`
                        ).then(() => setExtendingPart(null))}>
                        {label}
                      </button>
                    ))}
                    <button className="tsk-part-action" onClick={() => setExtendingPart(null)}>Отмена</button>
                  </div>
                )}

                {/* Раскладка многодневной подзадачи по дням окна. */}
                {layoutPart === part.id && (
                  <LayoutEditor
                    window={frame}
                    estimateHours={part.estimateHours}
                    userId={ctx.me?.id}
                    busy={busy}
                    onCancel={() => setLayoutPart(null)}
                    onSubmit={(layout, force) => act(
                      () => api.planPartLayout(part.id, layout, force),
                      `В плане: ${layout.length} дн., ${hoursText(part.estimateHours)}`
                    ).then(() => setLayoutPart(null))}
                  />
                )}

                {/* Новый срок — одним контролом. Что он означает и чем
                    обернётся, панель говорит по ходу выбора: молчаливая развилка
                    между «+1 перенос» и «счётчик обнулён» была бы магией. */}
                {reschedulePart === part.id && (
                  <div className="tsk-reschedule">
                    <DueRange from={dueFrom} to={dueTo}
                      onChange={({ from, to }) => { setDueFrom(from); setDueTo(to); }} />
                    <div className="tsk-reschedule-what">
                      {(() => {
                        const kind = rescheduleKind(part, dueFrom, dueTo);
                        const days = spanDays(dueFrom || dueTo, dueTo);
                        if (!kind) return 'Выберите другой срок — день или несколько.';
                        if (kind === 'move') {
                          return part.moveCount >= 2
                            ? 'Это перенос, и он третий: подзадача уйдёт в «анализируется», и дальше понадобится решение, а не перенос.'
                            : `Это перенос: длительность та же. Счётчик переносов станет ${part.moveCount + 1} из 3.`;
                        }
                        return days > 1
                          ? `Работа будет идти ${days} дн. Подзадача вернётся во входящие — часы по дням надо будет разложить заново, и счётчик переносов обнулится.`
                          : 'Работа снова станет однодневной. Подзадача вернётся во входящие, счётчик переносов обнулится.';
                      })()}
                    </div>
                    <div className="tsk-acts">
                      <button className="tsk-btn is-primary"
                        disabled={busy || !rescheduleKind(part, dueFrom, dueTo)}
                        onClick={() => {
                          const kind = rescheduleKind(part, dueFrom, dueTo);
                          const days = spanDays(dueFrom || dueTo, dueTo);
                          const label = dueFrom ? `${dnum(dueFrom)} — ${dnum(dueTo)}` : dfull(dueTo);
                          return act(
                            () => (kind === 'move'
                              ? api.movePart(part.id, dueFrom || dueTo, dueFrom ? dueTo : undefined)
                              : api.stretchPart(part.id, dueFrom || dueTo, dueTo)),
                            kind === 'move'
                              ? `Перенесено на ${label}`
                              : days > 1
                                ? `Срок: ${label}. Осталось разложить часы по дням`
                                : `Снова один день — ${label}`
                          ).then(() => setReschedulePart(null));
                        }}>
                        Изменить срок
                      </button>
                      <button className="tsk-btn" onClick={() => setReschedulePart(null)}>Отмена</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          </>)}

          {tab === 'scheme' && <TaskScheme task={task} />}

          {tab === 'history' && (
          <div className="tsk-card-history">
            {!task.history?.length ? (
              <div className="tsk-card-history-empty">История пока пуста.</div>
            ) : task.history.map(row => (
              <div className={`tsk-card-history-row is-${historyTone(row)}`} key={row.id}>
                <div className="tsk-card-history-rail"><i /></div>
                <div className="tsk-card-history-content">
                  <div className="tsk-card-history-head">
                    <b title={userName(row.user)}>{shortName(row.user)}</b>
                    <time>{new Date(row.createdAt).toLocaleString('ru-RU', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}</time>
                  </div>
                  <div>{historyText(row)}</div>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>

        <div className="tsk-modal-foot tsk-task-card-foot">
          <div className="tsk-modal-btns">
            {isAuthor && <button className="tsk-btn is-danger" onClick={cancel}>Отменить</button>}
            <button className="tsk-btn" onClick={onClose}>Закрыть</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Переключатель вкладок карточки.
 *
 * Устроен как rb-wizard-nav в зарплатном модуле: подложка активной вкладки —
 * отдельный слой, который переезжает на новое место, а не появляется там. Так
 * видно, что это одна панель с тремя положениями, а не три отдельные кнопки.
 * Длительность переезда зависит от расстояния — иначе соседний переход
 * выглядит вяло, а дальний слишком резким.
 */
function TaskTabs({ tab, onTab, hasScheme }) {
  const navRef = useRef(null);
  const [slider, setSlider] = useState({ left: 0, width: 0, duration: 0 });

  const tabs = [
    ['main', 'Основное', FileText],
    ...(hasScheme ? [['scheme', 'Схема', GitBranch]] : []),
    ['history', 'История', History],
  ];

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const recalc = animate => {
      const active = nav.querySelector('.tsk-card-tab.is-on');
      if (!active) return;
      setSlider(previous => ({
        left: active.offsetLeft,
        width: active.offsetWidth,
        duration: animate ? Math.min(0.5, 0.24 + Math.abs(active.offsetLeft - previous.left) / 2000) : 0,
      }));
    };
    recalc(true);
    const observer = typeof window.ResizeObserver === 'undefined'
      ? null
      : new window.ResizeObserver(() => recalc(false));
    observer?.observe(nav);
    return () => observer?.disconnect();
  }, [tab, hasScheme]);

  return (
    <div className="tsk-card-tabs" ref={navRef}>
      <div
        className="tsk-card-tabs-slider"
        style={{ left: slider.left, width: slider.width, '--slide': `${slider.duration}s` }}
      />
      {tabs.map(([key, label, Icon]) => (
        <button
          key={key}
          className={`tsk-card-tab ${tab === key ? 'is-on' : ''}`}
          onClick={() => onTab(key)}
        >
          <Icon size={15} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function TaskScheme({ task }) {
  const deps = task.deps || [];
  const parts = [...(task.parts || [])].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  return (
    <div className="tsk-card-scheme">
      {parts.map((part, index) => {
        const StatusIcon = STATUS_ICON[part.status];
        const after = deps
          .filter(dep => dep.partId === part.id)
          .map(dep => parts.find(p => p.id === dep.afterPartId)?.title)
          .filter(Boolean);
        return (
          <div className="tsk-card-scheme-row" key={part.id}>
            <div className="tsk-card-scheme-rail">
              <span>{index + 1}</span>
              {index < parts.length - 1 && <i />}
            </div>
            <div className={`tsk-card-scheme-node is-${part.status}`}>
              <div className="tsk-card-scheme-head">
                <b>
                  {/* Код части над названием: именно им её называют, когда
                      этапов несколько и «первый» у каждого свой. */}
                  {task.code && <span className="tsk-code is-lead">{partCode(task.code, index)}</span>}
                  {part.title}
                </b>
                <span className="tsk-part-status" title={STATUS_LABEL[part.status]}>
                  {StatusIcon && <StatusIcon size={17} strokeWidth={1.8} color={STATUS_COLOR[part.status]} />}
                </span>
              </div>
              <div className="tsk-card-scheme-meta">
                <AvatarStack users={(part.assignees || []).map(a => a.user).filter(Boolean)} size={18} />
                <span>{(part.assignees || []).map(a => shortName(a.user)).join(', ')}</span>
                <em className="tsk-hours-chip">
                  <Clock size={13} strokeWidth={1.9} />{clockText(part.estimateHours)}
                </em>
              </div>
              {!!after.length && <div className="tsk-card-scheme-deps">
                <span>После</span>{after.map(title => <b key={title}>{title}</b>)}
              </div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Выбор команды для задачи — список вариантов прямо в карточке.
 *
 * Не модалка поверх модалки: карточка задачи уже лежит поверх страницы, третий
 * слой пришлось бы закрывать в обратном порядке, и это единственное место
 * модуля, где такое могло бы появиться. Список раскрывается на месте, там же,
 * где стоит подпись «Кому видна».
 */
function TeamBinding({ task, ctx, busy, onClose, onPick }) {
  const myTeams = (ctx.access?.teams || []).filter(team => team.isMember || team.isLead);
  const currentId = task.team?.id || '';

  return (
    <div className="tsk-team-binding">
      <div className="tsk-team-binding-head">
        <span>Кому открыть задачу</span>
        <button type="button" className="tsk-x" onClick={onClose}>×</button>
      </div>
      <button
        type="button"
        className={`tsk-team-binding-row ${currentId ? '' : 'is-on'}`}
        disabled={busy || !currentId}
        onClick={() => onPick(null, null)}
      >
        <Lock size={14} strokeWidth={1.9} />
        {/* «Без команды», а не «Личная задача»: поле про видимость, и подпись про
            владение обещала то, чего оно не значит — задача без команды вполне
            может быть поручена другому человеку. */}
        <span>Без команды</span>
        <b>исполнители, автор и руководитель над ними</b>
      </button>
      {myTeams.map(team => (
        <button
          type="button"
          key={team.id}
          className={`tsk-team-binding-row ${team.id === currentId ? 'is-on' : ''}`}
          disabled={busy || team.id === currentId}
          onClick={() => onPick(team.id, team.name)}
        >
          <Shield size={14} strokeWidth={1.9} />
          <span>{team.name}</span>
          <b>весь состав команды</b>
        </button>
      ))}
      {!myTeams.length && (
        <div className="tsk-team-binding-empty">
          Вы не состоите ни в одной команде, которой можно открыть задачу.
        </div>
      )}
    </div>
  );
}
