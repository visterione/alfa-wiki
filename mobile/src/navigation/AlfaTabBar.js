import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  View,
  Text,
  Image,
  Alert,
  Pressable,
  Animated,
  BackHandler,
  Easing,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {getFocusedRouteNameFromRoute} from '@react-navigation/native';
import {
  Settings, User, ListTodo, GraduationCap, Package, MessageCircle, Star,
  SquarePen, Plus, LogOut,
} from 'lucide-react-native';

import {font} from '../theme';
import {useTheme, useThemedStyles} from '../store/settingsStore';
import {useUnreadTotal} from '../store/unreadStore';
import {useInboxCount} from '../store/tasksStore';
import {
  useWarehouseAccess, useWarehouseBadge, refreshWarehouseBadge,
} from '../store/warehouseStore';
import {useReviewBoards, useReviewsBadge, refreshReviewsBadge} from '../store/reviewsStore';
import {runQuickAction} from '../store/quickActions';
import {useAuth} from '../store/authStore';
import {TAB_BAR_HEIGHT} from './tabBarLayout';

/**
 * Навигация приложения — одна кнопка «Альфа» и дуга разделов под пальцем.
 *
 * ── Почему не ряд вкладок ────────────────────────────────────────────────────
 *
 * Разделов стало шесть, и в панели они превратились в шесть подписей по 11pt,
 * которые не читаются на ходу и не попадают под палец. Хуже другое: часть
 * разделов доступна не всем (склад — отдельным правом), и панель либо показывала
 * бы кнопку, ведущую в «нет доступа», либо разъезжалась разной шириной ячеек у
 * разных людей. Дуга обе беды снимает: она рисуется от центра по числу
 * доступных разделов, и лишней кнопки в ней просто нет.
 *
 * ── Как это работает ─────────────────────────────────────────────────────────
 *
 * Короткое нажатие открывает колесо разделов. Долгое — второе колесо, с
 * действиями текущего раздела: в чатах это новый чат, в задачах — быстрое
 * создание, в профиле — выход. Нажатие мимо колеса, «назад» на Android и
 * повторное нажатие на знак закрывают его.
 *
 * Раньше короткое нажатие уводило в чаты, а колесо открывалось долгим. Так у
 * знака было два разных смысла — «домой» и «меню», — и первый узнавался только
 * от кого-то. Теперь у чатов есть своя кнопка в колесе, а знак делает одно:
 * открывает то, что под ним.
 *
 * ── Почему кнопка теперь плавает, а не сидит в вырезе панели ─────────────────
 *
 * Панели больше нет, и рисовать вырез не в чем. Вместо неё снизу лежит короткий
 * градиент в цвет фона: без него содержимое списка уезжало бы под знак и
 * читалось сквозь него. Градиент не перехватывает касания — прокрутка под
 * кнопкой работает как раньше.
 *
 * Кнопка (как и панель до неё) НЕ участвует в раскладке: styles.wrap
 * позиционирован absolute, а высоту под неё экраны резервируют сами через
 * useTabBarInset() из ./tabBarLayout. Иначе её появление и уход меняли бы
 * высоту всех смонтированных вкладок разом, и содержимое дёргалось бы на каждом
 * переходе.
 */

// Экраны, на которых кнопка не нужна: у них своя навигация назад.
// Урок и тест вдобавок держат внизу собственную кнопку — рядом со знаком она
// оказалась бы вторым рядом органов управления над жестовой полосой.
const HIDDEN_ROUTES = [
  'Chat', 'NewChat', 'ChatInfo', 'CalendarEvent', 'CalendarEventEdit',
  'Lesson', 'CourseTest',
  // Внутренние экраны модуля «Задачи» (ver. 6.75): у каждого своя кнопка
  // «назад» в шапке, и панель под ними только отнимала бы высоту у списка.
  'TaskCard', 'TasksNorm',
  // Склад (ver. 6.81). Сканер — потому что кадр камеры занимает экран целиком и
  // кнопка поверх него читалась бы как часть видоискателя. Пересчёт, размещение
  // и выбор этикеток — потому что у них своя кнопка внизу, а два ряда органов
  // управления над жестовой полосой не помещаются.
  'WarehouseScanner', 'WarehouseAsset', 'WarehouseAssetEdit', 'WarehouseMaterialEdit',
  'WarehouseItemCreate', 'WarehouseRoom', 'WarehouseRooms',
  'WarehouseInventoryCount', 'WarehouseInventoryNew', 'WarehousePlacement',
  'WarehouseLabelPrint', 'WarehousePrinter',
  // Списки и журналы склада: у каждого своя кнопка «назад» в шапке, а знак
  // поверх длинного списка только отнимает у него нижнюю строку. Кнопка нужна
  // на главной раздела — туда и возвращаются, чтобы уйти в другой модуль.
  'WarehouseAssets', 'WarehouseStock', 'WarehouseOperations',
  'WarehouseInventoryList', 'WarehouseMailings',
  // Отзывы (ver. 7.26). Карточка держит внизу поле комментария, доска —
  // колонки во всю высоту: знак «Альфа» лёг бы прямо на них.
  'Review', 'ReviewBoard', 'ReviewsAssigned',
];

