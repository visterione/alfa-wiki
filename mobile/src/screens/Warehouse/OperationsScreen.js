/**
 * Операции: журнал документов и проведение новых.
 *
 * ── Что такое операция ───────────────────────────────────────────────────────
 *
 * Любое движение имущества оформляется документом: приём, выдача, перемещение,
 * списание. Это не формальность — на журнале держится весь учёт, и остаток без
 * документа означал бы, что склад разошёлся с историей молча.
 *
 * ── Что здесь можно, а что нет ───────────────────────────────────────────────
 *
 * Проводятся четыре типа, которые делают на ногах: выдал, принял, переместил,
 * списал. Ремонт (repair_out/repair_in), возвраты и оприходование излишков
 * остались в вебе — они привязаны к нарядам и описям, и оформлять их надо там,
 * где эти наряды видно.
 *
 * Строк в документе может быть несколько, но набираются они по одной: список
 * позиций на телефоне не влезает таблицей, а «добавить и повторить» — ровно тот
 * ритм, в котором человек снимает вещи с полки.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, Alert, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Plus, Search, X, Check, Trash2, ChevronRight} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {loadLocationTree, useWarehouseCan} from '../../store/warehouseStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {qtyText, dateText, roomText, flattenRooms} from './warehouseMeta';

/**
 * Типы, доступные с телефона.
 *
 * `to` — нужен ли документу приёмник (куда кладём), `from` — источник (откуда
 * берём). От этого зависит, о каком кабинете спрашивать: у выдачи и списания
 * источник, у приёма приёмник, у перемещения оба.
 */
const TYPES = [
  {key: 'issue', label: 'Выдача', from: true, to: false},
  {key: 'receipt', label: 'Приём', from: false, to: true},
  {key: 'transfer', label: 'Перемещение', from: true, to: true},
  {key: 'writeoff', label: 'Списание', from: true, to: false},
];

const TYPE_LABELS = {
  receipt: 'Приём', issue: 'Выдача', transfer: 'Перемещение', return: 'Возврат',
  writeoff: 'Списание', repair_out: 'В ремонт', repair_in: 'Из ремонта',
  surplus: 'Оприходование излишков', inventory: 'Инвентаризация',
};

const num = value => Number(String(value ?? '').replace(',', '.')) || 0;

