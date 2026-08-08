import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ArrowLeft, Check, ChevronRight, Trophy} from 'lucide-react-native';

import {courses as coursesApi} from '../../services/api';
import HtmlContent from '../../components/HtmlContent';
import {font, radius, shadow} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import LogoLoader from '../../components/LogoLoader';

/**
 * Урок: материал и одна кнопка внизу.
 *
 * Вертикаль здесь единственная возможная: в вебе рядом с текстом стоит панель
 * с программой курса и три кнопки под ним — «Назад», «Завершено», «Дальше». На
 * телефоне такой ряд не помещается, а главное — из него непонятно, что нажать.
 * Поэтому программа осталась на тропе курса, а внизу одна кнопка, которая сама
 * отмечает урок пройденным и ведёт дальше.
 *
 * Переход к следующему уроку делается replace, а не push: иначе кнопка «назад»
 * отматывала бы курс урок за уроком, вместо того чтобы вернуть к тропе.
 */
export default function LessonScreen({route, navigation}) {
  const {courseId, lessonId, lessons = [], hasTest, courseTitle} = route.params;
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const scroller = useRef(null);

  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Свой список завершённого: экран курса перечитает его сам, а до тех пор
  // кнопка должна знать, отмечен ли этот урок
  const [completed, setCompleted] = useState(route.params.completed || []);

  const index = lessons.findIndex(l => String(l.id) === String(lessonId));
  const isLast = index === lessons.length - 1;
  const isDone = completed.some(id => String(id) === String(lessonId));

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // Прокрутку сбрасываем сразу: следующий урок обязан открыться с начала,
    // а не с той же высоты, где закончился предыдущий
    scroller.current?.scrollTo({y: 0, animated: false});

    coursesApi
      .getLesson(courseId, lessonId)
      .then(({data}) => {
        if (alive) setLesson(data);
      })
      .catch(e => {
        console.warn('[Lesson] load error:', e?.message);
        if (alive) {
          Alert.alert('Ошибка', 'Не удалось загрузить урок');
          navigation.goBack();
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    // Отметка «читает этот урок»: с неё продолжают и веб, и телефон
    coursesApi.setCurrentLesson(courseId, lessonId).catch(() => {});

    return () => {
      alive = false;
    };
  }, [courseId, lessonId, navigation]);

  const goNext = nextCompleted => {
    if (!isLast) {
      navigation.replace('Lesson', {
        ...route.params,
        lessonId: lessons[index + 1].id,
        completed: nextCompleted,
      });
      return;
    }
    if (hasTest) {
      navigation.replace('CourseTest', {courseId, courseTitle});
      return;
    }
    navigation.goBack();
  };

  const finish = async () => {
    if (isDone) {
      goNext(completed);
      return;
    }

    setSaving(true);
    try {
      const {data} = await coursesApi.completeLesson(courseId, lessonId);
      const next = data?.completedLessons || [...completed, lessonId];
      setCompleted(next);
      goNext(next);
    } catch (e) {
      console.warn('[Lesson] complete error:', e?.message);
      Alert.alert('Ошибка', 'Не удалось сохранить прогресс');
    } finally {
      setSaving(false);
    }
  };

  const buttonLabel = isLast
    ? hasTest
      ? 'К финальному тесту'
      : 'Завершить курс'
    : isDone
      ? 'Следующий урок'
      : 'Готово, дальше';

  const ButtonIcon = isLast && hasTest ? Trophy : isDone ? ChevronRight : Check;

  return (
    <View style={styles.screen}>
      {/* Своя шапка вместо навигационной: в ней шкала уроков, а её высоту
          и цвет заголовка стандартная не даёт настроить по месту */}
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.back}>
          <ArrowLeft size={22} color={c.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerCaption} numberOfLines={1}>
            Урок {index + 1} из {lessons.length}
          </Text>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {lesson?.title || courseTitle}
          </Text>
        </View>
      </View>

      {/* Шкала из отрезков по числу уроков: сплошная полоса на телефоне не
          показывает, сколько шагов осталось, а отрезки показывают */}
      <View style={styles.steps}>
        {lessons.map((l, i) => (
          <View
            key={l.id}
            style={[
              styles.step,
              (completed.some(id => String(id) === String(l.id)) || i < index) && styles.stepDone,
              i === index && styles.stepCurrent,
            ]}
          />
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <LogoLoader width={96} />
        </View>
      ) : (
        <ScrollView
          ref={scroller}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}>
          <Text style={styles.lessonTitle}>{lesson?.title}</Text>
          <HtmlContent html={lesson?.content} width={width - 32} />
        </ScrollView>
      )}

      <View style={[styles.footer, {paddingBottom: insets.bottom + 12}]}>
        <TouchableOpacity
          style={[styles.button, saving && styles.buttonBusy]}
          onPress={finish}
          activeOpacity={0.85}
          disabled={saving || loading}>
          {saving ? (
            <LogoLoader width={52} color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.buttonText}>{buttonLabel}</Text>
              <ButtonIcon size={20} color="#FFFFFF" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  screen: {flex: 1, backgroundColor: c.bgPrimary},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: c.bgPrimary,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {flex: 1},
  headerCaption: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary},
  headerTitle: {fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary},

  steps: {flexDirection: 'row', gap: 4, paddingHorizontal: 16, paddingBottom: 12},
  step: {flex: 1, height: 4, borderRadius: 2, backgroundColor: c.bgTertiary},
  stepDone: {backgroundColor: c.primary},
  stepCurrent: {backgroundColor: c.primary, opacity: 0.55},

  body: {flex: 1},
  bodyContent: {padding: 16, paddingBottom: 32},
  lessonTitle: {
    fontFamily: font.bold,
    fontSize: 22,
    lineHeight: 28,
    color: c.textPrimary,
    marginBottom: 16,
  },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.borderLight,
    backgroundColor: c.bgPrimary,
  },
  button: {
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: c.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...shadow.sm,
  },
  buttonBusy: {opacity: 0.7},
  buttonText: {fontFamily: font.semiBold, fontSize: 16, color: '#FFFFFF'},
});
