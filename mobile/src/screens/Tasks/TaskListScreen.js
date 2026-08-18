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
import {Clock} from 'lucide-react-native';
import Avatar from '../../components/Avatar';
import {STATUS_ICON, STATUS_COLOR, clockText, dnum} from './taskMeta';

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
          const users = (task.parts || [])
            .flatMap(part => (part.assignees || []).map(a => a.user))
            .filter((user, i, arr) => user && arr.findIndex(x => x?.id === user.id) === i);
          const StatusIcon = STATUS_ICON[task.status];
          return (
            <Pressable
              key={task.id}
              style={styles.card}
              onPress={() => navigation.navigate('TaskCard', {id: task.id})}>
              <View style={styles.cardHead}>
                <View style={{flex: 1}}>
                  {/* Код и проект над названием — как в таблице веба. */}
                  <View style={styles.cardTop}>
                    {!!task.code && <Text style={styles.cardCode}>{task.code}</Text>}
                    {!!task.project?.name && (
                      <Text style={styles.cardProject} numberOfLines={1}>{task.project.name}</Text>
                    )}
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={2}>{task.title}</Text>
                </View>
                {/* Статус иконкой, подпись не нужна: цвет и форма те же, что в
                    вебе, и повторять их словом на узком экране расточительно. */}
                {StatusIcon && (
                  <StatusIcon size={19} strokeWidth={1.8} color={STATUS_COLOR[task.status]} />
                )}
              </View>

              <View style={styles.cardFoot}>
                <View style={styles.avatars}>
                  {users.slice(0, 3).map((user, index) => (
                    <View key={user.id} style={index ? styles.avatarNext : null}>
                      <Avatar uri={user.avatar} size={22} />
                    </View>
                  ))}
                  {users.length > 3 && (
                    <Text style={styles.avatarMore}>+{users.length - 3}</Text>
                  )}
                </View>
                <View style={styles.cardMetaRow}>
                  <Clock size={13} color={c.textTertiary} />
                  <Text style={styles.cardMeta}>{clockText(task.totalEffortHours)}</Text>
                  {!!due && <Text style={styles.cardMeta}>· {dnum(due)}</Text>}
                </View>
              </View>
            </Pressable>
          );
        })
      )}

    </ScrollView>
  );
}

const makeStyles = c =>
  StyleSheet.create({
    root: {flex: 1, backgroundColor: c.bgSecondary},

    cardTop: {flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 3},
    cardCode: {fontFamily: font.semiBold, fontSize: 10.5, letterSpacing: 0.2, color: c.textTertiary},
    cardProject: {flex: 1, fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary},
    cardFoot: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      gap: 10, marginTop: 10,
    },
    // Аватарки внахлёст, как в вебе: на узкой карточке они занимают меньше
    // места и сразу читаются как один список исполнителей.
    avatars: {flexDirection: 'row', alignItems: 'center'},
    avatarNext: {marginLeft: -7},
    avatarMore: {fontFamily: font.medium, fontSize: 11.5, color: c.textTertiary, marginLeft: 6},
    cardMetaRow: {flexDirection: 'row', alignItems: 'center', gap: 5},

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


    empty: {
      fontFamily: font.regular,
      fontSize: 14,
      color: c.textSecondary,
      textAlign: 'center',
      padding: 24,
    },
  });
