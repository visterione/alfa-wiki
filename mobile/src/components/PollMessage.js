import React, {useState} from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {BarChart3, Check} from 'lucide-react-native';
import {font, radius} from '../theme';
import {useTheme} from '../store/settingsStore';

export default function PollMessage({message, isOwn, onVote}) {
  const c = useTheme();
  const poll = message.poll;
  const [saving, setSaving] = useState(false);
  if (!poll) return null;
  const selected = poll.myOptionIds || [];
  const maxVotes = Math.max(1, ...poll.options.map(option => option.count || 0));
  const fg = isOwn ? '#FFFFFF' : c.textPrimary;
  const muted = isOwn ? 'rgba(255,255,255,0.72)' : c.textSecondary;

  const choose = async optionId => {
    if (saving || poll.closedAt) return;
    const next = poll.multipleChoice
      ? (selected.includes(optionId) ? selected.filter(id => id !== optionId) : [...selected, optionId])
      : (selected.includes(optionId) ? [] : [optionId]);
    setSaving(true);
    try { await onVote(next); } finally { setSaving(false); }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}><BarChart3 size={18} color={fg} /><Text style={[styles.title, {color: fg}]}>{poll.question}</Text></View>
      <Text style={[styles.kind, {color: muted}]}>{poll.anonymous ? 'Анонимный опрос' : 'Открытый опрос'}{poll.multipleChoice ? ' · несколько ответов' : ''}</Text>
      <View style={styles.options}>
        {poll.options.map(option => {
          const active = selected.includes(option.id);
          const percent = poll.totalVoters ? Math.max(3, ((option.count || 0) / maxVotes) * 100) : 0;
          return (
            <TouchableOpacity key={option.id} style={[styles.option, {borderColor: muted}]} disabled={saving || Boolean(poll.closedAt)} onPress={() => choose(option.id)}>
              <View style={[styles.progress, {width: `${percent}%`, backgroundColor: isOwn ? 'rgba(255,255,255,.14)' : c.primaryLight}]} />
              <View style={[styles.check, {borderColor: fg}, active && {backgroundColor: fg}]}>{active && <Check size={12} color={isOwn ? c.primary : '#FFFFFF'} />}</View>
              <Text style={[styles.optionText, {color: fg}]}>{option.text}</Text>
              <Text style={[styles.count, {color: fg}]}>{option.count || 0}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.footer, {color: muted}]}>Проголосовали: {poll.totalVoters || 0}{poll.closedAt ? ' · завершён' : ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {width: 285, maxWidth: '100%', paddingTop: 2},
  titleRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 7},
  title: {flex: 1, fontSize: 15, lineHeight: 19, fontFamily: font.semiBold},
  kind: {fontSize: 11, fontFamily: font.regular, marginTop: 3},
  options: {gap: 6, marginTop: 10},
  option: {minHeight: 38, borderWidth: 1, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 9, paddingVertical: 7, overflow: 'hidden'},
  progress: {position: 'absolute', left: 0, top: 0, bottom: 0},
  check: {width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center'},
  optionText: {flex: 1, fontSize: 13, fontFamily: font.medium},
  count: {fontSize: 12, fontFamily: font.semiBold},
  footer: {fontSize: 11, fontFamily: font.regular, marginTop: 7},
});
