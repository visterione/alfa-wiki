/**
 * Нижняя панель действий на стекле.
 *
 * Это как раз тот слой, ради которого размытие и держат: панель лежит поверх
 * списка, и содержимое уезжает под неё. Плоская заливка обрезала бы список
 * ровной линией, размытая — показывает, что там что-то есть, и не отвлекает.
 *
 * Заливка под размытием остаётся (glassOverlay в стилях самой панели): системное
 * «Уменьшение прозрачности» гасит BlurView, и без неё кнопка «Провести» повисла
 * бы прямо на строках документа.
 *
 * Обрезка обязательна: BlurView занимает всю площадь панели и без неё вылезает
 * за её скруглённые края.
 */
import React from 'react';
import {View, StyleSheet} from 'react-native';
import {BlurView} from '@react-native-community/blur';

import {blurKind} from '../theme';
import {useTheme} from '../store/settingsStore';

export default function GlassBar({style, children, ...rest}) {
  const c = useTheme();

  return (
    <View style={[styles.wrap, style]} {...rest}>
      <BlurView
        style={StyleSheet.absoluteFill}
        blurType={blurKind(c)}
        blurAmount={20}
        reducedTransparencyFallbackColor={c.bgPrimary}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {overflow: 'hidden'},
});
