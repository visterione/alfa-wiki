/**
 * Инвентаризации: список описей.
 *
 * Открытие новой описи до ver. 7.22 было доступно только в вебе — считалось, что
 * это распорядительное действие «за столом». На деле получалось иначе: человек
 * приходил в кабинет считать и упирался в пустой список, потому что завести
 * опись должен был кто-то другой. Теперь кнопка есть и здесь, а всё
 * распорядительное (председатель, комиссия, область шире кабинета) по-прежнему
 * заполняется в вебе — см. InventoryNewScreen.
 *
 * Закрытые описи в списке тоже показываются: к ним возвращаются, чтобы свериться
 * с прошлым разом.
 */
import React, {useCallback, useState} from 'react';
import {View, Text, FlatList, Pressable, StyleSheet, RefreshControl} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {ChevronRight, Plus} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {useWarehouseCan} from '../../store/warehouseStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {INVENTORY_STATUS, dateText, roomText} from './warehouseMeta';

export default function WarehouseInventoryListScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  const contentStyle = {padding: 16, paddingBottom: tabInset + 24};
  // Открыть опись может тот же, кто проводит операции: право одно на оба
  // действия, и разделять их сервер не станет.
  const canStart = useWarehouseCan('canIssue');
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => warehouseApi.inventorySessions()
    .then(({data}) => setSessions(data || []))
    .catch(() => setSessions([]))
    .finally(() => { setLoading(false); setRefreshing(false); }), []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <LogoLoader />;

  const open = sessions.filter(s => s.status !== 'closed' && s.status !== 'cancelled');
  const closed = sessions.filter(s => s.status === 'closed' || s.status === 'cancelled');

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={contentStyle}
      data={[...open, ...closed]}
      keyExtractor={item => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={c.textTertiary}
        />
      }
      ListHeaderComponent={
        // Кнопка строкой в начале списка, а не полосой внизу: снизу лежит
        // плавающая кнопка «Альфа», и они перекрыли бы друг друга.
        canStart ? (
          <Pressable
            style={styles.start}
            onPress={() => navigation.navigate('WarehouseInventoryNew')}>
            <View style={styles.startIcon}>
              <Plus size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.startText}>Начать инвентаризацию</Text>
          </Pressable>
        ) : null
      }
      ListEmptyComponent={
        <Text style={styles.none}>Инвентаризаций ещё не было</Text>
      }
      renderItem={({item}) => {
        const isOpen = item.status !== 'closed' && item.status !== 'cancelled';
        return (
          <Pressable
            style={[styles.row, !isOpen && styles.rowDone]}
            onPress={() => navigation.navigate('WarehouseInventoryCount', {sessionId: item.id})}>
            <View style={styles.rowText}>
              <Text style={styles.number}>{item.number}</Text>
              <Text style={styles.where}>
                {item.room ? roomText(item.room) : item.department?.name || 'вся сеть'}
              </Text>
              <Text style={styles.meta}>
                {INVENTORY_STATUS[item.status] || item.status}
                {' · '}
                {dateText(item.startedAt)}
                {item.chairman?.displayName ? ` · ${item.chairman.displayName}` : ''}
              </Text>
            </View>
            <ChevronRight size={18} color={c.textTertiary} />
          </Pressable>
        );
      }}
    />
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 10,
  },
  // Закрытая опись приглушена, но остаётся кликабельной: к ней возвращаются
  // свериться, а не работать с ней.
  rowDone: {opacity: 0.6},
  rowText: {flex: 1},
  number: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  where: {fontFamily: font.medium, fontSize: 13, color: c.textSecondary, marginTop: 2},
  meta: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary, marginTop: 3},
  start: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  startIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startText: {flex: 1, fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  none: {
    fontFamily: font.regular,
    fontSize: 13,
    color: c.textTertiary,
    textAlign: 'center',
    marginTop: 30,
  },
});