export default function WarehouseOperationsScreen() {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const tabInset = useTabBarInset();
  const canIssue = useWarehouseCan('canIssue');

  const [documents, setDocuments] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [form, setForm] = useState(null);

  const load = useCallback(() => warehouseApi.documents({
    limit: 50,
    ...(typeFilter ? {type: typeFilter} : {}),
  })
    .then(({data}) => setDocuments(data?.items || []))
    .catch(() => setDocuments([])), [typeFilter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!documents) return <LogoLoader />;

  return (
    <View style={styles.root}>
      <View style={styles.filters}>
        <Pressable
          style={[styles.chip, !typeFilter && styles.chipOn]}
          onPress={() => setTypeFilter('')}>
          <Text style={[styles.chipText, !typeFilter && styles.chipTextOn]}>Все</Text>
        </Pressable>
        {TYPES.map(type => (
          <Pressable
            key={type.key}
            style={[styles.chip, typeFilter === type.key && styles.chipOn]}
            onPress={() => setTypeFilter(type.key)}>
            <Text style={[styles.chipText, typeFilter === type.key && styles.chipTextOn]}>
              {type.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={documents}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, {paddingBottom: tabInset + (canIssue ? 90 : 24)}]}
        ListEmptyComponent={<Text style={styles.none}>Документов нет</Text>}
        renderItem={({item}) => (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>
                {TYPE_LABELS[item.type] || item.type} · {item.number}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {[
                  dateText(item.date),
                  item.fromRoom && `из ${roomText(item.fromRoom)}`,
                  item.toRoom && `в ${roomText(item.toRoom)}`,
                  item.author?.displayName,
                ].filter(Boolean).join(' · ')}
              </Text>
              {Boolean(item.reasonText) && (
                <Text style={styles.rowNote} numberOfLines={1}>{item.reasonText}</Text>
              )}
            </View>
          </View>
        )}
      />

      {canIssue && (
        <View style={[styles.bar, {paddingBottom: insets.bottom + 12}]}>
          <Pressable style={styles.button} onPress={() => setForm({type: 'issue'})}>
            <Plus size={17} color="#FFFFFF" />
            <Text style={styles.buttonText}>Новая операция</Text>
          </Pressable>
        </View>
      )}

      {Boolean(form) && (
        <DocumentForm
          styles={styles}
          c={c}
          insets={insets}
          onClose={() => setForm(null)}
          onDone={() => { setForm(null); load(); }}
        />
      )}
    </View>
  );
}

/**
 * Форма документа.
 *
 * Собирается в три приёма: тип → места → строки. Порядок не произволен: от типа
 * зависит, о каких местах спрашивать, а от места — что вообще можно положить в
 * строку (у выдачи и списания выбирать приходится из того, что лежит на полке,
 * а не из всего справочника).
 */
function DocumentForm({styles, c, insets, onClose, onDone}) {
  const [type, setType] = useState('issue');
  const [rooms, setRooms] = useState(null);
  const [fromRoomId, setFromRoomId] = useState(null);
  const [toRoomId, setToRoomId] = useState(null);
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState('');
  const [picker, setPicker] = useState(null);
  const [sending, setSending] = useState(false);

  const config = TYPES.find(t => t.key === type);

  useFocusEffect(useCallback(() => {
    let alive = true;
    loadLocationTree().then(tree => alive && setRooms(flattenRooms(tree)));
    return () => { alive = false; };
  }, []));

  const fromRoom = rooms?.find(r => r.id === fromRoomId);
  const toRoom = rooms?.find(r => r.id === toRoomId);

  const post = async () => {
    if (!lines.length) return Alert.alert('Не проведено', 'Добавьте хотя бы одну позицию.');
    if (config.from && !fromRoomId) return Alert.alert('Не проведено', 'Выберите, откуда.');
    if (config.to && !toRoomId) return Alert.alert('Не проведено', 'Выберите, куда.');

    setSending(true);
    try {
      await warehouseApi.createDocument({
        type,
        reasonText: reason.trim() || null,
        fromRoomId: config.from ? fromRoomId : null,
        toRoomId: config.to ? toRoomId : null,
        lines: lines.map(line => ({
          ...(line.assetId ? {assetId: line.assetId} : {nomenclatureId: line.nomenclatureId}),
          quantity: line.quantity,
          // Место хранения берём первое в кабинете: требовать выбирать полку на
          // каждую строку — работа без содержания, то же правило в разборе ОСВ.
          ...(config.from ? {fromStorageId: fromRoom?.storages?.[0]?.id} : {}),
          ...(config.to ? {toStorageId: toRoom?.storages?.[0]?.id} : {}),
        })),
      });
      return onDone();
    } catch (e) {
      Alert.alert('Не проведено', e?.response?.data?.error || 'Проверьте документ.');
      return setSending(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modalHead, {paddingTop: insets.top + 12}]}>
          <Text style={styles.modalTitle}>Новая операция</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <X size={22} color={c.textPrimary} />
          </Pressable>
        </View>

        {!rooms ? <LogoLoader /> : (
          <FlatList
            data={lines}
            keyExtractor={(item, at) => `${item.key}-${at}`}
            contentContainerStyle={{paddingHorizontal: 16, paddingBottom: insets.bottom + 90}}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View>
                <View style={styles.filters}>
                  {TYPES.map(item => (
                    <Pressable
                      key={item.key}
                      style={[styles.chip, type === item.key && styles.chipOn]}
                      onPress={() => { setType(item.key); setLines([]); }}>
                      <Text style={[styles.chipText, type === item.key && styles.chipTextOn]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {config.from && (
                  <Pressable style={styles.pick} onPress={() => setPicker('from')}>
                    <Text style={styles.pickLabel}>Откуда</Text>
                    <Text style={[styles.pickValue, !fromRoom && styles.pickEmpty]} numberOfLines={1}>
                      {fromRoom ? fromRoom.label : 'Выберите кабинет'}
                    </Text>
                    <ChevronRight size={16} color={c.textTertiary} />
                  </Pressable>
                )}

                {config.to && (
                  <Pressable style={styles.pick} onPress={() => setPicker('to')}>
                    <Text style={styles.pickLabel}>Куда</Text>
                    <Text style={[styles.pickValue, !toRoom && styles.pickEmpty]} numberOfLines={1}>
                      {toRoom ? toRoom.label : 'Выберите кабинет'}
                    </Text>
                    <ChevronRight size={16} color={c.textTertiary} />
                  </Pressable>
                )}

                <Pressable
                  style={styles.add}
                  disabled={config.from && !fromRoomId}
                  onPress={() => setPicker('line')}>
                  <Plus size={16} color={config.from && !fromRoomId ? c.textTertiary : c.primary} />
                  <Text
                    style={[
                      styles.addText,
                      config.from && !fromRoomId && styles.addTextOff,
                    ]}>
                    {config.from && !fromRoomId ? 'Сначала выберите кабинет' : 'Добавить позицию'}
                  </Text>
                </Pressable>
              </View>
            }
            renderItem={({item, index}) => (
              <View style={styles.line}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.rowSub}>
                    {qtyText(item.quantity)} {item.unit || 'шт'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setLines(prev => prev.filter((_, at) => at !== index))}
                  hitSlop={10}>
                  <Trash2 size={16} color={c.error} />
                </Pressable>
              </View>
            )}
            ListFooterComponent={
              <TextInput
                style={styles.reason}
                value={reason}
                onChangeText={setReason}
                placeholder="Основание — необязательно"
                placeholderTextColor={c.textTertiary}
              />
            }
          />
        )}

        <View style={[styles.bar, {paddingBottom: insets.bottom + 12}]}>
          <Pressable
            style={[styles.button, sending && styles.buttonOff]}
            disabled={sending}
            onPress={post}>
            {sending
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Check size={17} color="#FFFFFF" />}
            <Text style={styles.buttonText}>{sending ? 'Провожу…' : 'Провести'}</Text>
          </Pressable>
        </View>

        {(picker === 'from' || picker === 'to') && (
          <RoomPicker
            styles={styles}
            c={c}
            insets={insets}
            rooms={rooms}
            onClose={() => setPicker(null)}
            onPick={(id) => {
              if (picker === 'from') { setFromRoomId(id); setLines([]); } else setToRoomId(id);
              setPicker(null);
            }}
          />
        )}

        {picker === 'line' && (
          <LinePicker
            styles={styles}
            c={c}
            insets={insets}
            roomId={fromRoomId}
            // У приёма источника нет: класть можно что угодно из справочника,
            // а не только то, что уже где-то лежит
            fromStock={Boolean(config.from)}
            onClose={() => setPicker(null)}
            onPick={(line) => { setLines(prev => [...prev, line]); setPicker(null); }}
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Выбор кабинета — тот же плоский список с поиском, что в размещении. */
function RoomPicker({styles, c, insets, rooms, onClose, onPick}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = rooms.filter(room => room.hasStorage && (!needle
    || room.label.toLowerCase().includes(needle)
    || room.where.toLowerCase().includes(needle)));

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={[styles.modalHead, {paddingTop: insets.top + 12}]}>
          <Text style={styles.modalTitle}>Кабинет</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <X size={22} color={c.textPrimary} />
          </Pressable>
        </View>
        <View style={styles.search}>
          <Search size={15} color={c.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Номер или корпус"
            placeholderTextColor={c.textTertiary}
          />
        </View>
        <FlatList
          data={list}
          keyExtractor={item => item.id}
          contentContainerStyle={{paddingHorizontal: 16, paddingBottom: insets.bottom + 24}}
          keyboardShouldPersistTaps="handled"
          renderItem={({item}) => (
            <Pressable style={styles.line} onPress={() => onPick(item.id)}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{item.label}</Text>
                <Text style={styles.rowSub}>{item.where}</Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

/**
 * Выбор позиции в строку документа.
 *
 * Откуда берётся список — зависит от типа. Выдача, перемещение и списание берут
 * из того, что реально лежит в кабинете-источнике: предложить списать то, чего
 * там нет, значит получить отказ сервера уже после набора всего документа.
 * Приём берёт из справочника — кладут как раз то, чего ещё нет.
 */
function LinePicker({styles, c, insets, roomId, fromStock, onClose, onPick}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [quantity, setQuantity] = useState('1');

  useFocusEffect(useCallback(() => {
    let alive = true;
    const request = fromStock
      ? Promise.all([
        warehouseApi.stock({roomId, includeZero: 'false'}),
        warehouseApi.assets({roomId, limit: 200}),
      ]).then(([stock, assets]) => [
        ...(Array.isArray(stock.data) ? stock.data : []).map(row => ({
          key: `s-${row.id}`,
          nomenclatureId: row.nomenclature?.id,
          name: row.nomenclature?.name,
          unit: row.nomenclature?.unit,
          available: Number(row.quantity),
        })),
        ...((assets.data?.items) || []).map(asset => ({
          key: `a-${asset.id}`,
          assetId: asset.id,
          name: `${asset.inventoryNumber} · ${asset.name}`,
          unit: 'шт',
          available: 1,
        })),
      ])
      : warehouseApi.nomenclature({limit: 300}).then(({data}) => (data?.items || []).map(row => ({
        key: `n-${row.id}`,
        nomenclatureId: row.id,
        name: row.name,
        unit: row.unit,
        available: null,
      })));

    request.then(list => alive && setRows(list)).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [roomId, fromStock]));

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter(row => !needle || String(row.name || '').toLowerCase().includes(needle));
  }, [rows, q]);

  const confirm = () => {
    const value = num(quantity);
    if (!(value > 0)) return Alert.alert('Не добавлено', 'Количество должно быть больше нуля.');
    // Оборудование всегда одной единицей: у карточки инвентарный номер, и
    // «две штуки одной карточки» не бывает
    return onPick({...chosen, quantity: chosen.assetId ? 1 : value});
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={[styles.modalHead, {paddingTop: insets.top + 12}]}>
          <Text style={styles.modalTitle}>{chosen ? 'Количество' : 'Позиция'}</Text>
          <Pressable onPress={chosen ? () => setChosen(null) : onClose} hitSlop={10}>
            <X size={22} color={c.textPrimary} />
          </Pressable>
        </View>

        {chosen ? (
          <View style={styles.qtyWrap}>
            <Text style={styles.qtyName}>{chosen.name}</Text>
            {chosen.available !== null && (
              <Text style={styles.rowSub}>
                Доступно: {qtyText(chosen.available)} {chosen.unit || ''}
              </Text>
            )}
            {!chosen.assetId && (
              <TextInput
                style={styles.qtyInput}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="numeric"
                autoFocus
              />
            )}
            <Pressable style={styles.button} onPress={confirm}>
              <Check size={17} color="#FFFFFF" />
              <Text style={styles.buttonText}>Добавить</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.search}>
              <Search size={15} color={c.textTertiary} />
              <TextInput
                style={styles.searchInput}
                value={q}
                onChangeText={setQ}
                placeholder="Наименование"
                placeholderTextColor={c.textTertiary}
              />
            </View>
            {!rows ? <LogoLoader /> : (
              <FlatList
                data={list}
                keyExtractor={item => item.key}
                contentContainerStyle={{paddingHorizontal: 16, paddingBottom: insets.bottom + 24}}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<Text style={styles.none}>Ничего не нашлось</Text>}
                renderItem={({item}) => (
                  <Pressable
                    style={styles.line}
                    onPress={() => { setChosen(item); setQuantity('1'); }}>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={2}>{item.name}</Text>
                      {item.available !== null && (
                        <Text style={styles.rowSub}>
                          {qtyText(item.available)} {item.unit || ''}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                )}
              />
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  filters: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 16, paddingVertical: 12},
  chip: {
    paddingHorizontal: 11,
    height: 30,
    borderRadius: 15,
    backgroundColor: c.bgPrimary,
    justifyContent: 'center',
  },
  chipOn: {backgroundColor: c.primary},
  chipText: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary},
  chipTextOn: {color: '#FFFFFF'},
  list: {paddingHorizontal: 16},
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
  rowText: {flex: 1},
  rowTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary, lineHeight: 19},
  rowSub: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 2},
  rowNote: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary, marginTop: 1},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', marginTop: 30},

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: c.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
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

  modalRoot: {flex: 1, backgroundColor: c.bgSecondary},
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  modalTitle: {fontFamily: font.semiBold, fontSize: 18, color: c.textPrimary},
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 42,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  searchInput: {flex: 1, color: c.textPrimary, fontFamily: font.regular, fontSize: 14},
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  pickLabel: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, width: 60},
  pickValue: {flex: 1, fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  pickEmpty: {color: c.textTertiary},
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    marginBottom: 6,
  },
  addText: {fontFamily: font.medium, fontSize: 14, color: c.primary},
  addTextOff: {color: c.textTertiary},
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 6,
  },
  reason: {
    height: 44,
    borderRadius: radius.md,
    backgroundColor: c.bgPrimary,
    paddingHorizontal: 12,
    marginTop: 6,
    color: c.textPrimary,
    fontFamily: font.regular,
    fontSize: 14,
  },
  qtyWrap: {padding: 16, gap: 12},
  qtyName: {fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary},
  qtyInput: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: c.bgPrimary,
    paddingHorizontal: 14,
    color: c.textPrimary,
    fontFamily: font.semiBold,
    fontSize: 18,
  },
});
