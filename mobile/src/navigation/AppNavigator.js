import React, {useState, useEffect, useMemo} from 'react';
import {
  StyleSheet,
  Image,
  Pressable,
} from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
  DefaultTheme,
  DarkTheme,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import LinearGradient from 'react-native-linear-gradient';
import {SquarePen} from 'lucide-react-native';

import {useAuth} from '../store/authStore';
import LoginScreen from '../screens/Auth/LoginScreen';
import ChatListScreen from '../screens/Chat/ChatListScreen';
import ChatScreen from '../screens/Chat/ChatScreen';
import NewChatScreen from '../screens/Chat/NewChatScreen';
import ChatInfoScreen from '../screens/Chat/ChatInfoScreen';
import ProfileScreen from '../screens/Profile/ProfileScreen';
import SettingsScreen from '../screens/Settings/SettingsScreen';
import EventScreen from '../screens/Calendar/EventScreen';
import EventEditScreen from '../screens/Calendar/EventEditScreen';
import TasksScreen from '../screens/Tasks/TasksScreen';
import TasksInboxScreen from '../screens/Tasks/InboxScreen';
import TaskListScreen from '../screens/Tasks/TaskListScreen';
import TaskCardScreen from '../screens/Tasks/TaskCardScreen';
import NormScreen from '../screens/Tasks/NormScreen';
import WarehouseScreen from '../screens/Warehouse/WarehouseScreen';
import WarehouseScannerScreen from '../screens/Warehouse/ScannerScreen';
import WarehouseAssetScreen from '../screens/Warehouse/AssetScreen';
import WarehouseAssetEditScreen from '../screens/Warehouse/AssetEditScreen';
import WarehouseMaterialEditScreen from '../screens/Warehouse/MaterialEditScreen';
import WarehouseItemCreateScreen from '../screens/Warehouse/ItemCreateScreen';
import WarehouseMailingsScreen from '../screens/Warehouse/MailingsScreen';
import WarehouseRoomScreen from '../screens/Warehouse/RoomScreen';
import WarehouseInventoryListScreen from '../screens/Warehouse/InventoryListScreen';
import WarehouseInventoryCountScreen from '../screens/Warehouse/InventoryCountScreen';
import WarehouseInventoryNewScreen from '../screens/Warehouse/InventoryNewScreen';
import WarehousePlacementScreen from '../screens/Warehouse/PlacementScreen';
import WarehouseRoomPickerScreen from '../screens/Warehouse/RoomPickerScreen';
import WarehouseLabelPrintScreen from '../screens/Warehouse/LabelPrintScreen';
import WarehousePrinterScreen from '../screens/Warehouse/PrinterSettingsScreen';
import ReviewsScreen from '../screens/Reviews/ReviewsScreen';
import ReviewBoardScreen from '../screens/Reviews/ReviewBoardScreen';
import ReviewScreen from '../screens/Reviews/ReviewScreen';
import CoursesScreen from '../screens/Courses/CoursesScreen';
import CourseScreen from '../screens/Courses/CourseScreen';
import LessonScreen from '../screens/Courses/LessonScreen';
import CourseTestScreen from '../screens/Courses/CourseTestScreen';
import AlfaTabBar from './AlfaTabBar';
import LogoLoader from '../components/LogoLoader';
import {font} from '../theme';
import {useSettings, useTheme} from '../store/settingsStore';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

/**
 * Переходы внутри стеков.
 *
 * По умолчанию на Android новый экран просто подменяет предыдущий, и переходы
 * читаются как перелистывание слайдов. Заезд справа привязывает новый экран к
 * жесту «вперёд», а свайп от края возвращает назад — так понятнее, где ты
 * находишься. Длительность заметно короче системной: на телефоне важнее
 * отзывчивость, чем красота хода.
 */
const STACK_ANIMATION = {
  animation: 'slide_from_right',
  animationDuration: 220,
  gestureEnabled: true,
};

// Навигация извне дерева React — нужна для перехода в чат по тапу на уведомление
export const navigationRef = createNavigationContainerRef();

