import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Linking,
  Dimensions,
} from 'react-native';
import {
  Bell,
  Palette,
  Type,
  Image as ImageIcon,
  Check,
  Volume2,
  Droplet,
  Info,
  ChevronRight,
  Smartphone,
  Trash2,
} from 'lucide-react-native';
import {version as appVersion} from '../../../package.json';
import CONFIG from '../../config';
import PushService from '../../services/push';
import {radius, font, ACCENTS} from '../../theme';
import {
  useTheme, useThemedStyles, useSettings,
  THEME_OPTIONS, SOUND_OPTIONS, soundOption,
} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {CHAT_BACKGROUNDS, PatternPreview} from '../../components/ChatBackground';
import NotificationService from '../../services/notifications';
import notifee from '@notifee/react-native';
import {fontScales} from '../../theme';

/**
 * Персональные настройки приложения.
 *
 * Отличается от «Профиля»: там данные учётной записи (имя, аватар, пароль),
 * здесь — поведение самого приложения на этом устройстве.
 */

// Размер плитки с образцом фона. Считается от ширины экрана: три плитки в ряд
// с отступами. SVG-образцу нужен конкретный размер в пунктах — процентами
// узор не смасштабируешь.
const BG_TILE_W = Math.floor((Dimensions.get('window').width - 68) / 3);
const BG_TILE_H = BG_TILE_W;

function Row({icon: Icon, title, subtitle, onPress, right, danger}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.row} onPress={onPress} activeOpacity={0.6}>
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Icon size={18} color={danger ? c.error : c.primary} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, danger && styles.rowTitleDanger]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <ChevronRight size={18} color={c.textTertiary} /> : null)}
    </Wrapper>
  );
}

/**
 * Строка-переключатель с галочкой у выбранного. Выбор из трёх-семи вариантов
 * удобнее списком, чем модалкой: всё видно сразу и меняется одним касанием.
 */
function ChoiceRow({label, selected, onPress, preview}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={[styles.choiceRow, preview && styles.choiceRowWide]}
      onPress={onPress}
      activeOpacity={0.6}>
      {preview}
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelActive, preview && styles.choiceLabelInset]}>
        {label}
      </Text>
      {/* Фиксированная ширина: иначе появление галочки сдвигает кнопку
          прослушивания, и строки «прыгают» при выборе */}
      <View style={styles.choiceCheck}>
        {selected ? <Check size={18} color={c.primary} /> : null}
      </View>
    </TouchableOpacity>
  );
}

/**
 * Плитка с образцом фона.
 *
 * Показывает узор так, как он ляжет в переписке: на том же цвете подложки и с
 * пузырьком сообщения поверх. Без пузырька невозможно оценить главное — не
 * мешает ли узор читать.
 */
function BackgroundCell({item, selected, onPress}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <TouchableOpacity
      style={styles.bgCell}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{selected}}>
      <View style={[styles.bgTile, selected && styles.bgTileActive]}>
        <View style={StyleSheet.absoluteFill}>
          <PatternPreview name={item.key} width={BG_TILE_W} height={BG_TILE_H} />
        </View>
        <View style={styles.bgBubble} />
        <View style={styles.bgBubbleOwn} />
        {selected && (
          <View style={styles.bgCheck}>
            <Check size={13} color="#FFFFFF" />
          </View>
        )}
      </View>
      <Text
        style={[styles.bgLabel, selected && styles.bgLabelActive]}
        numberOfLines={1}>
        {item.label}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * Образец текста в выбранном размере. Цифру «1,15×» на глаз оценить нельзя —
 * а увидеть свой же пузырёк можно сразу.
 */
function FontPreview({scale}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.fontPreview}>
      <View style={styles.fontPreviewBubble}>
        <Text style={[styles.fontPreviewText, {fontSize: 15 * scale, lineHeight: 21 * scale}]}>
          Так будет выглядеть текст сообщения
        </Text>
      </View>
    </View>
  );
}

