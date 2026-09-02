import React, {useMemo, useCallback} from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {Play, Pause} from 'lucide-react-native';
import VoicePlayer, {useVoicePlayer} from '../services/voicePlayer';
import {font, chatSurface} from '../theme';
import {useTheme, useThemedStyles} from '../store/settingsStore';

/**
 * Плеер голосового сообщения в пузырьке чата.
 *
 * Своего состояния воспроизведения не держит — читает общее из VoicePlayer.
 * Благодаря этому звук не обрывается при уходе с экрана, а вернувшись в чат,
 * пользователь видит ползунок ровно там, где он и должен быть.
 *
 * Волна декоративная: высоты столбиков выводятся из id сообщения, а не из
 * звука. То же решение, что в вебе (frontend/src/components/chat/VoiceMessage.js),
 * чтобы чат выглядел одинаково на всех платформах.
 */

const BAR_COUNT = 28;

function waveformFor(seed) {
  const bars = [];
  const str = String(seed ?? '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = 0; i < BAR_COUNT; i++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    bars.push(0.25 + (Math.abs(h) % 1000) / 1000 * 0.75);
  }
  return bars;
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VoiceMessage({uri, duration, messageId, isOwn, chatTitle, chatId}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  const player = useVoicePlayer();

  const isCurrent = String(player.messageId) === String(messageId);
  const playing = isCurrent && player.playing;
  const position = isCurrent ? player.position : 0;
  const total = (isCurrent && player.duration) || duration || 0;
  const progress = total > 0 ? Math.min(position / total, 1) : 0;

  const bars = useMemo(() => waveformFor(messageId || uri), [messageId, uri]);

  const toggle = useCallback(() => {
    if (isCurrent) {
      VoicePlayer.toggle();
    } else {
      VoicePlayer.play({uri, messageId, title: chatTitle, chatId, duration});
    }
  }, [isCurrent, uri, messageId, chatTitle, chatId, duration]);

  const cycleSpeed = useCallback(() => { VoicePlayer.cycleSpeed(); }, []);

  // 0.55, а не 0.45: на акцентной заливке непрослушанная часть волны уходила
  // в шум и волна читалась только наполовину
  const barColor = isOwn ? 'rgba(255,255,255,0.55)' : c.borderLight;
  const barPlayedColor = isOwn ? '#FFFFFF' : c.primary;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.playBtn, isOwn && styles.playBtnOwn]}
        onPress={toggle}
        activeOpacity={0.7}>
        {playing
          ? <Pause size={16} color={isOwn ? c.primary : '#FFFFFF'} />
          : <Play size={16} color={isOwn ? c.primary : '#FFFFFF'} />}
      </TouchableOpacity>

      <View style={styles.body}>
        <View style={styles.wave}>
          {bars.map((height, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: `${Math.round(height * 100)}%`,
                  backgroundColor: i / BAR_COUNT <= progress ? barPlayedColor : barColor,
                },
              ]}
            />
          ))}
        </View>
        <Text style={[styles.time, isOwn && styles.timeOwn]}>
          {formatDuration(isCurrent && position > 0 ? position : total)}
        </Text>
      </View>

      {/* Скорость показываем только у звучащего сообщения — иначе чип висел бы
          на каждом голосовом и только мешал */}
      {isCurrent && (
        <TouchableOpacity
          style={[styles.speed, isOwn && styles.speedOwn]}
          onPress={cycleSpeed}
          activeOpacity={0.7}>
          <Text style={[styles.speedText, isOwn && styles.speedTextOwn]}>
            {player.speed}×
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  container: {flexDirection: 'row', alignItems: 'center', minWidth: 200, paddingVertical: 2},
  playBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: c.primary,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  // Белый непрозрачный, а не 0.9: девять десятых пропускали акцент насквозь,
  // круг выцветал до бледно-серого, и акцентный треугольник на нём почти не
  // читался — в чужом пузырьке та же кнопка выглядела вчетверо контрастнее.
  playBtnOwn: {backgroundColor: '#FFFFFF', ...chatSurface.bubbleOtherShadow},
  body: {flex: 1, flexDirection: 'row', alignItems: 'center'},
  wave: {flex: 1, height: 26, flexDirection: 'row', alignItems: 'center'},
  bar: {flex: 1, marginHorizontal: 1, borderRadius: 1.5, minHeight: 3},
  time: {
    marginLeft: 8, fontSize: 12, fontFamily: font.regular,
    color: c.textSecondary, minWidth: 34,
  },
  timeOwn: {color: 'rgba(255,255,255,0.85)'},
  speed: {
    marginLeft: 6, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 10, backgroundColor: c.bgTertiary,
  },
  speedOwn: {backgroundColor: 'rgba(255,255,255,0.25)'},
  speedText: {fontSize: 11, fontFamily: font.semiBold, color: c.textSecondary},
  speedTextOwn: {color: '#FFFFFF'},
});
