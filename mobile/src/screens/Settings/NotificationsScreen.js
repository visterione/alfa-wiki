/**
 * Уведомления: разрешение системы и мелодия.
 *
 * Разрешением приложение не управляет — начиная с Android 8 звук, вибрация и
 * важность живут в системных настройках канала. Поэтому здесь только строка
 * состояния и переход туда.
 */
import React, {useState, useEffect} from 'react';
import {ScrollView, Alert, Linking} from 'react-native';
import {Bell} from 'lucide-react-native';
import notifee from '@notifee/react-native';

import NotificationService from '../../services/notifications';
import {useThemedStyles, useSettings, SOUND_OPTIONS, soundOption} from '../../store/settingsStore';
import {Row, ChoiceRow, Section, Divider, makeSettingsStyles} from './parts';

export default function NotificationsScreen() {
  const base = useThemedStyles(makeSettingsStyles);
  const settings = useSettings();

  const [pushEnabled, setPushEnabled] = useState(null);

  // Реальное состояние разрешения спрашиваем у системы, а не храним у себя:
  // пользователь мог отключить уведомления в настройках Android мимо приложения
  useEffect(() => {
    notifee
      .getNotificationSettings()
      .then(s => setPushEnabled(s.authorizationStatus === 1))
      .catch(() => setPushEnabled(null));
  }, []);

  const openSystemNotificationSettings = () => {
    notifee.openNotificationSettings().catch(() => {
      Linking.openSettings().catch(() => {});
    });
  };

  /**
   * Прослушать мелодию.
   *
   * Показываем настоящее уведомление в нужном канале, а не проигрываем файл
   * плеером: только так слышно ровно то, что услышит пользователь — с учётом
   * громкости канала и системных настроек. Через пару секунд убираем его,
   * чтобы не копилось в шторке.
   */
  const previewSound = async key => {
    try {
      const channelId = await NotificationService.ensureChannel(key);
      const option = soundOption(key);
      const id = await notifee.displayNotification({
        title: 'Проверка звука',
        body: option.label,
        android: {channelId, smallIcon: 'ic_notification', color: '#2563EB'},
        // Блока ios здесь не было вовсе, поэтому на айфоне проверка молчала:
        // уведомление показывалось без звука, и выбрать мелодию на слух было
        // невозможно. На iOS звук задаётся у самого уведомления, а не у канала.
        ios: {sound: option.iosSound},
      });
      setTimeout(() => notifee.cancelNotification(id).catch(() => {}), 2500);
    } catch {
      Alert.alert('Не удалось', 'Проверьте разрешение на уведомления');
    }
  };

  return (
    <ScrollView style={base.container} contentContainerStyle={base.content}>
      <Section
        title="Разрешение"
        footer="Звук, вибрацию и важность уведомлений задаёт система — приложение ими не управляет.">
        <Row
          icon={Bell}
          title="Уведомления о сообщениях"
          subtitle={
            pushEnabled === null
              ? 'Статус неизвестен'
              : pushEnabled
              ? 'Разрешены'
              : 'Запрещены в настройках системы'
          }
          onPress={openSystemNotificationSettings}
        />
      </Section>

      <Section title="Мелодия">
        {SOUND_OPTIONS.map((snd, i) => (
          <React.Fragment key={snd.key}>
            {i > 0 && <Divider />}
            <ChoiceRow
              label={snd.label}
              selected={settings.notificationSound === snd.key}
              onPress={() => {
                // Выбор и есть проба: человек слышит мелодию сразу и,
                // если не понравилась, тут же жмёт другую
                settings.update({notificationSound: snd.key});
                previewSound(snd.key);
              }}
            />
          </React.Fragment>
        ))}
      </Section>
    </ScrollView>
  );
}