function Section({title, children}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export default function SettingsScreen() {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const settings = useSettings();
  // Панель лежит поверх экрана — высоту под неё резервируем сами
  const tabInset = useTabBarInset();

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
    // Начиная с Android 8 звук, вибрация и важность живут в системных
    // настройках канала — приложение ими управлять не может
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

  const reRegisterPush = () => {
    PushService.register()
      .then(token =>
        Alert.alert(
          token ? 'Готово' : 'Не удалось',
          token
            ? 'Устройство заново зарегистрировано для уведомлений'
            : 'Проверьте разрешение на уведомления в настройках системы',
        ),
      )
      .catch(() => Alert.alert('Ошибка', 'Не удалось обновить регистрацию'));
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, {paddingBottom: tabInset + 16}]}>
      <Section title="Уведомления">
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
        <View style={styles.divider} />
        <Row
          icon={Smartphone}
          title="Перерегистрировать устройство"
          subtitle="Если уведомления перестали приходить"
          onPress={reRegisterPush}
        />
      </Section>

      <Section title="Тема оформления">
        <Row icon={Palette} title="Тема" subtitle="Применяется сразу, без перезапуска" />
        <View style={styles.divider} />
        {THEME_OPTIONS.map((opt, i) => (
          <React.Fragment key={opt.key}>
            {i > 0 && <View style={styles.divider} />}
            <ChoiceRow
              label={opt.label}
              selected={settings.theme === opt.key}
              onPress={() => settings.update({theme: opt.key})}
            />
          </React.Fragment>
        ))}
      </Section>

      <Section title="Акцентный цвет">
        <Row
          icon={Droplet}
          title="Цвет"
          subtitle="Кнопки, свои сообщения, активные элементы"
        />
        <View style={styles.divider} />
        <View style={styles.accentGrid}>
          {ACCENTS.map(a => {
            const selected = settings.accent === a.key;
            // Показываем оттенок именно для текущей темы: в светлой и тёмной
            // один и тот же акцент выглядит по-разному
            const swatch = settings.scheme === 'dark' ? a.dark : a.light;
            return (
              <TouchableOpacity
                key={a.key}
                style={styles.accentCell}
                onPress={() => settings.update({accent: a.key})}
                activeOpacity={0.7}
                // Подписи под кружками нет — название остаётся только для
                // озвучки скринридером, иначе цвет для него безымянный
                accessibilityLabel={a.label}
                accessibilityRole="button">
                <View
                  style={[
                    styles.accentDot,
                    {backgroundColor: swatch},
                    selected && {borderColor: c.textPrimary},
                  ]}>
                  {selected && <Check size={16} color="#FFFFFF" />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </Section>

      <Section title="Фон переписки">
        <Row icon={ImageIcon} title="Узор" subtitle="Намеренно бледный, чтобы не мешал читать" />
        <View style={styles.divider} />
        {/* Сеткой, а не списком: узоров стало больше десятка, и строками они
            растянулись бы на два экрана, а сравнить их между собой — главное,
            ради чего вообще нужен образец */}
        <View style={styles.bgGrid}>
          {CHAT_BACKGROUNDS.map(bg => (
            <BackgroundCell
              key={bg.key}
              item={bg}
              selected={settings.chatBackground === bg.key}
              onPress={() => settings.update({chatBackground: bg.key})}
            />
          ))}
        </View>
      </Section>

      <Section title="Размер текста в чате">
        <Row icon={Type} title="Шрифт" subtitle="Влияет на текст сообщений" />
        <FontPreview scale={settings.scale} />
        <View style={styles.divider} />
        {Object.values(fontScales).map((fs, i) => (
          <React.Fragment key={fs.key}>
            {i > 0 && <View style={styles.divider} />}
            <ChoiceRow
              label={fs.label}
              selected={settings.fontScale === fs.key}
              onPress={() => settings.update({fontScale: fs.key})}
            />
          </React.Fragment>
        ))}
      </Section>

      <Section title="Звук уведомлений">
        <Row
          icon={Volume2}
          title="Мелодия"
          subtitle="Нажмите на вариант — он выберется и прозвучит"
        />
        <View style={styles.divider} />
        {SOUND_OPTIONS.map((snd, i) => (
          <React.Fragment key={snd.key}>
            {i > 0 && <View style={styles.divider} />}
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

      <Section title="О приложении">
        <Row icon={Info} title="Версия" right={<Text style={styles.value}>{appVersion}</Text>} />
        <View style={styles.divider} />
        <Row icon={Info} title="Сервер" right={<Text style={styles.value} numberOfLines={1}>{CONFIG.BASE_URL.replace(/^https?:\/\//, '')}</Text>} />
      </Section>

      <Section title="Данные">
        <Row
          icon={Trash2}
          title="Очистить уведомления"
          subtitle="Убрать все уведомления приложения из шторки"
          danger
          onPress={() => {
            notifee.cancelAllNotifications().catch(() => {});
            Alert.alert('Готово', 'Уведомления очищены');
          }}
        />
      </Section>
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 16, paddingBottom: 32},

  section: {marginBottom: 22},
  sectionTitle: {
    fontSize: 13,
    fontFamily: font.medium,
    color: c.textSecondary,
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  card: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },

  row: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13},
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowIconDanger: {backgroundColor: '#FFE5E5'},
  rowBody: {flex: 1, marginRight: 8},
  rowTitle: {fontSize: 15, fontFamily: font.regular, color: c.textPrimary},
  rowTitleDanger: {color: c.error},
  rowSubtitle: {fontSize: 12.5, fontFamily: font.regular, color: c.textSecondary, marginTop: 2},
  divider: {height: 1, backgroundColor: c.borderLight, marginLeft: 58},

  // ── Фон переписки ──────────────────────────────────────────────────────────
  bgGrid: {flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 8},
  bgCell: {width: BG_TILE_W},
  bgTile: {
    width: BG_TILE_W,
    height: BG_TILE_H,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: c.bgSecondary,
    borderWidth: 1,
    borderColor: c.borderLight,
    // Пузырьки прижаты книзу — так плитка читается как кусок переписки
    justifyContent: 'flex-end',
    padding: 7,
  },
  bgTileActive: {borderColor: c.primary, borderWidth: 2},
  bgBubble: {
    height: 11,
    width: '70%',
    borderRadius: 5.5,
    backgroundColor: c.bubbleOther,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    marginBottom: 5,
  },
  bgBubbleOwn: {
    height: 11,
    width: '55%',
    borderRadius: 5.5,
    alignSelf: 'flex-end',
    backgroundColor: c.primary,
  },
  bgCheck: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bgLabel: {
    marginTop: 6,
    fontSize: 11,
    fontFamily: font.medium,
    color: c.textSecondary,
    textAlign: 'center',
  },
  bgLabelActive: {color: c.primary},

  accentGrid: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 14,
  },
  // Без подписей восемь цветов помещаются в одну строку
  accentCell: {width: '12.5%', alignItems: 'center'},
  accentDot: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },

  choiceRowWide: {paddingLeft: 14},
  choiceCheck: {width: 20, alignItems: 'flex-end'},
  choiceLabelInset: {marginLeft: 12},
  fontPreview: {paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2},
  fontPreviewBubble: {
    alignSelf: 'flex-start', maxWidth: '92%',
    backgroundColor: c.bubbleOther, borderRadius: radius.lg,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: c.borderLight,
  },
  fontPreviewText: {fontFamily: font.regular, color: c.bubbleOtherText},

  choiceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12, paddingLeft: 58,
  },
  // flex:1 — иначе при наличии образца строка растягивает промежутки
  // и подпись уезжает в центр
  choiceLabel: {flex: 1, fontSize: 15, fontFamily: font.regular, color: c.textPrimary},
  choiceLabelActive: {fontFamily: font.semiBold, color: c.primary},

  value: {fontSize: 14, fontFamily: font.medium, color: c.textSecondary, maxWidth: 170},
  soon: {
    fontSize: 12,
    fontFamily: font.medium,
    color: c.textTertiary,
    backgroundColor: c.bgTertiary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
});
