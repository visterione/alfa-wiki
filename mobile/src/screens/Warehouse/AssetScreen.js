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
import React, {useCallback, useLayoutEffect, useState} from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {DoorOpen, Printer, Pencil} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import LabelPreview from '../../components/LabelPreview';
import MarqueeText from '../../components/MarqueeText';
import SwipeTabs from '../../components/SwipeTabs';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {useWarehouseCan} from '../../store/warehouseStore';
import {ASSET_STATUS, statusColor, moneyText, dateText, roomText} from './warehouseMeta';

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
  const [tab, setTab] = useState('main');
  const [loading, setLoading] = useState(true);

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

      {/* Этикетка показывается как есть, а не строкой «напечатать». Стоя перед
          прибором, человек сверяет наклейку на нём с той, что в портале: у
          старого имущества номер на ленте затёрт, а иногда и вовсе не тот. */}
      {canPrint && (
        <View style={styles.labelCard}>
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
        </View>
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
  root: {flex: 1, backgroundColor: c.bgSecondary},
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
  labelCard: {
    backgroundColor: c.bgPrimary,
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
  card: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, overflow: 'hidden'},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
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
    borderBottomColor: c.border,
  },
  moveMain: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  moveType: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary},
  moveWhen: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary},
  moveWhere: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  moveReason: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary, marginTop: 2},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: c.bgSecondary},
  emptyText: {fontFamily: font.regular, fontSize: 14, color: c.textSecondary, textAlign: 'center'},
});
