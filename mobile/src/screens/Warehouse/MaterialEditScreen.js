/**
 * Правка карточки материала — то же самое, что правка оборудования, но для
 * позиции справочника.
 *
 * ── Что здесь можно и чего нельзя ────────────────────────────────────────────
 *
 * Правится описание позиции: как называется, в чём меряется, к какому классу
 * относится, нужен ли ей учёт по партиям. Количества здесь нет и быть не может:
 * остаток меняется приходом, выдачей или списанием, то есть документом. Поле
 * «сколько лежит», которое можно переписать руками, превратило бы склад в
 * блокнот — расхождение с журналом появлялось бы молча и обнаруживалось на
 * инвентаризации.
 *
 * ── Почему это нужно на телефоне ─────────────────────────────────────────────
 *
 * Разбор ведомости заводит номенклатуру по строке из 1С: имя как в бухгалтерии,
 * единица «шт» по умолчанию, категории нет. Что это на самом деле — перчатки в
 * парах или бинт в метрах — видно на полке, а не в файле.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, StyleSheet, Alert, Modal, Switch,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Check, ChevronRight, X} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import GlassBackdrop from '../../components/GlassBackdrop';
import GlassBar from '../../components/GlassBar';
import {radius, font, glassSurface, glassOverlay, accentShadow, glassLine} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';

export default function WarehouseMaterialEditScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const {nomenclatureId, name: initialName} = route.params || {};

  const [form, setForm] = useState(null);
  const [categories, setCategories] = useState([]);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    // Отдельной ручки «одна позиция номенклатуры» нет, а заводить её ради формы
    // незачем: список приходит с поиском по имени и возвращает единицы строк.
    Promise.allSettled([
      warehouseApi.nomenclature({q: initialName, limit: 50}),
      warehouseApi.categories(),
    ]).then(([listResult, categoryResult]) => {
      if (!alive) return;
      // Ручка отдаёт {total, items} — постраничный список, а не массив
      const rows = listResult.status === 'fulfilled' ? (listResult.value.data?.items || []) : [];
      const row = rows.find(item => item.id === nomenclatureId);
      if (!row) { setForm(false); return; }
      navigation.setOptions({title: row.code || 'Материал'});
      setForm({
        name: row.name || '',
        unit: row.unit || 'шт',
        categoryId: row.categoryId || null,
        isMedicine: Boolean(row.isMedicine),
        isSterile: Boolean(row.isSterile),
        tracksBatch: Boolean(row.tracksBatch),
      });
      if (categoryResult.status === 'fulfilled') setCategories(categoryResult.value.data || []);
    });
    return () => { alive = false; };
  }, [nomenclatureId, initialName, navigation]));

  const set = (key, value) => setForm(prev => ({...prev, [key]: value}));

  const categoryOptions = useMemo(
    () => (categories || [])
      .filter(item => item.kind !== 'asset')
      .map(item => ({value: item.id, label: item.name})),
    [categories],
  );

  const save = async () => {
    if (!form.name.trim()) return Alert.alert('Не сохранено', 'Укажите наименование.');
    if (!form.unit.trim()) return Alert.alert('Не сохранено', 'Укажите единицу измерения.');
    setSaving(true);
    try {
      await warehouseApi.updateNomenclature(nomenclatureId, {
        name: form.name.trim(),
        unit: form.unit.trim(),
        categoryId: form.categoryId || '',
        isMedicine: form.isMedicine,
        isSterile: form.isSterile,
        tracksBatch: form.tracksBatch,
      });
      return navigation.goBack();
    } catch (e) {
      Alert.alert('Не сохранено', e?.response?.data?.error || 'Проверьте поля.');
      return setSaving(false);
    }
  };

  if (form === false) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Позиция не открылась</Text>
      </View>
    );
  }
  if (!form) return <LogoLoader />;

  const toggle = (label, key, hint) => (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={styles.rowSub}>{hint}</Text>
      </View>
      <Switch
        value={form[key]}
        onValueChange={value => set(key, value)}
        trackColor={{true: c.primary}}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 90}]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.label}>Наименование</Text>
            <TextInput
              style={[styles.input, styles.inputArea]}
              value={form.name}
              onChangeText={value => set('name', value)}
              multiline
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Единица измерения</Text>
            <TextInput
              style={styles.input}
              value={form.unit}
              onChangeText={value => set('unit', value)}
              placeholder="шт, м, л, пара"
              placeholderTextColor={c.textTertiary}
            />
          </View>
          <Pressable style={styles.field} onPress={() => setPicker(true)}>
            <Text style={styles.label}>Категория</Text>
            <View style={styles.select}>
              <Text
                style={[styles.selectText, !form.categoryId && styles.selectEmpty]}
                numberOfLines={1}>
                {categoryOptions.find(o => o.value === form.categoryId)?.label || 'Не выбрана'}
              </Text>
              <ChevronRight size={16} color={c.textTertiary} />
            </View>
          </Pressable>
        </View>

        <View style={[styles.card, styles.cardGap]}>
          {toggle('Медикамент', 'isMedicine', 'Попадает в отчёты по лекарствам')}
          {toggle('Стерильное', 'isSterile', 'Учитывается в контроле стерильности')}
          {/* Учёт по партиям включает FEFO: расход пойдёт с ближайшего срока
              годности. Без сроков это только лишний шаг при каждой выдаче. */}
          {toggle('Учёт по партиям', 'tracksBatch', 'Со сроками годности, расход по FEFO')}
        </View>
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

      {picker && (
        <Modal animationType="slide" onRequestClose={() => setPicker(false)}>
          <GlassBackdrop>
            <View style={[styles.modal, {paddingTop: insets.top + 12}]}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>Категория</Text>
                <Pressable onPress={() => setPicker(false)} hitSlop={10}>
                  <X size={22} color={c.textPrimary} />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.modalList}>
                <Pressable
                  style={styles.modalRow}
                  onPress={() => { set('categoryId', null); setPicker(false); }}>
                  <Text style={styles.modalEmpty}>Не выбрана</Text>
                </Pressable>
                {categoryOptions.map(option => (
                  <Pressable
                    key={option.value}
                    style={styles.modalRow}
                    onPress={() => { set('categoryId', option.value); setPicker(false); }}>
                    <Text style={styles.modalRowText}>{option.label}</Text>
                    {form.categoryId === option.value && <Check size={16} color={c.primary} />}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </GlassBackdrop>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1},
  content: {padding: 16},
  card: {...glassSurface(c), borderRadius: radius.lg, paddingHorizontal: 14},
  cardGap: {marginTop: 14},
  field: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glassLine(c),
  },
  label: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginBottom: 3},
  input: {fontFamily: font.medium, fontSize: 15, color: c.textPrimary, padding: 0, minHeight: 24},
  inputArea: {minHeight: 44, textAlignVertical: 'top'},
  select: {flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24},
  selectText: {flex: 1, fontFamily: font.medium, fontSize: 15, color: c.textPrimary},
  selectEmpty: {color: c.textTertiary},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glassLine(c),
  },
  rowText: {flex: 1},
  rowTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  rowSub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},

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
