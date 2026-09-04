/**
 * Операция прямо из кабинета: выдать, переместить, списать, принять.
 *
 * ── Почему отдельно от журнала ───────────────────────────────────────────────
 *
 * Форма в OperationsScreen собирается сверху вниз, от документа: тип, дата,
 * откуда, куда, потом позиции. Человек в отделении идёт снизу вверх — он стоит
 * в кабинете и держит вещь в руках, а форма спрашивает у него ровно то, что он
 * и так знает, и спрашивает первым. Здесь кабинет и позиция известны из того,
 * откуда эту форму открыли, и остаётся один настоящий вопрос: сколько.
 *
 * Поэтому и типов здесь четыре, а не восемь. Ремонт заводится с карточки
 * прибора (там же виден его статус), возврат и оприходование излишков привязаны
 * к нарядам и описям и остались в вебе.
 *
 * ── Что не спрашиваем ────────────────────────────────────────────────────────
 *
 * Дату. Документ, проводимый из кабинета, оформляют в ту же минуту — иначе
 * человека в кабинете уже нет; задним числом проводят за компьютером, разбирая
 * бумаги, и там поле осталось. Место хранения: в кабинете их обычно одно, а
 * когда несколько — строка остатка сама знает свою полку, и переспрашивать
 * значит просить подтвердить очевидное.
 *
 * Причина и комментарий спрятаны под «Подробнее» — кроме списания, где раскрыты
 * сразу: списание без объяснения потом не разобрать.
 *
 * ── Два входа ────────────────────────────────────────────────────────────────
 *
 * Со строки списка позиция известна сразу. От кнопки кабинета — нет, и форма
 * начинается с выбора: расход выбирают из того, что в кабинете лежит (дашборд
 * уже привёз эти списки, второй запрос ради них не нужен), приём — из
 * справочника, потому что кладут как раз то, чего здесь ещё нет.
 *
 * Заведение с нуля живёт там же, в приёме (ver. 7.76): «завести оборудование» —
 * это и есть приём вещи, которой в справочнике не было. Отдельными кнопками в
 * кабинете это выглядело как отдельный вид работы, хотя человек в обоих случаях
 * отвечает на один вопрос — «что привезли». С приходом ЭДО ручное заведение
 * станет редкостью, и место у него соответствующее.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, StyleSheet, Alert, Modal, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Check, ChevronDown, ChevronRight, Plus, Search, X} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import GlassCard from '../../components/GlassCard';
import GlassBackdrop from '../../components/GlassBackdrop';
import GlassBar from '../../components/GlassBar';
import BottomSheet from '../../components/BottomSheet';
import {loadLocationTree} from '../../store/warehouseStore';
import {radius, font, glassSurface, glassOverlay, accentShadow, glassLine} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {qtyText, roomText, flattenRooms, matchesSearch} from './warehouseMeta';

/**
 * Что за операция и о чём она спрашивает.
 *
 * `from`/`to` — те же поля документа, что и в вебе, но одну из сторон всегда
 * занимает кабинет, из которого форму открыли: выдача и списание уходят отсюда,
 * приём приходит сюда, перемещение отсюда — туда, где выбирают.
 */
const TYPES = {
  issue: {
    title: 'Выдача',
    action: 'Выдать',
    from: true,
    to: false,
    // Кнопка проведения повторяет действие, а не пишет «Провести»: человек
    // нажимает её, глядя на количество, и подпись должна называть то, что
    // сейчас произойдёт с вещью.
    done: 'Выдать',
  },
  transfer: {title: 'Перемещение', action: 'Переместить', from: true, to: true, done: 'Переместить'},
  writeoff: {title: 'Списание', action: 'Списать', from: true, to: false, done: 'Списать'},
  receipt: {title: 'Приём', action: 'Принять', from: false, to: true, done: 'Принять'},
};

/** Подпись шага выбора: спрашиваем про вещь, а не про «позицию документа». */
const PICK_TITLES = {
  issue: 'Что выдаём',
  transfer: 'Что перемещаем',
  writeoff: 'Что списываем',
};

