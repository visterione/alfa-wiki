/**
 * Предпросмотр этикетки — та самая картинка, которая уйдёт в принтер.
 *
 * Раньше перед печатью человек видел только строку «Этикетка на дверь» и
 * количество. Что именно вылезет из принтера, выяснялось уже на ленте, а лента
 * расходуется: ошибся с кабинетом — выбросил наклейку.
 *
 * ── Почему картинку тянет сам <Image>, а не axios ────────────────────────────
 *
 * Первая версия качала PNG через axios (responseType: 'arraybuffer') и
 * складывала из байтов data-URI: Buffer.from(data).toString('base64'). На
 * устройстве это молча ломалось. Полученный из ArrayBuffer типизированный массив
 * не сохраняет прототип Buffer, а у обычного Uint8Array метод toString аргумент
 * игнорирует и отдаёт десятичные значения через запятую — «137,80,78,71,…».
 * Такая строка подставлялась в data:image/png;base64, декодер её не принимал, и
 * на экране была «этикетка не загрузилась». Ровно та же ловушка однажды тихо
 * ломала печать — см. комментарий в services/ptouchPrint.js.
 *
 * Нативный загрузчик <Image> обходит эту яму целиком: байты в JS не попадают
 * вовсе. Плата — токен приходится передать заголовком руками (authHeader).
 *
 * Пропорции держатся жёстко: лента 80 × 24 мм, и вписывать её «как получится»
 * нельзя — по предпросмотру судят, влезло наименование или обрезалось.
 */
import React, {useEffect, useState} from 'react';
import {View, Text, Image, ActivityIndicator, StyleSheet} from 'react-native';

import {authHeader} from '../services/api';
import {radius, font} from '../theme';
import {useThemedStyles, useTheme} from '../store/settingsStore';

// Отношение сторон ленты Brother 80 × 24 мм — см. LABEL_SIZES в qr.js
const LABEL_RATIO = 80 / 24;

export default function LabelPreview({url, style}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const [headers, setHeaders] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    let alive = true;
    authHeader().then(value => alive && setHeaders(value));
    return () => { alive = false; };
  }, []);

  // Новый адрес — снова ждём: без сброса на месте прежней этикетки висела бы
  // старая, пока не догрузится новая, и человек печатал бы, глядя на чужую.
  useEffect(() => { setState('loading'); }, [url]);

  return (
    <View style={[styles.frame, style]}>
      {Boolean(headers) && state !== 'failed' && (
        <Image
          source={{uri: url, headers}}
          style={styles.image}
          resizeMode="contain"
          onLoad={() => setState('ready')}
          onError={() => setState('failed')}
        />
      )}

      {state !== 'ready' && (
        <View style={styles.placeholder}>
          {state === 'failed'
            ? <Text style={styles.failed}>Этикетка не загрузилась</Text>
            : <ActivityIndicator size="small" color={c.textTertiary} />}
        </View>
      )}
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  // Белая подложка не декоративная: этикетка печатается на белой ленте, и на
  // тёмной теме без неё она читалась бы как выворотка, которой не будет.
  frame: {
    width: '100%',
    aspectRatio: LABEL_RATIO,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  // Растяжка через absoluteFill, а не через height: '100%'. Высота рамки
  // выводится из aspectRatio, и процент от такой высоты Yoga считает нулём:
  // картинка схлопывалась в полоску, и на экране оставалась белая рамка.
  image: StyleSheet.absoluteFillObject,
  placeholder: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center'},
  failed: {fontFamily: font.regular, fontSize: 12, color: '#8A8A8E'},
});
