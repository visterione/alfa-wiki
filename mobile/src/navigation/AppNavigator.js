import React, {useState, useEffect, useMemo} from 'react';
import {
  StyleSheet,
  Image,
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
      {/* Кнопки «+» в шапке больше нет: создание чата переехало на долгое
          нажатие центральной кнопки панели (см. AlfaTabBar). Так действие
          доступно с любой вкладки и не занимает угол шапки. */}
      <Stack.Screen
        name="ChatList"
        component={ChatListScreen}
        options={{
          title: 'Альфа Вики',
          headerTitleAlign: 'center',
        }}
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
      {/* Норма рабочего дня (ver. 6.75): личная настройка, поэтому лежит в
          настройках, а не в самом модуле «Задачи» */}
      <Stack.Screen
        name="TasksNorm"
        component={NormScreen}
        options={{title: 'Норма рабочего дня'}}
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
