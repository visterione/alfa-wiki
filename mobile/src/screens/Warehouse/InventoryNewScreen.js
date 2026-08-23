/**
 * Открытие описи с телефона.
 *
 * Раньше это было можно только в вебе, и получалось так: человек приходит в
 * кабинет считать имущество, открывает список описей — а он пуст, потому что
 * завести опись должен был кто-то за компьютером. Ходить за этим к столу и
 * возвращаться — ровно та работа, ради отказа от которой модуль и живёт в
 * телефоне.
 *
 * Область — только кабинет. Опись по отделению осталась в вебе: она охватывает
 * помещения, которых человек сейчас не видит, и замораживает по ним операции —
 * такое решение принимают, глядя в приказ, а не стоя в коридоре.
 *
 * Кабинеты, где опись уже идёт, из работы не выбывают: нажатие на такой
 * открывает существующий пересчёт. Это тот же самый случай — человек пришёл
 * считать, — и упереться здесь в «тут уже идёт инвентаризация» было бы
 * издевательством.
 */
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, Alert, Modal,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Camera, useCameraDevice, useCodeScanner} from 'react-native-vision-camera';
import {ScanLine, Search, X, ClipboardCheck} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {loadLocationTree} from '../../store/warehouseStore';
import {flattenRooms, roomMatches} from './warehouseMeta';

