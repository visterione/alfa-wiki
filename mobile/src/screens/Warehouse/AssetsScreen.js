/**
 * Всё оборудование сети — карточками, с теми же данными, что в таблице веба.
 *
 * ── Почему карточки, а не строки ─────────────────────────────────────────────
 *
 * В вебе это таблица на восемь колонок: инвентарный номер, наименование,
 * серийный, размещение, МОЛ, статус, следующее ТО, стоимость. Ужать восемь
 * колонок в ширину телефона нельзя, а выбросить половину — значит показать не
 * тот же список. Поэтому те же поля разложены карточкой в три яруса: чем
 * является, где стоит, в каком состоянии.
 *
 * ── Фильтры в листе, а не полосой ────────────────────────────────────────────
 *
 * Раньше здесь стоял ряд «чипов» по статусу — и статусом отбор не
 * заканчивается: в вебе есть ещё медцентр, отделение и «ТО на подходе». Ряд из
 * восьми кнопок съел бы верх экрана, поэтому отбор живёт в листе, а на экране
 * остаётся одна кнопка с точкой, когда фильтр включён.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import {Search, SlidersHorizontal, Wrench, User as UserIcon, MapPin} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import BottomSheet from '../../components/BottomSheet';
import {loadLocationTree, useWarehouseAccess, useWarehouseMedCenter} from '../../store/warehouseStore';
import {useNetworkFallback, NetworkFallbackHint} from './MedCenterSwitch';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {ASSET_STATUS, statusColor, moneyText, dateText, roomText} from './warehouseMeta';

const PAGE = 50;
// Медцентра в этом наборе больше нет: он выбирается один на весь раздел в шапке
// склада (MedCenterSwitch). Две ручки на одну величину — глобальный выбор и
// строка в листе — спорили бы между собой, и выигрывала бы та, о которой
// человек помнит.
const EMPTY = {status: '', departmentId: '', maintenanceDue: false};

export default function WarehouseAssetsScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  const access = useWarehouseAccess();
  const canSeeCosts = Boolean(access?.capabilities?.canSeeCosts);
  const {medCenterId, ready} = useWarehouseMedCenter();

  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(EMPTY);
  const [sheet, setSheet] = useState(false);
  const [tree, setTree] = useState(null);
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // Каждый ответ помечается своим номером: при быстром наборе ответы приходят не
  // в том порядке, в каком ушли, и поздний ответ на старый запрос затирал бы
  // свежий результат.
  const request = useRef(0);

  useEffect(() => { loadLocationTree().then(setTree); }, []);

  const load = useCallback((page = 1) => {
    const mine = request.current + 1;
    request.current = mine;
    if (page > 1) setLoadingMore(true);

    return warehouseApi.assets({
      q: q.trim() || undefined,
      status: filters.status || undefined,
      medCenterId: medCenterId || undefined,
      departmentId: filters.departmentId || undefined,
      maintenanceDue: filters.maintenanceDue ? 'true' : undefined,
      page,
      limit: PAGE,
    })
      .then(({data}) => {
        if (request.current !== mine) return;
        setTotal(data.total || 0);
        setItems(prev => (page > 1 ? [...(prev || []), ...(data.items || [])] : (data.items || [])));
      })
      .catch(() => request.current === mine && setItems([]))
      .finally(() => request.current === mine && setLoadingMore(false));
  }, [q, filters, medCenterId]);

  // Поиск с задержкой: запрос на каждую букву — это запрос на каждую букву.
  // Пока медцентр читается из памяти телефона, запрос не уходит вовсе: иначе
  // первым ответом пришла бы вся сеть и список моргнул бы чужими карточками.
  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => load(1), q ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, q, ready]);

  const active = filters.status || filters.departmentId || filters.maintenanceDue;

  // Отделения принадлежат медцентру, поэтому список сужается вместе с ним:
  // выбирать отделение чужого центра, глядя на список своего, бессмысленно.
  const departments = useMemo(() => {
    const all = tree?.departments || [];
    return medCenterId ? all.filter(d => d.medCenterId === medCenterId) : all;
  }, [tree, medCenterId]);

  // Пустой список должен уметь отличить «нет нигде» от «нет здесь» — иначе
  // человек решит, что карточки прибора не существует, и заведёт вторую.
  const probeNetwork = useCallback(
    () => warehouseApi.assets({
      q: q.trim() || undefined,
      status: filters.status || undefined,
      maintenanceDue: filters.maintenanceDue ? 'true' : undefined,
      page: 1,
      limit: 1,
    }).then(({data}) => data.total || 0),
    [q, filters.status, filters.maintenanceDue],
  );
  const foundInNetwork = useNetworkFallback(probeNetwork, {
    enabled: Boolean(medCenterId) && Boolean(items) && items.length === 0,
  });

  return (
    <View style={styles.root}>
      <View style={styles.tools}>
        <View style={styles.search}>
          <Search size={15} color={c.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Наименование, инв. или серийный номер"
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

      {!items ? <LogoLoader /> : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.list, {paddingBottom: tabInset + 24}]}
          keyboardShouldPersistTaps="handled"
          // Дозагрузка по мере прокрутки: карточек в сети тысячи, и отдать их
          // одним куском значит держать телефон занятым секунды
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (loadingMore || items.length >= total) return;
            load(Math.floor(items.length / PAGE) + 1);
          }}
          ListHeaderComponent={<Text style={styles.total}>Найдено: {total}</Text>}
          ListEmptyComponent={
            <>
              <Text style={styles.none}>Ничего не нашлось</Text>
              <NetworkFallbackHint found={foundInNetwork} />
            </>
          }
          ListFooterComponent={loadingMore
            ? <ActivityIndicator size="small" color={c.textTertiary} style={styles.more} />
            : null}
          renderItem={({item}) => (
            <Pressable
              style={styles.card}
              onPress={() => navigation.navigate('WarehouseAsset', {assetId: item.id})}>
              <View style={styles.cardHead}>
                <Text style={styles.number}>{item.inventoryNumber}</Text>
                <View style={[styles.chip, {backgroundColor: `${statusColor(c, item.status)}22`}]}>
                  <Text style={[styles.chipText, {color: statusColor(c, item.status)}]}>
                    {ASSET_STATUS[item.status] || item.status}
                  </Text>
                </View>
              </View>

              <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
              {Boolean(item.model || item.serialNumber) && (
                <Text style={styles.sub} numberOfLines={1}>
                  {[item.model, item.serialNumber && `S/N ${item.serialNumber}`]
                    .filter(Boolean).join(' · ')}
                </Text>
              )}

              <View style={styles.meta}>
                <MapPin size={11} color={c.textTertiary} />
                <Text style={styles.metaText} numberOfLines={1}>{roomText(item.room)}</Text>
              </View>
              {Boolean(item.responsible?.displayName) && (
                <View style={styles.meta}>
                  <UserIcon size={11} color={c.textTertiary} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {item.responsible.displayName}
                  </Text>
                </View>
              )}
              {Boolean(item.nextMaintenanceDate) && (
                <View style={styles.meta}>
                  <Wrench size={11} color={c.textTertiary} />
                  <Text style={styles.metaText}>
                    След. ТО {dateText(item.nextMaintenanceDate)}
                  </Text>
                </View>
              )}
              {/* Стоимость только тем, кому её видно: право проверяет сервер, и
                  прятать блок по догадке клиента нельзя — но и показывать
                  пустое место, когда суммы не пришли, незачем */}
              {canSeeCosts && Boolean(Number(item.initialCost)) && (
                <Text style={styles.cost}>{moneyText(item.initialCost)}</Text>
              )}
            </Pressable>
          )}
        />
      )}

      <BottomSheet visible={sheet} title="Отбор" onClose={() => setSheet(false)}>
        <View style={styles.sheet}>
          <Text style={styles.sheetLabel}>Статус</Text>
          <View style={styles.options}>
            <Option
              styles={styles}
              label="Любой"
              on={!filters.status}
              onPress={() => setFilters(f => ({...f, status: ''}))}
            />
            {Object.entries(ASSET_STATUS).map(([key, label]) => (
              <Option
                key={key}
                styles={styles}
                label={label}
                on={filters.status === key}
                onPress={() => setFilters(f => ({...f, status: key}))}
              />
            ))}
          </View>

          {departments.length > 0 && (
            <>
              <Text style={styles.sheetLabel}>Отделение</Text>
              <View style={styles.options}>
                <Option
                  styles={styles}
                  label="Все"
                  on={!filters.departmentId}
                  onPress={() => setFilters(f => ({...f, departmentId: ''}))}
                />
                {departments.map(dep => (
                  <Option
                    key={dep.id}
                    styles={styles}
                    label={dep.name}
                    on={filters.departmentId === dep.id}
                    onPress={() => setFilters(f => ({...f, departmentId: dep.id}))}
                  />
                ))}
              </View>
            </>
          )}

          <Option
            styles={styles}
            label="Только с ТО на подходе"
            on={filters.maintenanceDue}
            onPress={() => setFilters(f => ({...f, maintenanceDue: !f.maintenanceDue}))}
          />

          <Pressable style={styles.reset} onPress={() => setFilters(EMPTY)}>
            <Text style={styles.resetText}>Сбросить отбор</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </View>
  );
}

