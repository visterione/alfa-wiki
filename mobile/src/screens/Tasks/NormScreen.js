/**
 * Норма рабочего дня.
 *
 * Живёт в настройках, а не в модуле: это личная настройка вроде темы, её
 * задают один раз и почти не трогают. Держать под неё отдельный экран в
 * календаре значило бы каждый день показывать кнопку, на которую нажимают
 * дважды в год.
 *
 * Формулировка на экране важнее самого поля. Люди по привычке ставят 8 —
 * длину смены, — после чего загрузка показывает переработку у всех сразу и
 * модулю перестают верить. Поэтому здесь прямо сказано, что это не смена, и
 * приведены примеры.
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
import {hoursText} from './taskMeta';

/** Шаг 0,2 ч — как в вебе: норма 6,4 у аналитика это реальная цифра. */
const STEPS = [4, 4.5, 5, 5.5, 6, 6.4, 6.8, 7, 7.5, 8];

export default function NormScreen() {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tabInset = useTabBarInset();
  const {user, refreshUser} = useAuth();

  const [norm, setNorm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      tasksApi
        .getAccess()
        .then(({data}) => {
          if (alive) {
            setNorm(data.norm);
            setLoading(false);
          }
        })
        .catch(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, []),
  );

  const save = async value => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await tasksApi.setNorm(user.id, value);
      setNorm(value);
      refreshUser?.();
      Alert.alert(
        'Норма сохранена',
        value === null
          ? 'Вы больше не участвуете в планировании: задачи вам ставить нельзя.'
          : `${hoursText(value)} в день. Пересчитаны все дни, цвета и проверка при постановке задач.`,
      );
    } catch (e) {
      Alert.alert('Не получилось', e?.response?.data?.error || 'Попробуйте ещё раз');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LogoLoader />;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{padding: 16, paddingBottom: tabInset + 24}}>
      <View style={styles.card}>
        <Text style={styles.value}>{norm === null ? 'не задана' : hoursText(norm)}</Text>
        <Text style={styles.caption}>
          Сколько часов в день вы реально тратите на задачи
        </Text>
      </View>

      <Text style={styles.section}>Выберите значение</Text>
      <View style={styles.steps}>
        {STEPS.map(value => (
          <Pressable
            key={value}
            style={[styles.step, norm === value && styles.stepOn, saving && styles.off]}
            disabled={saving}
            onPress={() => save(value)}>
            <Text style={[styles.stepText, norm === value && styles.stepTextOn]}>
              {hoursText(value)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.explain}>
        Это не длина смены, а честное время на задачи: рабочий день минус
        встречи, переключения и перерывы.{'\n\n'}
        Норма у каждого своя, и это не формальность: у подрядчика на part-time
        она может быть 4 часа, у поддержки со сменным графиком — 7. Пока норма
        задаётся одной цифрой на всех, отчёт по загрузке показывает лишь то,
        насколько неверно эта цифра выбрана.{'\n\n'}
        От неё зависит всё остальное: цвет дня, предупреждение «не помещается»
        при постановке задачи и то, что увидит руководитель в загрузке команды.
      </Text>

      {norm !== null && (
        <Pressable
          style={[styles.leave, saving && styles.off]}
          disabled={saving}
          onPress={() =>
            Alert.alert(
              'Выйти из планирования?',
              'Загрузка перестанет считаться, а ставить вам задачи будет нельзя.',
              [
                {text: 'Отмена', style: 'cancel'},
                {text: 'Выйти', style: 'destructive', onPress: () => save(null)},
              ],
            )
          }>
          <Text style={[styles.leaveText, {color: c.error}]}>Не участвовать в планировании</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const makeStyles = c =>
  StyleSheet.create({
    root: {flex: 1, backgroundColor: c.bgSecondary},

    card: {
      backgroundColor: c.bgPrimary,
      borderRadius: radius.lg,
      padding: 20,
      alignItems: 'center',
    },
    value: {fontFamily: font.semiBold, fontSize: 32, color: c.textPrimary},
    caption: {
      fontFamily: font.regular,
      fontSize: 13,
      color: c.textSecondary,
      marginTop: 6,
      textAlign: 'center',
    },

    section: {
      fontFamily: font.semiBold,
      fontSize: 12,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: c.textTertiary,
      marginTop: 24,
      marginBottom: 10,
    },
    steps: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
    step: {
      paddingHorizontal: 15,
      paddingVertical: 10,
      borderRadius: radius.md,
      backgroundColor: c.bgPrimary,
    },
    stepOn: {backgroundColor: c.primary},
    stepText: {fontFamily: font.regular, fontSize: 14, color: c.textPrimary},
    stepTextOn: {fontFamily: font.semiBold, color: '#FFFFFF'},
    off: {opacity: 0.5},

    explain: {
      fontFamily: font.regular,
      fontSize: 13,
      color: c.textSecondary,
      lineHeight: 20,
      marginTop: 22,
    },

    leave: {alignItems: 'center', paddingVertical: 16, marginTop: 10},
    leaveText: {fontFamily: font.regular, fontSize: 14},
  });
