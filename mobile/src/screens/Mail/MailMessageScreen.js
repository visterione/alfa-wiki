import React, {useCallback, useLayoutEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  Download, EllipsisVertical, FileText, Flag, FolderInput, Forward, Reply, Trash2,
} from 'lucide-react-native';

import BottomSheet from '../../components/BottomSheet';
import {authHeader, mail as mailApi} from '../../services/api';
import {saveAttachment} from '../../services/downloads';
import {useMailAccounts} from '../../store/mailStore';
import {cardSurface, font, radius} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {bodyText, folderTitle, fullDate, isDisposalFolder, senderName, sizeText} from './mailMeta';
import {SenderAvatar, folderIcon} from './mailVisuals';
import MailBody from './MailBody';

// Шапка экрана в стеке: 44 точки на iOS, 56 на Android — поверх отступа сверху.
const HEADER_HEIGHT = Platform.OS === 'ios' ? 44 : 56;

/**
 * Открытое письмо.
 *
 * Все действия — ответ, пересылка, флажок, перенос, удаление — собраны в
 * меню «⋯» в шапке. Раньше половина из них стояла кнопками над темой, а
 * половина — под письмом, и чтобы ответить на длинное письмо, его надо было
 * пролистать до конца. Меню в шапке доступно с любого места прокрутки.
 *
 * Вложения стоят сразу под отправителем, до текста: в общем ящике письмо чаще
 * всего и открывают ради приложенного файла, а текст сводится к «во вложении».
 */
