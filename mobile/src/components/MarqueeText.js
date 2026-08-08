import React, {useEffect, useRef, useState, useCallback} from 'react';
import {View, Text, Animated, StyleSheet} from 'react-native';

/**
 * Текст, который сам прокручивается, если не помещается по ширине.
 *
 * Обрезать длинное имя многоточием — значит спрятать как раз ту часть, по
 * которой человека и узнают: у нас в системе почти у всех «Фамилия Имя
 * Отчество», и хвост обычно информативнее начала.
 *
 * Едет туда-обратно с паузами по краям, а не бесконечной лентой: имя надо
 * прочитать, а не следить за бегущей строкой. Если текст помещается —
 * анимации нет вовсе, чтобы не дёргать глаз на ровном месте.
 */

// Скорость прокрутки, точек в секунду. Намеренно медленно: читать, а не ловить.
const SPEED = 28;
// Пауза на краях, чтобы успеть прочесть начало и конец
const EDGE_PAUSE_MS = 1400;

export default function MarqueeText({children, style, containerStyle}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;

  const overflow = Math.max(0, textWidth - containerWidth);
  const shouldScroll = overflow > 1;

  const onContainerLayout = useCallback(e => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const onTextLayout = useCallback(e => {
    setTextWidth(e.nativeEvent.layout.width);
  }, []);

  useEffect(() => {
    translateX.stopAnimation();
    translateX.setValue(0);

    if (!shouldScroll) return;

    const duration = (overflow / SPEED) * 1000;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(EDGE_PAUSE_MS),
        Animated.timing(translateX, {
          toValue: -overflow,
          duration,
          useNativeDriver: true,
        }),
        Animated.delay(EDGE_PAUSE_MS),
        Animated.timing(translateX, {
          toValue: 0,
          duration,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [shouldScroll, overflow, translateX]);

  return (
    <View style={[styles.container, containerStyle]} onLayout={onContainerLayout}>
      {/*
        Невидимая копия для замера. Измерять видимый текст нельзя: он лежит в
        контейнере ограниченной ширины и обрезается до неё, поэтому onLayout
        вернул бы ширину контейнера, а не настоящую — переполнение всегда
        выходило бы нулевым. Здесь же обёртка заведомо шире любого имени,
        и текст растягивается до своего честного размера.
      */}
      <View style={styles.measureWrap} pointerEvents="none">
        <Text style={[style, styles.measureText]} onLayout={onTextLayout}>
          {children}
        </Text>
      </View>

      <Animated.View
        style={[
          {transform: [{translateX}]},
          // Ширина по содержимому — иначе вложенный Text снова упрётся
          // в границы контейнера и покажет многоточие
          textWidth ? {width: textWidth} : null,
        ]}>
        <Text style={style} numberOfLines={1}>
          {children}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {overflow: 'hidden'},
  measureWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    opacity: 0,
    // Заведомо больше любой разумной длины имени
    width: 4000,
  },
  measureText: {alignSelf: 'flex-start'},
});
