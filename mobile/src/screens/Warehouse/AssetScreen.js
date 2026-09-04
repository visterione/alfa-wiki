/**
 * Карточка оборудования — то, что видит человек, отсканировав этикетку.
 *
 * Три вкладки отвечают на три разных вопроса: что это за прибор, сколько он
 * стоит и что с ним происходило. Переключаются и нажатием, и свайпом — вкладки
 * лежат под этикеткой, а не в шапке, и тянуться до них каждый раз незачем.
 *
 * ── Кабинет переехал в шапку ─────────────────────────────────────────────────
 *
 * Раньше строка «Каб. 434» стояла в теле страницы, и по ней открывался кабинет,
 * из списка которого открывался следующий прибор, из него снова кабинет —
 * стопка экранов росла на каждом шаге, и «назад» приходилось жать десяток раз.
 * Теперь это кнопка-дверь в правом углу шапки: тот же переход, но рядом с
 * инвентарным номером, а не посреди карточки, где он читался как часть данных.
 *
 * ── Что правится, а что нет ──────────────────────────────────────────────────
 *
 * Карандаш в шапке открывает форму правки (ver. 7.24): серийный номер, модель и
 * дату ввода в эксплуатацию знает тот, кто стоит перед прибором, а не тот, кто
 * сидит за компьютером. Кабинета и МОЛ в форме нет — их меняет документ
 * перемещения, см. AssetEditScreen.
 */