/**
 * Экран загрузки — продолжение системного экрана запуска.
 *
 * Системный экран запуска статичен, но основной этап загрузки уже знает
 * сохранённые настройки. Поэтому здесь тот же белый знак, а фон продолжает
 * градиент выбранного акцента. На iOS его первый цвет также дублируется в
 * UserDefaults для промежутка между LaunchScreen и первым кадром React.
 *
 * Индикатор появляется только если ждать пришлось дольше секунды: при обычном
 * запуске он бы мелькнул и лишь выдал стык двух экранов, а при медленной сети
 * человеку нужен признак, что приложение не зависло.
 *
 * Индикатор — тот же знак, только обведённый линией (logo.png — заливка,
 * LogoLoader — её осевая). Подменять им знак по центру нельзя: системный экран
 * запуска показывает именно заливку, и на подмене стык двух экранов стал бы
 * виден. Поэтому знак по центру остаётся, а индикатор ощутимо мельче —
 * иначе рядом читались бы два логотипа вместо марки и признака работы.
 */
function SplashScreen() {
  const [showLoader, setShowLoader] = useState(false);
  const c = useTheme();

  useEffect(() => {
    const t = setTimeout(() => setShowLoader(true), 1000);
    return () => clearTimeout(t);
  }, []);

  return (
    <LinearGradient
      colors={[c.headerGradientStart, c.headerGradientEnd]}
      start={{x: 0, y: 0}}
      end={{x: 1, y: 1}}
      style={splashStyles.wrap}>
      <Image
        source={require('../../assets/images/logo.png')}
        style={splashStyles.logo}
        resizeMode="contain"
      />
      {showLoader && (
        <LogoLoader
          width={56}
          color="rgba(255,255,255,0.85)"
          style={splashStyles.loader}
        />
      )}
    </LinearGradient>
  );
}

const splashStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 128 — тот же размер, что у знака в системном экране
  logo: {width: 128, height: 128},
  loader: {position: 'absolute', bottom: 96},
});

function HeaderBackground() {
  const c = useTheme();

  return (
    <LinearGradient
      colors={[c.headerGradientStart, c.headerGradientEnd]}
      start={{x: 0, y: 0}}
      end={{x: 1, y: 0}}
      style={StyleSheet.absoluteFill}
    />
  );
}

function ChatsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerBackground: () => <HeaderBackground />,
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {fontFamily: font.semiBold, fontSize: 17, color: '#FFFFFF'},
        headerBackTitleVisible: false,
        ...STACK_ANIMATION,
      }}>
      {/* «+» вернулся в шапку. Какое-то время создание чата висело на долгом
          нажатии центральной кнопки, но с переходом навигации на дугу разделов
          (ver. 7.22) это нажатие занято меню, а прятать создание чата третьим
          уровнем внутрь дуги — значит убрать его из виду совсем. */}
      <Stack.Screen
        name="ChatList"
        component={ChatListScreen}
        options={({navigation}) => ({
          title: 'Альфа Вики',
          headerTitleAlign: 'center',
          headerRight: () => (
            <Pressable
              onPress={() => navigation.navigate('NewChat', {initialMode: 'private'})}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Новый чат">
              <SquarePen size={21} color="#FFFFFF" />
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          title: '',
          // Шапка выше обычной: в ней аватар 44pt, имя и статус под ним
          headerStyle: {height: 84},
        }}
      />
      <Stack.Screen
        name="NewChat"
        component={NewChatScreen}
        options={{
          title: 'Новый чат',
          headerTitleAlign: 'center',
          // В новых версиях native-stack headerBackTitleVisible недостаточно:
          // iOS всё равно может показать крупную кнопку «Альфа Вики».
          // minimal гарантированно оставляет только компактную стрелку.
          headerBackButtonDisplayMode: 'minimal',
          headerBackTitle: '',
        }}
      />
      <Stack.Screen
        name="ChatInfo"
        component={ChatInfoScreen}
        options={{title: 'Информация о группе'}}
      />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerBackground: () => <HeaderBackground />,
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {fontFamily: font.semiBold, fontSize: 17, color: '#FFFFFF'},
        headerTitleAlign: 'center',
        ...STACK_ANIMATION,
      }}>
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{title: 'Профиль'}}
      />
    </Stack.Navigator>
  );
}

