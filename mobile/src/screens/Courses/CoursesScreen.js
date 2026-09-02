import React, {useCallback, useState} from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {GraduationCap, Award, BookOpen, Play} from 'lucide-react-native';

import {courses as coursesApi} from '../../services/api';
import {font, radius, cardSurface} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import LogoLoader from '../../components/LogoLoader';

/**
 * Список курсов, доступных сотруднику.
 *
 * Карточка сразу показывает, на чём человек остановился: пройденные отмечены
 * медалью, начатые — полосой прогресса. Ради этого список перечитывается на
 * каждом возвращении с курса, иначе после урока карточка показывала бы старое
 * число пройденных.
 */
export default function CoursesScreen({navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Панель лежит поверх экрана, поэтому последняя карточка иначе оказалась бы
  // наполовину под ней
  const tabInset = useTabBarInset();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const {data} = await coursesApi.list();
      setList(data);
      setFailed(false);
    } catch (e) {
      console.warn('[Courses] load error:', e?.message);
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <LogoLoader width={96} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[
        list.length ? styles.content : styles.contentEmpty,
        {paddingBottom: tabInset + 16},
      ]}
      data={list}
      keyExtractor={item => String(item.id)}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />
      }
      renderItem={({item}) => (
        <CourseCard
          course={item}
          styles={styles}
          c={c}
          onPress={() =>
            navigation.navigate('Course', {courseId: item.id, title: item.title})
          }
        />
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <GraduationCap size={56} color={c.textTertiary} />
          <Text style={styles.emptyTitle}>
            {failed ? 'Не удалось загрузить курсы' : 'Курсов пока нет'}
          </Text>
          <Text style={styles.emptyText}>
            {failed
              ? 'Проверьте соединение и потяните экран вниз'
              : 'Здесь появятся курсы, назначенные вам'}
          </Text>
        </View>
      }
    />
  );
}

function CourseCard({course, styles, c, onPress}) {
  const total = course.lessonsCount || 0;
  const done = course.userProgress?.completedLessons || 0;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const finished = Boolean(course.userProgress?.completedAt);
  const started = done > 0 && !finished;

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      {/* Полоса состояния по верху карточки — то же самое, что в вебе
          (.course-card::before в Courses.css): зелёная у пройденного,
          акцентная у начатого, серая у нетронутого. Скругления повторены на
          самой полосе, а не срезаны через overflow: 'hidden' у карточки, —
          на Android overflow гасит elevation, и карточка осталась бы без тени. */}
      <View
        style={[
          styles.statusStripe,
          {backgroundColor: finished ? c.success : started ? c.primary : c.border},
        ]}
      />
      <View style={styles.cardTop}>
        <View style={[styles.icon, finished && styles.iconDone]}>
          {finished ? (
            <Award size={22} color={c.success} />
          ) : started ? (
            <Play size={20} color={c.primary} fill={c.primary} />
          ) : (
            <BookOpen size={20} color={c.primary} />
          )}
        </View>

        <View style={styles.cardText}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {course.title}
          </Text>
          {!!course.description && (
            <Text style={styles.cardDescription} numberOfLines={2}>
              {course.description}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              // Ноль процентов рисуем как пустую полосу: полоска шириной 0 с
              // закруглением превращается в точку и читается как начатый курс
              {width: `${percent}%`, backgroundColor: finished ? c.success : c.primary},
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {finished
            ? `Пройден · ${course.userProgress.testScore ?? percent}%`
            : total
              ? `${done} из ${total}`
              : 'Нет уроков'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = c => StyleSheet.create({
  screen: {flex: 1, backgroundColor: c.bgSecondary},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bgSecondary},
  content: {padding: 16, paddingBottom: 32, gap: 12},
  contentEmpty: {flexGrow: 1},

  // paddingTop на четыре пункта больше остальных: сверху лежит полоса
  // состояния, и без запаса заголовок вставал бы вплотную к ней
  card: {
    ...cardSurface(c),
    borderRadius: radius.lg,
    padding: 16,
    paddingTop: 20,
  },
  statusStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  cardTop: {flexDirection: 'row', gap: 12},
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDone: {backgroundColor: c.bgTertiary},
  cardText: {flex: 1, gap: 4},
  cardTitle: {fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary},
  cardDescription: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 18,
    color: c.textSecondary,
  },

  cardFooter: {flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14},
  track: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: c.bgTertiary,
    overflow: 'hidden',
  },
  fill: {height: '100%', borderRadius: 3},
  progressText: {
    fontFamily: font.medium,
    fontSize: 12,
    color: c.textSecondary,
    minWidth: 64,
    textAlign: 'right',
  },

  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8},
  emptyTitle: {fontFamily: font.semiBold, fontSize: 17, color: c.textPrimary, marginTop: 8},
  emptyText: {
    fontFamily: font.regular,
    fontSize: 14,
    color: c.textSecondary,
    textAlign: 'center',
  },
});
