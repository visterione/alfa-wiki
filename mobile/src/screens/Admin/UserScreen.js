/**
 * Карточка пользователя (ver. 7.77).
 *
 * Отвечает на два вопроса, которые задают с телефона: «кто это» и «почему он
 * чего-то не видит». Второй — главный: половина обращений в поддержку звучит
 * как «у меня пропал раздел», и ответ на него лежит в трёх строках — активна ли
 * учётная запись, какие роли и какие права выданы.
 *
 * Правка живёт не здесь, а в форме — карандашом в шапке. Разделены они
 * намеренно: карточку открывают, чтобы посмотреть, и поля, готовые принять
 * ввод, в этот момент только мешают — промахнулся пальцем по прокрутке и уже
 * что-то поменял.
 */
import React, {useCallback, useState} from 'react';
import {View, Text, ScrollView, StyleSheet} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Crown, Shield, ShieldOff, UserCheck, UserX} from 'lucide-react-native';

import {users as usersApi} from '../../services/api';
import Avatar from '../../components/Avatar';
import UserBadge from '../../components/UserBadge';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {Section, Divider, makeSettingsStyles} from '../Settings/parts';
import {roleNames, medCenterNames, grantedRights, dateText, dateTimeText} from './usersMeta';

const GENDER = {male: 'Мужской', female: 'Женский'};

export default function AdminUserScreen({route, navigation}) {
  const c = useTheme();
  const base = useThemedStyles(makeSettingsStyles);
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const {userId, title} = route.params || {};

  const [user, setUser] = useState(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    // Заголовок ставим из списка сразу: имя оттуда уже приехало, и шапка
    // подписана до того, как ответит сервер
    if (title) navigation.setOptions({title});
    usersApi.get(userId)
      .then(({data}) => {
        if (!alive) return;
        setUser(data);
        navigation.setOptions({title: data.displayName || data.username});
      })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [userId, title, navigation]));

  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.failed}>Карточка не загрузилась</Text>
      </View>
    );
  }
  if (!user) return <LogoLoader />;

  const roles = roleNames(user);
  const medCenters = medCenterNames(user);
  const rights = user.isAdmin ? ['Полный доступ'] : grantedRights(user);

  return (
    <ScrollView
      style={base.container}
      contentContainerStyle={[base.content, {paddingBottom: insets.bottom + 16}]}>
      <View style={styles.head}>
        <Avatar uri={user.avatar} size={72} />
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={2}>{user.displayName || user.username}</Text>
          {/* Метка из переписки: по ней человека узнают в чатах, и увидеть её
              надо там же, где решают, правильная ли она */}
          <UserBadge badge={user.chatBadge} size={17} />
        </View>
        <Text style={styles.login}>@{user.username}</Text>

        {/* Состояние учётной записи — значками, а не строчками: их читают
            быстрее, а на вопрос «почему не пускает» отвечает первый же */}
        <View style={styles.flags}>
          {user.isActive
            ? <Flag styles={styles} icon={UserCheck} color={c.success} label="Активен" />
            : <Flag styles={styles} icon={UserX} color={c.error} label="Отключён" />}
          {user.twoFactorEnabled
            ? <Flag styles={styles} icon={Shield} color={c.success} label="2FA" />
            : <Flag styles={styles} icon={ShieldOff} color={c.textTertiary} label="Без 2FA" />}
          {user.isAdmin && (
            <Flag styles={styles} icon={Crown} color={c.warning} label="Администратор" />
          )}
        </View>
      </View>

      <Section title="Контакты">
        <Field label="Почта" value={user.email} />
        <Divider />
        <Field label="Телефон" value={user.phone} />
      </Section>

      <Section title="Работа">
        <Field label="Должность" value={user.position} />
        <Divider />
        <Field label="Специальность" value={user.specialty} />
        <Divider />
        <Field label="Роли" value={roles.join(', ')} />
        <Divider />
        <Field label="Медцентры" value={medCenters.join(', ')} />
      </Section>

      <Section title="Права">
        <Field
          label={user.isAdmin ? 'Администратор портала' : 'Открытые разделы'}
          value={rights.join(', ')}
          empty="Ничего сверх обычного доступа"
        />
      </Section>

      <Section title="Учётная запись">
        <Field label="Заведён" value={dateText(user.createdAt)} />
        <Divider />
        <Field label="Последний вход" value={dateTimeText(user.lastLogin)} />
        <Divider />
        <Field label="Пол" value={GENDER[user.gender]} />
        <Divider />
        <Field label="Дата рождения" value={user.birthDate ? dateText(user.birthDate) : ''} />
        <Divider />
        {/* Идентификатор в «Реновации» — то, по чему сходятся расписание,
            зарплата и карточка врача. Пустой означает, что человека заводили
            руками, и половина модулей его не узнает. */}
        <Field label="ID в МИС" value={user.misUserId} empty="Не связан с «Реновацией»" />
      </Section>

      {Boolean(user.bio) && (
        <Section title="О себе">
          <Field value={user.bio} />
        </Section>
      )}
    </ScrollView>
  );
}

function Flag({styles, icon: Icon, color, label}) {
  return (
    <View style={[styles.flag, {backgroundColor: `${color}1F`}]}>
      <Icon size={13} color={color} />
      <Text style={[styles.flagText, {color}]}>{label}</Text>
    </View>
  );
}

function Field({label, value, empty = '—'}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <Text style={[styles.fieldValue, !value && styles.fieldEmpty]}>
        {value || empty}
      </Text>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40},
  failed: {fontSize: 15, fontFamily: font.regular, color: c.textTertiary},

  head: {alignItems: 'center', paddingBottom: 22},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12},
  name: {fontSize: 19, fontFamily: font.semiBold, color: c.textPrimary, textAlign: 'center'},
  login: {fontSize: 13, fontFamily: font.regular, color: c.textSecondary, marginTop: 2},
  flags: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 12},
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.md,
  },
  flagText: {fontSize: 12, fontFamily: font.medium},

  field: {paddingHorizontal: 14, paddingVertical: 11},
  fieldLabel: {fontSize: 11, fontFamily: font.regular, color: c.textSecondary, marginBottom: 3},
  fieldValue: {fontSize: 15, fontFamily: font.regular, color: c.textPrimary, lineHeight: 21},
  fieldEmpty: {color: c.textTertiary},
});