const ORB_SIZE = 58;
// Просвет между знаком и жестовой полосой
const ORB_BOTTOM = 10;
// Столько же длится переход между экранами стека (STACK_ANIMATION в
// AppNavigator): кнопка обязана уезжать вместе с экраном, а не вдогонку ему
const SLIDE_DURATION = 220;
// Припуск внешнего кольца ореола непрочитанных. Вынесен в константу, потому что
// от него зависит не только вид кнопки, но и то, на сколько она уезжает.
const AURA_SPREAD = 34;
// Высота градиента-подложки. Заметно больше самой кнопки: короткий градиент
// читается полосой, а длинный — тем, чем он и является, затуханием списка.
const SCRIM_HEIGHT = TAB_BAR_HEIGHT + 44;

/**
 * Геометрия колеса.
 *
 * ── Почему колесо, а не дуга ─────────────────────────────────────────────────
 *
 * Дуга обрывалась в воздухе двумя срезами по бокам: у неё есть начало и конец,
 * и оба видно. Кольцо концов не имеет — оно уходит за нижний край экрана и там
 * же появляется обратно, а срез ему делает сам край устройства.
 *
 * Второе, и более важное: у дуги мест ровно столько, сколько влезает в её
 * охват. Разделов в портале будет больше, и рано или поздно они перестали бы
 * помещаться. Колесо крутится: видна та часть, что сверху, остальное подводят
 * поворотом, и число разделов упирается только в длину окружности.
 *
 * ── Размеры ──────────────────────────────────────────────────────────────────
 *
 * Центр колеса совпадает с центром знака, то есть лежит у самого низа экрана.
 * Наверх кольцо уходит на 174pt, вниз — за край, и нижняя его часть просто не
 * видна. Внешний радиус 174 помещается по ширине на экранах от 360pt.
 *
 * Полоса толщиной 88pt нужна не для красоты. Значок с подписью занимает 39pt по
 * высоте и 66 по ширине, а стоит он вертикально при любом угле поворота: у
 * колеса подписи не наклоняются вместе с ним, иначе сбоку их пришлось бы
 * читать, повернув голову. Прямоугольник, стоящий поперёк радиуса, занимает по
 * радиусу до |w·sinα| + |h·cosα| — на краю видимого сектора это около 77pt,
 * отсюда и толщина с запасом.
 */
const WHEEL_R_MID = 130;
const WHEEL_BAND = 88;
const WHEEL_R_IN = WHEEL_R_MID - WHEEL_BAND / 2;
const WHEEL_R_OUT = WHEEL_R_MID + WHEEL_BAND / 2;

const ITEM_ICON = 22;
const ITEM_GAP = 4;
const ITEM_LABEL = 13;
const ITEM_HEIGHT = ITEM_ICON + ITEM_GAP + ITEM_LABEL;
// Ширина ячейки. Считается от самого тесного шага: при 23° соседние центры
// разведены на 52pt по средней линии, и подписи не должны смыкаться.
const ITEM_WIDTH = 56;

/**
 * Шаг между разделами по окружности.
 *
 * Раньше шаг был постоянным (34°), и с седьмым разделом крайние уехали на 102°
 * от верха — то есть за нижний край экрана. Колесо приходилось доворачивать,
 * чтобы показать выбранный, и от этого доворота на другом конце пряталась
 * соседняя кнопка: выбрал «Профиль» — исчезли «Настройки», и наоборот.
 *
 * Поэтому шаг подстраивается: пока все разделы помещаются в видимый сектор
 * (±78° от верха), он сжимается ровно настолько, чтобы они там поместились, и
 * доворачивать нечего. Ограничен снизу — при слишком мелком шаге подписи
 * соседних разделов сомкнутся; вот когда разделов станет столько, что шаг
 * упрётся в этот предел, колесо и начнёт крутиться по-настоящему.
 */
