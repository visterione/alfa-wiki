import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {Play, Pause, X} from 'lucide-react-native';
import VoicePlayer, {useVoicePlayer} from '../services/voicePlayer';
import {formatDuration} from './VoiceMessage';
import {font} from '../theme';
import {useTheme, useThemedStyles} from '../store/settingsStore';

/**
 * Полоска «сейчас играет» — управление голосовым, которое звучит, когда
 * пользователь уже ушёл из чата с ним.
 *
 * Рисуется на экранах, а не поверх всего приложения: снизу у каждого экрана
 * своё — таб-бар в списке чатов, строка ввода в переписке, — и единая
 * абсолютная позиция обязательно с чем-нибудь да столкнулась бы.
 *
 * Скрывается сама, когда ничего не играет либо когда открыт тот самый чат:
 * там состояние уже видно на самом пузырьке.
 */
export default function VoiceMiniPlayer({hideForChatId}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  const player = useVoicePlayer();

  if (!player.uri) return null;
  if (hideForChatId && String(hideForChatId) === String(player.chatId)) return null;

  const progress = player.duration > 0
    ? Math.min(player.position / player.duration, 1)
    : 0;

  return (
    <View style={styles.wrap}>
      <View style={[styles.progress, {width: `${progress * 100}%`}]} />

      <TouchableOpacity style={styles.btn} onPress={() => VoicePlayer.toggle()} activeOpacity={0.7}>
        {player.playing
          ? <Pause size={16} color="#FFFFFF" />
          : <Play size={16} color="#FFFFFF" />}
      </TouchableOpacity>

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {player.title || 'Голосовое сообщение'}
        </Text>
        {/* У старых сообщений длительность в базе пустая — показывать
            «2:25 / 0:00» бессмысленно, оставляем только прошедшее время */}
        <Text style={styles.time}>
          {player.duration > 0
            ? `${formatDuration(player.position)} / ${formatDuration(player.duration)}`
            : formatDuration(player.position)}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.speed}
        onPress={() => VoicePlayer.cycleSpeed()}
        activeOpacity={0.7}>
        <Text style={styles.speedText}>{player.speed}×</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.btnClose} onPress={() => VoicePlayer.stop()} activeOpacity={0.7}>
        <X size={16} color={c.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: c.bgPrimary,
    borderTopWidth: 1,
    borderTopColor: c.borderLight,
    overflow: 'hidden',
  },
  // Тонкая полоса прогресса по верхней кромке
  progress: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 2,
    backgroundColor: c.primary,
  },
  btn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: c.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  info: {flex: 1, marginLeft: 10, marginRight: 8},
  title: {fontSize: 13.5, fontFamily: font.medium, color: c.textPrimary},
  time: {fontSize: 11.5, fontFamily: font.regular, color: c.textSecondary, marginTop: 1},
  speed: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 10, backgroundColor: c.bgTertiary, marginRight: 4,
  },
  speedText: {fontSize: 11, fontFamily: font.semiBold, color: c.textSecondary},
  btnClose: {width: 30, height: 30, alignItems: 'center', justifyContent: 'center'},
});
