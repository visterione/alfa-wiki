import React, {useEffect, useRef} from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {getFocusedRouteNameFromRoute} from '@react-navigation/native';
import {Settings, User, CalendarDays, GraduationCap} from 'lucide-react-native';

import {font} from '../theme';
import {useTheme, useThemedStyles} from '../store/settingsStore';
import {useUnreadTotal} from '../store/unreadStore';
import {TAB_BAR_HEIGHT} from './tabBarLayout';

/**
 * Нижняя панель с вырезом под кнопку «Альфа».
 *
 * Раньше кнопка просто наезжала на панель сверху и читалась как случайно
 * приклеенная. Здесь панель рисуется не прямоугольником, а фигурой с плавной
 * выемкой посередине, и логотип лежит в этой выемке — как в гнезде.
 *
 * Из-за выемки фон панели нельзя задать через backgroundColor: форму даёт
 * SVG-контур. Верхний край обводится отдельным контуром, иначе граница панели
 * обрывалась бы на подходе к вырезу.
 */

// Экраны, на которых панель не нужна: у них своя навигация назад.
// Урок и тест вдобавок держат внизу собственную кнопку — рядом с панелью она
// оказалась бы вторым рядом органов управления над жестовой полосой.
const HIDDEN_ROUTES = [
  'Chat', 'NewChat', 'ChatInfo', 'CalendarEvent', 'CalendarEventEdit',
  'Lesson', 'CourseTest',
];

const BAR_HEIGHT = TAB_BAR_HEIGHT;
const ORB_SIZE = 54;
// Столько же длится переход между экранами стека (STACK_ANIMATION в
// AppNavigator): панель обязана уезжать вместе с экраном, а не вдогонку ему
const SLIDE_DURATION = 220;
// Радиус выреза на 6pt больше радиуса кнопки: по всему обводу остаётся
// одинаковый просвет, из-за которого кнопка читается вложенной в панель,
// а не залепившей отверстие.
const NOTCH_RADIUS = ORB_SIZE / 2 + 6;
// Радиус скруглений на переходе от прямого края к вырезу
const SHOULDER_RADIUS = 10;

const ICONS = {
  ProfileTab: User,
  CalendarTab: CalendarDays,
  CoursesTab: GraduationCap,
  SettingsTab: Settings,
};

/**
 * Контур верхнего края панели с вырезом посередине.
 *
 * Вырез — не приблизительная кривая, а ровная окружность того же центра, что и
 * кнопка: только так просвет вокруг неё одинаков по всему обводу. Дуга сама по
 * себе упирается в прямой край вертикально, углом, поэтому по бокам к ней
 * добавлены скругления обратной кривизны.
 *
 * Скругление радиуса f, касающееся прямой y=0, имеет центр на высоте f. Чтобы
 * оно перешло в вырез без излома, окружность выреза должна касаться его
 * снаружи — а это выполняется ровно тогда, когда её центр лежит на той же
 * высоте f. Отсюда и глубина выреза: f + R.
 */
function notchPath(width, height) {
  const cx = width / 2;
  const r = NOTCH_RADIUS;
  const f = SHOULDER_RADIUS;

  // Дуги выреза нужны и сами по себе — их обводят акцентным цветом, тогда как
  // прямые участки края обычной границей. Но в общий контур они обязаны войти
  // без команды M: та начала бы новый подпуть, и заливка замкнулась бы по
  // диагонали через всю панель.
  const arcs =
    `A${f} ${f} 0 0 1 ${cx - r} ${f} ` +
    `A${r} ${r} 0 0 0 ${cx + r} ${f} ` +
    `A${f} ${f} 0 0 1 ${cx + r + f} 0`;

  const notch = `M${cx - r - f} 0 ${arcs}`;
  const top = `M0 0 H${cx - r - f} ${arcs} H${width}`;

  return {top, notch, fill: `${top} V${height} H0 Z`};
}

