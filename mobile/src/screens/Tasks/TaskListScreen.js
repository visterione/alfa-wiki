/**
 * Мои задачи — плоский список с фильтрами.
 *
 * Формы постановки задачи здесь нет намеренно. Поставить задачу человеку — это
 * выбрать исполнителей, оценить часы, разложить на части и разобраться с
 * компромиссом, если не помещается. Это работа за столом; на телефоне такая
 * форма превращается в десять экранов подряд, после которых её всё равно
 * переделывают в вебе.
 */

import React, {useCallback, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';

import {tasks as tasksApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {
  STATUS_LABEL, STATUS_TONE, dshort, estimateText, hoursText, toneColor,
} from './taskMeta';

const FILTERS = [
  ['all', 'Все'],
  ['new', 'Не обработано'],
  ['work', 'В работе'],
  ['stuck', 'Анализируется'],
  ['done', 'Готово'],
];

export default function TaskListScreen({navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tabInset = useTabBarInset();

  const [filter, setFilter] = useState('all');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async ({silent} = {}) => {
      if (!silent) setLoading(true);
      try {
        const {data} = await tasksApi.getTasks(
          filter === 'all' ? {} : {status: filter},
        );
        setList(data || []);
      } catch (e) {
        console.warn('[Tasks] list error:', e?.message);
        setList([]);
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );

  useFocusEffect(
    useCallback(() => {
      load({silent: false});
    }, [load]),
  );

  if (loading) return <LogoLoader />;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{padding: 16, paddingBottom: tabInset + 24}}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load({silent: true});
            setRefreshing(false);
          }}
          tintColor={c.primary}
        />
      }>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        {FILTERS.map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.chip, filter === key && styles.chipOn]}
            onPress={() => setFilter(key)}>
            <Text style={[styles.chipText, filter === key && styles.chipTextOn]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {!list.length ? (
        <Text style={styles.empty}>В этом фильтре пусто.</Text>
      ) : (
        list.map(task => {
          const due = (task.parts || [])
            .map(p => String(p.dueDate))
            .sort()
            .pop();
          return (
            <Pressable
              key={task.id}
              style={styles.card}
              onPress={() => navigation.navigate('TaskCard', {id: task.id})}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {task.title}
                </Text>
                <View
                  style={[
                    styles.badge,
                    {backgroundColor: `${toneColor(c, STATUS_TONE[task.status])}22`},
                  ]}>
                  <Text
                    style={[styles.badgeText, {color: toneColor(c, STATUS_TONE[task.status])}]}>
                    {STATUS_LABEL[task.status]}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardMeta}>
                {task.project?.name || 'без проекта'}
                {' · '}
                {hoursText(task.totalEffortHours)}
                {due ? ` · ${dshort(due)}` : ''}
                {task.parts?.length > 1 ? ` · ${task.parts.length} части` : ''}
              </Text>
            </Pressable>
          );
        })
      )}

      <Text style={styles.hint}>
        Поставить новую задачу можно в веб-версии: там видно загрузку
        исполнителей по дням и разбор, если работа не помещается.
      </Text>
    </ScrollView>
  );
}

const makeStyles = c =>
  StyleSheet.create({
    root: {flex: 1, backgroundColor: c.bgSecondary},

    chips: {flexGrow: 0, marginBottom: 14},
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: c.bgPrimary,
      marginRight: 8,
    },
    chipOn: {backgroundColor: c.primary},
    chipText: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary},
    chipTextOn: {fontFamily: font.semiBold, color: '#FFFFFF'},

    card: {
      backgroundColor: c.bgPrimary,
      borderRadius: radius.lg,
      padding: 14,
      marginBottom: 8,
    },
    cardHead: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
    cardTitle: {flex: 1, fontFamily: font.medium, fontSize: 15, color: c.textPrimary},
    cardMeta: {fontFamily: font.regular, fontSize: 12.5, color: c.textSecondary, marginTop: 6},

    badge: {paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20},
    badgeText: {fontFamily: font.medium, fontSize: 11},

    empty: {
      fontFamily: font.regular,
      fontSize: 14,
      color: c.textSecondary,
      textAlign: 'center',
      padding: 24,
    },
    hint: {
      fontFamily: font.regular,
      fontSize: 12.5,
      color: c.textTertiary,
      lineHeight: 19,
      marginTop: 22,
    },
  });
