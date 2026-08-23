/**
 * Оценка звёздами.
 *
 * Цифра «3 из 5» читается медленнее, чем ряд звёзд: в списке отзывов взгляд
 * ищет негатив, а негатив — это форма, а не число. Цвет тоже несёт смысл:
 * три звезды и ниже (isNegative) — это работа, четыре и пять — нет.
 */
import React from 'react';
import {View, StyleSheet} from 'react-native';
import {Star} from 'lucide-react-native';

import {useTheme} from '../store/settingsStore';

export default function Stars({rating, size = 14}) {
  const c = useTheme();
  const value = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  const tone = value <= 3 ? c.error : c.warning;

  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map(at => (
        <Star
          key={at}
          size={size}
          color={at <= value ? tone : c.border}
          // Заливка у закрашенных: контур одной толщины на всех пяти звёздах
          // читается как «пять пустых», и оценка теряется
          fill={at <= value ? tone : 'transparent'}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 2},
});
