/**
 * Доска отзывов — канбан, каким он бывает на телефоне.
 *
 * ── Почему так, а не вкладками ───────────────────────────────────────────────
 *
 * Первая версия раскладывала колонки во вкладки, и получался не канбан, а пять
 * отдельных списков: пропадало главное — ощущение, что колонки стоят рядом и
 * отзыв едет по ним слева направо.
 *
 * Так это решают в мобильных канбанах (Trello, Jira): колонка занимает почти всю
 * ширину, соседняя выглядывает краем, листается пальцем с примагничиванием.
 * Выглядывающий край — не украшение, а единственный признак того, что вбок
 * можно листать; без него человек ищет вкладки и не находит.
 *
 * Сверху — полоса названий с числами: она заменяет то, что на большом экране
 * видно сразу, — где затор. Нажатие по названию тоже листает, потому что до
 * пятой колонки свайпами добираться долго.
 *
 * ── Чего здесь нет ───────────────────────────────────────────────────────────
 *
 * Перетаскивания карточек между колонками. На доске в вебе оно естественно, а
 * на телефоне это тот же жест, что и листание самой доски, — и промахнуться
 * стоит смены этапа с уведомлением всем причастным. Этап меняется в карточке
 * отзыва, кнопкой с подписью.
 */
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, RefreshControl, useWindowDimensions,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';

import {reviews as reviewsApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import Stars from '../../components/Stars';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {REVIEW_STATUSES, statusColor, stageAge, dateText} from './reviewsMeta';

// Поля по краям экрана и просвет между колонками. Из них же считается шаг
// примагничивания — иначе колонка останавливается не там, где её отпустили.
const EDGE = 14;
const GAP = 10;

export default function ReviewBoardScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  const {width} = useWindowDimensions();
  const {boardId} = route.params || {};

  const [list, setList] = useState(null);
  const [at, setAt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pager = useRef(null);
  const strip = useRef(null);

  // Колонка шире, чем «экран минус поля»: справа обязан остаться край соседней.
  const columnWidth = width - EDGE * 2 - 26;
  const step = columnWidth + GAP;

  const load = useCallback(() => reviewsApi.list(boardId)
    .then(({data}) => setList(data || []))
    .catch(() => setList([]))
    .finally(() => setRefreshing(false)), [boardId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const columns = useMemo(() => REVIEW_STATUSES.map(status => ({
    ...status,
    items: (list || []).filter(review => review.status === status.id),
  })), [list]);

  const goTo = (index) => {
    setAt(index);
    pager.current?.scrollToOffset({offset: index * step, animated: true});
    // Полоса названий едет следом: до пятой колонки она не помещается, и
    // выбранное название должно оставаться на виду
    strip.current?.scrollToIndex({index, animated: true, viewPosition: 0.5});
  };

  if (!list) return <LogoLoader />;

  return (
    <View style={styles.root}>
      <FlatList
        ref={strip}
        horizontal
        data={columns}
        keyExtractor={item => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        // Названия разной длины, и точную ширину заранее не посчитать: без
        // этого scrollToIndex падает на промахе
        onScrollToIndexFailed={() => {}}
        renderItem={({item, index}) => (
          <Pressable
            style={[styles.tab, index === at && styles.tabOn]}
            onPress={() => goTo(index)}>
            <View style={[styles.dot, {backgroundColor: statusColor(item.id)}]} />
            <Text
              style={[styles.tabText, index === at && styles.tabTextOn]}
              numberOfLines={1}>
              {item.label}
            </Text>
            <Text style={[styles.tabCount, index === at && styles.tabTextOn]}>
              {item.items.length}
            </Text>
          </Pressable>
        )}
      />

      <FlatList
        ref={pager}
        horizontal
        data={columns}
        keyExtractor={item => item.id}
        showsHorizontalScrollIndicator={false}
        // Примагничивание к шагу колонки, а не постранично: страница у
        // pagingEnabled равна ширине списка, а колонка уже неё на край соседней
        snapToInterval={step}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={{paddingHorizontal: EDGE}}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / step);
          if (index === at) return;
          setAt(index);
          strip.current?.scrollToIndex({index, animated: true, viewPosition: 0.5});
        }}
        renderItem={({item}) => (
          <View style={[styles.column, {width: columnWidth, marginRight: GAP}]}>
            <FlatList
              data={item.items}
              keyExtractor={review => review.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{paddingBottom: tabInset + 16}}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => { setRefreshing(true); load(); }}
                  tintColor={c.textTertiary}
                />
              }
              ListEmptyComponent={<Text style={styles.none}>Пусто</Text>}
              renderItem={({item: review}) => (
                <Pressable
                  style={styles.card}
                  onPress={() => navigation.navigate('Review', {reviewId: review.id})}>
                  {/* Полоска этапа слева: на доске в вебе колонки различают по
                      цвету, и здесь он остаётся тем же признаком */}
                  <View style={[styles.stripe, {backgroundColor: statusColor(item.id)}]} />
                  <View style={styles.cardBody}>
                    <View style={styles.cardHead}>
                      <Stars rating={review.rating} size={13} />
                      <Text style={styles.cardWhen}>{dateText(review.reviewDate)}</Text>
                    </View>
                    <Text style={styles.cardName} numberOfLines={1}>{review.patientName}</Text>
                    <Text style={styles.cardText} numberOfLines={3}>{review.reviewText}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {[
                        review.platform?.name,
                        review.doctorName,
                        stageAge(review.stageEnteredAt),
                      ].filter(Boolean).join(' · ')}
                    </Text>
                    {Boolean(review.assignees?.length) && (
                      <Text style={styles.cardWho} numberOfLines={1}>
                        {review.assignees[0].displayName}
                      </Text>
                    )}
                  </View>
                </Pressable>
              )}
            />
          </View>
        )}
      />
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  strip: {paddingHorizontal: EDGE, paddingVertical: 10, gap: 7},
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.bgPrimary,
  },
  tabOn: {backgroundColor: c.primary},
  dot: {width: 7, height: 7, borderRadius: 3.5},
  tabText: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary},
  tabCount: {fontFamily: font.semiBold, fontSize: 12, color: c.textTertiary},
  tabTextOn: {color: '#FFFFFF'},

  column: {flex: 1},
  // Приподнятая карточка — тот же материал, что у отзыва на веб-доске
  // (.review-card в ReviewBoard.css). overflow нужен цветной полосе слева,
  // поэтому тень не задаётся: на Android overflow её всё равно погасит,
  // приподнятость держат кромка и градиент.
  card: {
    flexDirection: 'row',
    backgroundColor: c.bgPrimary,
    borderWidth: 1,
    borderColor: c.borderLight,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: 8,
  },
  stripe: {width: 3},
  cardBody: {flex: 1, padding: 12, gap: 5},
  cardHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  cardWhen: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary},
  cardName: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary},
  cardText: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, lineHeight: 18},
  cardMeta: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary},
  cardWho: {fontFamily: font.medium, fontSize: 11, color: c.primary},
  none: {
    fontFamily: font.regular,
    fontSize: 13,
    color: c.textTertiary,
    textAlign: 'center',
    paddingVertical: 30,
  },
});
