/**
 * Главный экран модуля «Задачи» — он же календарь.
 *
 * Занял место вкладки «Календарь» и не отобрал у неё ничего: месячная сетка,
 * список дня и переход в событие остались. Добавилось то, ради чего модуль и
 * делался, — полоса загрузки. Теперь день отвечает не только на вопрос «что у
 * меня стоит», но и на вопрос «сколько у меня осталось».
 *
 * Три режима вверху. День — план по часам, неделя — где завал, месяц — весь
 * период сразу. Недельная сетка из веба сюда не переносилась: на узком экране
 * семь колонок с блоками нечитаемы. Вместо неё — столбики загрузки, где неделя
 * читается одним взглядом, а состав дня открывается нажатием.
 */

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {ChevronLeft, ChevronRight, Bell, ListTodo, Plus, CalendarDays, MoreHorizontal, Users} from 'lucide-react-native';

import {tasks as tasksApi, calendar as calendarApi, chat as chatApi} from '../../services/api';
import BottomSheet from '../../components/BottomSheet';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useSettings, useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {useAuth} from '../../store/authStore';
import {setInboxCount, useInboxCount} from '../../store/tasksStore';
import LoadBar from './LoadBar';
import {
  DOW, addDays, addMonths, dayEvents, dfull, dstr, estimateText,
  eventHours, fromKey, hoursText, monthGrid, monthTitle, today,
  weekOf, loadColor,
} from './taskMeta';

