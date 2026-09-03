import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  Animated,
  PanResponder,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import {font} from '../theme';

const MAX_ZOOM = 6;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const distance = (a, b) => Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);

/**
 * Выбор области снимка, которая станет аватаром.
 *
 * Раньше выбора не было: сервер обрезал картинку по центру (sharp, fit:'cover'),
 * и у вертикальной фотографии в кружок попадала не голова, а середина кадра —
 * то есть чаще всего грудь. Заметно это становилось уже после загрузки.
 *
 * Пиксели режет сервер, а не телефон: в React Native нет способа обрезать
 * картинку без нативного модуля, а тащить его в проект ради одного окна незачем.
 * Отсюда договор наружу: отдаётся не файл, а прямоугольник в координатах
 * исходного снимка, и он же уходит на сервер вместе с файлом.
 *
 * Жесты собраны на PanResponder, а не на react-native-gesture-handler: нужны
 * ровно два — тянуть одним пальцем и сводить два, оба читаются из
 * nativeEvent.touches напрямую. Промежуточные значения не проходят через
 * состояние React: положение и приближение живут в Animated.Value (рисование) и
 * в обычных ref (счёт), поэтому кадр не ждёт перерисовки экрана.
 */
export default function AvatarCropper({visible, asset, onCancel, onDone}) {
  const {width: screenW, height: screenH} = useWindowDimensions();

  // Окно обрезки — квадрат: аватар всё равно круглый и вписан в него
  const box = Math.min(screenW - 32, screenH * 0.5);

  const [source, setSource] = useState(null);

  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const zoom = useRef(new Animated.Value(1)).current;
  const state = useRef({tx: 0, ty: 0, z: 1}).current;
  const gesture = useRef({tx: 0, ty: 0, dx: 0, dy: 0, pinchDist: 0, pinchZoom: 1}).current;

  // Размеры снимка. Обычно их сообщает сам выбор фотографии, но у части
  // аппаратов поля width/height приходят пустыми — тогда спрашиваем систему
  useEffect(() => {
    if (!visible || !asset?.uri) return;
    state.tx = 0;
    state.ty = 0;
    state.z = 1;
    tx.setValue(0);
    ty.setValue(0);
    zoom.setValue(1);

    if (asset.width && asset.height) {
      setSource({width: asset.width, height: asset.height});
      return;
    }
    setSource(null);
    Image.getSize(
      asset.uri,
      (width, height) => setSource({width, height}),
      () => setSource(null),
    );
  }, [visible, asset, state, tx, ty, zoom]);

  // Снимок вписан в окно по короткой стороне: пустых полей в круге быть не
  // должно ни при каком положении
  const base = source ? Math.max(box / source.width, box / source.height) : 1;
  const shownW = source ? source.width * base : 0;
  const shownH = source ? source.height * base : 0;

  const panResponder = useMemo(() => {
    const limit = (value, shown) => {
      const max = Math.max(0, (shown * state.z - box) / 2);
      return clamp(value, -max, max);
    };
    const apply = () => {
      state.tx = limit(state.tx, shownW);
      state.ty = limit(state.ty, shownH);
      tx.setValue(state.tx);
      ty.setValue(state.ty);
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        gesture.tx = state.tx;
        gesture.ty = state.ty;
        gesture.dx = 0;
        gesture.dy = 0;
        gesture.pinchDist = 0;
      },
      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches;

        if (touches.length >= 2) {
          const d = distance(touches[0], touches[1]);
          // Первый кадр сведения задаёт точку отсчёта: до него о расстоянии
          // между пальцами ничего не известно
          if (!gesture.pinchDist) {
            gesture.pinchDist = d;
            gesture.pinchZoom = state.z;
            return;
          }
          state.z = clamp((gesture.pinchZoom * d) / gesture.pinchDist, 1, MAX_ZOOM);
          zoom.setValue(state.z);
          apply();
          return;
        }

        // Палец подняли — перетаскивание продолжается с текущего места, иначе
        // картинка прыгнула бы на всю накопленную за сведение разницу
        if (gesture.pinchDist) {
          gesture.pinchDist = 0;
          gesture.tx = state.tx;
          gesture.ty = state.ty;
          gesture.dx = g.dx;
          gesture.dy = g.dy;
        }

        state.tx = gesture.tx + (g.dx - gesture.dx);
        state.ty = gesture.ty + (g.dy - gesture.dy);
        apply();
      },
    });
  }, [box, gesture, shownH, shownW, state, tx, ty, zoom]);

  const confirm = () => {
    if (!source) return;

    // Экранные точки → пиксели снимка: слева в окне лежит вот эта его точка
    const scale = base * state.z;
    const left = box / 2 + state.tx - (shownW * state.z) / 2;
    const top = box / 2 + state.ty - (shownH * state.z) / 2;

    const x = Math.round(Math.max(0, -left / scale));
    const y = Math.round(Math.max(0, -top / scale));
    // Сторона общая и с запасом внутрь: после округления рамка не должна
    // вылезти за край, иначе сервер отбросит её целиком и вернётся к центру
    const side = Math.max(
      1,
      Math.min(Math.round(box / scale), source.width - x, source.height - y),
    );

    onDone({crop: {x, y, width: side, height: side}, source});
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Text style={styles.title}>Выберите область</Text>
        <Text style={styles.hint}>Двигайте снимок, сводите пальцы для приближения</Text>

        <View style={[styles.box, {width: box, height: box}]} {...panResponder.panHandlers}>
          {source && (
            <Animated.Image
              source={{uri: asset?.uri}}
              style={{
                position: 'absolute',
                left: (box - shownW) / 2,
                top: (box - shownH) / 2,
                width: shownW,
                height: shownH,
                transform: [{translateX: tx}, {translateY: ty}, {scale: zoom}],
              }}
            />
          )}

          {/* Затемнение с круглым окном одним слоем: четыре прямоугольника
              вокруг круга давали щели на дробных размерах экрана */}
          <Svg width={box} height={box} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Path
              d={`M0 0H${box}V${box}H0Z M${box / 2} 4 A${box / 2 - 4} ${box / 2 - 4} 0 1 0 ${box / 2} ${box - 4} A${box / 2 - 4} ${box / 2 - 4} 0 1 0 ${box / 2} 4Z`}
              fill="rgba(0,0,0,0.6)"
              fillRule="evenodd"
            />
          </Svg>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.action} onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.actionText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.action}
            onPress={confirm}
            disabled={!source}
            activeOpacity={0.7}>
            <Text style={[styles.actionText, styles.actionPrimary, !source && styles.actionOff]}>
              Готово
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Кружок с уже выбранной областью — то, каким аватар станет.
 *
 * Файл до отправки не режется (режет сервер), поэтому предпросмотр повторяет
 * рамку средствами раскладки: снимок растянут так, чтобы выбранный квадрат ровно
 * заполнил кружок, а лишнее ушло под края.
 */
export function CroppedThumb({uri, crop, source, size, style}) {
  if (!crop || !source) return null;
  const scale = size / crop.width;
  return (
    <View style={[{width: size, height: size, borderRadius: size / 2, overflow: 'hidden'}, style]}>
      <Image
        source={{uri}}
        style={{
          width: source.width * scale,
          height: source.height * scale,
          marginLeft: -crop.x * scale,
          marginTop: -crop.y * scale,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  // Цвета здесь намеренно мимо палитры темы: окно всегда тёмное, чтобы снимок
  // читался, — как в системном просмотрщике фотографий
  title: {color: '#FFFFFF', fontSize: 17, fontFamily: font.semiBold},
  hint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontFamily: font.regular,
    marginTop: 6,
    marginBottom: 20,
    textAlign: 'center',
  },
  box: {overflow: 'hidden', backgroundColor: '#000000'},
  actions: {flexDirection: 'row', gap: 12, marginTop: 24},
  action: {paddingHorizontal: 24, paddingVertical: 12},
  actionText: {color: 'rgba(255,255,255,0.75)', fontSize: 16, fontFamily: font.medium},
  actionPrimary: {color: '#FFFFFF', fontFamily: font.semiBold},
  actionOff: {opacity: 0.4},
});
