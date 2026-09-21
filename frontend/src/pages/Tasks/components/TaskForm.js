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
 *
 * ── Срок, длительность и простая задача, ver. 8.48 ───────────────────────
 *
 * Главное поле формы — СРОК ЗАДАЧИ, и он же единственное поле срока, пока задачу
 * не разбили на подзадачи. Календарь-диапазон: нажал один день — работа на день,
 * нажал второй — она идёт с первого по второй. Отдельной возможности «растянуть
 * на несколько дней» нет и не нужно — длительность выпадает из выбора срока.
 *
 * От длительности зависит только то, чем отвечают на «сколько часов». Работа на
 * один день — шкала дня: выделенный интервал отвечает и «сколько», и «куда
 * встанет». Работа на несколько дней — просто объём в часах: интервал внутри дня
 * у недельной работы смысла не имеет, сколько часов в какой день решает
 * исполнитель, когда берёт её в план.
 *
 * ФОРМА НЕ ПРЕДПОЛАГАЕТ СЛОЖНОСТИ. Раньше она открывалась карточкой подзадачи с
 * выбором исполнителя — то есть заранее считала, что задача составная и делает её
 * кто-то другой. Ни то ни другое не верно в большинстве случаев: обычная задача —
 * это одна работа, и чаще всего своя. Поэтому:
 *
 *   — подзадач по умолчанию НЕТ. Внутри задача всё равно состоит из частей (это
 *     контракт сервера, и он не менялся), но пока разбиения не попросили, часть
 *     одна и неявная: её срок — срок задачи, её исполнитель — исполнитель задачи.
 *     Спрашивать у неё второй срок значило бы задать один вопрос дважды;
 *   — исполнителя по умолчанию НЕ выбирают. «Я сам» — не значение по умолчанию в
 *     списке, а состояние формы: выбора чужого исполнителя на экране просто нет,
 *     пока не нажали «Поручить».
 *
 * Последнее закрывает противоречие, на которое жаловались: поле видимости
 * называлось «Личная задача», но тут же рядом можно было выбрать чужого
 * исполнителя. Подпись обещала владение, а поле отвечало за видимость. Теперь
 * «кто делает» спрашивают отдельно и первым, а в поле видимости стоит «Без
 * команды» — то, чем оно на самом деле является.
 *
 * Срок задачи можно нарушить подзадачами, и форма это не запрещает — только
 * показывает, и отметкой на той подзадаче, которая выходит за срок, а не общим
 * «одна подзадача выходит за этот срок»: по такому предупреждению человек должен
 * угадывать, какую строку править.
 */

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import {
  Paperclip, Upload, X, GitBranch, Users as UsersIcon, ChevronDown, Check, Search,
  RotateCcw,
} from 'lucide-react';
import { tasks as api, media } from '../../../services/api';
import { today, addDays, dfull, fromKey, hoursText, estimateText, clockText } from '../utils/dates';
import { userName, shortName } from '../utils/labels';
import { Avatar, AvatarStack, Badge, useMaskClose } from './Bits';
import CustomSelect from './CustomSelect';
import DueRange from './DueRange';
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
  // Первый день работы (ver. 8.48). Пусто — работа на один день, и часы берутся
  // выделением на шкале. Заполнено — работа идёт с этого дня по dueDate, и часы
  // вводятся числом: интервал внутри дня у недельной работы смысла не имеет.
  startDate: null,
  hours: '',
  slot: null,
  after: [],
  ...patch,
});

/**
 * Часы подзадачи: у однодневной — выделение на шкале, у многодневной — объём.
 *
 * Одно поле на два способа ввода намеренно: дальше по форме — итог трудозатрат,
 * разбор загрузки и отправка, — и все они спрашивают «сколько часов», а не «чем
 * это было введено».
 */
