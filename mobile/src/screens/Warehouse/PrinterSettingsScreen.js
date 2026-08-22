/**
 * Принтер этикеток: куда печатать и как повёрнута лента.
 *
 * Экран из четырёх полей, и три из них — калибровка, которую делают один раз в
 * жизни принтера. Отдельный экран ей нужен потому, что настраивает её один
 * человек, а печатают потом все: спрятать это в диалог печати значит показывать
 * поворот ленты каждому, кто просто хочет наклейку на дверь.
 *
 * Поиска принтеров по сети здесь нет намеренно. P-touch не отвечает на
 * широковещательные запросы так, чтобы его можно было надёжно отличить от
 * любого другого устройства с открытым 9100, а перебор всей подсети с телефона
 * занимает больше времени, чем ввод адреса, который написан на самом принтере в
 * меню «Настройки сети».
 */
import React, {useState} from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Switch, ActivityIndicator,
} from 'react-native';
import {Printer, Check, RotateCcw} from 'lucide-react-native';

import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {usePrinter, DIRECT_MODE_HOST} from '../../store/printerStore';
import {checkPrinter, PRINTER_PORT} from '../../services/ptouchPrint';
import LogoLoader from '../../components/LogoLoader';

export default function WarehousePrinterScreen() {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const {printer, update} = usePrinter();
  const [host, setHost] = useState(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);

  if (!printer) return <LogoLoader />;

  const value = host ?? printer.host;
  const commit = (next) => {
    setHost(next);
    setResult(null);
    update({host: next.trim()});
  };

  const runCheck = async () => {
    setChecking(true);
    setResult(null);
    try {
      await checkPrinter({host: value.trim(), port: printer.port || PRINTER_PORT});
      setResult({ok: true, text: 'Принтер отвечает. Можно печатать.'});
    } catch (e) {
      setResult({ok: false, text: e.message});
    } finally {
      setChecking(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.section}>Адрес принтера</Text>
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={commit}
          placeholder="192.168.1.50"
          placeholderTextColor={c.textTertiary}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <Text style={styles.where}>
        Адрес написан в самом принтере: Menu → WLAN → Network Status → тот режим,
        в котором он работает.
      </Text>
      <Pressable style={styles.hintRow} onPress={() => commit(DIRECT_MODE_HOST)}>
        <Text style={styles.hint}>
          Подставить {DIRECT_MODE_HOST} — обычный адрес принтера в его собственной сети
        </Text>
      </Pressable>

      <Pressable
        style={[styles.button, (!value.trim() || checking) && styles.buttonOff]}
        disabled={!value.trim() || checking}
        onPress={runCheck}>
        {checking
          ? <ActivityIndicator color="#FFFFFF" size="small" />
          : <Printer size={17} color="#FFFFFF" />}
        <Text style={styles.buttonText}>
          {checking ? 'Проверяю связь…' : 'Проверить связь'}
        </Text>
      </Pressable>

      {Boolean(result) && (
        <View style={[styles.result, result.ok ? styles.resultOk : styles.resultBad]}>
          {result.ok && <Check size={16} color={c.success} />}
          <Text style={[styles.resultText, {color: result.ok ? c.success : c.error}]}>
            {result.text}
          </Text>
        </View>
      )}

      <Text style={styles.section}>Как ложится лента</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Перевернуть этикетку</Text>
            <Text style={styles.rowSub}>Если текст выезжает вверх ногами</Text>
          </View>
          <Switch
            value={printer.rotate === 270}
            onValueChange={v => update({rotate: v ? 270 : 90})}
            trackColor={{true: c.primary}}
          />
        </View>
        <View style={[styles.row, styles.rowLast]}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Зеркало</Text>
            <Text style={styles.rowSub}>Если надпись читается только в отражении</Text>
          </View>
          <Switch
            value={printer.mirror}
            onValueChange={v => update({mirror: v})}
            trackColor={{true: c.primary}}
          />
        </View>
      </View>

      <View style={styles.note}>
        <RotateCcw size={15} color={c.textTertiary} />
        <Text style={styles.noteText}>
          Эти два переключателя подбираются один раз, на первой напечатанной
          этикетке. Печатается всегда одна и та же картинка — меняется только то,
          какой стороной она ложится на 24-миллиметровую ленту.
        </Text>
      </View>

      <Text style={styles.footer}>
        Принтер должен быть в той же сети, что и телефон. Если он раздаёт
        собственный вайфай, задание сначала готовится на рабочей сети, и только
        потом телефон переключается к принтеру: экран печати это учитывает и
        держит готовое задание у себя.
      </Text>
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 16, paddingBottom: 40},
  section: {
    fontFamily: font.semiBold,
    fontSize: 13,
    color: c.textSecondary,
    marginBottom: 8,
    marginTop: 18,
    marginLeft: 2,
  },
  card: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, overflow: 'hidden'},
  input: {
    height: 48,
    paddingHorizontal: 14,
    color: c.textPrimary,
    fontFamily: font.regular,
    fontSize: 15,
  },
  where: {
    fontFamily: font.regular,
    fontSize: 12,
    color: c.textSecondary,
    lineHeight: 18,
    marginTop: 10,
    paddingHorizontal: 2,
  },
  hintRow: {paddingVertical: 8, paddingHorizontal: 2},
  hint: {fontFamily: font.regular, fontSize: 12, color: c.primary, lineHeight: 17},
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    marginTop: 6,
  },
  buttonOff: {opacity: 0.45},
  buttonText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 10,
  },
  resultOk: {backgroundColor: c.bgPrimary},
  resultBad: {backgroundColor: c.bgPrimary},
  resultText: {flex: 1, fontFamily: font.medium, fontSize: 13, lineHeight: 18},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  rowLast: {borderBottomWidth: 0},
  rowText: {flex: 1},
  rowTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  rowSub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  note: {flexDirection: 'row', gap: 9, marginTop: 16, paddingHorizontal: 2},
  noteText: {flex: 1, fontFamily: font.regular, fontSize: 12, color: c.textTertiary, lineHeight: 18},
  footer: {
    fontFamily: font.regular,
    fontSize: 12,
    color: c.textTertiary,
    lineHeight: 18,
    marginTop: 16,
    paddingHorizontal: 2,
  },
});