import React, {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Alert, useWindowDimensions,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {
  DoorOpen, Printer, Pencil, Boxes, Wrench, Undo2, ArrowLeftRight, ArrowRightLeft,
  PackageX,
} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import GlassCard from '../../components/GlassCard';
import LabelPreview from '../../components/LabelPreview';
import MarqueeText from '../../components/MarqueeText';
import SwipeTabs from '../../components/SwipeTabs';
import BottomSheet from '../../components/BottomSheet';
import RoomOperation from './RoomOperation';
import {radius, font, glassSurface, glassLine} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {useWarehouseCan} from '../../store/warehouseStore';
import {ASSET_STATUS, statusColor, moneyText, dateText, roomText} from './warehouseMeta';

/**
 * Что отменяется кнопкой. Приход и списание сюда не входят намеренно — почему,
 * см. backend/services/warehouse/reversal.js.
 */
const REVERSIBLE = new Set(['transfer', 'issue', 'return', 'repair_out', 'repair_in']);

const MOVEMENT_LABELS = {
  receipt: 'Приём', issue: 'Выдача', transfer: 'Перемещение', return: 'Возврат',
  writeoff: 'Списание', repair_out: 'В ремонт', repair_in: 'Из ремонта',
  surplus: 'Оприходование излишков',
};

export default function WarehouseAssetScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const {width} = useWindowDimensions();
  const {assetId} = route.params || {};
  const [data, setData] = useState(null);
  // Право на этикетки отдельное от права вести учёт: печатают их не те, кто
  // заполняет карточки. Без него кнопка печати не показывается вовсе — иначе
  // человек упрётся в 403 уже после того, как подошёл к принтеру.
  const canPrint = useWarehouseCan('canPrintLabels');
  const canEdit = useWarehouseCan('canManageAssets');
  // Переезд — это операция учёта, а не правка карточки: право на него своё.
  const canIssue = useWarehouseCan('canIssue');
  const canMaintenance = useWarehouseCan('canMaintenance');
  const [tab, setTab] = useState('main');
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  // Операции с прибором прямо из карточки (ver. 7.76). Сюда приходят,
  // отсканировав этикетку, — то есть стоя перед прибором, который надо
  // переставить или списать; идти за этим в журнал операций и там заново
  // искать этот же прибор в списке кабинета человеку незачем.
  const [ops, setOps] = useState(false);
  const [operation, setOperation] = useState(null);
  // Форма поднимается не в момент выбора, а когда шторка уедет с экрана: две
  // модалки, живущие одновременно, замораживают экран — см. RoomScreen.
  const afterSheet = useRef(null);
  const sheetClosed = useCallback(() => {
    const next = afterSheet.current;
    afterSheet.current = null;
    if (next) setOperation(next);
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    warehouseApi.asset(assetId)
      .then(({data: payload}) => {
        if (!alive) return;
        setData(payload);
      })
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [assetId]));

  const asset = data?.asset;

  const reload = useCallback(() => {
    warehouseApi.asset(assetId).then(({data: payload}) => setData(payload)).catch(() => {});
  }, [assetId]);

  /**
   * Быстрый переезд: на склад, в ремонт и обратно (ver. 7.47).
   *
   * Через общую форму документа это возможно и так, но «убрать в резерв» и
   * «вернуть на место» — движения ежедневные и делаются руками у самого прибора.
   * Форма из четырёх полей ради них означает, что их просто не оформят: вещь
   * уедет, а в портале останется в кабинете.
   *
   * Возврат из ремонта идёт закрытием ремонта, а не перемещением: иначе прибор
   * приедет в кабинет, оставшись со статусом «в ремонте», и по нему нельзя будет
   * открыть следующий ремонт.
   */
  const openRepair = data?.repairs?.find(r => !r.finishedAt) || null;
  const inService = Boolean(asset?.room?.isService);

  const run = async (title, action) => {
    setMoving(true);
    try {
      await action();
      reload();
    } catch (e) {
      Alert.alert(title, e?.response?.data?.error || 'Попробуйте ещё раз.');
    } finally {
      setMoving(false);
    }
  };

  const toService = serviceKind => run('Не перемещено',
    () => warehouseApi.placeAsset(assetId, {serviceKind}));

  const backToRoom = () => run('Не перемещено', () => warehouseApi.placeAsset(assetId, {}));

  const toRepair = () => Alert.alert(
    'Отдать в ремонт?',
    'Прибор переедет на склад «Ремонт» своего медцентра, а после закрытия ремонта '
    + 'вернётся в кабинет, откуда его забрали.',
    [
      {text: 'Отмена', style: 'cancel'},
      {
        text: 'В ремонт',
        onPress: () => run('Не отдано в ремонт', () => warehouseApi.createRepair({
          assetId,
          startedAt: new Date().toISOString().slice(0, 10),
        })),
      },
    ],
  );

  const fromRepair = () => run('Не возвращено', () => warehouseApi.closeRepair(openRepair.id, {
    result: 'repaired',
  }));

  /**
   * Отмена последней операции по прибору (ver. 7.50).
   *
   * Кнопка стоит здесь, а не только в журнале операций, потому что промах
   * замечают, глядя на сам прибор: «я его только что не туда отправил».
   * Отменяется именно последняя операция — если после неё что-то было, сервер
   * откажет и назовёт причину; проверять это на телефоне значит держать копию
   * правила, которая однажды разойдётся с настоящим.
   */
  const lastMove = data?.movements?.[0] || null;
  const undoable = lastMove?.documentId && REVERSIBLE.has(lastMove.type);

  const undoLast = () => Alert.alert(
    'Отменить последнюю операцию?',
    `${MOVEMENT_LABELS[lastMove.type] || lastMove.type}`
    + `${lastMove.fromRoom ? ` из ${roomText(lastMove.fromRoom)}` : ''}`
    + `${lastMove.toRoom ? ` в ${roomText(lastMove.toRoom)}` : ''}.`
    + '\nБудет проведён встречный документ — сама операция останется в истории.',
    [
      {text: 'Нет', style: 'cancel'},
      {
        text: 'Отменить операцию',
        style: 'destructive',
        onPress: () => run('Не отменено', () => warehouseApi.reverseDocument(lastMove.documentId)),
      },
    ],
  );

  /**
   * Карандаш и дверь в шапке. Дверь ведёт в кабинет прибора — тот же переход,
   * что был строкой в теле карточки, но отсюда он не выглядит частью данных и
   * не наращивает стопку «кабинет → прибор → кабинет» посреди чтения.
   */
  useLayoutEffect(() => {
    if (!asset) return;
    navigation.setOptions({
      // Инвентарный номер длинный, а справа от него теперь две кнопки: без
      // бегущей строки он обрезался бы ровно на той части, по которой прибор и
      // отличают от соседнего.
      headerTitle: () => (
        <MarqueeText style={styles.headerTitle} containerStyle={{width: width - 150}}>
          {asset.inventoryNumber}
        </MarqueeText>
      ),
      headerRight: () => (
        <View style={styles.headerButtons}>
          {canEdit && (
            <Pressable
              onPress={() => navigation.navigate('WarehouseAssetEdit', {assetId})}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Править карточку">
              <Pencil size={19} color="#FFFFFF" />
            </Pressable>
          )}
          {Boolean(asset.room) && (
            <Pressable
              onPress={() => navigation.navigate('WarehouseRoom', {roomId: asset.room.id})}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={roomText(asset.room)}>
              <DoorOpen size={20} color="#FFFFFF" />
            </Pressable>
          )}
        </View>
      ),
    });
  }, [asset, assetId, canEdit, navigation, styles, width]);

  if (loading) return <LogoLoader />;
  if (!data) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Карточка не открылась</Text>
      </View>
    );
  }

  const {depreciation, movements} = data;
  const rows = [
    ['Модель', asset.model],
    ['Производитель', asset.manufacturer],
    ['Серийный номер', asset.serialNumber],
    ['Категория', asset.category?.name],
    ['МОЛ', asset.responsible?.displayName],
    ['Следующее ТО', asset.nextMaintenanceDate ? dateText(asset.nextMaintenanceDate) : null],
    ['Гарантия до', asset.warrantyUntil ? dateText(asset.warrantyUntil) : null],
  ].filter(([, value]) => value);

  const mainPage = (
    <View style={styles.page}>
      {rows.length ? (
        <View style={styles.card}>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.rowLabel}>{label}</Text>
              <Text style={styles.rowValue}>{value}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.none}>Поля карточки пока не заполнены</Text>
      )}
    </View>
  );

  const moneyPage = (
    <View style={styles.page}>
      {/* Стоимость показывается, только если сервер её прислал: право «видеть
          суммы» проверяется там, и прятать блок по догадке клиента нельзя. */}
      {depreciation?.initialCost ? (
        <>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Первоначальная</Text>
              <Text style={styles.rowValue}>{moneyText(depreciation.initialCost)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Остаточная</Text>
              <Text style={styles.rowValue}>{moneyText(depreciation.residual)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Износ</Text>
              <Text style={styles.rowValue}>{depreciation.wearPercent} %</Text>
            </View>
          </View>
          {depreciation.fullyDepreciatedInUse && (
            <Text style={styles.warn}>
              Самортизировано полностью, но остаётся в работе — кандидат на замену.
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.none}>Стоимость не заполнена или закрыта правами</Text>
      )}
    </View>
  );

  const historyPage = (
    <View style={styles.page}>
      {movements?.length ? (
        <View style={styles.card}>
          {movements.slice(0, 12).map(movement => (
            <View key={movement.id} style={styles.moveRow}>
              <View style={styles.moveMain}>
                <Text style={styles.moveType}>
                  {MOVEMENT_LABELS[movement.type] || movement.type}
                </Text>
                <Text style={styles.moveWhen}>{dateText(movement.occurredAt)}</Text>
              </View>
              <Text style={styles.moveWhere}>
                {movement.fromRoom ? `${roomText(movement.fromRoom)} → ` : ''}
                {movement.toRoom ? roomText(movement.toRoom) : '—'}
              </Text>
              {Boolean(movement.reasonText) && (
                <Text style={styles.moveReason}>{movement.reasonText}</Text>
              )}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.none}>Движений по карточке ещё не было</Text>
      )}
    </View>
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <Text style={styles.name}>{asset.name}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, {backgroundColor: statusColor(c, asset.status)}]} />
          <Text style={[styles.status, {color: statusColor(c, asset.status)}]}>
            {ASSET_STATUS[asset.status] || asset.status}
          </Text>
        </View>
      </View>

      {/* Быстрый переезд. Кнопки зависят от того, где прибор стоит: держать все
          четыре сразу значит показывать «вернуть в кабинет» тому, кто и так
          стоит с прибором в кабинете. */}
      {(canIssue || canMaintenance) && !asset.isArchived && asset.status !== 'written_off' && (
        <View style={styles.quickRow}>
          {openRepair ? (
            canMaintenance && (
              <Pressable style={styles.quickBtn} disabled={moving} onPress={fromRepair}>
                <Undo2 size={16} color={c.primary} />
                <Text style={styles.quickText}>Из ремонта</Text>
              </Pressable>
            )
          ) : (
            <>
              {canIssue && (inService ? (
                <Pressable style={styles.quickBtn} disabled={moving} onPress={backToRoom}>
                  <Undo2 size={16} color={c.primary} />
                  <Text style={styles.quickText}>Вернуть в кабинет</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.quickBtn} disabled={moving} onPress={() => toService('warehouse')}>
                  <Boxes size={16} color={c.primary} />
                  <Text style={styles.quickText}>На склад</Text>
                </Pressable>
              ))}
              {canMaintenance && (
                <Pressable style={styles.quickBtn} disabled={moving} onPress={toRepair}>
                  <Wrench size={16} color={c.primary} />
                  <Text style={styles.quickText}>В ремонт</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      )}

      {/* Перемещение и списание — отдельной строкой под быстрыми кнопками, а не
          третьей кнопкой в их ряду: обе спрашивают о большем, чем «на склад» и
          «в ремонт» (куда именно, по какой причине), и в ряду из трёх подписи
          пришлось бы сокращать до нечитаемого. */}
      {canIssue && Boolean(asset.room) && !openRepair
        && !asset.isArchived && asset.status !== 'written_off' && (
        <Pressable style={styles.opsBtn} onPress={() => setOps(true)}>
          <ArrowLeftRight size={15} color={c.primary} />
          <Text style={styles.opsText}>Переместить или списать</Text>
        </Pressable>
      )}

      {/* Отмена — отдельной строкой и приглушённой: это исправление ошибки, а
          не повседневное действие, и стоять наравне с «На склад» ей незачем. */}
      {canIssue && undoable && !asset.isArchived && (
        <Pressable style={styles.undoBtn} disabled={moving} onPress={undoLast}>
          <Undo2 size={15} color={c.error} />
          <Text style={styles.undoText}>
            Отменить: {(MOVEMENT_LABELS[lastMove.type] || lastMove.type).toLowerCase()}
            {lastMove.toRoom ? ` в ${roomText(lastMove.toRoom).toLowerCase()}` : ''}
          </Text>
        </Pressable>
      )}

      {/* Этикетка показывается как есть, а не строкой «напечатать». Стоя перед
          прибором, человек сверяет наклейку на нём с той, что в портале: у
          старого имущества номер на ленте затёрт, а иногда и вовсе не тот. */}
      {canPrint && (
        <GlassCard style={styles.labelCard}>
          <LabelPreview url={warehouseApi.assetLabelUrl(asset.id)} />
          <Pressable
            style={styles.labelButton}
            onPress={() => navigation.navigate('WarehouseLabelPrint', {
              kind: 'asset',
              ids: [asset.id],
              title: asset.inventoryNumber,
            })}>
            <Printer size={16} color={c.primary} />
            <Text style={styles.labelButtonText}>
              {asset.labelPrintedAt ? 'Напечатать заново' : 'Напечатать'}
            </Text>
          </Pressable>
        </GlassCard>
      )}

      <BottomSheet
        glass
        visible={ops}
        title={asset.name}
        onClose={() => setOps(false)}
        onClosed={sheetClosed}>
        <View style={styles.sheet}>
          {/* Значки те же, что в шторке кабинета: одно и то же действие,
              открытое с двух сторон, обязано выглядеть одинаково. */}
          {[
            {key: 'transfer', label: 'Переместить в другой кабинет', icon: ArrowRightLeft},
            {key: 'writeoff', label: 'Списать', icon: PackageX},
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Pressable
                key={item.key}
                style={styles.sheetRow}
                onPress={() => { afterSheet.current = item.key; setOps(false); }}>
                <Icon size={17} color={c.primary} />
                <Text style={styles.sheetRowText}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>

      {Boolean(operation) && (
        <RoomOperation
          room={asset.room}
          type={operation}
          target={{
            assetId: asset.id,
            name: asset.name,
            note: asset.inventoryNumber,
          }}
          onClose={() => setOperation(null)}
          onDone={() => { setOperation(null); reload(); }}
        />
      )}

      <SwipeTabs
        style={styles.tabs}
        value={tab}
        onChange={setTab}
        tabs={[
          {key: 'main', label: 'Основное'},
          {key: 'money', label: 'Стоимость'},
          {key: 'history', label: 'История'},
        ]}>
        {mainPage}
        {moneyPage}
        {historyPage}
      </SwipeTabs>
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1},
  content: {padding: 16, paddingBottom: 32},
  head: {marginBottom: 14},
  name: {fontFamily: font.semiBold, fontSize: 19, color: c.textPrimary, lineHeight: 25},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7},
  dot: {width: 8, height: 8, borderRadius: 4},
  status: {fontFamily: font.medium, fontSize: 13},
  headerTitle: {fontFamily: font.semiBold, fontSize: 16, color: '#FFFFFF'},
  headerButtons: {flexDirection: 'row', alignItems: 'center', gap: 18},
  page: {width: '100%'},
  tabs: {marginTop: 16},
  none: {
    fontFamily: font.regular,
    fontSize: 13,
    color: c.textTertiary,
    textAlign: 'center',
    paddingVertical: 24,
  },
  quickRow: {flexDirection: 'row', gap: 8, marginBottom: 14},
  quickBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, paddingVertical: 12, paddingHorizontal: 10,
    ...glassSurface(c), borderRadius: radius.md,
  },
  quickText: {fontFamily: font.medium, fontSize: 13, color: c.primary},
  opsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 11, marginBottom: 14,
    ...glassSurface(c), borderRadius: radius.md,
  },
  opsText: {fontFamily: font.medium, fontSize: 13, color: c.primary},

  sheet: {paddingHorizontal: 16, paddingBottom: 8},
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 13, paddingHorizontal: 12, borderRadius: radius.md,
  },
  sheetRowText: {fontFamily: font.medium, fontSize: 15, color: c.textPrimary},

  undoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 11, marginBottom: 14,
    ...glassSurface(c), borderRadius: radius.md,
  },
  undoText: {fontFamily: font.medium, fontSize: 13, color: c.error},

  labelCard: {
    borderRadius: radius.lg,
    padding: 12,
    gap: 10,
    marginBottom: 14,
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
  card: {...glassSurface(c), borderRadius: radius.lg, overflow: 'hidden'},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glassLine(c),
  },
  rowLabel: {flex: 1, fontFamily: font.regular, fontSize: 13, color: c.textSecondary},
  rowValue: {
    flex: 1.4,
    fontFamily: font.medium,
    fontSize: 13,
    color: c.textPrimary,
    textAlign: 'right',
  },
  warn: {fontFamily: font.regular, fontSize: 12, color: c.warning, marginTop: 8, lineHeight: 18},
  moveRow: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glassLine(c),
  },
  moveMain: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  moveType: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary},
  moveWhen: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary},
  moveWhere: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  moveReason: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary, marginTop: 2},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32},
  emptyText: {fontFamily: font.regular, fontSize: 14, color: c.textSecondary, textAlign: 'center'},
});
