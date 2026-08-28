/**
 * Личные данные: фото, имя, почта.
 *
 * Половина бывшего «Профиля» (ver. 7.55). Вторая половина — пароль и
 * устройства — уехала в «Безопасность»: это разные занятия, и попадали они на
 * один экран только потому, что вкладка называлась «Профиль».
 *
 * Аватарка редактируется тапом по себе, а не отдельной строкой «сменить фото»:
 * значок камеры в углу и есть та кнопка, которую здесь ищут.
 */
import React, {useState} from 'react';
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
import {Camera, Save} from 'lucide-react-native';

import {useAuth} from '../../store/authStore';
import {auth as authApi, media as mediaApi} from '../../services/api';
import Avatar from '../../components/Avatar';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {makeSettingsStyles} from './parts';

export default function AccountScreen() {
  const c = useTheme();
  const base = useThemedStyles(makeSettingsStyles);
  const styles = useThemedStyles(makeStyles);
  const {user, refreshUser} = useAuth();

  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [email, setEmail] = useState(user?.email || '');

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

  const handleSave = async () => {
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

  return (
    <ScrollView
      style={base.container}
      contentContainerStyle={base.content}
      keyboardShouldPersistTaps="handled">
      <View style={styles.avatarSection}>
        <TouchableOpacity
          style={styles.avatarWrap}
          onPress={handlePickAvatar}
          disabled={uploadingAvatar}>
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
        <Text style={styles.avatarHint}>Нажмите, чтобы сменить фото</Text>
      </View>

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
        <TouchableOpacity onPress={handleSave} disabled={saving} activeOpacity={0.85}>
          <LinearGradient
            colors={saving ? [c.textTertiary, c.textTertiary] : [c.primary, c.secondary]}
            start={{x: 0, y: 0}}
            end={{x: 1, y: 0}}
            style={styles.saveBtn}>
            {saving ? (
              <LogoLoader width={52} color="#FFFFFF" />
            ) : (
              <>
                <Save size={16} color="#FFF" style={styles.saveIcon} />
                <Text style={styles.saveBtnText}>Сохранить</Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Логин не редактируется: по нему человек входит и его же видят коллеги
          в упоминаниях — смена сломала бы и то и другое */}
      <Text style={base.sectionFooter}>
        Логин {user?.username ? `«${user.username}» ` : ''}меняет администратор.
      </Text>
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  avatarSection: {alignItems: 'center', paddingBottom: 22},
  avatarWrap: {position: 'relative'},
  avatarCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: c.bgSecondary,
  },
  avatarHint: {
    marginTop: 10,
    fontSize: 12.5, fontFamily: font.regular, color: c.textTertiary,
  },

  card: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    paddingHorizontal: 16, paddingVertical: 18,
  },
  formGroup: {marginBottom: 16},
  label: {fontSize: 13, fontFamily: font.medium, color: c.textSecondary, marginBottom: 7},
  input: {
    height: 48, backgroundColor: c.bgSecondary,
    borderWidth: 1.5, borderColor: c.border,
    borderRadius: radius.lg, paddingHorizontal: 14,
    fontSize: 15, fontFamily: font.regular, color: c.textPrimary,
  },
  saveBtn: {
    height: 48, borderRadius: radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
  saveIcon: {marginRight: 8},
  saveBtnText: {color: '#FFF', fontSize: 15, fontFamily: font.semiBold},
});
