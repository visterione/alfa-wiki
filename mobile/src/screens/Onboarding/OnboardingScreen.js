/**
 * Онбординг врача на телефоне (ver. 7.55). Сам модуль — ver. 7.30.
 *
 * ── Что здесь есть и чего нет ───────────────────────────────────────────────
 *
 * В мобилке живёт только то, что делают между делом: посмотреть, что висит на
 * тебе, открыть заявку, закрыть свой шаг, согласовать анкету. Настройка шагов
 * (кто за что отвечает по филиалам) и выгрузки PDF остались в вебе — первое
 * раскладывают один раз и вдумчиво, второе печатают и по бумаге вносят позиции
 * в «Реновацию».
 *
 * ── Почему «Мои задачи» — первый экран ──────────────────────────────────────
 *
 * В вебе слева стоит меню из пяти разделов, и «Мои задачи» — лишь один из них.
 * На телефоне такого меню нет, а вопрос, с которым сюда заходят, ровно один:
 * пришло уведомление — что от меня хотят. Заявки и архив нужны реже и стоят
 * переключателем сверху, а не отдельными экранами: между ними ходят подряд,
 * сравнивая, и каждый раз возвращаться назад было бы дороже.
 */
import React, {useCallback, useState} from 'react';
import {View, Text, FlatList, Pressable, StyleSheet, RefreshControl} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';

import {onboarding as onboardingApi} from '../../services/api';
import SocketService from '../../services/socket';
import LogoLoader from '../../components/LogoLoader';
import {setOnboardingBadge} from '../../store/onboardingStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {professionsText, dueText, statusColor} from './onboardingMeta';

const SEGMENTS = [
  {key: 'tasks', label: 'Мои задачи'},
  {key: 'apps', label: 'Заявки'},
  {key: 'archive', label: 'Архив'},
];

