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

import React, {useCallback, useMemo, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {ChevronLeft, ChevronRight, Bell, ListTodo, Plus} from 'lucide-react-native';

import {tasks as tasksApi, calendar as calendarApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {useAuth} from '../../store/authStore';
import {setInboxCount, useInboxCount} from '../../store/tasksStore';
import LoadBar from './LoadBar';
import {
  DOW, addDays, addMonths, dayEvents, dfull, dshort, dstr, estimateText,
  eventHours, fromKey, hoursText, isWeekend, monthGrid, monthTitle, today,
  toKey, weekOf, LOAD_COLOR,
} from './taskMeta';

export default function TasksScreen({navigation}) {
  const c = useTheme();
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

  return (
    <ScrollView
      style={styles.root}
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
                : dayLoad?.norm
                  ? `${hoursText(dayLoad.hours)} из ${hoursText(dayLoad.norm)}`
                  : 'Норма рабочего дня не задана'}
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
      </View>

      {view === 'day' && (
        <DayView
          date={cursor}
          load={dayLoad}
          events={dayEvents(events, cursor)}
          styles={styles}
          c={c}
          onOpenEvent={id => navigation.navigate('CalendarEvent', {id})}
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
  );
}

/* ── День ─────────────────────────────────────────────────────────────────── */

function DayView({date, load, events, styles, c, onOpenEvent, onCreate}) {
  if (load?.onVacation) {
    return <Text style={styles.empty}>Отпуск. Задачи на этот день не ставятся.</Text>;
  }

  return (
    <View style={styles.body}>
      <View style={styles.sectionRow}>
        <Text style={styles.section}>План дня</Text>
        <Pressable style={styles.addBtn} onPress={onCreate} hitSlop={8}>
          <Plus size={16} color={c.primary} />
          <Text style={[styles.addText, {color: c.primary}]}>Занять время</Text>
        </Pressable>
      </View>
      {!events.length ? (
        <Text style={styles.empty}>
          На этот день ничего не запланировано.
          {load?.free ? `\nСвободно ${hoursText(load.free)}.` : ''}
        </Text>
      ) : (
        events.map(event => (
          <Pressable
            key={event.id}
            style={styles.block}
            // Обезличенное событие открывать некуда: его содержимого нет и на
            // сервере — карточка показала бы пустой экран.
            onPress={() => !event.isOpaque && onOpenEvent(event.id)}>
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
                      backgroundColor: c[LOAD_COLOR[day.color] || 'success'],
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

      <View style={styles.legend}>
        <Legend color={c.success} text="запас" styles={styles} />
        <Legend color={c.warning} text="плотно" styles={styles} />
        <Legend color={c.error} text="переработка" styles={styles} />
        <Text style={styles.legendText}>пунктир — ваша норма</Text>
      </View>

      <Text style={styles.hint}>
        Нажмите на столбик, чтобы открыть день целиком.
      </Text>
    </View>
  );
}

function Legend({color, text, styles}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, {backgroundColor: color}]} />
      <Text style={styles.legendText}>{text}</Text>
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
  const workdays = cells.filter(d => d && !isWeekend(d));
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
                isWeekend(date) && styles.monthCellWeekend,
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
                        backgroundColor: c[LOAD_COLOR[day.color] || 'success'],
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

    legend: {flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16, justifyContent: 'center'},
    legendItem: {flexDirection: 'row', alignItems: 'center', gap: 5},
    legendDot: {width: 9, height: 9, borderRadius: 2},
    legendText: {fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary},

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
  });
