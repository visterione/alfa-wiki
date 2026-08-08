import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  Modal,
  Animated,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import {
  PinchGestureHandler,
  PanGestureHandler,
  TapGestureHandler,
  State,
} from 'react-native-gesture-handler';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Video from 'react-native-video';
import {X, Download, ChevronLeft, ChevronRight} from 'lucide-react-native';

import {saveAttachment} from '../services/downloads';
import {font} from '../theme';
import LogoLoader from './LogoLoader';

/**
 * Полноэкранный просмотр вложения: фото с зумом и видео с плеером.
 *
 * Зум сделан на «старом» API жестов (PinchGestureHandler + Animated), а не на
 * GestureDetector: тот тянет за собой reanimated, а ради двух жестов ставить
 * ещё одну библиотеку с нативной частью не хочется.
 *
 * Масштаб копится между жестами (pinch даёт множитель относительно начала
 * жеста, а не абсолютный), поэтому базовое значение хранится отдельно и
 * пересчитывается на каждом завершении.
 */
export default function MediaViewer({visible, items = [], initialIndex = 0, onClose}) {
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const [saving, setSaving] = useState(false);
  const [index, setIndex] = useState(initialIndex);
  const item = items[index] || null;

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const baseScale = useRef(1);
  const baseX = useRef(0);
  const baseY = useRef(0);
  const pinchRef = useRef(null);
  const panRef = useRef(null);
  const doubleTapRef = useRef(null);

  const reset = (animated = true) => {
    baseScale.current = 1;
    baseX.current = 0;
    baseY.current = 0;
    if (!animated) {
      scale.setValue(1);
      translateX.setValue(0);
      translateY.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.spring(scale, {toValue: 1, useNativeDriver: true, bounciness: 0}),
      Animated.spring(translateX, {toValue: 0, useNativeDriver: true, bounciness: 0}),
      Animated.spring(translateY, {toValue: 0, useNativeDriver: true, bounciness: 0}),
    ]).start();
  };

  useEffect(() => {
    if (visible) setIndex(Math.max(0, Math.min(initialIndex, items.length - 1)));
  }, [visible, initialIndex, items.length]);

  const changeItem = direction => {
    if (items.length < 2) return;
    translateX.setOffset(0);
    translateY.setOffset(0);
    reset(false);
    setIndex(current => (current + direction + items.length) % items.length);
  };

  const onPinch = Animated.event([{nativeEvent: {scale}}], {useNativeDriver: true});

  const onPinchStateChange = event => {
    if (event.nativeEvent.oldState !== State.ACTIVE) return;
    const next = baseScale.current * event.nativeEvent.scale;
    // Меньше единицы не оставляем: картинка должна возвращаться в исходный
    // размер сама, иначе она «висит» уменьшенной посреди чёрного экрана
    if (next <= 1.02) {
      reset();
      return;
    }
    baseScale.current = Math.min(next, 6);
    scale.setValue(baseScale.current);
    scale.setOffset(0);
  };

  const onPan = Animated.event(
    [{nativeEvent: {translationX: translateX, translationY: translateY}}],
    {useNativeDriver: true},
  );

  const onPanStateChange = event => {
    if (event.nativeEvent.oldState !== State.ACTIVE) return;
    // Пока не увеличено, потяг вниз закрывает просмотр — привычный жест
    if (baseScale.current <= 1.02) {
      if (Math.abs(event.nativeEvent.translationX) > 70) {
        changeItem(event.nativeEvent.translationX < 0 ? 1 : -1);
        return;
      }
      if (event.nativeEvent.translationY > 120) {
        onClose();
      }
      reset();
      return;
    }
    baseX.current += event.nativeEvent.translationX;
    baseY.current += event.nativeEvent.translationY;
    translateX.setOffset(baseX.current);
    translateY.setOffset(baseY.current);
    translateX.setValue(0);
    translateY.setValue(0);
  };

  const onDoubleTap = event => {
    if (event.nativeEvent.state !== State.ACTIVE) return;
    if (baseScale.current > 1.02) {
      translateX.setOffset(0);
      translateY.setOffset(0);
      reset();
      return;
    }
    baseScale.current = 2.5;
    Animated.spring(scale, {toValue: 2.5, useNativeDriver: true, bounciness: 0}).start();
  };

  const close = () => {
    translateX.setOffset(0);
    translateY.setOffset(0);
    reset(false);
    onClose();
  };

  const download = async () => {
    setSaving(true);
    try {
      await saveAttachment(item);
    } finally {
      setSaving(false);
    }
  };

  if (!item) return null;

  const isVideo = (item.mimeType || '').startsWith('video/');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.container}>
        <View style={[styles.header, {paddingTop: insets.top + 8}]}>
          <TouchableOpacity onPress={close} hitSlop={12} style={styles.headerBtn}>
            <X size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerName} numberOfLines={1}>{item.name || ''}</Text>
          {items.length > 1 && <Text style={styles.counter}>{index + 1} / {items.length}</Text>}
          <TouchableOpacity onPress={download} hitSlop={12} style={styles.headerBtn} disabled={saving}>
            {saving ? <LogoLoader width={30} color="#FFFFFF" /> : <Download size={21} color="#FFFFFF" />}
          </TouchableOpacity>
        </View>

        {isVideo ? (
          <Video
            source={{uri: item.url}}
            style={styles.video}
            controls
            resizeMode="contain"
            paused={!visible}
            onError={() => {}}
          />
        ) : (
          <PanGestureHandler
            ref={panRef}
            simultaneousHandlers={pinchRef}
            onGestureEvent={onPan}
            onHandlerStateChange={onPanStateChange}
            minPointers={1}
            maxPointers={2}>
            <Animated.View style={styles.gestureLayer}>
              <PinchGestureHandler
                ref={pinchRef}
                simultaneousHandlers={panRef}
                onGestureEvent={onPinch}
                onHandlerStateChange={onPinchStateChange}>
                <Animated.View style={styles.gestureLayer}>
                  <TapGestureHandler
                    ref={doubleTapRef}
                    numberOfTaps={2}
                    onHandlerStateChange={onDoubleTap}>
                    <Animated.Image
                      source={{uri: item.url}}
                      resizeMode="contain"
                      style={[
                        {width, height: height * 0.8},
                        {transform: [{scale}, {translateX}, {translateY}]},
                      ]}
                    />
                  </TapGestureHandler>
                </Animated.View>
              </PinchGestureHandler>
            </Animated.View>
          </PanGestureHandler>
        )}

        {items.length > 1 && (
          <>
            <TouchableOpacity style={[styles.navBtn, styles.navPrev]} onPress={() => changeItem(-1)}>
              <ChevronLeft size={30} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.navBtn, styles.navNext]} onPress={() => changeItem(1)}>
              <ChevronRight size={30} color="#FFFFFF" />
            </TouchableOpacity>
          </>
        )}

        <Text style={[styles.hint, {paddingBottom: insets.bottom + 12}]}>
          {isVideo ? 'Листайте стрелками' : 'Свайп вбок — следующее, двойное касание — приблизить'}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#000000'},
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingBottom: 8,
  },
  headerBtn: {width: 34, height: 34, alignItems: 'center', justifyContent: 'center'},
  headerName: {flex: 1, color: '#FFFFFF', fontSize: 14, fontFamily: font.medium},
  counter: {color: 'rgba(255,255,255,0.75)', fontSize: 12, fontFamily: font.medium},
  navBtn: {position: 'absolute', top: '48%', zIndex: 5, width: 44, height: 52, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center'},
  navPrev: {left: 8},
  navNext: {right: 8},
  gestureLayer: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  video: {flex: 1},
  hint: {
    color: 'rgba(255,255,255,0.5)', fontSize: 12, fontFamily: font.regular,
    textAlign: 'center', paddingTop: 8,
  },
});