export default function OnboardingScreen({navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tabInset = useTabBarInset();

  const [segment, setSegment] = useState('tasks');
  const [data, setData] = useState({tasks: null, apps: null, archive: null});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => Promise.all([
    onboardingApi.myTasks().then(r => r.data || []).catch(() => []),
    onboardingApi.applications({archived: 'false'}).then(r => r.data || []).catch(() => []),
    onboardingApi.applications({archived: 'true'}).then(r => r.data || []).catch(() => []),
  ])
    .then(([tasks, apps, archive]) => {
      setData({tasks, apps, archive});
      // Счётчик в колесе берём отсюда: список уже запрошен, отдельный запрос за
      // тем же числом был бы вторым источником правды
      setOnboardingBadge(tasks.length);
    })
    .finally(() => setRefreshing(false)), []);

  /**
   * Перечитываем при каждом возвращении на экран — задачу мог закрыть коллега,
   * пока была открыта карточка, — и по беззвучному сигналу с сервера, если
   * состав задач поменялся прямо сейчас: общую задачу забирает тот, кто успел,
   * и висеть в списке у остальных она не должна.
   */
  useFocusEffect(useCallback(() => {
    load();
    SocketService.on('onboarding:list', 'onboarding:changed', load);
    return () => SocketService.off('onboarding:list');
  }, [load]));

  const items = data[segment];
  const openApp = (id, title) =>
    navigation.navigate('OnboardingApplication', {applicationId: id, title});

  return (
    <View style={styles.root}>
      {/* Переключатель — над списком и вне его: он должен оставаться на месте
          при прокрутке, иначе на длинном архиве до него не добраться */}
      <View style={styles.segments}>
        {SEGMENTS.map(seg => {
          const on = seg.key === segment;
          const count = seg.key === 'tasks' ? data.tasks?.length || 0 : 0;
          return (
            <Pressable
              key={seg.key}
              style={[styles.segment, on && styles.segmentOn]}
              onPress={() => setSegment(seg.key)}
              accessibilityRole="tab"
              accessibilityState={{selected: on}}>
              <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
                {seg.label}
              </Text>
              {count > 0 && (
                <View style={[styles.segmentCount, on && styles.segmentCountOn]}>
                  <Text style={[styles.segmentCountText, on && styles.segmentCountTextOn]}>{count}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {!items ? (
        <LogoLoader />
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={[styles.list, {paddingBottom: tabInset + 24}]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={c.textTertiary}
            />
          }
          ListEmptyComponent={
            <Text style={styles.none}>
              {segment === 'tasks' ? 'Задач нет'
                : segment === 'apps' ? 'Активных заявок нет'
                : 'Архив пуст'}
            </Text>
          }
          renderItem={({item}) => segment === 'tasks'
            ? <TaskCard task={item} onPress={() => openApp(item.applicationId, item.fullName)} />
            : <AppCard app={item} onPress={() => openApp(item.id, item.fullName)} />}
        />
      )}
    </View>
  );
}

/**
 * Задача: что сделать и по кому. Имя врача — подписью, а не заголовком:
 * в списке своих задач человек ищет действие, а не фамилию.
 */
function TaskCard({task, onPress}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable style={[styles.card, task.overdue && styles.cardLate]} onPress={onPress}>
      <Text style={styles.cardTitle} numberOfLines={2}>{task.title}</Text>
      <Text style={styles.cardSub} numberOfLines={1}>
        {task.fullName || 'без имени'} · {professionsText(task.professions)}
      </Text>

      <View style={styles.cardFoot}>
        {/* «Общая» — задача на нескольких исполнителей: пока её не взяли, она
            висит у всех, и по одному только сроку не понять, ждут ли её от
            тебя лично */}
        {task.requiresClaim && !task.claimedBy && (
          <View style={styles.sharedChip}>
            <Text style={styles.sharedChipText}>Общая · нужно взять</Text>
          </View>
        )}
        <Text style={[styles.cardWhen, task.overdue && styles.cardWhenLate]} numberOfLines={1}>
          {dueText(task)}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Заявка: врач, филиал, стадия и готовность точками.
 *
 * Точки — тот же чек-лист, что в вебе: он отвечает «сколько ещё», а стадия —
 * «где сейчас». Числом «3 из 7» это читается хуже: точки видно, не читая.
 */
function AppCard({app, onPress}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tone = statusColor(app.status, c);
  const done = app.checklist.filter(i => i.done).length;

  return (
    <Pressable style={[styles.card, app.overdue && styles.cardLate]} onPress={onPress}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={1}>{app.fullName || 'без имени'}</Text>
        <View style={[styles.stageChip, {backgroundColor: `${tone}22`}]}>
          <Text style={[styles.stageChipText, {color: tone}]} numberOfLines={1}>{app.stage.label}</Text>
        </View>
      </View>

      <Text style={styles.cardSub} numberOfLines={1}>
        {professionsText(app.professions)}
        {app.medCenter?.name ? ` · ${app.medCenter.name}` : ''}
      </Text>

      <View style={styles.cardFoot}>
        <View style={styles.dots}>
          {app.checklist.map(item => (
            <View key={item.key} style={[styles.dot, item.done && styles.dotDone]} />
          ))}
        </View>
        <Text style={styles.cardWhen}>{done} из {app.checklist.length}</Text>
      </View>
    </Pressable>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},

  segments: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
  },
  segment: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 6,
    borderRadius: radius.md, backgroundColor: c.bgTertiary,
  },
  segmentOn: {backgroundColor: c.primary},
  segmentText: {fontFamily: font.medium, fontSize: 13, color: c.textSecondary},
  segmentTextOn: {color: '#FFFFFF'},
  segmentCount: {
    minWidth: 18, paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 9, backgroundColor: c.primary, alignItems: 'center',
  },
  segmentCountOn: {backgroundColor: 'rgba(255,255,255,0.3)'},
  segmentCountText: {fontFamily: font.semiBold, fontSize: 11, color: '#FFFFFF'},
  segmentCountTextOn: {color: '#FFFFFF'},

  list: {padding: 16, paddingTop: 12},
  card: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    padding: 14, marginBottom: 8, gap: 6,
  },
  // Просрочку помечаем полосой слева, а не красным фоном: фон кричит на весь
  // список, а разбирать всё равно нужно по очереди
  cardLate: {borderLeftWidth: 3, borderLeftColor: c.error, paddingLeft: 11},
  cardHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
  cardTitle: {flex: 1, fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  cardSub: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary},
  cardFoot: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2},
  cardWhen: {flex: 1, textAlign: 'right', fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary},
  cardWhenLate: {color: c.error, fontFamily: font.medium},

  stageChip: {paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, maxWidth: '52%'},
  stageChipText: {fontFamily: font.semiBold, fontSize: 11},

  sharedChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
    backgroundColor: `${c.warning}22`,
  },
  sharedChipText: {fontFamily: font.medium, fontSize: 11, color: c.warning},

  dots: {flexDirection: 'row', gap: 4, alignItems: 'center'},
  dot: {width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.bgTertiary},
  dotDone: {backgroundColor: c.success},

  none: {
    fontFamily: font.regular, fontSize: 13, color: c.textTertiary,
    textAlign: 'center', marginTop: 40,
  },
});