/**
 * Строка дашборда → позиция операции.
 *
 * Общие функции, потому что одну и ту же строку выбирают двумя путями — кнопкой
 * на ней самой и списком в форме, — и собранная по-разному она означала бы
 * разное: в адрес входят и полка, и партия.
 */
export const stockTarget = item => ({
  nomenclatureId: item.nomenclatureId,
  name: item.name,
  unit: item.unit,
  available: item.quantity,
  storageId: item.storageId,
  batchId: item.batchId,
  note: [
    item.storageName,
    item.batchNumber && `партия ${item.batchNumber}`,
    item.expiryDate && `до ${new Date(item.expiryDate).toLocaleDateString('ru-RU')}`,
  ].filter(Boolean).join(' · '),
});

export const assetTarget = asset => ({
  assetId: asset.id,
  name: asset.name,
  note: asset.inventoryNumber,
});

const num = value => Number(String(value ?? '').replace(',', '.')) || 0;

export default function RoomOperation({
  room, type, target: initialTarget, stock = [], assets = [],
  canCreate, onCreateItem, onClose, onDone,
}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const config = TYPES[type];

  // Позиция известна не всегда: выдачу и списание открывают со строки списка, а
  // приём — с кнопки кабинета, и что именно привезли, ещё предстоит найти.
  const [target, setTarget] = useState(initialTarget || null);
  const [quantity, setQuantity] = useState('1');
  const [toRoomId, setToRoomId] = useState(null);
  const [unitCost, setUnitCost] = useState('');
  const [contractorId, setContractorId] = useState(null);
  const [contractors, setContractors] = useState([]);
  const [reasonText, setReasonText] = useState('');
  const [comment, setComment] = useState('');
  const [details, setDetails] = useState(type === 'writeoff');
  const [rooms, setRooms] = useState(null);
  const [picker, setPicker] = useState(null);
  const [sending, setSending] = useState(false);

  const isAsset = Boolean(target?.assetId);

  useFocusEffect(useCallback(() => {
    let alive = true;
    // Дерево локаций нужно только перемещению — ради кабинета назначения и его
    // полки. Остальным трём хватает мест хранения самого кабинета, они приезжают
    // с дашбордом.
    if (config.to && type === 'transfer') {
      loadLocationTree().then(tree => alive && setRooms(flattenRooms(tree)));
    }
    if (type === 'receipt') {
      warehouseApi.contractors()
        .then(({data}) => alive && setContractors(data || []))
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [config.to, type]));

  const toRoom = rooms?.find(r => r.id === toRoomId);

  // Полка кабинета: у строки остатка она своя (кабинет может держать материал в
  // нескольких местах), у приёма и оборудования берётся первая — выбирать её
  // руками значит задавать вопрос, на который в 99 кабинетах один ответ.
  const roomStorageId = room.storages?.[0]?.id || null;
  const fromStorageId = target?.storageId || roomStorageId;

  const available = target && target.available != null ? Number(target.available) : null;

  const post = async () => {
    const qty = isAsset ? 1 : num(quantity);
    if (!(qty > 0)) return Alert.alert('Не проведено', 'Количество должно быть больше нуля.');
    if (available != null && qty > available) {
      return Alert.alert(
        'Не проведено',
        `В кабинете ${qtyText(available)} ${target.unit || ''} — больше взять неоткуда.`,
      );
    }
    if (type === 'transfer' && !toRoomId) {
      return Alert.alert('Не проведено', 'Выберите кабинет, куда перемещаем.');
    }
    if (config.from && !isAsset && !fromStorageId) {
      return Alert.alert('Не проведено', 'В кабинете нет места хранения — операция невозможна.');
    }

    const toStorageId = type === 'transfer' ? toRoom?.storages?.[0]?.id : roomStorageId;
    if (config.to && !toStorageId) {
      return Alert.alert(
        'Не проведено',
        type === 'transfer'
          ? 'В кабинете назначения нет места хранения — положить туда нечего.'
          : 'В кабинете нет места хранения — положить некуда.',
      );
    }

    setSending(true);
    try {
      await warehouseApi.createDocument({
        type,
        reasonText: reasonText.trim() || null,
        comment: comment.trim() || null,
        contractorId: type === 'receipt' ? contractorId : null,
        fromRoomId: config.from ? room.id : null,
        toRoomId: config.to ? (type === 'transfer' ? toRoomId : room.id) : null,
        lines: [{
          ...(isAsset ? {assetId: target.assetId} : {nomenclatureId: target.nomenclatureId}),
          quantity: qty,
          // Партия адресуется точно: строка списка — это конкретный остаток на
          // конкретной полке, включая «без партии». Без exactBatch сервер
          // подобрал бы партию сам по сроку годности, и человек, выбравший
          // просроченную коробку, списал бы вместо неё свежую.
          ...(!isAsset && config.from
            ? {batchId: target.batchId || null, exactBatch: true}
            : {}),
          ...(unitCost ? {unitCost: num(unitCost)} : {}),
          ...(config.from && !isAsset ? {fromStorageId} : {}),
          ...(config.to ? {toStorageId} : {}),
        }],
      });
      return onDone();
    } catch (e) {
      Alert.alert('Не проведено', e?.response?.data?.error || 'Проверьте документ.');
      return setSending(false);
    }
  };

  const field = (label, value, onChangeText, extra = {}) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={c.textTertiary}
        {...extra}
      />
    </View>
  );

  /**
   * Окно одно на оба шага (ver. 7.76).
   *
   * Раньше выбор позиции и форма были разными Modal, и переход между ними
   * снимал одну модалку, поднимая другую в том же кадре: на устройстве это
   * читалось как зависший экран — касания уходили в уже несуществующее окно.
   * Теперь меняется только содержимое.
   */
  if (!target) {
    return (
      <Modal animationType="slide" onRequestClose={onClose}>
        <GlassBackdrop>
          <KeyboardAvoidingView
            style={styles.root}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {type === 'receipt' ? (
              // Приём ищет по справочнику: кладут как раз то, чего в кабинете ещё
              // нет, и предлагать его же остаток здесь бессмысленно.
              <ItemPick
                styles={styles}
                c={c}
                insets={insets}
                canCreate={canCreate}
                onCreate={onCreateItem}
                onClose={onClose}
                onPick={setTarget}
              />
            ) : (
              // Расход выбирают из того, что здесь лежит. Выдача — только
              // материалы: оборудование не расходуется, его перемещают и списывают.
              <RoomItemPick
                styles={styles}
                c={c}
                insets={insets}
                title={PICK_TITLES[type]}
                stock={stock}
                assets={type === 'issue' ? [] : assets}
                onClose={onClose}
                onPick={setTarget}
              />
            )}
          </KeyboardAvoidingView>
        </GlassBackdrop>
      </Modal>
    );
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <GlassBackdrop>
        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.head, {paddingTop: insets.top + 12}]}>
            <View style={styles.headText}>
              <Text style={styles.title}>{config.title}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {config.from ? `из ${roomText(room)}` : `в ${roomText(room)}`}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <X size={22} color={c.textPrimary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={{padding: 16, paddingBottom: insets.bottom + 96}}
            keyboardShouldPersistTaps="handled">
            <GlassCard style={styles.item}>
              <Text style={styles.itemName}>{target.name}</Text>
              {Boolean(target.note) && <Text style={styles.itemNote}>{target.note}</Text>}
              {available != null && (
                <Text style={styles.itemNote}>
                  В кабинете: {qtyText(available)} {target.unit || ''}
                </Text>
              )}
            </GlassCard>

            {/* У оборудования количества нет: карточка одна, и «две штуки одного
                инвентарного номера» не бывает. */}
            {!isAsset && (
              <View style={styles.qtyRow}>
                <View style={styles.qtyField}>
                  <Text style={styles.fieldLabel}>Количество, {target.unit || 'шт'}</Text>
                  <TextInput
                    style={styles.qtyInput}
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="numeric"
                    selectTextOnFocus
                  />
                </View>
                {/* «Всё» — самая частая просроченная коробка: её списывают
                    целиком, и набирать 0,375 руками незачем. */}
                {available != null && available > 0 && (
                  <Pressable
                    style={styles.qtyAll}
                    onPress={() => setQuantity(String(available))}>
                    <Text style={styles.qtyAllText}>Всё</Text>
                  </Pressable>
                )}
              </View>
            )}

            {type === 'transfer' && (
              <Pressable
                style={styles.pick}
                disabled={!rooms}
                onPress={() => setPicker('room')}>
                <Text style={styles.pickLabel}>Куда</Text>
                <Text style={[styles.pickValue, !toRoom && styles.pickEmpty]} numberOfLines={1}>
                  {rooms ? (toRoom ? toRoom.label : 'Выберите кабинет') : 'Загружаю…'}
                </Text>
                <ChevronRight size={16} color={c.textTertiary} />
              </Pressable>
            )}

            {type === 'receipt' && (
              <>
                <Pressable style={styles.pick} onPress={() => setPicker('contractor')}>
                  <Text style={styles.pickLabel}>Поставщик</Text>
                  <Text
                    style={[styles.pickValue, !contractorId && styles.pickEmpty]}
                    numberOfLines={1}>
                    {contractors.find(x => x.id === contractorId)?.name || 'Не выбран'}
                  </Text>
                  <ChevronRight size={16} color={c.textTertiary} />
                </Pressable>
                <View style={styles.card}>
                  {field('Цена за единицу, ₽', unitCost, setUnitCost, {
                    keyboardType: 'numeric', placeholder: 'если известна',
                  })}
                </View>
              </>
            )}

            <Pressable style={styles.more} onPress={() => setDetails(v => !v)}>
              <Text style={styles.moreText}>Подробнее</Text>
              <ChevronDown
                size={16}
                color={c.textTertiary}
                style={details ? styles.moreOpen : undefined}
              />
            </Pressable>

            {details && (
              <View style={styles.card}>
                {field('Причина', reasonText, setReasonText, {
                  multiline: true,
                  placeholder: type === 'writeoff' ? 'брак, просрочка, поломка…' : 'заявка, замена…',
                })}
                {field('Комментарий', comment, setComment, {multiline: true})}
              </View>
            )}
          </ScrollView>

          <GlassBar style={[styles.bar, {paddingBottom: insets.bottom + 12}]}>
            <Pressable
              style={[styles.button, sending && styles.buttonOff]}
              disabled={sending}
              onPress={post}>
              {sending
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Check size={17} color="#FFFFFF" />}
              <Text style={styles.buttonText}>{sending ? 'Провожу…' : config.done}</Text>
            </Pressable>
          </GlassBar>

          <BottomSheet
            glass
            visible={picker === 'contractor'}
            title="Поставщик"
            onClose={() => setPicker(null)}>
            <ScrollView style={styles.sheet}>
              <Pressable
                style={styles.sheetRow}
                onPress={() => { setContractorId(null); setPicker(null); }}>
                <Text style={styles.sheetRowText}>Не выбран</Text>
              </Pressable>
              {contractors.map(item => (
                <Pressable
                  key={item.id}
                  style={[styles.sheetRow, contractorId === item.id && styles.sheetRowOn]}
                  onPress={() => { setContractorId(item.id); setPicker(null); }}>
                  <Text
                    style={[styles.sheetRowText, contractorId === item.id && styles.sheetRowTextOn]}>
                    {item.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </BottomSheet>

          {picker === 'room' && Boolean(rooms) && (
            <RoomPick
              styles={styles}
              c={c}
              insets={insets}
              // Кабинет-источник из списка убран: сервер такое перемещение всё
              // равно отклонит, а объяснять отказ после выбора хуже, чем не
              // предлагать.
              rooms={rooms.filter(r => r.hasStorage && r.id !== room.id)}
              onClose={() => setPicker(null)}
              onPick={(id) => { setToRoomId(id); setPicker(null); }}
            />
          )}
        </KeyboardAvoidingView>
      </GlassBackdrop>
    </Modal>
  );
}

/** Кабинет назначения — тот же плоский список с поиском, что в журнале операций. */
function RoomPick({styles, c, insets, rooms, onClose, onPick}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = useMemo(() => rooms.filter(room => !needle
    || room.label.toLowerCase().includes(needle)
    || room.where.toLowerCase().includes(needle)), [rooms, needle]);

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <GlassBackdrop>
        <View style={styles.root}>
          <View style={[styles.head, {paddingTop: insets.top + 12}]}>
            <Text style={styles.title}>Куда</Text>
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
              placeholder="Номер или этаж"
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
                <View style={styles.lineText}>
                  <Text style={styles.itemName}>{item.label}</Text>
                  <Text style={styles.itemNote}>{item.where}</Text>
                </View>
              </Pressable>
            )}
          />
        </View>
      </GlassBackdrop>
    </Modal>
  );
}

/**
 * Что двигаем — из того, что в кабинете уже есть.
 *
 * Списки приезжают с дашбордом, поэтому поиск здесь по загруженному, а не на
 * сервере: в кабинете десятки строк, а не тысячи, и запрос ради фильтра по ним
 * был бы дороже самого фильтра. Тем же правилом, что и на сервере (matchesSearch),
 * — иначе набранное здесь и там находило бы разное.
 */
function RoomItemPick({styles, c, insets, title, stock, assets, onClose, onPick}) {
  const [q, setQ] = useState('');

  const rows = useMemo(() => [
    ...stock
      .filter(item => matchesSearch(q, [item.name, item.storageName, item.batchNumber]))
      .map(item => ({key: `s-${item.stockId}`, ...stockTarget(item)})),
    ...assets
      .filter(asset => matchesSearch(q, [asset.name, asset.inventoryNumber]))
      .map(asset => ({key: `a-${asset.id}`, ...assetTarget(asset)})),
  ], [stock, assets, q]);

  return (
    <>
      <View style={[styles.head, {paddingTop: insets.top + 12}]}>
        <Text style={styles.title}>{title}</Text>
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
          placeholder="Название или инвентарный номер"
          placeholderTextColor={c.textTertiary}
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={item => item.key}
        contentContainerStyle={{paddingHorizontal: 16, paddingBottom: insets.bottom + 24}}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.none}>
            {q ? 'Ничего не нашлось' : 'В кабинете пусто'}
          </Text>
        }
        renderItem={({item}) => (
          <Pressable style={styles.line} onPress={() => onPick(item)}>
            <View style={styles.lineText}>
              <Text style={styles.itemName}>{item.name}</Text>
              {Boolean(item.note) && <Text style={styles.itemNote}>{item.note}</Text>}
            </View>
            {item.available != null && (
              <Text style={styles.lineQty}>
                {qtyText(item.available)} {item.unit || ''}
              </Text>
            )}
          </Pressable>
        )}
      />
    </>
  );
}

