/**
 * Кабинет — что в нём стоит и что в нём лежит.
 *
 * Открывается тремя путями: сканированием QR с двери, из списка кабинетов и
 * переходом из карточки актива. Последний важнее, чем кажется: увидев прибор,
 * человек почти всегда хочет посмотреть, что ещё есть в этом кабинете.
 *
 * ── Порядок на экране ────────────────────────────────────────────────────────
 *
 * Первой идёт этикетка на дверь. Заголовка над ней нет: наклейка с крупным
 * номером узнаётся сама, а подпись «Этикетка на дверь» повторяла бы то, что и
 * так нарисовано. Дальше схема этажа — она отвечает на «а это вообще где?».
 * Дальше списки.
 *
 * Ни названия кабинета, ни пути (медцентр, корпус, этаж) на самой странице нет:
 * всё это переехало в шапку. Строка «Каб. 434 (Архив) | МЦ Альфа» отвечает на
 * тот же вопрос, но не отнимает у содержимого верхнюю треть экрана, а длинную
 * прокручивает бегущей строкой.
 *
 * Карточек с числом оборудования и материалов тоже нет. Те же числа стоят на
 * заголовках вкладок прямо под ними, и показывать их дважды означало занимать
 * экран пересказом самого себя.
 *
 * ── Печать ───────────────────────────────────────────────────────────────────
 *
 * Этикетка кабинета показывается как есть, а оборудование отбирают галочками
 * прямо в списке — там же, где на него смотрят, — и перед печатью видно
 * наклейку первого отмеченного.
 */
import React, {useCallback, useLayoutEffect, useMemo, useState} from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Alert, useWindowDimensions,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronRight, Printer, Check, X, Undo2, Pencil} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import LabelPreview from '../../components/LabelPreview';
import MarqueeText from '../../components/MarqueeText';
import RoomMiniMap from '../../components/RoomMiniMap';
import SwipeTabs from '../../components/SwipeTabs';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {useWarehouseAccess, useWarehouseCan} from '../../store/warehouseStore';
import {ASSET_STATUS, statusColor, qtyText, dateText} from './warehouseMeta';

