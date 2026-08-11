import React, {useState, useRef, useCallback, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
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
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import LogoLoader from '../../components/LogoLoader';
import {font} from '../../theme';

const KEYCHAIN_OPTIONS = {service: 'alfa-wiki'};
const CODE_LENGTH = 6;

export default function LoginScreen() {
  const {loginComplete} = useAuth();
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [step, setStep] = useState('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const isMounted = useRef(true);
  const passwordRef = useRef(null);
  useEffect(() => () => { isMounted.current = false; }, []);

  // 2FA state.
  //
  // Код — строка, а не массив из шести ячеек: ячейки рисуются сами по её длине,
  // а ввод целиком принимает одно поле. Так вставка из буфера и автозаполнение
  // работают сами собой (см. разметку ниже).
  const [code, setCode] = useState('');
  const [userId, setUserId] = useState(null);
  const [attemptsLeft, setAttemptsLeft] = useState(5);
  const [codeStatus, setCodeStatus] = useState('');
  const codeInputRef = useRef(null);

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
  }, [cardOpacity, cardTranslate]);

  // Shield float loop on 2FA step
  useEffect(() => {
    if (step !== 'twoFactor') return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shieldY, {toValue: -6, duration: 1500, useNativeDriver: true}),
        Animated.timing(shieldY, {toValue: 0, duration: 1500, useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [step, shieldY]);

  // Общий хвост обоих путей входа — с 2FA и без неё. Объявлен раньше них,
  // потому что оба его вызывают.
  const finishLogin = useCallback(
    async (token, userData) => {
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
    },
    [cardOpacity, cardTranslate, shieldY, loginComplete],
  );

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
    async value => {
      if (value.length !== CODE_LENGTH) return;
      setLoading(true);
      try {
        const {data} = await authApi.verify2FA(userId, value);
        if (data.token && data.user) {
          await finishLogin(data.token, data.user);
        }
      } catch (error) {
        const errorData = error.response?.data;
        setCodeStatus('error');
        setTimeout(() => {
          setCode('');
          setCodeStatus('');
          codeInputRef.current?.focus();
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
            setCode('');
            setUserId(null);
            setPassword('');
          }, 800);
        }
      } finally {
        if (isMounted.current) setLoading(false);
      }
    },
    [userId, finishLogin],
  );

  const handleResendCode = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      await authApi.resend2FA(userId);
      Alert.alert('Готово', 'Новый код отправлен на вашу почту');
      setCode('');
      setCodeStatus('');
      setAttemptsLeft(5);
      codeInputRef.current?.focus();
    } catch {
      Alert.alert('Ошибка', 'Не удалось отправить код');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setStep('credentials');
    setCode('');
    setCodeStatus('');
    setUserId(null);
    setAttemptsLeft(5);
  };

  /**
   * Единственный обработчик ввода кода — на всё сразу.
   *
   * Раньше ячеек было шесть, каждая со своим maxLength={1}, и вставка из буфера
   * приносила в первую ячейку одну цифру: iOS обрезает вставку по maxLength, а
   * остальные пять полей о ней не узнавали. Теперь поле одно, и печать, вставка,
   * автозаполнение и стирание приходят сюда одинаково — обычной сменой строки.
   */
  const handleCodeChange = value => {
    if (loading || codeStatus) return;
    const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH) handleTwoFactorSubmit(digits);
  };

  return (
    // Тот же градиент, что у экрана запуска и шапок внутри приложения. Прежде
    // здесь был свой набор из тёмно-синего, индиго и фиолетового — он не менялся
    // вместе с выбранным акцентом и выглядел темнее и «синее» всего остального.
    <LinearGradient
      colors={[c.headerGradientStart, c.headerGradientEnd]}
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
                    colors={[c.headerGradientStart, c.headerGradientEnd]}
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
                  {/* textContentType обязателен, а не для порядка: без него iOS
                      подставляет пароль из связки ключей мимо React, состояние
                      остаётся пустым, и первое подтверждение по FaceID выглядит
                      как «ничего не произошло» — заполнялось лишь со второго раза */}
                  <TextInput
                    style={styles.input}
                    placeholder="Введите логин"
                    placeholderTextColor={c.textTertiary}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="username"
                    autoComplete="username"
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    submitBehavior="submit"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Пароль</Text>
                  <View style={styles.passwordWrap}>
                    <TextInput
                      ref={passwordRef}
                      style={styles.passwordInput}
                      placeholder="Введите пароль"
                      placeholderTextColor={c.textTertiary}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      textContentType="password"
                      autoComplete="password"
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={handleCredentialsSubmit}
                    />
                    <TouchableOpacity
                      style={styles.eyeBtn}
                      onPress={() => setShowPassword(v => !v)}>
                      {showPassword
                        ? <EyeOff size={20} color={c.textTertiary} />
                        : <Eye size={20} color={c.textTertiary} />}
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={handleCredentialsSubmit}
                  disabled={loading}
                  activeOpacity={0.85}>
                  <LinearGradient
                    colors={[c.primaryHover, c.primary]}
                    start={{x: 0, y: 0}}
                    end={{x: 1, y: 0}}
                    style={[styles.button, loading && styles.buttonLoading]}>
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
                    colors={[c.primaryHover, c.primary]}
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

                {/* Ячейки — обычные View, поверх них лежит одно прозрачное поле
                    во всю строку. Отсюда и вставка: долгое нажатие в любом месте
                    строки вызывает «Вставить», и код приходит целиком. Оно же
                    ловит автозаполнение кода из почты (textContentType). */}
                <Pressable
                  style={styles.codeRow}
                  onPress={() => codeInputRef.current?.focus()}>
                  {Array.from({length: CODE_LENGTH}, (_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.codeCell,
                        i < code.length && styles.codeCellFilled,
                        i === code.length && styles.codeCellActive,
                        codeStatus === 'error' && styles.codeCellError,
                      ]}>
                      <Text style={styles.codeDigit}>{code[i] ?? ''}</Text>
                    </View>
                  ))}
                  <TextInput
                    ref={codeInputRef}
                    style={styles.codeInput}
                    value={code}
                    onChangeText={handleCodeChange}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    maxLength={CODE_LENGTH}
                    autoFocus
                    caretHidden
                    editable={!loading && !codeStatus}
                  />
                </Pressable>

                {attemptsLeft < 5 && (
                  <Text style={styles.attemptsText}>
                    Осталось попыток: {attemptsLeft}
                  </Text>
                )}

                {loading && <LogoLoader width={64} color={c.primary} style={styles.codeLoader} />}

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
                  <ArrowLeft size={15} color={c.textTertiary} style={styles.backIcon} />
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

