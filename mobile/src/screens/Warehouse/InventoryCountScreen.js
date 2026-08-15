/**
 * Пересчёт по описи — то, ради чего складу вообще нужен телефон.
 *
 * ── Почему камера здесь важнее, чем на других экранах ────────────────────────
 *
 * Инвентаризация — это обход помещений: человек стоит перед шкафом и сверяет
 * десятки позиций. В вебе распознавание QR держится на BarcodeDetector, которого
 * нет в Safari, то есть на iPhone его не было вовсе, и оставался ввод
 * инвентарного номера с клавиатуры — по номеру на каждую вещь.
 *
 * ── Почему камера не закрывает экран целиком ─────────────────────────────────
 *
 * Сканирование здесь не самоцель, а способ отметить строку в описи. Человеку
 * нужно видеть, что уже пересчитано и сколько осталось, иначе он не поймёт,
 * когда остановиться. Поэтому кадр занимает верхнюю треть, а под ним живёт
 * список — отсканировал, увидел, как строка позеленела, пошёл дальше.
 *
 * ── Почему закрытие описи не отсюда ──────────────────────────────────────────
 *
 * Закрытие превращает непересчитанные строки в недостачу и оформляется решением
 * комиссии. Нажать такое случайно, держа телефон одной рукой в кабинете, слишком
 * легко, поэтому кнопка осталась в вебе.
 */
import React, {useCallback, useRef, useState} from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, Alert, Vibration,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Camera, useCameraDevice, useCodeScanner} from 'react-native-vision-camera';
import {ScanLine, Search, Check} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {qtyText, INVENTORY_STATUS} from './warehouseMeta';

const itemName = item => (item.asset
  ? `${item.asset.inventoryNumber} · ${item.asset.name}`
  : `${item.nomenclature?.code || ''} · ${item.nomenclature?.name || ''}`);

export default function WarehouseInventoryCountScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const {sessionId} = route.params || {};
  const device = useCameraDevice('back');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState('');
  const [q, setQ] = useState('');
  const [savingId, setSavingId] = useState(null);
  const lastCode = useRef({value: null, at: 0});

  const load = useCallback(() => warehouseApi.inventory(sessionId)
    .then(({data: payload}) => {
      setData(payload);
      navigation.setOptions({title: payload.session.number});
    })
    .catch(() => setData(null))
    .finally(() => setLoading(false)), [sessionId, navigation]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const countCode = useCallback(async (code, method) => {
    const clean = String(code || '').trim();
    if (!clean) return;
    try {
      await warehouseApi.countInventory(sessionId, {
        code: clean, scanMethod: method, actualQty: 1,
      });
      Vibration.vibrate(40);
      setManual('');
      await load();
    } catch (e) {
      Alert.alert('Не отмечено', e?.response?.data?.error || 'Этой позиции нет в описи.');
    }
  }, [sessionId, load]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      const value = codes?.[0]?.value;
      if (!value) return;
      // Один код держится в кадре секундами. Полторы секунды — компромисс: он
      // не даёт отметить одну вещь дважды подряд и при этом позволяет
      // намеренно пересканировать её, если человек засомневался.
      const now = Date.now();
      if (lastCode.current.value === value && now - lastCode.current.at < 1500) return;
      lastCode.current = {value, at: now};
      countCode(value, 'qr');
    },
  });

  const saveQty = async (item, value) => {
    setSavingId(item.id);
    try {
      await warehouseApi.countInventory(sessionId, {
        itemId: item.id, actualQty: Number(value), scanMethod: 'manual',
      });
      await load();
    } catch (e) {
      Alert.alert('Не сохранено', e?.response?.data?.error || 'Проверьте количество.');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <LogoLoader />;
  if (!data) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Опись не открылась.</Text>
      </View>
    );
  }

  const {session, stats} = data;
  const closed = session.status === 'closed' || session.status === 'cancelled';
  const items = (session.items || []).filter(
    item => !q || itemName(item).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <View style={styles.root}>
      {scanning && device && !closed && (
        <View style={styles.camera}>
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive
            codeScanner={codeScanner}
          />
          <View style={styles.cameraHint} pointerEvents="none">
            <Text style={styles.cameraHintText}>
              Наводите на этикетки одну за другой — отмеченное сразу видно в списке
            </Text>
          </View>
        </View>
      )}

      <View style={styles.stats}>
        <Stat styles={styles} value={stats.counted} total={stats.total} label="пересчитано" />
        <Stat styles={styles} value={stats.shortage} label="недостач" tone={c.error} />
        <Stat styles={styles} value={stats.surplus} label="излишков" tone={c.warning} />
      </View>

      {closed ? (
        <View style={styles.closed}>
          <Text style={styles.closedText}>
            Опись {INVENTORY_STATUS[session.status]?.toLowerCase()}. Расхождения
            оформляются в веб-версии.
          </Text>
        </View>
      ) : (
        <View style={styles.tools}>
          <Pressable
            style={[styles.scanBtn, scanning && styles.scanBtnOn]}
            onPress={() => setScanning(v => !v)}>
            <ScanLine size={17} color={scanning ? '#FFFFFF' : c.primary} />
            <Text style={[styles.scanText, scanning && styles.scanTextOn]}>
              {scanning ? 'Убрать камеру' : 'Сканировать'}
            </Text>
          </Pressable>
          <TextInput
            style={styles.input}
            value={manual}
            onChangeText={setManual}
            onSubmitEditing={() => countCode(manual, 'manual')}
            placeholder="Инв. номер"
            placeholderTextColor={c.textTertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
          />
        </View>
      )}

      <View style={styles.search}>
        <Search size={15} color={c.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Поиск по описи"
          placeholderTextColor={c.textTertiary}
        />
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({item}) => (
          <CountRow
            item={item}
            styles={styles}
            c={c}
            editable={!closed}
            saving={savingId === item.id}
            onSave={saveQty}
          />
        )}
        ListEmptyComponent={<Text style={styles.none}>В описи ничего не нашлось</Text>}
      />
    </View>
  );
}