export default function WarehouseRoomScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const {roomId} = route.params || {};
  const [data, setData] = useState(null);
  const [plan, setPlan] = useState(null);
  // Право «Этикетки и QR» отдельное от права на учёт: дашборд кабинета про
  // печать ничего не знает, и права берутся из общего магазина.
  const canPrint = useWarehouseCan('canPrintLabels');
  const canEditMaterials = useWarehouseCan('canManageCatalog');
  const access = useWarehouseAccess();
  const [tab, setTab] = useState('assets');
  const [picking, setPicking] = useState(false);
  const [checked, setChecked] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState(false);

  const load = useCallback(() => {
    warehouseApi.roomDashboard(roomId)
      .then(({data: payload}) => {
        setData(payload);
        // Схема — отдельным запросом и только если кабинет вообще привязан к
        // этажу: она украшение по отношению к самому дашборду, и падение её
        // запроса не должно уносить с собой карточку кабинета.
        if (!payload.room.floorId) return;
        warehouseApi.floorPlan(payload.room.floorId)
          .then(({data: floor}) => setPlan(floor))
          // Пустой объект, а не null: null означает «ещё грузится», и после
          // отказа схема осталась бы вечной заглушкой вместо сообщения.
          .catch(() => setPlan({}));
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [roomId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const {room, cards, assets, stock} = useMemo(() => ({
    room: data?.room,
    cards: data?.cards,
    assets: data?.assets || [],
    stock: data?.stock || [],
  }), [data]);

  /**
   * Шапка: «Каб. 434 (Архив) | МЦ Альфа».
   *
   * Бегущей строкой, а не многоточием: обрезав, мы спрячем как раз медцентр —
   * а номер 434 есть в каждом здании сети, и без него строка отвечает на
   * половину вопроса.
   */
  useLayoutEffect(() => {
    if (!room) return;
    const title = [
      `Каб. ${room.number}${room.name && room.name !== room.number ? ` (${room.name})` : ''}`,
      room.medCenter,
    ].filter(Boolean).join(' | ');

    navigation.setOptions({
      headerTitle: () => (
        // Ширина задаётся числом, а не долей: бегущая строка узнаёт о том, что
        // текст не влез, сравнивая его с шириной контейнера, а контейнер
        // заголовка в native-stack по умолчанию сжимается по содержимому — и
        // сравнивать было бы не с чем. Вычитаем стрелку «назад» и поля.
        <MarqueeText style={styles.headerTitle} containerStyle={{width: width - 110}}>
          {title}
        </MarqueeText>
      ),
    });
  }, [room, navigation, styles, width]);

  // Непромаркированное — то, ради чего в кабинет и заходят с принтером: после
  // разбора ведомости в кабинете появляются новые карточки, а стоящее тут годами
  // уже оклеено. Отметку ставит сама печать (labelPrintedAt), так что список
  // тает по мере работы и в конце обхода становится пустым.
  const unlabeled = useMemo(() => assets.filter(a => !a.labelPrintedAt), [assets]);

  /**
   * Отмена размещения — временный инструмент отладки для администратора.
   *
   * Спрашиваем дважды не из вежливости: операция стирает карточки, остатки и
   * движения без следа, и промахнуться кабинетом здесь стоит дороже, чем
   * разложить не туда.
   */
  const rollback = () => Alert.alert(
    `Отменить размещение в каб. ${room.number}?`,
    'Оборудование и материалы, заведённые сюда разбором ведомости, будут удалены '
    + 'вместе с движениями, а строки вернутся в очередь размещения. Отменить это будет нельзя.',
    [
      {text: 'Нет', style: 'cancel'},
      {
        text: 'Отменить размещение',
        style: 'destructive',
        onPress: async () => {
          setRollingBack(true);
          try {
            const {data: report} = await warehouseApi.rollbackRoom(roomId);
            setPicking(false);
            setChecked(new Set());
            load();
            const lines = [
              `Снято размещений: ${report.placements}.`,
              report.assets && `удалено карточек: ${report.assets}`,
              report.stockRows && `снято позиций с остатка: ${report.stockRows}`,
              !report.placements && !report.assets && 'Отменять было нечего.',
              report.kept?.length && `Не тронуто (${report.kept.length}): ${report.kept[0].name} — ${report.kept[0].reason}`,
            ].filter(Boolean);
            Alert.alert('Размещение отменено', lines.join('\n'));
          } catch (e) {
            Alert.alert('Не отменено', e?.response?.data?.error || 'Попробуйте ещё раз.');
          } finally {
            setRollingBack(false);
          }
        },
      },
    ],
  );

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

  const assetsPage = (
    <View style={styles.page}>
      {/* Строка отбора появляется только у того, кому разрешена печать: у
          материалов этикеток нет вовсе. */}
      {canPrint && assets.length > 0 && (
        <Pressable
          style={styles.pickBar}
          onPress={() => (picking
            ? setChecked(allOn ? new Set() : new Set(assets.map(a => a.id)))
            : startPicking())}>
          {picking ? (
            <>
              <Text style={styles.pickText}>Отмечено: {checked.size}</Text>
              <Text style={styles.pickAction}>{allOn ? 'снять' : 'выбрать всё'}</Text>
              <Pressable onPress={() => setPicking(false)} hitSlop={10}>
                <X size={16} color={c.textTertiary} />
              </Pressable>
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
        </Pressable>
      )}

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
    </View>
  );

  const stockPage = (
    <View style={styles.page}>
      <View style={styles.card}>
        {stock.map((item, index) => (
          <Pressable
            key={`${item.nomenclatureId}-${index}`}
            style={styles.row}
            disabled={!canEditMaterials}
            onPress={() => navigation.navigate('WarehouseMaterialEdit', {
              nomenclatureId: item.nomenclatureId,
              name: item.name,
            })}>
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
            {canEditMaterials && <Pencil size={14} color={c.textTertiary} />}
          </Pressable>
        ))}
        {!stock.length && <Text style={styles.none}>Материалов в кабинете нет</Text>}
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[
          styles.content,
          {paddingBottom: insets.bottom + (picking && checked.size ? 200 : 32)},
        ]}>
        {canPrint && (
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
        )}

        {/* Просрочка, минимумы и просроченное ТО — единственное, что требует
            действия прямо сейчас. Ради них блок и остался после того, как
            карточки с числами убрали. */}
        {(cards.expiry.expired > 0 || cards.materials.belowMin > 0 || cards.maintenance.overdue > 0) && (
          <View style={styles.alert}>
            <Text style={styles.alertText}>
              {[
                cards.expiry.expired > 0 && `просрочено позиций: ${cards.expiry.expired}`,
                cards.materials.belowMin > 0 && `ниже минимума: ${cards.materials.belowMin}`,
                cards.maintenance.overdue > 0 && `просрочено ТО: ${cards.maintenance.overdue}`,
              ].filter(Boolean).join(', ')}
            </Text>
          </View>
        )}

        {Boolean(room.floorId) && (
          <View style={styles.block}>
            <RoomMiniMap plan={plan} roomId={room.id} />
          </View>
        )}

        {Boolean(room.responsible?.displayName) && (
          <Text style={styles.mol}>МОЛ: {room.responsible.displayName}</Text>
        )}

        <SwipeTabs
          style={styles.block}
          value={tab}
          onChange={setTab}
          tabs={[
            {key: 'assets', label: `Оборудование (${assets.length})`},
            {key: 'stock', label: `Материалы (${stock.length})`},
          ]}>
          {assetsPage}
          {stockPage}
        </SwipeTabs>

        {/* Временный инструмент отладки: стирает всё, что разбор ведомости
            завёл в этот кабинет. Только администратору и внизу страницы —
            рядом с полезными кнопками ему не место. */}
        {Boolean(access?.isAdmin) && (
          <Pressable
            style={styles.rollback}
            disabled={rollingBack}
            onPress={rollback}>
            <Undo2 size={15} color={c.error} />
            <Text style={styles.rollbackText}>
              {rollingBack ? 'Отменяю…' : 'Отменить размещение в кабинете'}
            </Text>
          </Pressable>
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

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 16},
  headerTitle: {fontFamily: font.semiBold, fontSize: 16, color: '#FFFFFF'},
  block: {marginTop: 14},
  page: {width: '100%'},
  mol: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 12},

  alert: {
    backgroundColor: c.primaryLight,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 14,
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

  rollback: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.error,
  },
  rollbackText: {fontFamily: font.medium, fontSize: 13, color: c.error},

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
