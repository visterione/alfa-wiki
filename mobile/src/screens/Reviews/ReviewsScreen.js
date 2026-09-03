/**
 * Отзывы — список досок.
 *
 * ── Что изменилось после первой версии ───────────────────────────────────────
 *
 * Сначала сверху лежал разложенный список назначенного мне, и до досок надо было
 * пролистать его целиком. Это неверно вдвойне: список бывает длинным, а доски —
 * основной способ попасть в модуль. Теперь «Назначено мне» это одна строка со
 * счётчиком, открывающая отдельный экран, и она ничего не заслоняет.
 *
 * Доски показываются со знаком медцентра: доска и есть медцентр, и узнают её по
 * знаку быстрее, чем по названию среди пяти похожих.
 */
import React, {useCallback, useState} from 'react';
import {View, Text, Image, FlatList, Pressable, StyleSheet, RefreshControl} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {ChevronRight, UserCheck, LayoutGrid, Star} from 'lucide-react-native';

import CONFIG from '../../config';
import LogoLoader from '../../components/LogoLoader';
import {loadReviewBoards, useReviewsBadge, refreshReviewsBadge} from '../../store/reviewsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font, cardSurface} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';

export default function ReviewsScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  const assignedCount = useReviewsBadge();
  const [boards, setBoards] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await loadReviewBoards({force: true});
    setBoards(list || []);
    refreshReviewsBadge();
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!boards) return <LogoLoader />;

  return (
    <FlatList
      style={styles.root}
      data={boards}
      keyExtractor={item => item.id}
      contentContainerStyle={[styles.list, {paddingBottom: tabInset + 24}]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={c.textTertiary}
        />
      }
      ListHeaderComponent={
        <>
          {/* Одна строка вместо списка: сколько на мне и куда нажать, чтобы
              это увидеть. Ноль тоже показывается — «ничего не назначено» это
              полезный ответ, а исчезающая строка сбивает с толку. */}
          <Pressable
            style={styles.mine}
            onPress={() => navigation.navigate('ReviewsAssigned')}>
            <View style={styles.mineIcon}>
              <UserCheck size={19} color="#FFFFFF" />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.mineTitle}>Назначено мне</Text>
              <Text style={styles.rowSub}>
                {assignedCount > 0 ? `В работе: ${assignedCount}` : 'Ничего не назначено'}
              </Text>
            </View>
            {assignedCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{assignedCount}</Text>
              </View>
            )}
            <ChevronRight size={16} color={c.textTertiary} />
          </Pressable>

          <Text style={styles.section}>Доски</Text>
        </>
      }
      ListEmptyComponent={<Text style={styles.none}>Досок с отзывами нет</Text>}
      renderItem={({item}) => {
        const logo = item.logoUrl ? CONFIG.fileUrl(item.logoUrl) : null;
        return (
          <Pressable
            style={styles.board}
            onPress={() => navigation.navigate('ReviewBoard', {
              boardId: item.id,
              title: item.name,
            })}>
            {/* Знак на белом: логотипы нарисованы под светлую подложку и на
                тёмной теме сливаются с фоном */}
            {logo ? (
              <Image source={{uri: logo}} style={styles.logo} resizeMode="contain" />
            ) : (
              <View style={styles.boardIcon}>
                <LayoutGrid size={19} color={c.primary} />
              </View>
            )}
            <View style={styles.rowText}>
              <Text style={styles.boardTitle} numberOfLines={1}>{item.name}</Text>
              <View style={styles.stats}>
                <Text style={styles.rowSub}>{item.reviewCount || 0} отзывов</Text>
                {Boolean(item.avgRating) && (
                  <View style={styles.rating}>
                    <Star size={11} color={c.warning} fill={c.warning} />
                    <Text style={styles.ratingText}>{item.avgRating}</Text>
                  </View>
                )}
              </View>
            </View>
            {item.assignedToMeCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.assignedToMeCount}</Text>
              </View>
            )}
            <ChevronRight size={16} color={c.textTertiary} />
          </Pressable>
        );
      }}
    />
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  list: {padding: 16},
  mine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...cardSurface(c),
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  mineIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mineTitle: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  section: {
    fontFamily: font.semiBold,
    fontSize: 15,
    color: c.textPrimary,
    marginTop: 22,
    marginBottom: 8,
  },
  board: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...cardSurface(c),
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 8,
  },
  logo: {width: 38, height: 38, borderRadius: radius.md, backgroundColor: '#FFFFFF'},
  boardIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardTitle: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  stats: {flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2},
  rating: {flexDirection: 'row', alignItems: 'center', gap: 3},
  ratingText: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary},
  rowText: {flex: 1},
  rowSub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary},
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
    paddingVertical: 24,
  },
});
