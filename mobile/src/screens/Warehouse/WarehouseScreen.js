/**
 * Склад — главный экран раздела.
 *
 * Не список ссылок, каким он был до ver. 7.22, а сводка с органами управления:
 * сверху состояние ведомости, ниже — то, ради чего сюда заходят. Разница не
 * косметическая. Со списком человек читал шесть строк подписей, чтобы понять,
 * есть ли для него работа; теперь ответ на этот вопрос — первое, что он видит,
 * и он же кнопка, ведущая к самой работе.
 *
 * Порядок отражает частоту, а не важность: сканер сразу под сводкой, потому что
 * за ним тянутся чаще всего — «что это за прибор и чей он».
 *
 * Пояснений здесь нет намеренно. Раньше внизу висел абзац о том, что осталось в
 * вебе, и подпись под каждой строкой; на телефоне, который держат одной рукой в
 * коридоре, это не читают, а объём текста мешает найти нужную кнопку.
 */
import React, {useCallback, useState} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet, RefreshControl} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {
  ScanLine, ClipboardCheck, DoorOpen, ChevronRight, Lock, PackagePlus, Settings2,
  BellRing, Package, Boxes, ArrowLeftRight,
} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {
  useWarehouseAccess, loadWarehouseAccess, setWarehouseBadge,
} from '../../store/warehouseStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {qtyText} from './warehouseMeta';

/** «Открытых описей: 2» без подстановки чисел в чужие падежи. */
const plural = (n, one, few, many) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

