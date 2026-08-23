/**
 * Завести оборудование или материал прямо в кабинете.
 *
 * ── Почему это отдельно от правки ────────────────────────────────────────────
 *
 * Правка отвечает на вопрос «что мы про эту вещь знаем», а заведение — на
 * вопрос «эта вещь у нас есть». Второй короче: наименование, сколько и почём.
 * Показать при заведении всю форму карточки значило бы спросить про ОКОФ и
 * амортизационную группу у человека, который держит в руках стул.
 *
 * ── Что происходит при сохранении ────────────────────────────────────────────
 *
 * Оборудование: столько карточек, сколько единиц, — каждая со своим инвентарным
 * номером. Номер содержит код специальности отделения кабинета, поэтому кабинет
 * тут обязателен и меняться потом не будет.
 *
 * Материал: позиция справочника плюс приходный документ на количество. Просто
 * завести позицию мало — в кабинете от неё не появится ни грамма, — а вписать
 * остаток напрямую нельзя: он меняется только документом, иначе склад разойдётся
 * с журналом молча.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, StyleSheet, Alert, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Check, ChevronRight, X} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {loadLocationTree} from '../../store/warehouseStore';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {ASSET_STATUS, flattenRooms} from './warehouseMeta';

const STATUS_OPTIONS = Object.entries(ASSET_STATUS)
  .filter(([key]) => key !== 'written_off')
  .map(([value, label]) => ({value, label}));

// Больше сотни одинаковых карточек за раз — это не заведение, а опечатка:
// каждая карточка получает свой инвентарный номер, и отменять их придётся
// поштучно.
const MAX_COUNT = 100;

const num = value => Number(String(value ?? '').replace(',', '.')) || 0;

export default function WarehouseItemCreateScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const {roomId, kind = 'asset'} = route.params || {};
  const isAsset = kind === 'asset';

  const [room, setRoom] = useState(null);
  const [categories, setCategories] = useState([]);
  const [picker, setPicker] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    model: '',
    manufacturer: '',
    serialNumber: '',
    categoryId: null,
    status: 'in_use',
    unit: 'шт',
    count: '1',
    unitCost: '',
  });

  useFocusEffect(useCallback(() => {
    let alive = true;
    navigation.setOptions({title: isAsset ? 'Новое оборудование' : 'Новый материал'});
    Promise.allSettled([loadLocationTree(), warehouseApi.categories()])
      .then(([treeResult, categoryResult]) => {
        if (!alive) return;
        const tree = treeResult.status === 'fulfilled' ? treeResult.value : null;
        setRoom(flattenRooms(tree).find(item => item.id === roomId) || false);
        if (categoryResult.status === 'fulfilled') setCategories(categoryResult.value.data || []);
      });
    return () => { alive = false; };
  }, [roomId, isAsset, navigation]));

  const set = (key, value) => setForm(prev => ({...prev, [key]: value}));

  const categoryOptions = useMemo(
    () => (categories || [])
      .filter(item => (isAsset ? item.kind !== 'material' : item.kind !== 'asset'))
      .map(item => ({value: item.id, label: item.name})),
    [categories, isAsset],
  );

  const save = async () => {
    if (!form.name.trim()) return Alert.alert('Не заведено', 'Укажите наименование.');

    // Место хранения обязательно и у карточки, и у остатка. Кабинет без единой
    // полки завести имущество не может — и узнать об этом надо здесь, а не
    // ответом сервера после заполнения всей формы.
    const storageId = room?.storages?.[0]?.id;
    if (!storageId) {
      return Alert.alert('Не заведено', 'В кабинете нет мест хранения — заведите полку в веб-версии.');
    }

    const count = Math.max(1, Math.min(MAX_COUNT, Math.round(num(form.count) || 1)));
    setSaving(true);
    try {
      if (isAsset) {
        // По карточке на единицу: инвентарный номер выдаётся каждой, и одним
        // запросом на пять стульев сервер выдал бы один номер на пять.
        for (let i = 0; i < count; i += 1) {
          await warehouseApi.createAsset({
            name: form.name.trim(),
            model: form.model.trim() || null,
            manufacturer: form.manufacturer.trim() || null,
            // Серийный номер у каждой единицы свой, и повторить его на пятерых
            // значит соврать: при пачке он не проставляется вовсе.
            serialNumber: count === 1 ? (form.serialNumber.trim() || null) : null,
            categoryId: form.categoryId || null,
            status: form.status,
            initialCost: num(form.unitCost),
            roomId,
            storageId,
          });
        }
      } else {
        const {data: nomenclature} = await warehouseApi.createNomenclature({
          name: form.name.trim(),
          unit: form.unit.trim() || 'шт',
          categoryId: form.categoryId || null,
          // Партии по умолчанию не отслеживаем: сроков годности у заведённого
          // руками остатка обычно нет, а пустая партия только засоряет FEFO.
          tracksBatch: false,
        });
        await warehouseApi.createDocument({
          type: 'receipt',
          reasonCode: 'manual',
          reasonText: 'Заведено с телефона',
          lines: [{
            nomenclatureId: nomenclature.id,
            quantity: count,
            unitCost: num(form.unitCost),
            toStorageId: storageId,
          }],
        });
      }
      return navigation.goBack();
    } catch (e) {
      Alert.alert('Не заведено', e?.response?.data?.error || 'Попробуйте ещё раз.');
      return setSaving(false);
    }
  };

  if (room === null) return <LogoLoader />;

  const field = (label, key, extra = {}) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, extra.multiline && styles.inputArea]}
        value={form[key]}
        onChangeText={value => set(key, value)}
        placeholderTextColor={c.textTertiary}
        {...extra}
      />
    </View>
  );

  const choice = (label, key, options, empty = 'Не выбрано') => (
    <Pressable style={styles.field} onPress={() => setPicker({key, label, options})}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.select}>
        <Text style={[styles.selectText, !form[key] && styles.selectEmpty]} numberOfLines={1}>
          {options.find(o => o.value === form[key])?.label || empty}
        </Text>
        <ChevronRight size={16} color={c.textTertiary} />
      </View>
    </Pressable>
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 90}]}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.where}>
          {room ? room.label : 'Кабинет'}
          {room?.storages?.[0]?.name ? ` · ${room.storages[0].name}` : ''}
        </Text>

        <View style={styles.card}>
          {field('Наименование', 'name', {multiline: true, autoFocus: true})}
          {choice('Категория', 'categoryId', categoryOptions)}

          {isAsset ? (
            <>
              {field('Модель', 'model')}
              {field('Производитель', 'manufacturer')}
              {num(form.count) <= 1 && field('Серийный номер', 'serialNumber', {
                autoCapitalize: 'characters',
              })}
              {choice('Статус', 'status', STATUS_OPTIONS)}
            </>
          ) : (
            field('Единица измерения', 'unit', {placeholder: 'шт, м, л, пара'})
          )}

          {field(isAsset ? 'Количество, шт' : 'Количество', 'count', {keyboardType: 'numeric'})}
          {field(
            isAsset ? 'Стоимость за единицу, ₽' : 'Цена за единицу, ₽',
            'unitCost',
            {keyboardType: 'numeric'},
          )}
        </View>

        {isAsset && num(form.count) > 1 && (
          <Text style={styles.note}>
            Будет заведено карточек: {Math.min(MAX_COUNT, Math.round(num(form.count)))}, у каждой свой инвентарный номер
          </Text>
        )}
      </ScrollView>

      <View style={[styles.bar, {paddingBottom: insets.bottom + 12}]}>
        <Pressable
          style={[styles.button, saving && styles.buttonOff]}
          disabled={saving}
          onPress={save}>
          {saving
            ? <ActivityIndicator size="small" color="#FFFFFF" />
            : <Check size={17} color="#FFFFFF" />}
          <Text style={styles.buttonText}>{saving ? 'Завожу…' : 'Завести'}</Text>
        </Pressable>
      </View>

      {Boolean(picker) && (
        <Modal animationType="slide" onRequestClose={() => setPicker(null)}>
          <View style={[styles.modal, {paddingTop: insets.top + 12}]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{picker.label}</Text>
              <Pressable onPress={() => setPicker(null)} hitSlop={10}>
                <X size={22} color={c.textPrimary} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalList}>
              {picker.key !== 'status' && (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => { set(picker.key, null); setPicker(null); }}>
                  <Text style={styles.modalEmpty}>Не выбрано</Text>
                </Pressable>
              )}
              {picker.options.map(option => (
                <Pressable
                  key={option.value}
                  style={styles.modalRow}
                  onPress={() => { set(picker.key, option.value); setPicker(null); }}>
                  <Text style={styles.modalRowText}>{option.label}</Text>
                  {form[picker.key] === option.value && <Check size={16} color={c.primary} />}
                </Pressable>
              ))}
              {!picker.options.length && (
                <Text style={styles.modalEmpty}>Справочник пуст или закрыт правами</Text>
              )}
            </ScrollView>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 16},
  where: {fontFamily: font.medium, fontSize: 13, color: c.textSecondary, marginBottom: 10},
  card: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, paddingHorizontal: 14},
  field: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  label: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginBottom: 3},
  input: {fontFamily: font.medium, fontSize: 15, color: c.textPrimary, padding: 0, minHeight: 24},
  inputArea: {minHeight: 44, textAlignVertical: 'top'},
  select: {flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24},
  selectText: {flex: 1, fontFamily: font.medium, fontSize: 15, color: c.textPrimary},
  selectEmpty: {color: c.textTertiary},
  note: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 12},

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

  modal: {flex: 1, backgroundColor: c.bgSecondary},
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  modalTitle: {fontFamily: font.semiBold, fontSize: 18, color: c.textPrimary},
  modalList: {padding: 12},
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 6,
  },
  modalRowText: {flex: 1, fontFamily: font.medium, fontSize: 15, color: c.textPrimary},
  modalEmpty: {flex: 1, fontFamily: font.regular, fontSize: 15, color: c.textTertiary},
});
