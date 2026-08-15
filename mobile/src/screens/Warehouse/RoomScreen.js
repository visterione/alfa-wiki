/**
 * Кабинет — что в нём стоит и что в нём лежит.
 *
 * Открывается двумя путями: сканированием QR с двери и переходом из карточки
 * актива. Второй важнее, чем кажется: увидев прибор, человек почти всегда хочет
 * посмотреть, что ещё есть в этом кабинете, — и обратный путь «актив → кабинет →
 * другой актив» здесь замкнут.
 *
 * Оборудование и материалы разделены вкладками, а не свалены в один список:
 * у них разные вопросы. У оборудования спрашивают «в каком оно состоянии», у
 * материалов — «сколько осталось и не просрочено ли».
 */
import React, {useCallback, useState} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {ChevronRight} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {ASSET_STATUS, statusColor, qtyText, dateText} from './warehouseMeta';

export default function WarehouseRoomScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const {roomId} = route.params || {};
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('assets');
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let alive = true;
    warehouseApi.roomDashboard(roomId)
      .then(({data: payload}) => {
        if (!alive) return;
        setData(payload);
        navigation.setOptions({title: `Каб. ${payload.room.number}`});
      })
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [roomId, navigation]));

  if (loading) return <LogoLoader />;
  if (!data) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Кабинет не открылся. Возможно, он не в вашей зоне ответственности.
        </Text>
      </View>
    );
  }

  const {room, cards, assets = [], stock = []} = data;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{room.name || `Кабинет ${room.number}`}</Text>
      <Text style={styles.subtitle}>
        {[room.medCenter, room.building, room.floor && `${room.floor} этаж`, room.department?.name]
          .filter(Boolean).join(' · ')}
      </Text>
      {Boolean(room.responsible?.displayName) && (
        <Text style={styles.subtitle}>МОЛ: {room.responsible.displayName}</Text>
      )}

      <View style={styles.stats}>
        <Stat styles={styles} value={cards.assets.total} label="оборудования" />
        <Stat styles={styles} value={cards.materials.positions} label="позиций материалов" />
        <Stat
          styles={styles}
          value={cards.maintenance.open}
          label="нарядов ТО"
          tone={cards.maintenance.overdue ? c.error : null}
        />
      </View>

      {(cards.expiry.expired > 0 || cards.materials.belowMin > 0) && (
        <View style={styles.alert}>
          <Text style={styles.alertText}>
            {[
              cards.expiry.expired > 0 && `просрочено позиций: ${cards.expiry.expired}`,
              cards.materials.belowMin > 0 && `ниже минимума: ${cards.materials.belowMin}`,
            ].filter(Boolean).join(', ')}
          </Text>
        </View>
      )}

      <View style={styles.tabs}>
        {[['assets', `Оборудование (${assets.length})`], ['stock', `Материалы (${stock.length})`]]
          .map(([key, label]) => (
            <Pressable
              key={key}
              style={[styles.tab, tab === key && styles.tabOn]}
              onPress={() => setTab(key)}>
              <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
      </View>

      {tab === 'assets' && (
        <View style={styles.card}>
          {assets.map(asset => (
            <Pressable
              key={asset.id}
              style={styles.row}
              onPress={() => navigation.push('WarehouseAsset', {assetId: asset.id})}>
              <View style={[styles.dot, {backgroundColor: statusColor(c, asset.status)}]} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={2}>{asset.name}</Text>
                <Text style={styles.rowSub}>
                  {asset.inventoryNumber} · {ASSET_STATUS[asset.status] || asset.status}
                </Text>
              </View>
              <ChevronRight size={16} color={c.textTertiary} />
            </Pressable>
          ))}
          {!assets.length && <Text style={styles.none}>Оборудования в кабинете нет</Text>}
        </View>
      )}

      {tab === 'stock' && (
        <View style={styles.card}>
          {stock.map((item, index) => (
            <View key={`${item.nomenclatureId}-${index}`} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.rowSub}>
                  {[
                    item.storageName,
                    item.batchNumber && `партия ${item.batchNumber}`,
                    item.expiryDate && `до ${dateText(item.expiryDate)}`,
                  ].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text
                style={[
                  styles.qty,
                  item.expired && {color: c.error},
                  item.stockStatus === 'below' && {color: c.warning},
                ]}>
                {qtyText(item.quantity)} {item.unit}
              </Text>
            </View>
          ))}
          {!stock.length && <Text style={styles.none}>Материалов в кабинете нет</Text>}
        </View>
      )}
    </ScrollView>
  );
}

function Stat({styles, value, label, tone}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone && {color: tone}]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 16, paddingBottom: 32},
  title: {fontFamily: font.semiBold, fontSize: 19, color: c.textPrimary},
  subtitle: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 3},
  stats: {flexDirection: 'row', gap: 10, marginTop: 16},
  stat: {
    flex: 1,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: {fontFamily: font.semiBold, fontSize: 20, color: c.textPrimary},
  statLabel: {
    fontFamily: font.regular,
    fontSize: 11,
    color: c.textSecondary,
    marginTop: 3,
    textAlign: 'center',
  },
  alert: {
    backgroundColor: c.primaryLight,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 12,
  },
  alertText: {fontFamily: font.medium, fontSize: 12, color: c.textPrimary},
  tabs: {flexDirection: 'row', gap: 8, marginTop: 18, marginBottom: 10},
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: c.bgTertiary,
    alignItems: 'center',
  },
  tabOn: {backgroundColor: c.primary},
  tabText: {fontFamily: font.medium, fontSize: 13, color: c.textSecondary},
  tabTextOn: {color: '#FFFFFF'},
  card: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, overflow: 'hidden'},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  dot: {width: 8, height: 8, borderRadius: 4},
  rowText: {flex: 1},
  rowTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary, lineHeight: 19},
  rowSub: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 2},
  qty: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, padding: 16, textAlign: 'center'},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: c.bgSecondary},
  emptyText: {fontFamily: font.regular, fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20},
});
