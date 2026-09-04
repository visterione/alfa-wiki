/**
 * Карточка сотрудника на правку — и заведение, и изменение (ver. 7.77).
 *
 * ── Почему одна форма на два дела ────────────────────────────────────────────
 *
 * В вебе это одно модальное окно, и разница между «новый» и «этот» там ровно в
 * трёх местах: логин подсказывается, пароль генерируется, почта обязательна.
 * Развести их на два экрана значило бы держать два списка полей и однажды
 * добавить поле только в один.
 *
 * ── Что здесь есть ───────────────────────────────────────────────────────────
 *
 * Всё, что в вебе: портрет, поиск сотрудника в «Реновации», логин и пароль,
 * почта и двухфакторный вход, роли и медцентры, метка в чатах, личные данные,
 * дерево прав целиком и корзина. Первый заход был урезанным — только заведение,
 * — и оказался половиной работы: человека заводят и тут же выдают ему модуль.
 *
 * ── Права модулей ────────────────────────────────────────────────────────────
 *
 * Зарплатные и складские права лежат своими таблицами и читаются отдельными
 * запросами, а сервер отдаёт их только суперадминистратору. Поэтому они
 * грузятся и сохраняются только когда ими распоряжаются: у того, кому открыт
 * лишь раздел «Пользователи», этих веток нет вовсе.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {
  View, Text, Image, ScrollView, Pressable, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {launchImageLibrary} from 'react-native-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import {Camera, Check, RefreshCw, Search, Trash2, X} from 'lucide-react-native';

import {users as usersApi} from '../../services/api';
import Avatar from '../../components/Avatar';
import LogoLoader from '../../components/LogoLoader';
import {useAuth} from '../../store/authStore';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {
  Card, SectionTitle, TextField, SelectRow, ToggleRow, PickerModal, PickerRow, makeAdminStyles,
} from './parts';
import PermissionsTree from './PermissionsTree';
import BadgeField from './BadgeField';
import {
  uniqueUsername, generatePassword, misBirthDate, misGender, dateText,
  SALARY_PERM_DEFAULT, WAREHOUSE_PERM_DEFAULT,
} from './usersMeta';

const GENDERS = [
  {value: '', label: 'Не указан'},
  {value: 'male', label: 'Мужской'},
  {value: 'female', label: 'Женский'},
];

const emptyForm = () => ({
  displayName: '',
  username: '',
  // Пароль готов до того, как открылась форма: придумывать его человеку не
  // нужно, а пустое поле выглядело бы как ещё одна обязанность
  password: generatePassword(),
  email: '',
  phone: '',
  position: '',
  specialty: '',
  bio: '',
  avatar: '',
  misUserId: '',
  gender: '',
  birthDate: '',
  chatBadgeOverride: null,
  roleIds: [],
  medCenterIds: [],
  isActive: true,
  // По умолчанию включён, как и в вебе: почта у нового сотрудника есть почти
  // всегда, а вход без второго шага — решение, которое принимают осознанно
  twoFactorEnabled: true,
  isAdmin: false,
  adminAccess: {},
  canEditServices: false,
  canEditDoctorCards: false,
  canEditAnalyses: false,
  canManagePromotions: false,
  canAccessSalary: false,
  canAccessStatistics: false,
  canAccessTopSalary: false,
  salaryPerm: {...SALARY_PERM_DEFAULT},
  warehousePerm: {...WAREHOUSE_PERM_DEFAULT},
});

const fromUser = user => ({
  ...emptyForm(),
  // Пароль при правке пустой: непустое поле означало бы «сменить», а сменить
  // его молча, просто открыв карточку, нельзя
  password: '',
  displayName: user.displayName || '',
  username: user.username || '',
  email: user.email || '',
  phone: user.phone || '',
  position: user.position || '',
  specialty: user.specialty || '',
  bio: user.bio || '',
  avatar: user.avatar || '',
  misUserId: user.misUserId || '',
  gender: user.gender || '',
  birthDate: user.birthDate ? String(user.birthDate).slice(0, 10) : '',
  chatBadgeOverride: user.chatBadgeOverride || null,
  roleIds: (user.roles || []).map(r => r.id),
  medCenterIds: (user.medCenters || []).map(mc => mc.id),
  isActive: user.isActive !== false,
  twoFactorEnabled: Boolean(user.twoFactorEnabled),
  isAdmin: Boolean(user.isAdmin),
  adminAccess: user.adminAccess || {},
  canEditServices: Boolean(user.canEditServices),
  canEditDoctorCards: Boolean(user.canEditDoctorCards),
  canEditAnalyses: Boolean(user.canEditAnalyses),
  canManagePromotions: Boolean(user.canManagePromotions),
  canAccessSalary: Boolean(user.canAccessSalary),
  canAccessStatistics: Boolean(user.canAccessStatistics),
  canAccessTopSalary: Boolean(user.canAccessTopSalary),
});

export default function AdminUserFormScreen({route, navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeAdminStyles);
  const own = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const {user: me} = useAuth();
  const {userId} = route.params || {};
  const isNew = !userId;
  // Зарплату и склад раздаёт только суперадминистратор — так решает сервер
  const canGrantModules = Boolean(me?.isAdmin);

  const [ready, setReady] = useState(false);
  const [roles, setRoles] = useState([]);
  const [medCenters, setMedCenters] = useState([]);
  const [whCatalogue, setWhCatalogue] = useState(null);
  const [taken, setTaken] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [picker, setPicker] = useState(null);
  const [mis, setMis] = useState(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Именно useEffect, а не useFocusEffect: форма держит несохранённые правки, и
  // перечитывание при возвращении фокуса затёрло бы их
  useEffect(() => {
    let alive = true;
    navigation.setOptions({title: isNew ? 'Новый сотрудник' : 'Правка карточки'});

    // Всё грузится врозь и падает врозь: без каталога склада не рисуется одна
    // ветка прав, без списка занятых логинов не подберётся суффикс — но форма
    // остаётся рабочей, и валить её целиком из-за одного отказа незачем
    Promise.allSettled([
      usersApi.roles(),
      usersApi.medCenters(),
      usersApi.list(),
      userId ? usersApi.get(userId) : Promise.resolve(null),
      canGrantModules ? usersApi.warehouseCatalogue() : Promise.resolve(null),
      canGrantModules && userId ? usersApi.salaryPerm(userId) : Promise.resolve(null),
      canGrantModules && userId ? usersApi.warehousePerm(userId) : Promise.resolve(null),
    ]).then(([roleRes, mcRes, listRes, userRes, whRes, salaryRes, whPermRes]) => {
      if (!alive) return;
      if (roleRes.status === 'fulfilled') setRoles(roleRes.value.data || []);
      if (mcRes.status === 'fulfilled') setMedCenters(mcRes.value.data || []);
      if (listRes.status === 'fulfilled') {
        setTaken((listRes.value.data || [])
          .filter(u => u.id !== userId)
          .map(u => u.username));
      }
      if (whRes.status === 'fulfilled' && whRes.value) setWhCatalogue(whRes.value.data);

      if (userRes.status === 'fulfilled' && userRes.value) {
        const next = fromUser(userRes.value.data);
        if (salaryRes.status === 'fulfilled' && salaryRes.value) {
          next.salaryPerm = {...SALARY_PERM_DEFAULT, ...salaryRes.value.data};
        }
        if (whPermRes.status === 'fulfilled' && whPermRes.value) {
          next.warehousePerm = {
            perms: whPermRes.value.data?.perms || {},
            medCenterIds: whPermRes.value.data?.medCenterIds || [],
          };
        }
        setForm(next);
        navigation.setOptions({
          title: userRes.value.data.displayName || userRes.value.data.username,
        });
      } else if (userId) {
        Alert.alert('Карточка не открылась', 'Попробуйте ещё раз.');
        navigation.goBack();
        return;
      }
      setReady(true);
    });
    return () => { alive = false; };
    // Один раз на открытие: справочники и карточка за время правки не меняются
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key, value) => setForm(prev => ({...prev, [key]: value}));

  // Логин пересчитывается по имени только у нового сотрудника: у заведённого он
  // менялся бы под пальцем при правке фамилии, а логин — это то, чем человек
  // входит, и меняют его осознанно
  const setDisplayName = (displayName) => setForm(prev => ({
    ...prev,
    displayName,
    ...(isNew ? {username: uniqueUsername(displayName, taken)} : null),
  }));

  const chosenRoles = useMemo(
    () => roles.filter(role => form.roleIds.includes(role.id)),
    [roles, form.roleIds],
  );
  const chosenMedCenters = useMemo(
    () => medCenters.filter(mc => form.medCenterIds.includes(mc.id)),
    [medCenters, form.medCenterIds],
  );

  const pickAvatar = () => {
    launchImageLibrary({mediaType: 'photo', selectionLimit: 1}, async (res) => {
      if (res.didCancel || res.errorCode) return;
      const asset = res.assets?.[0];
      if (!asset) return;
      if (asset.fileSize > 5 * 1024 * 1024) {
        Alert.alert('Не загружено', 'Размер фотографии — до 5 МБ.');
        return;
      }
      setUploading(true);
      try {
        const {data} = await usersApi.uploadAvatar({
          uri: asset.uri,
          type: asset.type || 'image/jpeg',
          name: asset.fileName || 'avatar.jpg',
        });
        set('avatar', data.avatarPath);
      } catch {
        Alert.alert('Не загружено', 'Фотография не ушла на сервер.');
      } finally {
        setUploading(false);
      }
    });
  };

  const searchMis = async () => {
    const query = form.displayName.trim();
    setMis({query, loading: true, results: []});
    try {
      const {data} = await usersApi.misSearch(query);
      setMis({query, loading: false, results: data || []});
    } catch (e) {
      setMis(null);
      Alert.alert('МИС не ответил', e?.response?.data?.error || 'Попробуйте ещё раз.');
    }
  };

  const importMis = async (employee) => {
    setMis(prev => ({...prev, loading: true}));
    let avatar = '';
    if (employee.avatar_small) {
      // Фотография качается на наш сервер и уже оттуда попадает в карточку. Не
      // скачалась — заводим без неё: из-за портрета заведение не останавливают.
      try {
        const {data} = await usersApi.misAvatar(employee.avatar_small);
        avatar = data.avatarPath;
      } catch { /* фото подождёт */ }
    }
    const displayName = employee.name || '';
    setForm(prev => ({
      ...prev,
      displayName,
      username: isNew ? uniqueUsername(displayName, taken) : prev.username,
      misUserId: String(employee.id || ''),
      email: employee.email || prev.email,
      phone: employee.phone || prev.phone,
      specialty: [].concat(employee.profession_titles || []).filter(Boolean).join(', ')
        || prev.specialty,
      gender: misGender(employee.gender) || prev.gender,
      birthDate: misBirthDate(employee.birth_date) || prev.birthDate,
      avatar: avatar || prev.avatar,
    }));
    setMis(null);
  };

  const remove = () => Alert.alert(
    'В корзину?',
    `${form.displayName || form.username} больше не сможет войти. Восстановить можно из корзины.`,
    [
      {text: 'Отмена', style: 'cancel'},
      {
        text: 'В корзину',
        style: 'destructive',
        onPress: async () => {
          try {
            await usersApi.remove(userId);
            // Возвращаемся сразу в список: карточка удалённого позади формы
            // показывала бы человека, которого уже нет
            navigation.navigate('AdminUsers');
          } catch (e) {
            Alert.alert('Не удалось', e?.response?.data?.error || 'Попробуйте ещё раз.');
          }
        },
      },
    ],
  );

  const save = async () => {
    if (!form.displayName.trim() && isNew) {
      return Alert.alert('Не сохранено', 'Укажите имя сотрудника.');
    }
    if (form.username.trim().length < 3) {
      return Alert.alert('Не сохранено', 'Логин должен быть не короче трёх знаков.');
    }
    if (isNew && form.password.length < 6) {
      return Alert.alert('Не сохранено', 'Пароль должен быть не короче шести знаков.');
    }
    if (!isNew && form.password && form.password.length < 6) {
      return Alert.alert('Не сохранено', 'Новый пароль должен быть не короче шести знаков.');
    }
    // Почта при двухфакторном входе обязательна не «для порядка»: код входа
    // приходит именно на неё, и без почты человек не войдёт вовсе
    if (form.twoFactorEnabled && !form.email.trim()) {
      return Alert.alert('Не сохранено', 'При двухфакторном входе нужна почта — на неё приходит код.');
    }

    const payload = {
      username: form.username.trim(),
      displayName: form.displayName.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      position: form.position.trim() || null,
      specialty: form.specialty.trim() || null,
      bio: form.bio.trim() || null,
      avatar: form.avatar || null,
      misUserId: form.misUserId.trim() || null,
      gender: form.gender || null,
      birthDate: form.birthDate || null,
      chatBadgeOverride: form.chatBadgeOverride,
      roleIds: form.roleIds,
      medCenterIds: form.medCenterIds,
      isActive: form.isActive,
      twoFactorEnabled: form.twoFactorEnabled,
      isAdmin: form.isAdmin,
      adminAccess: form.adminAccess,
      canEditServices: form.canEditServices,
      canEditDoctorCards: form.canEditDoctorCards,
      canEditAnalyses: form.canEditAnalyses,
      canManagePromotions: form.canManagePromotions,
      canAccessSalary: form.canAccessSalary,
      canAccessStatistics: form.canAccessStatistics,
      canAccessTopSalary: form.canAccessTopSalary,
    };
    if (form.password) payload.password = form.password;

    setSaving(true);
    try {
      const {data} = isNew
        ? await usersApi.create(payload)
        : await usersApi.update(userId, payload);
      const savedId = data?.id || userId;

      // Права модулей — отдельными таблицами и отдельными запросами. Их отказ
      // не отменяет уже сохранённую карточку, поэтому и ошибка своя: человек
      // должен знать, что сохранилось не всё.
      if (canGrantModules && savedId) {
        try {
          await usersApi.saveSalaryPerm(savedId, form.salaryPerm);
          await usersApi.saveWarehousePerm(savedId, form.warehousePerm);
        } catch {
          Alert.alert('Сохранено не всё', 'Карточка записана, а права зарплаты и склада — нет.');
        }
      }

      if (isNew) {
        Alert.alert(
          'Сотрудник заведён',
          form.email.trim()
            ? `Логин и пароль ушли письмом на ${form.email.trim()}.`
            : `Логин ${form.username.trim()}, пароль ${form.password}. Почты нет — передайте их лично.`,
          [{text: 'Понятно', onPress: () => navigation.goBack()}],
        );
      } else {
        navigation.goBack();
      }
      return undefined;
    } catch (e) {
      Alert.alert('Не сохранено', e?.response?.data?.error || 'Попробуйте ещё раз.');
      return setSaving(false);
    }
  };

  if (!ready) return <LogoLoader />;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 96}]}
        keyboardShouldPersistTaps="handled">
        <SectionTitle>Кто это</SectionTitle>
        <Card>
          <View style={own.avatarRow}>
            <Pressable onPress={pickAvatar} disabled={uploading}>
              {uploading
                ? <View style={own.avatarBusy}><ActivityIndicator color={c.primary} /></View>
                : <Avatar uri={form.avatar} size={72} />}
              <View style={own.avatarBadge}>
                <Camera size={13} color="#FFFFFF" />
              </View>
            </Pressable>
            <View style={own.avatarBody}>
              <TextField
                label="Имя, фамилия, отчество"
                style={own.nameField}
                value={form.displayName}
                onChangeText={setDisplayName}
                placeholder="Иванова Мария Петровна"
                autoFocus={isNew}
              />
              {Boolean(form.avatar) && (
                <Pressable style={own.avatarDrop} onPress={() => set('avatar', '')} hitSlop={8}>
                  <X size={12} color={c.error} />
                  <Text style={own.avatarDropText}>Убрать фото</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* Поиск в «Реновации» доступен и при правке: сотрудника, заведённого
              руками, часто нужно связать с МИС задним числом — без misUserId его
              не узнают ни расписание, ни зарплата, ни карточка врача */}
          <Pressable style={styles.field} onPress={searchMis}>
            <Text style={styles.label}>«Реновация»</Text>
            <View style={styles.fieldRow}>
              <Search size={15} color={c.primary} />
              <Text style={[styles.value, own.action]} numberOfLines={1}>
                {form.misUserId
                  ? `Связан с МИС, ID ${form.misUserId} — искать заново`
                  : 'Найти сотрудника и заполнить карточку'}
              </Text>
            </View>
          </Pressable>
        </Card>

        <SectionTitle>Вход</SectionTitle>
        <Card>
          <TextField
            label="Логин"
            value={form.username}
            onChangeText={value => set('username', value)}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="ivanova_m_p"
          />
          <TextField
            label={isNew ? 'Пароль на первый вход' : 'Новый пароль'}
            value={form.password}
            onChangeText={value => set('password', value)}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={isNew ? '' : 'Оставьте пустым, чтобы не менять'}
            right={(
              <Pressable
                onPress={() => set('password', generatePassword())}
                hitSlop={10}
                accessibilityLabel="Сгенерировать пароль">
                <RefreshCw size={16} color={c.primary} />
              </Pressable>
            )}
          />
          <TextField
            label="Почта"
            value={form.email}
            onChangeText={value => set('email', value)}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="на неё уйдут логин и пароль"
          />
          <ToggleRow
            label="Двухфакторный вход"
            value={form.twoFactorEnabled}
            onChange={value => set('twoFactorEnabled', value)}
          />
          <ToggleRow
            label="Разрешён вход"
            value={form.isActive}
            onChange={value => set('isActive', value)}
          />
        </Card>

        <SectionTitle>Где и кем работает</SectionTitle>
        <Card>
          <SelectRow
            label="Роли"
            value={chosenRoles.map(r => r.name).join(', ')}
            empty="Не выбраны"
            onPress={() => setPicker('roles')}
          />
          <SelectRow
            label="Медцентры"
            value={chosenMedCenters.map(mc => mc.name).join(', ')}
            empty="Не выбраны"
            onPress={() => setPicker('medCenters')}
          />
          <TextField
            label="Должность"
            value={form.position}
            onChangeText={value => set('position', value)}
            placeholder="Администратор, менеджер…"
          />
          <TextField
            label="Специальность"
            value={form.specialty}
            onChangeText={value => set('specialty', value)}
            placeholder="Терапевт, хирург…"
          />
          <TextField
            label="Телефон"
            value={form.phone}
            onChangeText={value => set('phone', value)}
            keyboardType="phone-pad"
          />
          <SelectRow
            label="Пол"
            value={form.gender ? GENDERS.find(g => g.value === form.gender)?.label : ''}
            empty="Не указан"
            onPress={() => setPicker('gender')}
          />
          <SelectRow
            label="Дата рождения"
            value={form.birthDate ? dateText(form.birthDate) : ''}
            empty="Не указана"
            onPress={() => setDateOpen(true)}
          />
          <TextField
            label="ID сотрудника в МИС"
            value={form.misUserId}
            onChangeText={value => set('misUserId', value.trim())}
            autoCapitalize="none"
            placeholder="Заполняется при выборе сотрудника «Реновации»"
          />
          <TextField
            label="О себе"
            value={form.bio}
            onChangeText={value => set('bio', value)}
            multiline
          />
        </Card>

        <BadgeField
          value={form.chatBadgeOverride}
          onChange={next => set('chatBadgeOverride', next)}
          displayName={form.displayName || form.username}
          roles={chosenRoles}
          medCenters={chosenMedCenters}
        />

        <PermissionsTree
          form={form}
          setForm={setForm}
          canGrantAdmin={Boolean(me?.isAdmin)}
          canGrantModules={canGrantModules}
          whCatalogue={whCatalogue}
        />

        {/* Себя в корзину не отправить — это отбивает и сервер, но узнавать об
            этом от него после нажатия было бы поздно */}
        {!isNew && userId !== me?.id && (
          <Pressable style={own.danger} onPress={remove}>
            <Trash2 size={16} color={c.error} />
            <Text style={styles.dangerText}>В корзину</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={[styles.bar, {paddingBottom: insets.bottom + 12}]}>
        <Pressable
          style={[styles.button, saving && styles.buttonOff]}
          disabled={saving}
          onPress={save}>
          {saving
            ? <ActivityIndicator size="small" color="#FFFFFF" />
            : <Check size={17} color="#FFFFFF" />}
          <Text style={styles.buttonText}>
            {saving ? 'Сохраняю…' : (isNew ? 'Завести' : 'Сохранить')}
          </Text>
        </Pressable>
      </View>

      <PickerModal
        visible={picker === 'roles'}
        title="Роли"
        onClose={() => setPicker(null)}>
        {roles.map(role => (
          <PickerRow
            key={role.id}
            label={role.name}
            sub={role.description}
            on={form.roleIds.includes(role.id)}
            onPress={() => set(
              'roleIds',
              form.roleIds.includes(role.id)
                ? form.roleIds.filter(id => id !== role.id)
                : [...form.roleIds, role.id],
            )}
          />
        ))}
        {!roles.length && <Text style={styles.pickerEmpty}>Справочник ролей пуст</Text>}
      </PickerModal>

      <PickerModal
        visible={picker === 'medCenters'}
        title="Медцентры"
        onClose={() => setPicker(null)}>
        {medCenters.map(mc => (
          <PickerRow
            key={mc.id}
            label={mc.name}
            on={form.medCenterIds.includes(mc.id)}
            left={mc.color ? <View style={[own.dot, {backgroundColor: mc.color}]} /> : null}
            onPress={() => set(
              'medCenterIds',
              form.medCenterIds.includes(mc.id)
                ? form.medCenterIds.filter(id => id !== mc.id)
                : [...form.medCenterIds, mc.id],
            )}
          />
        ))}
        {!medCenters.length && <Text style={styles.pickerEmpty}>Справочник медцентров пуст</Text>}
      </PickerModal>

      <PickerModal
        visible={picker === 'gender'}
        title="Пол"
        footer={null}
        onClose={() => setPicker(null)}>
        {GENDERS.map(option => (
          <PickerRow
            key={option.value || 'none'}
            label={option.label}
            on={form.gender === option.value}
            onPress={() => { set('gender', option.value); setPicker(null); }}
          />
        ))}
      </PickerModal>

      {/* Сотрудников «Реновации» показываем списком с портретом: тёзок в МИС
          хватает, и различают их как раз по фотографии и специальности */}
      <PickerModal
        visible={Boolean(mis)}
        title={mis?.query ? `«Реновация»: ${mis.query}` : 'Сотрудники «Реновации»'}
        footer={null}
        onClose={() => setMis(null)}>
        {mis?.loading ? (
          <View style={own.misLoading}><LogoLoader width={96} /></View>
        ) : (mis?.results || []).map(employee => (
          <PickerRow
            key={String(employee.id)}
            label={employee.name}
            sub={[
              [].concat(employee.profession_titles || []).filter(Boolean).join(', '),
              [].concat(employee.clinic_titles || []).filter(Boolean).join(', '),
            ].filter(Boolean).join(' · ') || 'Без специальности'}
            left={<MisPortrait own={own} uri={employee.avatar_small} />}
            onPress={() => importMis(employee)}
          />
        ))}
        {Boolean(mis) && !mis.loading && !mis.results.length && (
          <Text style={styles.pickerEmpty}>
            {mis.query
              ? 'В МИС такого сотрудника нет — проверьте написание фамилии'
              : 'Введите фамилию в поле имени и повторите поиск'}
          </Text>
        )}
      </PickerModal>

      {/* Системный выбор даты: на Android это отдельный диалог, поэтому
          компонент монтируется только на время показа */}
      {dateOpen && (
        <DateTimePicker
          value={form.birthDate ? new Date(form.birthDate) : new Date(1990, 0, 1)}
          mode="date"
          onChange={(event, picked) => {
            setDateOpen(false);
            if (event.type === 'set' && picked) {
              const iso = new Date(picked.getTime() - picked.getTimezoneOffset() * 60000)
                .toISOString().slice(0, 10);
              set('birthDate', iso);
            }
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

/**
 * Портрет из МИС в списке поиска: берётся прямо с сервера «Реновации», а не
 * через avatarUrl — тот приводит любой адрес к хосту портала, и картинка
 * превратилась бы в ссылку в никуда. К нам фотография переезжает только при
 * выборе сотрудника: качать полсотни портретов ради списка незачем.
 */
function MisPortrait({own, uri}) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) return <Avatar size={38} />;
  return <Image source={{uri}} style={own.misAvatar} onError={() => setFailed(true)} />;
}

const makeStyles = c => StyleSheet.create({
  avatarRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingTop: 14},
  avatarBody: {flex: 1},
  avatarBusy: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: c.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: c.bgPrimary,
  },
  avatarDrop: {flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8},
  avatarDropText: {fontFamily: font.medium, fontSize: 12, color: c.error},
  // У поля рядом с портретом своя подпись сверху, поэтому у самого поля её нет
  nameField: {paddingTop: 0, borderBottomWidth: 0},
  action: {color: c.primary},
  dot: {width: 10, height: 10, borderRadius: 5},
  misAvatar: {width: 38, height: 38, borderRadius: 19, backgroundColor: c.bgTertiary},
  misLoading: {alignItems: 'center', paddingVertical: 40},

  danger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: c.bgPrimary,
    marginBottom: 8,
  },
});
