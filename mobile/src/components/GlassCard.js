/**
 * Стеклянная карточка.
 *
 * Поверхность собирается из четырёх слоёв, и каждый отвечает за своё: заливка
 * даёт полупрозрачность, кромка — фаску, блик по верхней грани — свет, тень —
 * высоту над подложкой. Рецепты лежат в theme.js (glassSurface, glassSheen),
 * потому что тем же языком говорят и шторка, и панели, и веб после 7.73.
 *
 * ── Почему два вложенных View ────────────────────────────────────────────────
 *
 * Внешнему достаётся тень, внутреннему — обрезка. На Android тень рисуется
 * системой за границами вида, и `overflow: 'hidden'` на том же самом View
 * срезал бы её вместе с бликом: карточка выходила плоской ровно там, где
 * должна была казаться приподнятой.
 *
 * ── Почему без размытия ──────────────────────────────────────────────────────
 *
 * BlurView здесь не стоит намеренно: карточек в списке кабинета бывает по
 * три десятка, и столько же проходов размытия роняют прокрутку на Android.
 * Настоящее размытие живёт на слоях поверх содержимого — шторка, нижняя
 * панель, — их на экране единицы.
 */
import React from 'react';
import {View, StyleSheet} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import {radius, glassSurface, glassSheen} from '../theme';
import {useTheme} from '../store/settingsStore';

/**
 * Что из переданных стилей достаётся внешнему виду, а что внутреннему.
 *
 * Внешний отвечает за место карточки на экране и её тень, внутренний — за то,
 * как разложено содержимое. Если отдать всё внешнему, отступы и `gap` разложат
 * единственного потомка — внутренний слой, — и содержимое слипнется; если всё
 * внутреннему, карточка потеряет свои поля и встанет вплотную к соседям.
 */
const OUTER_KEYS = new Set([
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginHorizontal', 'marginVertical', 'alignSelf', 'flex', 'flexGrow',
  'flexShrink', 'flexBasis', 'width', 'height', 'minWidth', 'maxWidth',
  'minHeight', 'maxHeight', 'position', 'top', 'left', 'right', 'bottom',
  'zIndex', 'borderRadius', 'overflow',
]);

export default function GlassCard({
  style, children, sheen = true, round = radius.lg, ...rest
}) {
  const c = useTheme();
  const surface = glassSurface(c);
  const {backgroundColor, borderWidth, borderColor, ...elevation} = surface;

  const flat = StyleSheet.flatten(style) || {};
  const outer = {};
  const inner = {};
  for (const [key, value] of Object.entries(flat)) {
    (OUTER_KEYS.has(key) ? outer : inner)[key] = value;
  }

  return (
    <View style={[{borderRadius: round}, elevation, outer]} {...rest}>
      <View
        style={[
          styles.inner,
          {backgroundColor, borderWidth, borderColor, borderRadius: outer.borderRadius ?? round},
          inner,
        ]}>
        {/* Блик не перехватывает касания: под ним живые строки списка */}
        {sheen && (
          <LinearGradient
            {...glassSheen(c)}
            pointerEvents="none"
            style={styles.sheen}
          />
        )}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inner: {overflow: 'hidden'},
  // Блик занимает верхнюю треть: ниже свет уже не падает, а растянутый на всю
  // высоту он выбеливает середину карточки и съедает контраст текста.
  sheen: {position: 'absolute', left: 0, right: 0, top: 0, height: 64},
});
