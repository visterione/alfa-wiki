/**
 * Доска отзывов — тот же канбан, что в вебе, но по одной колонке за раз.
 *
 * Пять колонок рядом на телефон не помещаются никак: даже вдвое сжатая колонка
 * даёт карточку в полтора слова. Поэтому колонки стали вкладками, между
 * которыми листают пальцем, — порядок тот же, что в вебе, и переход слева
 * направо совпадает с движением отзыва по этапам.
 *
 * Число на вкладке — это и есть та самая «высота колонки», по которой в вебе
 * видно, где затор.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet, RefreshControl} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';

import {reviews as reviewsApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import Stars from '../../components/Stars';
import SwipeTabs from '../../components/SwipeTabs';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {REVIEW_STATUSES, statusColor, stageAge, dateText} from './reviewsMeta';

export default function ReviewBoardScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  const {boardId} = route.params || {};
  const [list, setList] = useState(null);
  const [tab, setTab] = useState('new');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => reviewsApi.list(boardId)
    .then(({data}) => setList(data || []))
    .catch(() => setList([]))
    .finally(() => setRefreshing(false)), [boardId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const byStatus = useMemo(() => {
    const out = {};
    for (const status of REVIEW_STATUSES) out[status.id] = [];
    for (const review of list || []) {
      if (out[review.status]) out[review.status].push(review);
    }
    return out;
  }, [list]);

  if (!list) return <LogoLoader />;

  const page = status => (
    <View style={styles.page}>
      {byStatus[status].map(review => (
        <Pressable
          key={review.id}
          style={styles.card}
          onPress={() => navigation.navigate('Review', {reviewId: review.id})}>
          <View style={styles.cardHead}>
            <Stars rating={review.rating} />
            <Text style={styles.cardWhen}>{dateText(review.reviewDate)}</Text>
          </View>
          <Text style={styles.cardName} numberOfLines={1}>{review.patientName}</Text>
          <Text style={styles.cardText} numberOfLines={2}>{review.reviewText}</Text>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {[
              review.platform?.name,
              review.doctorName,
              stageAge(review.stageEnteredAt),
              review.assignees?.[0]?.displayName,
            ].filter(Boolean).join(' · ')}
          </Text>
        </Pressable>
      ))}
      {!byStatus[status].length && <Text style={styles.none}>Пусто</Text>}
    </View>
  );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, {paddingBottom: tabInset + 24}]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={c.textTertiary}
        />
      }>
      <SwipeTabs
        value={tab}
        onChange={setTab}
        tabs={REVIEW_STATUSES.map(status => ({
          key: status.id,
          // Подпись короткая, а число — то, ради чего на вкладку и смотрят
          label: `${status.label} ${byStatus[status.id].length}`,
        }))}>
        {REVIEW_STATUSES.map(status => (
          <View key={status.id} style={styles.pageWrap}>
            <View style={[styles.stripe, {backgroundColor: statusColor(status.id)}]} />
            {page(status.id)}
          </View>
        ))}
      </SwipeTabs>
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 16},
  pageWrap: {width: '100%'},
  page: {width: '100%'},
  // Цвет этапа из веб-версии: там колонки различают по нему, и человек,
  // переходящий с компьютера на телефон, ищет знакомый признак
  stripe: {height: 3, borderRadius: 2, marginBottom: 10},
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
  cardMeta: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary},
  none: {
    fontFamily: font.regular,
    fontSize: 13,
    color: c.textTertiary,
    textAlign: 'center',
    paddingVertical: 30,
  },
});