const SLOT_ANGLE = 34;
const MIN_SLOT_ANGLE = 23;
const VISIBLE_ARC = 156;

const stepFor = (count) => {
  if (count < 2) return SLOT_ANGLE;
  const fit = VISIBLE_ARC / (count - 1);
  return Math.max(MIN_SLOT_ANGLE, Math.min(SLOT_ANGLE, fit));
};

/**
 * Точка i-го раздела на средней линии, в градусах от верха по часовой стрелке.
 * Набор разделов центрируется относительно верха: при пяти разделах третий
 * стоит ровно над знаком, и поворачивать колесо не приходится вовсе.
 */
const slotAngle = (index, count) => (index - (count - 1) / 2) * stepFor(count);

/**
 * Смещение i-го гнезда от центра колеса, в точках.
 *
 * Одна функция на ячейку и на подложку выбранного: разойдись они хоть на
 * градус, подсветка встала бы рядом со значком, а не под ним.
 */
function slotPoint(index, count) {
  const rad = (slotAngle(index, count) * Math.PI) / 180;
  return {x: WHEEL_R_MID * Math.sin(rad), y: -WHEEL_R_MID * Math.cos(rad)};
}

/**
 * Контур подсветки выбранного раздела — сегмент того же кольца.
 *
 * Прямоугольник со скруглениями, стоявший здесь раньше, в круге выглядел
 * заплаткой: у колеса нет ни одной прямой линии, и любая рамка спорит с его
 * формой. Сектор вписан в обод по построению — те же радиусы, ширина в один
 * шаг между разделами.
 *
 * Рисуется в гнезде сверху (симметрично относительно вертикали), а к нужному
 * разделу приезжает поворотом всего слоя: у сектора нет верха и низа, так что
 * обратный поворот, обязательный для подписей, ему не нужен.
 */
function sectorPath(count) {
  const half = (stepFor(count) / 2) * 0.86; // просвет между соседними гнёздами
  const inner = WHEEL_R_IN + 3;
  const outer = WHEEL_R_OUT - 3;
  const at = (deg, r) => {
    const rad = (deg * Math.PI) / 180;
    return `${WHEEL_R_OUT + r * Math.sin(rad)} ${WHEEL_R_OUT - r * Math.cos(rad)}`;
  };

  return [
    `M ${at(-half, outer)}`,
    `A ${outer} ${outer} 0 0 1 ${at(half, outer)}`,
    `L ${at(half, inner)}`,
    `A ${inner} ${inner} 0 0 0 ${at(-half, inner)}`,
    'Z',
  ].join(' ');
}

/**
 * Насколько колесо можно повернуть.
 *
 * Ровно настолько, чтобы любой раздел можно было вывести наверх, и ни градусом
 * больше: колесо, проворачивающееся в пустоту, читается как сломанное.
 */
const maxTurn = count => Math.abs(slotAngle(0, count));

/**
 * Контекстное колесо: что можно сделать в текущем разделе.
 *
 * Здесь только то, что раньше занимало угол экрана: «плюс» в шапке чатов и
 * плавающая кнопка в задачах. Обе теперь живут под большим пальцем и не
 * отбирают место у содержимого. Разделы, у которых такого действия нет, на
 * долгое нажатие не отзываются вовсе — пустое колесо хуже, чем никакого.
 *
 * `run` получает навигацию и выход из аккаунта: первое нужно чату, второе —
 * профилю, и тащить ради них в панель по магазину на каждое действие незачем.
 */
const TAB_ACTIONS = {
  ChatsTab: [{
    key: 'new-chat',
    icon: SquarePen,
    label: 'Новый чат',
    run: ({navigation}) => navigation.navigate('ChatsTab', {
      screen: 'NewChat', params: {initialMode: 'private'},
    }),
  }],
  TasksTab: [{
    key: 'new-task',
    icon: Plus,
    label: 'Новая задача',
    // Лист быстрого создания живёт внутри экрана задач, переходом его не
    // открыть — просьба уходит через quickActions
    run: () => runQuickAction('new-task'),
  }],
  ProfileTab: [{
    key: 'logout',
    icon: LogOut,
    label: 'Выйти',
    danger: true,
    run: ({logout}) => Alert.alert('Выйти из аккаунта?', '', [
      {text: 'Отмена', style: 'cancel'},
      {text: 'Выйти', style: 'destructive', onPress: logout},
    ]),
  }],
};

