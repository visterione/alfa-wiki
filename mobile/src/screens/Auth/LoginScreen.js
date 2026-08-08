import React, {useState, useRef, useCallback, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
  Animated,
  Image,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {Eye, EyeOff, ShieldCheck, ArrowLeft} from 'lucide-react-native';
import * as Keychain from 'react-native-keychain';
import {auth as authApi, setCachedToken} from '../../services/api';
import SocketService from '../../services/socket';
import {useAuth} from '../../store/authStore';
import LogoLoader from '../../components/LogoLoader';
import {font} from '../../theme';

const KEYCHAIN_OPTIONS = {service: 'alfa-wiki'};

export default function LoginScreen() {
  const {loginComplete} = useAuth();
  const [step, setStep] = useState('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  // 2FA state
  const [twoFactorCode, setTwoFactorCode] = useState(['', '', '', '', '', '']);
  const [userId, setUserId] = useState(null);
  const [attemptsLeft, setAttemptsLeft] = useState(5);
  const [codeStatus, setCodeStatus] = useState('');
  const inputRefs = useRef([]);

  // Card animation
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslate = useRef(new Animated.Value(24)).current;
  // Shield float animation
  const shieldY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 480,
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslate, {
        toValue: 0,
        duration: 480,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Shield float loop on 2FA step
  useEffect(() => {
    if (step !== 'twoFactor') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shieldY, {toValue: -6, duration: 1500, useNativeDriver: true}),
        Animated.timing(shieldY, {toValue: 0, duration: 1500, useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [step]);

  // ── Step 1: credentials ──────────────────────────────────────────────────
  const handleCredentialsSubmit = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Ошибка', 'Введите логин и пароль');
      return;
    }
    setLoading(true);
    try {
      const {data} = await authApi.login(username.trim(), password);
      if (data.requiresTwoFactor) {
        setUserId(data.userId);
        setStep('twoFactor');
        Alert.alert('Код отправлен', data.message || 'Код отправлен на вашу почту');
      } else if (data.token && data.user) {
        await finishLogin(data.token, data.user);
      } else {
        Alert.alert('Ошибка', 'Неожиданный ответ сервера');
      }
    } catch (error) {
      Alert.alert('Ошибка входа', error.response?.data?.error || 'Проверьте логин и пароль');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  // ── Step 2: 2FA verification ─────────────────────────────────────────────
  const handleTwoFactorSubmit = useCallback(
    async code => {
      if (code.length !== 6) return;
      setLoading(true);
      try {
        const {data} = await authApi.verify2FA(userId, code);
        if (data.token && data.user) {
          await finishLogin(data.token, data.user);
        }
      } catch (error) {
        const errorData = error.response?.data;
        setCodeStatus('error');
        setTimeout(() => {
          setTwoFactorCode(['', '', '', '', '', '']);
          setCodeStatus('');
          inputRefs.current[0]?.focus();
        }, 600);
        if (errorData?.attemptsLeft !== undefined) {
          setAttemptsLeft(errorData.attemptsLeft);
          Alert.alert('Неверный код', `Осталось попыток: ${errorData.attemptsLeft}`);
        } else {
          Alert.alert('Ошибка', errorData?.error || 'Неверный код');
        }
        if (
          errorData?.error?.includes('expired') ||
          errorData?.error?.includes('Too many') ||
          errorData?.error?.includes('Слишком')
        ) {
          setTimeout(() => {
            setStep('credentials');
            setTwoFactorCode(['', '', '', '', '', '']);
            setUserId(null);
            setPassword('');
          }, 800);
        }
      } finally {
        if (isMounted.current) setLoading(false);
      }
    },
    [userId],
  );

  const handleResendCode = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      await authApi.resend2FA(userId);
      Alert.alert('Готово', 'Новый код отправлен на вашу почту');
      setTwoFactorCode(['', '', '', '', '', '']);
      setCodeStatus('');
      setAttemptsLeft(5);
      inputRefs.current[0]?.focus();
    } catch {
      Alert.alert('Ошибка', 'Не удалось отправить код');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setStep('credentials');
    setTwoFactorCode(['', '', '', '', '', '']);
    setCodeStatus('');
    setUserId(null);
    setAttemptsLeft(5);
  };

  const handleCodeChange = (index, value) => {
    if (loading || codeStatus) return;
    const digit = value.replace(/\D/g, '').slice(-1);
    const newCode = [...twoFactorCode];
    newCode[index] = digit;
    setTwoFactorCode(newCode);
    if (digit && index < 5) inputRefs.current[index + 1]?.focus();
    if (digit && index === 5) {
      const full = newCode.join('');
      if (full.length === 6) handleTwoFactorSubmit(full);
    }
    if (digit && index < 5) {
      const full = newCode.join('');
      if (full.length === 6 && !full.includes('')) handleTwoFactorSubmit(full);
    }
  };

  const handleCodeKeyDown = (index, e) => {
    if (loading || codeStatus) return;
    if (e.nativeEvent.key === 'Backspace') {
      const newCode = [...twoFactorCode];
      if (twoFactorCode[index]) {
        newCode[index] = '';
        setTwoFactorCode(newCode);
      } else if (index > 0) {
        newCode[index - 1] = '';
        setTwoFactorCode(newCode);
        inputRefs.current[index - 1]?.focus();
      }
    }
  };

  const finishLogin = async (token, userData) => {
    await Keychain.setGenericPassword('token', token, KEYCHAIN_OPTIONS);
    // Cache token in memory so subsequent API calls skip Keychain reads
    setCachedToken(token);
    // Stop native-driver animations before unmounting to prevent native view crash
    cardOpacity.stopAnimation();
    cardTranslate.stopAnimation();
    shieldY.stopAnimation();
    loginComplete(userData);
    // Connect socket — pass token directly to avoid another Keychain read
    SocketService.connect(userData.id, token).catch(() => {});
  };

  return (
    <LinearGradient
      colors={['#0a3d62', '#1e3799', '#4a148c']}
      start={{x: 0, y: 0}}
      end={{x: 1, y: 1}}
      style={styles.bg}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">

          <Animated.View
            style={[
              styles.card,
              {opacity: cardOpacity, transform: [{translateY: cardTranslate}]},
            ]}>

            {step === 'credentials' ? (
              <>
                {/* Logo */}
                <View style={styles.logoWrap}>
                  <LinearGradient
                    colors={['#0a3d62', '#1e3799']}
                    start={{x: 0, y: 0}}
                    end={{x: 1, y: 1}}
                    style={styles.logoBg}>
                    <Image
                      source={require('../../../assets/images/logo.png')}
                      style={styles.logoIcon}
                      resizeMode="contain"
                    />
                  </LinearGradient>
                </View>

                <Text style={styles.title}>Альфа Вики</Text>
                <Text style={styles.subtitle}>Войдите с помощью Альфа ID</Text>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Логин</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Введите логин"
                    placeholderTextColor="#AEAEB2"
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Пароль</Text>
                  <View style={styles.passwordWrap}>
                    <TextInput
                      style={styles.passwordInput}
                      placeholder="Введите пароль"
                      placeholderTextColor="#AEAEB2"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      returnKeyType="done"
                      onSubmitEditing={handleCredentialsSubmit}
                    />
                    <TouchableOpacity
                      style={styles.eyeBtn}
                      onPress={() => setShowPassword(v => !v)}>
                      {showPassword
                        ? <EyeOff size={20} color="#86868B" />
                        : <Eye size={20} color="#86868B" />}
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={handleCredentialsSubmit}
                  disabled={loading}
                  activeOpacity={0.85}>
                  <LinearGradient
                    colors={loading ? ['#93C5FD', '#93C5FD'] : ['#007AFF', '#5856D6']}
                    start={{x: 0, y: 0}}
                    end={{x: 1, y: 0}}
                    style={styles.button}>
                    {loading
                      ? <LogoLoader width={52} color="#FFFFFF" />
                      : <Text style={styles.buttonText}>Войти</Text>}
                  </LinearGradient>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Animated.View style={[styles.shieldWrap, {transform: [{translateY: shieldY}]}]}>
                  <LinearGradient
                    colors={['#007AFF', '#5856D6']}
                    start={{x: 0, y: 0}}
                    end={{x: 1, y: 1}}
                    style={styles.shieldIcon}>
                    <ShieldCheck size={36} color="#FFFFFF" />
                  </LinearGradient>
                </Animated.View>

                <Text style={styles.title}>Двухфакторная аутентификация</Text>
                <Text style={styles.tfaHint}>
                  Введите 6-значный код, отправленный на вашу почту
                </Text>

                <View style={styles.codeRow}>
                  {twoFactorCode.map((digit, index) => (
                    <TextInput
                      key={index}
                      ref={el => (inputRefs.current[index] = el)}
                      style={[
                        styles.codeInput,
                        digit ? styles.codeInputFilled : null,
                        codeStatus === 'error' ? styles.codeInputError : null,
                      ]}
                      value={digit}
                      onChangeText={v => handleCodeChange(index, v)}
                      onKeyPress={e => handleCodeKeyDown(index, e)}
                      keyboardType="number-pad"
                      maxLength={1}
                      textAlign="center"
                      editable={!loading && !codeStatus}
                    />
                  ))}
                </View>

                {attemptsLeft < 5 && (
                  <Text style={styles.attemptsText}>
                    Осталось попыток: {attemptsLeft}
                  </Text>
                )}

                {loading && <LogoLoader width={64} color="#007AFF" style={styles.codeLoader} />}

                <TouchableOpacity
                  style={styles.resendBtn}
                  onPress={handleResendCode}
                  disabled={loading}>
                  <Text style={styles.resendText}>Отправить код повторно</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.backBtn}
                  onPress={handleBackToLogin}
                  disabled={loading}>
                  <ArrowLeft size={15} color="#86868B" style={{marginRight: 6}} />
                  <Text style={styles.backText}>Вернуться к входу</Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  // Кардиограмма — View фиксированной ширины, её надо центрировать явно
  codeLoader: {alignSelf: 'center', marginVertical: 12},
  bg: {flex: 1},
  kav: {flex: 1},
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 40,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 32,
    shadowOffset: {width: 0, height: 12},
    elevation: 16,
  },

  // Logo
  logoWrap: {alignItems: 'center', marginBottom: 16},
  // Скруглённый квадрат, как иконка приложения. Раньше здесь был прямоугольник:
  // размеры задавались через padding вокруг картинки 120×80, и контейнер
  // получался шире, чем выше.
  logoBg: {
    width: 92,
    height: 92,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoIcon: {
    width: 56,
    height: 56,
  },

  // Title
  title: {
    fontSize: 26,
    fontFamily: font.bold,
    color: '#1D1D1F',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#86868B',
    textAlign: 'center',
    marginBottom: 28,
    fontFamily: font.medium,
  },

  // Form
  formGroup: {marginBottom: 18},
  label: {
    fontSize: 14,
    fontFamily: font.medium,
    color: '#86868B',
    marginBottom: 8,
  },
  input: {
    height: 52,
    backgroundColor: '#F5F5F7',
    borderWidth: 1.5,
    borderColor: '#D2D2D7',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: font.regular,
    color: '#1D1D1F',
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    backgroundColor: '#F5F5F7',
    borderWidth: 1.5,
    borderColor: '#D2D2D7',
    borderRadius: 14,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: font.regular,
    color: '#1D1D1F',
  },
  eyeBtn: {paddingHorizontal: 14},

  // Button
  button: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonText: {color: '#FFFFFF', fontSize: 16, fontFamily: font.semiBold},

  // 2FA
  shieldWrap: {alignItems: 'center', marginBottom: 20},
  shieldIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tfaHint: {
    fontSize: 14,
    fontFamily: font.regular,
    color: '#86868B',
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 20,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  codeInput: {
    width: 46,
    height: 56,
    borderWidth: 2,
    borderColor: '#D2D2D7',
    borderRadius: 14,
    fontSize: 24,
    fontFamily: font.bold,
    color: '#1D1D1F',
    backgroundColor: '#F5F5F7',
  },
  codeInputFilled: {borderColor: '#007AFF', backgroundColor: '#E5F2FF'},
  codeInputError: {borderColor: '#FF3B30', backgroundColor: '#FFF2F1'},
  attemptsText: {
    textAlign: 'center',
    color: '#FF3B30',
    fontSize: 13,
    marginBottom: 12,
    fontFamily: font.medium,
  },
  resendBtn: {alignItems: 'center', paddingVertical: 14},
  resendText: {color: '#007AFF', fontSize: 15, fontFamily: font.medium},
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  backText: {color: '#86868B', fontSize: 14, fontFamily: font.regular},
});
