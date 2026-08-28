import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Clock,
  Smile,
  Cat,
  Coffee,
  Car,
  Trophy,
  Lightbulb,
  Hash,
  Flag,
} from 'lucide-react-native';
import {EMOJI_CATEGORIES} from '../data/emoji';
import {font} from '../theme';
import {useTheme, useThemedStyles} from '../store/settingsStore';

/**
 * Панель выбора эмодзи — полный набор с делением на категории, как в Telegram.
 *
 * Раньше здесь было три десятка смайлов, разложенных через flexWrap. Кроме
 * скудости набора это давало рваный правый край: ширина кнопки зависела от
 * ширины самого символа, и последняя в строке помещалась не всегда — казалось,
 * что эмодзи пропущен. Поэтому сетка теперь считается явно: экран делится на
 * целое число колонок, каждая ячейка ровно одной ширины, а список строится из
 * готовых строк, а не переносится сам.
 *
 * Строки и заголовки лежат в одном FlatList с известными высотами — только так
 * работает scrollToIndex, которым переключаются категории снизу. Обратная
 * связь (какая категория сейчас на экране) идёт через onViewableItemsChanged.
 */

const RECENT_KEY = 'chat-emoji-recent-v1';
const RECENT_MAX = 32;

// Минимальная ширина ячейки. Меньше — палец начинает промахиваться,
// больше — на узких экранах в строку влезает всего шесть эмодзи
const MIN_CELL = 44;
const ROW_HEIGHT = 46;
const HEADER_HEIGHT = 28;

const CATEGORY_ICONS = {
  recent: Clock,
  smileys: Smile,
  nature: Cat,
  food: Coffee,
  travel: Car,
  activities: Trophy,
  objects: Lightbulb,
  symbols: Hash,
  flags: Flag,
};

function chunk(list, size) {
  const rows = [];
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size));
  return rows;
}

export default function EmojiPicker({onSelect, style}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const {width} = useWindowDimensions();
  const listRef = useRef(null);

  const [recent, setRecent] = useState([]);
  const [activeCategory, setActiveCategory] = useState('smileys');

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY)
      .then(raw => {
        const saved = raw ? JSON.parse(raw) : [];
        const clean = Array.isArray(saved) ? saved.filter(e => typeof e === 'string') : [];
        if (clean.length) setRecent(clean);
      })
      .catch(() => {});
  }, []);

  const columns = Math.max(6, Math.floor(width / MIN_CELL));

  // Категории с недавними впереди. Пустой список недавних не показываем:
  // при первом открытии заголовок над пустотой выглядел бы поломкой
  const categories = useMemo(
    () => (recent.length
      ? [{key: 'recent', title: 'Недавние', emoji: recent}, ...EMOJI_CATEGORIES]
      : EMOJI_CATEGORIES),
    [recent],
  );

  // Плоский список из заголовков и готовых строк. Заодно запоминаем, с какого
  // индекса начинается каждая категория, — по нему прыгает нижняя панель
  const {items, offsets, categoryIndex} = useMemo(() => {
    const flat = [];
    const starts = {};
    for (const category of categories) {
      starts[category.key] = flat.length;
      flat.push({type: 'header', key: `h:${category.key}`, title: category.title});
      chunk(category.emoji, columns).forEach((row, i) => {
        flat.push({type: 'row', key: `r:${category.key}:${i}`, row});
      });
    }
    // Смещения считаем заранее: высоты у заголовка и строки разные, и без
    // готовой таблицы getItemLayout пришлось бы суммировать их на каждый вызов
    const tops = [];
    let top = 0;
    for (const item of flat) {
      tops.push(top);
      top += item.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
    }
    return {items: flat, offsets: tops, categoryIndex: starts};
  }, [categories, columns]);

  const remember = useCallback(emoji => {
    setRecent(prev => {
      const next = [emoji, ...prev.filter(e => e !== emoji)].slice(0, RECENT_MAX);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const press = useCallback(emoji => {
    onSelect?.(emoji);
    remember(emoji);
  }, [onSelect, remember]);

  const jumpTo = useCallback(key => {
    const index = categoryIndex[key];
    if (index === undefined) return;
    setActiveCategory(key);
    listRef.current?.scrollToIndex({index, animated: false});
  }, [categoryIndex]);

  // Какая категория сейчас на экране — по самой верхней видимой строке
  const viewabilityConfig = useRef({itemVisiblePercentThreshold: 10}).current;
  const onViewableItemsChanged = useRef(({viewableItems}) => {
    const first = viewableItems[0]?.item?.key;
    if (!first) return;
    const key = first.split(':')[1];
    if (key) setActiveCategory(key);
  }).current;

  const getItemLayout = useCallback((_, index) => ({
    length: items[index]?.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT,
    offset: offsets[index] ?? 0,
    index,
  }), [items, offsets]);

  const renderItem = useCallback(({item}) => {
    if (item.type === 'header') {
      return <Text style={styles.sectionTitle}>{item.title}</Text>;
    }
    return (
      <View style={styles.row}>
        {item.row.map(emoji => (
          <TouchableOpacity
            key={emoji}
            style={[styles.cell, {width: `${100 / columns}%`}]}
            onPress={() => press(emoji)}>
            <Text style={styles.emoji}>{emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }, [columns, press, styles]);

  return (
    <View style={[styles.panel, style]}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        initialNumToRender={12}
        windowSize={7}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.tabs}>
        {categories.map(category => {
          const Icon = CATEGORY_ICONS[category.key];
          const active = activeCategory === category.key;
          return (
            <TouchableOpacity
              key={category.key}
              style={styles.tab}
              accessibilityLabel={category.title}
              onPress={() => jumpTo(category.key)}>
              <Icon size={19} color={active ? c.primary : c.textTertiary} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  panel: {
    height: 288,
    backgroundColor: c.bgPrimary,
    borderTopWidth: 1,
    borderTopColor: c.borderLight,
  },
  sectionTitle: {
    height: HEADER_HEIGHT,
    lineHeight: HEADER_HEIGHT,
    paddingHorizontal: 12,
    fontSize: 11.5,
    fontFamily: font.medium,
    color: c.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  row: {flexDirection: 'row', height: ROW_HEIGHT},
  cell: {alignItems: 'center', justifyContent: 'center'},
  // includeFontPadding отключён намеренно: на Android он добавляет сверху и
  // снизу запас под диакритику, из-за которого эмодзи съезжает вниз ячейки
  emoji: {fontSize: 28, lineHeight: 34, includeFontPadding: false},

  tabs: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: c.borderLight,
    backgroundColor: c.bgSecondary,
  },
  tab: {flex: 1, alignItems: 'center', paddingVertical: 9},
});
