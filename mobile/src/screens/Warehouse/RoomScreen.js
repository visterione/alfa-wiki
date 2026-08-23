/**
 * Кабинет — что в нём стоит и что в нём лежит.
 *
 * Открывается тремя путями: сканированием QR с двери, из списка кабинетов и
 * переходом из карточки актива. Последний важнее, чем кажется: увидев прибор,
 * человек почти всегда хочет посмотреть, что ещё есть в этом кабинете, — и
 * обратный путь «актив → кабинет → другой актив» здесь замкнут.
 *
 * Схема этажа сверху отвечает на вопрос, которого не было ни в одном списке:
 * «а это вообще где?». Соседние кабинеты на ней намеренно без метрик — см.
 * RoomMiniMap.
 *
 * Оборудование и материалы разделены вкладками, а не свалены в один список:
 * у них разные вопросы. У оборудования спрашивают «в каком оно состоянии», у
 * материалов — «сколько осталось и не просрочено ли».
 *
 * ── Печать ───────────────────────────────────────────────────────────────────
 *
 * Раньше здесь было три строки-ссылки: «Этикетка на дверь», «Этикетки на
 * непромаркированное», «Перепечатать всё оборудование». Что именно вылезет из
 * принтера, выяснялось уже на ленте. Теперь этикетка кабинета показывается как
 * есть, а оборудование отбирают галочками прямо в списке — там же, где на него
 * смотрят, — и перед печатью видно наклейку первого отмеченного.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronRight, Printer, Check, X} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import LabelPreview from '../../components/LabelPreview';
import RoomMiniMap from '../../components/RoomMiniMap';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {useWarehouseCan} from '../../store/warehouseStore';
import {ASSET_STATUS, statusColor, qtyText, dateText} from './warehouseMeta';

export default function WarehouseRoomScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const {roomId} = route.params || {};
  const [data, setData] = useState(null);
  const [plan, setPlan] = useState(null);
  // Право «Этикетки и QR» отдельное от права на учёт: дашборд кабинета про
  // печать ничего не знает, и права берутся из общего магазина.
  const canPrint = useWarehouseCan('canPrintLabels');
  const [tab, setTab] = useState('assets');
  const [picking, setPicking] = useState(false);
  const [checked, setChecked] = useState(() => new Set());
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let alive = true;
    warehouseApi.roomDashboard(roomId)
      .then(({data: payload}) => {
        if (!alive) return;
        setData(payload);
        navigation.setOptions({title: `Каб. ${payload.room.number}`});
        // Схема — отдельным запросом и только если кабинет вообще привязан к
        // этажу: она украшение по отношению к самому дашборду, и падение её
        // запроса не должно уносить с собой карточку кабинета.
        if (!payload.room.floorId) return;
        warehouseApi.floorPlan(payload.room.floorId)
          .then(({data: floor}) => alive && setPlan(floor))
          // Пустой объект, а не null: null означает «ещё грузится», и после
          // отказа схема осталась бы вечной заглушкой вместо сообщения.
          .catch(() => alive && setPlan({}));
      })
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [roomId, navigation]));

  const {room, cards, assets, stock} = useMemo(() => ({
    room: data?.room,
    cards: data?.cards,
    assets: data?.assets || [],
    stock: data?.stock || [],
  }), [data]);

  // Непромаркированное — то, ради чего в кабинет и заходят с принтером: после
  // разбора ведомости в кабинете появляются новые карточки, а стоящее тут годами
  // уже оклеено. Отметку ставит сама печать (labelPrintedAt), так что список
  // тает по мере работы и в конце обхода становится пустым.
  const unlabeled = useMemo(() => assets.filter(a => !a.labelPrintedAt), [assets]);

  if (loading) return <LogoLoader />;
  if (!data) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Кабинет не открылся</Text>
      </View>
    );
  }

  const startPicking = () => {
    setTab('assets');
    setPicking(true);
    // Непромаркированное отмечается сразу: это обычная работа, а отмечать её
    // руками по одной строке после разбора ведомости — десятки нажатий.
    setChecked(new Set(unlabeled.map(a => a.id)));
  };

  const toggle = id => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allOn = assets.length > 0 && assets.every(a => checked.has(a.id));
  const firstPicked = assets.find(a => checked.has(a.id));

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[
          styles.content,
          {paddingBottom: insets.bottom + (picking && checked.size ? 200 : 32)},
        ]}>
        <Text style={styles.title}>{room.name || `Кабинет ${room.number}`}</Text>
        <Text style={styles.subtitle}>
          {[room.medCenter, room.building, room.floor && `${room.floor} этаж`, room.department?.name]
            .filter(Boolean).join(' · ')}
        </Text>
        {Boolean(room.responsible?.displayName) && (
          <Text style={styles.subtitle}>МОЛ: {room.responsible.displayName}</Text>
        )}

        {Boolean(room.floorId) && (
          <View style={styles.block}>
            <RoomMiniMap plan={plan} roomId={room.id} />
          </View>
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

        {canPrint && (
          <View style={styles.block}>
            <Text style={styles.section}>Этикетка на дверь</Text>
            <View style={styles.labelCard}>
              <LabelPreview url={warehouseApi.doorCardUrl(room.id)} />
              <Pressable
                style={styles.labelButton}
                onPress={() => navigation.navigate('WarehouseLabelPrint', {
                  kind: 'room',
                  ids: [room.id],
                  title: `Каб. ${room.number}`,
                })}>
                <Printer size={16} color={c.primary} />
                <Text style={styles.labelButtonText}>Напечатать</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.tabs}>
          {[['assets', `Оборудование (${assets.length})`], ['stock', `Материалы (${stock.length})`]]
            .map(([key, label]) => (
              <Pressable
                key={key}
                style={[styles.tab, tab === key && styles.tabOn]}
                onPress={() => { setTab(key); setPicking(false); }}>
                <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{label}</Text>
              </Pressable>
            ))}
        </View>

        {/* Строка отбора появляется только на вкладке оборудования и только у
            того, кому разрешена печать: у материалов этикеток нет вовсе. */}
        {tab === 'assets' && canPrint && assets.length > 0 && (
          <Pressable
            style={styles.pickBar}
            onPress={() => (picking
              ? setChecked(allOn ? new Set() : new Set(assets.map(a => a.id)))
              : startPicking())}>
            {picking ? (
              <>
                <Text style={styles.pickText}>Отмечено: {checked.size}</Text>
                <Text style={styles.pickAction}>{allOn ? 'снять' : 'выбрать всё'}</Text>
              </>
            ) : (
              <>
                <Printer size={15} color={c.primary} />
                <Text style={styles.pickText}>Этикетки на оборудование</Text>
                {unlabeled.length > 0 && (
                  <Text style={styles.pickAction}>без этикетки: {unlabeled.length}</Text>
                )}
              </>
            )}
            {picking && (
              <Pressable onPress={() => setPicking(false)} hitSlop={10}>
                <X size={16} color={c.textTertiary} />
              </Pressable>
            )}
          </Pressable>
        )}

        {tab === 'assets' && (
          <View style={styles.card}>
            {assets.map(asset => (
              <Pressable
                key={asset.id}
                style={styles.row}
                onPress={() => (picking
                  ? toggle(asset.id)
                  : navigation.push('WarehouseAsset', {assetId: asset.id}))}>
                {picking ? (
                  <View style={[styles.box, checked.has(asset.id) && styles.boxOn]}>
                    {checked.has(asset.id) && <Check size={13} color="#FFFFFF" />}
                  </View>
                ) : (
                  <View style={[styles.dot, {backgroundColor: statusColor(c, asset.status)}]} />
                )}
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{asset.name}</Text>
                  <Text style={styles.rowSub}>
                    {asset.inventoryNumber} · {ASSET_STATUS[asset.status] || asset.status}
                  </Text>
                </View>
                {!picking && <ChevronRight size={16} color={c.textTertiary} />}
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

      {/* Полоса печати с наклейкой первого отмеченного. Показывать все — значит
          грузить десяток растров ради одного взгляда; показывать ни одного —
          вернуться к тому, от чего уходили. Первый отвечает на вопрос «то ли
          вообще поедет в принтер». */}
      {picking && checked.size > 0 && (
        <View style={[styles.printBar, {paddingBottom: insets.bottom + 12}]}>
          {Boolean(firstPicked) && (
            <View style={styles.printPreview}>
              <LabelPreview
                url={warehouseApi.assetLabelUrl(firstPicked.id)}
                style={styles.printPreviewLabel}
              />
              {checked.size > 1 && (
                <Text style={styles.printMore}>и ещё {checked.size - 1}</Text>
              )}
            </View>
          )}
          <Pressable
            style={styles.button}
            onPress={() => navigation.navigate('WarehouseLabelPrint', {
              kind: 'asset',
              ids: [...checked],
              title: `Каб. ${room.number}`,
            })}>
            <Printer size={17} color="#FFFFFF" />
            <Text style={styles.buttonText}>Печать · {checked.size}</Text>
          </Pressable>
        </View>
      )}
    </View>
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
  content: {padding: 16},
  title: {fontFamily: font.semiBold, fontSize: 19, color: c.textPrimary},
  subtitle: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 3},
  block: {marginTop: 16},
  section: {
    fontFamily: font.semiBold,
    fontSize: 13,
    color: c.textSecondary,
    marginBottom: 8,
  },
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

  labelCard: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    padding: 12,
    gap: 10,
  },
  labelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
  },
  labelButtonText: {fontFamily: font.semiBold, fontSize: 14, color: c.primary},

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

  pickBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    borderRadius: radius.md,
    backgroundColor: c.bgPrimary,
  },
  pickText: {flex: 1, fontFamily: font.medium, fontSize: 13, color: c.textPrimary},
  pickAction: {fontFamily: font.medium, fontSize: 12, color: c.primary},

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
  box: {
    width: 21,
    height: 21,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: {backgroundColor: c.primary, borderColor: c.primary},
  rowText: {flex: 1},
  rowTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary, lineHeight: 19},
  rowSub: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 2},
  qty: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, padding: 16, textAlign: 'center'},

  printBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: c.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  printPreview: {flexDirection: 'row', alignItems: 'center', gap: 10},
  // Ширина задана числом, а не долей: у превью жёсткое отношение сторон ленты,
  // и растянутое на всю строку оно отобрало бы место у подписи «и ещё N».
  // Мельче настоящей этикетки — это опознавательный знак «то ли поедет», а не
  // предмет для чтения; читают его на самом экране печати.
  printPreviewLabel: {width: 150},
  printMore: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary},
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: c.primary,
  },
  buttonText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},

  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: c.bgSecondary},
  emptyText: {fontFamily: font.regular, fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20},
});