const partHours = part => {
  if (part.startDate) {
    const value = Number(String(part.hours).replace(',', '.'));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  return part.slot ? ((part.slot.end - part.slot.start + 1) * STEP) / 60 : 0;
};

/** Границы окна подзадачи. У однодневной оба конца — её срок. */
const partWindow = part => ({ from: part.startDate || part.dueDate, to: part.dueDate });

/** Заполнена ли подзадача настолько, чтобы её можно было отправить. */
const partReady = part => !!part.assignees.length && !!part.dueDate
  && (part.startDate ? partHours(part) > 0 : !!part.slot);

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
  /**
   * Срок задачи (ver. 8.48) — главное поле формы, начало и конец.
   *
   * Пока задачу не разбили, это и есть срок работы: неявная подзадача берёт его
   * целиком. Поэтому он заполнен с самого начала — завтрашним днём, как и раньше
   * был заполнен срок единственной части. Пустой срок у простой задачи означал
   * бы работу без срока, а такой в модуле не бывает.
   *
   * dueFrom пустой значит «один день», то же правило, что у подзадач.
   */
  const [dueFrom, setDueFrom] = useState(null);
  const [dueTo, setDueTo] = useState(preset.date || addDays(today(), 1));
  /**
   * Разбита ли задача на подзадачи.
   *
   * Не выводится из parts.length: внутри часть есть всегда, даже у простой
   * задачи. Это именно состояние формы — попросили разбиение или нет.
   */
  const [split, setSplit] = useState(false);
  /**
   * Поручена ли задача кому-то другому.
   *
   * Тоже состояние формы, а не значение поля: пока здесь false, выбора
   * исполнителя на экране нет вовсе — работу делает автор. Это и есть ответ на
   * «личная задача не должна предлагать чужого исполнителя».
   *
   * Сразу true, если автор сам в модуле не заведён — то есть у него нет рабочего
   * расписания. Такому человеку задачу поставить нельзя (сервер отвечает 409), и
   * показывать ему «делаю сам» значило бы обещать то, чего не будет: он заполнил
   * бы форму до конца и получил отказ. Заводит ли себе задачи незаведённый
   * человек — редкий случай, но именно в нём форма и врала бы.
   */
  const [assigned, setAssigned] = useState(
    ctx.access?.enrolled === false || (!!preset.assignee && preset.assignee !== ctx.me?.id)
  );
  /**
   * Части задачи. У простой задачи ровно одна, неявная: её срок и исполнитель —
   * это срок и исполнитель задачи, и своих контролов у неё в форме нет.
   *
   * Исполнитель по умолчанию — автор. Раньше здесь было пусто, и форма первым
   * делом требовала выбрать человека, то есть заранее считала задачу поручением.
   */
  const [parts, setParts] = useState(() => [newPart({
    assignees: [preset.assignee || (ctx.access?.enrolled === false ? null : ctx.me?.id)]
      .filter(Boolean),
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
    const wanted = parts.flatMap(part => {
      const frame = partWindow(part);
      return part.assignees.map(id => `${id}|${frame.from}|${frame.to}`);
    });
    const missing = [...new Set(wanted)].filter(k => !(k in loads));
    if (!missing.length) return undefined;

    let alive = true;
    Promise.all(missing.map(async key => {
      const [userId, from, to] = key.split('|');
      try {
        // Период, а не один день: у многодневной подзадачи помещаемость — это
        // ёмкость всего окна, и считать её по одному дню нельзя.
        const { data } = await api.getPersonLoad(userId, from, to);
        return [key, data.days || []];
      } catch {
        return [key, null];
      }
    })).then(entries => {
      if (alive) setLoads(prev => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { alive = false; };
  }, [parts, loads]);

  /** Загрузка исполнителя по окну подзадачи: массив дней или null, если ещё нет. */
  const loadOf = useCallback((userId, part) => {
    const frame = partWindow(part);
    return loads[`${userId}|${frame.from}|${frame.to}`] || null;
  }, [loads]);

  /**
   * Разбор: кто и насколько не помещается.
   *
   * У однодневной подзадачи вопрос про один день — «станет 8,2 из 6,4». У
   * многодневной про окно целиком — «нужно 20 ч, свободно 14». Ёмкость окна это
   * сумма остатков по дням, а не «норма × дни минус занятое»: перегруженный
   * вторник не должен компенсироваться пустой пятницей, иначе человек с одним
   * сломанным днём выглядит уложившимся в неделю. Тот же расчёт и теми же
   * словами делает сервер (assessWindow) — расходиться им нельзя.
   */
  const overloads = useMemo(() => {
    const out = [];
    for (const part of parts) {
      const hours = partHours(part);
      const frame = partWindow(part);
      for (const userId of part.assignees) {
        const days = loadOf(userId, part);
        if (!days || !days.length) continue;

        if (part.startDate) {
          const working = days.filter(day => !day.onVacation && !day.onDayOff && day.norm);
          if (!working.length) {
            out.push({
              userId, windowed: true, ...frame,
              reason: days.some(day => day.onVacation) ? 'vacation'
                : days.every(day => day.onDayOff) ? 'day_off' : 'no_norm',
            });
            continue;
          }
          const capacity = working.reduce((sum, day) => sum + Number(day.free || 0), 0);
          if (hours > capacity + 1e-9) {
            out.push({
              userId, windowed: true, ...frame, reason: 'window',
              need: hours, capacity, over: hours - capacity, workingDays: working.length,
            });
          }
          continue;
        }

        const day = days[0];
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
  }, [parts, loadOf]);

  /**
   * Подзадачу подтянуть внутрь срока задачи.
   *
   * Календарь подзадачи ограничен сроком задачи, поэтому выйти за него при выборе
   * нельзя. Остаётся один способ — сузить срок задачи после того, как подзадачи
   * расставлены; тогда те, что перестали помещаться, подтягиваются к границе.
   *
   * Молча менять введённые даты неприятно, но альтернативы хуже: либо запретить
   * сужать срок задачи, либо оставить подзадачи снаружи и вернуться к
   * предупреждению, которое сообщает об ошибке вместо того, чтобы её не допустить.
   * Даты видно на экране, и изменение заметно.
   */
  const clampToTask = (part, from, to) => {
    const partTo = part.dueDate > to ? to : part.dueDate < from ? from : part.dueDate;
    if (!part.startDate) return { ...part, dueDate: partTo };
    const partFrom = part.startDate < from ? from : part.startDate > partTo ? partTo : part.startDate;
    return { ...part, startDate: partFrom === partTo ? null : partFrom, dueDate: partTo };
  };

  const totalEffort = parts.reduce(
    (sum, p) => sum + partHours(p) * Math.max(p.assignees.length, 1), 0
  );

  const setPart = useCallback((key, patch) => setParts(list =>
    list.map(p => (p.key === key ? { ...p, ...patch } : p))), []);

  /**
   * Срок задачи изменили.
   *
   * Пока задача не разбита, он же является сроком работы, поэтому уезжает и в
   * неявную часть. Два поля срока в такой задаче были бы одним вопросом,
   * заданным дважды, — и разойтись им было бы негде, кроме как в голове у
   * заполняющего.
   *
   * Выделение на шкале сбрасывается, когда меняется день или задача перестаёт
   * быть однодневной: у другого дня другая занятость, а у недельной работы шкалы
   * нет вовсе. Часы при переходе к нескольким дням переезжают в объём — человек
   * их уже назвал.
   */
  const setTaskDue = ({ from, to }) => {
    setDueFrom(from);
    setDueTo(to);
    if (split) {
      setParts(list => list.map(part => clampToTask(part, from || to, to)));
      return;
    }
    const hours = partHours(parts[0]);
    const becameMulti = !!from;
    setParts(list => list.map((p, index) => (index === 0 ? {
      ...p,
      startDate: from,
      dueDate: to,
      hours: becameMulti ? (p.hours || (hours > 0 ? String(hours) : '')) : '',
      slot: becameMulti ? null : (p.dueDate === to ? p.slot : null),
    } : p)));
  };

  /**
   * Разбить задачу на подзадачи.
   *
   * Первая подзадача — это уже заполненная неявная часть: у неё есть исполнитель,
   * срок и часы, и терять их при разбиении незачем. Вторая открывается на день
   * позже первой, потому что «сначала одно, потом другое» — самый частый случай,
   * ради которого части и заводят.
   */
  const startSplit = () => {
    setSplit(true);
    setParts(list => (list.length > 1 ? list : [...list, newPart({
      assignees: list[0].assignees,
      dueDate: addDays(list[0].dueDate, 1),
      after: [list[0].key],
    })]));
    // Срок задачи расширяется, чтобы накрыть появившуюся подзадачу: пока автор
    // только составляет работу, предупреждение «выходит за срок задачи» было бы
    // придиркой к тому, что он ещё не закончил вводить. Отметка нужна на
    // подзадаче, которую ЗА срок вынесли сознательно.
    setDueFrom(prev => prev || dueTo);
    setDueTo(prev => addDays(prev, 1));
  };

  const addPart = () => {
    const last = parts[parts.length - 1];
    const next = addDays(last.dueDate, 1);
    setParts(list => [...list, newPart({
      // Срок у новой подзадачи свой: цепочка «сначала одно, потом другое» и
      // состоит из того, что делается в разное время. Длительность предыдущей не
      // наследуется — «на неделю» одна её часть не делает такими все остальные.
      // В конец цепочки — самый частый случай, ради которого части и заводят.
      dueDate: next,
      after: [last.key],
    })]);
    // Срок задачи растёт вместе с работой, пока её составляют: см. startSplit.
    if (next > dueTo) setDueTo(next);
  };

  const removePart = key => setParts(list => list
    .filter(p => p.key !== key)
    .map(p => ({ ...p, after: p.after.filter(x => x !== key) })));

  const shiftToNextFit = async () => {
    const first = parts[0];
    const userId = first.assignees[0];
    if (!userId) return;
    const hours = partHours(first);
    try {
      const start = addDays(first.dueDate, 1);
      const end = addDays(first.dueDate, 45);
      const { data } = await api.getPersonLoad(userId, start, end);
      const days = data.days || [];

      /**
       * У многодневной подзадачи ищется окно, а не день.
       *
       * Окно той же длины скользит по горизонту, и подходит первое, чьей
       * свободной ёмкости хватает на весь объём. Длина сохраняется намеренно:
       * ответ на «когда» не должен втихую менять ответ на «сколько это займёт».
       */
      if (first.startDate) {
        const length = Math.round(
          (fromKey(first.dueDate) - fromKey(first.startDate)) / 86400000
        );
        const found = days.findIndex((_, at) => {
          const frame = days.slice(at, at + length + 1);
          if (frame.length < length + 1) return false;
          const working = frame.filter(day => !day.onVacation && !day.onDayOff && day.norm);
          if (!working.length) return false;
          return working.reduce((sum, day) => sum + Number(day.free || 0), 0) >= hours - 1e-9;
        });
        if (found < 0) { toast.error('В ближайшие 45 дней срока под этот объём нет'); return; }
        const from = days[found].date;
        const to = days[found + length].date;
        setChoice('shift');
        // В простой задаче срок работы и срок задачи — одно поле, и двигать надо
        // его, а не только неявную часть: иначе обещание останется прежним, а
        // работа уедет, и задача сразу окажется «за сроком».
        if (!split) setTaskDue({ from, to });
        else setParts(list => list.map(p => (p.key === first.key
          ? { ...p, startDate: from, dueDate: to } : p)));
        toast.success(`Срок перенесён на ${dfull(from)} — ${dfull(to)}`);
        return;
      }

      const fit = days.find(day =>
        !day.onVacation && day.norm !== null
        && Number(day.hours) + hours <= Number(day.norm)
      );
      if (!fit) { toast.error('В ближайшие 45 дней подходящего дня нет'); return; }
      setChoice('shift');
      // Сдвигается только та часть, которая не помещается, а не все разом:
      // цепочка «сначала одно, потом другое» от сдвига первого звена не должна
      // складываться в один день.
      if (!split) setTaskDue({ from: null, to: fit.date });
      else setParts(list => list.map(p => (p.key === first.key
        ? { ...p, dueDate: fit.date, slot: null } : p)));
      toast.success(`Срок перенесён на ${dfull(fit.date)} — там задача помещается`);
    } catch {
      toast.error('Не удалось найти свободный день');
    }
  };

  const giveToFreePerson = async () => {
    const first = parts[0];
    const hours = partHours(first);
    const frame = partWindow(first);
    const current = new Set(first.assignees);
    try {
      const checks = await Promise.all(people
        .filter(person => !current.has(person.id))
        .map(async person => {
          const { data } = await api.getPersonLoad(person.id, frame.from, frame.to);
          return { person, days: data.days || [] };
        }));
      // Ёмкость окна, а не одного дня: у однодневной подзадачи это то же самое,
      // у многодневной — единственно верный вопрос.
      const fit = checks.find(({ days }) => {
        const working = days.filter(day => !day.onVacation && !day.onDayOff && day.norm);
        if (!working.length) return false;
        return working.reduce((sum, day) => sum + Number(day.free || 0), 0) >= hours - 1e-9;
      });
      if (!fit) { toast.error('На эти дни свободного исполнителя не найдено'); return; }
      setChoice('give');
      // Слот сбрасывается вместе с исполнителем: у нового человека свой день,
      // и оставленное выделение показывало бы занятость предыдущего. И форма
      // переходит в режим поручения — иначе она показывала бы «делаю сам» рядом
      // с чужим именем.
      setAssigned(fit.person.id !== ctx.me?.id);
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
  /**
   * «Без команды», а не «Личная задача».
   *
   * Поле отвечает на вопрос «кому видна», и пустое значение означает ровно «не
   * открыта команде»: видят автор, исполнитель и руководитель над исполнителем.
   * Подпись «Личная задача» обещала другое — владение, — и рядом с ней тут же
   * стоял выбор чужого исполнителя. Жаловались именно на это противоречие; оно
   * было в подписи, а не в поле.
   */
  const teamOptions = [
    { value: '', label: 'Без команды' },
    ...myTeams.map(team => ({ value: team.id, label: team.name })),
  ];

  // Нехватка ёмкости окна требует объяснения на тех же основаниях, что и
  // переполненный день: обойти проверку можно всегда, но не молча.
  const needsExplanation = overloads.some(o => o.reason === 'overload' || o.reason === 'window');
  const missingWho = parts.some(p => !p.assignees.length);
  const missingSlot = parts.some(p => p.assignees.length && !p.startDate && !p.slot);
  const missingHours = parts.some(p => p.assignees.length && p.startDate && !partHours(p));
  const canSend = title.trim() && !!dueTo && parts.every(partReady);

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
        startDate: dueFrom,
        dueDate: dueTo,
        attachments,
        explanation: needsExplanation ? explanation.trim() : undefined,
        // Неявная часть простой задачи уезжает со сроком задачи: своих дат у неё
        // в форме нет, потому что это один и тот же срок.
        parts: parts.map(p => ({
          id: p.key,
          title: p.title.trim() || title.trim(),
          assignees: p.assignees,
          estimateHours: partHours(p),
          startDate: split ? (p.startDate || null) : dueFrom,
          dueDate: split ? p.dueDate : dueTo,
          after: split ? p.after : [],
        })),
      });
      // Своя работа на несколько дней в календарь сразу не попадает: часы надо
      // разложить по дням, и делает это человек — задача уходит ему же во
      // входящие. Обещать здесь календарь значило бы обещать не то.
      const selfTask = !split
        && parts[0].assignees.length === 1
        && parts[0].assignees[0] === ctx.me?.id;
      toast.success(selfTask && !dueFrom
        ? 'Ваша задача сразу добавлена в календарь'
        : selfTask
          ? 'Задача у вас во входящих — осталось разложить часы по дням'
          : !split
            ? 'Отправлено во входящие. В календарь исполнителя задача попадёт после обработки'
            : `Задача создана: ${parts.length} подзадач, ${hoursText(totalEffort)} трудозатрат`);
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
              {/* Название и срок — одной строкой. Это два вопроса, на которые
                  отвечают первыми и вместе: «что сделать и когда». Срок стоял
                  отдельным блоком под названием и читался как ещё один реквизит
                  наравне с проектом, хотя он главное поле формы — от того, один в
                  нём день или несколько, зависит вся остальная форма. */}
              <div className="tsk-task-headline">
                <input
                  className="tsk-input tsk-task-title-input"
                  placeholder="Название задачи"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  autoFocus
                />
                <DueRange from={dueFrom} to={dueTo} onChange={setTaskDue} />
              </div>

              {/* Команда и проект стоят между сроком и описанием: это короткие
                  поля, и заполняются они заодно с названием, одним движением.
                  Описание — длинный текст, и всё, что идёт после него, читается
                  как отдельный раздел формы.

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
              {/* Простая задача: одна работа, и спрашивают о ней два вопроса —
                  кто делает и сколько это часов. Карточки подзадачи здесь нет:
                  сущности «подзадача» у простой задачи не существует, и рисовать
                  её значило бы заранее считать работу составной. */}
              {!split ? (
                <>
                  <div className="tsk-task-section-head">Кто делает и сколько</div>
                  <Doer
                    assigned={assigned}
                    setAssigned={setAssigned}
                    assignees={parts[0].assignees}
                    people={people}
                    peopleLoading={peopleLoading}
                    byId={byId}
                    me={ctx.me}
                    enrolled={ctx.access?.enrolled}
                    onChange={assignees => setPart(parts[0].key, {
                      assignees,
                      // День у нового человека свой: оставленное выделение
                      // показывало бы занятость предыдущего.
                      slot: null,
                    })}
                  />
                  <Effort
                    part={parts[0]}
                    onChange={patch => setPart(parts[0].key, patch)}
                  />
                </>
              ) : (
                <>
                  <div className="tsk-task-section-head">Подзадачи · {parts.length}</div>
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
                      // Подзадача выбирается только внутри срока задачи. Раньше
                      // календарь был свободным, и вылезшую за срок подзадачу
                      // приходилось ловить предупреждением — то есть сначала
                      // разрешить ошибку, а потом о ней сообщить.
                      minDate={dueFrom || dueTo}
                      maxDate={dueTo}
                      onChange={patch => setPart(part.key, patch)}
                      onRemove={parts.length > 1 ? () => removePart(part.key) : null}
                    />
                  ))}
                  <button type="button" className="tsk-btn is-wide tsk-add-part" onClick={addPart}>
                    + Подзадача
                  </button>
                </>
              )}

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

              {/* Разбиение — по требованию, а не по умолчанию. Подзадачи нужны
                  сложной работе, и таких задач меньшинство; открывать форму сразу
                  с ними значит спрашивать у всех остальных про сущность, которой
                  у них нет.
                  Кнопка, а не ссылка, и стоит она внизу колонки — на том же месте,
                  где в разбитой задаче стоит «+ Подзадача»: это один и тот же ход,
                  «работы здесь больше одной». Ниже разбора загрузки, потому что
                  разбор говорит о полях выше и стоять должен рядом с ними. */}
              {!split && (
                <button type="button" className="tsk-btn is-wide tsk-split-btn" onClick={startSplit}>
                  <GitBranch size={15} strokeWidth={1.9} />
                  Разбить на подзадачи
                </button>
              )}
            </div>

          </div>
        </div>

        <div className="tsk-modal-foot tsk-task-modal-foot">
          <div className="tsk-modal-hint">
            {!title.trim() ? 'Нужно название задачи'
              : !dueTo ? 'Нужен срок задачи'
              : missingWho ? (split ? 'У каждой подзадачи должен быть исполнитель' : 'Выберите исполнителя')
                : missingSlot ? 'Не выбрано время в дне'
                  : missingHours ? 'Не указан объём работы в часах'
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

/* ──────────────────────────── кто делает ──────────────────────────── */

/**
 * Исполнитель простой задачи.
 *
 * Два состояния, а не список с выбранным значением: пока работу делает автор,
 * выбора чужого исполнителя на экране НЕТ. Это не экономия места — это ответ на
 * противоречие, из-за которого поле «Личная задача» стояло рядом с выбором любого
 * сотрудника. Чаще всего задачу заводят себе, и спрашивать при этом «кому» значит
 * заранее считать её поручением.
 *
 * Обратная кнопка есть тоже: поручить по ошибке так же легко, как не поручить.
 */
function Doer({ assigned, setAssigned, assignees, people, peopleLoading, byId, me, enrolled, onChange }) {
  /**
   * Две кнопки-положения, а не ссылки.
   *
   * «Делаю сам» и «Поручить» — это выбор из двух, и выглядеть он должен как
   * выбор: ссылка сбоку читалась как примечание и терялась. Заодно у обоих
   * состояний теперь одно и то же место, и переключение не двигает форму.
   *
   * Себе задачу может поставить только заведённый в модуле — без рабочего
   * расписания загрузку не посчитать, и сервер такую постановку не примет.
   * Поэтому кнопка не спрятана, а выключена с объяснением: спрятанная оставила бы
   * человека гадать, почему вариантов один.
   */
  const canSelf = enrolled !== false;
  return (
    <>
      <div className="tsk-seg">
        <button
          type="button"
          className={!assigned ? 'is-on' : ''}
          disabled={!canSelf}
          title={canSelf ? undefined : 'У вас не настроено рабочее расписание'}
          onClick={() => { setAssigned(false); onChange([me?.id].filter(Boolean)); }}
        >
          Делаю сам
        </button>
        <button
          type="button"
          className={assigned ? 'is-on' : ''}
          onClick={() => { setAssigned(true); onChange([]); }}
        >
          Поручить
        </button>
      </div>

      {!assigned ? (
        <div className="tsk-doer">
          <Avatar user={me} size={26} />
          <span className="tsk-doer-name">{shortName(me)}</span>
        </div>
      ) : (
        <PeoplePicker
          people={people}
          loading={peopleLoading}
          selected={assignees}
          byId={byId}
          onChange={onChange}
        />
      )}

      {!canSelf && (
        <div className="tsk-doer-note">
          Себе задачу поставить нельзя: у вас не настроено рабочее расписание —
          его задаёт руководитель в разделе «Люди».
        </div>
      )}
    </>
  );
}

/* ──────────────────────────── сколько часов ──────────────────────────── */

/**
 * Часы работы: шкала дня или объём.
 *
 * Чем отвечают на «сколько», зависит только от того, один в сроке день или
 * несколько. Работа на день — шкала: выделенный интервал отвечает и «сколько», и
 * «куда встанет». Работа на несколько дней — число, потому что интервал внутри
 * дня у недельной работы смысла не имеет.
 *
 * Подсказки «часы по дням разложит исполнитель» здесь нет. Она объясняла то, чего
 * никто и не спрашивал: поле называется «объём», а не «часов в день.
 */
function Effort({ part, onChange }) {
  if (part.startDate) {
    return (
      <label className="tsk-window-hours">
        объём работы
        <input
          className="tsk-input"
          type="number"
          min="0.25"
          step="0.25"
          inputMode="decimal"
          placeholder="ч"
          value={part.hours}
          onChange={event => onChange({ hours: event.target.value })}
        />
        ч
      </label>
    );
  }
  return (
    <DayScale
      assignees={part.assignees}
      date={part.dueDate}
      slot={part.slot}
      onSlot={slot => onChange({ slot })}
    />
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
 */function PartCard({
  part, index, total, taskTitle, people, peopleLoading, byId, earlier,
  minDate, maxDate, onChange, onRemove,
}) {
  const hours = partHours(part);
  const multiDay = !!part.startDate;

  /**
   * Срок изменили — что происходит с часами.
   *
   * Работа стала многодневной: выделение на шкале уже не годится (шкала про один
   * день), но названные часы никуда не деваются — они переезжают в объём. Человек
   * их уже назвал, спрашивать заново незачем.
   *
   * Работа снова стала однодневной: объём сбрасывается вместе со шкалой. Часы,
   * набранные за неделю, в один день заведомо не помещаются, и перенести их сюда
   * значило бы подсунуть заведомо непроходящую оценку.
   */
  const setDue = ({ from, to }) => {
    const becameMulti = !!from;
    if (becameMulti === multiDay) {
      onChange({ startDate: from, dueDate: to, slot: becameMulti ? part.slot : null });
      return;
    }
    onChange(becameMulti
      ? { startDate: from, dueDate: to, hours: hours > 0 ? String(hours) : '', slot: null }
      : { startDate: null, dueDate: to, hours: '', slot: null });
  };

  /**
   * Подзадача разложена на секции с подзаголовками.
   *
   * Раньше поля шли подряд одним потоком — исполнители, срок, шкала, связи, — и в
   * задаче из четырёх подзадач это превращалось в кашу: было не видно, где
   * кончается одна и начинается другая и какой вопрос к чему относится. Секции
   * отвечают по одному вопросу каждая: что сделать, кто делает, когда и сколько,
   * после чего начинается.
   */
  return (
    <div className="tsk-part">
      <div className="tsk-part-head">
        <span className="tsk-part-num">{index + 1}</span>
        <input
          className="tsk-input"
          placeholder={total > 1 ? `Название подзадачи ${index + 1}` : 'Название подзадачи'}
          value={part.title}
          onChange={e => onChange({ title: e.target.value })}
        />
        {onRemove && (
          <button type="button" className="tsk-x" aria-label="Убрать подзадачу" onClick={onRemove}>×</button>
        )}
      </div>

      <div className="tsk-part-sect">
        <div className="tsk-part-sect-head">Кто делает</div>
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
        {/* «Общая» — и сразу часы, без пояснений. Стояла ещё приписка
            «выбранный интервал займёт время у каждого из них»: она повторяла
            словами то, что уже сказано бейджем, и висела там, пока часы не
            выбраны, то есть как раз когда сказать было нечего. */}
        {part.assignees.length > 1 && (
          <div className="tsk-part-shared">
            <Badge tone="violet"><UsersIcon size={12} strokeWidth={2} /> Общая</Badge>
            {hours > 0 && (
              <span>
                {estimateText(hours)} у каждого, {hoursText(hours * part.assignees.length)} суммарно
              </span>
            )}
          </div>
        )}
      </div>

      {/* Срок — в одной строке с подзаголовком секции, как название задачи со
          сроком задачи выше. Отдельной строкой контрол висел сам по себе и не
          читался как ответ на «когда». */}
      <div className="tsk-part-sect">
        <div className="tsk-part-sect-head">
          Когда и сколько
          <DueRange
            from={part.startDate}
            to={part.dueDate}
            min={minDate}
            max={maxDate}
            onChange={setDue}
          />
        </div>
        <Effort part={part} onChange={onChange} />
      </div>

      {/* Связь «после»: часть не появится во входящих, пока предыдущая не
          завершена. Показывается со второй части — у первой её быть не может. */}
      {index > 0 && (
        <div className="tsk-part-sect">
          <div className="tsk-part-sect-head">После чего начинается</div>
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
 *
 * Показывается только у работы на один день. Срок выбирают выше (DueRange), и
 * если в нём оказалось несколько дней, вместо шкалы встаёт объём в часах — см.
 * Effort.
 */
function DayScale({ assignees, date, slot, onSlot }) {
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
        {/* Поля даты здесь больше нет: срок выбирают одним контролом над шкалой,
            и он же решает, один это день или несколько (ver. 8.48). Две даты в
            одной карточке — второй ответ на тот же вопрос, и разойтись им было
            бы негде, кроме как в голове у заполняющего.

            Пока ничего не выделено, здесь пусто. Стояла подпись «Выделите время
            на шкале» — наставление в том месте, где и так видно, что выбирать:
            под ней лежит сама шкала. */}
        <div className={`tsk-scale-chosen ${selection ? 'is-set' : ''}`}>
          {selection && <><b>{label}</b><span>{clockText(chosenHours)}</span></>}
        </div>
        {/* Сброс — иконкой, а не словом «сбросить»: подчёркнутое слово рядом с
            выбранным временем читалось как примечание, а не как кнопка, и не
            выглядело нажимаемым. Круговая стрелка говорит то же самое и занимает
            место кнопки. */}
        {(slot || anchor !== null) && (
          <button type="button" className="tsk-icon-btn" title="Сбросить выбранное время"
            aria-label="Сбросить выбранное время"
            onClick={() => { setAnchor(null); onSlot(null); }}>
            <RotateCcw size={15} strokeWidth={1.9} />
          </button>
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

/**
 * Исполнители — дропдаун с галочками.
 *
 * Было так: список выбранных рисовался чипами над полем, а добавляли нового через
 * отдельное поле поиска «Добавить ещё исполнителя». На трёх-четырёх человеках это
 * разрасталось на пол-карточки, и выбор занимал больше места, чем всё остальное в
 * подзадаче вместе.
 *
 * Теперь одна кнопка: на ней аватары и имена выбранных, внутри — поиск и список с
 * галочками. Поиск живёт в том же меню, потому что это одно действие «выбрать
 * людей», а не два разных.
 *
 * Меню не закрывается по выбору: исполнителей чаще всего несколько, и закрывать
 * список после каждой галочки значит заставлять открывать его заново.
 */
function PeoplePicker({ people, loading, selected, byId, onChange, placeholder = 'Выбрать исполнителя' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);

  // Ищем по полному ФИО, а показываем коротко: набрать отчество — законный
  // способ отличить двух однофамильцев, и отбирать его из-за того, что мы его не
  // рисуем, незачем. Выбранные из списка НЕ исчезают: галочку надо снимать там
  // же, где ставили.
  const text = query.trim().toLowerCase();
  const matches = people.filter(person => !text || userName(person).toLowerCase().includes(text));

  useEffect(() => {
    if (!open) return undefined;
    const close = event => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    const escape = event => { if (event.key === 'Escape') { setOpen(false); setQuery(''); } };
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
      const width = Math.min(window.innerWidth - 16, Math.max(rect.width, 300));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 260 && above > below;
      const maxHeight = Math.max(160, Math.min(330, (up ? above : below) - 8));
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

  // Открыли меню — фокус в поиск: у кого десяток сотрудников, тот сразу печатает,
  // а не ищет поле глазами.
  useEffect(() => {
    if (open && menuStyle) searchRef.current?.focus();
  }, [open, menuStyle]);

  const toggle = userId => onChange(selected.includes(userId)
    ? selected.filter(id => id !== userId)
    : [...selected, userId]);

  const chosen = selected.map(id => byId[id]).filter(Boolean);

  return (
    <div className="tsk-people-picker" ref={rootRef}>
      <button
        type="button"
        className={`tsk-people-btn ${open ? 'is-open' : ''} ${chosen.length ? 'is-set' : ''}`}
        disabled={loading}
        onClick={() => setOpen(!open)}
      >
        {chosen.length ? (
          <>
            <AvatarStack users={chosen} size={22} max={4} />
            {/* Имена, а не только аватары: людей узнают по фамилии, а аватар
                есть далеко не у всех. Больше трёх — числом, иначе кнопка
                растягивается и ломает строку. */}
            <span className="tsk-people-btn-names" title={chosen.map(userName).join(', ')}>
              {chosen.length > 3
                ? `${chosen.length} исполнителя`
                : chosen.map(shortName).join(', ')}
            </span>
          </>
        ) : (
          <>
            <UsersIcon size={15} strokeWidth={1.9} />
            <span className="tsk-people-btn-empty">
              {loading ? 'Загружаем сотрудников…' : placeholder}
            </span>
          </>
        )}
        <ChevronDown size={15} strokeWidth={2} className="tsk-people-btn-chevron" />
      </button>

      {open && menuStyle && createPortal(
        <div className="tsk-people-menu is-checks" ref={menuRef} style={menuStyle}>
          <div className="tsk-people-search">
            <Search size={14} strokeWidth={1.9} />
            <input
              ref={searchRef}
              value={query}
              placeholder="Найти сотрудника"
              onChange={event => setQuery(event.target.value)}
            />
          </div>
          <div className="tsk-people-list">
            {matches.length ? matches.map(person => {
              const on = selected.includes(person.id);
              return (
                <button
                  type="button"
                  key={person.id}
                  className={on ? 'is-on' : ''}
                  title={userName(person)}
                  onClick={() => toggle(person.id)}
                >
                  <span className={`tsk-check ${on ? 'is-on' : ''}`}>
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <Avatar user={person} size={26} />
                  <span className="tsk-people-row-name">
                    {shortName(person)}
                    {person.position && <em>{person.position}</em>}
                  </span>
                </button>
              );
            }) : (
              <div className="tsk-people-menu-empty">
                {query.trim()
                  ? 'Никого не найдено среди заведённых в модуле'
                  : 'В модуле пока никого не завели: нужно рабочее расписание в разделе «Люди»'}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ─────────────────── разбор загрузки и выбор компромисса ─────────────────── */

function Assessment({ overloads, parts, loads, byId, me, choice, setChoice, explanation, setExplanation, onShift, onGive }) {
  const first = parts[0];
  // Разбор ждёт, пока сказано «сколько»: у работы на один день это выделение на
  // шкале, у работы на несколько дней — объём в часах.
  if (!partReady(first)) return null;

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
  const windowShort = overloads.filter(o => o.reason === 'window');

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
        {/* Несколько дней: не «день переполнен», а «работы больше, чем в этих
            днях свободного времени». Что делать — сказано кнопками ниже, и
            повторять это словами незачем. */}
        {windowShort.map(o => (
          <div key={`w${o.userId}${o.from}`}>
            {shortName(byId[o.userId])}: нужно <b>{hoursText(o.need)}</b>, свободно{' '}
            {hoursText(o.capacity)} за {o.workingDays} раб. дн. — не хватает {hoursText(o.over)}.
          </div>
        ))}
      </div>

      {!!(over.length || windowShort.length) && (
        <>
          <div className="tsk-assessment-actions">
            <button type="button" className={choice === 'shift' ? 'is-on' : ''} onClick={onShift}>
              {windowShort.length ? 'Другие дни' : 'Другой день'}
            </button>
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
