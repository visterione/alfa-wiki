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
import React, {useCallback, useLayoutEffect, useState} from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, Alert, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  Plus, Search, X, Check, Trash2, ChevronRight, ChevronDown, Filter, CalendarDays,
  Undo2,
} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import BottomSheet from '../../components/BottomSheet';
import {loadLocationTree, useWarehouseCan, useWarehouseMedCenter} from '../../store/warehouseStore';
import {useNetworkFallback, NetworkFallbackHint} from './MedCenterSwitch';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {qtyText, dateText, roomText, flattenRooms} from './warehouseMeta';

/**
 * Типы операций — те же восемь, что в вебе, и с теми же правилами.
 *
 * `material` и `asset` — что вообще можно положить в строку: приход материала
 * бывает, приход основного средства оформляется постановкой на учёт и сюда не
 * входит. `sourceFirst` — операции, в которых сначала выбирают место, а потом
 * объект: списание, перемещение и ремонт это всегда работа с тем, что где-то
 * уже лежит, и общий справочник в ней помеха — из него ещё надо угадать то, что
 * здесь действительно есть.
 */
const TYPES = [
  {key: 'receipt', label: 'Приём', from: false, to: true, material: true, asset: false},
  {key: 'issue', label: 'Выдача', from: true, to: false, material: true, asset: false},
  {key: 'transfer', label: 'Перемещение', from: true, to: true, material: true, asset: true, sourceFirst: true},
  {key: 'return', label: 'Возврат', from: false, to: true, material: true, asset: false},
  {key: 'writeoff', label: 'Списание', from: true, to: false, material: true, asset: true, sourceFirst: true},
  {key: 'repair_out', label: 'В ремонт', from: true, to: false, material: false, asset: true, sourceFirst: true},
  {key: 'repair_in', label: 'Из ремонта', from: true, to: false, material: false, asset: true, sourceFirst: true},
  {key: 'surplus', label: 'Оприходование излишков', from: false, to: true, material: true, asset: false},
];

const TYPE_BY_KEY = Object.fromEntries(TYPES.map(t => [t.key, t]));

/**
 * Подпись у выбора места своя на каждую операцию: «откуда» ничего не говорит о
 * том, что сейчас произойдёт, а на этом шаге человек как раз выбирает область
 * ответственности. Формулировки те же, что в вебе.
 */
const FROM_LABELS = {
  issue: 'Откуда выдаём',
  writeoff: 'Откуда списываем',
  transfer: 'Откуда перемещаем',
  repair_out: 'Откуда забираем в ремонт',
  // Из ремонта: сервер размещение не меняет, он только снимает статус «в
  // ремонте». Значит выбирается не «куда вернуть», а кабинет, за которым
  // оборудование числится всё это время.
  repair_in: 'Кабинет оборудования',
};

const TO_LABELS = {
  receipt: 'Куда принимаем',
  return: 'Куда возвращаем',
  transfer: 'Куда перемещаем',
  surplus: 'Куда приходуем',
};

const TYPE_LABELS = Object.fromEntries(TYPES.map(t => [t.key, t.label]));

/**
 * Что отменяется кнопкой. Приход, списание и оприходование излишков сюда не
 * входят намеренно — почему, см. backend/services/warehouse/reversal.js.
 */
const REVERSIBLE = new Set(['transfer', 'issue', 'return', 'repair_out', 'repair_in']);

const num = value => Number(String(value ?? '').replace(',', '.')) || 0;

