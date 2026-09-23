import React, {useCallback, useState} from 'react';
import {ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Download, FileText, Forward, Reply, Star, Trash2} from 'lucide-react-native';

import {authHeader, mail as mailApi} from '../../services/api';
import {saveAttachment} from '../../services/downloads';
import {cardSurface, font, radius} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {bodyText, fullDate, initials, senderName, sizeText} from './mailMeta';

export default function MailMessageScreen({navigation, route}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const {messageId} = route.params;
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const {data: result} = await mailApi.message(messageId);
      setData(result);
      if (!result?.message?.isSeen) {
        mailApi.setFlag(messageId, 'seen').catch(() => {});
      }
    } catch (error) {
      Alert.alert('Не удалось открыть письмо', error?.response?.data?.error || 'Проверьте соединение и попробуйте ещё раз');
      navigation.goBack();
    }
  }, [messageId, navigation]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const flag = async () => {
    if (!data) return;
    const op = data.message.isFlagged ? 'unflag' : 'flag';
    setData(old => ({...old, message: {...old.message, isFlagged: !old.message.isFlagged}}));
    try { await mailApi.setFlag(messageId, op); } catch (e) { load(); }
  };

  const remove = () => Alert.alert('Удалить письмо?', 'Оно переместится в корзину общего ящика.', [
    {text: 'Отмена', style: 'cancel'},
    {text: 'Удалить', style: 'destructive', onPress: async () => {
      setBusy(true);
      try { await mailApi.removeMessage(messageId); navigation.goBack(); }
      catch (error) { Alert.alert('Не получилось', error?.response?.data?.error || 'Попробуйте ещё раз'); }
      finally { setBusy(false); }
    }},
  ]);

  const download = async attachment => {
    const headers = await authHeader();
    saveAttachment({name: attachment.filename, mimeType: attachment.mimeType, url: mailApi.attachmentUrl(messageId, attachment.id), headers});
  };

  if (!data) return <View style={styles.center}><ActivityIndicator color={c.primary} /></View>;
  const {message, body, attachments = [], addresses = []} = data;
  const to = addresses.filter(item => item.role === 'to').map(item => item.name || item.email).join(', ');

  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <View style={styles.actions}><Pressable style={styles.action} onPress={flag} accessibilityLabel="В избранное"><Star size={19} color={message.isFlagged ? c.warning : c.textSecondary} fill={message.isFlagged ? c.warning : 'transparent'} /></Pressable><Pressable style={styles.action} disabled={busy} onPress={remove} accessibilityLabel="Удалить"><Trash2 size={19} color={c.error} /></Pressable></View>
    <Text style={styles.subject}>{message.subject || '(без темы)'}</Text>
    <View style={styles.senderCard}><View style={styles.avatar}><Text style={styles.avatarText}>{initials(senderName(message))}</Text></View><View style={styles.senderText}><Text style={styles.sender}>{senderName(message)}</Text><Text style={styles.email}>{message.fromEmail}</Text><Text style={styles.date}>{fullDate(message.sentAt || message.receivedAt)}</Text>{Boolean(to) && <Text style={styles.to} numberOfLines={2}>Кому: {to}</Text>}</View></View>
    {!body ? <View style={styles.wait}><ActivityIndicator color={c.primary} /><Text style={styles.waitText}>Текст письма ещё загружается</Text></View> : <Text selectable style={styles.body}>{bodyText(body) || 'Письмо без текста'}</Text>}
    {attachments.length > 0 && <View style={styles.attachments}><Text style={styles.section}>Вложения · {attachments.length}</Text>{attachments.map(attachment => <Pressable key={attachment.id} style={styles.attachment} onPress={() => download(attachment)}><View style={styles.fileIcon}><FileText size={19} color={c.primary} /></View><View style={styles.fileText}><Text style={styles.fileName} numberOfLines={1}>{attachment.filename || 'Вложение'}</Text><Text style={styles.fileMeta}>{sizeText(attachment.size)}</Text></View><Download size={18} color={c.textSecondary} /></Pressable>)}</View>}
    <View style={styles.replyRow}><Pressable style={[styles.reply, styles.replyPrimary]} onPress={() => navigation.navigate('MailCompose', {accountId: message.accountId, accountEmail: route.params.accountEmail, replyToId: message.id, kind: 'reply'})}><Reply size={18} color="#FFFFFF" /><Text style={styles.replyPrimaryText}>Ответить</Text></Pressable><Pressable style={styles.reply} onPress={() => navigation.navigate('MailCompose', {accountId: message.accountId, accountEmail: route.params.accountEmail, replyToId: message.id, kind: 'forward'})}><Forward size={18} color={c.primary} /></Pressable></View>
  </ScrollView>;
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary}, content: {padding: 16, paddingBottom: 32}, center: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bgSecondary},
  actions: {alignSelf: 'flex-end', flexDirection: 'row', gap: 6}, action: {width: 38, height: 38, borderRadius: 12, backgroundColor: c.bgPrimary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.borderLight}, subject: {fontFamily: font.bold, fontSize: 22, lineHeight: 28, color: c.textPrimary, marginTop: 6, marginBottom: 16},
  senderCard: {...cardSurface(c), flexDirection: 'row', gap: 10, borderRadius: radius.lg, padding: 12}, avatar: {width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primaryLight}, avatarText: {fontFamily: font.bold, color: c.primary, fontSize: 15}, senderText: {flex: 1}, sender: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary}, email: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 1}, date: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary, marginTop: 5}, to: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 3},
  body: {fontFamily: font.regular, fontSize: 15, lineHeight: 23, color: c.textPrimary, marginTop: 18}, wait: {alignItems: 'center', gap: 8, paddingVertical: 34}, waitText: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary}, attachments: {marginTop: 22}, section: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary, marginBottom: 8}, attachment: {...cardSurface(c), flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.md, padding: 10, marginBottom: 7}, fileIcon: {width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primaryLight}, fileText: {flex: 1, minWidth: 0}, fileName: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary}, fileMeta: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 2}, replyRow: {flexDirection: 'row', gap: 8, marginTop: 24}, reply: {height: 44, minWidth: 44, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: radius.md, backgroundColor: c.primaryLight}, replyPrimary: {flex: 1, backgroundColor: c.primary}, replyPrimaryText: {fontFamily: font.semiBold, fontSize: 14, color: '#FFFFFF'},
});
