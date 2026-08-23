/**
 * Отзывы — главный экран раздела.
 *
 * Первым идёт не список досок, а то, что назначено лично тебе. Доска в вебе —
 * это канбан на пять колонок, и на телефоне она нужна редко: чаще человек
 * открывает раздел, потому что пришло уведомление «вам назначен отзыв», и
 * хочет увидеть именно его. Доски ниже — для тех случаев, когда надо посмотреть
 * общую картину.
 *
 * Модуль доступен не всем: доступ раздаётся досками, и у кого их нет, тот сюда
 * не попадёт вовсе — кнопки в колесе не будет (см. reviewsStore).
 */
import React, {useCallback, useState} from 'react';
import {View, Text, FlatList, Pressable, StyleSheet, RefreshControl} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {ChevronRight, LayoutGrid} from 'lucide-react-native';

import {reviews as reviewsApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import Stars from '../../components/Stars';
import {loadReviewBoards, setReviewsBadge} from '../../store/reviewsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {statusLabel, statusColor, stageAge, dateText} from './reviewsMeta';

export default function ReviewsScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  const [boards, setBoards] = useState(null);
  const [assigned, setAssigned] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [boardList, assignedResult] = await Promise.all([
      loadReviewBoards({force: true}),
      reviewsApi.assigned().catch(() => ({data: []})),
    ]);
    setBoards(boardList || []);
    const mine = assignedResult.data || [];
    setAssigned(mine);
    // Счётчик в колесе берём отсюда: список уже запрошен, отдельный запрос за
    // тем же числом был бы вторым источником правды.
    setReviewsBadge(mine.length);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!boards) return <LogoLoader />;

  const openReview = id => navigation.navigate('Review', {reviewId: id});

  // Список собирается заранее одним массивом: заголовки и карточки — разная
  // разметка, а прокрутка должна быть непрерывной.
  const items = [
    {type: 'head', key: 'h-mine', title: 'Назначено мне', count: assigned.length},
    ...assigned.map(review => ({type: 'review', key: `r-${review.id}`, review})),
    ...(assigned.length ? [] : [{type: 'none', key: 'none', text: 'Ничего не назначено'}]),
    {type: 'head', key: 'h-boards', title: 'Доски', count: boards.length},
    ...boards.map(board => ({type: 'board', key: `b-${board.id}`, board})),
  ];

  return (
    <FlatList
      style={styles.root}
      data={items}
      keyExtractor={item => item.key}
      contentContainerStyle={[styles.list, {paddingBottom: tabInset + 24}]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={c.textTertiary}
        />
      }
      ListEmptyComponent={<Text style={styles.none}>Досок с отзывами нет</Text>}
      renderItem={({item}) => {
        if (item.type === 'head') {
          return (
            <View style={styles.head}>
              <Text style={styles.headText}>{item.title}</Text>
              <Text style={styles.headCount}>{item.count}</Text>
            </View>
          );
        }

        if (item.type === 'none') {
          return <Text style={styles.none}>{item.text}</Text>;
        }

        if (item.type === 'board') {
          const {board} = item;
          return (
            <Pressable
              style={styles.board}
              onPress={() => navigation.navigate('ReviewBoard', {
                boardId: board.id,
                title: board.name,
              })}>
              <View style={styles.boardIcon}>
                <LayoutGrid size={19} color={c.primary} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.boardTitle}>{board.name}</Text>
                <Text style={styles.rowSub}>
                  Отзывов: {board.reviewCount}
                  {board.avgRating ? ` · средняя ${board.avgRating}` : ''}
                </Text>
              </View>
              {/* Число назначенного мне на этой доске: оно объясняет, зачем
                  открывать именно её, раньше чем человек её откроет */}
              {board.assignedToMeCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{board.assignedToMeCount}</Text>
                </View>
              )}
              <ChevronRight size={16} color={c.textTertiary} />
            </Pressable>
          );
        }

        const {review} = item;
        return (
          <Pressable style={styles.card} onPress={() => openReview(review.id)}>
            <View style={styles.cardHead}>
              <Stars rating={review.rating} />
              <Text style={styles.cardWhen}>{dateText(review.reviewDate)}</Text>
            </View>
            <Text style={styles.cardName} numberOfLines={1}>{review.patientName}</Text>
            <Text style={styles.cardText} numberOfLines={2}>{review.reviewText}</Text>
            <View style={styles.cardFoot}>
              <View style={[styles.chip, {backgroundColor: `${statusColor(review.status)}22`}]}>
                <Text style={[styles.chipText, {color: statusColor(review.status)}]}>
                  {statusLabel(review.status)}
                </Text>
              </View>
              <Text style={styles.cardMeta} numberOfLines={1}>
                {[review.board?.name, stageAge(review.stageEnteredAt || review.updatedAt)]
                  .filter(Boolean).join(' · ')}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  list: {padding: 16},
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 8,
  },
  headText: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  headCount: {fontFamily: font.medium, fontSize: 13, color: c.textTertiary},

  card: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 8,
    gap: 6,
  },
  cardHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  cardWhen: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary},
  cardName: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  cardText: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, lineHeight: 18},
  cardFoot: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2},
  cardMeta: {flex: 1, fontFamily: font.regular, fontSize: 11, color: c.textTertiary},
  chip: {paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10},
  chipText: {fontFamily: font.semiBold, fontSize: 11},

  board: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 8,
  },
  boardIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardTitle: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  rowText: {flex: 1},
  rowSub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  badge: {
    minWidth: 22,
    paddingHorizontal: 7,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {fontFamily: font.semiBold, fontSize: 12, color: '#FFFFFF'},
  none: {
    fontFamily: font.regular,
    fontSize: 13,
    color: c.textTertiary,
    textAlign: 'center',
    paddingVertical: 20,
  },
});
