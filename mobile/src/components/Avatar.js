import React from 'react';
import {View, Image, StyleSheet} from 'react-native';
import {User, Users} from 'lucide-react-native';
import avatarUrl from '../utils/avatarUrl';
import {useTheme, useThemedStyles} from '../store/settingsStore';

/**
 * Аватар пользователя или группы — единственная точка, где решается, что
 * показывать вместо отсутствующей картинки.
 *
 * Раньше заглушек было четыре и все разные: в списке чатов — иконка человечка,
 * в шапке открытого чата — инициалы, в списке участников — почему-то иконка
 * группы (для отдельных людей!), в профиле — снова инициалы. Один и тот же
 * человек выглядел по-разному на соседних экранах.
 *
 * @param {string}  uri      путь к аватарке (относительный или абсолютный)
 * @param {boolean} isGroup  групповой чат — тогда иконка из нескольких фигур
 * @param {number}  size     диаметр в px
 * @param {boolean} onNavbar аватар лежит на синей шапке навигатора, где серая
 *                           заглушка сливается: нужны светлые фон и иконка
 */
export default function Avatar({uri, isGroup = false, size = 44, onNavbar = false, style}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  const url = avatarUrl(uri);
  const shape = {width: size, height: size, borderRadius: size / 2};

  if (url) {
    return <Image source={{uri: url}} style={[styles.image, shape, style]} />;
  }

  const Icon = isGroup ? Users : User;
  return (
    <View style={[onNavbar ? styles.stubOnNavbar : styles.stub, shape, style]}>
      <Icon size={size * 0.5} color={onNavbar ? '#FFFFFF' : c.textSecondary} />
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  image: {resizeMode: 'cover'},
  // bgTertiary — тот же серый, что у .chat-item-avatar в вебе
  stub: {backgroundColor: c.bgTertiary, alignItems: 'center', justifyContent: 'center'},
  stubOnNavbar: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
