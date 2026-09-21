/**
 * Карточка задачи.
 *
 * Отличается от списка одним разделом — историей. Срок здесь не поле, а
 * результат переговоров: кто предложил, кто перенёс, какое объяснение приложил
 * автор, продавивший задачу в переполненный день. Без этой ленты «срок
 * сдвинулся» выглядит как факт природы.
 *
 * Перенос ищет ближайшее подходящее окно на сервере: так мобильный сценарий
 * остаётся коротким, но не обходит историю и правило трёх переносов.
 */

import React, {useCallback, useState} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet, Alert, Linking} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';

import {tasks as tasksApi} from '../../services/api';
import CONFIG from '../../config';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {useAuth} from '../../store/authStore';
import {Clock, FileText, GitBranch, History} from 'lucide-react-native';
import Avatar from '../../components/Avatar';
import LayoutSheet from './LayoutSheet';
import {
  MODE_LABEL, STATUS_LABEL, STATUS_ICON, STATUS_COLOR, addDays, clockText,
  dateRange, ddate, dfull, dnum, hoursText, isWindowed, partCode, shortName,
  windowOf,
} from './taskMeta';

/**
 * Цвет точки в истории. Тот же смысл, что в вебе: возврат и продавленная
 * проверка — тревожные, перенос и предложение срока — предупреждающие,
 * согласование и план — спокойные.
 */
function historyColor(c, row) {
  if (row.action === 'declined' || row.action === 'forced') return c.error;
  if (['moved', 'extended', 'proposed_date', 'stretched'].includes(row.action)) return c.warning;
  if (['planned', 'accepted_date'].includes(row.action)) return c.success;
  if (row.action === 'status_changed') {
    if (row.payload?.to === 'done') return c.success;
    if (row.payload?.to === 'review') return c.secondary;
  }
  return c.primary;
}

/** Человеческие формулировки событий истории — те же, что в вебе. */
function historyText(row) {
  const p = row.payload || {};
  switch (row.action) {
    case 'created':
      return p.parts > 1
        ? `создал задачу из ${p.parts} подзадач на ${p.people} чел.`
        : 'создал задачу';
    case 'planned':
      // Многодневная подзадача пишет в историю раскладку, а не день: «взял в план
      // на 22-е» у работы на неделю неправда, и по такой записи не понять, сколько
      // человек на неё отвёл.
      if (p.until && p.until !== p.date) {
        return `${p.overload ? 'разложил сверх нормы' : 'разложил'} на ${
          (p.layout || []).length} дн.: ${(p.layout || [])
          .map(row => `${dnum(row.date)} — ${hoursText(row.hours)}`)
          .join(', ')}`;
      }
      return p.overload
        ? `взял в план на ${dnum(p.date)} сверх нормы — стало ${hoursText(p.after)} из ${hoursText(p.norm)}`
        : `поставил в план на ${dnum(p.date)}`;
    case 'proposed_date':
      return `предложил срок ${p.toStart ? dateRange(p.toStart, p.to) : dnum(p.to)}`;
    case 'accepted_date':
      return `согласовал срок ${dnum(p.date)}`;
    case 'declined':
      return 'вернул задачу автору с пометкой «не моя зона»';
    case 'moved': {
      const where = p.toStart && p.toStart !== p.to ? dateRange(p.toStart, p.to) : dnum(p.to);
      return p.becameStuck
        ? `перенёс на ${where} — третий перенос, задача требует решения`
        : `перенёс на ${where}`;
    }
    case 'stretched':
      return p.from
        ? `изменил срок: работа идёт ${dateRange(p.from, p.to)}`
        : `изменил срок: снова один день, ${dnum(p.to)}`;
    case 'extended':
      return `продлил: ${hoursText(p.from)} → ${hoursText(p.to)}`;
    case 'split':
      return `разбил подзадачу: ${hoursText(p.head)} + ${hoursText(p.tail)}`;
    case 'forced':
      return `продавил проверку загрузки: «${p.explanation}»`;
    case 'status_changed':
      return `${STATUS_LABEL[p.from] || p.from} → ${STATUS_LABEL[p.to] || p.to}`;
    default:
      return row.action;
  }
}

