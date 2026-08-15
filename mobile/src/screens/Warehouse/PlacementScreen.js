/**
 * Размещение имущества ведомости по кабинетам — с телефона.
 *
 * ── Почему это мобильная работа по природе ───────────────────────────────────
 *
 * Ветка 1С («Кабинет Хирурга») не отвечает на вопрос, где вещь стоит: под ней
 * лежит имущество пяти-шести физических кабинетов, а строка «Стул СТ 6, 3 шт» —
 * это три стула в трёх разных местах. Ответа нет ни в файле, ни в голове у того,
 * кто сидит за компьютером: его знает только человек, стоящий в кабинете и
 * видящий, что там есть.
 *
 * Поэтому здесь работа устроена так же, как в вебе, но начинается с двери:
 * отсканировал QR на кабинете — и дальше отмечаешь то, что видишь вокруг.
 * Кабинет выбирается один раз, позиции набрасываются пачкой.
 *
 * ── Почему количество можно не вводить ───────────────────────────────────────
 *
 * В девяти случаях из десяти позиция целиком лежит там, где на неё смотрят.
 * Пустое поле означает «весь нераспределённый остаток», и это снимает ввод
 * цифры с большинства строк.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, Alert, Modal,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Camera, useCameraDevice, useCodeScanner} from 'react-native-vision-camera';
import {DoorOpen, ScanLine, Search, X, Check} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {qtyText, moneyText} from './warehouseMeta';

function flattenRooms(tree) {
  const out = [];
  for (const mc of tree?.medCenters || []) {
    for (const b of mc.buildings || []) {
      for (const f of b.floors || []) {
        for (const r of f.rooms || []) {
          out.push({
            id: r.id,
            hasStorage: Boolean((r.storages || []).length),
            label: `Каб. ${r.number}${r.name && r.name !== r.number ? ` — ${r.name}` : ''}`,
            where: `${b.name} · ${f.number} эт.`,
          });
        }
      }
    }
  }
  return out;
}

export default function WarehousePlacementScreen() {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  // Место под нижнюю кнопку «Положить сюда»: она лежит поверх списка, и без
  // запаса последняя позиция оказывалась бы под ней.
  const listStyle = {paddingHorizontal: 12, paddingBottom: insets.bottom + 90};

  const [rooms, setRooms] = useState([]);
  const [queue, setQueue] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [picked, setPicked] = useState(new Map());
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState(null);

  const room = rooms.find(r => r.id === roomId);

  const load = useCallback(async () => {
    try {
      const [treeResult, queueResult] = await Promise.all([
        warehouseApi.tree(),
        warehouseApi.placementQueue({limit: 200, mode: 'all'}),
      ]);
      setRooms(flattenRooms(treeResult.data));
      setQueue(queueResult.data);
    } catch {
      setQueue(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = (item) => {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(item.lineKey)) next.delete(item.lineKey);
      else next.set(item.lineKey, '');
      return next;
    });
  };

  const send = async () => {
    if (!roomId) return Alert.alert('Кабинет не выбран', 'Сначала выберите кабинет — или отсканируйте QR на его двери.');
    if (!picked.size) return;
    setSending(true);
    try {
      const {data} = await warehouseApi.placeItems({
        roomId,
        items: [...picked.entries()].map(([lineKey, quantity]) => ({
          lineKey, quantity: quantity === '' ? null : Number(quantity),
        })),
      });
      setPicked(new Map());
      await load();
      if (data.rejected?.length) {
        Alert.alert(
          'Размещено с оговорками',
          `Разложено позиций: ${data.saved}. Пропущено ${data.rejected.length}: ${data.rejected[0].reason}`,
        );
      }
    } catch (e) {
      Alert.alert('Не размещено', e?.response?.data?.error || 'Попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  };

  const items = useMemo(() => {
    const list = queue?.items || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(i => i.name.toLowerCase().includes(needle)
      || String(i.pathText || '').toLowerCase().includes(needle));
  }, [queue, q]);

  if (loading) return <LogoLoader />;

  if (!queue?.import) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Нет принятого снимка ведомости. Загрузите его в веб-версии на вкладке
          «Ведомость 1С».
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Pressable style={styles.roomBar} onPress={() => setPicker('list')}>
        <DoorOpen size={18} color={c.primary} />
        <View style={styles.roomText}>
          <Text style={styles.roomName}>{room ? room.label : 'Выберите кабинет'}</Text>
          <Text style={styles.roomWhere}>
            {room ? room.where : 'или отсканируйте QR на двери'}
          </Text>
        </View>
        <Pressable
          style={styles.scanChip}
          onPress={() => setPicker('scan')}
          hitSlop={8}>
          <ScanLine size={16} color={c.primary} />
        </Pressable>
      </Pressable>

      <View style={styles.search}>
        <Search size={15} color={c.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Что перед вами? Название или ветка"
          placeholderTextColor={c.textTertiary}
        />
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.lineKey}
        contentContainerStyle={listStyle}
        keyboardShouldPersistTaps="handled"
        renderItem={({item}) => {
          const checked = picked.has(item.lineKey);
          return (
            <Pressable
              style={[styles.item, checked && styles.itemOn]}
              onPress={() => toggle(item)}>
              <View style={[styles.check, checked && styles.checkOn]}>
                {checked && <Check size={13} color="#FFFFFF" />}
              </View>
              <View style={styles.itemText}>
                <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.itemMeta}>
                  осталось {qtyText(item.unplacedQty)} {item.unit}
                  {item.unitCost ? ` · ${moneyText(item.unitCost)} за ед.` : ''}
                </Text>
                {Boolean(item.branchRoomId) && (
                  <Text style={styles.itemBranch}>
                    сейчас числится по ветке — разложите как есть на самом деле
                  </Text>
                )}
              </View>
              {checked && (
                <TextInput
                  style={styles.qty}
                  value={picked.get(item.lineKey)}
                  onChangeText={value => setPicked((prev) => {
                    const next = new Map(prev);
                    next.set(item.lineKey, value);
                    return next;
                  })}
                  placeholder={qtyText(item.unplacedQty)}
                  placeholderTextColor={c.textTertiary}
                  keyboardType="numeric"
                />
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.none}>
            {q ? 'Ничего не нашлось' : 'Всё имущество ведомости уже разложено по кабинетам.'}
          </Text>
        }
      />

      {picked.size > 0 && (
        <View style={[styles.bottom, {paddingBottom: insets.bottom + 10}]}>
          <Pressable
            style={[styles.send, (!roomId || sending) && styles.sendOff]}
            disabled={!roomId || sending}
            onPress={send}>
            <Text style={styles.sendText}>
              {sending
                ? 'Размещаю…'
                : `Положить в ${room ? room.label.toLowerCase() : 'кабинет'} · ${picked.size}`}
            </Text>
          </Pressable>
        </View>
      )}

      {picker === 'list' && (
        <RoomPicker
          rooms={rooms}
          styles={styles}
          c={c}
          onClose={() => setPicker(null)}
          onPick={(id) => { setRoomId(id); setPicker(null); }}
        />
      )}

      {picker === 'scan' && (
        <RoomScanner
          styles={styles}
          onClose={() => setPicker(null)}
          onFound={(id) => { setRoomId(id); setPicker(null); }}
        />
      )}
    </View>
  );
}

/** Выбор кабинета списком: кабинетов около сотни, поэтому с поиском. */
function RoomPicker({rooms, styles, c, onClose, onPick}) {
  const [q, setQ] = useState('');
  const list = rooms.filter(r => !q
    || r.label.toLowerCase().includes(q.toLowerCase())
    || r.where.toLowerCase().includes(q.toLowerCase()));

  return (
    <Modal animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.modalHead}>
          <Text style={styles.modalTitle}>Кабинет</Text>
          <Pressable onPress={onClose} hitSlop={10}><X size={22} color={c.textPrimary} /></Pressable>
        </View>
        <View style={styles.search}>
          <Search size={15} color={c.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Номер или корпус"
            placeholderTextColor={c.textTertiary}
            autoFocus
          />
        </View>
        <FlatList
          data={list}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.pickList}
          keyboardShouldPersistTaps="handled"
          renderItem={({item}) => (
            <Pressable
              style={[styles.pickRow, !item.hasStorage && styles.pickRowOff]}
              disabled={!item.hasStorage}
              onPress={() => onPick(item.id)}>
              <View style={styles.itemText}>
                <Text style={styles.itemName}>{item.label}</Text>
                <Text style={styles.itemMeta}>
                  {item.where}
                  {!item.hasStorage && ' · нет мест хранения'}
                </Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

/**
 * Выбор кабинета сканированием QR с двери.
 *
 * Публичная ссылка кабинета разбирается тем же /assets/lookup, что и этикетка
 * актива: сервер сам различает, что отсканировали.
 */
function RoomScanner({styles, onClose, onFound}) {
  const device = useCameraDevice('back');
  const busy = React.useRef(false);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: async (codes) => {
      const value = codes?.[0]?.value;
      if (!value || busy.current) return;
      busy.current = true;
      try {
        const {data} = await warehouseApi.lookup(value);
        if (data.kind === 'room') onFound(data.room.id);
        else if (data.kind === 'asset' && data.asset.room) onFound(data.asset.room.id);
        else {
          Alert.alert('Это не кабинет', 'Отсканируйте QR с двери кабинета.');
          busy.current = false;
        }
      } catch {
        Alert.alert('Не распознано', 'По этому коду кабинет не нашёлся.');
        busy.current = false;
      }
    },
  });

  return (
    <Modal animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.scanModal}>
        {device && (
          <Camera style={StyleSheet.absoluteFill} device={device} isActive codeScanner={codeScanner} />
        )}
        <View style={styles.scanHint} pointerEvents="none">
          <Text style={styles.scanHintText}>QR на двери кабинета</Text>
        </View>
        <Pressable style={styles.scanClose} onPress={onClose} hitSlop={10}>
          <X size={22} color="#FFFFFF" />
        </Pressable>
      </View>
    </Modal>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  roomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    margin: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
  },
  roomText: {flex: 1},
  roomName: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  roomWhere: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  scanChip: {
    width: 38, height: 38, borderRadius: radius.md,
    backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: c.bgPrimary,
  },
  searchInput: {flex: 1, color: c.textPrimary, fontFamily: font.regular, fontSize: 14, padding: 0},
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
  },
  itemOn: {backgroundColor: c.primaryLight},
  check: {
    width: 22, height: 22, borderRadius: 7,
    borderWidth: 1, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: {backgroundColor: c.primary, borderColor: c.primary},
  itemText: {flex: 1},
  itemName: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary, lineHeight: 18},
  itemMeta: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 2},
  itemBranch: {fontFamily: font.regular, fontSize: 11, color: c.warning, marginTop: 2},
  qty: {
    width: 56, height: 36, borderRadius: radius.sm,
    backgroundColor: c.bgPrimary, textAlign: 'center',
    color: c.textPrimary, fontFamily: font.semiBold, fontSize: 14, padding: 0,
  },
  bottom: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: c.bgPrimary,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
  },
  send: {
    height: 48, borderRadius: radius.md, backgroundColor: c.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendOff: {opacity: 0.5},
  sendText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', padding: 24, lineHeight: 19},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: c.bgSecondary},
  emptyText: {fontFamily: font.regular, fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20},
  modal: {flex: 1, backgroundColor: c.bgSecondary, paddingTop: 52},
  modalHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
  },
  modalTitle: {fontFamily: font.semiBold, fontSize: 18, color: c.textPrimary},
  pickList: {padding: 12},
  pickRow: {
    backgroundColor: c.bgPrimary, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8,
  },
  pickRowOff: {opacity: 0.45},
  scanModal: {flex: 1, backgroundColor: '#000000'},
  scanHint: {position: 'absolute', left: 0, right: 0, bottom: 60, alignItems: 'center'},
  scanHintText: {fontFamily: font.regular, fontSize: 14, color: 'rgba(255,255,255,0.85)'},
  scanClose: {
    position: 'absolute', top: 52, left: 16,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
});
