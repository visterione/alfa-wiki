/**
 * Настройки — единственный «личный» раздел приложения (ver. 7.55).
 *
 * ── Почему «Профиля» больше нет отдельной вкладкой ──────────────────────────
 *
 * Вкладок было семь, и две из них вели в соседние половины одного и того же:
 * в «Профиле» лежали имя, почта, пароль и устройства, в «Настройках» — тема,
 * звук и фон. Границу между ними приходилось помнить: пароль — это профиль или
 * настройки? А устройства? Люди искали и там, и там.
 *
 * Теперь раздел один, и устроен он так же, как в мессенджерах: сверху карточка
 * с собой, ниже — список разделов, каждый на своём экране. Свиток в четыре
 * экрана, каким «Настройки» были раньше, заодно перестал быть свитком: чтобы
 * поменять мелодию, больше не нужно проезжать мимо восьми узоров фона.
 *
 * Выход из аккаунта остался внизу этого экрана и в колесе действий на долгое
 * нажатие знака «Альфа» (см. AlfaTabBar) — там он был у профиля и переехал
 * сюда вместе с ним.
 */
import React from 'react';
import {View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert} from 'react-native';
import {Bell, Palette, User, Lock, LogOut, Timer, ChevronRight} from 'lucide-react-native';

import {radius, font} from '../../theme';
import {useTheme, useThemedStyles, useSettings} from '../../store/settingsStore';
import {useAuth} from '../../store/authStore';
import Avatar from '../../components/Avatar';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {Row, Section, Divider, makeSettingsStyles} from './parts';

/** Подпись под именем: администратор, роли или должность — что есть. */
function roleText(user) {
  if (!user) return '';
  if (user.isAdmin) return 'Администратор';
  if (user.roles?.length) return user.roles.map(r => r.name).join(', ');
  return user.role?.name || 'Пользователь';
}

export default function SettingsScreen({navigation}) {
  const c = useTheme();
  const base = useThemedStyles(makeSettingsStyles);
  const styles = useThemedStyles(makeStyles);
  const settings = useSettings();
  const {user, logout} = useAuth();
  // Панель лежит поверх экрана — высоту под неё резервируем сами
  const tabInset = useTabBarInset();

  const handleLogout = () => {
    Alert.alert('Выйти из аккаунта?', '', [
      {text: 'Отмена', style: 'cancel'},
      {text: 'Выйти', style: 'destructive', onPress: logout},
    ]);
  };

  return (
    <ScrollView
      style={base.container}
      contentContainerStyle={[base.content, {paddingBottom: tabInset + 16}]}>
      {/* Карточка «это я». Ведёт в личные данные — как и сама аватарка:
          человек, который хочет сменить фото, жмёт по фото, а не ищет строку
          с подписью «Личные данные» ниже. */}
      <TouchableOpacity
        style={styles.me}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('SettingsAccount')}>
        <Avatar uri={user?.avatar} size={62} />
        <View style={styles.meBody}>
          <Text style={styles.meName} numberOfLines={1}>
            {user?.displayName || user?.username}
          </Text>
          <Text style={styles.meRole} numberOfLines={1}>{roleText(user)}</Text>
        </View>
        <ChevronRight size={20} color={c.textTertiary} />
      </TouchableOpacity>

      <Section title="Аккаунт">
        <Row
          icon={User}
          tint={c.primary}
          title="Личные данные"
          subtitle="Фото, имя и почта"
          onPress={() => navigation.navigate('SettingsAccount')}
        />
        <Divider inset />
        <Row
          icon={Lock}
          tint={c.success}
          title="Безопасность"
          subtitle="Пароль и вход на устройствах"
          onPress={() => navigation.navigate('SettingsSecurity')}
        />
      </Section>

      <Section title="Приложение">
        <Row
          icon={Bell}
          tint={c.error}
          title="Уведомления"
          subtitle="Разрешение и мелодия"
          onPress={() => navigation.navigate('SettingsNotifications')}
        />
        <Divider inset />
        <Row
          icon={Palette}
          tint={c.secondary}
          title="Оформление"
          // Подпись перечисляет содержимое: без неё «Оформление» — это и тема,
          // и фон, и размер текста, но узнать об этом можно только зайдя
          subtitle={`Тема, цвет, фон переписки, размер текста · ${settings.scheme === 'dark' ? 'тёмная' : 'светлая'}`}
          onPress={() => navigation.navigate('SettingsAppearance')}
        />
      </Section>

      {/* Рабочее расписание живёт здесь, а не в самом модуле «Задачи»: его
          задают один раз и почти не трогают, и держать под неё постоянную
          кнопку в календаре значило бы каждый день показывать то, на что
          нажимают дважды в год. */}
      <Section title="Работа">
        <Row
          icon={Timer}
          tint={c.warning}
          title="Рабочее расписание"
          subtitle="Часы, в которые вам ставят задачи"
          onPress={() => navigation.navigate('TasksNorm')}
        />
      </Section>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <LogOut size={18} color={c.error} style={styles.logoutIcon} />
        <Text style={styles.logoutText}>Выйти из аккаунта</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  me: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 22,
    gap: 14,
  },
  // minWidth: 0 — без него длинное имя растягивает строку и выталкивает
  // стрелку за край карточки
  meBody: {flex: 1, minWidth: 0},
  meName: {fontSize: 18, fontFamily: font.semiBold, color: c.textPrimary},
  meRole: {fontSize: 13, fontFamily: font.regular, color: c.textSecondary, marginTop: 3},

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.bgPrimary, borderRadius: radius.lg,
    paddingVertical: 15,
    borderWidth: 1, borderColor: `${c.error}44`,
  },
  logoutIcon: {marginRight: 10},
  logoutText: {fontSize: 15, fontFamily: font.medium, color: c.error},
});