/** Дата и время документа: до минут — секунды в журнале никому не нужны. */
const dateTimeText = value => new Date(value).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export default function WarehouseOperationsScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const tabInset = useTabBarInset();
  const canIssue = useWarehouseCan('canIssue');
  const {medCenterId, ready} = useWarehouseMedCenter();
  /**
   * Журнал одного кабинета (ver. 7.76).
   *
   * Тот же экран, открытый из кабинета: движения смотрят, чтобы понять, куда
   * делась вещь, и отдельный экран ради этого — копия того, что уже написано,
   * включая отмену на строке. Отбор считает сервер, потому что кабинеты
   * заполнены не у всех типов документа и судить по ним нельзя.
   */
  const {roomId, title} = route?.params || {};

  const [documents, setDocuments] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [typeSheet, setTypeSheet] = useState(false);
  const [form, setForm] = useState(null);

  const load = useCallback(() => warehouseApi.documents({
    limit: 50,
    ...(typeFilter ? {type: typeFilter} : {}),
    // Своего медцентра у документа нет — сервер определяет его по движениям
    // (см. operations.js). Перемещение между центрами попадает в журнал обоих:
    // оно и правда касается обоих. Кабинет этот отбор отменяет: он и так внутри
    // одного медцентра, и второй параметр сузил бы выборку тем же самым дважды.
    ...(roomId ? {roomId} : (medCenterId ? {medCenterId} : {})),
  })
    .then(({data}) => setDocuments(data?.items || []))
    .catch(() => setDocuments([])), [typeFilter, medCenterId, roomId]);

  // Пока выбранный медцентр читается из памяти телефона, запрос не уходит:
  // иначе журнал открылся бы сетевым и через миг сменился своим. Журналу
  // кабинета ждать нечего — медцентр в его отборе не участвует.
  useFocusEffect(useCallback(() => { if (ready || roomId) load(); }, [load, ready, roomId]));

  // Заголовок и переключатель медцентра: в журнале кабинета переключать нечего,
  // и оставленная кнопка меняла бы то, что на этот экран уже не влияет.
  useLayoutEffect(() => {
    if (!roomId) return;
    navigation.setOptions({
      title: title ? `Движения · ${title}` : 'Движения',
      headerRight: () => null,
    });
  }, [roomId, title, navigation]);

  // Число по всей сети — только для пустого журнала: человек должен видеть, что
  // документы есть, просто не здесь.
  const probeNetwork = useCallback(
    () => warehouseApi.documents({limit: 1, ...(typeFilter ? {type: typeFilter} : {})})
      .then(({data}) => data?.total || 0),
    [typeFilter],
  );
  const foundInNetwork = useNetworkFallback(probeNetwork, {
    // Кабинету подсказка «а в сети документы есть» ничего не даёт: он спрашивал
    // не про сеть, а про себя.
    enabled: !roomId && Boolean(medCenterId) && Boolean(documents) && documents.length === 0,
  });

  /**
   * Отмена операции прямо из журнала (ver. 7.50).
   *
   * Кнопка стоит на строке документа, а не в отдельной форме: человек уже
   * смотрит на ту запись, которую хочет исправить, и повторять выбор
   * кабинетов ему незачем. Что именно отменяется, решает сервер — здесь только
   * гасим заведомо бессмысленное: приход, списание и уже отменённое.
   */
  const [undoing, setUndoing] = useState(null);

  const undo = (document) => Alert.alert(
    `Отменить ${TYPE_LABELS[document.type]?.toLowerCase() || 'операцию'} ${document.number}?`,
    'Будет проведён встречный документ. Сама операция останется в истории — '
    + 'видно будет и её, и отмену.',
    [
      {text: 'Нет', style: 'cancel'},
      {
        text: 'Отменить операцию',
        style: 'destructive',
        onPress: async () => {
          setUndoing(document.id);
          try {
            const {data} = await warehouseApi.reverseDocument(document.id);
            await load();
            Alert.alert('Отменено', `Проведён документ ${data.document.number}.`);
          } catch (e) {
            Alert.alert('Не отменено', e?.response?.data?.error || 'Попробуйте ещё раз.');
          } finally {
            setUndoing(null);
          }
        },
      },
    ],
  );

  if (!documents) return <LogoLoader />;

  return (
    <View style={styles.root}>
      {/* Отбор по типу — строкой с листом, а не рядом кнопок: типов восемь, и
          в ряд они не помещаются, а перенос съедает верх экрана */}
      <Pressable style={styles.typeFilter} onPress={() => setTypeSheet(true)}>
        <Filter size={15} color={c.primary} />
        <Text style={styles.typeFilterText}>
          {typeFilter ? TYPE_LABELS[typeFilter] : 'Все операции'}
        </Text>
        <ChevronDown size={16} color={c.textTertiary} />
      </Pressable>

      <FlatList
        data={documents}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, {paddingBottom: tabInset + (canIssue ? 90 : 24)}]}
        ListEmptyComponent={
          <>
            <Text style={styles.none}>Документов нет</Text>
            <NetworkFallbackHint found={foundInNetwork} />
          </>
        }
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
              {/* Исправленная ошибка не должна читаться как две операции подряд:
                  говорим прямо, что документ отменён и чем. */}
              {Boolean(item.reversedBy) && (
                <Text style={styles.rowUndone}>отменён — сторно {item.reversedBy.number}</Text>
              )}
            </View>

            {canIssue && REVERSIBLE.has(item.type) && !item.reversedBy && !item.reversalOfId && (
              <Pressable
                style={styles.undo}
                disabled={undoing === item.id}
                hitSlop={8}
                onPress={() => undo(item)}
                accessibilityRole="button"
                accessibilityLabel={`Отменить операцию ${item.number}`}>
                <Undo2 size={17} color={c.error} />
              </Pressable>
            )}
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

      <BottomSheet
        visible={typeSheet}
        title="Тип операции"
        onClose={() => setTypeSheet(false)}>
        <View style={styles.sheet}>
          {[{key: '', label: 'Все операции'}, ...TYPES].map(item => (
            <Pressable
              key={item.key || 'all'}
              style={[styles.sheetRow, typeFilter === item.key && styles.sheetRowOn]}
              onPress={() => { setTypeFilter(item.key); setTypeSheet(false); }}>
              <Text
                style={[styles.sheetRowText, typeFilter === item.key && styles.sheetRowTextOn]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </BottomSheet>

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
  // Шапка документа — те же поля, что в веб-форме: когда произошло, по какому
  // основанию, с кем и что сказать словами.
  const [meta, setMeta] = useState({
    occurredAt: new Date(),
    reasonCode: '',
    reasonText: '',
    comment: '',
    contractorId: null,
  });
  const [contractors, setContractors] = useState([]);
  const [picker, setPicker] = useState(null);
  const [datePicker, setDatePicker] = useState(false);
  const [sending, setSending] = useState(false);

  const config = TYPE_BY_KEY[type];

  useFocusEffect(useCallback(() => {
    let alive = true;
    loadLocationTree().then(tree => alive && setRooms(flattenRooms(tree)));
    // Контрагент нужен только приходным операциям, но справочник маленький и
    // грузится один раз — проще взять его сразу, чем сторожить смену типа
    warehouseApi.contractors()
      .then(({data}) => alive && setContractors(data || []))
      .catch(() => {});
    return () => { alive = false; };
  }, []));

  const fromRoom = rooms?.find(r => r.id === fromRoomId);
  const toRoom = rooms?.find(r => r.id === toRoomId);
  const withContractor = type === 'receipt' || type === 'return';

  const post = async () => {
    if (!lines.length) return Alert.alert('Не проведено', 'Добавьте хотя бы одну позицию.');
    if (config.from && !fromRoomId) return Alert.alert('Не проведено', 'Выберите, откуда.');
    if (config.to && !toRoomId) return Alert.alert('Не проведено', 'Выберите, куда.');

    setSending(true);
    try {
      await warehouseApi.createDocument({
        type,
        // Дата задним числом законна — документ оформляют не в ту же секунду.
        // Будущим числом сервер её не примет, и это его правило, не наше.
        occurredAt: meta.occurredAt.toISOString(),
        reasonCode: meta.reasonCode.trim() || null,
        reasonText: meta.reasonText.trim() || null,
        comment: meta.comment.trim() || null,
        contractorId: withContractor ? meta.contractorId : null,
        fromRoomId: config.from ? fromRoomId : null,
        toRoomId: config.to ? toRoomId : null,
        lines: lines.map(line => ({
          ...(line.assetId ? {assetId: line.assetId} : {nomenclatureId: line.nomenclatureId}),
          quantity: line.quantity,
          ...(line.unitCost ? {unitCost: line.unitCost} : {}),
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

  const field = (label, key, extra = {}) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={meta[key]}
        onChangeText={value => setMeta(m => ({...m, [key]: value}))}
        placeholderTextColor={c.textTertiary}
        {...extra}
      />
    </View>
  );

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
                {/* Тип — строкой с листом, а не рядом кнопок: типов восемь, и
                    от типа зависит вся остальная форма, так что выбор должен
                    читаться словом, а не угадываться по подсвеченному чипу */}
                <Pressable style={styles.pick} onPress={() => setPicker('type')}>
                  <Text style={styles.pickLabel}>Операция</Text>
                  <Text style={styles.pickValue} numberOfLines={1}>{config.label}</Text>
                  <ChevronDown size={16} color={c.textTertiary} />
                </Pressable>

                <Pressable style={styles.pick} onPress={() => setDatePicker(true)}>
                  <Text style={styles.pickLabel}>Когда</Text>
                  <Text style={styles.pickValue}>{dateTimeText(meta.occurredAt)}</Text>
                  <CalendarDays size={16} color={c.textTertiary} />
                </Pressable>

                {config.from && (
                  <Pressable style={styles.pick} onPress={() => setPicker('from')}>
                    <Text style={styles.pickLabel} numberOfLines={2}>
                      {FROM_LABELS[type] || 'Откуда'}
                    </Text>
                    <Text style={[styles.pickValue, !fromRoom && styles.pickEmpty]} numberOfLines={1}>
                      {fromRoom ? fromRoom.label : 'Выберите кабинет'}
                    </Text>
                    <ChevronRight size={16} color={c.textTertiary} />
                  </Pressable>
                )}

                {config.to && (
                  <Pressable style={styles.pick} onPress={() => setPicker('to')}>
                    <Text style={styles.pickLabel} numberOfLines={2}>
                      {TO_LABELS[type] || 'Куда'}
                    </Text>
                    <Text style={[styles.pickValue, !toRoom && styles.pickEmpty]} numberOfLines={1}>
                      {toRoom ? toRoom.label : 'Выберите кабинет'}
                    </Text>
                    <ChevronRight size={16} color={c.textTertiary} />
                  </Pressable>
                )}

                {/* Контрагент только у приходных операций: у выдачи и списания
                    второй стороны нет, и пустое поле там задавало бы вопрос,
                    на который нечего ответить */}
                {withContractor && (
                  <Pressable style={styles.pick} onPress={() => setPicker('contractor')}>
                    <Text style={styles.pickLabel}>Контрагент</Text>
                    <Text
                      style={[styles.pickValue, !meta.contractorId && styles.pickEmpty]}
                      numberOfLines={1}>
                      {contractors.find(x => x.id === meta.contractorId)?.name || 'Не выбран'}
                    </Text>
                    <ChevronRight size={16} color={c.textTertiary} />
                  </Pressable>
                )}

                <Text style={styles.section}>Позиции</Text>
                <Pressable
                  style={styles.add}
                  disabled={config.sourceFirst && !fromRoomId}
                  onPress={() => setPicker('line')}>
                  <Plus
                    size={16}
                    color={config.sourceFirst && !fromRoomId ? c.textTertiary : c.primary}
                  />
                  <Text
                    style={[
                      styles.addText,
                      config.sourceFirst && !fromRoomId && styles.addTextOff,
                    ]}>
                    {config.sourceFirst && !fromRoomId
                      ? 'Сначала выберите кабинет'
                      : 'Добавить позицию'}
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
              <View style={styles.footer}>
                <Text style={styles.section}>Основание</Text>
                <View style={styles.card}>
                  {field('Код основания', 'reasonCode', {placeholder: 'заявка, возврат, брак…'})}
                  {field('Причина', 'reasonText', {multiline: true})}
                  {field('Комментарий', 'comment', {multiline: true})}
                </View>
              </View>
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

        {/* Системный выбор даты: на Android это отдельный диалог, поэтому
            компонент монтируется только на время показа */}
        {datePicker && (
          <DateTimePicker
            value={meta.occurredAt}
            mode="date"
            onChange={(event, picked) => {
              setDatePicker(false);
              if (event.type === 'set' && picked) setMeta(m => ({...m, occurredAt: picked}));
            }}
          />
        )}

        <BottomSheet
          visible={picker === 'type' || picker === 'contractor'}
          title={picker === 'type' ? 'Операция' : 'Контрагент'}
          onClose={() => setPicker(null)}>
          <View style={styles.sheet}>
            {picker === 'type' && TYPES.map(item => (
              <Pressable
                key={item.key}
                style={[styles.sheetRow, type === item.key && styles.sheetRowOn]}
                onPress={() => {
                  // Смена типа сбрасывает строки: у нового типа другой набор
                  // того, что вообще можно положить в документ
                  setType(item.key);
                  setLines([]);
                  setPicker(null);
                }}>
                <Text style={[styles.sheetRowText, type === item.key && styles.sheetRowTextOn]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}

            {picker === 'contractor' && (
              <Pressable
                style={styles.sheetRow}
                onPress={() => { setMeta(m => ({...m, contractorId: null})); setPicker(null); }}>
                <Text style={styles.sheetRowText}>Не выбран</Text>
              </Pressable>
            )}
            {picker === 'contractor' && contractors.map(item => (
              <Pressable
                key={item.id}
                style={[styles.sheetRow, meta.contractorId === item.id && styles.sheetRowOn]}
                onPress={() => { setMeta(m => ({...m, contractorId: item.id})); setPicker(null); }}>
                <Text
                  style={[
                    styles.sheetRowText,
                    meta.contractorId === item.id && styles.sheetRowTextOn,
                  ]}>
                  {item.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </BottomSheet>

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
            material={config.material}
            asset={config.asset}
            fromStock={Boolean(config.sourceFirst)}
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
function LinePicker({styles, c, insets, roomId, fromStock, material, asset, onClose, onPick}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [quantity, setQuantity] = useState('1');

  /**
   * Что предлагать в выборе объекта.
   *
   * Поиск уходит на сервер (ver. 7.51): списки здесь с потолком — двести
   * карточек, триста позиций справочника, — и фильтр на экране искал только
   * внутри загруженного куска. На реальной базе это выглядело как пропавшие
   * позиции: набираешь название и не находишь того, что точно есть.
   */
  useFocusEffect(useCallback(() => {
    let alive = true;
    const nothing = Promise.resolve({data: {items: []}});
    const search = q.trim() || undefined;

    const load = () => {
      const request = fromStock
        ? Promise.all([
          // Что именно предлагать, решает тип операции: в ремонт уходит только
          // оборудование, а материалы там взять неоткуда
          material ? warehouseApi.stock({roomId, includeZero: 'false', q: search}) : nothing,
          asset ? warehouseApi.assets({roomId, limit: 200, q: search}) : nothing,
        ]).then(([stock, assets]) => [
          // Остаток приходит объектом со строками, а не массивом: раньше здесь
          // стояла проверка на массив, и материалы не показывались НИКОГДА —
          // список молча оставался пустым.
          ...((stock.data?.items) || []).map(row => ({
            key: `s-${row.id}`,
            nomenclatureId: row.nomenclature?.id,
            name: row.nomenclature?.name,
            unit: row.nomenclature?.unit,
            available: Number(row.quantity),
          })),
          ...((assets.data?.items) || []).map(item => ({
            key: `a-${item.id}`,
            assetId: item.id,
            name: `${item.inventoryNumber} · ${item.name}`,
            unit: 'шт',
            available: 1,
          })),
        ])
        : (material ? warehouseApi.nomenclature({limit: 300, q: search}) : nothing)
          .then(({data}) => (data?.items || []).map(row => ({
            key: `n-${row.id}`,
            nomenclatureId: row.id,
            name: row.name,
            unit: row.unit,
            available: null,
          })));

      request.then(list => alive && setRows(list)).catch(() => alive && setRows([]));
    };

    // Задержка на наборе: запрос на каждую букву — это запрос на каждую букву.
    const timer = setTimeout(load, q ? 350 : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [roomId, fromStock, material, asset, q]));

  // Отбор уже сделан сервером — здесь только то, что он прислал.
  const list = rows || [];

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
  rowUndone: {fontFamily: font.medium, fontSize: 11, color: c.error, marginTop: 2},
  undo: {paddingLeft: 10, alignSelf: 'center'},
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
  section: {
    fontFamily: font.semiBold,
    fontSize: 13,
    color: c.textSecondary,
    marginTop: 16,
    marginBottom: 8,
  },
  card: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, paddingHorizontal: 14},
  field: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  fieldLabel: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginBottom: 3},
  fieldInput: {
    fontFamily: font.medium,
    fontSize: 15,
    color: c.textPrimary,
    padding: 0,
    minHeight: 24,
  },
  footer: {marginTop: 4},
  typeFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 42,
    margin: 16,
    marginBottom: 10,
  },
  typeFilterText: {flex: 1, fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  sheet: {padding: 16, gap: 6},
  sheetRow: {
    paddingHorizontal: 14,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: c.bgSecondary,
    justifyContent: 'center',
  },
  sheetRowOn: {backgroundColor: c.primary},
  sheetRowText: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  sheetRowTextOn: {color: '#FFFFFF'},
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