/**
 * Вкладка «Задачи» (ver. 6.75) — она же бывший «Календарь».
 *
 * Модуль занял место календаря, а не встал рядом с ним, потому что его главный
 * экран и есть календарь: та же месячная сетка и тот же список дня, только с
 * полосой загрузки сверху. Две вкладки с календарём означали бы два места, где
 * лежит день сотрудника, и необходимость смотреть в оба.
 *
 * Экраны события (CalendarEvent, CalendarEventEdit) никуда не делись и живут
 * здесь же: события общие, и открывают их отсюда.
 *
 * Своей нижней панели, как в прототипе, у модуля нет: панель приложения уже
 * занята пятью разделами портала. «Входящие» и «Задачи» открываются значками в
 * шапке главного экрана, а норма рабочего дня — из настроек.
 */
function TasksStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerBackground: () => <HeaderBackground />,
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {fontFamily: font.semiBold, fontSize: 17, color: '#FFFFFF'},
        headerTitleAlign: 'center',
        headerBackTitleVisible: false,
        ...STACK_ANIMATION,
      }}>
      <Stack.Screen
        name="TasksHome"
        component={TasksScreen}
        options={{title: 'Задачи'}}
      />
      <Stack.Screen
        name="TasksInbox"
        component={TasksInboxScreen}
        options={{title: 'Входящие'}}
      />
      <Stack.Screen
        name="TasksList"
        component={TaskListScreen}
        options={{title: 'Мои задачи'}}
      />
      {/* Заголовок карточки — название задачи, его ставит сам экран */}
      <Stack.Screen
        name="TaskCard"
        component={TaskCardScreen}
        options={{title: 'Задача'}}
      />
      <Stack.Screen
        name="CalendarEvent"
        component={EventScreen}
        options={{title: 'Событие'}}
      />
      {/* Заголовок формы зависит от того, создаём мы событие или правим, —
          его выставляет сам экран */}
      <Stack.Screen name="CalendarEventEdit" component={EventEditScreen} />
    </Stack.Navigator>
  );
}

/**
 * Вкладка «Склад» (ver. 6.81).
 *
 * Отдельной вкладкой, а не пунктом внутри чего-то: складом занимаются не за
 * столом. Инвентаризация — это обход помещений с телефоном, размещение
 * имущества — тоже, и оба занятия начинаются с того, что человек достаёт
 * телефон в кабинете. Прятать такое на третьем уровне значит не пользоваться
 * этим вовсе.
 *
 * В мобилке живёт только то, что делают на ногах. Настройка локаций, планы
 * этажей, словарь предметов, отчёты и закупки остались в вебе — там нужна
 * клавиатура и большой экран, и телефон в этой работе мешает.
 */
function WarehouseStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerBackground: () => <HeaderBackground />,
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {fontFamily: font.semiBold, fontSize: 17, color: '#FFFFFF'},
        headerTitleAlign: 'center',
        headerBackTitleVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        ...STACK_ANIMATION,
      }}>
      <Stack.Screen
        name="WarehouseHome"
        component={WarehouseScreen}
        options={{title: 'Склад'}}
      />
      {/* Сканер без шапки: кадр камеры занимает экран целиком, а закрывается он
          своей кнопкой поверх кадра — системная шапка над видоискателем
          выглядела бы как чужая полоса на объективе. */}
      <Stack.Screen
        name="WarehouseScanner"
        component={WarehouseScannerScreen}
        options={{headerShown: false}}
      />
      {/* Заголовок карточки — инвентарный номер, его ставит сам экран */}
      <Stack.Screen
        name="WarehouseAsset"
        component={WarehouseAssetScreen}
        options={{title: 'Оборудование'}}
      />
      {/* Правка карточек с телефона (ver. 7.24). Заголовок — тот же инвентарный
          номер: форма и просмотр это один предмет, и подписаны они одинаково */}
      <Stack.Screen
        name="WarehouseAssetEdit"
        component={WarehouseAssetEditScreen}
        options={{title: 'Правка карточки'}}
      />
      <Stack.Screen
        name="WarehouseMaterialEdit"
        component={WarehouseMaterialEditScreen}
        options={{title: 'Материал'}}
      />
      {/* Заголовок зависит от того, что заводят, — его ставит сам экран */}
      <Stack.Screen
        name="WarehouseItemCreate"
        component={WarehouseItemCreateScreen}
        options={{title: 'Завести'}}
      />
      <Stack.Screen
        name="WarehouseMailings"
        component={WarehouseMailingsScreen}
        options={{title: 'Отчёты и рассылки'}}
      />
      <Stack.Screen
        name="WarehouseRoom"
        component={WarehouseRoomScreen}
        options={{title: 'Кабинет'}}
      />
      <Stack.Screen
        name="WarehouseInventoryList"
        component={WarehouseInventoryListScreen}
        options={{title: 'Инвентаризация'}}
      />
      <Stack.Screen
        name="WarehouseInventoryCount"
        component={WarehouseInventoryCountScreen}
        options={{title: 'Пересчёт'}}
      />
      <Stack.Screen
        name="WarehouseInventoryNew"
        component={WarehouseInventoryNewScreen}
        options={{title: 'Новая опись'}}
      />
      <Stack.Screen
        name="WarehousePlacement"
        component={WarehousePlacementScreen}
        options={{title: 'Размещение'}}
      />
      {/* Заголовок и кнопка принтера в шапке — на самом экране: список кабинетов
          переключается между просмотром и отбором под печать, и шапка меняется
          вместе с ним */}
      <Stack.Screen
        name="WarehouseRooms"
        component={WarehouseRoomPickerScreen}
        options={{title: 'Кабинеты'}}
      />
      <Stack.Screen
        name="WarehouseLabelPrint"
        component={WarehouseLabelPrintScreen}
        options={{title: 'Печать'}}
      />
      <Stack.Screen
        name="WarehousePrinter"
        component={WarehousePrinterScreen}
        options={{title: 'Принтер этикеток'}}
      />
    </Stack.Navigator>
  );
}

/**
 * Вкладка «Отзывы» (ver. 7.26).
 *
 * Работа с негативом до сих пор жила только в вебе, а уведомления по ней — в
 * чате бота, который push не поднимает. То есть «вам назначен отзыв» человек
 * узнавал, открыв портал за компьютером. Теперь раздел есть на телефоне, и
 * приходит он туда уведомлением, ведущим прямо в карточку.
 *
 * Заведение отзыва, финализация с категорией решения, ответ на площадке и
 * PDF-отчёт остались в вебе: это работа за столом, с документами перед глазами.
 */
function ReviewsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerBackground: () => <HeaderBackground />,
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {fontFamily: font.semiBold, fontSize: 17, color: '#FFFFFF'},
        headerTitleAlign: 'center',
        headerBackTitleVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        ...STACK_ANIMATION,
      }}>
      <Stack.Screen
        name="ReviewsHome"
        component={ReviewsScreen}
        options={{title: 'Отзывы'}}
      />
      {/* Заголовок — название доски: оно приходит из списка, поэтому шапка
          подписана сразу, ещё до того как доска догрузится */}
      <Stack.Screen
        name="ReviewBoard"
        component={ReviewBoardScreen}
        options={({route}) => ({title: route.params?.title || 'Доска'})}
      />
      {/* Заголовок карточки — имя пациента, его ставит сам экран */}
      <Stack.Screen
        name="Review"
        component={ReviewScreen}
        options={{title: 'Отзыв'}}
      />
    </Stack.Navigator>
  );
}

function CoursesStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerBackground: () => <HeaderBackground />,
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {fontFamily: font.semiBold, fontSize: 17, color: '#FFFFFF'},
        headerTitleAlign: 'center',
        headerBackTitleVisible: false,
        ...STACK_ANIMATION,
      }}>
      <Stack.Screen
        name="CoursesList"
        component={CoursesScreen}
        options={{title: 'Курсы'}}
      />
      {/* Заголовок — название курса: оно приходит из списка, поэтому шапка
          подписана сразу, ещё до того как курс догрузится */}
      <Stack.Screen
        name="Course"
        component={CourseScreen}
        options={({route}) => ({title: route.params?.title || 'Курс'})}
      />
      {/* У урока и теста шапки свои: в них шкала прохождения, а стандартная
          такого не умеет */}
      <Stack.Screen
        name="Lesson"
        component={LessonScreen}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="CourseTest"
        component={CourseTestScreen}
        options={{headerShown: false}}
      />
    </Stack.Navigator>
  );
}

function SettingsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerBackground: () => <HeaderBackground />,
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {fontFamily: font.semiBold, fontSize: 17, color: '#FFFFFF'},
        headerTitleAlign: 'center',
        ...STACK_ANIMATION,
      }}>
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{title: 'Настройки'}}
      />
      {/* Рабочее расписание: личная настройка, поэтому лежит в
          настройках, а не в самом модуле «Задачи» */}
      <Stack.Screen
        name="TasksNorm"
        component={NormScreen}
        options={{title: 'Рабочее расписание'}}
      />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    // Панель нарисована своим компонентом: у стандартной прямоугольный фон,
    // в котором нельзя сделать выемку под центральную кнопку
    <Tab.Navigator
      initialRouteName="ChatsTab"
      // Переключаем вкладки без cross-fade. При нескольких быстрых нажатиях
      // незавершённые fade-анимации перебивают друг друга и активная сцена
      // иногда остаётся с opacity: 0 — виден только фон контейнера. Мгновенная
      // смена вкладки заодно соответствует системному поведению tab bar.
      screenOptions={{headerShown: false, animation: 'none'}}
      tabBar={props => <AlfaTabBar {...props} />}>
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStack}
        options={{title: 'Профиль'}}
      />
      <Tab.Screen
        name="TasksTab"
        component={TasksStack}
        options={{title: 'Задачи'}}
      />
      <Tab.Screen
        name="ChatsTab"
        component={ChatsStack}
        // Подпись под логотипом не нужна — кнопка узнаётся по знаку.
        // title остаётся для скринридера.
        options={{title: 'Альфа'}}
      />
      {/* Склад справа от кнопки «Альфа»: слева теперь две вкладки, справа три.
          Симметрию групп пришлось разменять на то, чтобы марка осталась ровно
          посередине экрана — см. комментарий в AlfaTabBar. */}
      <Tab.Screen
        name="WarehouseTab"
        component={WarehouseStack}
        options={{title: 'Склад'}}
      />
      {/* Отзывы: доступ раздаётся досками, и у кого их нет — кнопки в колесе
          тоже нет (см. reviewsStore и AlfaTabBar) */}
      <Tab.Screen
        name="ReviewsTab"
        component={ReviewsStack}
        options={{title: 'Отзывы'}}
      />
      <Tab.Screen
        name="CoursesTab"
        component={CoursesStack}
        options={{title: 'Курсы'}}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsStack}
        options={{title: 'Настройки'}}
      />
    </Tab.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{headerShown: false}}>
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const {loaded, scheme, colors: c} = useSettings();
  const {user, isLoading} = useAuth();

  // Своя тема навигатора: у стандартной фон почти белый, и он просвечивает
  // всюду, где содержимое прозрачно — в вырезе нижней панели и в момент
  // перехода между экранами
  const navTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: c.bgSecondary,
        card: c.bgPrimary,
        text: c.textPrimary,
        border: c.border,
        primary: c.primary,
      },
    };
  }, [scheme, c]);

  // Пока AsyncStorage не отдал выбранную палитру, оставляем видимым нативный
  // фон из AppDelegate. Иначе успел бы мелькнуть синий цвет по умолчанию.
  if (!loaded) return null;

  if (isLoading) {
    return (
      <SplashScreen />
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      {user ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
}
