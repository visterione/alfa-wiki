/**
 * Метка сотрудника в чатах — то же поле, что в карточке веба (ChatBadgeField).
 *
 * Метку обычно считает сервер: иконку даёт самая приоритетная роль, цвет — самая
 * приоритетная клиника. Здесь она пересчитывается заранее и показывается
 * образцом: администратор переключает роли и сразу видит, что появится рядом с
 * именем в переписке, — иначе проверить это можно только сохранив и открыв чат.
 *
 * Переопределение задаётся по частям (иконка, цвет, подпись), и пустые части
 * выбрасываются: сохранённый `{color: ''}` означал бы «цвет задан вручную и он
 * никакой», а не «цвет по клинике».
 *
 * Произвольного цвета, как в вебе, здесь нет: системной палитры на телефоне
 * нет, а собственная пипетка — отдельный экран ради случая, который в вебе
 * используют раз в год. Цвета берутся из клиник, как и в автоматической метке.
 */
import React, {useState} from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {RotateCcw} from 'lucide-react-native';

import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import UserBadge, {BADGE_ICONS} from '../../components/UserBadge';
import {Card, SectionTitle, TextField, ToggleRow, PickerModal, makeAdminStyles} from './parts';
import {
  BADGE_GROUPS, BADGE_LABELS, DEFAULT_BADGE_COLOR, autoBadgeRole, autoBadgeMedCenter,
} from './badgeCatalog';

export default function BadgeField({value, onChange, displayName, roles, medCenters}) {
  const c = useTheme();
  const styles = useThemedStyles(makeAdminStyles);
  const own = useThemedStyles(makeStyles);
  const [picker, setPicker] = useState(false);

  const override = value || {};
  const autoRole = autoBadgeRole(roles);
  const autoMedCenter = autoBadgeMedCenter(medCenters);

  const icon = override.value || autoRole?.chatBadgeIcon || '';
  const color = override.color || autoMedCenter?.color || DEFAULT_BADGE_COLOR;
  const roleLabel = !override.value && autoRole?.chatBadgeLabel ? autoRole.chatBadgeLabel : '';
  const label = override.label || roleLabel || BADGE_LABELS[icon] || '';

  const patch = (fields) => {
    const next = {...override, ...fields};
    Object.keys(next).forEach((key) => { if (!next[key]) delete next[key]; });
    onChange(Object.keys(next).length ? next : null);
  };

  const palette = medCenters.length
    ? medCenters.filter(mc => mc.color)
    : [];

  return (
    <>
      <SectionTitle>Метка в чатах</SectionTitle>
      <Card>
        <View style={own.preview}>
          <View style={own.sample}>
            <Text style={own.sampleName} numberOfLines={1}>
              {displayName || 'Сотрудник'}
            </Text>
            <UserBadge badge={{value: icon, color, label}} size={16} />
          </View>
          {(override.value || override.color || override.label) ? (
            <Pressable style={own.reset} onPress={() => onChange(null)} hitSlop={8}>
              <RotateCcw size={13} color={c.primary} />
              <Text style={own.resetText}>Сбросить</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={own.source}>
          {override.value
            ? `Иконка задана вручную — ${BADGE_LABELS[override.value] || override.value}`
            : autoRole
              ? `Иконка по роли «${autoRole.name}»`
              : 'Ни у одной роли иконка не задана — метки не будет'}
        </Text>
        <Text style={own.source}>
          {override.color
            ? 'Цвет задан вручную'
            : autoMedCenter
              ? `Цвет по клинике «${autoMedCenter.name}»`
              : 'Клиника не выбрана — цвет по умолчанию'}
        </Text>

        <ToggleRow
          label="Своя иконка"
          value={Boolean(override.value)}
          onChange={on => patch({value: on ? (autoRole?.chatBadgeIcon || 'BadgeCheck') : ''})}
        />
        {Boolean(override.value) && (
          <Pressable style={styles.field} onPress={() => setPicker(true)}>
            <Text style={styles.label}>Иконка</Text>
            <View style={styles.fieldRow}>
              <UserBadge badge={{value: override.value, color}} size={18} />
              <Text style={styles.value} numberOfLines={1}>
                {BADGE_LABELS[override.value] || override.value}
              </Text>
            </View>
          </Pressable>
        )}

        <ToggleRow
          label="Свой цвет"
          value={Boolean(override.color)}
          onChange={on => patch({color: on ? color : ''})}
        />
        {Boolean(override.color) && (
          <View style={styles.field}>
            <Text style={styles.label}>Цвет</Text>
            <View style={own.swatches}>
              {palette.map(mc => (
                <Pressable
                  key={mc.id}
                  style={[
                    own.swatch,
                    {backgroundColor: mc.color},
                    override.color?.toLowerCase() === mc.color.toLowerCase() && own.swatchOn,
                  ]}
                  accessibilityLabel={mc.name}
                  onPress={() => patch({color: mc.color})}
                />
              ))}
              <Pressable
                style={[
                  own.swatch,
                  {backgroundColor: DEFAULT_BADGE_COLOR},
                  override.color === DEFAULT_BADGE_COLOR && own.swatchOn,
                ]}
                accessibilityLabel="Серый по умолчанию"
                onPress={() => patch({color: DEFAULT_BADGE_COLOR})}
              />
            </View>
            {!palette.length && (
              <Text style={own.source}>
                У выбранных медцентров цвет не задан — доступен только серый
              </Text>
            )}
          </View>
        )}

        <TextField
          label="Подпись"
          value={override.label || ''}
          maxLength={80}
          placeholder={roleLabel ? `По умолчанию «${roleLabel}»` : 'По названию иконки'}
          onChangeText={text => patch({label: text})}
        />
      </Card>

      <PickerModal
        visible={picker}
        title="Иконка метки"
        onClose={() => setPicker(false)}>
        {BADGE_GROUPS.map(group => (
          <View key={group.title}>
            <Text style={own.groupTitle}>{group.title}</Text>
            <View style={own.grid}>
              {group.icons.map(([name, iconLabel]) => {
                const Icon = BADGE_ICONS[name];
                const on = override.value === name;
                return (
                  <Pressable
                    key={name}
                    style={[own.cell, on && own.cellOn]}
                    onPress={() => { patch({value: name}); setPicker(false); }}>
                    {Icon ? <Icon size={20} color={on ? c.primary : color} /> : null}
                    <Text style={own.cellText} numberOfLines={2}>{iconLabel}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </PickerModal>
    </>
  );
}

const makeStyles = c => StyleSheet.create({
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sample: {flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1},
  sampleName: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary, flexShrink: 1},
  reset: {flexDirection: 'row', alignItems: 'center', gap: 4},
  resetText: {fontFamily: font.medium, fontSize: 13, color: c.primary},
  source: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginBottom: 4},

  swatches: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4},
  swatch: {width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent'},
  swatchOn: {borderColor: c.textPrimary},

  groupTitle: {
    fontFamily: font.medium,
    fontSize: 12,
    color: c.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 14,
    marginBottom: 6,
    marginLeft: 4,
  },
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  cell: {
    width: 84,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    backgroundColor: c.bgSecondary,
  },
  cellOn: {backgroundColor: c.primaryLight},
  cellText: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, textAlign: 'center'},
});
