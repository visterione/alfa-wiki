/**
 * Остатки материалов по сети — те же данные, что в таблице веба.
 *
 * В вебе это десять колонок: код, наименование, партия, срок годности, остаток,
 * единица, минимум, сумма, место хранения, кабинет. Ужать их в ширину телефона
 * нельзя, а выбросить половину — значит показать не тот же список. Поэтому те
 * же поля разложены карточкой: что за позиция, сколько её и где она лежит.
 *
 * Отбор — в листе, а не полосой кнопок наверху: признаков четыре, и ряд из
 * четырёх чипов занимал бы место, которое нужнее самому списку.
 *
 * Сервер отдаёт остатки без постраничности, зато с зоной ответственности:
 * человек видит те кабинеты, за которые отвечает. Поэтому поиск и отбор
 * считаются на клиенте — список уже здесь.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Search, SlidersHorizontal, Pencil, MapPin, CalendarClock} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import BottomSheet from '../../components/BottomSheet';
import {useWarehouseAccess, useWarehouseCan} from '../../store/warehouseStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {qtyText, moneyText, dateText, roomText} from './warehouseMeta';

const EMPTY = {expired: false, expiring: false, below: false, medicine: false};

export default function WarehouseStockScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  const canEdit = useWarehouseCan('canManageCatalog');
  const access = useWarehouseAccess();
  const canSeeCosts = Boolean(access?.capabilities?.canSeeCosts);

  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(EMPTY);
  const [sheet, setSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => warehouseApi.stock({includeZero: 'false'})
    .then(({data}) => setRows(Array.isArray(data) ? data : (data?.items || [])))
    .catch(() => setRows([]))
    .finally(() => setRefreshing(false)), []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || [])
      .filter(row => (!filters.expired || row.expired))
      .filter(row => (!filters.expiring || row.expiringSoon))
      .filter(row => (!filters.below || row.stockStatus === 'below'))
      .filter(row => (!filters.medicine || row.nomenclature?.isMedicine))
      .filter(row => !needle
        || String(row.nomenclature?.name || '').toLowerCase().includes(needle)
        || String(row.nomenclature?.code || '').toLowerCase().includes(needle));
  }, [rows, q, filters]);

  const active = Object.values(filters).some(Boolean);

  if (!rows) return <LogoLoader />;

  return (
    <View style={styles.root}>
      <View style={styles.tools}>
        <View style={styles.search}>
          <Search size={15} color={c.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Наименование или код"
            placeholderTextColor={c.textTertiary}
            autoCorrect={false}
          />
        </View>
        <Pressable
          style={[styles.filterBtn, active && styles.filterBtnOn]}
          onPress={() => setSheet(true)}
          accessibilityLabel="Отбор">
          <SlidersHorizontal size={18} color={active ? '#FFFFFF' : c.textSecondary} />
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, {paddingBottom: tabInset + 24}]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={c.textTertiary}
          />
        }
        ListHeaderComponent={<Text style={styles.total}>Позиций: {items.length}</Text>}
        ListEmptyComponent={<Text style={styles.none}>Ничего не нашлось</Text>}
        renderItem={({item}) => {
          const nom = item.nomenclature || {};
          // Цвет остатка отвечает на «надо ли что-то делать»: просрочка красным,
          // приближение к минимуму — жёлтым. Остальное обычным.
          const tone = item.expired ? c.error : item.stockStatus === 'below' ? c.warning : null;
          return (
            <Pressable
              style={styles.card}
              disabled={!canEdit}
              onPress={() => navigation.navigate('WarehouseMaterialEdit', {
                nomenclatureId: nom.id,
                name: nom.name,
              })}>
              <View style={styles.cardHead}>
                <Text style={styles.code}>{nom.code}</Text>
                {canEdit && <Pencil size={13} color={c.textTertiary} />}
              </View>

              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={2}>{nom.name}</Text>
                <Text style={[styles.qty, tone && {color: tone}]}>
                  {qtyText(item.quantity)} {nom.unit}
                </Text>
              </View>

              {Boolean(item.batch?.batchNumber || item.batch?.expiryDate) && (
                <View style={styles.meta}>
                  <CalendarClock size={11} color={tone || c.textTertiary} />
                  <Text style={[styles.metaText, tone && {color: tone}]} numberOfLines={1}>
                    {[
                      item.batch?.batchNumber && `партия ${item.batch.batchNumber}`,
                      item.batch?.expiryDate && `годен до ${dateText(item.batch.expiryDate)}`,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              )}

              <View style={styles.meta}>
                <MapPin size={11} color={c.textTertiary} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {[roomText(item.storage?.room), item.storage?.name].filter(Boolean).join(' · ')}
                </Text>
              </View>

              <View style={styles.foot}>
                {item.minQty !== null && item.minQty !== undefined && (
                  <Text style={styles.footText}>Минимум {qtyText(item.minQty)}</Text>
                )}
                {canSeeCosts && Boolean(Number(item.amount)) && (
                  <Text style={styles.footText}>{moneyText(item.amount)}</Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />

      <BottomSheet visible={sheet} title="Отбор" onClose={() => setSheet(false)}>
        <View style={styles.sheet}>
          {[
            ['expired', 'Просроченные'],
            ['expiring', 'Истекают в ближайший месяц'],
            ['below', 'Ниже минимума'],
            ['medicine', 'Только медикаменты'],
          ].map(([key, label]) => (
            <Pressable
              key={key}
              style={[styles.option, filters[key] && styles.optionOn]}
              onPress={() => setFilters(f => ({...f, [key]: !f[key]}))}>
              <Text style={[styles.optionText, filters[key] && styles.optionTextOn]}>
                {label}
              </Text>
            </Pressable>
          ))}

          <Pressable style={styles.reset} onPress={() => setFilters(EMPTY)}>
            <Text style={styles.resetText}>Сбросить отбор</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  tools: {flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, paddingBottom: 10},
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
  filterBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: c.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnOn: {backgroundColor: c.primary},
  list: {paddingHorizontal: 16},
  total: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary, marginBottom: 8},

  card: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 8,
    gap: 4,
  },
  cardHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  code: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary},
  nameRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
  name: {flex: 1, fontFamily: font.medium, fontSize: 14, color: c.textPrimary, lineHeight: 19},
  qty: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  meta: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2},
  metaText: {flex: 1, fontFamily: font.regular, fontSize: 11, color: c.textTertiary},
  foot: {flexDirection: 'row', gap: 14, marginTop: 4},
  footText: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary},

  sheet: {padding: 16, gap: 8},
  option: {
    paddingHorizontal: 14,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: c.bgSecondary,
    justifyContent: 'center',
  },
  optionOn: {backgroundColor: c.primary},
  optionText: {fontFamily: font.medium, fontSize: 14, color: c.textSecondary},
  optionTextOn: {color: '#FFFFFF'},
  reset: {alignItems: 'center', paddingVertical: 14, marginTop: 4},
  resetText: {fontFamily: font.medium, fontSize: 14, color: c.error},

  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', marginTop: 30},
});
