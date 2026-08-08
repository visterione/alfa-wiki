import React, {useState} from 'react';
import {Text, Linking, StyleSheet, Platform} from 'react-native';
import {parseRich} from '../utils/richText';

/**
 * Текст сообщения с разметкой (см. utils/richText): жирный, курсив,
 * подчёркнутый, зачёркнутый, спойлер, моноширинный и ссылки.
 *
 * Возвращает набор <Text>, поэтому вставляется и внутрь готового <Text> —
 * так в пузырьке сообщения сохраняется невидимый отступ под время, который
 * дописывается следом за содержимым. По той же причине блок кода не становится
 * отдельной плиткой с фоном, как в вебе: внутри <Text> её некуда положить, —
 * от обычного текста он отличается моноширинным шрифтом.
 *
 * Внешние ссылки открываются браузером. Внутренние (начинаются с «/») ведут в
 * разделы веб-версии, которых в приложении нет, — их только подсвечиваем:
 * ссылка, ведущая в никуда, раздражает сильнее, чем просто выделенный текст.
 *
 * Спойлер до нажатия закрыт плашкой и открывается по тапу — обратно, как и в
 * Telegram, не закрывается.
 */
export default function RichText({text, boldStyle, linkStyle}) {
  // Индексы уже открытых спойлеров: их в сообщении обычно один-два
  const [revealed, setRevealed] = useState(() => new Set());

  const segments = parseRich(text);

  return (
    <>
      {segments.map((seg, i) => {
        const hidden = seg.spoiler && !revealed.has(i);
        const openable = seg.url && !seg.internal;

        const style = [
          seg.bold && boldStyle,
          seg.italic && styles.italic,
          seg.underline && styles.underline,
          seg.strike && styles.strike,
          // Подчёркнутый и зачёркнутый разом: RN не складывает
          // textDecorationLine, поэтому обе линии задаём одним значением
          seg.underline && seg.strike && styles.underlineStrike,
          (seg.code || seg.pre) && styles.code,
          seg.url && linkStyle,
          hidden && styles.spoilerHidden,
        ].filter(Boolean);

        const onPress = hidden
          ? () => setRevealed(prev => new Set(prev).add(i))
          : openable
            ? () => Linking.openURL(seg.url).catch(() => {})
            : undefined;

        return (
          <Text key={i} style={style.length ? style : undefined} onPress={onPress}>
            {seg.text}
          </Text>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  italic: {fontStyle: 'italic'},
  underline: {textDecorationLine: 'underline'},
  strike: {textDecorationLine: 'line-through'},
  underlineStrike: {textDecorationLine: 'underline line-through'},
  // Системный моноширинный: имя шрифта на iOS и Android разное
  code: {fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'},
  // Закрытый спойлер: текст красим в цвет плашки — не видно, но место он
  // занимает, и при открытии строка не прыгает
  spoilerHidden: {color: 'transparent', backgroundColor: 'rgba(128,128,128,0.55)'},
});
