/** Личное недельное рабочее расписание для планирования задач. */
import React, {useCallback, useState} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet, Alert, TextInput} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {tasks as tasksApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {useAuth} from '../../store/authStore';
import {hoursText} from './taskMeta';

const DAYS = [['mon', 'Пн'], ['tue', 'Вт'], ['wed', 'Ср'], ['thu', 'Чт'], ['fri', 'Пт'], ['sat', 'Сб'], ['sun', 'Вс']];
const makeDefault = () => ({days: Object.fromEntries(DAYS.map(([key], i) => [key,
  i < 5 ? {enabled: true, start: '09:00', end: '18:00'} : {enabled: false},
]))});

const shiftHours = day => {
  if (!day?.enabled || !/^\d{2}:\d{2}$/.test(day.start || '') || !/^\d{2}:\d{2}$/.test(day.end || '')) return 0;
  const [startHour, startMinute] = day.start.split(':').map(Number);
  const [endHour, endMinute] = day.end.split(':').map(Number);
  return Math.max(0, ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60);
};

export default function NormScreen() {
  const styles = useThemedStyles(makeStyles);
  const tabInset = useTabBarInset();
  const contentStyle = {padding: 16, paddingBottom: tabInset + 24};
  const {user, refreshUser} = useAuth();
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    tasksApi.getAccess().then(({data}) => {
      if (alive) { setSchedule(data.workSchedule || makeDefault()); setLoading(false); }
    }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []));

  const update = (key, patch) => setSchedule(current => ({...current, days: {...current.days,
    [key]: {...(current.days[key] || {}), ...patch},
  }}));
  const weekly = DAYS.reduce((sum, [key]) => sum + shiftHours(schedule?.days[key]), 0);
  const save = async value => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await tasksApi.setSchedule(user.id, value);
      setSchedule(value || makeDefault());
      refreshUser?.();
      Alert.alert(value ? 'Расписание сохранено' : 'Планирование отключено', value
        ? `Рабочая неделя — ${hoursText(weekly)}. Выходные исключены из расчёта.`
        : 'Вам нельзя назначать задачи, пока расписание не настроено.');
    } catch (e) { Alert.alert('Не получилось', e?.response?.data?.error || 'Проверьте границы смен'); }
    finally { setSaving(false); }
  };

  if (loading || !schedule) return <LogoLoader />;
  return <ScrollView style={styles.root} contentContainerStyle={contentStyle}>
    <View style={styles.card}><Text style={styles.value}>{hoursText(weekly)}</Text><Text style={styles.caption}>продолжительность рабочей недели</Text></View>
    <Text style={styles.explain}>Для каждого рабочего дня задайте начало и конец смены. Норма дня автоматически равна её фактической длительности.</Text>
    <View style={styles.days}>{DAYS.map(([key, label]) => { const day = schedule.days[key] || {enabled: false}; return <View key={key} style={[styles.day, !day.enabled && styles.dayOff]}>
      <Pressable style={styles.dayToggle} onPress={() => update(key, day.enabled ? {enabled: false} : {enabled: true, start: day.start || '09:00', end: day.end || '18:00'})}>
        <View style={[styles.check, day.enabled && styles.checkOn]}><Text style={styles.checkText}>{day.enabled ? '✓' : ''}</Text></View><Text style={styles.dayName}>{label}</Text>
      </Pressable>
      {day.enabled ? <View style={styles.fields}>
        <TextInput style={styles.input} value={day.start} placeholder="09:00" onChangeText={start => update(key, {start})} maxLength={5} />
        <Text style={styles.dash}>—</Text><TextInput style={styles.input} value={day.end} placeholder="18:00" onChangeText={end => update(key, {end})} maxLength={5} />
      </View> : <Text style={styles.offText}>выходной</Text>}
    </View>; })}</View>
    <Pressable style={[styles.save, saving && styles.disabled]} disabled={saving} onPress={() => save(schedule)}><Text style={styles.saveText}>{saving ? 'Сохраняем…' : 'Сохранить расписание'}</Text></Pressable>
    <Pressable style={styles.leave} disabled={saving} onPress={() => Alert.alert('Не участвовать в планировании?', 'Вам нельзя будет назначать задачи.', [{text: 'Отмена', style: 'cancel'}, {text: 'Отключить', style: 'destructive', onPress: () => save(null)}])}><Text style={styles.leaveText}>Не участвовать в планировании</Text></Pressable>
  </ScrollView>;
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  card: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, padding: 20, alignItems: 'center'},
  value: {fontFamily: font.semiBold, fontSize: 32, color: c.textPrimary},
  caption: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, marginTop: 5},
  explain: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, lineHeight: 19, marginVertical: 18},
  days: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, overflow: 'hidden'},
  day: {minHeight: 68, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border},
  dayOff: {opacity: 0.65}, dayToggle: {flexDirection: 'row', alignItems: 'center', gap: 9},
  check: {width: 20, height: 20, borderRadius: 7, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center'},
  checkOn: {backgroundColor: c.primary, borderColor: c.primary}, checkText: {color: '#fff', fontSize: 12},
  dayName: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary},
  fields: {flexDirection: 'row', alignItems: 'center', marginTop: 9, marginLeft: 29, gap: 6},
  input: {width: 58, height: 34, borderRadius: radius.sm, backgroundColor: c.bgSecondary, color: c.textPrimary, fontFamily: font.regular, fontSize: 13, textAlign: 'center', padding: 0},
  dash: {color: c.textTertiary},
  offText: {fontFamily: font.regular, color: c.textTertiary, fontSize: 12, marginLeft: 29, marginTop: 4},
  save: {height: 48, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', marginTop: 18},
  saveText: {fontFamily: font.semiBold, color: '#fff', fontSize: 15}, disabled: {opacity: 0.5},
  leave: {alignItems: 'center', paddingVertical: 17}, leaveText: {fontFamily: font.regular, color: c.error, fontSize: 14},
});