/**
 * Медленное свечение кнопки, пока есть непрочитанные сообщения.
 *
 * Заменяет собой счётчик: точное число на кнопке не нужно, нужен сам факт, что
 * что-то пришло. Поэтому не мигание и не рывки — ровное дыхание ореола плюс
 * блик, неспешно обходящий кнопку по кругу. Такую подсветку видно боковым
 * зрением, но она не дёргает.
 *
 * Обе анимации идут на нативном драйвере: они крутятся всё время, пока висит
 * непрочитанное, и гонять их через JS-мост значило бы держать его занятым
 * впустую. Поэтому только opacity и transform — цвета так анимировать нельзя.
 */
function useGlow(active) {
  const pulse = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      pulse.setValue(0);
      spin.setValue(0);
      return undefined;
    }

    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    const sweep = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 9000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    breathe.start();
    sweep.start();
    return () => {
      breathe.stop();
      sweep.stop();
    };
  }, [active, pulse, spin]);

  return {pulse, spin};
}

/**
 * Кнопка «Альфа» — круглый логотип в выемке панели.
 *
 * Долгое нажатие открывает создание чата: раньше для этого в шапке списка
 * висел «+», который занимал угол и работал только на самой вкладке чатов.
 */
function AlphaOrb({focused, onPress, onLongPress, label, visible}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scale = useRef(new Animated.Value(1)).current;
  const hasUnread = useUnreadTotal() > 0;
  // Панель больше не размонтируется на скрытых экранах, поэтому свечение
  // некому остановить: без этой оговорки оно крутилось бы всё время, пока
  // человек сидит в чате, и никто бы его не видел
  const {pulse, spin} = useGlow(hasUnread && visible);

  const spring = to =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();

  return (
    <Pressable
      style={styles.orbHit}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      onPressIn={() => spring(0.9)}
      onPressOut={() => spring(1)}
      accessibilityRole="button"
      accessibilityState={{selected: focused}}
      accessibilityLabel={label}
      accessibilityHint="Долгое нажатие — новый чат">
      {/* Знак выглядит одинаково при любой открытой вкладке: это фирменный
          логотип, и приглушать его — что серым, что полупрозрачным — значит
          показывать сломанным. Состояние передаёт только свечение: на чужой
          вкладке кнопка лежит в гнезде плоско. */}
      <Animated.View
        style={[
          styles.orbShadow,
          {transform: [{scale}]},
          !focused && styles.orbShadowIdle,
        ]}>
        {hasUnread && (
          // Ореол собран из трёх вложенных кругов с падающей плотностью:
          // размытия в React Native нет, а один круг с чёткой границей читался
          // бы не свечением, а обводкой
          <Animated.View
            pointerEvents="none"
            style={[
              styles.aura,
              {
                opacity: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.45, 1],
                }),
                transform: [
                  {
                    scale: pulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.92, 1.08],
                    }),
                  },
                ],
              },
            ]}>
            <View style={[styles.auraRing, styles.auraOuter]} />
            <View style={[styles.auraRing, styles.auraMiddle]} />
            <View style={[styles.auraRing, styles.auraInner]} />
          </Animated.View>
        )}

        <LinearGradient
          colors={[c.primaryHover, c.primary]}
          start={{x: 0.2, y: 0}}
          end={{x: 0.8, y: 1}}
          style={styles.orb}>
          {hasUnread && (
            // Блик по поверхности кнопки. Квадрат заметно больше самой кнопки:
            // при повороте он обязан перекрывать её в любом положении, иначе
            // из-под угла выглядывал бы незакрашенный сектор
            <Animated.View
              pointerEvents="none"
              style={[
                styles.sheen,
                {
                  transform: [
                    {
                      rotate: spin.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '360deg'],
                      }),
                    },
                  ],
                },
              ]}>
              <LinearGradient
                colors={[
                  'rgba(255,255,255,0.45)',
                  'rgba(255,255,255,0.10)',
                  'rgba(255,255,255,0)',
                ]}
                start={{x: 0, y: 0}}
                end={{x: 1, y: 1}}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          )}
          <Image
            source={require('../../assets/images/logo.png')}
            style={styles.orbLogo}
            resizeMode="contain"
          />
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