export default function MailMessageScreen({navigation, route}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const {messageId} = route.params;
  const accounts = useMailAccounts();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [folders, setFolders] = useState(null);

  const message = data?.message;
  const rights = useMemo(() => {
    const account = (accounts || []).find(item => item.id === (message?.accountId || route.params.accountId));
    return {canSend: Boolean(account?.canSend), canDelete: Boolean(account?.canDelete)};
  }, [accounts, message?.accountId, route.params.accountId]);

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

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} style={styles.headerButton} accessibilityLabel="Действия с письмом">
          <EllipsisVertical size={22} color="#FFFFFF" />
        </Pressable>
      ),
    });
  }, [navigation, styles.headerButton]);

  // Нативный Modal меню снимается не мгновенно, и шторка, поднятая в тот же
  // кадр, встаёт поверх ещё живого меню — экран перестаёт отвечать (см.
  // BottomSheet). Поэтому следующее окно открываем с небольшой паузой.
  const afterMenu = action => {
    setMenuOpen(false);
    setTimeout(action, 260);
  };

  const compose = kind => navigation.navigate('MailCompose', {
    accountId: message.accountId, accountEmail: route.params.accountEmail, replyToId: message.id, kind,
  });

  const flag = async () => {
    if (!message) return;
    const op = message.isFlagged ? 'unflag' : 'flag';
    setData(old => ({...old, message: {...old.message, isFlagged: !old.message.isFlagged}}));
    try { await mailApi.setFlag(messageId, op); } catch (e) { load(); }
  };

  const remove = () => Alert.alert('Удалить письмо?', 'Оно переместится в корзину общего ящика — у всех, кто с ним работает.', [
    {text: 'Отмена', style: 'cancel'},
    {text: 'Удалить', style: 'destructive', onPress: async () => {
      setBusy(true);
      try { await mailApi.removeMessage(messageId); navigation.goBack(); }
      catch (error) { Alert.alert('Не получилось', error?.response?.data?.error || 'Попробуйте ещё раз'); }
      finally { setBusy(false); }
    }},
  ]);

  const openMove = async () => {
    setMoveOpen(true);
    if (folders) return;
    try {
      const {data: result} = await mailApi.folders(message.accountId);
      setFolders(result?.folders || []);
    } catch (error) {
      setFolders([]);
    }
  };

  const move = async folder => {
    setMoveOpen(false);
    setBusy(true);
    try {
      await mailApi.moveMessage(messageId, folder.id);
      navigation.goBack();
    } catch (error) {
      Alert.alert('Не удалось перенести', error?.response?.data?.error || 'Попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const download = async attachment => {
    const headers = await authHeader();
    saveAttachment({name: attachment.filename, mimeType: attachment.mimeType, url: mailApi.attachmentUrl(messageId, attachment.id), headers});
  };

  if (!data) return <View style={styles.center}><ActivityIndicator color={c.primary} /></View>;
  const {body, attachments = [], inlineAttachments = [], addresses = []} = data;
  const to = addresses.filter(item => item.role === 'to').map(item => item.name || item.email).join(', ');
  const cc = addresses.filter(item => item.role === 'cc').map(item => item.name || item.email).join(', ');

  // В перенос не предлагаем папку, где письмо уже лежит, и — без права на
  // удаление — Корзину и Спам: сервер такой перенос всё равно отвергнет.
  const moveTargets = (folders || []).filter(item => item.id !== message.folderId && (rights.canDelete || !isDisposalFolder(item)));

  const menu = [
    rights.canSend && {key: 'reply', label: 'Ответить', Icon: Reply, onPress: () => afterMenu(() => compose('reply'))},
    rights.canSend && {key: 'forward', label: 'Переслать', Icon: Forward, onPress: () => afterMenu(() => compose('forward'))},
    {key: 'flag', label: message.isFlagged ? 'Снять флажок' : 'Поставить флажок', Icon: Flag, onPress: () => { setMenuOpen(false); flag(); }},
    {key: 'move', label: 'Переместить в папку', Icon: FolderInput, onPress: () => afterMenu(openMove)},
    rights.canDelete && {key: 'delete', label: 'Удалить', Icon: Trash2, danger: true, onPress: () => afterMenu(remove)},
  ].filter(Boolean);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.subjectRow}>
          <Text selectable style={styles.subject}>{message.subject || '(без темы)'}</Text>
          {message.isFlagged && <Flag size={18} color={c.error} fill={c.error} style={styles.subjectFlag} />}
        </View>

        <View style={styles.senderCard}>
          <SenderAvatar message={message} size={42} />
          <View style={styles.senderText}>
            <Text style={styles.sender}>{senderName(message)}</Text>
            <Text selectable style={styles.email}>{message.fromEmail}</Text>
            <Text style={styles.date}>{fullDate(message.sentAt || message.receivedAt)}</Text>
            {Boolean(to) && <Text style={styles.to} numberOfLines={2}>Кому: {to}</Text>}
            {Boolean(cc) && <Text style={styles.to} numberOfLines={2}>Копия: {cc}</Text>}
          </View>
        </View>

        {attachments.length > 0 && (
          <View style={styles.attachments}>
            <Text style={styles.section}>Вложения · {attachments.length}</Text>
            {attachments.map(attachment => (
              <Pressable key={attachment.id} style={styles.attachment} onPress={() => download(attachment)}>
                <View style={styles.fileIcon}><FileText size={19} color={c.primary} /></View>
                <View style={styles.fileText}>
                  <Text style={styles.fileName} numberOfLines={1}>{attachment.filename || 'Вложение'}</Text>
                  <Text style={styles.fileMeta}>{sizeText(attachment.size)}</Text>
                </View>
                <Download size={18} color={c.textSecondary} />
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.bodyWrap}>
          {!body ? (
            <View style={styles.wait}><ActivityIndicator color={c.primary} /><Text style={styles.waitText}>Текст письма ещё загружается с сервера</Text></View>
          ) : body.html ? (
            <MailBody messageId={messageId} html={body.html} inlineAttachments={inlineAttachments} />
          ) : (
            <Text selectable style={styles.plain}>{bodyText(body) || 'Письмо без текста'}</Text>
          )}
        </View>
      </ScrollView>

      {busy && <View style={styles.busy}><ActivityIndicator color={c.primary} /></View>}

      <Modal visible={menuOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuScrim} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menu, {top: insets.top + HEADER_HEIGHT + 4}]}>
            {menu.map(item => (
              <Pressable key={item.key} style={({pressed}) => [styles.menuItem, pressed && styles.menuItemPressed]} onPress={item.onPress}>
                <item.Icon size={18} color={item.danger ? c.error : (item.key === 'flag' && message.isFlagged ? c.error : c.textSecondary)} />
                <Text style={[styles.menuText, item.danger && styles.menuDanger]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <BottomSheet visible={moveOpen} title="Переместить в папку" onClose={() => setMoveOpen(false)}>
        <ScrollView contentContainerStyle={styles.sheetList}>
          {folders === null && <ActivityIndicator style={styles.sheetWait} color={c.primary} />}
          {folders !== null && !moveTargets.length && <Text style={styles.sheetEmpty}>Переносить некуда</Text>}
          {moveTargets.map(item => {
            const Icon = folderIcon(item);
            return (
              <Pressable key={item.id} style={styles.folderRow} onPress={() => move(item)}>
                <Icon size={19} color={c.textSecondary} />
                <Text style={styles.folderName} numberOfLines={1}>{folderTitle(item)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 16, paddingBottom: 40},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bgSecondary},
  headerButton: {paddingHorizontal: 6, paddingVertical: 4},
  subjectRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 14},
  subject: {flex: 1, fontFamily: font.bold, fontSize: 21, lineHeight: 27, color: c.textPrimary},
  subjectFlag: {marginTop: 5},
  senderCard: {...cardSurface(c), flexDirection: 'row', gap: 11, borderRadius: radius.lg, padding: 12},
  senderText: {flex: 1, minWidth: 0},
  sender: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary},
  email: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 1},
  date: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary, marginTop: 5},
  to: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 3},
  attachments: {marginTop: 14},
  section: {fontFamily: font.semiBold, fontSize: 13, color: c.textSecondary, marginBottom: 7},
  attachment: {...cardSurface(c), flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.md, padding: 10, marginBottom: 7},
  fileIcon: {width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primaryLight},
  fileText: {flex: 1, minWidth: 0},
  fileName: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary},
  fileMeta: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 2},
  bodyWrap: {marginTop: 16},
  plain: {fontFamily: font.regular, fontSize: 15, lineHeight: 23, color: c.textPrimary},
  wait: {alignItems: 'center', gap: 8, paddingVertical: 34},
  waitText: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary},
  busy: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.12)'},
  menuScrim: {flex: 1, backgroundColor: 'rgba(0,0,0,0.18)'},
  menu: {
    position: 'absolute', right: 10, minWidth: 230, paddingVertical: 6,
    borderRadius: radius.lg, backgroundColor: c.bgPrimary, borderWidth: 1, borderColor: c.borderLight,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: {width: 0, height: 8}, elevation: 12,
  },
  menuItem: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12},
  menuItemPressed: {backgroundColor: c.bgSecondary},
  menuText: {fontFamily: font.medium, fontSize: 15, color: c.textPrimary},
  menuDanger: {color: c.error},
  sheetList: {paddingHorizontal: 12, paddingBottom: 16, gap: 4},
  sheetWait: {paddingVertical: 18},
  sheetEmpty: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, textAlign: 'center', paddingVertical: 18},
  folderRow: {flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12},
  folderName: {flex: 1, fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
});