const ICONS = {
  ProfileTab: User,
  ChatsTab: MessageCircle,
  TasksTab: ListTodo,
  WarehouseTab: Package,
  ReviewsTab: Star,
  CoursesTab: GraduationCap,
  SettingsTab: Settings,
};

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
 * Кнопка «Альфа» — круглый логотип, единственный постоянный орган управления.
 *
 * Знак не поворачивается и не подменяется крестиком при открытой дуге: это
 * фирменная марка, а не иконка состояния, и крутить её ради подсказки, которую
 * и так даёт развернувшаяся на пол-экрана полоса, незачем.
 */
function AlphaOrb({open, onPress, onLongPress, visible}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scale = useRef(new Animated.Value(1)).current;
  const hasUnread = useUnreadTotal() > 0;
  // Кнопка больше не размонтируется на скрытых экранах, поэтому свечение
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
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      onPressIn={() => spring(0.9)}
      onPressOut={() => spring(1)}
      accessibilityRole="button"
      accessibilityState={{expanded: open}}
      accessibilityLabel="Альфа"
      accessibilityHint="Открывает разделы. Долгое нажатие — действия текущего раздела">
      {/* Знак выглядит одинаково при любом открытом разделе: это фирменный
          логотип, и приглушать его — что серым, что полупрозрачным — значит
          показывать сломанным. */}
      <Animated.View style={[styles.orbShadow, {transform: [{scale}]}]}>
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

/**
 * Раздел на колесе — значок и подпись, без кружка-подложки.
 *
 * Кружки были нужны, пока подпись лежала прямо на содержимом экрана. Под всеми
 * разделами теперь сплошная полоса колеса, и кружок стал бы вторым фоном поверх
 * первого — россыпью пуговиц вместо цельного обода. Выбранный раздел отличается
 * цветом значка и подписи: выбранный всегда один, и этого хватает.
 *
 * Ячейка стоит на своём месте обода неподвижно, а вращение делает контейнер
 * колеса. Внутри ячейка получает обратный поворот на тот же угол — иначе
 * подписи наклонялись бы вместе с ободом и сбоку их пришлось бы читать,
 * склонив голову.
 */
function WheelItem({item, index, count, turn, focused, onPress}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const Icon = item.icon;

  // Координаты внутри контейнера колеса: начало отсчёта в его центре, поэтому
  // к смещению добавляется радиус.
  const at = slotPoint(index, count);
  const left = WHEEL_R_OUT + at.x - ITEM_WIDTH / 2;
  const top = WHEEL_R_OUT + at.y - ITEM_HEIGHT / 2;

  return (
    <View style={[styles.wheelItem, {left, top}]}>
      <Animated.View
        style={{
          transform: [{
            rotate: turn.interpolate({
              inputRange: [-360, 360],
              outputRange: ['360deg', '-360deg'],
            }),
          }],
        }}>
        <Pressable
          style={styles.wheelHit}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityState={{selected: focused}}
          accessibilityLabel={item.label}>
            <View>
            <Icon
              size={ITEM_ICON}
              color={item.danger ? c.error : (focused ? c.primary : c.textSecondary)}
            />
            {/* Число, а не точка: «вас ждут» и «вас ждут сорок раз» — разные
                сообщения, и второе меняет решение, куда идти сначала. Свыше
                99 счёт теряет смысл и мешает: ширина бейджа съедает подпись. */}
            {item.badge > 0 && (
              <View style={[styles.wheelBadge, {borderColor: c.bgPrimary}]}>
                <Text style={styles.wheelBadgeText} numberOfLines={1}>
                  {item.badge > 99 ? '99+' : item.badge}
                </Text>
              </View>
            )}
          </View>
          <Text
            style={[
              styles.wheelLabel,
              focused && {color: c.primary},
              item.danger && {color: c.error},
            ]}
            numberOfLines={1}>
            {item.label}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/**
 * Вращение колеса пальцем.
 *
 * Угол считается не по горизонтальному сдвигу, а по настоящему углу пальца
 * относительно центра колеса: тянут его по дуге, и линейный пересчёт «сколько
 * пикселей вправо» разъезжался бы с ободом тем сильнее, чем ближе палец к
 * центру.
 *
 * Захват — только после порога в 8pt, и через capture-обработчик. Так нажатие
 * на раздел остаётся нажатием, а движение поверх него забирает себе колесо:
 * то же соглашение, по которому список забирает касание у кнопки внутри себя.
 *
 * На отпускании угол доводится пружиной до ближайшего гнезда. Без доводки обод
 * замирает между разделами, и половина подписей оказывается срезана краем
 * экрана.
 */
function useWheelTurn(turn, count, centerX, centerY) {
  const from = useRef(0);
  const base = useRef(0);

  // Пределы и шаг зависят от числа разделов, а оно меняется вместе с правами
  const limit = maxTurn(count);
  const step = stepFor(count);

  const angleAt = (pageX, pageY) => (
    (Math.atan2(pageY - centerY, pageX - centerX) * 180) / Math.PI
  );

  return useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (event, gesture) => (
      Math.hypot(gesture.dx, gesture.dy) > 8
    ),
    onPanResponderGrant: (event) => {
      turn.stopAnimation((value) => { base.current = value; });
      from.current = angleAt(event.nativeEvent.pageX, event.nativeEvent.pageY);
    },
    onPanResponderMove: (event) => {
      const now = angleAt(event.nativeEvent.pageX, event.nativeEvent.pageY);
      let delta = now - from.current;
      // atan2 рвётся на ±180°: без этой поправки один кадр давал бы прыжок
      // почти на полный оборот
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      turn.setValue(Math.max(-limit, Math.min(limit, base.current + delta)));
    },
    onPanResponderRelease: () => {
      turn.stopAnimation((value) => {
        const snapped = Math.max(-limit, Math.min(limit, Math.round(value / step) * step));
        Animated.spring(turn, {
          toValue: snapped,
          useNativeDriver: false,
          speed: 14,
          bounciness: 4,
        }).start();
      });
    },
    // Отобрали жест (пришёл системный свайп) — обод не бросаем на полпути
    onPanResponderTerminate: () => {
      turn.stopAnimation((value) => {
        Animated.spring(turn, {
          toValue: Math.round(value / step) * step,
          useNativeDriver: false,
          speed: 14,
          bounciness: 0,
        }).start();
      });
    },
  }), [turn, limit, step, centerX, centerY]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default function AlfaTabBar({state, descriptors, navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const inboxCount = useInboxCount();
  const access = useWarehouseAccess();

  const unread = useUnreadTotal();
  const warehouseBadge = useWarehouseBadge();
  const reviewBoards = useReviewBoards();
  const reviewsBadge = useReviewsBadge();
  // Под каким углом стоит подсветка выбранного раздела, в градусах от верха.
  // Углом, а не координатами: сектор приезжает в гнездо поворотом.
  const active = useRef(new Animated.Value(0)).current;
  // С каким поворотом открыть колесо. Считается при отрисовке, применяется в
  // момент открытия — см. openTurnFor ниже.
  const openTurn = useRef(0);

  const {logout} = useAuth();
  // 'sections' — разделы приложения, 'actions' — действия текущего раздела
  const [mode, setMode] = useState('sections');
  const [open, setOpen] = useState(false);
  const menu = useRef(new Animated.Value(0)).current;
  // Угол поворота обода в градусах. Живёт вне открытия/закрытия, но сбрасывается
  // на каждом открытии: колесо должно открываться в исходном положении, а не
  // там, где его оставили в прошлый раз.
  const turn = useRef(new Animated.Value(0)).current;
  // Дуга остаётся смонтированной, пока кнопки летят обратно к центру: снять её
  // в момент нажатия значило бы оборвать анимацию закрытия на первом кадре.
  const [mounted, setMounted] = useState(false);

  const current = state.routes[state.index];
  const nested = getFocusedRouteNameFromRoute(current) ?? '';
  const hidden = HIDDEN_ROUTES.includes(nested);

  const close = useCallback(() => setOpen(false), []);

  // Цифра на кнопке склада должна быть до того, как человек туда зашёл, —
  // иначе она появляется ровно тогда, когда уже не нужна.
  useEffect(() => {
    if (access?.allowed) refreshWarehouseBadge();
  }, [access?.allowed]);

  useEffect(() => {
    if (reviewBoards?.length) refreshReviewsBadge();
  }, [reviewBoards?.length]);

  useEffect(() => {
    if (open) { setMounted(true); turn.setValue(openTurn.current); }
    const anim = Animated.spring(menu, {
      toValue: open ? 1 : 0,
      useNativeDriver: true,
      speed: open ? 13 : 20,
      bounciness: open ? 7 : 0,
    });
    anim.start(({finished}) => {
      if (finished && !open) setMounted(false);
    });
    return () => anim.stop();
  }, [open, menu, turn]);

  // Кнопка «назад» на Android закрывает колесо, а не уводит с экрана: открытое
  // меню — это состояние, и выход из него ожидается первым же «назад».
  useEffect(() => {
    if (!open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [open, close]);

  // Ушли с экрана (переход в чат, чужая вкладка) — колесо закрывается само:
  // иначе оно осталось бы висеть поверх уже сменившегося содержимого.
  useEffect(() => { close(); }, [state.index, hidden, close]);

  /**
   * Уход и возврат кнопки.
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

  // Центр знака над нижним краем экрана — он же центр колеса
  const orbCenter = insets.bottom + ORB_BOTTOM + ORB_SIZE / 2;

  const translateY = enter.interpolate({
    inputRange: [0, 1],
    // Уезжает вместе с ореолом и тенью, иначе из-за нижней границы экрана
    // осталась бы торчать макушка знака
    outputRange: [ORB_SIZE + ORB_BOTTOM + insets.bottom + AURA_SPREAD, 0],
  });

  const go = (route) => {
    close();
    const focused = state.routes.indexOf(route) === state.index;
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
   * Разделы колеса.
   *
   * Склад закрыт отдельным правом, и человеку без него кнопка не рисуется вовсе.
   * Пока права не пришли (access === null), её тоже нет: показать и убрать —
   * хуже, чем показать чуть позже, потому что колесо при этом меняет шаг под
   * уже занесённым пальцем.
   *
   * Счётчики: непрочитанные сообщения, поставленные задачи, открытые описи. Это
   * три разных «вас ждут», и цифра отвечает на «сколько» раньше, чем человек
   * откроет раздел.
   */
  const badges = {
    ChatsTab: unread,
    TasksTab: inboxCount,
    WarehouseTab: warehouseBadge,
    ReviewsTab: reviewsBadge,
  };

  const sections = state.routes
    .filter(route => ICONS[route.name])
    .filter(route => route.name !== 'WarehouseTab'
      || Boolean(access?.allowed))
    // Отзывы: доступа своего у модуля нет, он раздаётся досками — пустой список
    // и есть «модуль не для вас». Пока доски не пришли, кнопки тоже нет: колесо
    // не должно менять шаг под уже занесённым пальцем.
    .filter(route => route.name !== 'ReviewsTab'
      || Boolean(reviewBoards?.length))
    .map(route => ({
      key: route.key,
      route,
      icon: ICONS[route.name],
      label: descriptors[route.key].options.title ?? route.name,
      badge: badges[route.name] || 0,
    }));

  // Действия текущего раздела — второе колесо, на долгое нажатие
  const actions = (TAB_ACTIONS[current.name] || []).map(action => ({
    key: action.key,
    icon: action.icon,
    label: action.label,
    badge: 0,
    danger: action.danger,
    onPress: () => { close(); action.run({navigation, logout}); },
  }));

  const items = mode === 'actions' ? actions : sections;

  // Подсветка — только у разделов: среди действий «текущего» не бывает, и
  // сектор под одним из них означал бы выбор, которого никто не делал.
  const activeIndex = mode === 'actions'
    ? -1
    : items.findIndex(item => state.routes.indexOf(item.route) === state.index);
  const activeAt = activeIndex >= 0 ? slotAngle(activeIndex, items.length) : null;

  /**
   * Подсветка выбранного раздела.
   *
   * На открытии встаёт на место без анимации: колесо и так разворачивается, и
   * ещё одна поездка в этот момент читалась бы как сбой. Дальше, если раздел
   * сменили при открытом колесе, едет пружиной — по движению видно, откуда и
   * куда переключились.
   */
  useEffect(() => {
    if (activeAt === null) return undefined;
    if (!mounted) { active.setValue(activeAt); return undefined; }
    const anim = Animated.spring(active, {
      toValue: activeAt,
      useNativeDriver: false,
      speed: 14,
      bounciness: 6,
    });
    anim.start();
    return () => anim.stop();
  }, [activeAt, mounted, active]);

  /**
   * Поворот, с которым открывается колесо.
   *
   * По умолчанию нулевой: набор разделов центрирован относительно верха, и
   * каждый раз одно и то же положение — это то, из-за чего до нужной кнопки
   * дотягиваются не глядя.
   *
   * Но разделов стало семь, и при шаге 34° крайние оказываются на 102° от
   * верха, то есть ниже горизонта и за краем экрана. Открыть колесо так, чтобы
   * текущий раздел был не виден, нельзя — человек не поймёт, где он. Поэтому
   * если активный ушёл за 80°, колесо открывается подвёрнутым ровно настолько,
   * чтобы вывести его на 60°, и не больше: остальные разделы при этом остаются
   * близко к привычным местам.
   *
   * Доворот кратен шагу — иначе разделы встали бы между гнёздами.
   */
  const step = stepFor(items.length);
  const activeAngle = activeIndex >= 0 ? slotAngle(activeIndex, items.length) : 0;
  openTurn.current = Math.abs(activeAngle) <= 80
    ? 0
    : Math.max(
      -maxTurn(items.length),
      Math.min(
        maxTurn(items.length),
        Math.round((-activeAngle + Math.sign(activeAngle) * 60) / step) * step,
      ),
    );

  // Центр колеса в координатах экрана — от него PanResponder считает угол пальца
  const wheelPan = useWheelTurn(turn, items.length, width / 2, height - orbCenter);

  return (
    // Пока колесо закрыто, обёртка стоит только под кнопкой: box-none
    // пропускает касания мимо неё, но на Android касание за пределами родителя
    // до потомка не доходит, поэтому под открытое меню обёртка разворачивается
    // на весь экран — иначе нажатие «мимо колеса» было бы некуда принять.
    <View
      style={[
        styles.wrap,
        mounted ? StyleSheet.absoluteFill : {height: TAB_BAR_HEIGHT + insets.bottom},
      ]}
      pointerEvents="box-none">
      {/* Затемнение под колесом — только фон. Нажатие «мимо» ловит слой самого
          колеса: он лежит выше и касания до этого слоя не пропускает. */}
      {mounted && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.backdrop, {opacity: menu}]}
        />
      )}

      {/* Затухание содержимого под кнопкой. Без него список уезжает под знак и
          просвечивает сквозь него. Касания не перехватывает: прокрутка в этой
          полосе должна работать. */}
      {!mounted && (
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0)', c.bgSecondary]}
          style={[styles.scrim, {height: SCRIM_HEIGHT + insets.bottom}]}
        />
      )}

      {/* Колесо лежит в полноэкранном слое, а не внутри кнопки, хотя вращается
          вокруг неё. На Android касание, пришедшее за пределы родителя, до
          потомка не доходит вовсе, а разделы уезжают от знака на полторы сотни
          точек — вложи их в него, и нажимались бы они только на iOS.

          Слой ловит касания сам (не box-none): вращать обод надо откуда угодно,
          а не только попав пальцем ровно в полосу обода. */}
      {mounted && (
        <View style={StyleSheet.absoluteFill} {...wheelPan.panHandlers}>
          {/* Слой колеса перехватывает касания, и до затемнения под ним они уже
              не доходят — закрывать по нажатию мимо приходится здесь. Лежит
              первым, поэтому разделы поверх него и забирают нажатие себе. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityLabel="Закрыть меню разделов"
          />

          {/* Открытие: колесо разворачивается из-под знака. Прозрачность
              зажата, потому что пружина перелетает единицу, а масштаб пусть
              перелетает — это и даёт ободу упругость. */}
          <Animated.View
            style={[
              styles.wheel,
              {
                bottom: orbCenter - WHEEL_R_OUT,
                opacity: menu.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
                transform: [{scale: menu}],
              },
            ]}
            pointerEvents="box-none">
            {/* Обод и его вращение разнесены по разным слоям намеренно: масштаб
                открытия крутится на нативном драйвере, а угол приходит из
                PanResponder, то есть из JS. В одном transform они бы не ужились. */}
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                {
                  transform: [{
                    rotate: turn.interpolate({
                      inputRange: [-360, 360],
                      outputRange: ['-360deg', '360deg'],
                    }),
                  }],
                },
              ]}
              pointerEvents="box-none">
              {/* Кольцо — окружность с толстой обводкой: отдельный контур с
                  двумя дугами дал бы ровно ту же фигуру и лишний повод в ней
                  ошибиться. Края у неё нет — она уходит за нижний край экрана
                  и там же возвращается. */}
              <Svg
                width={WHEEL_R_OUT * 2}
                height={WHEEL_R_OUT * 2}
                pointerEvents="none"
                style={StyleSheet.absoluteFill}>
                <Circle
                  cx={WHEEL_R_OUT}
                  cy={WHEEL_R_OUT}
                  r={WHEEL_R_MID}
                  fill="none"
                  stroke={c.bgPrimary}
                  strokeWidth={WHEEL_BAND}
                />
                <Circle
                  cx={WHEEL_R_OUT}
                  cy={WHEEL_R_OUT}
                  r={WHEEL_R_OUT - 0.5}
                  fill="none"
                  stroke={c.borderLight}
                  strokeWidth={1}
                />
                <Circle
                  cx={WHEEL_R_OUT}
                  cy={WHEEL_R_OUT}
                  r={WHEEL_R_IN + 0.5}
                  fill="none"
                  stroke={c.borderLight}
                  strokeWidth={1}
                />
              </Svg>

              {/* Подсветка выбранного — сектор кольца под значками: она
                  приезжает поворотом, значки стоят на местах */}
              {activeAt !== null && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      transform: [{
                        rotate: active.interpolate({
                          inputRange: [-360, 360],
                          outputRange: ['-360deg', '360deg'],
                        }),
                      }],
                    },
                  ]}>
                  <Svg
                    width={WHEEL_R_OUT * 2}
                    height={WHEEL_R_OUT * 2}
                    pointerEvents="none"
                    style={StyleSheet.absoluteFill}>
                    <Path d={sectorPath(items.length)} fill={c.primaryLight} />
                  </Svg>
                </Animated.View>
              )}

              {items.map((item, index) => (
                <WheelItem
                  key={item.key}
                  item={item}
                  index={index}
                  count={items.length}
                  turn={turn}
                  focused={index === activeIndex}
                  onPress={() => (item.onPress ? item.onPress() : go(item.route))}
                />
              ))}
            </Animated.View>
          </Animated.View>
        </View>
      )}

      <Animated.View
        style={[
          styles.dock,
          {bottom: insets.bottom + ORB_BOTTOM, transform: [{translateY}]},
        ]}
        pointerEvents={hidden ? 'none' : 'box-none'}>
        <AlphaOrb
          open={open}
          visible={!hidden}
          onPress={() => {
            if (open) { close(); return; }
            setMode('sections');
            setOpen(true);
          }}
          onLongPress={() => {
            // Раздел без действий на долгое нажатие не отзывается: пустое
            // колесо сообщает только о том, что мы ничего не придумали
            if (!(TAB_ACTIONS[current.name] || []).length) return;
            // Открытое колесо не мешает: разделы и действия — два вида одного
            // колеса, и переключаться между ними надо, не закрывая его
            setMode('actions');
            setOpen(true);
          }}
        />
      </Animated.View>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  // Кнопка висит поверх экранов и не занимает места в раскладке — иначе её
  // появление и уход меняли бы высоту всех вкладок разом
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  backdrop: {backgroundColor: 'rgba(0,0,0,0.45)'},
  scrim: {position: 'absolute', left: 0, right: 0, bottom: 0},

  // Знак позиционируется от центра экрана: так он держится посередине
  // независимо от ширины устройства
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },

  // Колесо. Квадрат со стороной в диаметр обода, центрированный по знаку:
  // только так масштаб открытия растит его именно из-под кнопки, а не из угла.
  // Тени у контейнера нет намеренно — он прямоугольный и прозрачный, а обе
  // платформы рисуют тень по рамке слоя, а не по фигуре внутри него: под
  // колесом висел бы прямоугольник. Обод отделяют от экрана затемнение позади
  // и собственная обводка.
  wheel: {
    position: 'absolute',
    left: '50%',
    marginLeft: -WHEEL_R_OUT,
    width: WHEEL_R_OUT * 2,
    height: WHEEL_R_OUT * 2,
  },
  wheelItem: {
    position: 'absolute',
    width: ITEM_WIDTH,
    height: ITEM_HEIGHT,
  },
  // Область касания — вся ячейка целиком: без кружка попадать стало бы не во
  // что, а 66 × 39 сопоставимы с минимальной целью
  wheelHit: {
    width: ITEM_WIDTH,
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelBadge: {
    position: 'absolute',
    top: -6,
    right: -12,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: c.error,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelBadgeText: {
    fontFamily: font.semiBold,
    fontSize: 10,
    lineHeight: 13,
    color: '#FFFFFF',
  },
  wheelLabel: {
    fontFamily: font.medium,
    fontSize: 10,
    lineHeight: ITEM_LABEL,
    color: c.textSecondary,
    marginTop: ITEM_GAP,
    textAlign: 'center',
  },

  orbShadow: {
    borderRadius: ORB_SIZE / 2,
    shadowColor: c.primary,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 5},
    elevation: 8,
  },
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
  orbLogo: {width: 32, height: 32},

  // Ореол непрочитанных
  aura: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  auraRing: {position: 'absolute', backgroundColor: c.primary},
  auraOuter: {
    width: ORB_SIZE + AURA_SPREAD,
    height: ORB_SIZE + AURA_SPREAD,
    borderRadius: (ORB_SIZE + AURA_SPREAD) / 2,
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
