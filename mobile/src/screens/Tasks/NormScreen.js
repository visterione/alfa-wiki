/**
 * Личное недельное рабочее расписание для планирования задач.
 *
 * Норма дня равна фактической длительности смены — отдельного поля «норма» нет
 * и не будет: два числа про одно и то же расходятся на первой же правке.
 */
import React, {useCallback, useState} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet, Alert, TextInput} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Check} from 'lucide-react-native';

import {tasks as tasksApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {useAuth} from '../../store/authStore';
import {hoursText} from './taskMeta';

const DAYS = [
  ['mon', 'Понедельник'], ['tue', 'Вторник'], ['wed', 'Среда'], ['thu', 'Четверг'],
  ['fri', 'Пятница'], ['sat', 'Суббота'], ['sun', 'Воскресенье'],
];

const makeDefault = () => ({
  days: Object.fromEntries(DAYS.map(([key], i) => [
    key,
    i < 5 ? {enabled: true, start: '09:00', end: '18:00'} : {enabled: false},
  ])),
});

const shiftHours = day => {
  if (!day?.enabled || !/^\d{2}:\d{2}$/.test(day.start || '') || !/^\d{2}:\d{2}$/.test(day.end || '')) {
    return 0;
  }
  const [startHour, startMinute] = day.start.split(':').map(Number);
  const [endHour, endMinute] = day.end.split(':').map(Number);
  return Math.max(0, ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60);
};

export default function NormScreen({navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tabInset = useTabBarInset();
  const {user, refreshUser} = useAuth();
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    tasksApi.getAccess()
      .then(({data}) => {
        if (!alive) return;
        setSchedule(data.workSchedule || makeDefault());
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []));

  const update = (key, patch) => setSchedule(current => ({
    ...current,
    days: {...current.days, [key]: {...(current.days[key] || {}), ...patch}},
  }));

  const weekly = DAYS.reduce((sum, [key]) => sum + shiftHours(schedule?.days[key]), 0);

  /**
   * После сохранения экран закрывается сам.
   *
   * Раньше здесь было окно «сохранено» и всё: экран оставался открытым, а
   * вернуться из него было некуда — люди перезапускали приложение. Уходим
   * назад, а если стека нет (экран открыли прямым переходом из «Задач»),
   * возвращаемся во вкладку задач.
   */
  const leave = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.getParent()?.navigate('TasksTab');
  };

  const save = async value => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await tasksApi.setSchedule(user.id, value);
      setSchedule(value || makeDefault());
      refreshUser?.();
      leave();
    } catch (e) {
      Alert.alert('Не получилось', e?.response?.data?.error || 'Проверьте границы смен');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !schedule) return <LogoLoader />;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{padding: 16, paddingBottom: tabInset + 24}}>
      <View style={styles.card}>
        <Text style={styles.value}>{hoursText(weekly)}</Text>
        <Text style={styles.caption}>рабочая неделя</Text>
      </View>

      <View style={styles.days}>
        {DAYS.map(([key, label]) => {
          const day = schedule.days[key] || {enabled: false};
          return (
            <View key={key} style={[styles.day, !day.enabled && styles.dayOff]}>
              <Pressable
                style={styles.dayToggle}
                onPress={() => update(key, day.enabled
                  ? {enabled: false}
                  : {enabled: true, start: day.start || '09:00', end: day.end || '18:00'})}>
                <View style={[styles.check, day.enabled && styles.checkOn]}>
                  {day.enabled && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
                </View>
                <Text style={styles.dayName}>{label}</Text>
              </Pressable>

              {day.enabled ? (
                <View style={styles.fields}>
                  <TextInput
                    style={styles.input}
                    value={day.start}
                    placeholder="09:00"
                    placeholderTextColor={c.textTertiary}
                    keyboardType="numbers-and-punctuation"
                    onChangeText={start => update(key, {start})}
                    maxLength={5}
                  />
                  <Text style={styles.dash}>—</Text>
                  <TextInput
                    style={styles.input}
                    value={day.end}
                    placeholder="18:00"
                    placeholderTextColor={c.textTertiary}
                    keyboardType="numbers-and-punctuation"
                    onChangeText={end => update(key, {end})}
                    maxLength={5}
                  />
                  <Text style={styles.dayHours}>{hoursText(shiftHours(day))}</Text>
                </View>
              ) : (
                <Text style={styles.offText}>выходной</Text>
              )}
            </View>
          );
        })}
      </View>

      <Pressable
        style={[styles.save, saving && styles.disabled]}
        disabled={saving}
        onPress={() => save(schedule)}>
        <Text style={styles.saveText}>{saving ? 'Сохраняем…' : 'Сохранить'}</Text>
      </Pressable>

      <Pressable style={styles.back} disabled={saving} onPress={leave}>
        <Text style={styles.backText}>Назад</Text>
      </Pressable>

      <Pressable
        style={styles.leave}
        disabled={saving}
        onPress={() => Alert.alert(
          'Не участвовать в планировании?',
          'Вам нельзя будет назначать задачи.',
          [
            {text: 'Отмена', style: 'cancel'},
            {text: 'Отключить', style: 'destructive', onPress: () => save(null)},
          ],
        )}>
        <Text style={styles.leaveText}>Не участвовать в планировании</Text>
      </Pressable>
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},

  card: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, padding: 20, alignItems: 'center', marginBottom: 16},
  value: {fontFamily: font.semiBold, fontSize: 32, color: c.textPrimary},
  caption: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, marginTop: 5},

  days: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, overflow: 'hidden'},
  day: {
    minHeight: 62, paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderLight,
  },
  dayOff: {opacity: 0.6},
  dayToggle: {flexDirection: 'row', alignItems: 'center', gap: 10},
  check: {
    width: 21, height: 21, borderRadius: 7, borderWidth: 1, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: {backgroundColor: c.primary, borderColor: c.primary},
  dayName: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary},

  fields: {flexDirection: 'row', alignItems: 'center', marginTop: 9, marginLeft: 31, gap: 7},
  input: {
    width: 62, height: 36, borderRadius: radius.sm, backgroundColor: c.bgSecondary,
    color: c.textPrimary, fontFamily: font.medium, fontSize: 13.5, textAlign: 'center', padding: 0,
  },
  dash: {color: c.textTertiary},
  // Часы смены рядом с полями: правку границ сразу видно в норме дня.
  dayHours: {fontFamily: font.regular, fontSize: 12.5, color: c.textTertiary, marginLeft: 4},
  offText: {fontFamily: font.regular, color: c.textTertiary, fontSize: 12.5, marginLeft: 31, marginTop: 5},

  save: {height: 48, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', marginTop: 18},
  saveText: {fontFamily: font.semiBold, color: '#FFFFFF', fontSize: 15},
  disabled: {opacity: 0.5},
  back: {alignItems: 'center', paddingVertical: 14},
  backText: {fontFamily: font.medium, color: c.primary, fontSize: 14},
  leave: {alignItems: 'center', paddingVertical: 8},
  leaveText: {fontFamily: font.regular, color: c.error, fontSize: 14},
});