/**
 * Позиция справочника для приёма.
 *
 * Поиск уходит на сервер по той же причине, что и в журнале операций: справочник
 * длиннее любого разумного потолка, и фильтр по загруженному куску выглядел бы
 * как пропавшие позиции.
 */
function ItemPick({styles, c, insets, canCreate, onCreate, onClose, onPick}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    const load = () => warehouseApi.nomenclature({limit: 300, q: q.trim() || undefined})
      .then(({data}) => alive && setRows(data?.items || []))
      .catch(() => alive && setRows([]));

    // Задержка на наборе: запрос на каждую букву — это запрос на каждую букву.
    const timer = setTimeout(load, q ? 350 : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]));

  return (
    <>
      <View style={[styles.head, {paddingTop: insets.top + 12}]}>
        <Text style={styles.title}>Что принимаем</Text>
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
          placeholder="Название материала"
          placeholderTextColor={c.textTertiary}
        />
      </View>
      {!rows ? <LogoLoader /> : (
        <FlatList
          data={rows}
          keyExtractor={item => item.id}
          contentContainerStyle={{paddingHorizontal: 16, paddingBottom: insets.bottom + 24}}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            // Заведение с нуля — здесь же, но ниже поиска: сначала стоит
            // убедиться, что позиции нет, и только потом заводить вторую
            // такую же под чуть иным названием.
            onCreate && (canCreate?.asset || canCreate?.material) ? (
              <View style={styles.createBlock}>
                <Text style={styles.createHint}>Нет в справочнике — завести:</Text>
                <View style={styles.createRow}>
                  {Boolean(canCreate?.asset) && (
                    <Pressable style={styles.createBtn} onPress={() => onCreate('asset')}>
                      <Plus size={15} color={c.primary} />
                      <Text style={styles.createText}>Оборудование</Text>
                    </Pressable>
                  )}
                  {Boolean(canCreate?.material) && (
                    <Pressable style={styles.createBtn} onPress={() => onCreate('material')}>
                      <Plus size={15} color={c.primary} />
                      <Text style={styles.createText}>Материал</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Text style={styles.none}>
              {q ? 'Ничего не нашлось' : 'Справочник пуст'}
            </Text>
          }
          renderItem={({item}) => (
            <Pressable
              style={styles.line}
              onPress={() => onPick({
                nomenclatureId: item.id,
                name: item.name,
                unit: item.unit,
              })}>
              <View style={styles.lineText}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemNote}>{item.unit}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1},
  body: {flex: 1},
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    ...glassOverlay(c),
  },
  headText: {flex: 1},
  title: {fontFamily: font.semiBold, fontSize: 18, color: c.textPrimary},
  subtitle: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},

  item: {...glassSurface(c), borderRadius: radius.lg, padding: 14, gap: 3},
  itemName: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary, lineHeight: 20},
  itemNote: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary},

  qtyRow: {flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 12},
  qtyField: {flex: 1},
  qtyInput: {
    height: 52,
    marginTop: 6,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    fontFamily: font.semiBold,
    fontSize: 20,
    color: c.textPrimary,
  },
  qtyAll: {
    height: 52,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyAllText: {fontFamily: font.semiBold, fontSize: 14, color: c.primary},

  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: radius.md,
    ...glassSurface(c),
  },
  pickLabel: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary},
  pickValue: {flex: 1, fontFamily: font.medium, fontSize: 14, color: c.textPrimary, textAlign: 'right'},
  pickEmpty: {color: c.textTertiary},

  more: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 10,
  },
  moreText: {fontFamily: font.medium, fontSize: 13, color: c.textSecondary},
  moreOpen: {transform: [{rotate: '180deg'}]},

  card: {...glassSurface(c), borderRadius: radius.lg, marginTop: 8, overflow: 'hidden'},
  field: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glassLine(c),
  },
  fieldLabel: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary},
  fieldInput: {
    marginTop: 2,
    paddingVertical: 4,
    fontFamily: font.medium,
    fontSize: 14,
    color: c.textPrimary,
  },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 16,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: radius.md,
    ...glassSurface(c),
  },
  searchInput: {flex: 1, fontFamily: font.regular, fontSize: 14, color: c.textPrimary},
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    borderRadius: radius.md,
    ...glassSurface(c),
  },
  lineText: {flex: 1},
  lineQty: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary},

  createBlock: {marginBottom: 14},
  createHint: {
    fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginBottom: 8,
  },
  createRow: {flexDirection: 'row', gap: 8},
  createBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderRadius: radius.md, backgroundColor: c.primaryLight,
  },
  createText: {fontFamily: font.medium, fontSize: 13, color: c.primary},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, padding: 24, textAlign: 'center'},

  sheet: {paddingHorizontal: 16, paddingBottom: 8},
  sheetRow: {paddingVertical: 13, paddingHorizontal: 12, borderRadius: radius.md},
  sheetRowOn: {backgroundColor: c.primaryLight},
  sheetRowText: {fontFamily: font.medium, fontSize: 15, color: c.textPrimary},
  sheetRowTextOn: {color: c.primary},

  bar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    ...glassOverlay(c),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    ...accentShadow(c.primary),
  },
  buttonOff: {opacity: 0.6},
  buttonText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
});
