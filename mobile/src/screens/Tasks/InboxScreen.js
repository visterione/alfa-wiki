/**
 * Входящие задачи.
 *
 * Экран, ради которого модуль вообще нужен в телефоне. Всё остальное можно
 * посмотреть за столом, а вот разобрать поставленную задачу — «беру на четверг»
 * или «не помещается, предлагаю пятницу» — делают на ходу, между приёмами.
 *
 * Пока задача не поставлена в план, она не занимает у человека ни часа, и автор
 * видит, что до неё ещё никто не дошёл. Поэтому кнопок здесь три, а не одна:
 * «в план», «предложить другой срок» и «не моё» — и ни одна из них не является
 * молчаливым согласием.
 */

import React, {useCallback, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';

import {tasks as tasksApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {setInboxCount} from '../../store/tasksStore';
import {Clock} from 'lucide-react-native';
import {addDays, clockText, dfull, dnum, hoursText, shortName} from './taskMeta';

export default function InboxScreen({navigation, route}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tabInset = useTabBarInset();

  const [data, setData] = useState({mine: [], blocked: [], waiting: []});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null);
  const planDate = route.params?.planDate;
  const freeHours = Number(route.params?.freeHours || 0);

  const load = useCallback(async ({silent} = {}) => {
    if (!silent) setLoading(true);
    try {
      const {data: res} = await tasksApi.getInbox();
      setData(res);
      setInboxCount((res.mine || []).length);
    } catch (e) {
      console.warn('[Tasks] inbox error:', e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load({silent: false});
    }, [load]),
  );

  const run = async (partId, fn, message) => {
    setBusy(partId);
    try {
      await fn();
      Alert.alert('Готово', message);
      await load({silent: true});
    } catch (e) {
      Alert.alert('Не получилось', e?.response?.data?.error || 'Попробуйте ещё раз');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Предложить другой срок.
   *
   * Ближайшее окно ищет сервер: у него все дни и все нормы. «Нет окна» — это
   * валидный ответ, и показать его надо честно, а не подобрать день молча.
   */
  const propose = async part => {
    setBusy(part.id);
    try {
      const {data: fit} = await tasksApi.getNextFit(part.id, {
        start: addDays(String(part.dueDate), 1),
      });
      if (!fit.date) {
        Alert.alert(
          'Нет свободного дня',
          'До конца горизонта нет дня, куда это помещается. Придётся двигать другое или признать переработку.',
        );
        return;
      }
      await tasksApi.proposeDate(part.id, fit.date);
      Alert.alert(
        'Срок предложен',
        `Автор увидит ${dnum(fit.date)} и вашу занятость — без названий ваших дел`,
      );
      await load({silent: true});
    } catch (e) {
      Alert.alert('Не получилось', e?.response?.data?.error || 'Попробуйте ещё раз');
    } finally {
      setBusy(null);
    }
  };

  const decline = part => {
    Alert.alert(
      'Вернуть автору?',
      'Задача уйдёт обратно с пометкой «не моя зона».',
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Вернуть',
          style: 'destructive',
          onPress: () =>
            run(part.id, () => tasksApi.declinePart(part.id), 'Возвращено автору'),
        },
      ],
    );
  };

  if (loading) return <LogoLoader />;

  const visibleMine = planDate
    ? data.mine.filter(part => Number(part.estimateHours) <= freeHours)
    : data.mine;

  return (
    <ScrollView
      style={styles.root}
      // flexGrow, чтобы короткий список не жался к верхней трети экрана:
      // содержимое занимает всю высоту, а разделы расходятся по ней.
      contentContainerStyle={{padding: 16, paddingBottom: tabInset + 24, flexGrow: 1}}
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
      <Text style={styles.section}>
        {planDate ? `Помещается в свободное окно — ${visibleMine.length}` : `Требует решения — ${data.mine.length}`}
      </Text>

      {!visibleMine.length ? (
        <Text style={styles.empty}>
          {planDate
            ? 'Во входящих нет задачи подходящей длительности.'
            : `Входящие разобраны.\nНи одна задача не ждёт вашего решения.`}
        </Text>
      ) : (
        visibleMine.map(part => {
          const a = part.assessment || {};
          const date = String(planDate || part.dueDate);
          const disabled = busy === part.id;

          return (
            <View key={part.id} style={styles.card}>
              {!!part.task?.code && (
                <Text style={styles.cardCode}>{part.task.code}</Text>
              )}
              <Text style={styles.cardTitle}>{part.title}</Text>
              <View style={styles.cardMeta}>
                <Text style={styles.cardFrom}>
                  от {shortName(part.task?.author)}
                  {part.task?.project ? ` — ${part.task.project.name}` : ''}
                </Text>
                <View style={styles.cardMetaRight}>
                  <Clock size={13} color={c.textTertiary} />
                  <Text style={styles.cardFrom}>{clockText(part.estimateHours)}</Text>
                  <Text style={styles.cardFrom}>· {dnum(date)}</Text>
                </View>
              </View>

              <View style={[styles.fit, (planDate || a.fits) ? styles.fitOk : styles.fitBad]}>
                <Text style={[styles.fitText, {color: (planDate || a.fits) ? c.success : c.error}]}>
                  {planDate
                    ? `Свободное окно ${dnum(date)} — ${hoursText(freeHours)}`
                    : <>
                      {a.reason === 'vacation' && 'В этот день у вас отпуск.'}
                      {a.reason === 'no_norm' &&
                        'Вам не задана норма рабочего дня — посчитать загрузку нельзя.'}
                      {a.reason === 'ok' &&
                        `${dnum(date)}: станет ${hoursText(a.after)} из ${hoursText(a.norm)} — помещается`}
                      {a.reason === 'overload' &&
                        `${dnum(date)}: станет ${hoursText(a.after)} из ${hoursText(a.norm)} — переработка ${hoursText(a.over)}`}
                    </>}
                </Text>
              </View>

              <View style={styles.acts}>
                {planDate || a.fits ? (
                  <Pressable
                    style={[styles.btn, styles.btnPrimary, disabled && styles.btnOff]}
                    disabled={disabled}
                    onPress={() =>
                      run(
                        part.id,
                        () => tasksApi.planPart(part.id, date),
                        `В плане на ${dfull(date)}. Автору ушло уведомление.`,
                      )
                    }>
                    <Text style={styles.btnPrimaryText}>В план на {dnum(date)}</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[styles.btn, styles.btnPrimary, disabled && styles.btnOff]}
                    disabled={disabled}
                    onPress={() => propose(part)}>
                    <Text style={styles.btnPrimaryText}>Предложить срок</Text>
                  </Pressable>
                )}

                {!planDate && (
                  <Pressable
                    style={[styles.btn, disabled && styles.btnOff]}
                    disabled={disabled}
                    onPress={() =>
                      a.fits
                        ? propose(part)
                        : run(
                            part.id,
                            () => tasksApi.planPart(part.id, date, true),
                            'Взято сверх нормы — автор увидит, что вы в переработке.',
                          )
                    }>
                    <Text style={styles.btnText}>
                      {a.fits ? 'Другой день' : 'Всё равно взять'}
                    </Text>
                  </Pressable>
                )}

                <Pressable
                  style={[styles.btn, disabled && styles.btnOff]}
                  disabled={disabled}
                  onPress={() => navigation.navigate('TaskCard', {id: part.taskId})}>
                  <Text style={styles.btnText}>Открыть</Text>
                </Pressable>

                <Pressable
                  style={[styles.btn, disabled && styles.btnOff]}
                  disabled={disabled}
                  onPress={() => decline(part)}>
                  <Text style={[styles.btnText, {color: c.error}]}>Не моё</Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}

      {!!data.blocked?.length && (
        <>
          <Text style={styles.section}>Ждут предыдущую часть — {data.blocked.length}</Text>
          {data.blocked.map(part => (
            <Pressable
              key={part.id}
              style={styles.row}
              onPress={() => navigation.navigate('TaskCard', {id: part.taskId})}>
              <View style={{flex: 1}}>
                <Text style={styles.rowTitle}>{part.title}</Text>
                <Text style={styles.rowSub}>
                  Появится, когда завершится предыдущая часть
                </Text>
              </View>
            </Pressable>
          ))}
        </>
      )}

      <View style={styles.spacer} />
      <Text style={styles.section}>Жду ответа — {data.waiting.length}</Text>
      {!data.waiting.length ? (
        <Text style={styles.empty}>Вы никого не ждёте.</Text>
      ) : (
        data.waiting.map(part => (
          <Pressable
            key={part.id}
            style={styles.row}
            onPress={() => navigation.navigate('TaskCard', {id: part.taskId})}>
            <View style={{flex: 1}}>
              <Text style={styles.rowTitle}>{part.title}</Text>
              <Text style={styles.rowSub}>
                {(part.assignees || []).map(x => shortName(x.user)).join(', ')} — ещё не в плане
              </Text>
            </View>
          </Pressable>
        ))
      )}

    </ScrollView>
  );
}

const makeStyles = c =>
  StyleSheet.create({
    root: {flex: 1, backgroundColor: c.bgSecondary},

    // Пружина между «требует решения» и «жду ответа»: на коротком списке она
    // разводит разделы по экрану, на длинном схлопывается в ноль.
    spacer: {flexGrow: 1, minHeight: 8},
    cardCode: {
      fontFamily: font.semiBold, fontSize: 10.5, letterSpacing: 0.2,
      color: c.textTertiary, marginBottom: 3,
    },
    cardMeta: {marginTop: 5, gap: 3},
    cardMetaRight: {flexDirection: 'row', alignItems: 'center', gap: 5},

    section: {
      fontFamily: font.semiBold,
      fontSize: 12,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: c.textTertiary,
      marginTop: 20,
      marginBottom: 10,
    },
    empty: {
      fontFamily: font.regular,
      fontSize: 14,
      color: c.textSecondary,
      textAlign: 'center',
      lineHeight: 21,
      padding: 20,
    },

    card: {
      backgroundColor: c.bgPrimary,
      borderRadius: radius.lg,
      padding: 14,
      marginBottom: 12,
    },
    cardTitle: {fontFamily: font.medium, fontSize: 15.5, color: c.textPrimary},
    cardFrom: {fontFamily: font.regular, fontSize: 12.5, color: c.textSecondary, marginTop: 5},

    fit: {borderRadius: radius.md, padding: 11, marginTop: 12},
    fitOk: {backgroundColor: c.primaryLight},
    fitBad: {backgroundColor: c.bgTertiary},
    fitText: {fontFamily: font.regular, fontSize: 13, lineHeight: 19},

    acts: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12},
    btn: {
      paddingHorizontal: 13,
      paddingVertical: 9,
      borderRadius: radius.md,
      backgroundColor: c.bgSecondary,
    },
    btnOff: {opacity: 0.5},
    btnText: {fontFamily: font.regular, fontSize: 13.5, color: c.textPrimary},
    btnPrimary: {backgroundColor: c.primary},
    btnPrimaryText: {fontFamily: font.semiBold, fontSize: 13.5, color: '#FFFFFF'},

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.bgPrimary,
      borderRadius: radius.lg,
      padding: 13,
      marginBottom: 8,
    },
    rowTitle: {fontFamily: font.medium, fontSize: 14.5, color: c.textPrimary},
    rowSub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 3},

  });
