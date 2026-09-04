/**
 * Детали раздела «Пользователи»: строки формы, переключатели и лист выбора.
 *
 * Вынесены сюда, потому что форма и дерево прав — два больших файла, говорящих
 * одним языком: та же карточка, та же строка с подписью сверху, тот же
 * трёхпозиционный переключатель. Раньше половина этого жила копией в каждом, и
 * отступы приходилось править дважды.
 *
 * Это язык именно админского раздела: строка настроек (Settings/parts.js)
 * устроена иначе — там значок-рубрика слева и стрелка справа, здесь подпись
 * сверху и значение под ней, как в формах склада.
 */
import React from 'react';
import {
  View, Text, TextInput, Pressable, Switch, Modal, ScrollView, StyleSheet,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Check, ChevronDown, ChevronRight, Eye, Lock, PenLine, X} from 'lucide-react-native';

import {radius, font, accentShadow} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';

export function Card({children, style}) {
  const styles = useThemedStyles(makeAdminStyles);
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({children}) {
  const styles = useThemedStyles(makeAdminStyles);
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function TextField({label, hint, right, style, ...input}) {
  const c = useTheme();
  const styles = useThemedStyles(makeAdminStyles);
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          style={[styles.input, input.multiline && styles.inputArea]}
          placeholderTextColor={c.textTertiary}
          {...input}
        />
        {right}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Строка-выбор: значение и стрелка, по нажатию открывается лист. */
export function SelectRow({label, value, empty = 'Не выбрано', onPress, lines = 2}) {
  const c = useTheme();
  const styles = useThemedStyles(makeAdminStyles);
  return (
    <Pressable style={styles.field} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.fieldRow}>
        <Text style={[styles.value, !value && styles.valueEmpty]} numberOfLines={lines}>
          {value || empty}
        </Text>
        <ChevronRight size={16} color={c.textTertiary} />
      </View>
    </Pressable>
  );
}

export function ToggleRow({label, hint, value, onChange, color, disabled, dot}) {
  const c = useTheme();
  const styles = useThemedStyles(makeAdminStyles);
  return (
    <View style={styles.field}>
      <View style={styles.toggleRow}>
        {dot ? <View style={[styles.dot, {backgroundColor: dot}]} /> : null}
        <View style={styles.toggleBody}>
          <Text style={styles.toggleLabel}>{label}</Text>
          {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
        </View>
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{true: color || c.primary}}
        />
      </View>
    </View>
  );
}

/**
 * Уровень доступа: нет / чтение / правка.
 *
 * Три ступени в одной кнопке, как в вебе, но переключаются они нажатием на
 * нужную, а не по кругу: на компьютере перебрать три состояния мышью дёшево, а
 * на телефоне «промахнулся — жми ещё дважды» превращается в лотерею.
 */
const LEVEL_ICON = {block: Lock, read: Eye, edit: PenLine};

export function PermControl({value, onChange, disabled}) {
  const c = useTheme();
  const styles = useThemedStyles(makeAdminStyles);
  const current = disabled ? 'edit' : (value || 'block');
  const tint = {block: c.textTertiary, read: c.warning, edit: c.success};

  return (
    <View style={[styles.perm, disabled && styles.permOff]}>
      {['block', 'read', 'edit'].map((level) => {
        const Icon = LEVEL_ICON[level];
        const on = current === level;
        return (
          <Pressable
            key={level}
            style={[styles.permCell, on && {backgroundColor: tint[level]}]}
            disabled={disabled}
            onPress={() => onChange(level)}>
            <Icon size={13} color={on ? '#FFFFFF' : c.textTertiary} />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Заголовок ветки прав: подпись, раскрытие и общий переключатель.
 *
 * Переключатель родителя — это доступ к разделу целиком, а не «включить всё
 * внутри»: в вебе так же, и от этого зависит, что человек увидит в меню.
 */
export function GroupHead({label, count, expanded, onExpand, value, onChange, color, disabled}) {
  const c = useTheme();
  const styles = useThemedStyles(makeAdminStyles);
  return (
    <Pressable style={styles.groupHead} onPress={onExpand}>
      {expanded
        ? <ChevronDown size={16} color={c.textSecondary} />
        : <ChevronRight size={16} color={c.textSecondary} />}
      <Text style={styles.groupLabel}>{label}</Text>
      {count ? <Text style={styles.groupCount}>{count}</Text> : null}
      {onChange ? (
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{true: color || c.primary}}
        />
      ) : null}
    </Pressable>
  );
}

/**
 * Лист выбора во весь экран.
 *
 * Не BottomSheet: в списках здесь бывает и полсотни ролей, и восемь десятков
 * иконок, а шторка на половину экрана превращает такой список в щель. Закрытие
 * — крестиком и кнопкой «Готово» внизу, потому что выбор бывает множественным
 * и закрываться на каждой галочке нельзя.
 */
export function PickerModal({visible, title, onClose, children, footer = 'Готово'}) {
  const c = useTheme();
  const styles = useThemedStyles(makeAdminStyles);
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modal, {paddingTop: insets.top + 12}]}>
        <View style={styles.modalHead}>
          <Text style={styles.modalTitle} numberOfLines={1}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <X size={22} color={c.textPrimary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.modalList} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? (
          <View style={[styles.bar, {paddingBottom: insets.bottom + 12}]}>
            <Pressable style={styles.button} onPress={onClose}>
              <Text style={styles.buttonText}>{footer}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** Строка списка в листе выбора: подпись и галочка у выбранного. */
export function PickerRow({label, sub, on, onPress, left}) {
  const c = useTheme();
  const styles = useThemedStyles(makeAdminStyles);
  return (
    <Pressable style={styles.pickerRow} onPress={onPress}>
      {left}
      <View style={styles.pickerBody}>
        <Text style={styles.pickerLabel} numberOfLines={1}>{label}</Text>
        {sub ? <Text style={styles.pickerSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {on ? <Check size={16} color={c.primary} /> : null}
    </Pressable>
  );
}

export const makeAdminStyles = c => StyleSheet.create({
  screen: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 16},

  sectionTitle: {
    fontSize: 13,
    fontFamily: font.medium,
    color: c.textSecondary,
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  card: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    marginBottom: 22,
  },

  field: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.borderLight,
  },
  fieldRow: {flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 24},
  label: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginBottom: 3},
  input: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 15,
    color: c.textPrimary,
    padding: 0,
    minHeight: 24,
  },
  inputArea: {minHeight: 60, textAlignVertical: 'top'},
  hint: {fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary, marginTop: 4},
  value: {flex: 1, fontFamily: font.medium, fontSize: 15, color: c.textPrimary, lineHeight: 20},
  valueEmpty: {color: c.textTertiary},

  toggleRow: {flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32},
  toggleBody: {flex: 1},
  toggleLabel: {fontFamily: font.medium, fontSize: 15, color: c.textPrimary},
  toggleHint: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  dot: {width: 9, height: 9, borderRadius: 5},

  perm: {
    flexDirection: 'row',
    backgroundColor: c.bgTertiary,
    borderRadius: radius.md,
    padding: 2,
    gap: 2,
  },
  permOff: {opacity: 0.5},
  permCell: {
    width: 30,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.borderLight,
  },
  groupLabel: {flex: 1, fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  groupCount: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary},

  modal: {flex: 1, backgroundColor: c.bgPrimary},
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  modalTitle: {flex: 1, fontFamily: font.semiBold, fontSize: 18, color: c.textPrimary},
  modalList: {padding: 12, paddingBottom: 96},
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.borderLight,
  },
  pickerBody: {flex: 1},
  pickerLabel: {fontFamily: font.medium, fontSize: 15, color: c.textPrimary},
  pickerSub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  pickerEmpty: {
    fontFamily: font.regular,
    fontSize: 14,
    color: c.textTertiary,
    padding: 16,
    lineHeight: 20,
  },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: c.bgPrimary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.borderLight,
  },
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
  buttonOff: {opacity: 0.5},
  buttonText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
  buttonDanger: {backgroundColor: 'transparent'},
  dangerText: {fontFamily: font.medium, fontSize: 15, color: c.error},
});
