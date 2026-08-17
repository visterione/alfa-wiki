/**
 * Полоса загрузки дня.
 *
 * Самый нагруженный смыслом элемент модуля, поэтому он один на все экраны: три
 * копии с чуть разными порогами означали бы, что «красный» в разных местах
 * приложения наступает в разные моменты.
 *
 * Два решения, повторяющие веб:
 *
 *   — шкала идёт до 1,4 нормы, а не до нормы. Иначе переработка упирается в
 *     край и перестаёт расти визуально ровно там, где становится важной;
 *   — норма отмечена пунктиром. У каждого она своя, и без метки одинаковая
 *     длина заливки у двух людей означала бы совершенно разное.
 *
 * Цвет считается здесь из часов и нормы, а не берётся из поля color в ответе:
 * там три ступени, а полоса красится непрерывной шкалой — см. loadColor.
 */

import React from 'react';
import {View, Text, StyleSheet} from 'react-native';

import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {loadColor} from './taskMeta';

export default function LoadBar({hours, norm, onVacation, compact}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (onVacation) {
    return (
      <View style={[styles.track, compact && styles.trackCompact, styles.vacation]}>
        {!compact && <Text style={styles.vacationText}>отпуск</Text>}
      </View>
    );
  }

  if (!norm) {
    // Норма не задана — полосе нечего показывать. Пустая дорожка честнее, чем
    // залитая на глазок: человек не участвует в планировании.
    return <View style={[styles.track, compact && styles.trackCompact]} />;
  }

  const scale = Math.max(norm * 1.4, 1);
  const fill = Math.min((hours || 0) / scale, 1) * 100;
  const normAt = (norm / scale) * 100;

  return (
    <View style={[styles.track, compact && styles.trackCompact]}>
      <View
        style={[
          styles.fill,
          {width: `${fill}%`, backgroundColor: loadColor(c, (hours || 0) / norm)},
        ]}
      />
      <View style={[styles.norm, {left: `${normAt}%`, borderColor: c.textSecondary}]} />
    </View>
  );
}

const makeStyles = c =>
  StyleSheet.create({
    track: {
      height: 22,
      backgroundColor: c.bgTertiary,
      borderRadius: radius.sm,
      overflow: 'hidden',
      justifyContent: 'center',
    },
    trackCompact: {height: 8, borderRadius: 4},
    fill: {position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: radius.sm},
    norm: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      borderLeftWidth: 1,
      borderStyle: 'dashed',
    },
    vacation: {alignItems: 'center'},
    vacationText: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary},
  });
