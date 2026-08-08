import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Animated,
  Easing,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {ChevronLeft, ChevronRight, Plus, MapPin, Repeat, Bell} from 'lucide-react-native';

import {calendar as calendarApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font, shadow} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {
  MONTHS,
  WEEKDAYS_SHORT,
  addMonths,
  dayKey,
  endOfDay,
  eventColor,
  eventOnDay,
  formatDayTitle,
  formatTime,
  monthGrid,
  sameDay,
  startOfDay,
  typeLabel,
} from './eventMeta';

/**
 * Календарь: сетка месяца сверху, события выбранного дня — списком снизу.
 *
 * Виды «неделя» и «повестка» из веба сюда намеренно не переносились: на узком
 * экране неделя вырождается в нечитаемые колонки, а повестка — это тот же
 * список дня, только длиннее.
 */
export default function CalendarScreen({navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Панель лежит поверх экрана: под ней и хвост списка, и кнопка «добавить»
  const tabInset = useTabBarInset();

  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const weeks = useMemo(() => monthGrid(month), [month]);

  /**
   * Смена месяца и дня — с проявлением, а не подменой кадра.
   *
   * Сетка уходит в сторону листания и возвращается, список дня просто
   * проявляется: без этого календарь листался как слайд-шоу, и было не
   * поймать, в какую сторону ты только что шагнул.
   */
  const gridFade = useRef(new Animated.Value(1)).current;
  const gridShift = useRef(new Animated.Value(0)).current;
  const listFade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    listFade.setValue(0.4);
    Animated.timing(listFade, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [selected, listFade]);

  const isCurrentMonth = useMemo(() => {
    const now = new Date();
    return month.getMonth() === now.getMonth() && month.getFullYear() === now.getFullYear();
  }, [month]);

  const load = useCallback(async (date, {silent} = {}) => {
    const grid = monthGrid(date);
    const from = startOfDay(grid[0][0]);
    const to = endOfDay(grid[5][6]);

    if (!silent) setLoading(true);
    try {
      const params = {start: from.toISOString(), end: to.toISOString()};
      // Интегрированные события (аккредитации, ТО) — необязательная часть:
      // доступ к ним зависит от прав на соответствующие разделы, и отказ
      // сервера не должен ронять весь календарь
      const [own, integrated] = await Promise.all([
        calendarApi.getEvents(params),
        calendarApi
          .getIntegratedEvents(params.start, params.end)
          .catch(() => ({data: []})),
      ]);
      setEvents([...(own.data || []), ...(integrated.data || [])]);
    } catch (e) {
      console.warn('[Calendar] load error:', e?.message);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Перезагрузка при возврате с экрана события: там могли править или удалить
  useFocusEffect(
    useCallback(() => {
      load(month, {silent: events.length > 0});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [month, load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load(month, {silent: true});
    setRefreshing(false);
  };

  /**
   * Цвета точек под числами.
   *
   * Событие раскладывается по всем дням, которые накрывает: встреча с ночёвкой
   * должна быть видна и во второй день, иначе календарь врёт.
   */
  const dotsByDay = useMemo(() => {
    const map = new Map();
    for (const event of events) {
      const from = startOfDay(event.startTime);
      const to = endOfDay(event.endTime || event.startTime);
      const cursor = new Date(from);
      // Ограничение на случай кривых дат с сервера: без него событие с концом
      // в 2099 году крутило бы цикл десятками тысяч итераций
      for (let i = 0; i < 400 && cursor <= to; i++) {
        const key = dayKey(cursor);
        const list = map.get(key) || [];
        if (list.length < 3) list.push(eventColor(event));
        map.set(key, list);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [events]);

  const dayEvents = useMemo(() => {
    return events
      .filter(e => eventOnDay(e, selected))
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  }, [events, selected]);

  const shiftMonth = delta => {
    const next = addMonths(month, delta);
    Animated.parallel([
      Animated.timing(gridFade, {toValue: 0, duration: 110, useNativeDriver: true}),
      Animated.timing(gridShift, {
        toValue: delta * -14,
        duration: 110,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setMonth(next);
      // Выделение переносим на первое число: иначе после листания подсвечен
      // день из другого месяца, а список под сеткой к нему не относится
      setSelected(new Date(next.getFullYear(), next.getMonth(), 1));
      gridShift.setValue(delta * 14);
      Animated.parallel([
        Animated.timing(gridFade, {toValue: 1, duration: 170, useNativeDriver: true}),
        Animated.spring(gridShift, {toValue: 0, useNativeDriver: true, bounciness: 0}),
      ]).start();
    });
  };

  const goToday = () => {
    const today = new Date();
    setMonth(today);
    setSelected(today);
  };

  const openEvent = event => {
    navigation.navigate('CalendarEvent', {event});
  };

  const createEvent = () => {
    // Новое событие открывается на выбранном дне: почти всегда именно на него
    // и смотрит человек, когда жмёт «плюс»
    navigation.navigate('CalendarEventEdit', {date: selected.toISOString()});
  };

  const renderEvent = ({item}) => {
    const color = eventColor(item);
    const remindersCount = Array.isArray(item.reminders) ? item.reminders.length : 0;
    return (
      <TouchableOpacity style={styles.eventRow} onPress={() => openEvent(item)} activeOpacity={0.7}>
        <View style={[styles.eventBar, {backgroundColor: color}]} />
        <View style={styles.eventBody}>
          <Text style={styles.eventTitle} numberOfLines={2}>{item.title}</Text>
          <View style={styles.eventMetaRow}>
            <Text style={styles.eventTime}>
              {item.allDay
                ? 'Весь день'
                : `${formatTime(item.startTime)}–${formatTime(item.endTime || item.startTime)}`}
            </Text>
            <Text style={styles.eventType}> · {typeLabel(item.eventType)}</Text>
          </View>
          {!!item.location && (
            <View style={styles.eventMetaRow}>
              <MapPin size={12} color={c.textTertiary} />
              <Text style={styles.eventPlace} numberOfLines={1}> {item.location}</Text>
            </View>
          )}
        </View>
        <View style={styles.eventFlags}>
          {(item.isRecurring || item.isInstance) && <Repeat size={13} color={c.textTertiary} />}
          {remindersCount > 0 && <Bell size={13} color={c.textTertiary} />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Переключатель месяца */}
      <View style={styles.monthBar}>
        <TouchableOpacity style={styles.monthNav} onPress={() => shiftMonth(-1)}>
          <ChevronLeft size={22} color={c.textSecondary} />
        </TouchableOpacity>
        <View style={styles.monthTitleWrap}>
          <Text style={styles.monthTitle}>
            {MONTHS[month.getMonth()]} {month.getFullYear()}
          </Text>
          {/* Кнопка возврата появляется, только когда ушли с текущего месяца:
              на нём самом она бы ничего не делала и только мозолила глаз */}
          {!isCurrentMonth && (
            <TouchableOpacity style={styles.todayBtn} onPress={goToday} activeOpacity={0.7}>
              <Text style={styles.todayBtnText}>Сегодня</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.monthNav} onPress={() => shiftMonth(1)}>
          <ChevronRight size={22} color={c.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Дни недели */}
      <View style={styles.weekHeader}>
        {WEEKDAYS_SHORT.map((d, i) => (
          <Text key={d} style={[styles.weekDay, i > 4 && styles.weekDayOff]}>{d}</Text>
        ))}
      </View>

      {/* Сетка месяца */}
      <Animated.View
        style={[styles.grid, {opacity: gridFade, transform: [{translateX: gridShift}]}]}>
        {weeks.map((week, wi) => (
          <View key={wi} style={styles.weekRow}>
            {week.map(day => {
              const outside = day.getMonth() !== month.getMonth();
              const isSelected = sameDay(day, selected);
              const isToday = sameDay(day, new Date());
              const dots = dotsByDay.get(dayKey(day)) || [];
              return (
                <TouchableOpacity
                  key={day.toISOString()}
                  style={styles.dayCell}
                  onPress={() => setSelected(day)}
                  activeOpacity={0.6}>
                  <View style={[styles.dayNumWrap, isSelected && styles.dayNumWrapSelected, !isSelected && isToday && styles.dayNumWrapToday]}>
                    <Text
                      style={[
                        styles.dayNum,
                        outside && styles.dayNumOutside,
                        isToday && !isSelected && styles.dayNumToday,
                        isSelected && styles.dayNumSelected,
                      ]}>
                      {day.getDate()}
                    </Text>
                  </View>
                  <View style={styles.dots}>
                    {dots.map((color, i) => (
                      <View key={i} style={[styles.dot, {backgroundColor: color}]} />
                    ))}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </Animated.View>

      {/* События выбранного дня */}
      <View style={styles.dayHeader}>
        <Text style={styles.dayTitle}>{formatDayTitle(selected)}</Text>
        <Text style={styles.dayCount}>
          {dayEvents.length ? `${dayEvents.length} соб.` : 'нет событий'}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <LogoLoader width={80} />
        </View>
      ) : (
        <Animated.FlatList
          style={{opacity: listFade}}
          data={dayEvents}
          keyExtractor={item => String(item.id)}
          renderItem={renderEvent}
          contentContainerStyle={[styles.listContent, {paddingBottom: tabInset + 88}]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>На этот день событий нет</Text>
            </View>
          }
        />
      )}

      <TouchableOpacity
        style={[styles.fab, {bottom: tabInset + 18}]}
        onPress={createEvent}
        activeOpacity={0.85}>
        <Plus size={26} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgSecondary},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},

  monthBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.bgPrimary, paddingHorizontal: 8, paddingVertical: 10,
  },
  monthNav: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center'},
  monthTitleWrap: {flex: 1, alignItems: 'center'},
  monthTitle: {fontSize: 17, fontFamily: font.semiBold, color: c.textPrimary},
  todayBtn: {
    marginTop: 2, paddingHorizontal: 10, paddingVertical: 2,
    borderRadius: radius.sm, backgroundColor: c.primaryLight,
  },
  todayBtnText: {fontSize: 11, fontFamily: font.medium, color: c.primary},

  weekHeader: {
    flexDirection: 'row', backgroundColor: c.bgPrimary,
    paddingBottom: 6, paddingHorizontal: 4,
  },
  weekDay: {
    flex: 1, textAlign: 'center',
    fontSize: 12, fontFamily: font.medium, color: c.textSecondary,
  },
  weekDayOff: {color: c.textTertiary},

  grid: {
    backgroundColor: c.bgPrimary, paddingHorizontal: 4, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: c.borderLight,
  },
  weekRow: {flexDirection: 'row'},
  dayCell: {flex: 1, alignItems: 'center', paddingVertical: 3},
  // Квадрат со скруглением, как в вебе (.mini-calendar-day — aspect-ratio: 1
  // и radius-sm), а не круг: сетка из квадратов читается как сетка
  dayNumWrap: {
    width: 32, height: 32, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  dayNumWrapSelected: {backgroundColor: c.primary},
  dayNumWrapToday: {borderWidth: 1.5, borderColor: c.primary},
  dayNum: {fontSize: 14, fontFamily: font.regular, color: c.textPrimary},
  dayNumOutside: {color: c.textTertiary},
  dayNumToday: {color: c.primary, fontFamily: font.semiBold},
  dayNumSelected: {color: '#FFFFFF', fontFamily: font.semiBold},
  // Ряд точек фиксированной высоты: без неё строки сетки прыгают в зависимости
  // от того, есть ли в дне события
  dots: {flexDirection: 'row', height: 6, alignItems: 'center', gap: 3},
  dot: {width: 5, height: 5, borderRadius: 2.5},

  dayHeader: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6,
  },
  dayTitle: {fontSize: 15, fontFamily: font.semiBold, color: c.textPrimary},
  dayCount: {fontSize: 12, fontFamily: font.regular, color: c.textTertiary},

  listContent: {paddingHorizontal: 12, paddingBottom: 88},
  eventRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.bgPrimary, borderRadius: radius.lg,
    paddingRight: 12, marginBottom: 8, overflow: 'hidden',
    ...shadow.sm,
  },
  // Цветная полоса слева — тот же признак типа события, что и точка в сетке
  eventBar: {width: 4, alignSelf: 'stretch', minHeight: 52},
  eventBody: {flex: 1, paddingVertical: 10, paddingLeft: 12},
  eventTitle: {fontSize: 15, fontFamily: font.medium, color: c.textPrimary},
  eventMetaRow: {flexDirection: 'row', alignItems: 'center', marginTop: 2},
  eventTime: {fontSize: 12.5, fontFamily: font.regular, color: c.textSecondary},
  eventType: {fontSize: 12.5, fontFamily: font.regular, color: c.textTertiary},
  eventPlace: {fontSize: 12, fontFamily: font.regular, color: c.textTertiary, flex: 1},
  eventFlags: {flexDirection: 'row', alignItems: 'center', gap: 6},

  empty: {alignItems: 'center', paddingVertical: 32},
  emptyText: {fontSize: 14, fontFamily: font.regular, color: c.textTertiary},

  fab: {
    position: 'absolute', right: 18, bottom: 18,
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.primary,
    ...shadow.md,
  },
});
