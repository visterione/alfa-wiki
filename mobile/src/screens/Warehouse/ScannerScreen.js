/**
 * Сканер QR: этикетка актива или наклейка на двери кабинета.
 *
 * ── Почему камера здесь имеет смысл, а в вебе нет ────────────────────────────
 *
 * В браузере распознавание держится на BarcodeDetector, которого нет в Safari, —
 * то есть на iPhone веб-сканер не работает вовсе, и остаётся ручной ввод
 * инвентарного номера с клавиатуры. Ради этого мобильное приложение и нужно:
 * камера здесь нативная и одинаковая на обеих платформах.
 *
 * ── Что распознаём ───────────────────────────────────────────────────────────
 *
 * И полную ссылку из QR (https://…/p/a/<токен>), и просто инвентарный номер,
 * набранный руками. Разбирает сервер (GET /assets/lookup), поэтому телефон не
 * знает про формат публичных ссылок и не разойдётся с вебом, когда тот
 * изменится.
 *
 * ── Почему ручной ввод остался ───────────────────────────────────────────────
 *
 * Этикетки затираются, а на старом имуществе их может не быть вовсе. Плюс на
 * складе встречаются ручные сканеры в режиме клавиатуры — они быстрее камеры.
 * Поэтому ввод с клавиатуры не запасной вариант, а равноправный.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Alert, Vibration, ActivityIndicator,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Camera, useCameraDevice, useCodeScanner} from 'react-native-vision-camera';
import {X, Keyboard as KeyboardIcon, CameraOff, CornerDownLeft} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import {radius, font} from '../../theme';
import {useThemedStyles} from '../../store/settingsStore';

export default function WarehouseScannerScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const device = useCameraDevice('back');

  const [permission, setPermission] = useState(null);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  // Один и тот же код держится в кадре секундами. Без этой отметки запрос
  // улетал бы на каждый распознанный кадр, а экран прыгал бы по кругу.
  const handled = useRef(false);

  useEffect(() => {
    (async () => {
      const current = Camera.getCameraPermissionStatus();
      if (current === 'granted') { setPermission('granted'); return; }
      const asked = await Camera.requestCameraPermission();
      setPermission(asked);
    })();
  }, []);

  const open = useCallback(async (code) => {
    const clean = String(code || '').trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const {data} = await warehouseApi.lookup(clean);
      Vibration.vibrate(40);
      if (data.kind === 'asset') {
        navigation.replace('WarehouseAsset', {assetId: data.asset.id});
      } else if (data.kind === 'room') {
        navigation.replace('WarehouseRoom', {roomId: data.room.id});
      } else {
        Alert.alert('Непонятный код', 'По этому коду ничего не нашлось.');
        handled.current = false;
      }
    } catch (e) {
      Alert.alert(
        'Ничего не найдено',
        e?.response?.data?.error || 'По этому коду в портале ничего нет.',
      );
      handled.current = false;
    } finally {
      setBusy(false);
    }
  }, [busy, navigation]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (handled.current || busy) return;
      const value = codes?.[0]?.value;
      if (!value) return;
      handled.current = true;
      open(value);
    },
  });

  const cameraReady = permission === 'granted' && device && !typing;

  return (
    <View style={styles.root}>
      {cameraReady ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={!busy}
          codeScanner={codeScanner}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCamera]}>
          <CameraOff size={34} color="rgba(255,255,255,0.5)" />
          <Text style={styles.noCameraText}>
            {permission === 'denied'
              ? 'Доступ к камере запрещён. Разрешите его в настройках телефона — или введите номер с этикетки руками.'
              : !device
                ? 'Камера недоступна на этом устройстве. Введите инвентарный номер руками.'
                : 'Ввод с клавиатуры'}
          </Text>
        </View>
      )}

      {cameraReady && (
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame} />
        </View>
      )}

      <Pressable
        style={[styles.close, {top: insets.top + 8}]}
        onPress={() => navigation.goBack()}
        hitSlop={10}>
        <X size={22} color="#FFFFFF" />
      </Pressable>

      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      )}

      {/* Панель ручного ввода лежит поверх кадра и всегда доступна: на затёртой
          этикетке камера бесполезна, а номер на ней ещё читается. */}
      <View style={[styles.manual, {paddingBottom: insets.bottom + 12}]}>
        <View style={styles.manualRow}>
          <KeyboardIcon size={18} color="rgba(255,255,255,0.7)" />
          <TextInput
            style={styles.input}
            value={manual}
            onChangeText={setManual}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            onSubmitEditing={() => open(manual)}
            placeholder="МЦ-2026-ХИРУРГ-00341"
            placeholderTextColor="rgba(255,255,255,0.4)"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
          />
          <Pressable
            style={[styles.go, !manual.trim() && styles.goOff]}
            disabled={!manual.trim() || busy}
            onPress={() => open(manual)}>
            <CornerDownLeft size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000000'},
  noCamera: {alignItems: 'center', justifyContent: 'center', padding: 40, gap: 14},
  noCameraText: {
    fontFamily: font.regular,
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    lineHeight: 20,
  },
  frameWrap: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center'},
  // Рамка не сужает область распознавания — она только подсказывает, куда
  // целиться: сканер читает код в любом месте кадра.
  frame: {
    width: 240,
    height: 240,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  close: {
    position: 'absolute',
    left: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  busy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  manual: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  manualRow: {flexDirection: 'row', alignItems: 'center', gap: 10},
  input: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    color: '#FFFFFF',
    fontFamily: font.regular,
    fontSize: 15,
  },
  go: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goOff: {opacity: 0.4},
});
