import React, {useEffect, useRef} from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {radius, font} from '../theme';
import {useThemedStyles} from '../store/settingsStore';

/**
 * Нижняя шторка с выездом.
 *
 * Стандартный Modal с animationType="slide" двигает вместе со шторкой и
 * затемнение, из-за чего фон моргает. Здесь подложка проявляется отдельно, а
 * сама шторка выезжает снизу — как в системных диалогах и мессенджерах.
 *
 * Закрытие анимируется вручную: Modal снимается с экрана мгновенно, поэтому
 * сначала проигрываем уезд, и только потом сообщаем наружу о закрытии.
 */
export default function BottomSheet({visible, title, onClose, children, maxHeightRatio = 0.8}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const {height: screenHeight} = useWindowDimensions();

  // mounted живёт дольше visible: держит Modal на экране, пока идёт уезд
  const [mounted, setMounted] = React.useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }
    if (!mounted) return;
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({finished}) => {
      if (finished) setMounted(false);
    });
  }, [visible, mounted, progress]);

  if (!mounted) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [screenHeight * 0.5, 0],
  });

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, {opacity: progress}]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <View style={styles.wrap} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            {
              transform: [{translateY}],
              maxHeight: screenHeight * maxHeightRatio,
              paddingBottom: insets.bottom,
            },
          ]}>
          {/* Полоска-«ручка»: подсказывает, что шторку можно закрыть свайпом
              вниз по подложке, и отделяет её от содержимого экрана */}
          <View style={styles.grabber} />
          {!!title && <Text style={styles.title}>{title}</Text>}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = c => StyleSheet.create({
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)'},
  wrap: {flex: 1, justifyContent: 'flex-end'},
  sheet: {
    backgroundColor: c.bgPrimary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: 8,
  },
  grabber: {
    alignSelf: 'center', width: 38, height: 4, borderRadius: 2,
    backgroundColor: c.border, marginBottom: 8,
  },
  title: {
    fontSize: 16, fontFamily: font.semiBold, color: c.textPrimary,
    paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10,
  },
});