export default function WarehouseInventoryNewScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const device = useCameraDevice('back');

  const [rooms, setRooms] = useState([]);
  const [busyRooms, setBusyRooms] = useState(new Map());
  const [roomId, setRoomId] = useState(null);
  const [basis, setBasis] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scanBusy = useRef(false);

  const load = useCallback(async () => {
    try {
      const [tree, sessionsResult] = await Promise.all([
        loadLocationTree(),
        warehouseApi.inventorySessions(),
      ]);
      setRooms(flattenRooms(tree));
      const busy = new Map();
      for (const session of sessionsResult.data || []) {
        if (session.status === 'closed' || session.status === 'cancelled') continue;
        if (session.roomId) busy.set(session.roomId, session);
      }
      setBusyRooms(busy);
    } catch {
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Список с заголовками медцентра и этажа: выбирают в нём кабинет, но узнают
  // его по месту — номер 305 есть в каждом здании сети.
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = [];
    let mc = null;
    let group = null;
    for (const room of rooms) {
      if (!roomMatches(room, needle)) continue;
      if (room.medCenterId !== mc) {
        mc = room.medCenterId;
        group = null;
        out.push({type: 'mc', key: `mc-${mc}`, title: room.medCenterName});
      }
      if (room.groupKey !== group) {
        group = room.groupKey;
        out.push({type: 'group', key: `g-${mc}-${group}`, title: room.groupTitle});
      }
      out.push({type: 'room', key: `r-${room.id}`, room});
    }
    return out;
  }, [rooms, q]);

  const openExisting = session => navigation.replace('WarehouseInventoryCount', {
    sessionId: session.id,
  });

  const pick = (room) => {
    const busy = busyRooms.get(room.id);
    if (busy) return openExisting(busy);
    return setRoomId(prev => (prev === room.id ? null : room.id));
  };

  const onScan = useCallback(async (code) => {
    setScanning(false);
    try {
      const {data} = await warehouseApi.lookup(String(code || '').trim());
      if (data.kind !== 'room') {
        return Alert.alert('Это не кабинет', 'Отсканируйте QR с двери.');
      }
      const busy = busyRooms.get(data.room.id);
      return busy ? openExisting(busy) : setRoomId(data.room.id);
    } catch {
      return Alert.alert('Не найдено', 'По этому коду кабинета нет.');
    }
  }, [busyRooms, navigation]); // eslint-disable-line react-hooks/exhaustive-deps

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      // Один код держится в кадре секундами, а обработчик у vision-camera
      // живёт дольше кадра: без отметки запрос улетал бы на каждый
      // распознанный кадр, пока камера не успела закрыться.
      const value = codes?.[0]?.value;
      if (!value || scanBusy.current) return;
      scanBusy.current = true;
      onScan(value).finally(() => { scanBusy.current = false; });
    },
  });

  const start = async () => {
    if (!roomId) return;
    setStarting(true);
    try {
      const {data} = await warehouseApi.createInventory({
        roomId,
        basis: basis.trim() || null,
      });
      // Сразу в пересчёт, без возврата в список: опись открывают ровно затем,
      // чтобы начать считать, и лишний экран между этими двумя действиями
      // означал бы только лишнее нажатие.
      navigation.replace('WarehouseInventoryCount', {sessionId: data.session.id});
    } catch (e) {
      Alert.alert('Опись не открылась', e?.response?.data?.error || 'Попробуйте ещё раз.');
      setStarting(false);
    }
  };

  if (loading) return <LogoLoader />;

  const selected = rooms.find(r => r.id === roomId);

  return (
    <View style={styles.root}>
      <View style={styles.tools}>
        <View style={styles.search}>
          <Search size={15} color={c.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Кабинет"
            placeholderTextColor={c.textTertiary}
            autoCorrect={false}
          />
        </View>
        <Pressable style={styles.scanChip} onPress={() => setScanning(true)} hitSlop={6}>
          <ScanLine size={18} color={c.primary} />
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.key}
        contentContainerStyle={{paddingHorizontal: 16, paddingBottom: insets.bottom + (roomId ? 160 : 24)}}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.none}>Ничего не нашлось</Text>}
        renderItem={({item}) => {
          if (item.type === 'mc') return <Text style={styles.mc}>{item.title}</Text>;
          if (item.type === 'group') return <Text style={styles.group}>{item.title}</Text>;

          const busy = busyRooms.get(item.room.id);
          const on = item.room.id === roomId;
          return (
            <Pressable
              style={[styles.row, on && styles.rowOn]}
              onPress={() => pick(item.room)}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, on && styles.rowTitleOn]}>
                  Кабинет {item.room.number}
                </Text>
                {Boolean(item.room.name) && (
                  <Text style={[styles.rowSub, on && styles.rowSubOn]} numberOfLines={1}>
                    {item.room.name}
                  </Text>
                )}
              </View>
              {Boolean(busy) && (
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{busy.number}</Text>
                </View>
              )}
            </Pressable>
          );
        }}
      />

      {Boolean(selected) && (
        <View style={[styles.bar, {paddingBottom: insets.bottom + 12}]}>
          <TextInput
            style={styles.basis}
            value={basis}
            onChangeText={setBasis}
            placeholder="Основание — необязательно"
            placeholderTextColor={c.textTertiary}
          />
          <Pressable
            style={[styles.button, starting && styles.buttonOff]}
            disabled={starting}
            onPress={start}>
            <ClipboardCheck size={17} color="#FFFFFF" />
            <Text style={styles.buttonText}>
              {starting ? 'Открываю…' : `Считать каб. ${selected.number}`}
            </Text>
          </Pressable>
        </View>
      )}

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={styles.camera}>
          {Boolean(device) && (
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={scanning}
              codeScanner={codeScanner}
            />
          )}
          <Pressable
            style={[styles.cameraClose, {top: insets.top + 8}]}
            onPress={() => setScanning(false)}
            hitSlop={10}>
            <X size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.frame} pointerEvents="none" />
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  tools: {flexDirection: 'row', alignItems: 'center', gap: 8, margin: 16, marginBottom: 10},
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: {flex: 1, color: c.textPrimary, fontFamily: font.regular, fontSize: 14},
  scanChip: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mc: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary, marginTop: 18, marginBottom: 4},
  group: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary, marginTop: 8, marginBottom: 4},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 6,
  },
  rowOn: {backgroundColor: c.primary},
  rowText: {flex: 1},
  rowTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  rowTitleOn: {color: '#FFFFFF'},
  rowSub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  rowSubOn: {color: 'rgba(255,255,255,0.8)'},
  // Номер идущей описи вместо слов: он же напечатан в шапке пересчёта, и по
  // нему видно, что нажатие откроет уже существующую опись, а не заведёт новую.
  chip: {
    paddingHorizontal: 9,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {fontFamily: font.medium, fontSize: 11, color: c.textSecondary},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', marginTop: 40},
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: c.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  basis: {
    height: 44,
    borderRadius: radius.md,
    backgroundColor: c.bgPrimary,
    paddingHorizontal: 12,
    color: c.textPrimary,
    fontFamily: font.regular,
    fontSize: 14,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: c.primary,
  },
  buttonOff: {opacity: 0.5},
  buttonText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
  camera: {flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center'},
  cameraClose: {
    position: 'absolute',
    left: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  frame: {
    width: 240,
    height: 240,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
});
