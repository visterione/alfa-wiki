import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {ChevronDown, Inbox, Mail, Paperclip, PenSquare, Search, Star, X} from 'lucide-react-native';

import {mail as mailApi} from '../../services/api';
import {loadMailAccounts, setMailUnread, useMailAccounts} from '../../store/mailStore';
import {cardSurface, font, radius} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {initials, listDate, senderName} from './mailMeta';

const INBOX_PATH = 'INBOX';

export default function MailScreen({navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tabInset = useTabBarInset();
  const accounts = useMailAccounts();
  const [accountId, setAccountId] = useState(null);
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accountSheet, setAccountSheet] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const account = useMemo(
    () => (accounts || []).find(item => item.id === accountId) || accounts?.[0],
    [accounts, accountId],
  );

  useEffect(() => {
    if (!accountId && accounts?.[0]) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const loadFolders = useCallback(async id => {
    if (!id) return [];
    const {data} = await mailApi.folders(id);
    const next = data?.folders || [];
    setFolders(next);
    setFolderId(old => old && next.some(folder => folder.id === old) ? old :
      (next.find(folder => String(folder.path).toUpperCase() === INBOX_PATH)?.id || next[0]?.id || null));
    return next;
  }, []);

  const loadMessages = useCallback(async ({silent = false} = {}) => {
    if (!accountId) return;
    if (!silent) setLoading(true);
    try {
      const text = query.trim();
      const {data} = text
        ? await mailApi.search({q: text, accountId, folderId, limit: 60})
        : await mailApi.messages({accountId, folderId, limit: 60});
      setMessages(data?.messages || []);
    } catch (error) {
      setMessages([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setSearching(false);
    }
  }, [accountId, folderId, query]);

  useEffect(() => {
    if (!accountId) return;
    loadFolders(accountId).catch(() => setFolders([]));
  }, [accountId, loadFolders]);

  useEffect(() => { loadMessages(); }, [loadMessages]);
  useFocusEffect(useCallback(() => {
    loadMailAccounts({force: true});
    loadMessages({silent: true});
  }, [loadMessages]));

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadMailAccounts({force: true}), loadFolders(accountId)]);
      await loadMessages({silent: true});
    } finally {
      setRefreshing(false);
    }
  };

  const chooseAccount = id => {
    setAccountSheet(false);
    setAccountId(id);
    setMessages([]);
  };

  if (accounts === null || (loading && !accountId)) {
    return <View style={styles.center}><ActivityIndicator color={c.primary} /></View>;
  }

  if (!accounts?.length) {
    return <View style={styles.empty}><Mail size={34} color={c.textTertiary} /><Text style={styles.emptyTitle}>Почта пока не подключена</Text><Text style={styles.emptyText}>Администратор выдаёт доступ к общим ящикам.</Text></View>;
  }

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Pressable style={styles.account} onPress={() => setAccountSheet(true)}>
          <View style={styles.accountMark}><Text style={styles.accountMarkText}>{initials(account?.displayName || account?.email)}</Text></View>
          <View style={styles.accountText}><Text style={styles.accountName} numberOfLines={1}>{account?.displayName || account?.email}</Text><Text style={styles.accountEmail} numberOfLines={1}>{account?.email}</Text></View>
          <ChevronDown size={18} color={c.textTertiary} />
        </Pressable>
        <Pressable style={styles.compose} onPress={() => navigation.navigate('MailCompose', {accountId: account.id, accountEmail: account.email})} accessibilityLabel="Новое письмо"><PenSquare size={21} color="#FFFFFF" /></Pressable>
      </View>

      <View style={styles.search}><Search size={18} color={c.textTertiary} /><TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => { setSearching(true); loadMessages({silent: true}); }} placeholder="Поиск в ящике" placeholderTextColor={c.textTertiary} returnKeyType="search" style={styles.searchInput} />{Boolean(query) && <Pressable onPress={() => { setQuery(''); setSearching(true); }}><X size={17} color={c.textTertiary} /></Pressable>}</View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.folders}>
        {folders.map(folder => <Pressable key={folder.id} style={[styles.folder, folderId === folder.id && styles.folderActive]} onPress={() => setFolderId(folder.id)}><Text style={[styles.folderText, folderId === folder.id && styles.folderTextActive]} numberOfLines={1}>{folder.name}{folder.unread ? ` · ${folder.unread}` : ''}</Text></Pressable>)}
      </ScrollView>

      <FlatList
        data={messages}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, {paddingBottom: tabInset + 20}, !messages.length && styles.listEmpty]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />}
        ListEmptyComponent={loading || searching ? <ActivityIndicator color={c.primary} /> : <View style={styles.noMessages}><Inbox size={30} color={c.textTertiary} /><Text style={styles.emptyText}>{query ? 'По этому запросу писем нет' : 'В этой папке писем нет'}</Text></View>}
        renderItem={({item}) => <MailRow item={item} c={c} styles={styles} onPress={() => {
          if (!item.isSeen) setMailUnread(accountId, Math.max(0, (account?.unread || 0) - 1));
          navigation.navigate('MailMessage', {messageId: item.id, accountId, accountEmail: account?.email, title: item.subject || 'Письмо'});
        }} />}
      />

      <Modal visible={accountSheet} transparent animationType="fade" onRequestClose={() => setAccountSheet(false)}>
        <Pressable style={styles.scrim} onPress={() => setAccountSheet(false)}><Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>{accounts.map(item => <Pressable key={item.id} style={[styles.sheetRow, item.id === accountId && styles.sheetRowActive]} onPress={() => chooseAccount(item.id)}><View style={styles.accountMark}><Text style={styles.accountMarkText}>{initials(item.displayName || item.email)}</Text></View><View style={styles.accountText}><Text style={styles.accountName}>{item.displayName || item.email}</Text><Text style={styles.accountEmail}>{item.email}</Text></View>{item.unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{item.unread > 99 ? '99+' : item.unread}</Text></View>}</Pressable>)}</Pressable></Pressable>
      </Modal>
    </View>
  );
}