export default function WarehouseScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  // Кнопка «Альфа» лежит поверх экранов и не занимает места в раскладке —
  // высоту под неё экран резервирует сам (см. tabBarLayout).
  const contentStyle = {padding: 16, paddingBottom: tabInset + 24};
  const cached = useWarehouseAccess();
  // Ответ последней попытки — на случай, когда сети нет и магазин ничего не
  // запомнил: без него экран остался бы с access === null навсегда.
  const [attempt, setAttempt] = useState(null);
  const access = cached || attempt;
  const [queue, setQueue] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const granted = await loadWarehouseAccess();
      setAttempt(granted);
      if (!granted.allowed) return;

      // Очередь размещения и открытые описи — то, из-за чего сюда вообще
      // заходят. Обе ручки необязательны: без права на ведомость первая
      // ответит 403, и это не повод показывать экран ошибки.
      const [queueResult, sessionsResult] = await Promise.allSettled([
        // mode: 'all' — тот же счёт, что и на экране размещения. В режиме по
        // умолчанию строки, держащиеся на кабинете ветки, считаются
        // размещёнными, и главная показывала бы работы меньше, чем её есть.
        warehouseApi.placementQueue({limit: 1, mode: 'all'}),
        warehouseApi.inventorySessions(),
      ]);
      if (queueResult.status === 'fulfilled') setQueue(queueResult.value.data);
      if (sessionsResult.status === 'fulfilled') {
        const list = sessionsResult.value.data || [];
        setSessions(list);
        // Тот же счётчик, что на кнопке склада в колесе: раз описи уже
        // запрошены, второй запрос ради цифры не нужен.
        setWarehouseBadge(
          list.filter(s => s.status !== 'closed' && s.status !== 'cancelled').length,
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <LogoLoader />;

  if (!access?.allowed) {
    return (
      <View style={styles.denied}>
        <Lock size={30} color={c.textTertiary} />
        <Text style={styles.deniedTitle}>Нет доступа к складскому учёту</Text>
      </View>
    );
  }

  const openSessions = sessions.filter(s => s.status !== 'closed' && s.status !== 'cancelled');
  const canPrint = Boolean(access.capabilities?.canPrintLabels);
  const totals = queue?.totals;
  const placed = Number(totals?.placedUnits || 0);
  const waiting = Number(totals?.unplacedUnits || 0);
  // Доля считается по единицам, а подпись — по позициям. Единицы для доли
  // годятся (это отношение), а показывать их числом нельзя: в ведомости рядом
  // со штуками лежат метры и литры, и «18 863,51 единиц» читается как ошибка.
  const done = placed + waiting > 0 ? Math.round((placed / (placed + waiting)) * 100) : null;

  // Отдельных разделов под этикетки здесь нет. Печать переехала туда, где
  // выбирают, что печатать: двери отмечают прямо в списке кабинетов, а этикетки
  // оборудования — в самом кабинете, глядя на полку. Две вкладки, каждая из
  // которых начиналась с «выберите кабинет», спрашивали об одном и том же
  // дважды.
  const tiles = [
    {
      key: 'rooms',
      icon: DoorOpen,
      title: 'Кабинеты',
      route: 'WarehouseRooms',
    },
    // Оборудование и материалы разделами, как в вебе: до карточки прибора
    // раньше можно было добраться только через кабинет или сканированием, то
    // есть зная, где он стоит, — а спрашивают обычно наоборот.
    {
      key: 'assets',
      icon: Package,
      title: 'Оборудование',
      route: 'WarehouseAssets',
    },
    {
      key: 'stock',
      icon: Boxes,
      title: 'Материалы',
      route: 'WarehouseStock',
    },
    {
      key: 'operations',
      icon: ArrowLeftRight,
      title: 'Операции',
      route: 'WarehouseOperations',
    },
    {
      key: 'inventory',
      icon: ClipboardCheck,
      title: 'Инвентаризация',
      badge: openSessions.length || null,
      route: 'WarehouseInventoryList',
    },
    // Регламентные отчёты (ver. 7.25). Раньше они уходили только почтой в 07:30,
    // а её читают за компьютером — то есть не тогда, когда отчёт нужен.
    {
      key: 'mailings',
      icon: BellRing,
      title: 'Отчёты',
      route: 'WarehouseMailings',
    },
  ];

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
      {/* Сводка по ведомости — она же вход в размещение. Отдельной строки
          «Размещение» больше нет: работа и её состояние это одно и то же, и
          показывать их двумя элементами значило бы просить прочитать дважды.

          Карточка сделана из тех же материалов, что и остальной экран, а не
          цветным блоком: градиент во всю ширину перетягивал на себя внимание с
          того, ради чего сюда заходят, и ни с чем на экране не рифмовался.
          Ведомость и её период с карточки убраны — на телефоне это работа
          «разложи, что перед тобой», а из какого файла оно приехало, решают в
          вебе. */}
      {Boolean(queue?.import) && (
        <Pressable
          style={styles.placement}
          onPress={() => navigation.navigate('WarehousePlacement')}>
          <View style={styles.placementHead}>
            <View style={styles.tileIcon}>
              <PackagePlus size={20} color={c.primary} />
            </View>
            <View style={styles.placementText}>
              <Text style={styles.placementTitle}>Размещение</Text>
              <Text style={styles.placementCaption}>
                {queue.total > 0
                  ? `${qtyText(queue.total)} ${plural(queue.total, 'позиция ждёт', 'позиции ждут', 'позиций ждут')} кабинета`
                  : 'всё разложено по кабинетам'}
              </Text>
            </View>
            <ChevronRight size={18} color={c.textTertiary} />
          </View>

          {done !== null && (
            <View style={styles.progress}>
              <View style={styles.bar}>
                {/* Минимум 2 % ширины: иначе на едва начатой ведомости заливки
                    не видно вовсе, и полоса читается сломанной, а не пустой */}
                <View style={[styles.barFill, {width: `${Math.max(done, 2)}%`}]} />
              </View>
              <Text style={styles.percent}>{done} %</Text>
            </View>
          )}
        </Pressable>
      )}

      {/* Сканер — самое частое действие, поэтому не плитка в ряду, а полоса во
          всю ширину: её находят не глядя. */}
      <Pressable
        style={styles.scan}
        onPress={() => navigation.navigate('WarehouseScanner')}>
        <View style={styles.scanIcon}>
          <ScanLine size={22} color="#FFFFFF" />
        </View>
        <Text style={styles.scanText}>Сканировать QR</Text>
        <ChevronRight size={18} color={c.textTertiary} />
      </Pressable>

      <View style={styles.grid}>
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Pressable
              key={tile.key}
              style={styles.tile}
              onPress={() => navigation.navigate(tile.route, tile.params)}>
              <View style={styles.tileIcon}>
                <Icon size={20} color={c.primary} />
              </View>
              {Boolean(tile.badge) && (
                <View style={styles.tileBadge}>
                  <Text style={styles.tileBadgeText}>{tile.badge}</Text>
                </View>
              )}
              <Text style={styles.tileTitle}>{tile.title}</Text>
            </Pressable>
          );
        })}
      </View>

      {canPrint && (
        <Pressable
          style={styles.settings}
          onPress={() => navigation.navigate('WarehousePrinter')}>
          <Settings2 size={17} color={c.textSecondary} />
          <Text style={styles.settingsText}>Принтер этикеток</Text>
          <ChevronRight size={16} color={c.textTertiary} />
        </Pressable>
      )}
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},

  placement: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  placementHead: {flexDirection: 'row', alignItems: 'center', gap: 12},
  placementText: {flex: 1},
  placementTitle: {fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary},
  placementCaption: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  progress: {flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14},
  bar: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: c.bgTertiary,
    overflow: 'hidden',
  },
  barFill: {height: 5, borderRadius: 3, backgroundColor: c.primary},
  percent: {fontFamily: font.semiBold, fontSize: 12, color: c.textSecondary},

  scan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginTop: 14,
  },
  scanIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanText: {flex: 1, fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary},

  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12},
  // Две в ряд: ширина считается от промежутка, а не долей, — flexBasis в
  // процентах вместе с gap даёт на узких экранах перенос второй плитки.
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 108,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    padding: 14,
    justifyContent: 'space-between',
  },
  tileIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTitle: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary, marginTop: 12},
  tileBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    minWidth: 22,
    paddingHorizontal: 7,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBadgeText: {fontFamily: font.semiBold, fontSize: 12, color: '#FFFFFF'},

  settings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginTop: 12,
  },
  settingsText: {flex: 1, fontFamily: font.medium, fontSize: 14, color: c.textPrimary},

  denied: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, backgroundColor: c.bgSecondary},
  deniedTitle: {fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary, textAlign: 'center'},
});
