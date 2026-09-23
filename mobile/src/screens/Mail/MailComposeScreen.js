import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {pick as pickDocument, errorCodes as pickerErrorCodes, isErrorWithCode as isPickerError} from '@react-native-documents/picker';
import {Paperclip, X} from 'lucide-react-native';

import {mail as mailApi} from '../../services/api';
import {font, radius} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';

const esc = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
const addresses = value => String(value || '').split(/[;,]/).map(address => address.trim()).filter(Boolean).map(address => ({address}));

export default function MailComposeScreen({navigation, route}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const {accountId, accountEmail, replyToId, kind = 'new'} = route.params;
  const [draft, setDraft] = useState(null);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const draftRef = useRef(null);

  useEffect(() => {
    let alive = true;
    mailApi.createDraft({accountId, kind, replyToId}).then(({data}) => {
      if (!alive) return;
      const next = data.draft;
      draftRef.current = next;
      setDraft(next);
      setTo((next.toList || []).map(item => item.address || item.email || item).join(', '));
      setSubject(next.subject || '');
      // У ответа сервер добавляет цитату; в поле даём написать свежий текст,
      // цитата останется в bodyHtml после сохранения только если не затереть её.
      setText('');
    }).catch(error => Alert.alert('Не удалось создать письмо', error?.response?.data?.error || 'Попробуйте ещё раз'));
    return () => { alive = false; };
  }, [accountId, kind, replyToId]);

  const save = async () => {
    if (!draftRef.current) return;
    const original = draftRef.current.bodyHtml || '';
    const html = text ? `<div>${esc(text)}</div>${original}` : original;
    await mailApi.saveDraft(draftRef.current.id, {toList: addresses(to), subject: subject.trim(), bodyHtml: html, bodyText: text});
  };

  const send = async () => {
    if (!to.trim()) { Alert.alert('Укажите получателя'); return; }
    if (!draft) return;
    setSending(true);
    try { await save(); await mailApi.sendDraft(draft.id); Alert.alert('Письмо отправлено'); navigation.popToTop(); }
    catch (error) { Alert.alert('Не получилось отправить', error?.response?.data?.error || 'Проверьте соединение и попробуйте ещё раз'); }
    finally { setSending(false); }
  };

  const attach = async () => {
    if (!draftRef.current) return;
    try {
      const files = await pickDocument({allowMultiSelection: true});
      for (const file of files) {
        const {data} = await mailApi.attachToDraft(draftRef.current.id, file);
        setAttachments(old => [...old, data.attachment]);
      }
    } catch (error) {
      if (isPickerError(error) && error.code === pickerErrorCodes.OPERATION_CANCELED) return;
      Alert.alert('Не удалось приложить файл', error?.response?.data?.error || 'Проверьте размер файла и попробуйте ещё раз');
    }
  };

  const detach = async attachment => {
    try {
      await mailApi.detachFromDraft(draftRef.current.id, attachment.id);
      setAttachments(old => old.filter(item => item.id !== attachment.id));
    } catch (error) {
      Alert.alert('Не удалось убрать вложение', error?.response?.data?.error || 'Попробуйте ещё раз');
    }
  };

  useEffect(() => {
    navigation.setOptions({headerRight: () => <Text onPress={sending ? undefined : send} style={[styles.send, sending && styles.sendOff]}>{sending ? '…' : 'Отправить'}</Text>});
  });

  if (!draft) return <View style={styles.center}><ActivityIndicator color={c.primary} /></View>;
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><Text style={styles.from}>От: {accountEmail || draft.account?.email || 'Общий ящик'}</Text><Field label="Кому" value={to} onChangeText={setTo} placeholder="name@example.com, ещё@адрес.рф" keyboardType="email-address" styles={styles} c={c} /><Field label="Тема" value={subject} onChangeText={setSubject} placeholder="Тема письма" styles={styles} c={c} /><TextInput value={text} onChangeText={setText} placeholder="Текст письма" placeholderTextColor={c.textTertiary} multiline textAlignVertical="top" style={styles.body} /><View style={styles.attachHead}><Text style={styles.label}>Вложения</Text><Pressable style={styles.attachBtn} onPress={attach}><Paperclip size={17} color={c.primary} /><Text style={styles.attachText}>Прикрепить</Text></Pressable></View>{attachments.map(attachment => <View key={attachment.id} style={styles.attachment}><Text style={styles.attachmentName} numberOfLines={1}>{attachment.filename}</Text><Pressable onPress={() => detach(attachment)} hitSlop={8}><X size={17} color={c.textSecondary} /></Pressable></View>)}</ScrollView></KeyboardAvoidingView>;
}

function Field({label, styles, c, ...props}) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput {...props} placeholderTextColor={c.textTertiary} style={styles.input} autoCapitalize="none" /></View>; }

const makeStyles = c => {
  const styles = StyleSheet.create({root: {flex: 1, backgroundColor: c.bgSecondary}, center: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bgSecondary}, content: {padding: 16, gap: 14, flexGrow: 1}, from: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, paddingHorizontal: 2}, field: {gap: 6}, label: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary}, input: {height: 46, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.bgPrimary, fontFamily: font.regular, fontSize: 15, color: c.textPrimary}, body: {minHeight: 260, padding: 13, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.bgPrimary, fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: c.textPrimary}, attachHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, attachBtn: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4}, attachText: {fontFamily: font.medium, fontSize: 13, color: c.primary}, attachment: {flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: c.bgPrimary, borderWidth: 1, borderColor: c.borderLight}, attachmentName: {flex: 1, fontFamily: font.regular, fontSize: 13, color: c.textPrimary}, send: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'}, sendOff: {opacity: 0.55}});
  return styles;
};