/**
 * Оформление берётся из палитры приложения.
 *
 * Раньше весь экран был набран статичными цветами: белая карточка, серые
 * подписи, синие кнопки. В тёмной теме он оставался светлым, а при смене
 * акцента — синим, тогда как всё остальное приложение перекрашивалось.
 */
const makeStyles = c => StyleSheet.create({
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
    backgroundColor: c.bgPrimary,
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
    color: c.textPrimary,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: c.textSecondary,
    textAlign: 'center',
    marginBottom: 28,
    fontFamily: font.medium,
  },

  // Form
  formGroup: {marginBottom: 18},
  label: {
    fontSize: 14,
    fontFamily: font.medium,
    color: c.textSecondary,
    marginBottom: 8,
  },
  input: {
    height: 52,
    backgroundColor: c.bgSecondary,
    borderWidth: 1.5,
    borderColor: c.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: font.regular,
    color: c.textPrimary,
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    backgroundColor: c.bgSecondary,
    borderWidth: 1.5,
    borderColor: c.border,
    borderRadius: 14,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: font.regular,
    color: c.textPrimary,
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
  buttonLoading: {opacity: 0.7},
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
    color: c.textSecondary,
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
  codeCell: {
    width: 46,
    height: 56,
    borderWidth: 2,
    borderColor: c.border,
    borderRadius: 14,
    backgroundColor: c.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeCellFilled: {borderColor: c.primary, backgroundColor: c.primaryLight},
  // Куда попадёт следующая цифра. Каретки в ячейках нет — поле ввода прозрачное,
  // и подсветкой рамки заменяем ей мигающий курсор
  codeCellActive: {borderColor: c.primary},
  // Отдельного фона под ошибку в палитре нет, и заводить его ради одной рамки
  // незачем: красный контур поверх обычного фона читается достаточно
  codeCellError: {borderColor: c.error, backgroundColor: c.bgSecondary},
  codeDigit: {
    fontSize: 24,
    fontFamily: font.bold,
    color: c.textPrimary,
  },
  // Прозрачное поле поверх всей строки ячеек: и цель для нажатия, и приёмник
  // вставки с автозаполнением
  codeInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
  },
  attemptsText: {
    textAlign: 'center',
    color: c.error,
    fontSize: 13,
    marginBottom: 12,
    fontFamily: font.medium,
  },
  resendBtn: {alignItems: 'center', paddingVertical: 14},
  resendText: {color: c.primary, fontSize: 15, fontFamily: font.medium},
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  backIcon: {marginRight: 6},
  backText: {color: c.textSecondary, fontSize: 14, fontFamily: font.regular},
});
