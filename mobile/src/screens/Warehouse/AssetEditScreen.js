/**
 * Правка карточки оборудования с телефона.
 *
 * ── Зачем это на телефоне ────────────────────────────────────────────────────
 *
 * Карточки заводит разбор ведомости, и заводит их полупустыми: из 1С приезжают
 * только наименование и стоимость. Серийный номер, модель, категорию и дату
 * ввода в эксплуатацию знает не тот, кто сидит за компьютером, а тот, кто стоит
 * перед прибором и видит шильдик на его задней стенке. Пока правка жила только
 * в вебе, эти поля так и оставались пустыми: переписывать серийники в блокнот и
 * потом заносить их за столом никто не станет.
 *
 * ── Чего здесь нет ───────────────────────────────────────────────────────────
 *
 * Кабинета, места хранения и МОЛ. Их меняет документ перемещения — иначе актив
 * сменил бы место без следа в журнале, и отчёт «Движение активов» перестал бы
 * быть аудиторским. Ровно то же ограничение стоит в веб-форме и в массовой
 * правке; разойтись им нельзя.
 *
 * ── Почему поля разложены по тем же трём вкладкам, что и просмотр ────────────
 *
 * Карточка и её правка — один и тот же предмет с одной и той же структурой.
 * Разная разбивка означала бы, что человек ищет поле не там, где только что его
 * читал.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, StyleSheet, Alert, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import {Check, ChevronRight, X} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import GlassBackdrop from '../../components/GlassBackdrop';
import GlassBar from '../../components/GlassBar';
import SwipeTabs from '../../components/SwipeTabs';
import {radius, font, glassSurface, glassOverlay, accentShadow, glassLine} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {ASSET_STATUS, dateText} from './warehouseMeta';

const STATUS_OPTIONS = Object.entries(ASSET_STATUS)
  // Списание — не правка поля, а операция со своим документом и своими
  // последствиями: из формы его выбрать нельзя.
  .filter(([key]) => key !== 'written_off')
  .map(([value, label]) => ({value, label}));

const DEPRECIATION_METHODS = [
  {value: 'linear', label: 'Линейный'},
  {value: 'reducing', label: 'Уменьшаемого остатка'},
];

/** Дата в том виде, в каком её ждёт сервер: YYYY-MM-DD без времени и пояса. */
const isoDate = value => (value ? new Date(value).toISOString().slice(0, 10) : null);

