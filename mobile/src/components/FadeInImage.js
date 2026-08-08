import React, {useRef, useState} from 'react';
import {Animated, Pressable, StyleSheet, View} from 'react-native';

import {useTheme} from '../store/settingsStore';

/**
 * Картинка, которая проявляется вместо того, чтобы возникнуть рывком.
 *
 * Пока идёт загрузка, на месте картинки — приглушённая подложка её размера:
 * лента не дёргается, когда изображение доезжает, и не мигает белым.
 *
 * Нажатие даёт лёгкое «утопление» — обратная связь на касание, которой у
 * простого TouchableOpacity с картинкой нет.
 */
export default function FadeInImage({uri, style, onPress, resizeMode = 'cover'}) {
  const c = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const [loaded, setLoaded] = useState(false);

  const onLoad = () => {
    setLoaded(true);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  };

  const press = to =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 30,
      bounciness: 0,
    }).start();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => press(0.97)}
      onPressOut={() => press(1)}>
      <Animated.View style={{transform: [{scale}]}}>
        {!loaded && <View style={[style, styles.placeholder, {backgroundColor: c.bgTertiary}]} />}
        <Animated.Image
          source={{uri}}
          style={[style, {opacity}, !loaded && styles.hidden]}
          resizeMode={resizeMode}
          onLoad={onLoad}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  placeholder: {position: 'absolute'},
  // Пока не загрузилась, картинка не должна занимать место дважды
  hidden: {opacity: 0},
});
