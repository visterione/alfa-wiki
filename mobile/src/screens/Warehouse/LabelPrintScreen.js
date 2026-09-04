/**
 * Печать этикеток: подготовка задания и отправка его в принтер.
 *
 * Экран нарочно устроен в два шага, а не в одну кнопку. Задание печати рождается
 * на сервере, а принтер в отделении может раздавать собственный вайфай — и,
 * подключившись к нему, телефон теряет и портал, и интернет. Поэтому «Подготовить»
 * и «Печать» разнесены: между ними можно спокойно переключить сеть, задание уже
 * лежит в телефоне и никуда не денется.
 *
 * Там, где принтер живёт в общей сети отделения, оба шага идут подряд и человек
 * разницы не замечает.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Printer, Check, Settings, AlertTriangle} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import {radius, font, glassSurface, accentShadow, glassLine} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {loadPrinter} from '../../store/printerStore';
import {sendPrintJob, PRINTER_PORT} from '../../services/ptouchPrint';

export default function WarehouseLabelPrintScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const {kind, ids = [], title} = route.params || {};

  const [printer, setPrinter] = useState(null);
  const [job, setJob] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // Настройки перечитываются при каждом возврате: сюда приходят из настроек
  // принтера ровно затем, чтобы поправить адрес и сразу напечатать.
  useFocusEffect(useCallback(() => { loadPrinter().then(setPrinter); }, []));

  const prepare = useCallback(async () => {
    if (!printer) return;
    setPreparing(true);
    setError(null);
    try {
      const body = {ids, rotate: printer.rotate, mirror: printer.mirror};
      const {data} = kind === 'room'
        ? await warehouseApi.roomLabelsPrn(body)
        : await warehouseApi.assetLabelsPrn(body);
      setJob(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Не удалось подготовить этикетки');
    } finally {
      setPreparing(false);
    }
  }, [ids, kind, printer]);

  // Одну-единственную этикетку готовим сразу: человек пришёл из карточки и
  // нажимать «Подготовить» ради одной наклейки ему незачем.
  useEffect(() => {
    if (printer && !job && !preparing && ids.length === 1) prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printer]);

  const print = async () => {
    if (!job || !printer?.host) return;
    setPrinting(true);
    setError(null);
    setProgress(0);
    try {
      const result = await sendPrintJob(job.prn, {
        host: printer.host,
        port: printer.port || PRINTER_PORT,
        onProgress: setProgress,
      });
      setDone({count: job.labels.length, problems: result.problems || []});
      // Отметку о печати ставим только для оборудования: по ней в вебе видно,
      // какие карточки промаркированы. У кабинетов такой отметки нет.
      if (kind !== 'room') warehouseApi.markLabelsPrinted(ids).catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setPrinting(false);
    }
  };

  const hasPrinter = Boolean(printer?.host);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{title || (kind === 'room' ? 'Этикетки кабинетов' : 'Этикетки оборудования')}</Text>
      <Text style={styles.subtitle}>
        {ids.length === 1 ? 'Одна этикетка' : `Этикеток: ${ids.length}`} · лента 24 мм
      </Text>

      <Pressable style={styles.printerRow} onPress={() => navigation.navigate('WarehousePrinter')}>
        <Settings size={17} color={c.primary} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>
            {hasPrinter ? printer.host : 'Принтер не выбран'}
          </Text>
          <Text style={styles.rowSub}>
            {hasPrinter ? `порт ${printer.port || PRINTER_PORT}` : 'Укажите адрес'}
          </Text>
        </View>
      </Pressable>

      {!job && (
        <Pressable
          style={[styles.button, preparing && styles.buttonOff]}
          disabled={preparing}
          onPress={prepare}>
          {preparing
            ? <ActivityIndicator color="#FFFFFF" size="small" />
            : <Printer size={17} color="#FFFFFF" />}
          <Text style={styles.buttonText}>
            {preparing ? 'Готовлю задание…' : 'Подготовить'}
          </Text>
        </Pressable>
      )}

      {Boolean(job) && !done && (
        <>
          <View style={styles.ready}>
            <Check size={16} color={c.success} />
            {/* Число и вес задания, а не пояснение: важно, что оно уже в
                телефоне и переключение сети его не потеряет. */}
            <Text style={styles.readyText}>
              Задание готово · {job.labels.length} шт · {Math.round(job.bytes / 1024)} КБ
            </Text>
          </View>

          <Pressable
            style={[styles.button, (!hasPrinter || printing) && styles.buttonOff]}
            disabled={!hasPrinter || printing}
            onPress={print}>
            {printing
              ? <ActivityIndicator color="#FFFFFF" size="small" />
              : <Printer size={17} color="#FFFFFF" />}
            <Text style={styles.buttonText}>
              {printing ? `Печатаю… ${Math.round(progress * 100)} %` : 'Печать'}
            </Text>
          </Pressable>
        </>
      )}

      {Boolean(done) && (
        <View style={styles.ready}>
          <Check size={16} color={c.success} />
          {/* «Отправлено», а не «напечатано»: PT-E550W статусы не шлёт (см.
              services/ptouchPrint.js), и обещать печать телефон не вправе.
              Жалобы принтера показываем, только если он их прислал. */}
          <Text style={styles.readyText}>
            {done.count === 1 ? 'Отправлено в принтер' : `Отправлено: ${done.count}`}
            {done.problems.length ? ` · ${done.problems.join(', ')}` : ''}
          </Text>
        </View>
      )}

      {Boolean(error) && (
        <View style={styles.error}>
          <AlertTriangle size={16} color={c.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {Boolean(job) && (
        <>
          <Text style={styles.section}>Что печатается</Text>
          <View style={styles.card}>
            {job.labels.map(label => (
              <View key={label.id} style={styles.item}>
                <Text style={styles.itemMain}>
                  {kind === 'room' ? `Каб. ${label.number}` : label.inventoryNumber}
                </Text>
                <Text style={styles.itemSub} numberOfLines={1}>{label.name || ''}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1},
  content: {padding: 16, paddingBottom: 40},
  title: {fontFamily: font.semiBold, fontSize: 19, color: c.textPrimary},
  subtitle: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 3},
  printerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    ...glassSurface(c),
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginTop: 16,
    marginBottom: 14,
  },
  rowText: {flex: 1},
  rowTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  rowSub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    ...accentShadow(c.primary),
  },
  buttonOff: {opacity: 0.45},
  buttonText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
  ready: {
    flexDirection: 'row',
    gap: 9,
    ...glassSurface(c),
    borderRadius: radius.md,
    padding: 13,
    marginBottom: 12,
  },
  readyText: {flex: 1, fontFamily: font.regular, fontSize: 13, color: c.textSecondary, lineHeight: 19},
  error: {
    flexDirection: 'row',
    gap: 9,
    ...glassSurface(c),
    borderRadius: radius.md,
    padding: 13,
    marginTop: 12,
  },
  errorText: {flex: 1, fontFamily: font.medium, fontSize: 13, color: c.error, lineHeight: 19},
  section: {
    fontFamily: font.semiBold,
    fontSize: 13,
    color: c.textSecondary,
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 2,
  },
  card: {...glassSurface(c), borderRadius: radius.lg, overflow: 'hidden'},
  item: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glassLine(c),
  },
  itemMain: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  itemSub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
});
