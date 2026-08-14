/**
 * Карточка задачи.
 *
 * Отличается от списка одним разделом — историей. Срок здесь не поле, а
 * результат переговоров: кто предложил, кто перенёс, какое объяснение приложил
 * автор, продавивший задачу в переполненный день. Без этой ленты «срок
 * сдвинулся» выглядит как факт природы.
 *
 * Действия над своей частью урезаны до тех, что делают на ходу: взять в план,
 * отметить сделанным, разбить застрявшую. Перенос на произвольный день и
 * согласование чужого срока остались в вебе — там виден календарь целиком.
 */

import React, {useCallback, useState} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet, Alert} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';

import {tasks as tasksApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {useAuth} from '../../store/authStore';
import {
  MODE_LABEL, STATUS_LABEL, STATUS_TONE, dfull, dshort, estimateText,
  hoursText, toneColor, userName,
} from './taskMeta';

/** Человеческие формулировки событий истории — те же, что в вебе. */
function historyText(row) {
  const p = row.payload || {};
  switch (row.action) {
    case 'created':
      return p.parts > 1
        ? `создал задачу из ${p.parts} частей на ${p.people} чел.`
        : 'создал задачу';
    case 'planned':
      return p.overload
        ? `взял в план на ${dshort(p.date)} сверх нормы — стало ${hoursText(p.after)} из ${hoursText(p.norm)}`
        : `поставил в план на ${dshort(p.date)}`;
    case 'proposed_date':
      return `предложил срок ${dshort(p.to)}`;
    case 'accepted_date':
      return `согласовал срок ${dshort(p.date)}`;
    case 'declined':
      return 'вернул задачу автору с пометкой «не моя зона»';
    case 'moved':
      return p.becameStuck
        ? `перенёс на ${dshort(p.to)} — третий перенос, задача требует решения`
        : `перенёс на ${dshort(p.to)}`;
    case 'split':
      return `разбил часть: ${hoursText(p.head)} + ${hoursText(p.tail)}`;
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

  if (!task) return <LogoLoader />;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{padding: 16, paddingBottom: tabInset + 24}}>
      <Text style={styles.title}>{task.title}</Text>

      <View style={styles.badges}>
        {task.project && (
          <Badge text={task.project.name} color={c.primary} styles={styles} />
        )}
        <Badge text={MODE_LABEL[task.mode]} color={c.textSecondary} styles={styles} />
        <Badge text={hoursText(task.totalEffortHours)} color={c.textSecondary} styles={styles} />
        <Badge
          text={STATUS_LABEL[task.status]}
          color={toneColor(c, STATUS_TONE[task.status])}
          styles={styles}
        />
      </View>

      <Text style={styles.author}>Автор: {userName(task.author)}</Text>

      {!!task.description && (
        <>
          <Text style={styles.section}>Описание</Text>
          <Text style={styles.description}>{task.description}</Text>
        </>
      )}

      <Text style={styles.section}>Части · {task.parts?.length || 0}</Text>
      {(task.parts || []).map(part => {
        const mine = (part.assignees || []).find(a => a.userId === user?.id);
        const notPlanned = (part.assignees || []).filter(a => !a.plannedDate);

        return (
          <View key={part.id} style={styles.part}>
            <View style={styles.partHead}>
              <Text style={styles.partTitle}>{part.title}</Text>
              <Badge
                text={STATUS_LABEL[part.status]}
                color={toneColor(c, STATUS_TONE[part.status])}
                styles={styles}
              />
            </View>

            <Text style={styles.partMeta}>
              {(part.assignees || []).map(a => userName(a.user)).join(', ')}
              {' · '}
              {estimateText(part.estimateHours)}
              {' · '}
              {dshort(String(part.dueDate))}
              {part.moveCount > 0 ? ` · переносов: ${part.moveCount}` : ''}
            </Text>

            {!!notPlanned.length && (
              <Text style={[styles.partNote, {color: c.warning}]}>
                Не обработали: {notPlanned.map(a => userName(a.user)).join(', ')}
              </Text>
            )}

            {/* Застрявшая часть: кнопки «перенести ещё раз» здесь нет
                специально — после третьего переноса нужен выбор, а не перенос. */}
            {part.status === 'stuck' && (
              <View style={styles.stuck}>
                <Text style={[styles.stuckTitle, {color: c.error}]}>Требует решения</Text>
                <Text style={styles.stuckText}>
                  Часть переносится третий раз подряд. Обычно это значит, что она
                  слишком крупная или на самом деле не нужна.
                </Text>
                <Pressable
                  style={[styles.btn, busy && styles.btnOff]}
                  disabled={busy}
                  onPress={() =>
                    run(
                      () => tasksApi.splitPart(part.id, {}),
                      'Разбито надвое — теперь части мельче и помещаются в день.',
                    )
                  }>
                  <Text style={styles.btnText}>Разбить на части</Text>
                </Pressable>
              </View>
            )}

            {mine && part.status !== 'stuck' && (
              <View style={styles.acts}>
                {!mine.plannedDate ? (
                  <Pressable
                    style={[styles.btn, styles.btnPrimary, busy && styles.btnOff]}
                    disabled={busy}
                    onPress={() =>
                      run(
                        () => tasksApi.planPart(part.id, String(part.dueDate)),
                        `В плане на ${dfull(String(part.dueDate))}.`,
                      )
                    }>
                    <Text style={styles.btnPrimaryText}>Взять в план</Text>
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
                  </>
                )}
              </View>
            )}
          </View>
        );
      })}

      <Text style={styles.section}>История</Text>
      {!task.history?.length ? (
        <Text style={styles.historyEmpty}>
          Срок назначен односторонне и не пересматривался.
        </Text>
      ) : (
        task.history.map(row => (
          <View key={row.id} style={styles.historyRow}>
            <Text style={styles.historyWho}>{userName(row.user)}</Text>
            <Text style={styles.historyWhat}>{historyText(row)}</Text>
            <Text style={styles.historyWhen}>
              {new Date(row.createdAt).toLocaleString('ru-RU', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        ))
      )}

      <Text style={styles.hint}>
        Срок — согласование, а не поле. Поэтому у него есть история.
      </Text>
    </ScrollView>
  );
}

function Badge({text, color, styles}) {
  return (
    <View style={[styles.badge, {backgroundColor: `${color}22`}]}>
      <Text style={[styles.badgeText, {color}]}>{text}</Text>
    </View>
  );
}

const makeStyles = c =>
  StyleSheet.create({
    root: {flex: 1, backgroundColor: c.bgSecondary},

    title: {fontFamily: font.semiBold, fontSize: 20, color: c.textPrimary, lineHeight: 27},
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

    historyRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      gap: 6,
      paddingVertical: 6,
    },
    historyWho: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary},
    historyWhat: {flex: 1, fontFamily: font.regular, fontSize: 13, color: c.textSecondary},
    historyWhen: {fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary},
    historyEmpty: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary},

    hint: {
      fontFamily: font.regular,
      fontSize: 12.5,
      color: c.textTertiary,
      lineHeight: 19,
      marginTop: 22,
    },
  });
