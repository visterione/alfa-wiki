/**
 * Вкладки, между которыми можно перелистывать пальцем.
 *
 * Нажатие по заголовку и свайп по содержимому делают одно и то же — как на
 * домашнем экране телефона. Свайп здесь не украшение: на карточке кабинета и на
 * карточке оборудования вкладки лежат в самом низу длинной страницы, и тянуться
 * до них большим пальцем каждый раз, когда надо сравнить соседние списки, —
 * лишняя работа.
 *
 * ── Почему высота вычисляется, а не задаётся ────────────────────────────────
 *
 * Страницы лежат в горизонтальном ScrollView, а он в вертикальном: всё вместе
 * это одна прокручиваемая страница, а не два вложенных экрана. Горизонтальному
 * при этом нужна высота — иначе он растянется на всё свободное место и утащит
 * страницу за пределы экрана. Поэтому каждая страница сообщает свою высоту
 * через onLayout, а полосе выставляется высота текущей. Вкладки почти всегда
 * разной длины, и брать максимум значило бы оставлять под короткой пустоту в
 * пол-экрана.
 *
 * Чтобы onLayout возвращал собственную высоту содержимого, а не высоту самой
 * полосы, страницы выравниваются по верхнему краю (alignItems: flex-start) —
 * иначе они растягиваются под неё, и высота измеряла бы сама себя.
 */
import React, {useEffect, useRef, useState} from 'react';
import {View, Text, Pressable, ScrollView, StyleSheet} from 'react-native';

import {radius, font} from '../theme';
import {useThemedStyles} from '../store/settingsStore';

export default function SwipeTabs({tabs, value, onChange, children, style}) {
  const styles = useThemedStyles(makeStyles);
  const pager = useRef(null);
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState({});
  // Свайп двигает и полосу, и заголовки; программная прокрутка от нажатия по
  // заголовку не должна вернуться обратно событием прокрутки как чужой ввод.
  const scrolling = useRef(false);

  const index = Math.max(0, tabs.findIndex(t => t.key === value));

  useEffect(() => {
    if (!width || !pager.current) return;
    scrolling.current = true;
    pager.current.scrollTo({x: index * width, animated: true});
  }, [index, width]);

  const setHeight = (key, height) => setHeights((prev) => (
    Math.abs((prev[key] || 0) - height) < 1 ? prev : {...prev, [key]: height}
  ));

  const pages = React.Children.toArray(children);

  return (
    <View style={style} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.bar}>
        {tabs.map(tab => (
          <Pressable
            key={tab.key}
            style={[styles.tab, tab.key === value && styles.tabOn]}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{selected: tab.key === value}}>
            <Text
              style={[styles.tabText, tab.key === value && styles.tabTextOn]}
              numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {width > 0 && (
        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          // Высота ещё не измеренной страницы неизвестна: до первого layout
          // отдаём её содержимому и не режем.
          style={heights[value] ? {height: heights[value]} : undefined}
          contentContainerStyle={styles.pages}
          onMomentumScrollEnd={(e) => {
            scrolling.current = false;
            const next = Math.round(e.nativeEvent.contentOffset.x / width);
            if (tabs[next] && tabs[next].key !== value) onChange(tabs[next].key);
          }}>
          {pages.map((page, at) => (
            <View
              key={tabs[at]?.key ?? at}
              style={{width}}
              onLayout={e => setHeight(tabs[at]?.key ?? at, e.nativeEvent.layout.height)}>
              {page}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  bar: {flexDirection: 'row', gap: 8, marginBottom: 10},
  tab: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    backgroundColor: c.bgTertiary,
    alignItems: 'center',
  },
  tabOn: {backgroundColor: c.primary},
  tabText: {fontFamily: font.medium, fontSize: 13, color: c.textSecondary},
  tabTextOn: {color: '#FFFFFF'},
  pages: {alignItems: 'flex-start'},
});
