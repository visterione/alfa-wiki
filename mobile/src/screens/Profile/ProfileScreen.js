import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {launchImageLibrary} from 'react-native-image-picker';
import {User, Lock, Camera, LogOut, Save, Eye, EyeOff, Monitor, Smartphone} from 'lucide-react-native';
import {useAuth} from '../../store/authStore';
import {auth as authApi, media as mediaApi} from '../../services/api';
import Avatar from '../../components/Avatar';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';

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

export default function ProfileScreen() {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Панель лежит поверх экрана — высоту под неё резервируем сами
  const tabInset = useTabBarInset();

  const {user, refreshUser, logout} = useAuth();

  const [activeTab, setActiveTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [email, setEmail] = useState(user?.email || '');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Активные сессии — «мои устройства». До реестра сессий (ver. 6.49) выданный
  // токен нельзя было отозвать: на мобиле он живёт год, и потерянный телефон
  // означал год доступа.
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const handlePickAvatar = () => {
    launchImageLibrary({mediaType: 'photo', selectionLimit: 1, includeBase64: false}, async res => {
      if (res.didCancel || res.errorCode) return;
      const asset = res.assets?.[0];
      if (!asset) return;

      if (asset.fileSize > 5 * 1024 * 1024) {
        Alert.alert('Ошибка', 'Максимальный размер файла 5MB');
        return;
      }

      setUploadingAvatar(true);
      try {
        const uploadRes = await mediaApi.upload({
          uri: asset.uri,
          type: asset.type || 'image/jpeg',
          name: asset.fileName || 'avatar.jpg',
        });
        await authApi.updateProfile({avatar: uploadRes.data.path});
        await refreshUser();
        Alert.alert('Готово', 'Фото профиля обновлено');
      } catch {
        Alert.alert('Ошибка', 'Не удалось загрузить фото');
      } finally {
        setUploadingAvatar(false);
      }
    });
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await authApi.updateProfile({displayName: displayName.trim(), email: email.trim()});
      await refreshUser();
      Alert.alert('Готово', 'Профиль обновлён');
    } catch (e) {
      Alert.alert('Ошибка', e.response?.data?.error || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

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

  const loadSessions = useCallback(() => {
    setSessionsLoading(true);
    authApi.sessions()
      .then(({data}) => setSessions(data))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === 'security') loadSessions();
  }, [activeTab, loadSessions]);

  const handleRevokeSession = session => {
    Alert.alert(`Завершить сессию «${sessionTitle(session)}»?`, '', [
      {text: 'Отмена', style: 'cancel'},
      {
        text: 'Завершить',
        style: 'destructive',
        onPress: async () => {
          try {
            await authApi.revokeSession(session.id);
            setSessions(prev => prev.filter(s => s.id !== session.id));
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
            setSessions(prev => prev.filter(s => s.isCurrent));
          } catch {
            Alert.alert('Ошибка', 'Не удалось завершить сессии');
          }
        },
      },
    ]);
  };

  const handleLogout = () => {
    Alert.alert('Выйти из аккаунта?', '', [
      {text: 'Отмена', style: 'cancel'},
      {text: 'Выйти', style: 'destructive', onPress: logout},
    ]);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, {paddingBottom: tabInset + 16}]}
      keyboardShouldPersistTaps="handled">
      {/* Avatar */}
      <View style={styles.avatarSection}>
        <TouchableOpacity style={styles.avatarWrap} onPress={handlePickAvatar} disabled={uploadingAvatar}>
          {uploadingAvatar ? (
            <View style={styles.avatarCircle}>
              <LogoLoader width={46} />
            </View>
          ) : (
            <Avatar uri={user?.avatar} size={88} />
          )}
          <View style={styles.cameraBadge}>
            <Camera size={14} color="#FFF" />
          </View>
        </TouchableOpacity>
        <Text style={styles.avatarName}>{user?.displayName || user?.username}</Text>
        {/* Логин (@username) не показываем: под именем стоит роль, а два
            служебных подписи подряд шапку только загромождали */}
        {(user?.isAdmin || user?.roles?.length > 0 || user?.role) && (
          <Text style={styles.avatarRole}>
            {user?.isAdmin ? 'Администратор' : (
              user?.roles?.length > 0
                ? user.roles.map(r => r.name).join(', ')
                : user?.role?.name || 'Пользователь'
            )}
          </Text>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'profile' && styles.tabActive]}
          onPress={() => setActiveTab('profile')}>
          <User size={16} color={activeTab === 'profile' ? c.primary : c.textSecondary} style={{marginRight: 6}} />
          <Text style={[styles.tabText, activeTab === 'profile' && styles.tabTextActive]}>Профиль</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'security' && styles.tabActive]}
          onPress={() => setActiveTab('security')}>
          <Lock size={16} color={activeTab === 'security' ? c.primary : c.textSecondary} style={{marginRight: 6}} />
          <Text style={[styles.tabText, activeTab === 'security' && styles.tabTextActive]}>Безопасность</Text>
        </TouchableOpacity>
      </View>

      {/* Profile tab */}
      {activeTab === 'profile' && (
        <View style={styles.card}>
          <View style={styles.formGroup}>
            <Text style={styles.label}>Отображаемое имя</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Ваше имя"
              placeholderTextColor={c.textTertiary}
            />
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="email@example.com"
              placeholderTextColor={c.textTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
          <TouchableOpacity onPress={handleSaveProfile} disabled={saving} activeOpacity={0.85}>
            <LinearGradient
              colors={saving ? ['#93C5FD', '#93C5FD'] : [c.primary, c.secondary]}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={styles.saveBtn}>
              {saving
                ? <LogoLoader width={52} color="#FFFFFF" />
                : <>
                    <Save size={16} color="#FFF" style={{marginRight: 8}} />
                    <Text style={styles.saveBtnText}>Сохранить</Text>
                  </>
              }
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* Security tab */}
      {activeTab === 'security' && (
        <View style={styles.card}>
          <View style={styles.formGroup}>
            <Text style={styles.label}>Текущий пароль</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={styles.passwordInput}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry={!showCurrent}
                placeholderTextColor={c.textTertiary}
                placeholder="••••••"
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowCurrent(v => !v)}>
                {showCurrent ? <EyeOff size={18} color={c.textSecondary} /> : <Eye size={18} color={c.textSecondary} />}
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.label}>Новый пароль</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={styles.passwordInput}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry={!showNew}
                placeholderTextColor={c.textTertiary}
                placeholder="••••••"
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowNew(v => !v)}>
                {showNew ? <EyeOff size={18} color={c.textSecondary} /> : <Eye size={18} color={c.textSecondary} />}
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.label}>Подтвердите пароль</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={styles.passwordInput}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirm}
                placeholderTextColor={c.textTertiary}
                placeholder="••••••"
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirm(v => !v)}>
                {showConfirm ? <EyeOff size={18} color={c.textSecondary} /> : <Eye size={18} color={c.textSecondary} />}
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity onPress={handleChangePassword} disabled={saving} activeOpacity={0.85}>
            <LinearGradient
              colors={saving ? ['#93C5FD', '#93C5FD'] : [c.primary, c.secondary]}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={styles.saveBtn}>
              {saving
                ? <LogoLoader width={52} color="#FFFFFF" />
                : <>
                    <Lock size={16} color="#FFF" style={{marginRight: 8}} />
                    <Text style={styles.saveBtnText}>Изменить пароль</Text>
                  </>
              }
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* Активные сессии */}
      {activeTab === 'security' && (
        <View style={styles.card}>
          <View style={styles.sessionsHeader}>
            <Text style={styles.sessionsTitle}>Активные сессии</Text>
            {sessions.some(s => !s.isCurrent) && (
              <TouchableOpacity onPress={handleRevokeAll}>
                <Text style={styles.sessionsRevokeAll}>Выйти везде</Text>
              </TouchableOpacity>
            )}
          </View>

          {sessionsLoading ? (
            <LogoLoader width={64} />
          ) : sessions.length === 0 ? (
            <Text style={styles.sessionsEmpty}>
              Список пуст. Так бывает, если вход был выполнен до обновления —
              переавторизуйтесь, и сессия появится здесь.
            </Text>
          ) : (
            sessions.map(s => (
              <View key={s.id} style={styles.sessionRow}>
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
      )}

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <LogOut size={18} color={c.error} style={{marginRight: 10}} />
        <Text style={styles.logoutText}>Выйти из аккаунта</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgSecondary},
  content: {paddingBottom: 40},

  avatarSection: {alignItems: 'center', paddingVertical: 28, backgroundColor: c.bgPrimary},
  avatarWrap: {marginBottom: 12, position: 'relative'},
  avatarCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: c.bgPrimary,
  },
  avatarName: {fontSize: 18, fontFamily: font.semiBold, color: c.textPrimary},
  // Роль — обычной подписью под именем, тем же приглушённым стилем, каким
  // раньше был логин: бейдж перетягивал на себя внимание в шапке
  avatarRole: {fontSize: 13, fontFamily: font.regular, color: c.textSecondary, marginTop: 3},

  tabs: {
    flexDirection: 'row',
    backgroundColor: c.bgPrimary,
    borderBottomWidth: 1,
    borderBottomColor: c.borderLight,
    marginTop: 12,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive: {borderBottomColor: c.primary},
  tabText: {fontSize: 14, fontFamily: font.medium, color: c.textSecondary},
  tabTextActive: {color: c.primary, fontFamily: font.semiBold},

  card: {
    backgroundColor: c.bgPrimary, marginTop: 12,
    paddingHorizontal: 20, paddingVertical: 20,
  },
  formGroup: {marginBottom: 16},
  label: {fontSize: 13, fontFamily: font.medium, color: c.textSecondary, marginBottom: 7},
  input: {
    height: 48, backgroundColor: c.bgSecondary,
    borderWidth: 1.5, borderColor: c.border,
    borderRadius: radius.lg, paddingHorizontal: 14,
    fontSize: 15, fontFamily: font.regular, color: c.textPrimary,
  },
  passwordWrap: {
    flexDirection: 'row', alignItems: 'center',
    height: 48, backgroundColor: c.bgSecondary,
    borderWidth: 1.5, borderColor: c.border, borderRadius: radius.lg,
  },
  passwordInput: {flex: 1, paddingHorizontal: 14, fontSize: 15, fontFamily: font.regular, color: c.textPrimary},
  eyeBtn: {paddingHorizontal: 12},

  saveBtn: {
    height: 48, borderRadius: radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
  saveBtnText: {color: '#FFF', fontSize: 15, fontFamily: font.semiBold},

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 20, marginHorizontal: 20,
    backgroundColor: c.bgPrimary, borderRadius: radius.lg,
    paddingVertical: 15, borderWidth: 1, borderColor: '#FECACA',
  },
  logoutText: {fontSize: 15, fontFamily: font.medium, color: c.error},

  sessionsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14,
  },
  sessionsTitle: {fontSize: 15, fontFamily: font.semiBold, color: c.textPrimary},
  sessionsRevokeAll: {fontSize: 13, fontFamily: font.medium, color: c.error},
  sessionsEmpty: {fontSize: 13, fontFamily: font.regular, color: c.textTertiary, lineHeight: 19},
  sessionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.borderLight,
  },
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
