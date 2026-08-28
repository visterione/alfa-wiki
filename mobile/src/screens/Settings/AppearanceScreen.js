/**
 * Оформление: тема, акцентный цвет, фон переписки и размер текста в чате.
 *
 * Четыре набора образцов на одном экране — это тот случай, когда свиток
 * оправдан: всё это про то, как приложение будет выглядеть, и подбирают это за
 * один заход, сравнивая между собой. Разносить их по четырём экранам значило бы
 * заставить человека возвращаться назад после каждой пробы.
 */
import React from 'react';
import {View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions} from 'react-native';
import {Check} from 'lucide-react-native';

import {radius, font, ACCENTS, fontScales} from '../../theme';
import {useTheme, useThemedStyles, useSettings, THEME_OPTIONS} from '../../store/settingsStore';
import {CHAT_BACKGROUNDS, PatternPreview} from '../../components/ChatBackground';
import {ChoiceRow, Section, Divider, makeSettingsStyles} from './parts';

// Размер плитки с образцом фона. Считается от ширины экрана: три плитки в ряд
// с отступами. SVG-образцу нужен конкретный размер в пунктах — процентами
// узор не смасштабируешь.
const BG_TILE_W = Math.floor((Dimensions.get('window').width - 68) / 3);
const BG_TILE_H = BG_TILE_W;

/**
 * Плитка с образцом фона.
 *
 * Показывает узор так, как он ляжет в переписке: на том же цвете подложки и с
 * пузырьком сообщения поверх. Без пузырька невозможно оценить главное — не
 * мешает ли узор читать.
 */
function BackgroundCell({item, selected, onPress}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <TouchableOpacity
      style={styles.bgCell}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{selected}}>
      <View style={[styles.bgTile, selected && styles.bgTileActive]}>
        <View style={StyleSheet.absoluteFill}>
          <PatternPreview name={item.key} width={BG_TILE_W} height={BG_TILE_H} />
        </View>
        <View style={styles.bgBubble} />
        <View style={styles.bgBubbleOwn} />
        {selected && (
          <View style={styles.bgCheck}>
            <Check size={13} color="#FFFFFF" />
          </View>
        )}
      </View>
      <Text style={[styles.bgLabel, selected && styles.bgLabelActive]} numberOfLines={1}>
        {item.label}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * Образец текста в выбранном размере. Цифру «1,15×» на глаз оценить нельзя —
 * а увидеть свой же пузырёк можно сразу.
 */
function FontPreview({scale}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.fontPreview}>
      <View style={styles.fontPreviewBubble}>
        <Text style={[styles.fontPreviewText, {fontSize: 15 * scale, lineHeight: 21 * scale}]}>
          Так будет выглядеть текст сообщения
        </Text>
      </View>
    </View>
  );
}

export default function AppearanceScreen() {
  const c = useTheme();
  const base = useThemedStyles(makeSettingsStyles);
  const styles = useThemedStyles(makeStyles);
  const settings = useSettings();

  return (
    <ScrollView style={base.container} contentContainerStyle={base.content}>
      <Section title="Тема">
        {THEME_OPTIONS.map((opt, i) => (
          <React.Fragment key={opt.key}>
            {i > 0 && <Divider />}
            <ChoiceRow
              label={opt.label}
              selected={settings.theme === opt.key}
              onPress={() => settings.update({theme: opt.key})}
            />
          </React.Fragment>
        ))}
      </Section>

      <Section title="Акцентный цвет">
        <View style={styles.accentGrid}>
          {ACCENTS.map(a => {
            const selected = settings.accent === a.key;
            // Показываем оттенок именно для текущей темы: в светлой и тёмной
            // один и тот же акцент выглядит по-разному
            const swatch = settings.scheme === 'dark' ? a.dark : a.light;
            return (
              <TouchableOpacity
                key={a.key}
                style={styles.accentCell}
                onPress={() => settings.update({accent: a.key})}
                activeOpacity={0.7}
                // Подписи под кружками нет — название остаётся только для
                // озвучки скринридером, иначе цвет для него безымянный
                accessibilityLabel={a.label}
                accessibilityRole="button">
                <View
                  style={[
                    styles.accentDot,
                    {backgroundColor: swatch},
                    selected && {borderColor: c.textPrimary},
                  ]}>
                  {selected && <Check size={16} color="#FFFFFF" />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </Section>

      <Section title="Фон переписки">
        {/* Сеткой, а не списком: узоров стало больше десятка, и строками они
            растянулись бы на два экрана, а сравнить их между собой — главное,
            ради чего вообще нужен образец */}
        <View style={styles.bgGrid}>
          {CHAT_BACKGROUNDS.map(bg => (
            <BackgroundCell
              key={bg.key}
              item={bg}
              selected={settings.chatBackground === bg.key}
              onPress={() => settings.update({chatBackground: bg.key})}
            />
          ))}
        </View>
      </Section>

      <Section title="Размер текста в чате">
        <FontPreview scale={settings.scale} />
        <Divider />
        {Object.values(fontScales).map((fs, i) => (
          <React.Fragment key={fs.key}>
            {i > 0 && <Divider />}
            <ChoiceRow
              label={fs.label}
              selected={settings.fontScale === fs.key}
              onPress={() => settings.update({fontScale: fs.key})}
            />
          </React.Fragment>
        ))}
      </Section>
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  // ── Фон переписки ──────────────────────────────────────────────────────────
  bgGrid: {flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 8},
  bgCell: {width: BG_TILE_W},
  bgTile: {
    width: BG_TILE_W,
    height: BG_TILE_H,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: c.bgSecondary,
    borderWidth: 1,
    borderColor: c.borderLight,
    // Пузырьки прижаты книзу — так плитка читается как кусок переписки
    justifyContent: 'flex-end',
    padding: 7,
  },
  bgTileActive: {borderColor: c.primary, borderWidth: 2},
  bgBubble: {
    height: 11,
    width: '70%',
    borderRadius: 5.5,
    backgroundColor: c.bubbleOther,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    marginBottom: 5,
  },
  bgBubbleOwn: {
    height: 11,
    width: '55%',
    borderRadius: 5.5,
    alignSelf: 'flex-end',
    backgroundColor: c.primary,
  },
  bgCheck: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bgLabel: {
    marginTop: 6,
    fontSize: 11,
    fontFamily: font.medium,
    color: c.textSecondary,
    textAlign: 'center',
  },
  bgLabelActive: {color: c.primary},

  accentGrid: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 14,
  },
  // Без подписей восемь цветов помещаются в одну строку
  accentCell: {width: '12.5%', alignItems: 'center'},
  accentDot: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },

  fontPreview: {paddingHorizontal: 14, paddingBottom: 12, paddingTop: 12},
  fontPreviewBubble: {
    alignSelf: 'flex-start', maxWidth: '92%',
    backgroundColor: c.bubbleOther, borderRadius: radius.lg,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: c.borderLight,
  },
  fontPreviewText: {fontFamily: font.regular, color: c.bubbleOtherText},
});
