/**
 * Материалы для рассылки: постоянная ссылка на анкету и QR к ней.
 *
 * На телефоне этот экран нужнее, чем в вебе, а не наоборот: QR показывают
 * соискателю на собеседовании, и достать его с экрана телефона — единственный
 * способ сделать это, не распечатывая заранее. Поэтому QR тут во всю ширину, а
 * не иконкой рядом со ссылкой.
 *
 * Ссылка одна и постоянная: заявка появится, когда врач подтвердит адрес и
 * начнёт заполнять, — рассылка ничего не резервирует и не создаёт.
 */
import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
  Image,
} from 'react-native';
import {Share2, Send} from 'lucide-react-native';

import {onboarding as onboardingApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';

export default function MaterialsScreen() {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tabInset = useTabBarInset();

  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    onboardingApi.materials()
      .then(({data: res}) => setData(res))
      .catch(() => setData({error: true}));
  }, []);

  if (!data) return <LogoLoader />;
  if (data.error) {
    return <Text style={styles.empty}>Не удалось собрать материалы</Text>;
  }

  const share = () => {
    // Share, а не «скопировать»: буфера обмена в проекте нет (отдельная
    // библиотека ради одной кнопки), а системный лист умеет и скопировать, и
    // сразу отправить в тот мессенджер, где человек и переписывается с врачом
    Share.share({message: data.url}).catch(() => {});
  };

  const invite = async () => {
    setSending(true);
    try {
      await onboardingApi.invite({email: email.trim(), note: note.trim()});
      Alert.alert('Отправлено', `Приглашение ушло на ${email.trim()}`);
      setEmail('');
      setNote('');
    } catch (error) {
      Alert.alert('Не ушло', error.response?.data?.error || 'Проверьте адрес и повторите позже');
    } finally {
      setSending(false);
    }
  };

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, {paddingBottom: tabInset + 24}]}
      keyboardShouldPersistTaps="handled">
      {/* Адрес не настроен — QR ведёт в никуда, и печатать его рано.
          Предупреждение стоит над самим QR, а не под ним: под ним его прочтут
          уже после того, как покажут код соискателю. */}
      {!data.baseConfigured && (
        <View style={styles.warn}>
          <Text style={styles.warnText}>
            На сервере не задан PUBLIC_BASE_URL — ссылка собрана по умолчанию.
            Проверьте, что она открывается, прежде чем показывать QR.
          </Text>
        </View>
      )}

      <View style={styles.qrCard}>
        <Image source={{uri: data.qrPng}} style={styles.qr} resizeMode="contain" />
        <Text style={styles.url} selectable>{data.url}</Text>
        <TouchableOpacity style={styles.shareBtn} onPress={share} activeOpacity={0.8}>
          <Share2 size={16} color="#FFFFFF" />
          <Text style={styles.shareBtnText}>Поделиться ссылкой</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectTitle}>Отправить на почту</Text>
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="doctor@example.com"
          placeholderTextColor={c.textTertiary}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={[styles.input, styles.inputNote]}
          value={note}
          onChangeText={setNote}
          placeholder="Пара слов от себя (необязательно)"
          placeholderTextColor={c.textTertiary}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!emailOk || sending) && styles.sendBtnOff]}
          disabled={!emailOk || sending}
          onPress={invite}
          activeOpacity={0.8}>
          {sending ? (
            <LogoLoader width={48} color="#FFFFFF" />
          ) : (
            <>
              <Send size={15} color="#FFFFFF" />
              <Text style={styles.sendBtnText}>Отправить приглашение</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>
        Письмо не создаёт заявку: она появится, когда врач подтвердит адрес и
        начнёт заполнять анкету.
      </Text>
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 16},

  warn: {
    backgroundColor: `${c.warning}18`,
    borderWidth: 1, borderColor: `${c.warning}55`,
    borderRadius: radius.md, padding: 12, marginBottom: 14,
  },
  warnText: {fontFamily: font.regular, fontSize: 12.5, color: c.warning, lineHeight: 18},

  qrCard: {
    backgroundColor: c.bgPrimary, borderRadius: radius.lg,
    padding: 18, alignItems: 'center', gap: 14,
  },
  // QR всегда на белом, независимо от темы: сканеры читают тёмное на светлом,
  // и на тёмной подложке код просто не берётся
  qr: {width: '86%', aspectRatio: 1, backgroundColor: '#FFFFFF', borderRadius: radius.sm},
  url: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, textAlign: 'center'},
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    alignSelf: 'stretch',
    backgroundColor: c.primary, borderRadius: radius.md, paddingVertical: 12,
  },
  shareBtnText: {fontFamily: font.semiBold, fontSize: 14.5, color: '#FFFFFF'},

  sectTitle: {
    fontFamily: font.medium, fontSize: 12.5, color: c.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.4,
    marginTop: 22, marginBottom: 8, marginLeft: 4,
  },
  card: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, padding: 14, gap: 10},
  input: {
    backgroundColor: c.bgSecondary,
    borderWidth: 1.5, borderColor: c.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 11,
    fontFamily: font.regular, fontSize: 15, color: c.textPrimary,
  },
  inputNote: {minHeight: 76, textAlignVertical: 'top'},
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.primary, borderRadius: radius.md, paddingVertical: 12,
  },
  sendBtnOff: {opacity: 0.45},
  sendBtnText: {fontFamily: font.semiBold, fontSize: 14.5, color: '#FFFFFF'},

  hint: {
    fontFamily: font.regular, fontSize: 12.5, color: c.textTertiary,
    lineHeight: 17, marginTop: 10, marginHorizontal: 4,
  },
  empty: {
    fontFamily: font.regular, fontSize: 13, color: c.textTertiary,
    textAlign: 'center', marginTop: 40,
  },
});