function MailRow({item, c, styles, onPress}) {
  const unread = !item.isSeen;
  return <Pressable onPress={onPress} style={[styles.row, unread && styles.rowUnread]}>
    <View style={[styles.avatar, unread && styles.avatarUnread]}><Text style={[styles.avatarText, unread && styles.avatarTextUnread]}>{initials(senderName(item))}</Text></View>
    <View style={styles.rowMain}><View style={styles.rowHead}><Text style={[styles.sender, unread && styles.strong]} numberOfLines={1}>{senderName(item)}</Text><Text style={[styles.date, unread && styles.strong]}>{listDate(item.receivedAt || item.sentAt)}</Text></View><View style={styles.rowHead}><Text style={[styles.subject, unread && styles.strong]} numberOfLines={1}>{item.subject || '(без темы)'}</Text>{item.isFlagged && <Star size={14} color={c.warning} fill={c.warning} />}</View><View style={styles.previewLine}><Text style={styles.preview} numberOfLines={1}>{item.preview || 'Письмо без текста'}</Text>{item.hasAttachments && <Paperclip size={14} color={c.textTertiary} />}</View></View>
  </Pressable>;
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary}, center: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bgSecondary},
  top: {flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 14}, account: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, ...cardSurface(c), borderRadius: radius.lg, padding: 9}, compose: {width: 46, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary},
  accountMark: {width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primaryLight}, accountMarkText: {fontFamily: font.bold, fontSize: 14, color: c.primary}, accountText: {flex: 1, minWidth: 0}, accountName: {fontFamily: font.semiBold, fontSize: 13, color: c.textPrimary}, accountEmail: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 1},
  search: {height: 42, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 12, backgroundColor: c.bgPrimary, borderWidth: 1, borderColor: c.borderLight, borderRadius: radius.md}, searchInput: {flex: 1, paddingVertical: 0, fontFamily: font.regular, fontSize: 14, color: c.textPrimary},
  folders: {paddingHorizontal: 16, paddingVertical: 12, gap: 7}, folder: {paddingHorizontal: 12, paddingVertical: 7, borderRadius: 15, backgroundColor: c.bgPrimary, borderWidth: 1, borderColor: c.borderLight, maxWidth: 150}, folderActive: {backgroundColor: c.primary, borderColor: c.primary}, folderText: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary}, folderTextActive: {color: '#FFFFFF'},
  list: {paddingHorizontal: 16, gap: 8}, listEmpty: {flexGrow: 1, justifyContent: 'center'}, row: {...cardSurface(c), flexDirection: 'row', gap: 10, borderRadius: radius.lg, padding: 12}, rowUnread: {borderColor: c.primary}, avatar: {width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bgTertiary}, avatarUnread: {backgroundColor: c.primaryLight}, avatarText: {fontFamily: font.bold, fontSize: 14, color: c.textSecondary}, avatarTextUnread: {color: c.primary}, rowMain: {flex: 1, minWidth: 0}, rowHead: {flexDirection: 'row', alignItems: 'center', gap: 6}, sender: {flex: 1, fontFamily: font.medium, fontSize: 13, color: c.textPrimary}, date: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary}, subject: {flex: 1, fontFamily: font.regular, fontSize: 13, color: c.textPrimary, marginTop: 2}, strong: {fontFamily: font.semiBold}, previewLine: {flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3}, preview: {flex: 1, fontFamily: font.regular, fontSize: 12, color: c.textSecondary},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32, backgroundColor: c.bgSecondary}, noMessages: {alignItems: 'center', gap: 9}, emptyTitle: {fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary}, emptyText: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, textAlign: 'center'},
  scrim: {flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', justifyContent: 'flex-end'}, sheet: {padding: 16, paddingBottom: 28, backgroundColor: c.bgPrimary, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, gap: 6}, sheetRow: {flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.md, padding: 10}, sheetRowActive: {backgroundColor: c.primaryLight}, badge: {height: 22, minWidth: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary}, badgeText: {fontFamily: font.semiBold, fontSize: 11, color: '#FFFFFF'},
});
