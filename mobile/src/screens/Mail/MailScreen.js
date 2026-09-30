import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {
  Check, ChevronDown, Flag, FolderOpen, Inbox, Mail, Paperclip, PenSquare, Search, X,
} from 'lucide-react-native';

import BottomSheet from '../../components/BottomSheet';
import {mail as mailApi} from '../../services/api';
import {loadMailAccounts, setMailUnread, useMailAccounts} from '../../store/mailStore';
import {cardSurface, font, radius} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {folderTitle, isInbox, listDate, senderName} from './mailMeta';
import {AccountLogo, SenderAvatar, folderIcon} from './mailVisuals';

const PAGE = 50;

/**
 * Папки выбираются шторкой по кнопке рядом с ящиком, а не лентой под поиском.
 * Лента из двадцати папок общего ящика тянулась на несколько экранов вбок:
 * нужную приходилось искать прокруткой, а непрочитанное в дальних папках не
 * было видно вовсе. В шторке все папки видны столбиком вместе со счётчиками.
 */
export default function MailScreen({navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tabInset = useTabBarInset();
  const accounts = useMailAccounts();
  const [accountId, setAccountId] = useState(null);
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState(null); // 'accounts' | 'folders'
  const [query, setQuery] = useState('');
  // Запрос, по которому реально ищем. Поле ввода живёт отдельно: раньше поиск
  // уходил на сервер на каждую набранную букву, хотя ищут здесь по кнопке
  // «Найти» на клавиатуре.
  const [applied, setApplied] = useState('');
  const [searching, setSearching] = useState(false);
  const cursorRef = useRef(null);

  const account = useMemo(
    () => (accounts || []).find(item => item.id === accountId) || accounts?.[0],
    [accounts, accountId],
  );
  const folder = folders.find(item => item.id === folderId) || null;

  useEffect(() => {
    if (!accountId && accounts?.[0]) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const loadFolders = useCallback(async id => {
    if (!id) return [];
    const {data} = await mailApi.folders(id);
    const next = data?.folders || [];
    setFolders(next);
    setFolderId(old => old && next.some(item => item.id === old) ? old :
      (next.find(isInbox)?.id || next[0]?.id || null));
    return next;
  }, []);

  const loadMessages = useCallback(async ({silent = false} = {}) => {
    if (!accountId) return;
    if (!silent) setLoading(true);
    try {
      const text = applied.trim();
      const {data} = text
        ? await mailApi.search({q: text, accountId, folderId, limit: PAGE})
        : await mailApi.messages({accountId, folderId, limit: PAGE});
      setMessages(data?.messages || []);
      setHasMore(Boolean(data?.hasMore));
      cursorRef.current = text ? null : (data?.nextCursor || null);
    } catch (error) {
      setMessages([]);
      setHasMore(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setSearching(false);
    }
  }, [accountId, folderId, applied]);

  // Следующая страница — по курсору сервера (ver. 9.11). Раньше приложение
  // брало шестьдесят последних писем, и всё, что старше, было доступно только
  // поиском.
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading || !accountId) return;
    const text = applied.trim();
    setLoadingMore(true);
    try {
      const {data} = text
        ? await mailApi.search({q: text, accountId, folderId, limit: PAGE, offset: messages.length})
        : await mailApi.messages({accountId, folderId, limit: PAGE, cursor: cursorRef.current});
      const next = data?.messages || [];
      setMessages(old => {
        const seen = new Set(old.map(item => item.id));
        return [...old, ...next.filter(item => !seen.has(item.id))];
      });
      setHasMore(Boolean(data?.hasMore));
      if (!text) cursorRef.current = data?.nextCursor || null;
    } catch (error) {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, loading, accountId, folderId, applied, messages.length]);

  useEffect(() => {
    if (!accountId) return;
    loadFolders(accountId).catch(() => setFolders([]));
  }, [accountId, loadFolders]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  // Возврат на экран (из письма, где могли поставить флажок, перенести или
  // удалить) — тихо обновляем список и счётчики. Через ref, чтобы эффект
  // срабатывал именно на фокус, а не на каждую смену папки: смену и так
  // отрабатывает эффект выше, и список грузился бы дважды.
  const refreshOnFocus = useRef(null);
  refreshOnFocus.current = () => {
    loadMailAccounts({force: true});
    if (accountId) loadFolders(accountId).catch(() => {});
    loadMessages({silent: true});
  };
  const focusedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    if (focusedOnce.current) refreshOnFocus.current();
    focusedOnce.current = true;
  }, []));

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadMailAccounts({force: true}), loadFolders(accountId)]);
      await loadMessages({silent: true});
    } finally {
      setRefreshing(false);
    }
  };

  const submitSearch = () => {
    setSearching(true);
    // Тот же запрос ещё раз — состояние не меняется, и эффект не сработал бы.
    if (query === applied) loadMessages({silent: true});
    else { setMessages([]); setApplied(query); }
  };

  const chooseAccount = id => {
    setSheet(null);
    if (id === accountId) return;
    setAccountId(id);
    setFolderId(null);
    setFolders([]);
    setMessages([]);
  };

  const chooseFolder = id => {
    setSheet(null);
    if (id === folderId) return;
    setFolderId(id);
    setMessages([]);
  };

  // Флажок общий на ящик, как в вебе и в Roundcube: ставим сразу в списке, а
  // если сервер отказал — возвращаем как было.
  const toggleFlag = async item => {
    const next = !item.isFlagged;
    setMessages(old => old.map(m => m.id === item.id ? {...m, isFlagged: next} : m));
    try {
      await mailApi.setFlag(item.id, next ? 'flag' : 'unflag');
    } catch (error) {
      setMessages(old => old.map(m => m.id === item.id ? {...m, isFlagged: !next} : m));
    }
  };

  const openMessage = item => {
    if (!item.isSeen) {
      setMailUnread(accountId, Math.max(0, (account?.unread || 0) - 1));
      setMessages(old => old.map(m => m.id === item.id ? {...m, isSeen: true} : m));
    }
    navigation.navigate('MailMessage', {messageId: item.id, accountId, accountEmail: account?.email});
  };

  if (accounts === null || (loading && !accountId)) {
    return <View style={styles.center}><ActivityIndicator color={c.primary} /></View>;
  }

  if (!accounts?.length) {
    return <View style={styles.empty}><Mail size={34} color={c.textTertiary} /><Text style={styles.emptyTitle}>Почта пока не подключена</Text><Text style={styles.emptyText}>Администратор выдаёт доступ к общим ящикам.</Text></View>;
  }

  const FolderGlyph = folder ? folderIcon(folder) : FolderOpen;
  const otherFoldersUnread = folders.some(item => item.id !== folderId && item.unread > 0);

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <Pressable style={styles.account} onPress={() => setSheet('accounts')}>
          <AccountLogo account={account} size={34} />
          <View style={styles.accountText}>
            <Text style={styles.accountName} numberOfLines={1}>{account?.displayName || account?.email}</Text>
            <Text style={styles.accountEmail} numberOfLines={1}>{account?.email}</Text>
          </View>
          <ChevronDown size={18} color={c.textTertiary} />
        </Pressable>
        <Pressable style={styles.square} onPress={() => setSheet('folders')} accessibilityLabel="Папки ящика">
          <FolderOpen size={21} color={c.primary} />
          {otherFoldersUnread && <View style={styles.squareDot} />}
        </Pressable>
        <Pressable style={[styles.square, styles.compose]} onPress={() => navigation.navigate('MailCompose', {accountId: account.id, accountEmail: account.email})} accessibilityLabel="Новое письмо">
          <PenSquare size={21} color="#FFFFFF" />
        </Pressable>
      </View>

      <View style={styles.search}>
        <Search size={18} color={c.textTertiary} />
        <TextInput value={query} onChangeText={setQuery} onSubmitEditing={submitSearch} placeholder="Поиск в ящике" placeholderTextColor={c.textTertiary} returnKeyType="search" style={styles.searchInput} />
        {Boolean(query) && <Pressable onPress={() => { setQuery(''); if (applied) { setSearching(true); setApplied(''); } }} hitSlop={8}><X size={17} color={c.textTertiary} /></Pressable>}
      </View>

      <Pressable style={styles.folderCaption} onPress={() => setSheet('folders')}>
        <FolderGlyph size={15} color={c.textSecondary} />
        <Text style={styles.folderCaptionText} numberOfLines={1}>{folder ? folderTitle(folder) : 'Папка'}</Text>
        {folder?.unread > 0 && <Text style={styles.folderCaptionCount}>{folder.unread} непрочит.</Text>}
      </Pressable>

      <FlatList
        data={messages}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, {paddingBottom: tabInset + 20}, !messages.length && styles.listEmpty]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.more} color={c.primary} /> : null}
        ListEmptyComponent={loading || searching ? <ActivityIndicator color={c.primary} /> : <View style={styles.noMessages}><Inbox size={30} color={c.textTertiary} /><Text style={styles.emptyText}>{applied ? 'По этому запросу писем нет' : 'В этой папке писем нет'}</Text></View>}
        renderItem={({item}) => <MailRow item={item} c={c} styles={styles} onPress={() => openMessage(item)} onFlag={() => toggleFlag(item)} />}
      />

      <BottomSheet visible={sheet === 'accounts'} title="Почтовые ящики" onClose={() => setSheet(null)}>
        <ScrollView contentContainerStyle={styles.sheetList}>
          {accounts.map(item => (
            <Pressable key={item.id} style={[styles.sheetRow, item.id === account?.id && styles.sheetRowActive]} onPress={() => chooseAccount(item.id)}>
              <AccountLogo account={item} size={36} />
              <View style={styles.accountText}>
                <Text style={styles.accountName} numberOfLines={1}>{item.displayName || item.email}</Text>
                <Text style={styles.accountEmail} numberOfLines={1}>{item.email}</Text>
              </View>
              {item.unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{item.unread > 99 ? '99+' : item.unread}</Text></View>}
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>

      <BottomSheet visible={sheet === 'folders'} title={account?.displayName || 'Папки'} onClose={() => setSheet(null)}>
        <ScrollView contentContainerStyle={styles.sheetList}>
          {folders.map(item => {
            const Icon = folderIcon(item);
            const active = item.id === folderId;
            return (
              <Pressable key={item.id} style={[styles.folderRow, active && styles.sheetRowActive]} onPress={() => chooseFolder(item.id)}>
                <Icon size={19} color={active ? c.primary : c.textSecondary} />
                <Text style={[styles.folderName, active && styles.folderNameActive]} numberOfLines={1}>{folderTitle(item)}</Text>
                {item.unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{item.unread > 999 ? '999+' : item.unread}</Text></View>}
                {active && !item.unread && <Check size={18} color={c.primary} />}
              </Pressable>
            );
          })}
          {!folders.length && <ActivityIndicator style={styles.more} color={c.primary} />}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

/**
 * Строка письма — как в вебе: отправитель и тема в две строки, без начала
 * текста. Превью в общем ящике почти всегда «Добрый день, …» или подпись и
 * отнимало строку, которой теме как раз не хватало.
 */
function MailRow({item, c, styles, onPress, onFlag}) {
  const unread = !item.isSeen;
  return (
    <Pressable onPress={onPress} style={[styles.row, item.isFlagged && styles.rowFlagged, unread && styles.rowUnread]}>
      <SenderAvatar message={item} size={38} />
      <View style={styles.rowMain}>
        <View style={styles.rowHead}>
          <Text style={[styles.sender, unread && styles.strong]} numberOfLines={1}>{senderName(item)}</Text>
          <Text style={[styles.date, unread && styles.dateUnread]}>{listDate(item.receivedAt || item.sentAt)}</Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={[styles.subject, unread && styles.strong]} numberOfLines={2}>{item.subject || '(без темы)'}</Text>
          <View style={styles.markers}>
            {item.hasAttachments && <Paperclip size={14} color={c.textTertiary} />}
            <Pressable onPress={onFlag} hitSlop={10} accessibilityLabel={item.isFlagged ? 'Снять флажок' : 'Поставить флажок'}>
              <Flag size={15} color={item.isFlagged ? c.error : c.textTertiary} fill={item.isFlagged ? c.error : 'transparent'} />
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bgSecondary},
  top: {flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14},
  account: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, ...cardSurface(c), borderRadius: radius.lg, paddingVertical: 8, paddingLeft: 9, paddingRight: 10},
  square: {width: 50, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', ...cardSurface(c)},
  squareDot: {position: 'absolute', top: 10, right: 11, width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary},
  compose: {backgroundColor: c.primary, borderColor: c.primary},
  accountText: {flex: 1, minWidth: 0},
  accountName: {fontFamily: font.semiBold, fontSize: 13, color: c.textPrimary},
  accountEmail: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 1},
  search: {height: 42, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, paddingHorizontal: 12, backgroundColor: c.bgPrimary, borderWidth: 1, borderColor: c.borderLight, borderRadius: radius.md},
  searchInput: {flex: 1, paddingVertical: 0, fontFamily: font.regular, fontSize: 14, color: c.textPrimary},
  folderCaption: {flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 9},
  folderCaptionText: {flexShrink: 1, fontFamily: font.semiBold, fontSize: 13, color: c.textPrimary},
  folderCaptionCount: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary},
  list: {paddingHorizontal: 16, gap: 8},
  listEmpty: {flexGrow: 1, justifyContent: 'center'},
  more: {paddingVertical: 14},
  row: {...cardSurface(c), flexDirection: 'row', gap: 11, borderRadius: radius.lg, padding: 12},
  rowUnread: {borderColor: c.primary},
  // Письмо с флажком подкрашено, как в вебе: его ищут глазами в длинном
  // списке, и одной иконки справа для этого мало.
  rowFlagged: {backgroundColor: `${c.error}12`, borderColor: `${c.error}40`},
  rowMain: {flex: 1, minWidth: 0},
  rowHead: {flexDirection: 'row', alignItems: 'center', gap: 6},
  rowBody: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 3},
  sender: {flex: 1, fontFamily: font.medium, fontSize: 13, color: c.textPrimary},
  date: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary},
  dateUnread: {fontFamily: font.semiBold, color: c.primary},
  subject: {flex: 1, fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: c.textSecondary},
  strong: {fontFamily: font.semiBold, color: c.textPrimary},
  markers: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32, backgroundColor: c.bgSecondary},
  noMessages: {alignItems: 'center', gap: 9},
  emptyTitle: {fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary},
  emptyText: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, textAlign: 'center'},
  sheetList: {paddingHorizontal: 12, paddingBottom: 16, gap: 4},
  sheetRow: {flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: radius.md, padding: 10},
  sheetRowActive: {backgroundColor: c.primaryLight},
  folderRow: {flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12},
  folderName: {flex: 1, fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  folderNameActive: {fontFamily: font.semiBold, color: c.primary},
  badge: {height: 22, minWidth: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary},
  badgeText: {fontFamily: font.semiBold, fontSize: 11, color: '#FFFFFF'},
});