export default function WarehouseAssetEditScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const {assetId} = route.params || {};

  const [form, setForm] = useState(null);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [picker, setPicker] = useState(null);
  const [dateField, setDateField] = useState(null);
  const [tab, setTab] = useState('main');
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    // Справочники необязательны: без права на каталог обе ручки ответят 403, и
    // это не повод не дать поправить серийный номер.
    Promise.allSettled([
      warehouseApi.asset(assetId),
      warehouseApi.categories(),
      warehouseApi.contractors(),
    ]).then(([assetResult, categoryResult, supplierResult]) => {
      if (!alive) return;
      if (assetResult.status !== 'fulfilled') { setForm(false); return; }
      const {asset} = assetResult.value.data;
      navigation.setOptions({title: asset.inventoryNumber});
      setForm({
        name: asset.name || '',
        model: asset.model || '',
        manufacturer: asset.manufacturer || '',
        serialNumber: asset.serialNumber || '',
        categoryId: asset.categoryId || null,
        status: asset.status || 'in_use',
        supplierId: asset.supplierId || null,
        notes: asset.notes || '',
        initialCost: asset.initialCost == null ? '' : String(asset.initialCost),
        accumulatedDepreciation: asset.accumulatedDepreciation == null
          ? '' : String(asset.accumulatedDepreciation),
        usefulLifeMonths: asset.usefulLifeMonths == null ? '' : String(asset.usefulLifeMonths),
        depreciationGroup: asset.depreciationGroup == null ? '' : String(asset.depreciationGroup),
        depreciationMethod: asset.depreciationMethod || 'linear',
        okof: asset.okof || '',
        purchaseDate: asset.purchaseDate || null,
        commissioningDate: asset.commissioningDate || null,
        warrantyUntil: asset.warrantyUntil || null,
        maintenanceIntervalMonths: asset.maintenanceIntervalMonths == null
          ? '' : String(asset.maintenanceIntervalMonths),
        nextMaintenanceDate: asset.nextMaintenanceDate || null,
      });
      if (categoryResult.status === 'fulfilled') setCategories(categoryResult.value.data || []);
      if (supplierResult.status === 'fulfilled') setSuppliers(supplierResult.value.data || []);
    });
    return () => { alive = false; };
  }, [assetId, navigation]));

  const set = (key, value) => setForm(prev => ({...prev, [key]: value}));

  const categoryOptions = useMemo(
    () => (categories || [])
      .filter(item => item.kind !== 'material')
      .map(item => ({value: item.id, label: item.name})),
    [categories],
  );
  const supplierOptions = useMemo(
    () => (suppliers || []).map(item => ({value: item.id, label: item.name})),
    [suppliers],
  );

  const save = async () => {
    if (!form.name.trim()) {
      setTab('main');
      return Alert.alert('Не сохранено', 'Укажите наименование.');
    }
    setSaving(true);
    try {
      // Пустая строка означает «очистить поле», и сервер понимает её именно так.
      // Числа приводим здесь: строка «12,5» из поля ввода до модели доехать не
      // должна.
      const num = value => (value === '' ? '' : Number(String(value).replace(',', '.')));
      await warehouseApi.updateAsset(assetId, {
        name: form.name.trim(),
        model: form.model.trim(),
        manufacturer: form.manufacturer.trim(),
        serialNumber: form.serialNumber.trim(),
        categoryId: form.categoryId || '',
        status: form.status,
        supplierId: form.supplierId || '',
        notes: form.notes.trim(),
        initialCost: num(form.initialCost),
        accumulatedDepreciation: num(form.accumulatedDepreciation),
        usefulLifeMonths: num(form.usefulLifeMonths),
        depreciationGroup: num(form.depreciationGroup),
        depreciationMethod: form.depreciationMethod,
        okof: form.okof.trim(),
        purchaseDate: form.purchaseDate || '',
        commissioningDate: form.commissioningDate || '',
        warrantyUntil: form.warrantyUntil || '',
        maintenanceIntervalMonths: num(form.maintenanceIntervalMonths),
        nextMaintenanceDate: form.nextMaintenanceDate || '',
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Не сохранено', e?.response?.data?.error || 'Проверьте поля.');
      setSaving(false);
    }
  };

  if (form === false) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Карточка не открылась</Text>
      </View>
    );
  }
  if (!form) return <LogoLoader />;

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

  const dateFieldRow = (label, key) => (
    <Pressable style={styles.field} onPress={() => setDateField(key)}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.select}>
        <Text style={[styles.selectText, !form[key] && styles.selectEmpty]}>
          {form[key] ? dateText(form[key]) : 'Не указана'}
        </Text>
        {form[key] ? (
          <Pressable onPress={() => set(key, null)} hitSlop={10}>
            <X size={15} color={c.textTertiary} />
          </Pressable>
        ) : (
          <ChevronRight size={16} color={c.textTertiary} />
        )}
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
        <SwipeTabs
          tabs={[
            {key: 'main', label: 'Основное'},
            {key: 'money', label: 'Стоимость'},
            {key: 'service', label: 'Обслуживание'},
          ]}
          value={tab}
          onChange={setTab}>
          <View style={styles.card}>
            {field('Наименование', 'name', {multiline: true})}
            {field('Модель', 'model', {placeholder: 'Mindray DC-70 Exp'})}
            {field('Производитель', 'manufacturer')}
            {field('Серийный номер', 'serialNumber', {autoCapitalize: 'characters'})}
            {choice('Категория', 'categoryId', categoryOptions)}
            {choice('Статус', 'status', STATUS_OPTIONS)}
            {choice('Поставщик', 'supplierId', supplierOptions)}
            {field('Примечание', 'notes', {multiline: true})}
          </View>

          <View style={styles.card}>
            {field('Первоначальная стоимость, ₽', 'initialCost', {keyboardType: 'numeric'})}
            {field('Накопленная амортизация, ₽', 'accumulatedDepreciation', {keyboardType: 'numeric'})}
            {field('Срок полезного использования, мес.', 'usefulLifeMonths', {keyboardType: 'numeric'})}
            {field('Амортизационная группа', 'depreciationGroup', {keyboardType: 'numeric'})}
            {choice('Способ начисления', 'depreciationMethod', DEPRECIATION_METHODS)}
            {field('Код ОКОФ', 'okof', {placeholder: '320.26.60.12'})}
            {dateFieldRow('Дата покупки', 'purchaseDate')}
            {dateFieldRow('Дата ввода в эксплуатацию', 'commissioningDate')}
          </View>

          <View style={styles.card}>
            {dateFieldRow('Гарантия до', 'warrantyUntil')}
            {field('Интервал ТО, мес.', 'maintenanceIntervalMonths', {keyboardType: 'numeric'})}
            {dateFieldRow('Следующее ТО', 'nextMaintenanceDate')}
          </View>
        </SwipeTabs>
      </ScrollView>

      <GlassBar style={[styles.bar, {paddingBottom: insets.bottom + 12}]}>
        <Pressable
          style={[styles.button, saving && styles.buttonOff]}
          disabled={saving}
          onPress={save}>
          {saving
            ? <ActivityIndicator size="small" color="#FFFFFF" />
            : <Check size={17} color="#FFFFFF" />}
          <Text style={styles.buttonText}>{saving ? 'Сохраняю…' : 'Сохранить'}</Text>
        </Pressable>
      </GlassBar>

      {Boolean(picker) && (
        <Modal animationType="slide" onRequestClose={() => setPicker(null)}>
          <GlassBackdrop>
            <View style={[styles.modal, {paddingTop: insets.top + 12}]}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>{picker.label}</Text>
                <Pressable onPress={() => setPicker(null)} hitSlop={10}>
                  <X size={22} color={c.textPrimary} />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.modalList}>
                {/* «Не выбрано» — законный ответ: категория и поставщик известны
                    не всегда, а обязать выбрать значит получить наугад проставленный
                    справочник. Статус же есть всегда, и очищать его нечем. */}
                {picker.key !== 'status' && picker.key !== 'depreciationMethod' && (
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
          </GlassBackdrop>
        </Modal>
      )}

      {/* Системный выбор даты: на Android это отдельный диалог, поэтому
          компонент монтируется только на время показа — тот же приём, что в
          форме события календаря. */}
      {Boolean(dateField) && (
        <DateTimePicker
          value={form[dateField] ? new Date(form[dateField]) : new Date()}
          mode="date"
          onChange={(event, picked) => {
            setDateField(null);
            if (event.type === 'set' && picked) set(dateField, isoDate(picked));
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1},
  content: {padding: 16},
  card: {
    width: '100%',
    ...glassSurface(c),
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  field: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glassLine(c),
  },
  label: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginBottom: 3},
  input: {
    fontFamily: font.medium,
    fontSize: 15,
    color: c.textPrimary,
    padding: 0,
    minHeight: 24,
  },
  inputArea: {minHeight: 44, textAlignVertical: 'top'},
  select: {flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24},
  selectText: {flex: 1, fontFamily: font.medium, fontSize: 15, color: c.textPrimary},
  selectEmpty: {color: c.textTertiary},

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
    height: 48,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    ...accentShadow(c.primary),
  },
  buttonOff: {opacity: 0.5},
  buttonText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},

  modal: {flex: 1},
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
    ...glassSurface(c),
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 6,
  },
  modalRowText: {flex: 1, fontFamily: font.medium, fontSize: 15, color: c.textPrimary},
  modalEmpty: {flex: 1, fontFamily: font.regular, fontSize: 15, color: c.textTertiary},

  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32},
  emptyText: {fontFamily: font.regular, fontSize: 14, color: c.textSecondary},
});
