import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Check, Lock, Play, Trophy} from 'lucide-react-native';

import {courses as coursesApi} from '../../services/api';
import {font, radius, shadow} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import LogoLoader from '../../components/LogoLoader';

/**
 * Курс: лента уроков сверху вниз с рельсой прогресса слева.
 *
 * Сначала здесь была «тропа» кружками по волне, как в Duolingo, — и на живом
 * курсе она развалилась: подпись урока стояла между двумя кружками и читалась
 * как подпись нижнего, линия шла сквозь буквы, а длинные названия обрезались
 * многоточием. У Duolingo уроки называются одним словом и подписей на карте
 * нет вовсе; наши — это «Персональные данные, "медицинская тайна" и согласия»,
 * и они требуют места.
 *
 * Поэтому названия лежат в карточках одной колонкой, а состояние показывает
 * рельса: пройденный участок акцентный, дальше серый. Ничего не наезжает при
 * любой длине названия и любом числе уроков.
 *
 * Порядок доступа тот же, что в вебе: урок открыт, если завершён предыдущий.
 * Тест открывается, когда пройдены все уроки.
 */
export default function CourseScreen({route, navigation}) {
  const {courseId} = route.params;
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Экран курса — единственный вложенный, на котором панель остаётся видимой,
  // и лента уроков уходит под неё без этого отступа
  const tabInset = useTabBarInset();

  const [course, setCourse] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const {data} = await coursesApi.get(courseId);
      setCourse(data);
      navigation.setOptions({title: data.title});
    } catch (e) {
      console.warn('[Course] load error:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [courseId, navigation]);

  // Перечитываем на каждом возвращении: урок и тест меняют прогресс, а лента
  // обязана показывать его сразу, без ручного обновления
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <LogoLoader width={96} />
      </View>
    );
  }

  if (!course) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Курс не загрузился</Text>
      </View>
    );
  }

  const lessons = course.lessons || [];
  const completed = course.userProgress?.completedLessons || [];
  const hasTest = (course.testQuestions?.length || 0) > 0;
  const allDone = lessons.length > 0 && lessons.every(l => completed.includes(l.id));
  const passed = Boolean(course.userProgress?.completedAt);

  const openLesson = lessonId => {
    navigation.navigate('Lesson', {
      courseId,
      lessonId,
      courseTitle: course.title,
      lessons: lessons.map(l => ({id: l.id, title: l.title})),
      completed,
      hasTest,
    });
  };

  const rows = lessons.map((lesson, i) => {
    const done = completed.includes(lesson.id);
    const open = i === 0 || completed.includes(lessons[i - 1].id);
    return {
      key: String(lesson.id),
      caption: `Урок ${i + 1}`,
      title: lesson.title,
      state: done ? 'done' : open ? 'open' : 'locked',
      onPress: () => openLesson(lesson.id),
    };
  });

  if (hasTest) {
    rows.push({
      key: 'test',
      caption: 'Финальный тест',
      // Балл за тест больше показывать негде: шапки с прогрессом на экране нет,
      // поэтому сданный тест несёт его сам
      title: passed
        ? `Пройден · ${course.userProgress.testScore}%`
        : `${course.testQuestions.length} ${plural(course.testQuestions.length, 'вопрос')}`,
      test: true,
      state: passed ? 'done' : allDone ? 'open' : 'locked',
      onPress: () =>
        navigation.navigate('CourseTest', {courseId, courseTitle: course.title}),
    });
  }

  // Текущий шаг — первый доступный незавершённый. Он и подсвечен в ленте
  const currentIndex = rows.findIndex(r => r.state === 'open');

  return (
    // Никакой шапки над лентой: название курса стоит в навигационной шапке,
    // описание человек читал в списке курсов, а долю пройденного показывает
    // сама рельса — цветом до текущего шага. Ещё и полоса процентов говорила бы
    // то же самое второй раз, отодвигая первый урок за сгиб экрана.
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, {paddingBottom: tabInset + 16}]}
      showsVerticalScrollIndicator={false}>
      {rows.length ? (
        <View style={styles.list}>
          {rows.map((row, i) => (
            <Row
              key={row.key}
              row={row}
              first={i === 0}
              last={i === rows.length - 1}
              // Рельса над шагом акцентная, если предыдущий шаг пройден:
              // цвет показывает, докуда человек дошёл
              railAbove={i > 0 && rows[i - 1].state === 'done'}
              railBelow={row.state === 'done'}
              current={i === currentIndex}
              styles={styles}
              c={c}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>В курс ещё не добавили уроки</Text>
      )}
    </ScrollView>
  );
}

/**
 * Шаг ленты: точка на рельсе и карточка рядом.
 *
 * Закрытый урок не молчит на нажатие — карточка коротко дёргается. Всплывающее
 * окно здесь было бы грубее: правило и так очевидно, а окно надо закрывать.
 */
function Row({row, first, last, railAbove, railBelow, current, styles, c}) {
  const locked = row.state === 'locked';
  const done = row.state === 'done';

  const shake = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!current) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {toValue: 0, duration: 0, useNativeDriver: true}),
        Animated.delay(900),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [current, pulse]);

  const press = () => {
    if (!locked) {
      row.onPress();
      return;
    }
    Animated.sequence([
      Animated.timing(shake, {toValue: 1, duration: 55, useNativeDriver: true}),
      Animated.timing(shake, {toValue: -1, duration: 55, useNativeDriver: true}),
      Animated.timing(shake, {toValue: 0.5, duration: 55, useNativeDriver: true}),
      Animated.timing(shake, {toValue: 0, duration: 55, useNativeDriver: true}),
    ]).start();
  };

  const Icon = locked ? Lock : row.test ? Trophy : done ? Check : Play;

  return (
    <View style={styles.row}>
      {/* Рельса тянется на всю высоту шага, включая просвет до следующей
          карточки, — иначе линия рвалась бы между ними */}
      <View style={styles.rail}>
        <View
          style={[
            styles.segment,
            styles.segmentTop,
            railAbove && styles.segmentDone,
            first && styles.segmentHidden,
          ]}
        />
        <View
          style={[
            styles.segment,
            styles.segmentBottom,
            railBelow && styles.segmentDone,
            last && styles.segmentHidden,
          ]}
        />

        {current && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pulse,
              {
                opacity: pulse.interpolate({inputRange: [0, 1], outputRange: [0.4, 0]}),
                transform: [
                  {scale: pulse.interpolate({inputRange: [0, 1], outputRange: [1, 1.9]})},
                ],
              },
            ]}
          />
        )}
        <View
          style={[
            styles.dot,
            done && styles.dotDone,
            locked && styles.dotLocked,
            current && styles.dotCurrent,
          ]}>
          <Icon size={18} color={done ? '#FFFFFF' : locked ? c.textTertiary : c.primary} />
        </View>
      </View>

      <Animated.View
        style={[
          styles.cardWrap,
          {transform: [{translateX: shake.interpolate({
            inputRange: [-1, 1],
            outputRange: [-7, 7],
          })}]},
        ]}>
        <Pressable
          onPress={press}
          accessibilityRole="button"
          accessibilityLabel={`${row.caption}. ${row.title}`}
          accessibilityState={{disabled: locked}}
          style={({pressed}) => [
            styles.card,
            locked && styles.cardLocked,
            current && styles.cardCurrent,
            pressed && !locked && styles.cardPressed,
          ]}>
          <View style={styles.cardHead}>
            <Text style={[styles.caption, locked && styles.mutedText]} numberOfLines={1}>
              {row.caption}
            </Text>
            {current ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>Сейчас</Text>
              </View>
            ) : done ? (
              <Check size={16} color={c.success} />
            ) : (
              <Lock size={14} color={c.textTertiary} />
            )}
          </View>
          <Text style={[styles.title, locked && styles.mutedText]}>{row.title}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function plural(n, word) {
  const forms = word === 'урок'
    ? ['урок', 'урока', 'уроков']
    : ['вопрос', 'вопроса', 'вопросов'];
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

// Ширина колонки с рельсой и размер точки: точка обязана стоять ровно на линии,
// поэтому обе величины считаются от одного центра
const RAIL = 44;
const DOT = 34;

const makeStyles = c => StyleSheet.create({
  screen: {flex: 1, backgroundColor: c.bgSecondary},
  content: {paddingBottom: 32},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bgSecondary},
  muted: {
    fontFamily: font.regular,
    fontSize: 14,
    color: c.textSecondary,
    textAlign: 'center',
    marginTop: 24,
  },

  // Слева ровно столько, чтобы точка не липла к краю экрана
  list: {paddingLeft: 10, paddingRight: 16, paddingTop: 10},
  row: {flexDirection: 'row'},

  rail: {width: RAIL, alignItems: 'center', justifyContent: 'center'},
  // Половинки линии, а не одна на всю высоту: только так участок до точки и
  // после неё можно красить разным цветом
  segment: {position: 'absolute', width: 3, backgroundColor: c.borderLight},
  segmentTop: {top: 0, height: '50%'},
  segmentBottom: {bottom: 0, height: '50%'},
  segmentDone: {backgroundColor: c.primary},
  segmentHidden: {backgroundColor: 'transparent'},

  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: c.bgPrimary,
    borderWidth: 2,
    borderColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: {backgroundColor: c.primary},
  dotLocked: {backgroundColor: c.bgTertiary, borderColor: c.border},
  dotCurrent: {borderWidth: 3},
  pulse: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: c.primary,
  },

  cardWrap: {flex: 1, paddingVertical: 6},
  card: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    padding: 14,
    gap: 6,
    ...shadow.sm,
  },
  cardCurrent: {borderColor: c.primary},
  // Закрытый урок держится фоном подложки: он часть ленты, но не приглашает
  // нажать, поэтому ни тени, ни белого фона у него нет
  cardLocked: {
    backgroundColor: c.bgSecondary,
    borderColor: c.borderLight,
    shadowOpacity: 0,
    elevation: 0,
  },
  cardPressed: {opacity: 0.75},
  cardHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
  caption: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 11,
    letterSpacing: 0.6,
    color: c.textSecondary,
    textTransform: 'uppercase',
  },
  badge: {
    backgroundColor: c.primary,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: font.semiBold,
    fontSize: 10,
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  title: {
    fontFamily: font.semiBold,
    fontSize: 15,
    lineHeight: 21,
    color: c.textPrimary,
  },
  mutedText: {color: c.textTertiary},
});
