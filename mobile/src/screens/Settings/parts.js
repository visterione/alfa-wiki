/**
 * Общие детали экранов настроек.
 *
 * Настройки перестали быть одним свитком (ver. 7.55): наверху остался список
 * разделов, а сами переключатели разъехались по отдельным экранам. Строка,
 * секция и выбор с галочкой нужны теперь всем пяти, и держать их копиями в
 * каждом значило бы править отступы в пяти местах.
 *
 * Вынесены сюда, а не в components/: это язык именно настроек, и появление
 * такой строки где-нибудь в складе или чате было бы ошибкой, а не находкой.
 */
import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {Check, ChevronRight} from 'lucide-react-native';

import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';

export function Row({icon: Icon, title, subtitle, onPress, right, danger, tint}) {
  const c = useTheme();
  const styles = useThemedStyles(makeSettingsStyles);

  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.row} onPress={onPress} activeOpacity={0.6}>
      {Icon && (
        <View
          style={[
            styles.rowIcon,
            danger && styles.rowIconDanger,
            // Цветной значок у разделов-рубрик: список из шести одинаково синих
            // строк читается как таблица, а по цвету человек находит нужную,
            // не перечитывая подписи
            tint ? {backgroundColor: `${tint}22`} : null,
          ]}>
          <Icon size={18} color={danger ? c.error : tint || c.primary} />
        </View>
      )}
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, danger && styles.rowTitleDanger]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <ChevronRight size={18} color={c.textTertiary} /> : null)}
    </Wrapper>
  );
}

/**
 * Строка-переключатель с галочкой у выбранного. Выбор из трёх-семи вариантов
 * удобнее списком, чем модалкой: всё видно сразу и меняется одним касанием.
 */
export function ChoiceRow({label, selected, onPress, preview}) {
  const c = useTheme();
  const styles = useThemedStyles(makeSettingsStyles);
  return (
    <TouchableOpacity style={styles.choiceRow} onPress={onPress} activeOpacity={0.6}>
      {preview}
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelActive, preview && styles.choiceLabelInset]}>
        {label}
      </Text>
      {/* Фиксированная ширина: иначе появление галочки сдвигает кнопку
          прослушивания, и строки «прыгают» при выборе */}
      <View style={styles.choiceCheck}>
        {selected ? <Check size={18} color={c.primary} /> : null}
      </View>
    </TouchableOpacity>
  );
}

export function Section({title, footer, children}) {
  const styles = useThemedStyles(makeSettingsStyles);

  return (
    <View style={styles.section}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.sectionFooter}>{footer}</Text> : null}
    </View>
  );
}

/**
 * Разделитель между строками внутри одной карточки.
 *
 * `inset` — начинать ли линию под текстом, а не от края. Так она делит строки
 * со значками (значок при этом читается как метка всей строки, а не как часть
 * списка), а между вариантами выбора, где значков нет, линия идёт во всю
 * ширину — иначе её отступ упирался бы в пустоту.
 */
export function Divider({inset = false}) {
  const styles = useThemedStyles(makeSettingsStyles);
  return <View style={[styles.divider, inset && styles.dividerInset]} />;
}

export const makeSettingsStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 16},

  section: {marginBottom: 22},
  sectionTitle: {
    fontSize: 13,
    fontFamily: font.medium,
    color: c.textSecondary,
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  // Пояснение под карточкой — там же, где его ждут по системным настройкам:
  // не в подписи строки, где оно удлиняет саму строку, а отдельным абзацем
  sectionFooter: {
    fontSize: 12.5,
    fontFamily: font.regular,
    color: c.textTertiary,
    lineHeight: 17,
    marginTop: 8,
    marginHorizontal: 4,
  },
  card: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },

  row: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13},
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowIconDanger: {backgroundColor: `${c.error}22`},
  rowBody: {flex: 1, marginRight: 8},
  rowTitle: {fontSize: 15, fontFamily: font.regular, color: c.textPrimary},
  rowTitleDanger: {color: c.error},
  rowSubtitle: {fontSize: 12.5, fontFamily: font.regular, color: c.textSecondary, marginTop: 2},
  divider: {height: 1, backgroundColor: c.borderLight, marginLeft: 14},
  dividerInset: {marginLeft: 58},

  // Отступ слева обычный, а не в ширину колонки со значками: варианты выбора
  // теперь живут в своих секциях, и равняться им больше не на что — раньше над
  // ними стояла строка-заголовок со значком, и они выстраивались под её текст
  choiceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  choiceCheck: {width: 20, alignItems: 'flex-end'},
  choiceLabelInset: {marginLeft: 12},
  // flex:1 — иначе при наличии образца строка растягивает промежутки
  // и подпись уезжает в центр
  choiceLabel: {flex: 1, fontSize: 15, fontFamily: font.regular, color: c.textPrimary},
  choiceLabelActive: {fontFamily: font.semiBold, color: c.primary},
});