/**
 * Строка описи. Фактическое количество вводится прямо здесь, а не в отдельном
 * окне: у большинства позиций оно совпадает с учётным, и лишний экран на каждую
 * строку превратил бы пересчёт в перелистывание.
 */
function CountRow({item, styles, c, editable, saving, onSave}) {
  const [value, setValue] = useState(item.actualQty ?? '');
  const expected = Number(item.expectedQty);
  const actual = value === '' ? null : Number(value);
  const diff = actual === null ? null : actual - expected;

  return (
    <View style={[
      styles.item,
      diff !== null && diff < 0 && styles.itemShort,
      diff !== null && diff > 0 && styles.itemSurplus,
      diff === 0 && styles.itemOk,
    ]}>
      <View style={styles.itemText}>
        <Text style={styles.itemName} numberOfLines={2}>{itemName(item)}</Text>
        <Text style={styles.itemMeta}>
          по учёту {qtyText(expected)}
          {item.storage?.name ? ` · ${item.storage.name}` : ''}
          {item.scanMethod === 'qr' ? ' · отмечено по QR' : ''}
        </Text>
      </View>
      {editable ? (
        <TextInput
          style={[styles.qtyInput, saving && styles.qtyInputSaving]}
          value={String(value)}
          onChangeText={setValue}
          onBlur={() => value !== '' && Number(value) !== item.actualQty && onSave(item, value)}
          keyboardType="numeric"
          placeholder="—"
          placeholderTextColor={c.textTertiary}
        />
      ) : (
        <Text style={styles.qtyStatic}>{qtyText(item.actualQty || 0)}</Text>
      )}
      {diff === 0 && <Check size={16} color={c.success} />}
    </View>
  );
}

function Stat({styles, value, total, label, tone}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone && {color: tone}]}>
        {total === undefined ? value : `${value}/${total}`}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  // Треть экрана: достаточно, чтобы прицелиться, и достаточно мало, чтобы под
  // кадром помещалось несколько строк описи.
  camera: {height: 220, backgroundColor: '#000000'},
  cameraHint: {position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, backgroundColor: 'rgba(0,0,0,0.45)'},
  cameraHintText: {fontFamily: font.regular, fontSize: 11, color: 'rgba(255,255,255,0.85)', textAlign: 'center'},
  stats: {flexDirection: 'row', gap: 8, padding: 12},
  stat: {flex: 1, backgroundColor: c.bgPrimary, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center'},
  statValue: {fontFamily: font.semiBold, fontSize: 17, color: c.textPrimary},
  statLabel: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 2},
  tools: {flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 10},
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
  },
  scanBtnOn: {backgroundColor: c.primary},
  scanText: {fontFamily: font.medium, fontSize: 13, color: c.primary},
  scanTextOn: {color: '#FFFFFF'},
  input: {
    flex: 1,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: c.bgPrimary,
    paddingHorizontal: 12,
    color: c.textPrimary,
    fontFamily: font.regular,
    fontSize: 14,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: c.bgPrimary,
  },
  searchInput: {flex: 1, color: c.textPrimary, fontFamily: font.regular, fontSize: 14, padding: 0},
  list: {paddingHorizontal: 12, paddingBottom: 24},
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  itemOk: {borderLeftColor: c.success},
  itemShort: {borderLeftColor: c.error},
  itemSurplus: {borderLeftColor: c.warning},
  itemText: {flex: 1},
  itemName: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary, lineHeight: 18},
  itemMeta: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 2},
  qtyInput: {
    width: 60,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: c.bgSecondary,
    textAlign: 'center',
    color: c.textPrimary,
    fontFamily: font.semiBold,
    fontSize: 14,
    padding: 0,
  },
  qtyInputSaving: {opacity: 0.5},
  qtyStatic: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary, width: 60, textAlign: 'center'},
  closed: {marginHorizontal: 12, marginBottom: 10, padding: 12, borderRadius: radius.md, backgroundColor: c.bgTertiary},
  closedText: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, lineHeight: 18},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', padding: 24},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: c.bgSecondary},
  emptyText: {fontFamily: font.regular, fontSize: 14, color: c.textSecondary},
});