export default function TasksScreen({navigation}) {
  const c = useTheme();
  const settings = useSettings();
  const styles = useThemedStyles(makeStyles);
  const tabInset = useTabBarInset();
  const {user} = useAuth();
  const inboxCount = useInboxCount();

  const [view, setView] = useState('day');
  const [cursor, setCursor] = useState(today);
  const [days, setDays] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [people, setPeople] = useState([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [teams, setTeams] = useState([]);
  const [teamLoad, setTeamLoad] = useState(null);
  const [teamLoadBusy, setTeamLoadBusy] = useState(false);
  const [fillDate, setFillDate] = useState(null);
  const [fillStep, setFillStep] = useState(30);
  const [fillRange, setFillRange] = useState(null);
  const [fillTitle, setFillTitle] = useState('');
  const [fillBusy, setFillBusy] = useState(false);

  useEffect(() => {
    if (!quickOpen || people.length) return;
    chatApi.getUsers().then(({data}) => setPeople(data?.users || data || [])).catch(() => {});
  }, [quickOpen, people.length]);

  useEffect(() => {
    if (!moreOpen) return;
    tasksApi.getTeams().then(({data}) => setTeams(data?.teams || [])).catch(() => setTeams([]));
  }, [moreOpen]);

  // Период выборки: у дня берём всю неделю, чтобы переключение режима не
  // требовало нового запроса — человек листает виды чаще, чем периоды.
  const period = useMemo(() => {
    if (view === 'month') {
      const grid = monthGrid(cursor).filter(Boolean);
      return {start: grid[0], end: grid[grid.length - 1]};
    }
    const week = weekOf(cursor);
    return {start: week[0], end: week[6]};
  }, [view, cursor]);

  const load = useCallback(
    async ({silent} = {}) => {
      if (!user?.id) return;
      if (!silent) setLoading(true);
      try {
        const params = {
          start: `${period.start}T00:00:00`,
          end: `${period.end}T23:59:59`,
        };
        // Аккредитации и ТО транспорта приезжают из других разделов и доступны
        // не всем: отказ сервера по ним не должен ронять весь экран.
        const [loadRes, eventsRes, integrated] = await Promise.all([
          tasksApi.getPersonLoad(user.id, period.start, period.end),
          calendarApi.getEvents(params),
          calendarApi
            .getIntegratedEvents(params.start, params.end)
            .catch(() => ({data: []})),
        ]);
        setDays(loadRes.data?.days || []);
        setEvents([...(eventsRes.data || []), ...(integrated.data || [])]);

        // Значок на вкладке обновляем отсюда же: экран открыт чаще остальных,
        // а отдельный опрос ради одной цифры сажал бы батарею.
        const inbox = await tasksApi.getInbox().catch(() => null);
        if (inbox) setInboxCount((inbox.data?.mine || []).length);
      } catch (e) {
        console.warn('[Tasks] load error:', e?.message);
        setDays([]);
        setEvents([]);
      } finally {
        setLoading(false);
      }
    },
    [user?.id, period.start, period.end],
  );

  // Перезагрузка при возврате: с карточки задачи могли взять её в план, и
  // загрузка дня изменилась.
  useFocusEffect(
    useCallback(() => {
      load({silent: days.length > 0});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load({silent: true});
    setRefreshing(false);
  };

  const byDate = useMemo(() => new Map(days.map(d => [d.date, d])), [days]);
  const dayLoad = byDate.get(cursor);

  const shift = back => {
    if (view === 'month') setCursor(addMonths(cursor, back ? -1 : 1));
    else if (view === 'week') setCursor(addDays(cursor, back ? -7 : 7));
    else setCursor(addDays(cursor, back ? -1 : 1));
  };

  const periodTitle =
    view === 'month'
      ? monthTitle(cursor)
      : view === 'week'
        ? `${dstr(weekOf(cursor)[0])} — ${dstr(weekOf(cursor)[6])}`
        : dfull(cursor);

  if (loading) return <LogoLoader />;

  const createQuick = async () => {
    const parsed = parseQuick(quickText, cursor, people, user);
    if (!parsed?.title) return;
    if (parsed.mention && !parsed.assignee) {
      Alert.alert('Сотрудник не найден', `Не удалось найти @${parsed.mention}`);
      return;
    }
    setQuickBusy(true);
    try {
      if (parsed.personal) {
        const start = new Date(`${parsed.date}T10:00:00`);
        const end = new Date(start.getTime() + parsed.hours * 60 * 60 * 1000);
        await calendarApi.createEvent({
          title: parsed.title,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          eventType: 'personal',
          status: 'planned',
          visibility: settings.taskDefaultVisibility || 'private',
        });
      } else {
        await tasksApi.createTask({
          title: parsed.title,
          parts: [{
            id: 'quick-1',
            title: parsed.title,
            assignees: [parsed.assigneeId],
            estimateHours: parsed.hours,
            dueDate: parsed.date,
            after: [],
          }],
        });
      }
      setQuickText('');
      setQuickOpen(false);
      await load({silent: true});
    } catch (e) {
      Alert.alert('Не получилось', e?.response?.data?.error || 'Проверьте данные и попробуйте ещё раз');
    } finally {
      setQuickBusy(false);
    }
  };

  return (
    <View style={styles.root}>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{paddingBottom: tabInset + 24}}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />
      }>
      {/* Шапка: загрузка дня и два входа — во входящие и в список задач.
          Отдельных вкладок под них внизу нет: панель уже занята пятью
          разделами портала, и второй ряд ячеек под ней читался бы как ошибка. */}
      <View style={styles.head}>
        <View style={styles.headRow}>
          <View style={{flex: 1}}>
            <Text style={styles.title}>{periodTitle}</Text>
            <Text style={styles.subtitle}>
              {dayLoad?.onVacation
                ? 'Отпуск — задачи на этот день не ставятся'
                : dayLoad?.onDayOff
                  ? 'Выходной по рабочему расписанию'
                : dayLoad?.norm
                  ? `${hoursText(dayLoad.hours)} из ${hoursText(dayLoad.norm)}`
                  : 'Рабочее расписание не настроено'}
            </Text>
          </View>

          <Pressable
            style={styles.iconBtn}
            onPress={() => navigation.navigate('TasksInbox')}
            accessibilityLabel="Входящие задачи">
            <Bell size={20} color={c.textSecondary} />
            {inboxCount > 0 && (
              <View style={styles.dot}>
                <Text style={styles.dotText}>{inboxCount > 9 ? '9+' : inboxCount}</Text>
              </View>
            )}
          </Pressable>

          <Pressable
            style={styles.iconBtn}
            onPress={() => navigation.navigate('TasksList')}
            accessibilityLabel="Мои задачи">
            <ListTodo size={20} color={c.textSecondary} />
          </Pressable>
        </View>

        {view === 'day' && dayLoad && !dayLoad.onVacation && dayLoad.norm ? (
          <View style={styles.capsule}>
            <LoadBar {...dayLoad} />
            <Text style={styles.capsuleText}>
              {dayLoad.color === 'r'
                ? `Переработка ${hoursText(dayLoad.hours - dayLoad.norm)}`
                : `Свободно ${hoursText(dayLoad.free)}`}
            </Text>
          </View>
        ) : null}

        <View style={styles.seg}>
          {[
            ['day', 'День'],
            ['week', 'Неделя'],
            ['month', 'Месяц'],
          ].map(([key, label]) => (
            <Pressable
              key={key}
              style={[styles.segBtn, view === key && styles.segBtnOn]}
              onPress={() => setView(key)}>
              <Text style={[styles.segText, view === key && styles.segTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.nav}>
          <Pressable style={styles.navBtn} onPress={() => shift(true)} hitSlop={8}>
            <ChevronLeft size={20} color={c.textSecondary} />
          </Pressable>
          <Pressable style={styles.todayBtn} onPress={() => setCursor(today())}>
            <Text style={styles.todayText}>Сегодня</Text>
          </Pressable>
          <Pressable style={styles.navBtn} onPress={() => shift(false)} hitSlop={8}>
            <ChevronRight size={20} color={c.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.moduleNav}>
          <Pressable style={[styles.moduleNavBtn, styles.moduleNavBtnOn]}>
            <CalendarDays size={16} color={c.primary} />
            <Text style={[styles.moduleNavText, {color: c.primary}]}>Календарь</Text>
          </Pressable>
          <Pressable style={styles.moduleNavBtn} onPress={() => navigation.navigate('TasksInbox')}>
            <Bell size={16} color={c.textSecondary} />
            <Text style={styles.moduleNavText}>Входящие</Text>
          </Pressable>
          <Pressable style={styles.moduleNavBtn} onPress={() => navigation.navigate('TasksList')}>
            <ListTodo size={16} color={c.textSecondary} />
            <Text style={styles.moduleNavText}>Задачи</Text>
          </Pressable>
          <Pressable style={styles.moduleNavBtn} onPress={() => setMoreOpen(true)}>
            <MoreHorizontal size={17} color={c.textSecondary} />
            <Text style={styles.moduleNavText}>Ещё</Text>
          </Pressable>
        </View>
      </View>

      {view === 'day' && (
        <DayView
          date={cursor}
          load={dayLoad}
          events={dayEvents(events, cursor)}
          styles={styles}
          c={c}
          onOpenEvent={async event => {
            if (event.taskPartId) {
              try {
                const {data} = await tasksApi.getPartTask(event.taskPartId);
                navigation.navigate('TaskCard', {id: data.taskId});
              } catch {
                navigation.navigate('CalendarEvent', {event});
              }
              return;
            }
            navigation.navigate('CalendarEvent', {event});
          }}
          onTaskDone={async event => {
            try {
              await tasksApi.setPartStatus(event.taskPartId, 'done');
              await load({silent: true});
            } catch (e) {
              Alert.alert('Не получилось', e?.response?.data?.error || 'Попробуйте ещё раз');
            }
          }}
          onTaskExtend={event => Alert.alert(
            `Продлить «${event.title}»`,
            'Свободное время дня уменьшится, следующие блоки сдвинутся.',
            [15, 30, 60].map(minutes => ({
              text: `+ ${minutes} мин`,
              onPress: async () => {
                try {
                  await tasksApi.extendPart(event.taskPartId, minutes / 60);
                  await load({silent: true});
                } catch (e) {
                  Alert.alert('Не получилось', e?.response?.data?.error || 'Попробуйте ещё раз');
                }
              },
            })).concat({text: 'Отмена', style: 'cancel'}),
          )}
          onFill={() => {
            setFillDate(cursor);
            setFillRange(null);
            setFillTitle('');
          }}
          // Создание события осталось от календаря: занять время под личное
          // дело — это то же самое действие, что «запланировать» в прототипе.
          onCreate={() =>
            navigation.navigate('CalendarEventEdit', {
              date: fromKey(cursor).toISOString(),
            })
          }
        />
      )}

      {view === 'week' && (
        <WeekView
          cursor={cursor}
          byDate={byDate}
          styles={styles}
          c={c}
          onPick={date => {
            setCursor(date);
            setView('day');
          }}
        />
      )}

      {view === 'month' && (
        <MonthView
          cursor={cursor}
          byDate={byDate}
          events={events}
          styles={styles}
          c={c}
          onPick={date => {
            setCursor(date);
            setView('day');
          }}
        />
      )}
    </ScrollView>

      <Pressable
        style={[styles.fab, {bottom: tabInset + 14}]}
        onPress={() => setQuickOpen(true)}
        accessibilityLabel="Быстро создать задачу">
        <Plus size={27} color="#FFFFFF" />
      </Pressable>

      <BottomSheet visible={quickOpen} title="Быстрый ввод" onClose={() => setQuickOpen(false)}>
        <View style={styles.quickBody}>
          <Text style={styles.quickHint}>
            Например: «Подготовить отчёт завтра 2 ч @Анна». Личные дела можно
            написать как «Врач завтра 1 ч».
          </Text>
          <TextInput
            style={styles.quickInput}
            value={quickText}
            onChangeText={setQuickText}
            placeholder="Что сделать, когда и сколько"
            placeholderTextColor={c.textTertiary}
            autoFocus
            multiline
          />
          {!!quickText.trim() && (
            <QuickPreview parsed={parseQuick(quickText, cursor, people, user)} styles={styles} />
          )}
          <Pressable
            style={[styles.quickSubmit, (!quickText.trim() || quickBusy) && styles.btnOff]}
            disabled={!quickText.trim() || quickBusy}
            onPress={createQuick}>
            <Text style={styles.quickSubmitText}>{quickBusy ? 'Создаём…' : 'Создать'}</Text>
          </Pressable>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={Boolean(fillDate)}
        title={`Свободное время · ${fillDate ? dstr(fillDate) : ''}`}
        onClose={() => setFillDate(null)}>
        <View style={styles.fillBody}>
          <Text style={styles.quickHint}>Выберите точный интервал или возьмите подходящую задачу из входящих.</Text>
          <View style={styles.fillSteps}>
            {[15, 30, 60].map(value => (
              <Pressable
                key={value}
                style={[styles.visibilityChoice, fillStep === value && styles.visibilityChoiceOn]}
                onPress={() => { setFillStep(value); setFillRange(null); }}>
                <Text style={[styles.visibilityChoiceText, fillStep === value && {color: c.primary}]}>{value} мин</Text>
              </Pressable>
            ))}
          </View>
          <MobileSlots
            events={dayEvents(events, fillDate)}
            step={fillStep}
            range={fillRange}
            onRange={setFillRange}
            styles={styles}
            c={c}
          />
          <TextInput
            style={styles.fillInput}
            value={fillTitle}
            onChangeText={setFillTitle}
            placeholder="Название личного дела"
            placeholderTextColor={c.textTertiary}
          />
          <Pressable
            style={[styles.quickSubmit, (!fillRange || !fillTitle.trim() || fillBusy) && styles.btnOff]}
            disabled={!fillRange || !fillTitle.trim() || fillBusy}
            onPress={async () => {
              const start = fromKey(fillDate);
              start.setHours(8, fillRange.start * fillStep, 0, 0);
              const end = new Date(start.getTime() + (fillRange.end - fillRange.start + 1) * fillStep * 60000);
              setFillBusy(true);
              try {
                await calendarApi.createEvent({
                  title: fillTitle.trim(),
                  startTime: start.toISOString(),
                  endTime: end.toISOString(),
                  eventType: 'personal',
                  status: 'planned',
                  visibility: settings.taskDefaultVisibility || 'private',
                });
                setFillDate(null);
                await load({silent: true});
              } catch (e) {
                Alert.alert('Не получилось', e?.response?.data?.error || 'Не удалось занять интервал');
              } finally {
                setFillBusy(false);
              }
            }}>
            <Text style={styles.quickSubmitText}>{fillBusy ? 'Добавляем…' : 'Добавить в день'}</Text>
          </Pressable>
          <Pressable style={styles.fillInbox} onPress={() => {
            const date = fillDate;
            setFillDate(null);
            navigation.navigate('TasksInbox', {planDate: date, freeHours: dayLoad?.free || 0});
          }}>
            <Text style={styles.fillInboxText}>Взять задачу из входящих ›</Text>
          </Pressable>
        </View>
      </BottomSheet>

      <BottomSheet visible={moreOpen} title="Ещё" onClose={() => setMoreOpen(false)}>
        <View style={styles.moreBody}>
          <Pressable style={styles.moreRow} onPress={() => {
            setMoreOpen(false);
            navigation.getParent()?.navigate('SettingsTab', {screen: 'TasksNorm'});
          }}>
            <Text style={styles.moreTitle}>Рабочее расписание</Text>
            <Text style={styles.moreValue}>{dayLoad?.onDayOff ? 'сегодня выходной' : dayLoad?.norm ? `${hoursText(dayLoad.norm)} сегодня` : 'настроить'} ›</Text>
          </Pressable>
          <View style={styles.moreSection}>
            <Text style={styles.moreSectionText}>Видимость личных дел</Text>
          </View>
          <View style={styles.visibilityChoices}>
            {[
              ['private', 'Только я'],
              ['busy', 'Только «занято»'],
              ['team', 'Моей команде'],
              ['public', 'Всем'],
            ].map(([key, label]) => (
              <Pressable
                key={key}
                style={[
                  styles.visibilityChoice,
                  settings.taskDefaultVisibility === key && styles.visibilityChoiceOn,
                ]}
                onPress={() => settings.update({taskDefaultVisibility: key})}>
                <Text style={[
                  styles.visibilityChoiceText,
                  settings.taskDefaultVisibility === key && {color: c.primary},
                ]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.moreSection}>
            <Users size={16} color={c.textTertiary} />
            <Text style={styles.moreSectionText}>Мои команды</Text>
          </View>
          {!teams.length ? (
            <Text style={styles.moreEmpty}>Нет доступных команд</Text>
          ) : teams.map(team => (
            <Pressable
              style={styles.moreTeam}
              key={team.id}
              disabled={!team.canSeeLoad || teamLoadBusy}
              onPress={async () => {
                setTeamLoadBusy(true);
                try {
                  const week = weekOf(cursor);
                  const {data} = await tasksApi.getTeamLoad(team.id, week[0], week[6]);
                  setTeamLoad(data);
                  setMoreOpen(false);
                } catch (e) {
                  Alert.alert('Загрузка закрыта', e?.response?.data?.error || 'Нет доступа к загрузке команды');
                } finally {
                  setTeamLoadBusy(false);
                }
              }}>
              <View>
                <Text style={styles.moreTitle}>{team.name}</Text>
                <Text style={styles.moreTeamMeta}>{team.members?.length || 0} чел.</Text>
              </View>
              <Text style={styles.moreValue}>{team.canSeeLoad ? 'загрузка ›' : 'закрыто'}</Text>
            </Pressable>
          ))}
          <Text style={styles.moreHint}>Создание команд, права доступа и отчёты доступны в веб-версии.</Text>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={Boolean(teamLoad)}
        title={teamLoad?.team?.name || 'Загрузка команды'}
        onClose={() => setTeamLoad(null)}>
        <View style={styles.teamLoadBody}>
          <Text style={styles.teamLoadSummary}>
            {teamLoad?.summary
              ? `${teamLoad.summary.percent}% загрузки · свободно ${hoursText(teamLoad.summary.freeHours)}`
              : ''}
          </Text>
          {(teamLoad?.rows || []).map(row => {
            const total = (row.days || []).reduce((sum, day) => sum + (day.hours || 0), 0);
            const over = (row.days || []).filter(day => day.color === 'r').length;
            return (
              <View style={styles.teamLoadRow} key={row.userId}>
                <View style={{flex: 1}}>
                  <Text style={styles.moreTitle}>{row.user?.displayName || row.user?.username || 'Сотрудник'}</Text>
                  <Text style={styles.moreTeamMeta}>{over ? `переработка: ${over} дн.` : 'без переработки'}</Text>
                </View>
                <Text style={styles.teamLoadHours}>{hoursText(total)}</Text>
              </View>
            );
          })}
        </View>
      </BottomSheet>
    </View>
  );
}

function parseQuick(value, fallbackDate, people, me) {
  const source = value.trim();
  if (!source) return null;
  let title = source;
  let date = fallbackDate;
  if (/\bсегодня\b/i.test(source)) date = today();
  if (/\bзавтра\b/i.test(source)) date = addDays(today(), 1);
  if (/\bпослезавтра\b/i.test(source)) date = addDays(today(), 2);

  const weekdays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  const weekdayIndex = weekdays.findIndex(label => new RegExp(`(^|\\s)${label}(?=\\s|$)`, 'i').test(source));
  if (weekdayIndex >= 0) {
    const current = (fromKey(today()).getDay() + 6) % 7;
    date = addDays(today(), (weekdayIndex - current + 7) % 7);
  }

  const hoursMatch = source.match(/(\d+(?:[.,]\d+)?)\s*(?:ч|час|часа|часов)\b/i);
  const minutesMatch = source.match(/(\d+)\s*(?:мин|минута|минуты|минут)\b/i);
  const hours = hoursMatch
    ? Number(hoursMatch[1].replace(',', '.'))
    : minutesMatch
      ? Number(minutesMatch[1]) / 60
      : 1;
  const mention = source.match(/@([\p{L}-]+)/u)?.[1]?.toLowerCase();
  const person = mention
    ? people.find(item => String(item.displayName || item.username || '').toLowerCase().startsWith(mention))
    : null;
  title = title
    .replace(/\b(сегодня|завтра|послезавтра)\b/gi, '')
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:ч|час|часа|часов)\b/gi, '')
    .replace(/(\d+)\s*(?:мин|минута|минуты|минут)\b/gi, '')
    .replace(/(^|\s)(пн|вт|ср|чт|пт|сб|вс)(?=\s|$)/gi, ' ')
    .replace(/@[\p{L}-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const personal = !mention && /врач|спорт|трениров|реб[её]н|обед|семь|английск|курс|зал|бассейн/i.test(title);
  return {
    title,
    date,
    hours: Math.max(.25, hours),
    personal,
    mention,
    assigneeId: person?.id || (!mention ? me?.id : null),
    assignee: person,
  };
}

function QuickPreview({parsed, styles}) {
  if (!parsed) return null;
  return (
    <View style={styles.quickPreview}>
      <Text style={styles.quickPreviewTitle}>{parsed.title || 'Без названия'}</Text>
      <Text style={styles.quickPreviewMeta}>
        {parsed.personal
          ? 'Личное дело'
          : parsed.mention && !parsed.assignee
            ? `Сотрудник @${parsed.mention} не найден`
            : `Задача · ${parsed.assignee?.displayName || 'мне'}`}
        {' · '}{dstr(parsed.date)} · {hoursText(parsed.hours)}
      </Text>
    </View>
  );
}

function MobileSlots({events, step, range, onRange, styles, c}) {
  const perHour = 60 / step;
  const count = 13 * perHour;
  const busy = new Set();
  (events || []).forEach(event => {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    for (let index = 0; index < count; index += 1) {
      const cellStart = 8 * 60 + index * step;
      const cellEnd = cellStart + step;
      const eventStart = start.getHours() * 60 + start.getMinutes();
      const eventEnd = end.getHours() * 60 + end.getMinutes();
      if (eventStart < cellEnd && eventEnd > cellStart) busy.add(index);
    }
  });

  const pick = index => {
    if (busy.has(index)) return;
    if (!range || range.done) {
      onRange({start: index, end: index, done: false});
      return;
    }
    const start = Math.min(range.start, index);
    const end = Math.max(range.start, index);
    for (let item = start; item <= end; item += 1) {
      if (busy.has(item)) return;
    }
    onRange({start, end, done: true});
  };

  const label = range
    ? `${String(8 + Math.floor(range.start / perHour)).padStart(2, '0')}:${String((range.start % perHour) * step).padStart(2, '0')}–${String(8 + Math.floor((range.end + 1) / perHour)).padStart(2, '0')}:${String(((range.end + 1) % perHour) * step).padStart(2, '0')}`
    : 'Интервал не выбран';

  return (
    <View style={styles.mobileSlotsWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.mobileSlotHours}>
            {Array.from({length: 13}, (_hourItem, hour) => (
              <Text key={hour} style={styles.mobileSlotHour}>{String(hour + 8).padStart(2, '0')}</Text>
            ))}
          </View>
          {Array.from({length: perHour}, (_rowItem, row) => (
            <View style={styles.mobileSlotRow} key={row}>
              {Array.from({length: 13}, (_cellItem, hour) => {
                const index = hour * perHour + row;
                const selected = range && index >= range.start && index <= range.end;
                return (
                  <Pressable
                    key={hour}
                    style={[
                      styles.mobileSlot,
                      busy.has(index) && styles.mobileSlotBusy,
                      selected && {backgroundColor: c.primary, borderColor: c.primary},
                    ]}
                    onPress={() => pick(index)}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      <Text style={styles.mobileSlotLabel}>{label} · серое уже занято</Text>
    </View>
  );
}

/* ── День ─────────────────────────────────────────────────────────────────── */

function DayView({date, load, events, styles, c, onOpenEvent, onCreate, onTaskDone, onTaskExtend, onFill}) {
  if (load?.onVacation) {
    return <Text style={styles.empty}>Отпуск. Задачи на этот день не ставятся.</Text>;
  }

  const current = date === today()
    ? events.find(event => event.taskPartId && event.status !== 'completed')
    : null;
  const rest = current ? events.filter(event => event.id !== current.id) : events;

  return (
    <View style={styles.body}>
      {current && (
        <View style={styles.nowCard}>
          <Text style={styles.nowLabel}>Сейчас</Text>
          <Text style={styles.nowTitle}>{current.title}</Text>
          <Text style={styles.nowMeta}>{estimateText(eventHours(current))} · рабочая задача</Text>
          <View style={styles.nowActions}>
            <Pressable style={styles.nowPrimary} onPress={() => onTaskDone(current)}>
              <Text style={styles.nowPrimaryText}>Завершить</Text>
            </Pressable>
            <Pressable style={styles.nowSecondary} onPress={() => onTaskExtend(current)}>
              <Text style={styles.nowSecondaryText}>Продлить</Text>
            </Pressable>
          </View>
        </View>
      )}
      <View style={styles.sectionRow}>
        <Text style={styles.section}>{current ? 'Дальше' : 'План дня'}</Text>
        <Pressable style={styles.addBtn} onPress={onCreate} hitSlop={8}>
          <Plus size={16} color={c.primary} />
          <Text style={[styles.addText, {color: c.primary}]}>Занять время</Text>
        </Pressable>
      </View>
      {!rest.length ? (
        <Text style={styles.empty}>
          На этот день ничего не запланировано.
          {load?.free ? `\nСвободно ${hoursText(load.free)}.` : ''}
        </Text>
      ) : (
        rest.map(event => (
          <Pressable
            key={event.id}
            style={styles.block}
            // Обезличенное событие открывать некуда: его содержимого нет и на
            // сервере — карточка показала бы пустой экран.
            onPress={() => !event.isOpaque && onOpenEvent(event)}>
            <View
              style={[
                styles.blockBar,
                {
                  backgroundColor: event.isOpaque
                    ? c.textTertiary
                    : event.taskPartId
                      ? c.primary
                      : c.secondary,
                },
              ]}
            />
            <View style={{flex: 1}}>
              <Text style={styles.blockTitle} numberOfLines={2}>
                {event.isOpaque ? 'Занято' : event.title}
              </Text>
              <Text style={styles.blockMeta}>
                {event.isOpaque
                  ? 'содержание скрыто'
                  : event.isFloating
                    ? 'рабочий блок — время в дне выбираете вы'
                    : new Date(event.startTime).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
              </Text>
            </View>
            <Text style={styles.blockHours}>{estimateText(eventHours(event))}</Text>
          </Pressable>
        ))
      )}
      {!!load?.free && (
        <Pressable style={styles.freeCard} onPress={onFill}>
          <Text style={styles.freeText}>Свободно · {hoursText(load.free)}</Text>
          <Text style={[styles.freeAction, {color: c.primary}]}>+ Запланировать</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ── Неделя ───────────────────────────────────────────────────────────────── */

function WeekView({cursor, byDate, styles, c, onPick}) {
  const week = weekOf(cursor);
  // Шкала общая на всю неделю: столбики сравниваются между собой, и своя
  // шкала у каждого дня превратила бы график в набор одинаковых палок.
  const max = Math.max(
    ...week.map(d => byDate.get(d)?.hours || 0),
    ...week.map(d => byDate.get(d)?.norm || 0),
    1,
  );

  return (
    <View style={styles.body}>
      <View style={styles.weekRow}>
        {week.map(date => {
          const day = byDate.get(date) || {};
          const height = day.onVacation ? 0 : Math.min((day.hours || 0) / max, 1) * 100;
          const normAt = day.norm ? (day.norm / max) * 100 : null;
          return (
            <Pressable key={date} style={styles.weekCell} onPress={() => onPick(date)}>
              <View style={styles.weekTrack}>
                {normAt !== null && (
                  <View style={[styles.weekNorm, {bottom: `${normAt}%`, borderColor: c.textSecondary}]} />
                )}
                <View
                  style={[
                    styles.weekFill,
                    {
                      height: `${height}%`,
                      backgroundColor: day.norm
                        ? loadColor(c, (day.hours || 0) / day.norm)
                        : c.textTertiary,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.weekLabel, date === cursor && {color: c.primary, fontFamily: font.semiBold}]}>
                {DOW[(fromKey(date).getDay() + 6) % 7]}
              </Text>
              <Text style={styles.weekHours}>
                {day.onVacation ? '—' : (day.hours || 0).toFixed(1).replace('.', ',')}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.hint}>
        Пунктир — ваша норма. Нажмите на столбик, чтобы открыть день целиком.
      </Text>
    </View>
  );
}

/* ── Месяц ────────────────────────────────────────────────────────────────── */

function MonthView({cursor, byDate, events, styles, c, onPick}) {
  const cells = monthGrid(cursor);
  // Дни, где вообще что-то есть. Одной загрузки мало: аккредитация и ТО
  // приходят из других разделов и часов не занимают — без точки такой день
  // выглядел бы в сетке пустым, а именно его и ищут глазами.
  const busyDays = new Set((events || []).map(e => String(e.startTime).slice(0, 10)));
  const workdays = cells.filter(d => d && !byDate.get(d)?.onDayOff);
  const overloaded = workdays.filter(d => byDate.get(d)?.color === 'r').length;
  const free = workdays.reduce((sum, d) => sum + (byDate.get(d)?.free || 0), 0);

  return (
    <View style={styles.body}>
      <View style={styles.monthHead}>
        {DOW.map(d => (
          <Text key={d} style={styles.monthHeadCell}>
            {d}
          </Text>
        ))}
      </View>

      <View style={styles.monthGrid}>
        {cells.map((date, i) => {
          if (!date) return <View key={`e${i}`} style={styles.monthCell} />;
          const day = byDate.get(date) || {};
          const isToday = date === today();
          return (
            <Pressable
              key={date}
              style={[
                styles.monthCell,
                day.onDayOff && styles.monthCellWeekend,
                isToday && {borderColor: c.primary, borderWidth: 1},
                date === cursor && {backgroundColor: c.primaryLight},
              ]}
              onPress={() => onPick(date)}>
              <Text style={styles.monthNum}>{fromKey(date).getDate()}</Text>
              {busyDays.has(date) && (
                <View style={[styles.monthDot, {backgroundColor: c.textTertiary}]} />
              )}
              <View style={styles.monthBarTrack}>
                {!day.onVacation && day.norm ? (
                  <View
                    style={[
                      styles.monthBarFill,
                      {
                        width: `${Math.min((day.hours || 0) / day.norm, 1) * 100}%`,
                        backgroundColor: loadColor(c, (day.hours || 0) / day.norm),
                      },
                    ]}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.summary}>
        <SummaryRow label="Дней с переработкой" value={String(overloaded)} styles={styles} />
        <SummaryRow label="Свободно за месяц" value={hoursText(free)} styles={styles} />
      </View>

      <Text style={styles.hint}>
        Месяц отвечает на вопрос «где завал и где окно». Состав дня — по нажатию
        на число.
      </Text>
    </View>
  );
}

function SummaryRow({label, value, styles}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const makeStyles = c =>
  StyleSheet.create({
    root: {flex: 1, backgroundColor: c.bgSecondary},
    scroll: {flex: 1},

    head: {
      backgroundColor: c.bgPrimary,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.borderLight,
    },
    headRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
    title: {fontFamily: font.semiBold, fontSize: 19, color: c.textPrimary},
    subtitle: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, marginTop: 2},

    iconBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.bgSecondary,
    },
    dot: {
      position: 'absolute',
      top: 4,
      right: 4,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      paddingHorizontal: 4,
      backgroundColor: c.error,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dotText: {fontFamily: font.semiBold, fontSize: 10, color: '#FFFFFF'},

    capsule: {marginTop: 14},
    capsuleText: {
      fontFamily: font.regular,
      fontSize: 12.5,
      color: c.textSecondary,
      marginTop: 6,
    },

    seg: {
      flexDirection: 'row',
      backgroundColor: c.bgSecondary,
      borderRadius: radius.md,
      padding: 3,
      marginTop: 14,
    },
    segBtn: {flex: 1, paddingVertical: 7, borderRadius: radius.sm, alignItems: 'center'},
    segBtnOn: {backgroundColor: c.bgPrimary},
    segText: {fontFamily: font.regular, fontSize: 13.5, color: c.textSecondary},
    segTextOn: {fontFamily: font.semiBold, color: c.textPrimary},

    nav: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 12},
    navBtn: {padding: 4},
    todayBtn: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: radius.md,
      backgroundColor: c.bgSecondary,
    },
    todayText: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary},
    moduleNav: {
      flexDirection: 'row',
      gap: 4,
      marginTop: 12,
      padding: 3,
      borderRadius: radius.md,
      backgroundColor: c.bgSecondary,
    },
    moduleNavBtn: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 6, borderRadius: radius.sm},
    moduleNavBtnOn: {backgroundColor: c.bgPrimary},
    moduleNavText: {fontFamily: font.regular, fontSize: 10.5, color: c.textSecondary},

    body: {padding: 16},
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    section: {
      fontFamily: font.semiBold,
      fontSize: 12,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: c.textTertiary,
      marginBottom: 10,
    },
    addBtn: {flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10},
    addText: {fontFamily: font.medium, fontSize: 13},
    empty: {
      fontFamily: font.regular,
      fontSize: 14,
      color: c.textSecondary,
      textAlign: 'center',
      lineHeight: 21,
      padding: 24,
    },

    block: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: c.bgPrimary,
      borderRadius: radius.lg,
      padding: 12,
      marginBottom: 8,
    },
    blockBar: {width: 3, alignSelf: 'stretch', borderRadius: 2},
    blockTitle: {fontFamily: font.medium, fontSize: 14.5, color: c.textPrimary},
    blockMeta: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 3},
    blockHours: {fontFamily: font.regular, fontSize: 12.5, color: c.textSecondary},
    freeCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 13,
      marginTop: 4,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: c.border,
      borderRadius: radius.lg,
    },
    freeText: {fontFamily: font.regular, fontSize: 13.5, color: c.textSecondary},
    freeAction: {fontFamily: font.medium, fontSize: 13},
    nowCard: {
      padding: 15,
      marginBottom: 18,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.primary,
      backgroundColor: c.primaryLight,
    },
    nowLabel: {fontFamily: font.semiBold, fontSize: 11, color: c.primary, textTransform: 'uppercase', letterSpacing: .6},
    nowTitle: {fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary, marginTop: 6},
    nowMeta: {fontFamily: font.regular, fontSize: 12.5, color: c.textSecondary, marginTop: 4},
    nowActions: {flexDirection: 'row', gap: 8, marginTop: 13},
    nowPrimary: {flex: 1, alignItems: 'center', padding: 10, borderRadius: radius.md, backgroundColor: c.primary},
    nowPrimaryText: {fontFamily: font.semiBold, fontSize: 13, color: '#FFFFFF'},
    nowSecondary: {flex: 1, alignItems: 'center', padding: 10, borderRadius: radius.md, backgroundColor: c.bgPrimary},
    nowSecondaryText: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary},

    weekRow: {flexDirection: 'row', gap: 6, height: 190},
    weekCell: {flex: 1, alignItems: 'center'},
    weekTrack: {
      flex: 1,
      width: '100%',
      backgroundColor: c.bgTertiary,
      borderRadius: radius.sm,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    weekFill: {width: '100%', borderRadius: radius.sm},
    weekNorm: {
      position: 'absolute',
      left: 0,
      right: 0,
      borderTopWidth: 1,
      borderStyle: 'dashed',
      zIndex: 1,
    },
    weekLabel: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 6},
    weekHours: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary},

    monthHead: {flexDirection: 'row'},
    monthHeadCell: {
      flex: 1,
      textAlign: 'center',
      fontFamily: font.regular,
      fontSize: 11,
      color: c.textTertiary,
      marginBottom: 6,
    },
    monthGrid: {flexDirection: 'row', flexWrap: 'wrap'},
    monthCell: {
      width: `${100 / 7}%`,
      aspectRatio: 0.95,
      padding: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
    },
    monthCellWeekend: {backgroundColor: c.bgTertiary},
    monthNum: {fontFamily: font.regular, fontSize: 13, color: c.textPrimary},
    monthDot: {width: 4, height: 4, borderRadius: 2, marginTop: 2},
    monthBarTrack: {
      width: '70%',
      height: 3,
      borderRadius: 2,
      backgroundColor: c.bgTertiary,
      marginTop: 4,
      overflow: 'hidden',
    },
    monthBarFill: {height: '100%', borderRadius: 2},

    summary: {
      backgroundColor: c.bgPrimary,
      borderRadius: radius.lg,
      padding: 14,
      marginTop: 18,
    },
    summaryRow: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6},
    summaryLabel: {fontFamily: font.regular, fontSize: 13.5, color: c.textSecondary},
    summaryValue: {fontFamily: font.semiBold, fontSize: 13.5, color: c.textPrimary},

    hint: {
      fontFamily: font.regular,
      fontSize: 12.5,
      color: c.textTertiary,
      lineHeight: 19,
      marginTop: 16,
      textAlign: 'center',
    },
    fab: {
      position: 'absolute',
      right: 18,
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: c.primary,
      shadowOpacity: 0.32,
      shadowRadius: 10,
      shadowOffset: {width: 0, height: 5},
      elevation: 7,
    },
    quickBody: {paddingHorizontal: 20, paddingBottom: 18},
    quickHint: {fontFamily: font.regular, fontSize: 12.5, color: c.textSecondary, lineHeight: 19},
    quickInput: {
      minHeight: 82,
      marginTop: 12,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: radius.md,
      backgroundColor: c.bgSecondary,
      color: c.textPrimary,
      fontFamily: font.regular,
      fontSize: 15,
      textAlignVertical: 'top',
    },
    quickPreview: {marginTop: 10, padding: 12, borderRadius: radius.md, backgroundColor: c.primaryLight},
    quickPreviewTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
    quickPreviewMeta: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 4},
    quickSubmit: {marginTop: 12, padding: 13, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center'},
    quickSubmitText: {fontFamily: font.semiBold, fontSize: 14, color: '#FFFFFF'},
    moreBody: {paddingHorizontal: 20, paddingBottom: 18},
    moreRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight},
    moreTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
    moreValue: {fontFamily: font.regular, fontSize: 12.5, color: c.textSecondary},
    moreSection: {flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18, marginBottom: 5},
    moreSectionText: {fontFamily: font.semiBold, fontSize: 12, color: c.textTertiary, textTransform: 'uppercase', letterSpacing: .5},
    moreTeam: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11},
    moreTeamMeta: {fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary, marginTop: 2},
    moreEmpty: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, paddingVertical: 14},
    moreHint: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary, lineHeight: 18, marginTop: 12},
    visibilityChoices: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 6},
    visibilityChoice: {paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.md, backgroundColor: c.bgSecondary},
    visibilityChoiceOn: {backgroundColor: c.primaryLight, borderWidth: StyleSheet.hairlineWidth, borderColor: c.primary},
    visibilityChoiceText: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary},
    teamLoadBody: {paddingHorizontal: 20, paddingBottom: 20},
    teamLoadSummary: {fontFamily: font.medium, fontSize: 13.5, color: c.textSecondary, marginBottom: 10},
    teamLoadRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight},
    teamLoadHours: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary},
    fillBody: {paddingHorizontal: 20, paddingBottom: 20},
    fillSteps: {flexDirection: 'row', gap: 7, marginTop: 12},
    fillInput: {marginTop: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderRadius: radius.md, backgroundColor: c.bgSecondary, color: c.textPrimary, fontFamily: font.regular, fontSize: 14},
    fillInbox: {alignItems: 'center', padding: 12, marginTop: 5},
    fillInboxText: {fontFamily: font.medium, fontSize: 13, color: c.primary},
    mobileSlotsWrap: {marginTop: 12, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderLight, borderRadius: radius.md},
    mobileSlotHours: {flexDirection: 'row'},
    mobileSlotHour: {width: 32, textAlign: 'center', fontFamily: font.regular, fontSize: 9, color: c.textTertiary},
    mobileSlotRow: {flexDirection: 'row', marginTop: 3},
    mobileSlot: {width: 29, height: 18, marginHorizontal: 1.5, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderRadius: 3, backgroundColor: c.bgPrimary},
    mobileSlotBusy: {backgroundColor: c.bgTertiary},
    mobileSlotLabel: {fontFamily: font.regular, fontSize: 11.5, color: c.textSecondary, marginTop: 8},
  });
