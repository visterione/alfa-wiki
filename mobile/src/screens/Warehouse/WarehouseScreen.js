/**
 * Склад — главный экран вкладки.
 *
 * Это не дашборд с цифрами, а стартовая площадка: четыре занятия, каждое из
 * которых начинается с того, что человек достал телефон, стоя в помещении.
 * Сводка сверху нужна ровно затем, чтобы понять, есть ли работа, — а не чтобы
 * её изучать. Отчёты, планы этажей и справочники остались в вебе.
 *
 * Порядок разделов отражает частоту, а не важность: сканер сверху, потому что за
 * ним тянутся чаще всего — «что это за прибор и чей он».
 */
import React, {useCallback, useState} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet, RefreshControl} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {ScanLine, ClipboardCheck, PackagePlus, DoorOpen, ChevronRight, Lock} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {qtyText} from './warehouseMeta';

export default function WarehouseScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  // Панель лежит поверх экранов и не занимает места в раскладке — высоту под неё
  // экран резервирует сам (см. tabBarLayout).
  const contentStyle = {padding: 16, paddingBottom: tabInset + 24};
  const [access, setAccess] = useState(null);
  const [queue, setQueue] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const {data} = await warehouseApi.access();
      setAccess(data);
      if (!data.allowed) return;

      // Очередь размещения и открытые описи — то, из-за чего сюда вообще
      // заходят. Обе ручки необязательны: без права на ведомость первая
      // ответит 403, и это не повод показывать экран ошибки.
      const [queueResult, sessionsResult] = await Promise.allSettled([
        warehouseApi.placementQueue({limit: 1}),
        warehouseApi.inventorySessions(),
      ]);
      if (queueResult.status === 'fulfilled') setQueue(queueResult.value.data);
      if (sessionsResult.status === 'fulfilled') setSessions(sessionsResult.value.data || []);
    } catch {
      setAccess({allowed: false});
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    load().then(() => alive);
    return () => { alive = false; };
  }, [load]));

  if (loading) return <LogoLoader />;

  if (!access?.allowed) {
    return (
      <View style={styles.denied}>
        <Lock size={30} color={c.textTertiary} />
        <Text style={styles.deniedTitle}>Нет доступа к складскому учёту</Text>
        <Text style={styles.deniedText}>
          Раздел закрыт отдельным правом. Попросите администратора включить
          доступ «Складской учёт» в вашей карточке.
        </Text>
      </View>
    );
  }

  const openSessions = sessions.filter(s => s.status !== 'closed' && s.status !== 'cancelled');
  const unplaced = queue?.totals?.unplacedUnits;

  const sections = [
    {
      key: 'scanner',
      icon: ScanLine,
      title: 'Сканер',
      subtitle: 'QR с этикетки или с двери кабинета',
      route: 'WarehouseScanner',
    },
    {
      key: 'inventory',
      icon: ClipboardCheck,
      title: 'Инвентаризация',
      subtitle: openSessions.length
        ? `Открытых описей: ${openSessions.length}`
        : 'Открытых описей нет',
      badge: openSessions.length || null,
      route: 'WarehouseInventoryList',
    },
    {
      key: 'placement',
      icon: PackagePlus,
      title: 'Размещение',
      subtitle: queue
        ? `Не разложено позиций: ${queue.total}`
        : 'Разложить имущество по кабинетам',
      badge: queue?.total || null,
      route: 'WarehousePlacement',
      hidden: !queue,
    },
    {
      key: 'rooms',
      icon: DoorOpen,
      title: 'Кабинеты',
      subtitle: 'Что и где стоит',
      route: 'WarehouseScanner',
      params: {mode: 'room'},
    },
  ].filter(s => !s.hidden);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={contentStyle}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={c.textTertiary}
        />
      }>
      {Boolean(queue?.import) && (
        <View style={styles.card}>
          <Text style={styles.cardValue}>
            {unplaced > 0 ? qtyText(unplaced) : '✓'}
          </Text>
          <Text style={styles.cardCaption}>
            {unplaced > 0
              ? 'единиц имущества ещё не разложено по кабинетам'
              : 'всё имущество ведомости разложено по кабинетам'}
          </Text>
        </View>
      )}

      <View style={styles.list}>
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Pressable
              key={section.key}
              style={styles.row}
              onPress={() => navigation.navigate(section.route, section.params)}>
              <View style={styles.rowIcon}>
                <Icon size={20} color={c.primary} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{section.title}</Text>
                <Text style={styles.rowSubtitle}>{section.subtitle}</Text>
              </View>
              {Boolean(section.badge) && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{section.badge}</Text>
                </View>
              )}
              <ChevronRight size={18} color={c.textTertiary} />
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.note}>
        Настройка кабинетов, планы этажей, словарь предметов, отчёты и закупки
        остались в веб-версии: это работа за столом. Здесь — то, что делают на
        ногах.
      </Text>
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  card: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  cardValue: {fontFamily: font.semiBold, fontSize: 32, color: c.textPrimary},
  cardCaption: {
    fontFamily: font.regular,
    fontSize: 13,
    color: c.textSecondary,
    marginTop: 5,
    textAlign: 'center',
  },
  list: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, overflow: 'hidden'},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {flex: 1},
  rowTitle: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  rowSubtitle: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  badge: {
    minWidth: 22,
    paddingHorizontal: 7,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {fontFamily: font.semiBold, fontSize: 12, color: '#FFFFFF'},
  note: {
    fontFamily: font.regular,
    fontSize: 12,
    color: c.textTertiary,
    lineHeight: 18,
    marginTop: 18,
  },
  denied: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10, backgroundColor: c.bgSecondary},
  deniedTitle: {fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary, textAlign: 'center'},
  deniedText: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19},
});
