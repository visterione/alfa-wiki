/**
 * Карточка оборудования — то, что видит человек, отсканировав этикетку.
 *
 * Экран намеренно только на просмотр. Постановка на учёт, правка полей и
 * амортизация остались в вебе: это ввод данных за столом, а здесь человек стоит
 * перед прибором и хочет ответить на три вопроса — что это, чьё оно и когда ему
 * следующее ТО.
 *
 * Лента движений внизу отвечает на четвёртый вопрос, который возникает чаще
 * остальных: «как эта штука тут оказалась».
 */
import React, {useCallback, useState} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {DoorOpen, ChevronRight, Printer} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import LabelPreview from '../../components/LabelPreview';
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
  const {assetId} = route.params || {};
  const [data, setData] = useState(null);
  // Право на этикетки отдельное от права вести учёт: печатают их не те, кто
  // заполняет карточки. Без него кнопка печати не показывается вовсе — иначе
  // человек упрётся в 403 уже после того, как подошёл к принтеру.
  const canPrint = useWarehouseCan('canPrintLabels');
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let alive = true;
    warehouseApi.asset(assetId)
      .then(({data: payload}) => {
        if (!alive) return;
        setData(payload);
        // Заголовок — инвентарный номер: он же напечатан на этикетке, которую
        // человек только что отсканировал, и по нему проще всего убедиться, что
        // открылось именно то.
        navigation.setOptions({title: payload.asset.inventoryNumber});
      })
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [assetId, navigation]));

  if (loading) return <LogoLoader />;
  if (!data) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Карточка не открылась</Text>
      </View>
    );
  }

  const {asset, depreciation, movements} = data;
  const rows = [
    ['Модель', asset.model],
    ['Производитель', asset.manufacturer],
    ['Серийный номер', asset.serialNumber],
    ['Категория', asset.category?.name],
    ['МОЛ', asset.responsible?.displayName],
    ['Следующее ТО', asset.nextMaintenanceDate ? dateText(asset.nextMaintenanceDate) : null],
    ['Гарантия до', asset.warrantyUntil ? dateText(asset.warrantyUntil) : null],
  ].filter(([, value]) => value);

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

      {Boolean(asset.room) && (
        <Pressable
          style={styles.roomRow}
          onPress={() => navigation.navigate('WarehouseRoom', {roomId: asset.room.id})}>
          <DoorOpen size={18} color={c.primary} />
          <Text style={styles.roomText}>{roomText(asset.room)}</Text>
          <ChevronRight size={16} color={c.textTertiary} />
        </Pressable>
      )}

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

      {Boolean(rows.length) && (
        <View style={styles.card}>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.rowLabel}>{label}</Text>
              <Text style={styles.rowValue}>{value}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Стоимость показывается, только если сервер её прислал: право «видеть
          суммы» проверяется там, и прятать блок по догадке клиента нельзя. */}
      {Boolean(depreciation?.initialCost) && (
        <>
          <Text style={styles.section}>Стоимость</Text>
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
      )}

      {Boolean(movements?.length) && (
        <>
          <Text style={styles.section}>Что с ним происходило</Text>
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
        </>
      )}

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
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 14,
  },
  roomText: {flex: 1, fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
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
  section: {
    fontFamily: font.semiBold,
    fontSize: 13,
    color: c.textSecondary,
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 2,
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
