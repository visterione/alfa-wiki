/**
 * Корзина: кого удалили и кем.
 *
 * Удаление сотрудника — мягкое: карточка остаётся, вход выключается. Это
 * сделано ради ровно одного случая — «удалили не того», и случай этот
 * обнаруживается через час, когда человек не может войти. Поэтому корзина есть
 * и на телефоне: восстановить нужно тогда же, когда узнали, а не когда дошли до
 * компьютера.
 *
 * Окончательного удаления нет ни здесь, ни в вебе: у сотрудника остаются
 * сообщения, задачи и подписи в журналах, и снести запись целиком значило бы
 * обезличить их задним числом.
 */
import React, {useCallback, useState} from 'react';
import {View, Text, FlatList, Pressable, StyleSheet, Alert} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {RotateCcw} from 'lucide-react-native';

import {users as usersApi} from '../../services/api';
import Avatar from '../../components/Avatar';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {dateTimeText} from './usersMeta';

export default function AdminTrashScreen() {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => usersApi.trash()
    .then(({data}) => setList(data || []))
    .catch(() => setList([])), []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const restore = user => Alert.alert(
    'Восстановить?',
    `${user.displayName || user.username} снова сможет войти в портал.`,
    [
      {text: 'Отмена', style: 'cancel'},
      {
        text: 'Восстановить',
        onPress: async () => {
          setBusy(user.id);
          try {
            await usersApi.restore(user.id);
            await load();
          } catch (e) {
            Alert.alert('Не вышло', e?.response?.data?.error || 'Попробуйте ещё раз.');
          } finally {
            setBusy(null);
          }
        },
      },
    ],
  );

  if (!list) return <LogoLoader />;

  return (
    <FlatList
      style={styles.container}
      data={list}
      keyExtractor={item => String(item.id)}
      contentContainerStyle={{paddingBottom: insets.bottom + 16}}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.empty}>Корзина пуста</Text>
        </View>
      }
      renderItem={({item}) => (
        <View style={styles.row}>
          <Avatar uri={item.avatar} size={44} />
          <View style={styles.body}>
            <Text style={styles.name} numberOfLines={1}>
              {item.displayName || item.username}
            </Text>
            {/* Кто удалил — половина ответа на «почему он не может войти»:
                чаще всего это делали намеренно, и спрашивать нужно у того,
                чьё имя тут стоит */}
            <Text style={styles.meta} numberOfLines={2}>
              {dateTimeText(item.deletedAt)}
              {item.deletedByUser
                ? ` · ${item.deletedByUser.displayName || item.deletedByUser.username}`
                : ''}
            </Text>
          </View>
          <Pressable
            style={[styles.restore, busy === item.id && styles.restoreOff]}
            disabled={busy === item.id}
            onPress={() => restore(item)}>
            <RotateCcw size={14} color={c.primary} />
            <Text style={styles.restoreText}>Вернуть</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const makeStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgPrimary},
  center: {alignItems: 'center', justifyContent: 'center', padding: 40},
  empty: {fontSize: 15, fontFamily: font.regular, color: c.textTertiary},

  row: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12},
  body: {flex: 1, marginHorizontal: 13},
  name: {fontSize: 15, fontFamily: font.medium, color: c.textPrimary},
  meta: {fontSize: 12, fontFamily: font.regular, color: c.textSecondary, marginTop: 2},
  separator: {height: 1, backgroundColor: c.borderLight, marginLeft: 73},

  restore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
  },
  restoreOff: {opacity: 0.5},
  restoreText: {fontSize: 13, fontFamily: font.medium, color: c.primary},
});
