/**
 * Отзывы, назначенные мне, по всем доскам сразу.
 *
 * Отдельным экраном, а не блоком на главной: список бывает длинным, и на
 * главной он заслонял бы доски — то есть основной путь в модуль. Здесь же он
 * может быть любой длины, никому не мешая.
 *
 * Сортировка приходит с сервера по дате отзыва: свежий негатив разбирают
 * первым, и «что там нового» — тот вопрос, ради которого сюда заходят.
 */
import React, {useCallback, useState} from 'react';
import {View, Text, FlatList, Pressable, StyleSheet, RefreshControl} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';

import {reviews as reviewsApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import Stars from '../../components/Stars';
import {setReviewsBadge} from '../../store/reviewsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font, cardSurface} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {statusLabel, statusColor, stageAge, dateText} from './reviewsMeta';

export default function ReviewsAssignedScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  const [items, setItems] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => reviewsApi.assigned()
    .then(({data}) => {
      const list = data || [];
      setItems(list);
      // Счётчик в колесе берём отсюда: список уже запрошен, отдельный запрос за
      // тем же числом был бы вторым источником правды.
      setReviewsBadge(list.length);
    })
    .catch(() => setItems([]))
    .finally(() => setRefreshing(false)), []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!items) return <LogoLoader />;

  return (
    <FlatList
      style={styles.root}
      data={items}
      keyExtractor={item => item.id}
      contentContainerStyle={[styles.list, {paddingBottom: tabInset + 24}]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={c.textTertiary}
        />
      }
      ListEmptyComponent={<Text style={styles.none}>На вас ничего не назначено</Text>}
      renderItem={({item}) => (
        <Pressable
          style={styles.card}
          onPress={() => navigation.navigate('Review', {reviewId: item.id})}>
          <View style={styles.cardHead}>
            <Stars rating={item.rating} />
            <Text style={styles.cardWhen}>{dateText(item.reviewDate)}</Text>
          </View>
          <Text style={styles.cardName} numberOfLines={1}>{item.patientName}</Text>
          <Text style={styles.cardText} numberOfLines={2}>{item.reviewText}</Text>
          <View style={styles.cardFoot}>
            <View style={[styles.chip, {backgroundColor: `${statusColor(item.status)}22`}]}>
              <Text style={[styles.chipText, {color: statusColor(item.status)}]}>
                {statusLabel(item.status)}
              </Text>
            </View>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {[item.board?.name, stageAge(item.updatedAt)].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  list: {padding: 16},
  card: {
    ...cardSurface(c),
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
  none: {
    fontFamily: font.regular,
    fontSize: 13,
    color: c.textTertiary,
    textAlign: 'center',
    marginTop: 40,
  },
});