export default function AlfaTabBar({state, descriptors, navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();

  const current = state.routes[state.index];
  const nested = getFocusedRouteNameFromRoute(current) ?? '';
  const hidden = HIDDEN_ROUTES.includes(nested);

  const height = BAR_HEIGHT + insets.bottom;

  /**
   * Уход и возврат панели.
   *
   * Панель НЕ размонтируется на скрытых экранах и вообще никогда не участвует в
   * раскладке: styles.wrap позиционирован absolute. Это принципиально.
   *
   * Навигатор вкладок кладёт контейнер экранов и панель соседними элементами
   * колонки (BottomTabView, styles.screens: flex 1). Пока панель в потоке, её
   * высота вычитается из высоты экранов — и любое её появление или исчезновение
   * в тот же кадр меняет высоту всех смонтированных вкладок разом. Именно
   * поэтому раньше содержимое дёргалось вверх-вниз при каждом переходе: панель
   * возвращала null, контейнер экранов подрастал рывком, а stack-переход в этот
   * момент только начинал свои 220 мс.
   *
   * Вынутая из потока панель этой связи не имеет: скрытие — чистый translateY,
   * раскладка экранов не пересчитывается ни разу. Плата за это — высоту под
   * панель резервируют сами экраны (useTabBarInset из ./tabBarLayout).
   *
   * Анимируются обе стороны, одной длительностью с переходом экрана. Раньше
   * уход был мгновенным, а возврат — плавным, и эта несимметричность читалась
   * как рывок.
   */
  const enter = useRef(new Animated.Value(hidden ? 0 : 1)).current;

  useEffect(() => {
    const anim = Animated.timing(enter, {
      toValue: hidden ? 0 : 1,
      duration: SLIDE_DURATION,
      // Уезжает с разгоном, приезжает с торможением — как и сам экран
      easing: hidden ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [hidden, enter]);

  const translateY = enter.interpolate({
    inputRange: [0, 1],
    // Уезжаем чуть ниже собственной высоты, чтобы не выглядывал край тени
    outputRange: [height + 12, 0],
  });

  const path = notchPath(width, height);

  const press = (route, focused) => {
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!focused && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  /**
   * Долгое нажатие на центральную кнопку — сразу экран создания чата.
   *
   * Раньше это был «+» в шапке списка чатов, а до этого — промежуточная
   * модалка «личный чат / группа». Модалку убрали: тот же выбор уже стоит
   * вкладками в шапке самого экрана, и спрашивать о нём дважды незачем.
   *
   * Экран NewChat лежит внутри стека ChatsTab, поэтому переход обязательно
   * вложенный: navigate('NewChat') с уровня вкладок такого маршрута не найдёт.
   */
  const openNewChat = () => {
    navigation.navigate('ChatsTab', {screen: 'NewChat', params: {initialMode: 'private'}});
  };

  // Центральная вкладка — та, у которой нет значка: её место занимает кнопка
  // «Альфа», лежащая в вырезе поверх панели
  const centerIndex = state.routes.findIndex(route => !ICONS[route.name]);
  const leftRoutes = state.routes.slice(0, centerIndex);
  const rightRoutes = state.routes.slice(centerIndex + 1);

  const renderCell = route => {
    const index = state.routes.indexOf(route);
    const focused = state.index === index;
    const label = descriptors[route.key].options.title ?? route.name;
    const Icon = ICONS[route.name];

    return (
      <Pressable
        key={route.key}
        style={styles.cell}
        onPress={() => press(route, focused)}
        accessibilityRole="button"
        accessibilityState={{selected: focused}}
        accessibilityLabel={label}>
        <Icon size={24} color={focused ? c.primary : c.textTertiary} />
        {/* Строго одна строка: с четырьмя вкладками ячейка узкая, и перенос
            подписи сдвинул бы значок соседней вверх */}
        <Text
          style={[styles.label, {color: focused ? c.primary : c.textTertiary}]}
          numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    // Кнопка выступает над панелью, поэтому обрезать содержимое нельзя.
    // pointerEvents на время скрытия снимаем целиком: уехавшая вниз панель
    // осталась в дереве и иначе перехватывала бы касания у экрана чата.
    <Animated.View
      style={[styles.wrap, {height, transform: [{translateY}]}]}
      pointerEvents={hidden ? 'none' : 'box-none'}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Path d={path.fill} fill={c.bgPrimary} />
        <Path d={path.top} stroke={c.borderLight} strokeWidth={1} fill="none" />
        <Path
          d={path.notch}
          stroke={c.primary}
          strokeOpacity={0.5}
          strokeWidth={1.5}
          fill="none"
        />
      </Svg>

      {/* Высота строки — вся панель целиком, а жестовая полоса вычитается
          отступом: иначе содержимое центрируется по остатку и прижимается
          к верхнему краю */}
      <View style={[styles.row, {height, paddingBottom: insets.bottom}]}>
        {/* Вкладки разложены двумя группами по бокам от выемки, а не сплошным
            рядом ячеек. Раньше вкладок было три и центральная приходилась ровно
            на вырез, но с добавлением календаря их стало чётное число, и
            ячейка соседа полезла бы под кнопку «Альфа». */}
        <View style={styles.side}>{leftRoutes.map(renderCell)}</View>
        <View style={styles.notchGap} />
        <View style={styles.side}>{rightRoutes.map(renderCell)}</View>
      </View>

      <View style={styles.orbSlot} pointerEvents="box-none">
        {state.routes.map((route, index) =>
          ICONS[route.name] ? null : (
            <AlphaOrb
              key={route.key}
              focused={state.index === index}
              visible={!hidden}
              label={descriptors[route.key].options.title ?? route.name}
              onPress={() => press(route, state.index === index)}
              onLongPress={openNewChat}
            />
          ),
        )}
      </View>
    </Animated.View>
  );
}

const makeStyles = c => StyleSheet.create({
  wrap: {
    // Панель висит поверх экранов и не занимает места в раскладке — иначе её
    // появление и уход меняли бы высоту всех вкладок разом (см. комментарий
    // к анимации выше)
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'visible',
    // Подложка видна только в вырезе: всё остальное закрывает фигура панели.
    // Без неё сквозь вырез просвечивает фон окна — он светлый независимо от
    // темы, и вокруг кнопки появлялся белый ободок.
    backgroundColor: c.bgSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Половины по бокам от выреза. Ширина одинаковая, поэтому вырез (а с ним и
  // кнопка) остаётся ровно посередине независимо от числа вкладок в группах.
  side: {flex: 1, flexDirection: 'row'},
  notchGap: {width: (NOTCH_RADIUS + SHOULDER_RADIUS) * 2},
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: {fontFamily: font.medium, fontSize: 11},

  // Кнопка позиционируется от центра панели: так она держится в выемке
  // независимо от ширины экрана
  orbSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Центр кнопки совпадает с центром окружности выреза, иначе просвет
    // вокруг неё окажется неровным
    top: SHOULDER_RADIUS - ORB_SIZE / 2,
    alignItems: 'center',
  },
  // Без отступов вокруг: 56pt сами по себе крупнее минимальной цели касания
  orbHit: {},
  orbShadow: {
    borderRadius: ORB_SIZE / 2,
    shadowColor: c.primary,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 5},
    elevation: 8,
  },
  orbShadowIdle: {shadowOpacity: 0.18, shadowRadius: 6, elevation: 3},
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Обрезает блик по краю круга
    overflow: 'hidden',
  },
  sheen: {
    position: 'absolute',
    width: ORB_SIZE * 1.5,
    height: ORB_SIZE * 1.5,
  },
  orbLogo: {width: 30, height: 30},

  // Ореол непрочитанных
  aura: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  auraRing: {position: 'absolute', backgroundColor: c.primary},
  auraOuter: {
    width: ORB_SIZE + 34,
    height: ORB_SIZE + 34,
    borderRadius: (ORB_SIZE + 34) / 2,
    opacity: 0.07,
  },
  auraMiddle: {
    width: ORB_SIZE + 22,
    height: ORB_SIZE + 22,
    borderRadius: (ORB_SIZE + 22) / 2,
    opacity: 0.11,
  },
  auraInner: {
    width: ORB_SIZE + 11,
    height: ORB_SIZE + 11,
    borderRadius: (ORB_SIZE + 11) / 2,
    opacity: 0.2,
  },
});