export default function TaskCardScreen({route, navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tabInset = useTabBarInset();
  const {user} = useAuth();
  const {id} = route.params || {};

  const [task, setTask] = useState(null);
  const [busy, setBusy] = useState(false);
  /**
   * Открытый лист раскладки: {part, window}.
   *
   * Только постановка в план. Смена срока раскладку не составляет, а снимает:
   * в новых днях другая занятость, и человек раскладывает часы заново отдельным
   * шагом — той же кнопкой «Разложить по дням».
   */
  const [layout, setLayout] = useState(null);
  // Вкладки как в вебе: части, схема и история шли одной лентой, и до истории
  // добирались прокруткой мимо всего остального — на телефоне особенно долгой.
  const [tab, setTab] = useState('main');

  const load = useCallback(async () => {
    try {
      const {data} = await tasksApi.getTask(id);
      setTask(data);
      navigation.setOptions?.({title: data.title});
    } catch (e) {
      Alert.alert('Не получилось', 'Задача не открылась');
      navigation.goBack();
    }
  }, [id, navigation]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const run = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      Alert.alert('Готово', message);
      await load();
    } catch (e) {
      Alert.alert('Не получилось', e?.response?.data?.error || 'Попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Изменить срок: сдвинуть его или сделать работу другой длительности.
   *
   * Одно действие, а не два, как было сначала («Перенести» и «Растянуть»): и то и
   * другое — новый срок у той же работы, и различает их только длина. Веб
   * различает её сам по выбранному в календаре диапазону; здесь календаря с
   * диапазоном нет, поэтому спрашиваем списком — но вопрос один.
   *
   * Сдвиг сохраняет длительность и идёт в счётчик трёх переносов; другое число
   * дней счётчик обнуляет и возвращает подзадачу во входящие, потому что часы по
   * новым дням надо разложить заново. Эту же границу держит сервер: /move
   * откажет, если длина изменилась, а /stretch — если не изменилась.
   */
  const reschedule = async part => {
    const frame = windowOf(part);
    const days = Math.round(
      (new Date(`${frame.to}T00:00:00`) - new Date(`${frame.from}T00:00:00`)) / 86400000,
    ) + 1;

    const lengths = [1, 2, 3, 5, 10]
      .filter(n => n !== days)
      .map(n => ({
        text: n === 1
          ? `Один день — ${dnum(frame.from)}`
          : `${n} дн. — ${dateRange(frame.from, addDays(frame.from, n - 1))}`,
        onPress: () => run(
          () => tasksApi.stretchPart(part.id, frame.from, addDays(frame.from, n - 1)),
          n === 1
            ? `Снова один день — ${dfull(frame.from)}.`
            : `Срок: ${dateRange(frame.from, addDays(frame.from, n - 1))}. Осталось разложить часы по дням.`,
        ),
      }));

    Alert.alert(
      'Изменить срок',
      `Сейчас ${days === 1 ? `один день, ${dnum(frame.to)}` : `${days} дн., ${dateRange(frame.from, frame.to)}`}.`
      + '\n\nСдвиг сохранит длительность и пойдёт в счётчик переносов. Другое число дней вернёт подзадачу во входящие — часы по дням надо будет разложить заново.',
      [
        {text: 'Сдвинуть на ближайшее свободное', onPress: () => moveToNextFit(part)},
        ...lengths,
        {text: 'Отмена', style: 'cancel'},
      ],
    );
  };

  /**
   * Сдвиг на ближайшее подходящее место. Ищет сервер: у него все дни и все нормы.
   *
   * «Нет окна» — валидный ответ, и показать его надо честно, а не подобрать день
   * молча. У работы в несколько дней сервер возвращает окно той же длины.
   */
  const moveToNextFit = async part => {
    setBusy(true);
    try {
      const {data: fit} = await tasksApi.getNextFit(part.id, {
        start: addDays(String(part.dueDate), 1),
      });
      if (!fit.date) {
        Alert.alert(
          'Нет свободного места',
          isWindowed(part)
            ? 'В ближайшие 30 дней срока под этот объём нет.'
            : 'В ближайшие 30 дней задача не помещается.',
        );
        return;
      }
      await tasksApi.movePart(part.id, fit.from || fit.date, fit.from ? fit.date : undefined);
      Alert.alert(
        'Перенесено',
        fit.from
          ? `Новый срок: ${dateRange(fit.from, fit.date)}. Осталось разложить часы по дням.`
          : `Новый день: ${dfull(fit.date)}.`,
      );
      await load();
    } catch (e) {
      Alert.alert('Не получилось', e?.response?.data?.error || 'Попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  if (!task) return <LogoLoader />;

  const parts = [...(task.parts || [])].sort(
    (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
  );
  const TaskStatusIcon = STATUS_ICON[task.status];
  const TABS = [
    ['main', 'Основное', FileText],
    ...(parts.length > 1 ? [['scheme', 'Схема', GitBranch]] : []),
    ['history', 'История', History],
  ];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{padding: 16, paddingBottom: tabInset + 24}}>
      <View style={styles.head}>
        <View style={{flex: 1}}>
          {!!task.code && <Text style={styles.code}>{task.code}</Text>}
          <Text style={styles.title}>{task.title}</Text>
        </View>
        {TaskStatusIcon && (
          <TaskStatusIcon size={22} strokeWidth={1.8} color={STATUS_COLOR[task.status]} />
        )}
      </View>

      <View style={styles.headMeta}>
        {!!task.project?.name && <Text style={styles.headMetaText}>{task.project.name}</Text>}
        <Text style={styles.headMetaText}>{MODE_LABEL[task.mode]}</Text>
        <View style={styles.headMetaRow}>
          <Clock size={13} color={c.textTertiary} />
          <Text style={styles.headMetaText}>{clockText(task.totalEffortHours)}</Text>
        </View>
        {/* Срок задачи (ver. 8.48) — главное поле, и в карточке оно рядом с
            остальными реквизитами. Своего срока может и не быть: тогда
            показываем, на какие дни задача расписана по подзадачам. Бейдж
            «срок нарушен» говорит о расхождении, а какая подзадача вылезла —
            видно отметкой на ней самой. */}
        {(task.dueDate || task.span) && (
          <Text style={[styles.headMetaText, task.breaksDeadline && {color: c.error}]}>
            {task.dueDate
              ? dateRange(task.startDate || task.dueDate, task.dueDate)
              : dateRange(task.span.from, task.span.to)}
            {task.breaksDeadline ? ' · срок нарушен' : ''}
          </Text>
        )}
      </View>

      <View style={styles.author}>
        <Avatar uri={task.author?.avatar} size={22} />
        <Text style={styles.authorText}>{shortName(task.author)}</Text>
      </View>

      {/* Переключатель вкладок повторяет веб: одна панель с тремя положениями. */}
      <View style={styles.tabs}>
        {TABS.map(([key, label, Icon]) => (
          <Pressable
            key={key}
            style={[styles.tab, tab === key && styles.tabOn]}
            onPress={() => setTab(key)}>
            <Icon size={14} color={tab === key ? '#FFFFFF' : c.textSecondary} />
            <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'main' && (<>
      {!!task.description && (
        <>
          <Text style={styles.section}>Описание</Text>
          <Text style={styles.description}>{task.description}</Text>
        </>
      )}

      {!!task.attachments?.length && (
        <>
          <Text style={styles.section}>Файлы · {task.attachments.length}</Text>
          {task.attachments.map((file, index) => (
            <Pressable
              key={file.id || file.path || index}
              style={styles.file}
              onPress={() => {
                const url = CONFIG.fileUrl(file.path || file.url);
                if (url) Linking.openURL(url).catch(() => Alert.alert('Не получилось', 'Файл не открылся'));
              }}>
              <View style={styles.fileExt}>
                <Text style={styles.fileExtText}>
                  {String(file.filename || file.originalName || 'file').split('.').pop()?.slice(0, 4).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.fileName} numberOfLines={1}>
                {file.filename || file.originalName || 'Вложение'}
              </Text>
              <Text style={styles.fileOpen}>Открыть</Text>
            </Pressable>
          ))}
        </>
      )}

      </>)}

      {tab === 'scheme' && (
        <>
          <View style={styles.scheme}>
            {parts.map((part, index) => {
              const prerequisites = (task.deps || [])
                .filter(dep => dep.partId === part.id)
                .map(dep => task.parts.find(item => item.id === dep.afterPartId)?.title)
                .filter(Boolean);
              return (
                <View style={styles.schemeRow} key={part.id}>
                  <View style={styles.schemeIndex}><Text style={styles.schemeIndexText}>{index + 1}</Text></View>
                  <View style={{flex: 1}}>
                    {!!task.code && (
                      <Text style={styles.code}>{partCode(task.code, index)}</Text>
                    )}
                    <Text style={styles.schemeTitle}>{part.title}</Text>
                    <View style={styles.schemeMeta}>
                      <Text style={styles.schemeMetaText}>
                        {(part.assignees || []).map(a => shortName(a.user)).join(', ')}
                      </Text>
                      <View style={styles.headMetaRow}>
                        <Clock size={12} color={c.textTertiary} />
                        <Text style={styles.schemeMetaText}>{clockText(part.estimateHours)}</Text>
                      </View>
                    </View>
                    {!!prerequisites.length && (
                      <Text style={styles.schemeAfter}>после: {prerequisites.join(', ')}</Text>
                    )}
                  </View>
                  {STATUS_ICON[part.status] && React.createElement(STATUS_ICON[part.status], {
                    size: 17, strokeWidth: 1.8, color: STATUS_COLOR[part.status],
                  })}
                </View>
              );
            })}
          </View>
        </>
      )}

      {tab === 'main' && (<>
      <Text style={styles.section}>Подзадачи — {parts.length}</Text>
      {parts.map((part, partIndex) => {
        const mine = (part.assignees || []).find(a => a.userId === user?.id);
        const notPlanned = (part.assignees || []).filter(a => !a.plannedDate);
        const partHistory = (task.history || []).filter(row => row.partId === part.id);
        const actions = partHistory.map(row => row.action);
        const hasPendingProposal = actions.lastIndexOf('proposed_date') > actions.lastIndexOf('accepted_date');
        const PartStatusIcon = STATUS_ICON[part.status];
        // Многодневная подзадача (ver. 8.48): окно [startDate..dueDate]. Часы по
        // его дням раскладывает исполнитель, и в календаре появляется по блоку на
        // день, а не один блок на всю работу.
        const windowed = isWindowed(part);
        const frame = windowOf(part);

        return (
          <View key={part.id} style={styles.part}>
            <View style={styles.partHead}>
              <View style={{flex: 1}}>
                {!!task.code && (
                  <Text style={styles.code}>
                    {partCode(task.code, parts.length > 1 ? partIndex : null)}
                  </Text>
                )}
                <Text style={styles.partTitle}>{part.title}</Text>
              </View>
              {PartStatusIcon && (
                <PartStatusIcon size={19} strokeWidth={1.8} color={STATUS_COLOR[part.status]} />
              )}
            </View>

            <View style={styles.partMetaRow}>
              <Text style={styles.partMeta}>
                {(part.assignees || []).map(a => shortName(a.user)).join(', ')}
              </Text>
              <View style={styles.headMetaRow}>
                <Clock size={13} color={c.textTertiary} />
                <Text style={styles.partMeta}>{clockText(part.estimateHours)}</Text>
              </View>
              <Text style={styles.partMeta}>
                · {windowed ? dateRange(frame.from, frame.to) : ddate(String(part.dueDate))}
              </Text>
              {windowed && mine?.plannedDate && mine?.plannedUntil && (
                <Text style={[styles.partMeta, {color: c.success}]}>
                  · в плане {dateRange(mine.plannedDate, mine.plannedUntil)}
                </Text>
              )}
              {part.moveCount > 0 && (
                <Text style={[styles.partMeta, {color: c.warning}]}>
                  · переносов {part.moveCount}
                </Text>
              )}
            </View>

            {/* Какая подзадача вышла за срок задачи — видно на ней самой, а не
                общим предупреждением: иначе человек должен угадывать. */}
            {!!part.outsideTask && (
              <Text style={[styles.partNote, {color: c.error}]}>
                {part.outsideTask === 'after'
                  ? `Выходит за срок задачи${task.dueDate ? ` — ${dnum(task.dueDate)}` : ''}`
                  : `Начинается раньше срока задачи${task.startDate ? ` — ${dnum(task.startDate)}` : ''}`}
              </Text>
            )}

            {!!notPlanned.length && (
              <Text style={[styles.partNote, {color: c.warning}]}>
                Не обработали: {notPlanned.map(a => shortName(a.user)).join(', ')}
              </Text>
            )}

            {/* Застрявшая часть: кнопки «перенести ещё раз» здесь нет
                специально — после третьего переноса нужен выбор, а не перенос. */}
            {part.status === 'stuck' && (
              <View style={styles.stuck}>
                <Text style={[styles.stuckTitle, {color: c.error}]}>Требует решения</Text>
                <Text style={styles.stuckText}>
                  Подзадача переносится третий раз подряд. Обычно это значит, что она
                  слишком крупная, идёт дольше одного дня или на самом деле не нужна.
                </Text>
                <View style={styles.acts}>
                  <Pressable
                    style={[styles.btn, busy && styles.btnOff]}
                    disabled={busy}
                    onPress={() =>
                      run(
                        () => tasksApi.splitPart(part.id, {}),
                        'Разбито надвое — теперь подзадачи мельче и помещаются в день.',
                      )
                    }>
                    <Text style={styles.btnText}>Разбить на подзадачи</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btn, busy && styles.btnOff]}
                    disabled={busy}
                    onPress={() => reschedule(part)}>
                    <Text style={styles.btnText}>Изменить срок</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {mine && part.status !== 'stuck' && (
              <View style={styles.acts}>
                {!mine.plannedDate ? (
                  <Pressable
                    style={[styles.btn, styles.btnPrimary, busy && styles.btnOff]}
                    disabled={busy}
                    onPress={() =>
                      windowed
                        ? setLayout({part, window: frame})
                        : run(
                          () => tasksApi.planPart(part.id, String(part.dueDate)),
                          `В плане на ${dfull(String(part.dueDate))}.`,
                        )
                    }>
                    <Text style={styles.btnPrimaryText}>
                      {windowed ? 'Разложить по дням' : 'Взять в план'}
                    </Text>
                  </Pressable>
                ) : part.status === 'done' ? (
                  <Pressable
                    style={[styles.btn, busy && styles.btnOff]}
                    disabled={busy}
                    onPress={() =>
                      run(() => tasksApi.setPartStatus(part.id, 'work'), 'Возвращено в работу.')
                    }>
                    <Text style={styles.btnText}>Вернуть в работу</Text>
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      style={[styles.btn, styles.btnPrimary, busy && styles.btnOff]}
                      disabled={busy}
                      onPress={() =>
                        run(
                          () => tasksApi.setPartStatus(part.id, 'done'),
                          'Завершено. Время освободилось — день пересчитан.',
                        )
                      }>
                      <Text style={styles.btnPrimaryText}>Завершить</Text>
                    </Pressable>
                    {part.status !== 'review' && (
                      <Pressable
                        style={[styles.btn, busy && styles.btnOff]}
                        disabled={busy}
                        onPress={() =>
                          run(
                            () => tasksApi.setPartStatus(part.id, 'review'),
                            'Отправлено на проверку.',
                          )
                        }>
                        <Text style={styles.btnText}>На проверку</Text>
                      </Pressable>
                    )}
                    {/* Одна кнопка на сдвиг и на другую длительность: и то и
                        другое — новый срок у той же работы. Что именно выбрали,
                        видно в списке, который она открывает. */}
                    <Pressable
                      style={[styles.btn, busy && styles.btnOff]}
                      disabled={busy}
                      onPress={() => reschedule(part)}>
                      <Text style={styles.btnText}>Изменить срок</Text>
                    </Pressable>
                    {/* Те же шаги продления, что в вебе: получасом обходилось
                        не всегда, и кнопку жали по четыре раза подряд. */}
                    {[[0.25, '+15 мин'], [0.5, '+30 мин'], [1, '+1 ч'], [2, '+2 ч']].map(([hours, label]) => (
                      <Pressable
                        key={hours}
                        style={[styles.btn, busy && styles.btnOff]}
                        disabled={busy}
                        onPress={() =>
                          run(
                            () => tasksApi.extendPart(part.id, hours),
                            `Продлено на ${label.slice(1)} — загрузка пересчитана.`,
                          )
                        }>
                        <Text style={styles.btnText}>{label}</Text>
                      </Pressable>
                    ))}
                  </>
                )}
              </View>
            )}

            {task.authorId === user?.id && !mine && part.status === 'new' && hasPendingProposal && (
              <View style={styles.acts}>
                <Pressable
                  style={[styles.btn, styles.btnPrimary, busy && styles.btnOff]}
                  disabled={busy}
                  onPress={() => run(
                    () => tasksApi.acceptDate(part.id),
                    `Срок согласован: ${dfull(String(part.dueDate))}.`,
                  )}>
                  <Text style={styles.btnPrimaryText}>Согласовать срок</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}

      </>)}

      {tab === 'history' && (
        !task.history?.length ? (
          <Text style={styles.historyEmpty}>История пока пуста.</Text>
        ) : (
          /* Лента с рельсой и цветной точкой — как в вебе: по цвету видно, что
             это было, ещё до чтения текста. */
          task.history.map((row, index) => (
            <View key={row.id} style={styles.historyRow}>
              <View style={styles.historyRail}>
                <View style={[styles.historyDot, {backgroundColor: historyColor(c, row)}]} />
                {index < task.history.length - 1 && <View style={styles.historyLine} />}
              </View>
              <View style={styles.historyCard}>
                <View style={styles.historyHead}>
                  <Text style={styles.historyWho}>{shortName(row.user)}</Text>
                  <Text style={styles.historyWhen}>
                    {new Date(row.createdAt).toLocaleString('ru-RU', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </Text>
                </View>
                <Text style={styles.historyWhat}>{historyText(row)}</Text>
              </View>
            </View>
          ))
        )
      )}

      {task.authorId === user?.id && (
        <Pressable
          style={[styles.cancelBtn, busy && styles.btnOff]}
          disabled={busy}
          onPress={() => Alert.alert(
            'Отменить задачу?',
            'Запланированное время вернётся исполнителям.',
            [
              {text: 'Не отменять', style: 'cancel'},
              {
                text: 'Отменить задачу',
                style: 'destructive',
                onPress: async () => {
                  setBusy(true);
                  try {
                    await tasksApi.cancelTask(task.id);
                    navigation.goBack();
                  } catch (e) {
                    Alert.alert('Не получилось', e?.response?.data?.error || 'Попробуйте ещё раз');
                    setBusy(false);
                  }
                },
              },
            ],
          )}>
          <Text style={styles.cancelText}>Отменить задачу</Text>
        </Pressable>
      )}

      {/* Лист раскладки — один на экран, а не по одному на подзадачу: модальное
          окно в задаче из четырёх подзадач должно быть одно. */}
      {!!layout && (
        <LayoutSheet
          visible
          window={layout.window}
          estimateHours={layout.part.estimateHours}
          userId={user?.id}
          title={layout.part.title}
          busy={busy}
          onClose={() => setLayout(null)}
          onSubmit={(rows, force) => {
            const {part} = layout;
            setLayout(null);
            return run(
              () => tasksApi.planPartLayout(part.id, rows, force),
              force
                ? `Взято сверх нормы на ${rows.length} дн. — автор увидит переработку.`
                : `В плане: ${rows.length} дн., ${hoursText(part.estimateHours)}.`,
            );
          }}
        />
      )}
    </ScrollView>
  );
}

const makeStyles = c =>
  StyleSheet.create({
    root: {flex: 1, backgroundColor: c.bgSecondary},

    head: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
    code: {fontFamily: font.semiBold, fontSize: 11, letterSpacing: 0.2, color: c.textTertiary, marginBottom: 3},
    title: {fontFamily: font.semiBold, fontSize: 20, color: c.textPrimary, lineHeight: 27},

    headMeta: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 10},
    headMetaRow: {flexDirection: 'row', alignItems: 'center', gap: 4},
    headMetaText: {fontFamily: font.regular, fontSize: 12.5, color: c.textTertiary},

    // Панель вкладок: активная — залитая пилюля, как ползунок в вебе.
    tabs: {
      flexDirection: 'row', gap: 4, padding: 4, marginTop: 14, marginBottom: 6,
      borderRadius: radius.lg, backgroundColor: c.bgSecondary,
    },
    tab: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 6, paddingVertical: 8, borderRadius: radius.md,
    },
    tabOn: {backgroundColor: c.primary},
    tabText: {fontFamily: font.medium, fontSize: 13, color: c.textSecondary},
    tabTextOn: {fontFamily: font.semiBold, color: '#FFFFFF'},

    partMetaRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginTop: 7},
    schemeMeta: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 5},
    schemeMetaText: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary},

    badges: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12},
    badge: {paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20},
    badgeText: {fontFamily: font.medium, fontSize: 11},
    author: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, marginTop: 12},

    section: {
      fontFamily: font.semiBold,
      fontSize: 12,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: c.textTertiary,
      marginTop: 22,
      marginBottom: 10,
    },
    description: {
      fontFamily: font.regular,
      fontSize: 14,
      color: c.textPrimary,
      lineHeight: 22,
    },
    file: {flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, marginBottom: 7, borderRadius: radius.md, backgroundColor: c.bgPrimary},
    fileExt: {width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: c.primaryLight},
    fileExtText: {fontFamily: font.semiBold, fontSize: 9.5, color: c.primary},
    fileName: {flex: 1, fontFamily: font.medium, fontSize: 13.5, color: c.textPrimary},
    fileOpen: {fontFamily: font.regular, fontSize: 12, color: c.primary},
    scheme: {padding: 12, borderRadius: radius.lg, backgroundColor: c.bgPrimary},
    schemeRow: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7},
    schemeIndex: {width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: c.primaryLight},
    schemeIndexText: {fontFamily: font.semiBold, fontSize: 11, color: c.primary},
    schemeTitle: {fontFamily: font.medium, fontSize: 13.5, color: c.textPrimary},
    schemeAfter: {fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary, marginTop: 2},

    part: {
      backgroundColor: c.bgPrimary,
      borderRadius: radius.lg,
      padding: 14,
      marginBottom: 10,
    },
    partHead: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
    partTitle: {flex: 1, fontFamily: font.medium, fontSize: 15, color: c.textPrimary},
    partMeta: {fontFamily: font.regular, fontSize: 12.5, color: c.textSecondary, marginTop: 7},
    partNote: {fontFamily: font.regular, fontSize: 12.5, marginTop: 6},

    stuck: {
      backgroundColor: c.bgSecondary,
      borderRadius: radius.md,
      padding: 12,
      marginTop: 12,
    },
    stuckTitle: {fontFamily: font.semiBold, fontSize: 13.5},
    stuckText: {
      fontFamily: font.regular,
      fontSize: 12.5,
      color: c.textSecondary,
      lineHeight: 19,
      marginTop: 5,
      marginBottom: 10,
    },

    acts: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12},
    btn: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.md,
      backgroundColor: c.bgSecondary,
    },
    btnOff: {opacity: 0.5},
    btnText: {fontFamily: font.regular, fontSize: 13.5, color: c.textPrimary},
    btnPrimary: {backgroundColor: c.primary},
    btnPrimaryText: {fontFamily: font.semiBold, fontSize: 13.5, color: '#FFFFFF'},

    historyRow: {flexDirection: 'row', gap: 10},
    historyRail: {alignItems: 'center', width: 12, paddingTop: 5},
    historyDot: {width: 9, height: 9, borderRadius: 5},
    historyLine: {flex: 1, width: StyleSheet.hairlineWidth, backgroundColor: c.borderLight, marginTop: 3},
    historyCard: {
      flex: 1, marginBottom: 12, padding: 11,
      borderRadius: radius.md, backgroundColor: c.bgPrimary,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderLight,
    },
    historyHead: {flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 2},
    historyWho: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary},
    historyWhat: {flex: 1, fontFamily: font.regular, fontSize: 13, color: c.textSecondary},
    historyWhen: {fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary},
    historyEmpty: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary},

    cancelBtn: {alignItems: 'center', padding: 12, marginTop: 18, borderRadius: radius.md, backgroundColor: c.errorLight || `${c.error}15`},
    cancelText: {fontFamily: font.medium, fontSize: 13.5, color: c.error},
  });
