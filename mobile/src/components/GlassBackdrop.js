/**
 * Подложка модуля — то, на чём стоит всё стекло.
 *
 * Без неё прозрачность бессмысленна: сквозь полупрозрачную карточку видно ровно
 * ту же заливку, что и вокруг неё, и вся работа со слоями пропадает. Поэтому
 * подложка кладётся один раз под весь стек экранов, а сами экраны становятся
 * прозрачными.
 *
 * Красится акцентом человека (см. glassBackdrop): цвет оформления выбирают в
 * настройках, и модуль с собственным оттенком читался бы как чужая программа.
 *
 * Лежит под навигатором, а не внутри экрана: иначе при переходе между экранами
 * она уезжала бы вместе с ними, и фон мигал бы на каждом шаге.
 */
import React from 'react';
import {View, StyleSheet} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import {glassBackdrop} from '../theme';
import {useTheme} from '../store/settingsStore';

export default function GlassBackdrop({children}) {
  const c = useTheme();

  return (
    <View style={[styles.root, {backgroundColor: c.bgSecondary}]}>
      <LinearGradient
        {...glassBackdrop(c)}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