function Option({styles, label, on, onPress}) {
  return (
    <Pressable style={[styles.option, on && styles.optionOn]} onPress={onPress}>
      <Text style={[styles.optionText, on && styles.optionTextOn]}>{label}</Text>
    </Pressable>
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
  cardHead: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2},
  // Инвентарный номер — то, по чему прибор ищут и сверяют с этикеткой, поэтому
  // он стоит первым и набран крупнее наименования
  number: {flex: 1, fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary},
  chip: {paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10},
  chipText: {fontFamily: font.semiBold, fontSize: 11},
  name: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary, lineHeight: 19},
  sub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary},
  meta: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2},
  metaText: {flex: 1, fontFamily: font.regular, fontSize: 11, color: c.textTertiary},
  cost: {fontFamily: font.semiBold, fontSize: 13, color: c.textSecondary, marginTop: 4},

  sheet: {padding: 16, gap: 8},
  sheetLabel: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary, marginTop: 6},
  options: {flexDirection: 'row', flexWrap: 'wrap', gap: 7},
  option: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.bgSecondary,
    justifyContent: 'center',
  },
  optionOn: {backgroundColor: c.primary},
  optionText: {fontFamily: font.medium, fontSize: 13, color: c.textSecondary},
  optionTextOn: {color: '#FFFFFF'},
  reset: {alignItems: 'center', paddingVertical: 14, marginTop: 6},
  resetText: {fontFamily: font.medium, fontSize: 14, color: c.error},

  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', marginTop: 30},
  more: {marginVertical: 16},
});
