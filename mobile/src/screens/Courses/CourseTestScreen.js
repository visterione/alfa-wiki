import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {X, ChevronLeft, Check, RotateCcw, Award, CircleX} from 'lucide-react-native';

import {courses as coursesApi} from '../../services/api';
import {font, radius, shadow} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import LogoLoader from '../../components/LogoLoader';

const PASSING_SCORE = 80;
// Буквы вариантов: латиница здесь смотрелась бы чужеродно рядом с русским текстом
const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'];

/**
 * Финальный тест — по одному вопросу на экран.
 *
 * В вебе тест это длинная страница со всеми вопросами сразу: на мониторе так
 * удобнее, видно объём и можно скакать по списку. На телефоне такая страница
 * превращается в бесконечную прокрутку, где легко пропустить вопрос и потом
 * искать, какой именно остался без ответа.
 *
 * Поэтому здесь один вопрос на экран, крупные цели касания и шкала сверху.
 * Ответ можно поменять, вернувшись назад: тест проверяется целиком в конце.
 *
 * Подсветить правильный ответ сразу после нажатия нельзя — сервер намеренно не
 * присылает правильные варианты вместе с вопросами, иначе их было бы видно в
 * трафике. Разбор показывается после отправки, там же, где и балл.
 */
export default function CourseTestScreen({route, navigation}) {
  const {courseId, courseTitle} = route.params;
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // Смена вопроса: содержимое уезжает и приезжает, а не подменяется рывком —
  // иначе на экране просто мигает текст и непонятно, сдвинулись ли мы
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    coursesApi
      .getTest(courseId)
      .then(({data}) => {
        if (alive) setQuestions(data.map(shuffleOptions));
      })
      .catch(e => {
        console.warn('[Test] load error:', e?.message);
        if (alive) {
          Alert.alert('Ошибка', 'Не удалось загрузить тест');
          navigation.goBack();
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [courseId, navigation]);

  // Выход посреди теста стирает ответы — предупреждаем. Слушатель ловит и
  // системную кнопку «назад» на Android, не только нашу крестовину.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', e => {
        if (result || !Object.keys(answers).length) return;
        e.preventDefault();
        Alert.alert('Выйти из теста?', 'Ответы не сохранятся, тест придётся начать заново.', [
          {text: 'Остаться', style: 'cancel'},
          {text: 'Выйти', style: 'destructive', onPress: () => navigation.dispatch(e.data.action)},
        ]);
      }),
    [navigation, answers, result],
  );

  const move = useCallback(
    step => {
      const next = index + step;
      if (next < 0 || next >= questions.length) return;
      Animated.timing(slide, {
        toValue: -step,
        duration: 130,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setIndex(next);
        slide.setValue(step);
        Animated.timing(slide, {
          toValue: 0,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
    },
    [index, questions.length, slide],
  );

  const submit = async () => {
    setSubmitting(true);
    try {
      // Сервер знает только исходный порядок вариантов, поэтому выбранный
      // номер переводим обратно через карту перемешивания
      const original = {};
      questions.forEach(q => {
        const picked = answers[q.id];
        if (picked !== undefined) original[q.id] = q.indexMapping[picked];
      });

      const {data} = await coursesApi.submitTest(courseId, original);
      setResult(data);
    } catch (e) {
      console.warn('[Test] submit error:', e?.message);
      Alert.alert('Ошибка', 'Не удалось отправить ответы');
    } finally {
      setSubmitting(false);
    }
  };

  const retry = () => {
    Alert.alert(
      'Пройти курс заново?',
      'Отметки о пройденных уроках и результат теста будут сброшены.',
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Начать заново',
          style: 'destructive',
          onPress: async () => {
            try {
              await coursesApi.resetProgress(courseId);
            } catch (e) {
              console.warn('[Test] reset error:', e?.message);
            }
            navigation.goBack();
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <LogoLoader width={96} />
      </View>
    );
  }

  if (result) {
    return (
      <ResultView
        result={result}
        questions={questions}
        courseTitle={courseTitle}
        styles={styles}
        c={c}
        insets={insets}
        onBack={() => navigation.goBack()}
        onRetry={retry}
      />
    );
  }

  if (!questions.length) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.muted}>В этом курсе пока нет вопросов</Text>
      </View>
    );
  }

  const question = questions[index];
  const picked = answers[question.id];
  const isLast = index === questions.length - 1;
  const answeredCount = Object.keys(answers).length;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.iconBtn}>
          <X size={22} color={c.textSecondary} />
        </TouchableOpacity>
        <View style={styles.track}>
          <View
            style={[styles.fill, {width: `${((index + 1) / questions.length) * 100}%`}]}
          />
        </View>
        <Text style={styles.counter}>
          {index + 1}/{questions.length}
        </Text>
      </View>

      <Animated.View
        style={[
          styles.stage,
          {
            opacity: slide.interpolate({
              inputRange: [-1, 0, 1],
              outputRange: [0, 1, 0],
            }),
            transform: [
              {
                translateX: slide.interpolate({
                  inputRange: [-1, 0, 1],
                  outputRange: [-40, 0, 40],
                }),
              },
            ],
          },
        ]}>
        <ScrollView
          contentContainerStyle={styles.stageContent}
          showsVerticalScrollIndicator={false}>
          <Text style={styles.question}>{question.question}</Text>

          <View style={styles.options}>
            {question.shuffledOptions.map((option, i) => {
              const active = picked === i;
              return (
                <Pressable
                  key={i}
                  style={({pressed}) => [
                    styles.option,
                    active && styles.optionActive,
                    pressed && styles.optionPressed,
                  ]}
                  onPress={() => setAnswers(prev => ({...prev, [question.id]: i}))}
                  accessibilityRole="radio"
                  accessibilityState={{checked: active}}>
                  <View style={[styles.letter, active && styles.letterActive]}>
                    <Text style={[styles.letterText, active && styles.letterTextActive]}>
                      {LETTERS[i] || i + 1}
                    </Text>
                  </View>
                  <Text style={[styles.optionText, active && styles.optionTextActive]}>
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </Animated.View>

      <View style={[styles.footer, {paddingBottom: insets.bottom + 12}]}>
        {index > 0 && (
          <TouchableOpacity style={styles.prev} onPress={() => move(-1)} hitSlop={8}>
            <ChevronLeft size={18} color={c.textSecondary} />
            <Text style={styles.prevText}>Назад</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[
            styles.button,
            picked === undefined && styles.buttonOff,
            index === 0 && styles.buttonWide,
          ]}
          activeOpacity={0.85}
          disabled={picked === undefined || submitting}
          onPress={() => (isLast ? submit() : move(1))}>
          {submitting ? (
            <LogoLoader width={52} color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>
              {isLast
                ? answeredCount < questions.length
                  ? `Ответьте на все (${answeredCount}/${questions.length})`
                  : 'Завершить тест'
                : 'Дальше'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * Разбор после отправки.
 *
 * Показываем и верные вопросы тоже: человеку важно не только увидеть балл, но
 * и понять, где именно он ошибся, — при провале курс придётся проходить целиком
 * заново, и на второй заход стоит идти с разбором на руках.
 */
function ResultView({result, questions, courseTitle, styles, c, insets, onBack, onRetry}) {
  const passed = result.passed;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.resultContent, {paddingTop: insets.top + 24}]}
        showsVerticalScrollIndicator={false}>
        <View style={[styles.scoreRing, passed ? styles.scoreRingOk : styles.scoreRingBad]}>
          <Text style={[styles.scoreValue, {color: passed ? c.success : c.error}]}>
            {result.score}%
          </Text>
        </View>

        <Text style={styles.resultTitle}>{passed ? 'Тест пройден' : 'Тест не пройден'}</Text>
        <Text style={styles.resultSubtitle}>
          {result.correctCount} из {result.totalQuestions} правильных ответов
        </Text>
        <Text style={styles.resultNote}>
          {passed
            ? `Курс «${courseTitle}» завершён.`
            : `Нужно набрать не меньше ${PASSING_SCORE}%. Курс придётся пройти заново.`}
        </Text>

        <View style={styles.review}>
          {questions.map((q, i) => {
            const res = result.results?.[q.id];
            if (!res) return null;
            return (
              <View
                key={q.id}
                style={[styles.reviewItem, res.correct ? styles.reviewOk : styles.reviewBad]}>
                <View style={styles.reviewHead}>
                  {res.correct ? (
                    <Check size={16} color={c.success} />
                  ) : (
                    <CircleX size={16} color={c.error} />
                  )}
                  <Text style={styles.reviewNumber}>Вопрос {i + 1}</Text>
                </View>
                <Text style={styles.reviewQuestion}>{q.question}</Text>
                {!res.correct && (
                  <View style={styles.reviewAnswers}>
                    <Text style={styles.reviewWrong}>
                      Ваш ответ: {q.options[res.userAnswer] ?? '—'}
                    </Text>
                    <Text style={styles.reviewRight}>
                      Правильно: {q.options[res.correctAnswer]}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, {paddingBottom: insets.bottom + 12}]}>
        {passed ? (
          <TouchableOpacity style={[styles.button, styles.buttonWide]} onPress={onBack}>
            <Award size={20} color="#FFFFFF" />
            <Text style={styles.buttonText}>Вернуться к курсу</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={styles.prev} onPress={onBack} hitSlop={8}>
              <Text style={styles.prevText}>К урокам</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={onRetry}>
              <RotateCcw size={18} color="#FFFFFF" />
              <Text style={styles.buttonText}>Начать заново</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

/**
 * Варианты в случайном порядке — как в вебе.
 *
 * Порядок правильного ответа в базе часто один и тот же, и без перемешивания
 * тест сдаётся по позиции, а не по знанию. Карта indexMapping возвращает выбор
 * к исходной нумерации при отправке.
 */
function shuffleOptions(question) {
  const indexed = question.options.map((option, i) => ({option, i}));
  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }
  return {
    ...question,
    shuffledOptions: indexed.map(item => item.option),
    indexMapping: indexed.map(item => item.i),
  };
}

const makeStyles = c => StyleSheet.create({
  screen: {flex: 1, backgroundColor: c.bgPrimary},
  center: {alignItems: 'center', justifyContent: 'center'},
  muted: {fontFamily: font.regular, fontSize: 15, color: c.textSecondary},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {flex: 1, height: 10, borderRadius: 5, backgroundColor: c.bgTertiary, overflow: 'hidden'},
  fill: {height: '100%', borderRadius: 5, backgroundColor: c.primary},
  counter: {fontFamily: font.medium, fontSize: 13, color: c.textSecondary, minWidth: 38, textAlign: 'right'},

  stage: {flex: 1},
  stageContent: {padding: 16, paddingBottom: 24},
  question: {
    fontFamily: font.semiBold,
    fontSize: 21,
    lineHeight: 29,
    color: c.textPrimary,
    marginBottom: 24,
  },

  options: {gap: 10},
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: c.borderLight,
    backgroundColor: c.bgPrimary,
  },
  optionActive: {borderColor: c.primary, backgroundColor: c.primaryLight},
  optionPressed: {opacity: 0.75},
  letter: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letterActive: {backgroundColor: c.primary},
  letterText: {fontFamily: font.semiBold, fontSize: 14, color: c.textSecondary},
  letterTextActive: {color: '#FFFFFF'},
  optionText: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 22,
    color: c.textPrimary,
  },
  optionTextActive: {fontFamily: font.medium},

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.borderLight,
  },
  prev: {flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 12, paddingRight: 4},
  prevText: {fontFamily: font.medium, fontSize: 15, color: c.textSecondary},
  button: {
    flex: 1,
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: c.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...shadow.sm,
  },
  buttonWide: {flex: 1},
  buttonOff: {backgroundColor: c.textTertiary, shadowOpacity: 0, elevation: 0},
  buttonText: {fontFamily: font.semiBold, fontSize: 16, color: '#FFFFFF'},

  resultContent: {padding: 20, paddingBottom: 32, alignItems: 'center'},
  scoreRing: {
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  scoreRingOk: {borderColor: c.success, backgroundColor: c.bgSecondary},
  scoreRingBad: {borderColor: c.error, backgroundColor: c.bgSecondary},
  scoreValue: {fontFamily: font.bold, fontSize: 34},
  resultTitle: {fontFamily: font.bold, fontSize: 24, color: c.textPrimary},
  resultSubtitle: {fontFamily: font.medium, fontSize: 15, color: c.textSecondary, marginTop: 6},
  resultNote: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    color: c.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },

  review: {alignSelf: 'stretch', marginTop: 24, gap: 10},
  reviewItem: {
    borderRadius: radius.md,
    borderLeftWidth: 3,
    backgroundColor: c.bgSecondary,
    padding: 12,
    gap: 6,
  },
  reviewOk: {borderLeftColor: c.success},
  reviewBad: {borderLeftColor: c.error},
  reviewHead: {flexDirection: 'row', alignItems: 'center', gap: 6},
  reviewNumber: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary},
  reviewQuestion: {fontFamily: font.medium, fontSize: 15, color: c.textPrimary, lineHeight: 21},
  reviewAnswers: {gap: 2},
  reviewWrong: {fontFamily: font.regular, fontSize: 13, color: c.error},
  reviewRight: {fontFamily: font.regular, fontSize: 13, color: c.success},
});
