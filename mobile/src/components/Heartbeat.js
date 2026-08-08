import React, {useEffect, useRef} from 'react';
import {View, Animated, Easing, StyleSheet} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import {useTheme} from '../store/settingsStore';

/**
 * Индикатор загрузки — кардиограмма вместо крутящегося колеса.
 *
 * Как это устроено: линия рисуется дважды. Нижний слой — вся кривая приглушённым
 * цветом, он стоит на месте. Верхний — та же кривая в полную яркость, но её
 * видно только через узкое окно, которое едет слева направо. Получается импульс,
 * бегущий по линии, как на мониторе пациента.
 *
 * Почему не анимация самой линии (strokeDashoffset): свойства SVG идут только
 * через JS-мост — нативный драйвер их не умеет. Индикатор показывают ровно
 * тогда, когда JS-поток занят ответом сервера, и линия дёргалась бы именно в
 * этот момент. Здесь же двигаются только transform у обычных View, а это целиком
 * нативная анимация: она не замирает, чем бы ни был занят JS.
 *
 * Окно и его содержимое едут навстречу друг другу с одинаковой скоростью —
 * поэтому кривая внутри окна остаётся неподвижной относительно нижнего слоя и
 * точно совпадает с ней, а не проползает мимо.
 *
 * @param {number} width  ширина в px, высота считается сама (3:1)
 * @param {string} color  цвет линии; на цветных кнопках передают '#FFFFFF'
 */

// Один сердечный цикл: изолиния → зубец P → комплекс QRS → зубец T → изолиния.
//
// Только прямые отрезки, никаких дуг. Так эту фигуру рисуют везде — от иконок
// Lucide и Bootstrap до самих кардиографов: перо самописца физически не может
// скруглить угол, поэтому скруглённые P и T читаются не кардиограммой, а
// волнистой линией. Первый вариант был на квадратичных кривых и выглядел мягче,
// чем должен.
//
// Пропорции амплитуд взяты как на настоящей плёнке: R много выше всех, за ним T,
// самый мелкий — P.
const VIEW_W = 100;
const VIEW_H = 40;
const ECG_PATH = [
  'M0 20',
  'H24', // изолиния
  'L28 15 L32 20', // зубец P
  'H38', // сегмент PR
  'L40 24', // зубец Q
  'L44 4', // зубец R
  'L48 32', // зубец S
  'L51 20',
  'H58', // сегмент ST
  'L63 13 L68 20', // зубец T
  'H100', // изолиния
].join(' ');

// Доля ширины, которую занимает светящееся окно
const WINDOW_RATIO = 0.34;
const SWEEP_DURATION = 1500;

export default function Heartbeat({width = 96, color, style}) {
  const c = useTheme();
  const stroke = color || c.primary;

  const height = width / (VIEW_W / VIEW_H);
  const windowWidth = width * WINDOW_RATIO;

  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sweep = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: SWEEP_DURATION,
        // Линейно: импульс на кардиографе идёт с постоянной скоростью,
        // ускорение к краям читалось бы как рывок
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    sweep.start();
    return () => sweep.stop();
  }, [progress]);

  // Окно выезжает из-за левого края и уходит за правый — иначе на старте и
  // финише вспышка появлялась бы и пропадала посреди линии
  const translate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-windowWidth, width],
  });

  const line = (opacity, strokeWidth) => (
    <Svg width={width} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
      <Path
        d={ECG_PATH}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeOpacity={opacity}
        strokeLinecap="butt"
        // Углы острые. Вершина R — угол около 19°, а при нём miter по умолчанию
        // срезается в фаску (предел 4) и пик выходит с плоской макушкой; отсюда
        // поднятый лимит.
        strokeLinejoin="miter"
        strokeMiterlimit={10}
        fill="none"
      />
    </Svg>
  );

  return (
    <View style={[{width, height}, style]} pointerEvents="none">
      {line(0.22, 2)}

      <Animated.View
        style={[
          styles.window,
          {width: windowWidth, height, transform: [{translateX: translate}]},
        ]}>
        {/* Содержимое едет назад ровно на столько же, на сколько окно вперёд:
            так кривая внутри стоит на месте и ложится точно на нижний слой */}
        <Animated.View
          style={{
            width,
            height,
            transform: [{translateX: Animated.multiply(translate, -1)}],
          }}>
          {line(1, 2.4)}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  window: {
    position: 'absolute',
    left: 0,
    top: 0,
    // Обрезает яркую копию линии по краям окна — в этом весь эффект
    overflow: 'hidden',
  },
});
