/**
 * Безопасность: пароль и устройства, на которых выполнен вход.
 *
 * Вторая половина бывшего «Профиля» (ver. 7.55). Реестр сессий появился в
 * ver. 6.49: до него выданный токен нельзя было отозвать, а на мобиле он живёт
 * год — потерянный телефон означал год доступа к переписке.
 *
 * Список сессий грузится при каждом входе на экран, а не один раз: сюда
 * заходят именно затем, чтобы посмотреть, кто сейчас в аккаунте, и показывать
 * при этом снимок недельной давности нельзя.
 */
import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import {Lock, Eye, EyeOff, LogOut, Monitor, Smartphone} from 'lucide-react-native';

import {auth as authApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {makeSettingsStyles} from './parts';

function sessionTitle(s) {
  return s.deviceName || (s.platform === 'mobile' ? 'Мобильное приложение' : 'Браузер');
}

function formatSessionActivity(iso) {
  if (!iso) return 'активности не было';
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 5) return 'активна сейчас';
  if (diffMin < 60) return `${diffMin} мин назад`;
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** Поле пароля с кнопкой «показать»: вслепую его набирают с ошибками. */
function PasswordField({label, value, onChange}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [shown, setShown] = useState(false);

  return (
    <View style={styles.formGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.passwordWrap}>
        <TextInput
          style={styles.passwordInput}
          value={value}
          onChangeText={onChange}
          secureTextEntry={!shown}
          placeholderTextColor={c.textTertiary}
          placeholder="••••••"
        />
        <TouchableOpacity style={styles.eyeBtn} onPress={() => setShown(v => !v)}>
          {shown
            ? <EyeOff size={18} color={c.textSecondary} />
            : <Eye size={18} color={c.textSecondary} />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function SecurityScreen() {
  const c = useTheme();
  const base = useThemedStyles(makeSettingsStyles);
  const styles = useThemedStyles(makeStyles);

  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [sessions, setSessions] = useState(null);

  const loadSessions = useCallback(() => {
    authApi.sessions()
      .then(({data}) => setSessions(data))
      .catch(() => setSessions([]));
  }, []);

  useFocusEffect(useCallback(() => { loadSessions(); }, [loadSessions]));

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert('Ошибка', 'Заполните все поля');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Ошибка', 'Пароли не совпадают');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Ошибка', 'Пароль должен быть минимум 6 символов');
      return;
    }
    setSaving(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      // Сервер при смене пароля снимает все остальные сессии — перечитываем
      // список, иначе в нём останутся уже мёртвые устройства
      Alert.alert('Готово', 'Пароль изменён. Другие устройства отключены');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      loadSessions();
    } catch (e) {
      Alert.alert('Ошибка', e.response?.data?.error || 'Неверный текущий пароль');
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeSession = session => {
    Alert.alert(`Завершить сессию «${sessionTitle(session)}»?`, '', [
      {text: 'Отмена', style: 'cancel'},
      {
        text: 'Завершить',
        style: 'destructive',
        onPress: async () => {
          try {
            await authApi.revokeSession(session.id);
            setSessions(prev => (prev || []).filter(s => s.id !== session.id));
          } catch {
            Alert.alert('Ошибка', 'Не удалось завершить сессию');
          }
        },
      },
    ]);
  };

  const handleRevokeAll = () => {
    Alert.alert('Выйти на всех остальных устройствах?', '', [
      {text: 'Отмена', style: 'cancel'},
      {
        text: 'Выйти везде',
        style: 'destructive',
        onPress: async () => {
          try {
            await authApi.revokeAllSessions();
            setSessions(prev => (prev || []).filter(s => s.isCurrent));
          } catch {
            Alert.alert('Ошибка', 'Не удалось завершить сессии');
          }
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={base.container}
      contentContainerStyle={base.content}
      keyboardShouldPersistTaps="handled">
      <Text style={base.sectionTitle}>Смена пароля</Text>
      <View style={styles.card}>
        <PasswordField label="Текущий пароль" value={currentPassword} onChange={setCurrentPassword} />
        <PasswordField label="Новый пароль" value={newPassword} onChange={setNewPassword} />
        <PasswordField label="Подтвердите пароль" value={confirmPassword} onChange={setConfirmPassword} />

        <TouchableOpacity onPress={handleChangePassword} disabled={saving} activeOpacity={0.85}>
          <LinearGradient
            colors={saving ? [c.textTertiary, c.textTertiary] : [c.primary, c.secondary]}
            start={{x: 0, y: 0}}
            end={{x: 1, y: 0}}
            style={styles.saveBtn}>
            {saving ? (
              <LogoLoader width={52} color="#FFFFFF" />
            ) : (
              <>
                <Lock size={16} color="#FFF" style={styles.saveIcon} />
                <Text style={styles.saveBtnText}>Изменить пароль</Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <View style={styles.sessionsHead}>
        <Text style={base.sectionTitle}>Активные сессии</Text>
        {(sessions || []).some(s => !s.isCurrent) && (
          <TouchableOpacity onPress={handleRevokeAll}>
            <Text style={styles.revokeAll}>Выйти везде</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.card}>
        {!sessions ? (
          <LogoLoader width={64} style={styles.loader} />
        ) : sessions.length === 0 ? (
          <Text style={styles.empty}>
            Список пуст. Так бывает, если вход был выполнен до обновления —
            переавторизуйтесь, и сессия появится здесь.
          </Text>
        ) : (
          sessions.map((s, i) => (
            <View key={s.id} style={[styles.sessionRow, i > 0 && styles.sessionRowNext]}>
              <View style={styles.sessionIcon}>
                {s.platform === 'mobile'
                  ? <Smartphone size={18} color={c.primary} />
                  : <Monitor size={18} color={c.primary} />}
              </View>
              <View style={styles.sessionInfo}>
                <Text style={styles.sessionName} numberOfLines={1}>
                  {sessionTitle(s)}{s.isCurrent ? ' · это устройство' : ''}
                </Text>
                <Text style={styles.sessionMeta} numberOfLines={1}>
                  {formatSessionActivity(s.lastActivityAt)}{s.ip ? ` · ${s.ip}` : ''}
                </Text>
              </View>
              {!s.isCurrent && (
                <TouchableOpacity style={styles.sessionRevoke} onPress={() => handleRevokeSession(s)}>
                  <LogOut size={16} color={c.error} />
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  card: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    paddingHorizontal: 16, paddingVertical: 18,
    marginBottom: 22,
  },
  formGroup: {marginBottom: 16},
  label: {fontSize: 13, fontFamily: font.medium, color: c.textSecondary, marginBottom: 7},
  passwordWrap: {
    flexDirection: 'row', alignItems: 'center',
    height: 48, backgroundColor: c.bgSecondary,
    borderWidth: 1.5, borderColor: c.border, borderRadius: radius.lg,
  },
  passwordInput: {
    flex: 1, paddingHorizontal: 14,
    fontSize: 15, fontFamily: font.regular, color: c.textPrimary,
  },
  eyeBtn: {paddingHorizontal: 12},

  saveBtn: {
    height: 48, borderRadius: radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
  saveIcon: {marginRight: 8},
  saveBtnText: {color: '#FFF', fontSize: 15, fontFamily: font.semiBold},

  sessionsHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  revokeAll: {fontSize: 13, fontFamily: font.medium, color: c.error, marginBottom: 8},
  loader: {alignSelf: 'center'},
  empty: {fontSize: 13, fontFamily: font.regular, color: c.textTertiary, lineHeight: 19},

  sessionRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 10},
  sessionRowNext: {borderTopWidth: 1, borderTopColor: c.borderLight},
  sessionIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  sessionInfo: {flex: 1, minWidth: 0},
  sessionName: {fontSize: 14, fontFamily: font.medium, color: c.textPrimary},
  sessionMeta: {fontSize: 12, fontFamily: font.regular, color: c.textTertiary, marginTop: 2},
  sessionRevoke: {padding: 8, marginLeft: 4},
});
