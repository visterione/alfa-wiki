import React, {useEffect, useState, useRef, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
  Alert,
  Linking,
  ScrollView,
  Pressable,
  Dimensions,
  Switch,
  Share,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {launchImageLibrary, launchCamera} from 'react-native-image-picker';
import {pick as pickDocument} from '@react-native-documents/picker';
import {
  Send,
  Paperclip,
  Smile,
  X,
  Reply,
  Pencil,
  Trash2,
  Forward,
  Image as ImageIcon,
  Camera,
  File,
  FileText,
  Archive,
  Search,
  ChevronUp,
  ChevronDown,
  Mic,
  Check,
  CheckCheck,
  Play,
  Download,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  EyeOff,
  BarChart3,
  PlusCircle,
  CheckCircle2,
  Share2,
  Pin,
  PinOff,
  Clock,
  AlertCircle,
} from 'lucide-react-native';
import {chat as chatApi} from '../../services/api';
import SocketService from '../../services/socket';
import {setActiveChat, clearActiveChat} from '../../services/activeChat';
import VoiceRecorder from '../../services/voiceRecorder';
import VoiceMessage from '../../components/VoiceMessage';
import VoiceMiniPlayer from '../../components/VoiceMiniPlayer';
import MarqueeText from '../../components/MarqueeText';
import Avatar from '../../components/Avatar';
import UserBadge from '../../components/UserBadge';
import PollMessage from '../../components/PollMessage';
import LogoLoader from '../../components/LogoLoader';
import RichText from '../../components/RichText';
import MediaViewer from '../../components/MediaViewer';
import FadeInImage from '../../components/FadeInImage';
import {saveAttachment} from '../../services/downloads';
import {stripFormatting, toggleMarkup} from '../../utils/richText';
import {useAuth} from '../../store/authStore';
import avatarUrl from '../../utils/avatarUrl';
import CONFIG from '../../config';
import {radius, shadow, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import ChatBackground from '../../components/ChatBackground';
import {useSettings} from '../../store/settingsStore';

const {width: SCREEN_WIDTH} = Dimensions.get('window');

const REACTIONS = ['👍', '👎', '❤️', '😂', '😮', '🎉', '🔥'];
const COMMON_EMOJI = [
  '😀','😂','🥹','😊','😍','🤩','😎','🥳','😢','😭','😤','🤔',
  '👍','👎','👏','🙌','🤝','💪','🫡','🫶','❤️','🔥','⭐','✅',
  '❌','⚡','🎉','🎊','💯','🚀','💀','🤣',
];

// ── Helpers ──────────────────────────────────────────────────────────────────
// Единая сборка URL вложений — та же, что для аватаров (см. CONFIG.fileUrl)
const fixUrl = CONFIG.fileUrl;

function formatTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function formatDateSep(iso) {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDay.getTime() === today.getTime()) return 'Сегодня';
  if (msgDay.getTime() === yesterday.getTime()) return 'Вчера';
  return `${d.getDate()} ${['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'][d.getMonth()]} ${d.getFullYear()}`;
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function sameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate();
}

// Inject date separators into newest-first message array
function withSeparators(messages) {
  const result = [];
  for (let i = 0; i < messages.length; i++) {
    result.push({...messages[i], _itemType: 'message'});
    const next = messages[i + 1];
    if (!next || !sameDay(messages[i].createdAt, next.createdAt)) {
      result.push({
        _itemType: 'separator',
        _id: `sep_${i}_${messages[i].createdAt}`,
        date: messages[i].createdAt,
      });
    }
  }
  return result;
}

// ── Attachment renderer ───────────────────────────────────────────────────────
function Attachments({attachments, isOwn, onMediaPress, messageId, chatTitle, chatId}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (!attachments?.length) return null;

  // Голосовое приходит одним вложением и рисуется плеером, а не карточкой файла
  if (attachments.length === 1 && attachments[0]?.kind === 'voice') {
    const voice = attachments[0];
    return (
      <VoiceMessage
        uri={fixUrl(voice.url || voice.path)}
        duration={voice.duration}
        messageId={messageId}
        isOwn={isOwn}
        chatTitle={chatTitle}
        chatId={chatId}
      />
    );
  }

  return (
    <View style={styles.attachmentsWrap}>
      {attachments.map((att, idx) => {
        const url = fixUrl(att.url || att.path);
        const mime = att.mimeType || '';
        // filename — вложения заявок с сайта, отправленные до перехода на name
        const name = att.name || att.filename;

        if (mime.startsWith('image/')) {
          return (
            <FadeInImage
              key={idx}
              uri={url}
              style={styles.attachImage}
              onPress={() => onMediaPress({url, name, mimeType: mime, galleryKey: `${messageId}:${idx}`})}
            />
          );
        }

        // Видео открывается тем же просмотрщиком, что и фото, — там плеер.
        // Раньше оно уходило в браузер, и человек терял чат из виду.
        if (mime.startsWith('video/')) {
          return (
            <TouchableOpacity
              key={idx}
              style={styles.attachVideo}
              activeOpacity={0.85}
              onPress={() => onMediaPress({url, name, mimeType: mime, galleryKey: `${messageId}:${idx}`})}>
              <View style={styles.attachVideoPlay}>
                <Play size={22} color="#FFFFFF" fill="#FFFFFF" />
              </View>
              <Text style={styles.attachVideoName} numberOfLines={1}>
                {name} · {formatFileSize(att.size)}
              </Text>
            </TouchableOpacity>
          );
        }

        const FileIcon = mime.includes('pdf') ? FileText
          : mime.includes('zip') || mime.includes('rar') ? Archive
          : File;
        const iconColor = isOwn ? 'rgba(255,255,255,0.9)' : c.textPrimary;

        // Тап открывает файл, отдельная кнопка — сохраняет. Раньше был только
        // переход в браузер, и файл оставался «где-то там».
        return (
          <View key={idx} style={[styles.attachFile, isOwn && styles.attachFileOwn]}>
            <FileIcon size={22} color={iconColor} />
            <TouchableOpacity
              style={styles.attachFileInfo}
              onPress={() => url && Linking.openURL(url)}>
              <Text style={[styles.attachFileName, isOwn && styles.attachFileNameOwn]} numberOfLines={1}>{name}</Text>
              <Text style={[styles.attachFileSize, isOwn && styles.attachFileSizeOwn]}>{formatFileSize(att.size)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.attachDownload}
              hitSlop={8}
              onPress={() => saveAttachment({url, name, mimeType: mime})}>
              <Download size={18} color={iconColor} />
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Статус своего сообщения для галочек. Логика повторяет веб (Dashboard.js,
 * getMsgStatus), чтобы один и тот же чат не выглядел по-разному на телефоне
 * и в браузере:
 *   read      — собеседник открыл чат позже, чем пришло сообщение (две галочки)
 *   delivered — он в сети либо был в сети после отправки (одна яркая)
 *   sent      — ушло на сервер, но адресат ещё не появлялся (одна бледная)
 *
 * В группах статуса нет: «прочитано» там пришлось бы считать по каждому
 * участнику, и веб этого тоже не делает.
 */
function getMessageStatus({message, chatType, otherLastReadAt, otherIsOnline, otherLastSeen}) {
  // Сообщение в пути или не ушло — это важнее галочек и показывается всегда,
  // в том числе в группе, где обычных статусов доставки нет (ver. 7.34)
  if (message.failed) return 'failed';
  if (message.pending) return 'pending';
  if (chatType !== 'private') return null;
  const created = new Date(message.createdAt);
  if (otherLastReadAt && created <= new Date(otherLastReadAt)) return 'read';
  if (otherIsOnline) return 'delivered';
  if (otherLastSeen && created < new Date(otherLastSeen)) return 'delivered';
  return 'sent';
}

function MessageStatus({status}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (!status) return null;
  if (status === 'pending') {
    return <Clock size={13} color="rgba(255,255,255,0.55)" style={styles.msgStatus} />;
  }
  if (status === 'failed') {
    return <AlertCircle size={13} color={c.error} style={styles.msgStatus} />;
  }
  const Icon = status === 'read' ? CheckCheck : Check;
  // Бледная галочка = ещё не доставлено; яркая = доставлено или прочитано
  const color = status === 'sent' ? 'rgba(255,255,255,0.45)' : '#FFFFFF';
  return <Icon size={14} color={color} style={styles.msgStatus} />;
}

// ── Кнопки действий под сообщением бота ────────────────────────────────────
/**
 * Заявки с сайта приходят с кнопками: «Создать пациента в МИС», «Внести в реестр
 * справок». Что заявку уже взяли, видно по 👍 — его ставит сервер от нажавшего.
 */
function MessageActions({actions, isOwn, runningId, onPress}) {
  const styles = useThemedStyles(makeStyles);

  if (!actions?.length) return null;

  return (
    <View style={[styles.msgActions, isOwn && styles.msgActionsOwn]}>
      {actions.map(action => {
        const busy = runningId === action.id;
        return (
          <TouchableOpacity
            key={action.id}
            style={[styles.msgActionBtn, busy && styles.msgActionBtnBusy]}
            disabled={busy}
            onPress={() => onPress(action)}>
            {busy
              ? <LogoLoader width={40} color="#FFFFFF" />
              : <Text style={styles.msgActionText}>{action.label}</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const noop = () => {};

const MEDIA_TABS = [
  {key: 'media', label: 'Медиа'},
  {key: 'files', label: 'Файлы'},
  {key: 'voice', label: 'Голосовые'},
  {key: 'links', label: 'Ссылки'},
];

// Склонение для «Удалить 2 сообщения?» — иначе везде было бы «сообщений»
function pluralMessages(n) {
  const tail = n % 100 >= 11 && n % 100 <= 14 ? 0 : n % 10;
  if (tail === 1) return 'сообщение';
  if (tail >= 2 && tail <= 4) return 'сообщения';
  return 'сообщений';
}

// ── Message bubble ─────────────────────────────────────────────────────────
function MessageBubble({message, isOwn, chatType, isHighlighted, selectionMode, isSelected, onSelectToggle, onLongPress, onReactionTap, onMediaPress, onActionPress, onPollVote, onRetry, runningAction, status, chatTitle, chatId}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Масштаб шрифта — настройка для тех, кому мелкий текст неудобен
  const {scale} = useSettings();

  if (message.type === 'system') {
    return (
      <View style={styles.systemMsgWrap}>
        <Text style={styles.systemMsgText}>{message.content}</Text>
      </View>
    );
  }

  const isDeleted = message.content === 'Сообщение удалено';
  const hasText = Boolean(message.content) && message.type !== 'poll';
  // Ширина «дырки» под время. Фигурные пробелы (U+2007) имеют ширину цифры,
  // поэтому отступ совпадает с местом, которое займёт «12:34» и галочки.
  const hasReactions = message.reactions?.length > 0;
  // Отступ под время нужен, только когда времени негде встать иначе:
  // с реакциями оно уходит в общий с ними ряд
  const metaSpacer = hasReactions
    ? ''
    : '\u2007'.repeat(isOwn ? 9 : 6) + (message.isEdited ? '\u2007\u2007\u2007' : '');

  return (
    <Pressable
      onPress={selectionMode ? () => onSelectToggle(message) : undefined}
      onLongPress={() => !isDeleted && onLongPress(message)}
      style={[
        styles.bubbleRow,
        isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther,
        isHighlighted && styles.bubbleRowHighlighted,
        isSelected && styles.bubbleRowSelected,
      ]}>
      {selectionMode && (
        <View style={[styles.selectCheck, isSelected && styles.selectCheckOn]}>
          {isSelected && <Check size={13} color="#FFFFFF" />}
        </View>
      )}
      {!isOwn && chatType === 'group' && (
        <View style={styles.bubbleAvatar}>
          <Avatar uri={message.sender?.avatar} size={28} />
        </View>
      )}

      <View style={[styles.bubbleContent, isOwn ? {alignItems: 'flex-end'} : {alignItems: 'flex-start'}]}>
        {/* Forwarded label */}
        {/* Не ушло — предлагаем повторить прямо здесь: текст из строки ввода
            уже стёрт, и другого пути к нему у человека нет (ver. 7.34) */}
        {message.failed && (
          <TouchableOpacity style={styles.retryRow} onPress={() => onRetry?.(message)}>
            <AlertCircle size={12} color={c.error} />
            <Text style={styles.retryText}>Не отправлено · повторить</Text>
          </TouchableOpacity>
        )}
        {message.forwardedFrom && (
          <View style={[styles.forwardBadge, isOwn && styles.forwardBadgeOwn]}>
            <Forward size={11} color={isOwn ? 'rgba(255,255,255,0.75)' : c.textSecondary} style={{marginRight: 4}} />
            <Text style={[styles.forwardLabel, isOwn && styles.forwardLabelOwn]}>
              Переслано от {message.forwardedFrom.senderName || 'пользователя'}
            </Text>
          </View>
        )}

        {/* Reply to */}
        {message.replyTo && (
          <View style={[styles.replyBadge, isOwn && styles.replyBadgeOwn]}>
            <Text style={[styles.replyAuthor, isOwn && styles.replyAuthorOwn]} numberOfLines={1}>
              {message.replyTo.sender?.displayName || 'Сообщение'}
            </Text>
            <Text style={[styles.replyText, isOwn && styles.replyTextOwn]} numberOfLines={1}>
              {stripFormatting(message.replyTo.content)}
            </Text>
          </View>
        )}

        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
          {/* Автор — внутри пузырька, а не отдельной строкой над ним:
              так подпись явно принадлежит сообщению и не висит в воздухе */}
          {!isOwn && chatType === 'group' && message.sender && (
            <View style={styles.senderNameRow}>
              <Text style={styles.senderName} numberOfLines={1}>
                {message.sender.displayName || message.sender.username}
              </Text>
              <UserBadge badge={message.sender.chatBadge} size={14} />
            </View>
          )}

          {/* Attachments */}
          <Attachments
            attachments={message.attachments}
            isOwn={isOwn}
            onMediaPress={onMediaPress}
            messageId={message.id}
            chatTitle={chatTitle}
            chatId={chatId}
          />

          {message.type === 'poll' && <PollMessage message={message} isOwn={isOwn} onVote={optionIds => onPollVote(message.id, optionIds)} />}

          {/* Text content.
              В конце текста — невидимый отступ шириной под время: так время
              встаёт справа от последней строки, а не отдельным рядом под ней.
              Сообщения выходят ниже, и на экран их помещается больше. */}
          {(message.content && !isDeleted) ? (
            <Text style={[styles.msgText, isOwn && styles.msgTextOwn, {fontSize: 15 * scale, lineHeight: 21 * scale}]}>
              <RichText
                text={message.content}
                boldStyle={styles.msgTextBold}
                linkStyle={isOwn ? styles.msgLinkOwn : styles.msgLink}
              />
              <Text style={styles.metaSpacer}>{metaSpacer}</Text>
            </Text>
          ) : isDeleted ? (
            <Text style={styles.deletedText}>
              Сообщение удалено
              <Text style={styles.metaSpacer}>{metaSpacer}</Text>
            </Text>
          ) : null}

          <MessageActions
            actions={message.actions}
            isOwn={isOwn}
            runningId={runningAction}
            onPress={action => onActionPress(message, action)}
          />

          {/* Реакции слева, время справа — одной строкой под сообщением.
              Когда реакций нет, время ложится в невидимый отступ последней
              строки текста и своей строки не занимает. */}
          {hasReactions ? (
            <View style={styles.reactionsMetaRow}>
              <View style={styles.reactionsRow}>
                {message.reactions.map(r => {
                  // При одной реакции показываем, кто её поставил; при нескольких — счётчик
                  const single = r.count === 1 ? r.users?.[0] : null;
                  const singleAvatar = single ? avatarUrl(single.avatar) : null;
                  return (
                    <TouchableOpacity
                      key={r.emoji}
                      style={[styles.reactionChip, r.hasReacted && styles.reactionChipActive]}
                      onPress={() => onReactionTap(message.id, r.emoji, r.hasReacted)}>
                      {single && (
                        singleAvatar
                          ? <Image source={{uri: singleAvatar}} style={styles.reactionAvatar} />
                          : <View style={styles.reactionAvatarStub}>
                              <Text style={styles.reactionInitial}>
                                {(single.displayName || '?')[0].toUpperCase()}
                              </Text>
                            </View>
                      )}
                      {r.count > 1 && <Text style={styles.reactionCount}>{r.count}</Text>}
                      <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.bubbleMeta}>
                {message.isEdited && (
                  <Text style={[styles.editedLabel, isOwn && styles.editedLabelOwn]}>ред. </Text>
                )}
                <Text style={[styles.timeText, isOwn && styles.timeTextOwn]}>
                  {formatTime(message.createdAt)}
                </Text>
                {isOwn && !isDeleted && <MessageStatus status={status} />}
              </View>
            </View>
          ) : (
            <View style={[styles.bubbleMeta, hasText && styles.bubbleMetaFloating]}>
              {message.isEdited && (
                <Text style={[styles.editedLabel, isOwn && styles.editedLabelOwn]}>ред. </Text>
              )}
              <Text style={[styles.timeText, isOwn && styles.timeTextOwn]}>
                {formatTime(message.createdAt)}
              </Text>
              {isOwn && !isDeleted && <MessageStatus status={status} />}
            </View>
          )}
        </View>

      </View>
    </Pressable>
  );
}

/**
 * «был(а) …» для шапки приватного чата.
 *
 * Раньше в оффлайне писали просто «офлайн» — по нему нельзя понять, ушёл
 * человек минуту назад или неделю. Формат тот же, что в вебе.
 */
function formatLastSeen(iso) {
  if (!iso) return 'офлайн';
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'был(а) только что';
  if (min < 60) return `был(а) ${min} мин назад`;

  const time = d.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
  const today = new Date();
  const isSameDay = (a, b) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (isSameDay(d, today)) return `был(а) сегодня в ${time}`;

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, yesterday)) return `был(а) вчера в ${time}`;

  return `был(а) ${d.toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'})} в ${time}`;
}

function formatMemberCount(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'участник'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'участника'
    : 'участников';
  return `${count} ${word}`;
}

// ── Chat header title with avatar + status ───────────────────────────────────
function ChatHeaderTitle({name, avatar, isOnline, lastSeen, isTyping, chatType, memberCount = 0, onlineCount = 0, onPress}) {
  const headerStyles = useThemedStyles(makeHeaderStyles);

  // В группе шапка кликабельна и ведёт к участникам и настройкам
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={headerStyles.wrap} onPress={onPress} activeOpacity={0.7}>
      <View style={headerStyles.avatarWrap}>
        <Avatar uri={avatar} isGroup={chatType === 'group'} size={44} onNavbar />
        {chatType === 'private' && isOnline && <View style={headerStyles.onlineDot} />}
      </View>
      <View style={headerStyles.info}>
        <MarqueeText style={headerStyles.name}>{name || 'Чат'}</MarqueeText>
        {chatType === 'private' && (
          <Text style={headerStyles.status}>
            {isTyping ? 'печатает...' : isOnline ? 'онлайн' : formatLastSeen(lastSeen)}
          </Text>
        )}
        {chatType === 'group' && (
          <Text style={headerStyles.status}>{formatMemberCount(memberCount)} · {onlineCount} онлайн</Text>
        )}
      </View>
    </Wrapper>
  );
}

const makeHeaderStyles = c => StyleSheet.create({
  wrap: {flexDirection: 'row', alignItems: 'center', paddingVertical: 6},
  // Имя занимает всю оставшуюся ширину — бегущей строке нужна известная
  // граница, иначе ей не от чего отсчитывать переполнение
  info: {flex: 1, minWidth: 0},
  avatarWrap: {marginRight: 12, position: 'relative'},
  onlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#34C759', borderWidth: 1.5, borderColor: '#FFFFFF',
  },
  name: {fontSize: 17.5, color: '#FFFFFF', fontFamily: font.semiBold},
  status: {fontSize: 12.5, color: 'rgba(255,255,255,0.75)', fontFamily: font.regular, marginTop: 1},
});

// ── Main screen ──────────────────────────────────────────────────────────────
export default function ChatScreen({route, navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  /**
   * Строка ввода — единственный элемент чата, прижатый к нижнему краю окна:
   * панель вкладок здесь скрыта (см. HIDDEN_ROUTES в AlfaTabBar), а окно
   * рисуется под системной панелью навигации. На аппаратах с тремя кнопками
   * (Samsung) она перекрывала поле ввода, поэтому отступ считаем от вставки.
   *
   * Минимум в 12 нужен для жестовой навигации и для случая с открытой
   * клавиатурой: окно ужимается, вставка обнуляется, и без него кнопки
   * прижимались бы вплотную к клавиатуре.
   */
  const insets = useSafeAreaInsets();
  const inputBarStyle = useMemo(
    () => [styles.inputBar, {paddingBottom: Math.max(insets.bottom, 12)}],
    [styles, insets.bottom],
  );

  // Меню-«шторки» прижаты к тому же краю и требуют той же поправки, но свой
  // отступ у них уже есть — добавляем только высоту системной панели.
  const attachMenuStyle = useMemo(
    () => [styles.attachMenu, {paddingBottom: 24 + insets.bottom}],
    [styles, insets.bottom],
  );
  const contextMenuStyle = useMemo(
    () => [styles.contextMenu, {paddingBottom: 16 + insets.bottom}],
    [styles, insets.bottom],
  );

  const {chatId} = route.params;
  const {user} = useAuth();

  // Из списка чатов шапка приезжает готовой. По тапу на уведомление известен
  // только chatId — остальное дозагружаем, иначе шапка будет пустой.
  const [meta, setMeta] = useState({
    chatName: route.params.chatName,
    chatType: route.params.chatType,
    chatAvatar: route.params.chatAvatar,
    otherUserId: route.params.otherUserId,
    groupMembers: route.params.groupMembers || [],
  });
  const {chatName, chatType, chatAvatar, otherUserId, groupMembers = []} = meta;
  const groupOnlineCount = groupMembers.filter(member => member.user?.isOnline).length;
  // Создатель группы заводится сразу с ролью admin (см. POST /chat/group),
  // поэтому отдельная проверка createdBy здесь не нужна
  const isGroupAdmin = groupMembers.some(
    member => String(member.userId) === String(user?.id) && member.role === 'admin',
  );

  const [isOnline, setIsOnline] = useState(route.params.otherUserIsOnline ?? false);

  // Прочитано ли собеседником и когда он последний раз был в сети — из этих
  // двух значений складывается статус галочек у своих сообщений
  const [otherLastReadAt, setOtherLastReadAt] = useState(route.params.otherMemberLastReadAt ?? null);
  const [otherLastSeen, setOtherLastSeen] = useState(route.params.otherUserLastSeen ?? null);

  useEffect(() => {
    if (meta.chatName && (meta.chatType !== 'group' || meta.groupMembers?.length > 0)) return;
    let cancelled = false;
    chatApi.list().then(res => {
      const found = (res.data || []).find(c => String(c.id) === String(chatId));
      if (!found || cancelled) return;
      setMeta({
        chatName: found.displayName || found.name,
        chatType: found.type,
        chatAvatar: found.type === 'private' ? found.otherUser?.avatar || found.avatar : found.avatar,
        otherUserId: found.otherUser?.id,
        groupMembers: found.type === 'group' ? (found.members || []) : [],
      });
      setIsOnline(found.otherUser?.isOnline ?? false);
      setOtherLastReadAt(found.otherMemberLastReadAt ?? null);
      setOtherLastSeen(found.otherUser?.lastSeen ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [chatId, meta.chatName, meta.chatType, meta.groupMembers?.length]);

  const [isTyping, setIsTyping] = useState(false);
  const typingTimer = useRef(null);      // incoming typing auto-clear
  const sendTypingTimer = useRef(null);  // outgoing typing_stop debounce

  const [messages, setMessages] = useState([]); // newest-first
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionTargets, setMentionTargets] = useState([]);
  const [selectedMentions, setSelectedMentions] = useState([]);

  // Выделение в поле ввода — от него зависит панель форматирования.
  // forcedSelection задаётся только на один кадр, чтобы вернуть выделение после
  // вставки маркеров: держать selection управляемым постоянно нельзя — на
  // Android каретка начинает прыгать в конец при каждом наборе символа
  const [selection, setSelection] = useState({start: 0, end: 0});
  const [forcedSelection, setForcedSelection] = useState(null);

  // Кнопка под сообщением бота, которая сейчас выполняется
  const [runningAction, setRunningAction] = useState(null);

  // In-chat search
  const flatListRef = useRef(null);
  const searchInputRef = useRef(null);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState([]);
  const [searchIdx, setSearchIdx] = useState(0);
  const [highlightedMsgId, setHighlightedMsgId] = useState(null);

  // Modes
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  // Режим выделения (ver. 7.29). Раньше здесь лежал forwardMode, который
  // никто не включал: выделение существовало только внутри модалки пересылки.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState([]);
  // Закреплённые (ver. 7.33): в шапке одно, нажатие уводит к нему в ленте и
  // переключает на следующее
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [pinnedIndex, setPinnedIndex] = useState(0);

  // Галерея чата (ver. 7.35). Список приходит с сервера, а не собирается из
  // загруженной ленты: до этого «медиа чата» показывало только подгруженное.
  const [mediaPanel, setMediaPanel] = useState(null);
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);

  // Pending attachments (before sending)
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  // UI modals
  const [contextMenu, setContextMenu] = useState(null); // {message}
  const [showReactionPicker, setShowReactionPicker] = useState(null); // messageId
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showPollEditor, setShowPollEditor] = useState(false);
  const [pollDraft, setPollDraft] = useState({question: '', options: ['', ''], multipleChoice: false, anonymous: true});
  const [mediaItem, setMediaItem] = useState(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [chatsList, setChatsList] = useState([]);

  // Запись голосового
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  // ── Load messages ──────────────────────────────────────────────────────────
  // cursor — самое старое из уже загруженных сообщений. Одной метки времени
  // мало: сообщения, попавшие в одну миллисекунду, на стыке страниц терялись
  // (ver. 7.30), поэтому вместе с ней уходит и id.
  const loadMessages = useCallback(async (cursor = null) => {
    try {
      const params = {limit: 50};
      if (cursor) {
        params.before = cursor.createdAt;
        params.beforeId = cursor.id;
      }
      const res = await chatApi.getMessages(chatId, params);
      const raw = Array.isArray(res.data) ? res.data : (res.data.messages ?? []);
      // Backend: ORDER DESC then .reverse() → oldest-first (ASC)
      // We need newest-first for inverted FlatList → reverse again
      const fetched = [...raw].reverse();
      if (raw.length < 50) setHasMore(false);
      if (cursor) {
        // fetched = older messages, newest-first → append to END (visually: top)
        setMessages(prev => {
          const ids = new Set(prev.map(m => m.id));
          return [...prev, ...fetched.filter(m => !ids.has(m.id))];
        });
      } else {
        setMessages(fetched);
      }
    } catch (err) {
      console.warn('[Chat] load error:', err?.response?.data || err.message);
    }
  }, [chatId]);

  useEffect(() => {
    loadMessages().finally(() => setLoading(false));
    chatApi.markAsRead(chatId).catch(() => {});
    // Join socket room for typing indicators
    SocketService.emit('join_chat', {chatId});
    // Пока экран открыт, уведомления об этом чате не показываем — сообщение
    // и так видно в ленте
    setActiveChat(chatId);
    return () => {
      SocketService.emit('leave_chat', {chatId});
      clearActiveChat();
    };
  }, [chatId, loadMessages]);

  useEffect(() => {
    let cancelled = false;
    setSelectedMentions([]);
    if (chatType !== 'group') {
      setMentionTargets([]);
      return undefined;
    }
    chatApi.getMentionTargets(chatId)
      .then(res => { if (!cancelled) setMentionTargets(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { if (!cancelled) setMentionTargets([]); });
    return () => { cancelled = true; };
  }, [chatId, chatType]);

  // Update header whenever online/typing/searchMode state changes
  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <ChatHeaderTitle
          name={chatName}
          avatar={chatAvatar}
          isOnline={isOnline}
          lastSeen={otherLastSeen}
          isTyping={isTyping}
          chatType={chatType}
          memberCount={groupMembers.length}
          onlineCount={groupOnlineCount}
          onPress={chatType === 'group' ? () => navigation.navigate('ChatInfo', {chatId}) : undefined}
        />
      ),
      headerRight: () => (
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          {!searchMode && (
            <TouchableOpacity
              style={{padding: 4}}
              onPress={() => openMediaPanel('media')}>
              <ImageIcon size={21} color="#FFFFFF" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={{padding: 4, marginRight: 4}}
            onPress={() => setSearchMode(v => !v)}>
            {searchMode
              ? <X size={22} color="#FFFFFF" />
              : <Search size={22} color="#FFFFFF" />}
          </TouchableOpacity>
        </View>
      ),
    });
  // openMediaPanel в зависимости не берём намеренно: он объявлен ниже по файлу,
  // и обращение к нему в массиве зависимостей (он считается на рендере) упало бы
  // до инициализации. Тело эффекта выполняется позже и видит его нормально.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, chatName, chatAvatar, isOnline, otherLastSeen, isTyping, chatType, searchMode, chatId, groupMembers.length, groupOnlineCount]);

  // Online status + typing listeners
  useEffect(() => {
    SocketService.on('chat:user_status', 'user_status_changed', data => {
      if (String(data.userId) === String(otherUserId)) {
        setIsOnline(data.isOnline);
        // Ушёл в оффлайн — сервер прислал время выхода; по нему считается,
        // что сообщения до этого момента точно были доставлены
        if (data.lastSeen) setOtherLastSeen(data.lastSeen);
      }
      if (chatType === 'group') {
        setMeta(current => ({
          ...current,
          groupMembers: (current.groupMembers || []).map(member =>
            String(member.userId) === String(data.userId)
              ? {...member, user: {...member.user, isOnline: Boolean(data.isOnline)}}
              : member,
          ),
        }));
      }
    });

    // Собеседник открыл чат и прочитал сообщения. Раньше мобилка это событие
    // не слушала вовсе, поэтому статус прочтения не обновлялся.
    SocketService.on('chat:messages_read', 'messages_read', data => {
      if (String(data.chatId) === String(chatId) && String(data.readBy) !== String(user?.id)) {
        setOtherLastReadAt(data.lastReadAt);
      }
    });
    SocketService.on('chat:user_typing', 'user_typing', data => {
      if (String(data.chatId) === String(chatId) && String(data.userId) !== String(user?.id)) {
        setIsTyping(data.isTyping);
        if (data.isTyping) {
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setIsTyping(false), 4000);
        }
      }
    });
    return () => {
      SocketService.off('chat:user_status');
      SocketService.off('chat:user_typing');
      SocketService.off('chat:messages_read');
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (sendTypingTimer.current) clearTimeout(sendTypingTimer.current);
    };
  }, [chatId, otherUserId, user, chatType]);

  // ── Socket real-time ───────────────────────────────────────────────────────
  useEffect(() => {
    const handleNewMessage = data => {
      // Backend emits {message, chat: {id, ...}} — chatId is at data.chat.id
      const incomingChatId = data.chat?.id ?? data.chatId;
      if (String(incomingChatId) !== String(chatId)) return;
      setMessages(prev => {
        if (prev.some(m => m.id === data.message.id)) return prev;
        return [data.message, ...prev]; // prepend newest-first
      });
      chatApi.markAsRead(chatId).catch(() => {});
    };

    const handleReactionUpdate = data => {
      const incomingChatId = data.chat?.id ?? data.chatId;
      if (String(incomingChatId) !== String(chatId)) return;
      // Сервер шлёт всем один список поставивших (ver. 7.28), «моя ли реакция»
      // считаем на месте. Заодно вернулся users — без него после реакции по
      // сокету пропадала аватарка на чипе с единственной реакцией.
      const reactions = (data.reactions || []).map(r => ({
        ...r,
        hasReacted: (r.users || []).some(u => String(u.id) === String(user?.id)),
      }));
      setMessages(prev =>
        prev.map(m => m.id === data.messageId ? {...m, reactions} : m),
      );
    };

    const handleMsgEdit = data => {
      const incomingChatId = data.chat?.id ?? data.chatId;
      if (String(incomingChatId) !== String(chatId)) return;
      setMessages(prev =>
        prev.map(m => m.id === data.messageId ? {...m, content: data.content, isEdited: true} : m),
      );
    };

    // Сообщения удалили: у всех — кем-то из участников, «у себя» — собой же с
    // другого устройства. Заглушек «Сообщение удалено» больше нет (ver. 7.29),
    // поэтому и в том и в другом случае строки просто исчезают.
    const handleMsgsDeleted = data => {
      const incomingChatId = data.chat?.id ?? data.chatId;
      if (String(incomingChatId) !== String(chatId)) return;
      const ids = data.messageIds || [];
      setMessages(prev => prev
        .filter(m => !ids.includes(m.id))
        .map(m => ids.includes(m.replyTo?.id) ? {...m, replyTo: null, replyToId: null} : m));
      setPinnedMessages(prev => prev.filter(m => !ids.includes(m.id)));
    };

    const handlePollUpdated = data => {
      if (String(data.chatId) !== String(chatId)) return;
      setMessages(prev => prev.map(message => message.id === data.message.id ? data.message : message));
    };

    SocketService.on('chat:new_message', 'new_message', handleNewMessage);
    SocketService.on('chat:reaction_updated', 'message_reaction_updated', handleReactionUpdate);
    SocketService.on('chat:msg_edited', 'message_edited', handleMsgEdit);
    SocketService.on('chat:msg_deleted', 'messages_deleted', handleMsgsDeleted);
    const handlePinChanged = data => {
      if (String(data.chatId) !== String(chatId)) return;
      setPinnedMessages(prev => {
        const without = prev.filter(m => m.id !== data.messageId);
        return data.pinned && data.message ? [data.message, ...without] : without;
      });
      setPinnedIndex(0);
      setMessages(prev => prev.map(m => m.id === data.messageId
        ? {...m, pinnedAt: data.pinned ? (data.message?.pinnedAt ?? new Date().toISOString()) : null}
        : m));
    };

    SocketService.on('chat:poll_updated', 'poll_updated', handlePollUpdated);
    SocketService.on('chat:pin_changed', 'message_pin_changed', handlePinChanged);

    return () => {
      SocketService.off('chat:new_message');
      SocketService.off('chat:reaction_updated');
      SocketService.off('chat:msg_edited');
      SocketService.off('chat:msg_deleted');
      SocketService.off('chat:poll_updated');
      SocketService.off('chat:pin_changed');
    };
  }, [chatId, user?.id]);

  // ── In-chat search ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (searchMode) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    } else {
      setSearchQuery('');
      setSearchHits([]);
      setSearchIdx(0);
      setHighlightedMsgId(null);
    }
  }, [searchMode]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchHits([]);
      setHighlightedMsgId(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await chatApi.searchMessages(chatId, q);
        setSearchHits(res.data);
        setSearchIdx(0);
      } catch {}
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, chatId]);

  useEffect(() => {
    if (!searchHits.length) return;
    const target = searchHits[searchIdx];
    if (!target) return;
    setHighlightedMsgId(target.id);
    // Find in loaded messages
    const listIdx = listData.findIndex(item => item.id === target.id);
    if (listIdx !== -1) {
      flatListRef.current?.scrollToIndex({index: listIdx, animated: true, viewPosition: 0.5});
    } else if (hasMore) {
      // Message not loaded yet — load more and retry
      loadMore();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchIdx, searchHits]);

  // ── Load more (older messages) ─────────────────────────────────────────────
  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || messages.length === 0) return;
    const oldest = messages[messages.length - 1]; // oldest = last in newest-first array
    setLoadingMore(true);
    loadMessages(oldest).finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore, messages, loadMessages]);

  // Есть ли что отправлять — от этого зависит, микрофон в строке ввода или самолётик
  const hasContent = text.trim().length > 0 || pendingFiles.length > 0;
  const mentionMatch = !editingMessage && chatType === 'group' && text.match(/(?:^|\s)@([^@\n]*)$/);
  const mentionQuery = mentionMatch?.[1]?.trim().toLowerCase() || '';
  const visibleMentions = mentionMatch
    ? mentionTargets.filter(item => item.label.toLowerCase().includes(mentionQuery)).slice(0, 6)
    : [];

  const chooseMention = item => {
    const at = text.lastIndexOf('@');
    setText(`${at >= 0 ? text.slice(0, at) : text}@${item.label} `);
    setSelectedMentions(prev => prev.some(m => m.targetId === item.targetId) ? prev : [...prev, item]);
  };

  // ── Голосовые сообщения ────────────────────────────────────────────────────
  const startVoiceRecording = async () => {
    // Обнуляем счётчик ДО старта. Раньше это стояло после await: пока
    // startRecorder разрешался, слушатель успевал прислать первые тики, и
    // затем они затирались нулём — таймер показывал секунду и падал обратно.
    setRecordSeconds(0);
    setRecording(true);

    const started = await VoiceRecorder.start(sec => setRecordSeconds(sec));
    if (!started) {
      setRecording(false);
      Alert.alert('Микрофон недоступен', 'Разрешите доступ к микрофону в настройках системы');
    }
  };

  const finishVoiceRecording = async (send) => {
    const uri = await VoiceRecorder.stop();
    setRecording(false);
    const seconds = recordSeconds;
    setRecordSeconds(0);

    if (!send || !uri) return;
    // Меньше секунды — почти всегда случайное касание, а не сообщение
    if (seconds < 1) return;

    try {
      setSending(true);
      const {data: att} = await chatApi.uploadVoice(uri, seconds);
      const res = await chatApi.sendMessage(chatId, '', [att], replyTo?.id ?? null);
      setMessages(prev => [res.data, ...prev]);
      setReplyTo(null);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось отправить голосовое сообщение');
    } finally {
      setSending(false);
    }
  };

  // ── Send message ───────────────────────────────────────────────────────────
  const handleSend = async () => {
    const content = text.trim();
    if (!content && pendingFiles.length === 0) return;
    if (sending) return;

    setSending(true);
    const savedText = content;
    const savedFiles = [...pendingFiles];
    const savedMentions = selectedMentions.filter(item => content.includes(`@${item.label}`));
    setText('');
    setSelectedMentions([]);
    setPendingFiles([]);
    setShowEmojiPicker(false);

    try {
      if (editingMessage) {
        await chatApi.editMessage(chatId, editingMessage.id, content);
        setMessages(prev =>
          prev.map(m => m.id === editingMessage.id ? {...m, content, isEdited: true} : m),
        );
        setEditingMessage(null);
        return;
      }

      let attachments = [];
      if (savedFiles.length > 0) {
        setUploading(true);
        try {
          const res = await chatApi.uploadFiles(chatId, savedFiles);
          attachments = res.data;
        } catch {
          Alert.alert('Ошибка', 'Не удалось загрузить файлы');
          setPendingFiles(savedFiles);
          setText(savedText);
          return;
        } finally {
          setUploading(false);
        }
      }

      const currentReply = replyTo;
      setReplyTo(null);

      // Оптимистичная отправка (ver. 7.34): сообщение встаёт в ленту сразу, с
      // часиками вместо галочки. Вложения так не показываем — их ещё грузить,
      // и локальный file:// в пузыре всё равно не отобразится.
      const optimistic = attachments.length === 0 ? {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        chatId,
        senderId: user?.id,
        content,
        type: 'text',
        attachments: [],
        createdAt: new Date().toISOString(),
        sender: {id: user?.id, displayName: user?.displayName, username: user?.username, avatar: user?.avatar},
        replyTo: currentReply || null,
        replyToId: currentReply?.id ?? null,
        reactions: [],
        pending: true,
        draft: {content, attachments, replyToId: currentReply?.id ?? null, mentions: savedMentions},
      } : null;

      if (optimistic) setMessages(prev => [optimistic, ...prev]);

      await deliverMessage(optimistic, {content, attachments, replyToId: currentReply?.id ?? null, mentions: savedMentions});
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось отправить сообщение');
      setText(savedText);
      setSelectedMentions(savedMentions);
      setPendingFiles(savedFiles);
    } finally {
      setSending(false);
    }
  };

  // Доставка отдельно от handleSend: тем же путём идёт повтор по кнопке
  // «повторить» у неудавшегося сообщения.
  const deliverMessage = async (optimistic, draft) => {
    try {
      const res = await chatApi.sendMessage(chatId, draft.content, draft.attachments, draft.replyToId, draft.mentions);
      setMessages(prev => {
        if (optimistic) {
          return prev.map(m => m.id === optimistic.id ? res.data : m);
        }
        return prev.some(m => m.id === res.data.id) ? prev : [res.data, ...prev];
      });
    } catch (err) {
      if (!optimistic) throw err;
      setMessages(prev => prev.map(m => m.id === optimistic.id
        ? {...m, pending: false, failed: true}
        : m));
    }
  };

  const retrySend = useCallback(async msg => {
    if (!msg?.draft) return;
    setMessages(prev => prev.map(m => m.id === msg.id ? {...m, failed: false, pending: true} : m));
    await deliverMessage(msg, msg.draft);
  // deliverMessage замкнут на chatId, который на экране не меняется
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // ── File/image picking ─────────────────────────────────────────────────────
  const pickFromGallery = () => {
    setShowAttachMenu(false);
    launchImageLibrary({mediaType: 'mixed', selectionLimit: 10, includeBase64: false}, res => {
      if (res.didCancel || res.errorCode) return;
      const files = (res.assets || []).map(a => ({
        uri: a.uri,
        type: a.type || 'image/jpeg',
        name: a.fileName || `photo_${Date.now()}.jpg`,
        size: a.fileSize,
      }));
      setPendingFiles(prev => [...prev, ...files].slice(0, 10));
    });
  };

  const pickFromCamera = () => {
    setShowAttachMenu(false);
    launchCamera({mediaType: 'photo', includeBase64: false}, res => {
      if (res.didCancel || res.errorCode) return;
      const a = res.assets?.[0];
      if (!a) return;
      setPendingFiles(prev =>
        [...prev, {uri: a.uri, type: a.type || 'image/jpeg', name: a.fileName || `photo_${Date.now()}.jpg`, size: a.fileSize}].slice(0, 10),
      );
    });
  };

  const pickFile = async () => {
    setShowAttachMenu(false);
    try {
      const results = await pickDocument({allowMultiSelection: true});
      const files = results.map(r => ({uri: r.uri, type: r.type, name: r.name, size: r.size}));
      setPendingFiles(prev => [...prev, ...files].slice(0, 10));
    } catch {}
  };

  const createPoll = async () => {
    const options = pollDraft.options.map(value => value.trim()).filter(Boolean);
    if (!pollDraft.question.trim() || options.length < 2) {
      Alert.alert('Заполните опрос', 'Укажите вопрос и минимум два варианта ответа');
      return;
    }
    try {
      setSending(true);
      const {data} = await chatApi.createPoll(chatId, {...pollDraft, question: pollDraft.question.trim(), options});
      setMessages(prev => prev.some(message => message.id === data.id) ? prev : [data, ...prev]);
      setShowPollEditor(false);
      setPollDraft({question: '', options: ['', ''], multipleChoice: false, anonymous: true});
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.error || 'Не удалось создать опрос');
    } finally {
      setSending(false);
    }
  };

  const votePoll = async (messageId, optionIds) => {
    try {
      const {data} = await chatApi.votePoll(chatId, messageId, optionIds);
      setMessages(prev => prev.map(message => message.id === messageId ? data : message));
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.error || 'Не удалось сохранить голос');
    }
  };

  // ── Форматирование текста ──────────────────────────────────────────────────
  // Панель появляется над строкой ввода, пока в ней что-то выделено.
  // Набор разметки тот же, что в вебе (см. utils/richText)

  const FORMAT_BUTTONS = [
    {d: '*', Icon: Bold, label: 'Жирный'},
    {d: '_', Icon: Italic, label: 'Курсив'},
    {d: '__', Icon: Underline, label: 'Подчёркнутый'},
    {d: '~', Icon: Strikethrough, label: 'Зачёркнутый'},
    {d: '||', Icon: EyeOff, label: 'Спойлер'},
    {d: '`', Icon: Code, label: 'Моноширинный'},
  ];

  const applyFormat = delimiter => {
    const {start, end} = selection;
    if (start === end) return;

    const next = toggleMarkup(text, start, end, delimiter);
    setText(next.text);
    setSelection({start: next.start, end: next.end});
    setForcedSelection({start: next.start, end: next.end});
  };

  // ── Message actions ────────────────────────────────────────────────────────
  const handleLongPress = msg => {
    setContextMenu({message: msg});
  };

  const startEdit = msg => {
    setContextMenu(null);
    setEditingMessage(msg);
    setText(msg.content);
  };

  const cancelEdit = () => {
    setEditingMessage(null);
    setText('');
  };

  // ── Галерея чата ───────────────────────────────────────────────────────────
  const openMediaPanel = useCallback(async kind => {
    setMediaPanel(kind);
    setMediaLoading(true);
    setMediaItems([]);
    try {
      const {data} = await chatApi.getChatMedia(chatId, kind, {limit: 100});
      setMediaItems(data);
    } catch {
      Alert.alert('Ошибка', 'Не удалось загрузить');
    } finally {
      setMediaLoading(false);
    }
  }, [chatId]);

  // ── Закреплённые сообщения ─────────────────────────────────────────────────
  const loadPinned = useCallback(async () => {
    try {
      const {data} = await chatApi.getPinned(chatId);
      setPinnedMessages(data);
      setPinnedIndex(0);
    } catch {
      setPinnedMessages([]);
    }
  }, [chatId]);

  useEffect(() => { loadPinned(); }, [loadPinned]);

  // В группе закрепляет админ, в личной переписке — любой из двоих.
  // Те же правила на сервере, в services/messagePermissions.js.
  const canPinHere = user?.isAdmin || chatType === 'private' || isGroupAdmin;

  // Переход к сообщению в ленте. То же, что делает поиск: подсветить и
  // прокрутить, а если сообщение ещё не подгружено — доложить страницу.
  const jumpToMessage = useCallback(messageId => {
    setHighlightedMsgId(messageId);
    const listIdx = listDataRef.current.findIndex(item => item.id === messageId);
    if (listIdx !== -1) {
      flatListRef.current?.scrollToIndex({index: listIdx, animated: true, viewPosition: 0.5});
    }
  }, []);

  const togglePin = async (msg, pin) => {
    setContextMenu(null);
    try {
      await chatApi.pinMessage(chatId, msg.id, pin);
    } catch (e) {
      Alert.alert('Ошибка', e.response?.data?.error || 'Не удалось изменить закрепление');
    }
  };

  // ── Выделение сообщений ────────────────────────────────────────────────────
  const startSelection = msg => {
    setContextMenu(null);
    setSelectionMode(true);
    setSelected([msg.id]);
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelected([]);
  };

  const toggleSelect = useCallback(msg => {
    setSelected(prev => prev.includes(msg.id)
      ? prev.filter(id => id !== msg.id)
      : [...prev, msg.id]);
  }, []);

  // Те же правила, что на сервере (canDeleteForAll в backend/routes/chat.js):
  // здесь они решают только, показывать ли кнопку «У всех».
  const DELETE_FOR_ALL_WINDOW_MS = 48 * 60 * 60 * 1000;

  const canDeleteForAll = msg => {
    if (!msg || msg.type === 'system') return false;
    if (user?.isAdmin) return true;
    if (chatType === 'group' && isGroupAdmin) return true;
    if (String(msg.senderId) !== String(user?.id)) return false;
    return Date.now() - new Date(msg.createdAt).getTime() <= DELETE_FOR_ALL_WINDOW_MS;
  };

  const doDelete = async (ids, scope) => {
    try {
      await chatApi.deleteMessages(chatId, ids, scope);
      // Своё удаление сокетом обратно не приходит — убираем сразу
      setMessages(prev => prev
        .filter(m => !ids.includes(m.id))
        .map(m => ids.includes(m.replyTo?.id) ? {...m, replyTo: null, replyToId: null} : m));
      cancelSelection();
    } catch (e) {
      Alert.alert('Ошибка', e.response?.data?.error || 'Не удалось удалить');
    }
  };

  // Заглушек «Сообщение удалено» больше нет: удаление либо прячет сообщение у
  // себя, либо стирает его у всех — см. ver. 7.29.
  const confirmDelete = msgs => {
    const list = msgs.filter(Boolean);
    if (list.length === 0) return;
    setContextMenu(null);

    const ids = list.map(m => m.id);
    const many = list.length > 1;
    const buttons = [
      {text: 'Отмена', style: 'cancel'},
      {text: 'У себя', onPress: () => doDelete(ids, 'me')},
    ];
    if (list.every(canDeleteForAll)) {
      buttons.push({text: 'У всех', style: 'destructive', onPress: () => doDelete(ids, 'all')});
    }

    Alert.alert(
      many ? `Удалить ${list.length} ${pluralMessages(list.length)}?` : 'Удалить сообщение?',
      many
        ? '«У себя» — пропадут только из вашей переписки, у остальных останутся.'
        : '«У себя» — пропадёт только из вашей переписки, у остальных останется.',
      buttons,
    );
  };

  // На телефоне вместо буфера обмена — системное «Поделиться»: библиотеки
  // Clipboard в проекте нет, а тащить нативную зависимость ради одной кнопки
  // не стоит. Отправить текст себе в заметки через шторку даже удобнее.
  const shareSelected = async () => {
    const text = messages
      .filter(m => selected.includes(m.id))
      .map(m => stripFormatting(m.content || ''))
      .filter(Boolean)
      .join('\n');
    if (!text) {
      Alert.alert('Нечего копировать', 'В выделенном нет текста');
      return;
    }
    try {
      await Share.share({message: text});
      cancelSelection();
    } catch {}
  };

  /**
   * Нажатие кнопки под сообщением бота. От нажавшего сервер ставит 👍 — по нему
   * в чате и видно, что заявку уже взяли.
   *
   * Создание пациента переспрашиваем: в МИС оно необратимо, а кнопку в общем
   * чате видят все. Страницы реестра справок в приложении нет — уводим в браузер
   * по тому же адресу, что и в вебе.
   */
  const handleActionPress = async (msg, action) => {
    if (runningAction) return;

    if (action.kind === 'api') {
      const ok = await new Promise(resolve => {
        Alert.alert(action.label + '?', '', [
          {text: 'Отмена', style: 'cancel', onPress: () => resolve(false)},
          {text: 'Создать', onPress: () => resolve(true)},
        ]);
      });
      if (!ok) return;
    }

    setRunningAction(action.id);
    try {
      const {data} = await chatApi.runMessageAction(chatId, msg.id, action.id);
      if (action.kind === 'link' && action.url) {
        Linking.openURL(CONFIG.BASE_URL + action.url).catch(() => {});
      } else if (data.result) {
        Alert.alert('Готово', data.result);
      }
    } catch (e) {
      Alert.alert('Ошибка', e.response?.data?.error || 'Не удалось выполнить действие');
    } finally {
      setRunningAction(null);
    }
  };

  const openReactionPicker = msg => {
    setContextMenu(null);
    setShowReactionPicker(msg.id);
  };

  const handleAddReaction = async (messageId, emoji) => {
    setShowReactionPicker(null);
    try {
      await chatApi.addReaction(chatId, messageId, emoji);
    } catch {}
  };

  const handleReactionTap = async (messageId, emoji, hasReacted) => {
    try {
      if (hasReacted) {
        await chatApi.removeReaction(chatId, messageId);
      } else {
        await chatApi.addReaction(chatId, messageId, emoji);
      }
    } catch {}
  };

  const openForward = ids => {
    setContextMenu(null);
    setSelected(ids);
    chatApi.list().then(r => setChatsList(r.data)).catch(() => {});
    setShowForwardModal(true);
  };

  const doForward = async targetChatId => {
    setShowForwardModal(false);
    const count = selected.length;
    try {
      await chatApi.forwardMessages(targetChatId, selected);
      Alert.alert('Готово', count > 1 ? `Переслано ${count} ${pluralMessages(count)}` : 'Сообщение переслано');
    } catch {
      Alert.alert('Ошибка', 'Не удалось переслать');
    }
    cancelSelection();
  };

  // ── Processed list with date separators ────────────────────────────────────
  const listData = useMemo(() => withSeparators(messages), [messages]);
  // Ссылка на тот же список — чтобы переход к сообщению не зависел от порядка
  // объявлений: jumpToMessage объявлен выше, чем считается listData
  const listDataRef = useRef(listData);
  useEffect(() => { listDataRef.current = listData; }, [listData]);
  const mediaGallery = useMemo(() => [...messages].reverse().flatMap(message =>
    (message.attachments || []).map((att, idx) => ({
      ...att,
      url: fixUrl(att.url || att.path),
      name: att.name || att.filename || '',
      galleryKey: `${message.id}:${idx}`,
      messageId: message.id,
    })).filter(att => att.url && /^(image|video)\//.test(att.mimeType || '')),
  ), [messages]);

  const openMedia = useCallback(item => {
    const index = mediaGallery.findIndex(media => media.galleryKey === item.galleryKey);
    setMediaItem({items: mediaGallery, index: index >= 0 ? index : 0});
  }, [mediaGallery]);

  // ── Render item ────────────────────────────────────────────────────────────
  const renderItem = ({item}) => {
    if (item._itemType === 'separator') {
      return (
        <View style={styles.dateSep}>
          <Text style={styles.dateSepText}>{formatDateSep(item.date)}</Text>
        </View>
      );
    }
    return (
      <MessageBubble
        message={item}
        isOwn={String(item.senderId) === String(user?.id)}
        chatType={chatType}
        isHighlighted={item.id === highlightedMsgId}
        selectionMode={selectionMode}
        isSelected={selected.includes(item.id)}
        onSelectToggle={toggleSelect}
        // В режиме выделения тап по картинке или кнопке бота должен отмечать
        // сообщение, а не открывать галерею и не запускать действие
        onLongPress={selectionMode ? toggleSelect : handleLongPress}
        onReactionTap={selectionMode ? noop : handleReactionTap}
        onMediaPress={selectionMode ? noop : openMedia}
        onActionPress={selectionMode ? noop : handleActionPress}
        onPollVote={selectionMode ? noop : votePoll}
        onRetry={retrySend}
        runningAction={runningAction}
        chatTitle={chatName}
        chatId={chatId}
        status={
          String(item.senderId) === String(user?.id)
            ? getMessageStatus({
                message: item,
                chatType,
                otherLastReadAt,
                otherIsOnline: isOnline,
                otherLastSeen,
              })
            : null
        }
      />
    );
  };

  const keyExtractor = useCallback(item =>
    item._id || (item.id != null ? String(item.id) : item._itemType + '_' + item.date), []);

  if (loading) {
    return (
      <View style={styles.center}>
        <LogoLoader width={96} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      {/* Узор лежит под лентой сообщений и не перехватывает касания */}
      <ChatBackground />

      {/* In-chat search bar */}
      {searchMode && (
        <View style={styles.searchBar}>
          <TextInput
            ref={searchInputRef}
            style={styles.searchBarInput}
            placeholder="Поиск в чате..."
            placeholderTextColor={c.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchHits.length > 0 && (
            <>
              <Text style={styles.searchCount}>{searchIdx + 1}/{searchHits.length}</Text>
              <TouchableOpacity
                style={styles.searchNavBtn}
                onPress={() => setSearchIdx(i => Math.max(0, i - 1))}>
                <ChevronUp size={20} color={c.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.searchNavBtn}
                onPress={() => setSearchIdx(i => Math.min(searchHits.length - 1, i + 1))}>
                <ChevronDown size={20} color={c.primary} />
              </TouchableOpacity>
            </>
          )}
          {searchQuery.length > 0 && searchHits.length === 0 && (
            <Text style={styles.searchNone}>Не найдено</Text>
          )}
        </View>
      )}

      {/* Шапка закреплённых. Нажатие уводит к сообщению и переключает на
          следующее — так же, как в вебе. */}
      {pinnedMessages.length > 0 && (() => {
        const pinned = pinnedMessages[pinnedIndex % pinnedMessages.length];
        if (!pinned) return null;
        return (
          <View style={styles.pinnedBar}>
            <Pin size={15} color={c.primary} />
            <TouchableOpacity
              style={styles.pinnedContent}
              onPress={() => {
                jumpToMessage(pinned.id);
                if (pinnedMessages.length > 1) {
                  setPinnedIndex(i => (i + 1) % pinnedMessages.length);
                }
              }}>
              <Text style={styles.pinnedTitle}>
                Закреплённое
                {pinnedMessages.length > 1
                  ? ` ${(pinnedIndex % pinnedMessages.length) + 1} из ${pinnedMessages.length}`
                  : ''}
              </Text>
              <Text style={styles.pinnedText} numberOfLines={1}>
                {stripFormatting(pinned.content) || 'Вложение'}
              </Text>
            </TouchableOpacity>
            {canPinHere && (
              <TouchableOpacity onPress={() => togglePin(pinned, false)} style={styles.iconBtn}>
                <PinOff size={18} color={c.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
        );
      })()}

      {/* Messages list (inverted = newest at bottom) */}
      <FlatList
        ref={flatListRef}
        data={listData}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        inverted
        contentContainerStyle={styles.msgList}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        initialNumToRender={20}
        maxToRenderPerBatch={10}
        windowSize={10}
        removeClippedSubviews={false}
        ListFooterComponent={loadingMore ? <LogoLoader width={64} style={styles.loadMoreLoader} /> : null}
        onScrollToIndexFailed={info => {
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({index: info.index, animated: true, viewPosition: 0.5});
          }, 300);
        }}
      />

      {/* Reaction quick-pick (after long press → reaction) */}
      {showReactionPicker && (
        <View style={styles.reactionQuickPick}>
          {REACTIONS.map(emoji => (
            <TouchableOpacity
              key={emoji}
              onPress={() => handleAddReaction(showReactionPicker, emoji)}
              style={styles.reactionQuickBtn}>
              <Text style={styles.reactionQuickText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => setShowReactionPicker(null)} style={styles.reactionQuickClose}>
            <X size={18} color={c.textTertiary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Edit mode banner */}
      {editingMessage && (
        <View style={styles.editBanner}>
          <Pencil size={14} color={c.primary} style={{marginRight: 6}} />
          <Text style={styles.editBannerLabel}>Редактирование</Text>
          <Text style={styles.editBannerText} numberOfLines={1}>{editingMessage.content}</Text>
          <TouchableOpacity onPress={cancelEdit}>
            <X size={18} color={c.textTertiary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Reply banner */}
      {replyTo && !editingMessage && (
        <View style={styles.replyBanner}>
          <View style={styles.replyBannerBar} />
          <View style={styles.replyBannerContent}>
            <Text style={styles.replyBannerName}>
              {replyTo.sender?.displayName || 'Сообщение'}
            </Text>
            <Text style={styles.replyBannerText} numberOfLines={1}>
              {stripFormatting(replyTo.content)}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)}>
            <X size={18} color={c.textTertiary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Pending attachments preview */}
      {pendingFiles.length > 0 && (
        <ScrollView horizontal style={styles.pendingRow} showsHorizontalScrollIndicator={false}>
          {pendingFiles.map((f, idx) => (
            <View key={idx} style={styles.pendingItem}>
              {f.type?.startsWith('image/') ? (
                <Image source={{uri: f.uri}} style={styles.pendingImage} />
              ) : (
                <View style={styles.pendingFile}>
                  <File size={28} color={c.textSecondary} />
                </View>
              )}
              <Text style={styles.pendingName} numberOfLines={1}>{f.name}</Text>
              <TouchableOpacity
                style={styles.pendingRemove}
                onPress={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))}>
                <X size={10} color="#FFF" strokeWidth={3} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Emoji picker panel */}
      {showEmojiPicker && (
        <View style={styles.emojiPanel}>
          <ScrollView contentContainerStyle={styles.emojiGrid}>
            {COMMON_EMOJI.map(e => (
              <TouchableOpacity
                key={e}
                style={styles.emojiBtn}
                onPress={() => setText(prev => prev + e)}>
                <Text style={styles.emojiBtnText}>{e}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Играет голосовое из другого чата — показываем полоску управления */}
      <VoiceMiniPlayer hideForChatId={chatId} />

      {/* Панель выделения занимает место строки ввода: писать и разбирать
          завал одновременно всё равно нельзя, а на телефоне обе строки сразу
          съели бы половину экрана. */}
      {selectionMode ? (
        <View style={inputBarStyle}>
          <TouchableOpacity style={styles.iconBtn} onPress={cancelSelection}>
            <X size={22} color={c.textTertiary} />
          </TouchableOpacity>
          <Text style={styles.selectionCount}>{selected.length}</Text>
          <View style={{flex: 1}} />
          <TouchableOpacity
            style={styles.iconBtn}
            disabled={selected.length === 0}
            onPress={shareSelected}>
            <Share2 size={22} color={selected.length ? c.textPrimary : c.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            disabled={selected.length === 0}
            onPress={() => confirmDelete(messages.filter(m => selected.includes(m.id)))}>
            <Trash2 size={22} color={selected.length ? c.error : c.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            disabled={selected.length === 0}
            onPress={() => openForward(selected)}>
            <Forward size={22} color={selected.length ? c.primary : c.textTertiary} />
          </TouchableOpacity>
        </View>
      ) : recording ? (
        <View style={inputBarStyle}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => finishVoiceRecording(false)}>
            <Trash2 size={22} color={c.error} />
          </TouchableOpacity>
          <View style={styles.recordingBox}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingTime}>
              {`${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, '0')}`}
            </Text>
            <Text style={styles.recordingHint}>Идёт запись…</Text>
          </View>
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={() => finishVoiceRecording(true)}
            disabled={sending}>
            {sending
              ? <LogoLoader width={36} color="#FFFFFF" />
              : <Send size={18} color="#FFF" />}
          </TouchableOpacity>
        </View>
      ) : (
      <>
      {/* Панель форматирования — только когда в поле что-то выделено */}
      {selection.end > selection.start && (
        <View style={styles.formatBar}>
          {FORMAT_BUTTONS.map(({d, Icon, label}) => (
            <TouchableOpacity
              key={d}
              style={styles.formatBtn}
              accessibilityLabel={label}
              onPress={() => applyFormat(d)}>
              <Icon size={18} color={c.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      )}
      {visibleMentions.length > 0 && (
        <View style={styles.mentionMenu}>
          {visibleMentions.map(item => (
            <TouchableOpacity key={item.targetId} style={styles.mentionItem} onPress={() => chooseMention(item)}>
              <View style={styles.mentionTextWrap}>
                <Text style={styles.mentionLabel} numberOfLines={1}>@{item.label}</Text>
                <Text style={styles.mentionMeta}>
                  {item.type === 'user' ? 'Сотрудник' : item.type === 'role' ? `Роль · ${item.count} чел.` : `Медцентр · ${item.count} чел.`}
                </Text>
              </View>
              <UserBadge badge={item.badge} size={16} />
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={inputBarStyle}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => {setShowAttachMenu(true); setShowEmojiPicker(false);}}>
          <Paperclip size={22} color={c.textSecondary} />
        </TouchableOpacity>

        <TextInput
          style={styles.textInput}
          placeholder={editingMessage ? 'Редактировать...' : 'Сообщение...'}
          placeholderTextColor="#9CA3AF"
          value={text}
          selection={forcedSelection || undefined}
          onSelectionChange={e => {
            setSelection(e.nativeEvent.selection);
            // Выделение уже вернули — дальше поле управляет кареткой само
            setForcedSelection(null);
          }}
          onChangeText={val => {
            setText(val);
            SocketService.emit('typing_start', {chatId});
            if (sendTypingTimer.current) clearTimeout(sendTypingTimer.current);
            sendTypingTimer.current = setTimeout(() => {
              SocketService.emit('typing_stop', {chatId});
            }, 2000);
          }}
          multiline
          maxLength={4000}
        />

        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => {setShowEmojiPicker(v => !v); setShowAttachMenu(false);}}>
          <Smile size={22} color={showEmojiPicker ? c.primary : c.textSecondary} />
        </TouchableOpacity>

        {/*
          Одна кнопка на два состояния, как в Telegram: пустое поле — микрофон,
          есть текст или вложения — отправка. Держать обе разом негде: вместе с
          скрепкой и эмодзи они не помещаются по ширине на узких экранах.
        */}
        {hasContent ? (
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={handleSend}
            disabled={sending || uploading}>
            {sending || uploading
              ? <LogoLoader width={36} color="#FFFFFF" />
              : <Send size={18} color="#FFF" />}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.micBtn} onPress={startVoiceRecording}>
            <Mic size={20} color={c.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
      </>
      )}

      {/* ── Attach menu modal ── */}
      <Modal transparent visible={showAttachMenu} animationType="fade" onRequestClose={() => setShowAttachMenu(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowAttachMenu(false)}>
          <View style={attachMenuStyle}>
            <TouchableOpacity style={styles.attachMenuItem} onPress={pickFromGallery}>
              <View style={styles.attachMenuIconWrap}>
                <ImageIcon size={26} color={c.primary} />
              </View>
              <Text style={styles.attachMenuLabel}>Галерея</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachMenuItem} onPress={pickFromCamera}>
              <View style={styles.attachMenuIconWrap}>
                <Camera size={26} color={c.primary} />
              </View>
              <Text style={styles.attachMenuLabel}>Камера</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachMenuItem} onPress={pickFile}>
              <View style={styles.attachMenuIconWrap}>
                <File size={26} color={c.primary} />
              </View>
              <Text style={styles.attachMenuLabel}>Файл</Text>
            </TouchableOpacity>
            {chatType === 'group' && (
              <TouchableOpacity style={styles.attachMenuItem} onPress={() => {setShowAttachMenu(false); setShowPollEditor(true);}}>
                <View style={styles.attachMenuIconWrap}>
                  <BarChart3 size={26} color={c.primary} />
                </View>
                <Text style={styles.attachMenuLabel}>Опрос</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showPollEditor} animationType="slide" onRequestClose={() => setShowPollEditor(false)}>
        <View style={[styles.pollEditor, {paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12}]}>
          <View style={styles.pollEditorHeader}>
            <Text style={styles.pollEditorTitle}>Новый опрос</Text>
            <TouchableOpacity onPress={() => setShowPollEditor(false)}><X size={23} color={c.textSecondary} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.pollEditorBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.pollEditorLabel}>Вопрос</Text>
            <TextInput style={styles.pollEditorInput} value={pollDraft.question} onChangeText={question => setPollDraft({...pollDraft, question})} placeholder="Что нужно решить?" placeholderTextColor={c.textTertiary} maxLength={300} multiline />
            <Text style={styles.pollEditorLabel}>Варианты ответа</Text>
            {pollDraft.options.map((option, index) => (
              <View key={index} style={styles.pollOptionRow}>
                <TextInput style={[styles.pollEditorInput, styles.pollOptionInput]} value={option} onChangeText={value => setPollDraft({...pollDraft, options: pollDraft.options.map((old, i) => i === index ? value : old)})} placeholder={`Вариант ${index + 1}`} placeholderTextColor={c.textTertiary} maxLength={100} />
                {pollDraft.options.length > 2 && <TouchableOpacity style={styles.pollRemoveBtn} onPress={() => setPollDraft({...pollDraft, options: pollDraft.options.filter((_, i) => i !== index)})}><X size={18} color={c.error} /></TouchableOpacity>}
              </View>
            ))}
            {pollDraft.options.length < 10 && <TouchableOpacity style={styles.pollAddBtn} onPress={() => setPollDraft({...pollDraft, options: [...pollDraft.options, '']})}><PlusCircle size={18} color={c.primary} /><Text style={styles.pollAddText}>Добавить вариант</Text></TouchableOpacity>}
            <View style={styles.pollSwitchRow}><Text style={styles.pollSwitchText}>Несколько вариантов ответа</Text><Switch value={pollDraft.multipleChoice} onValueChange={multipleChoice => setPollDraft({...pollDraft, multipleChoice})} trackColor={{true: c.primary}} /></View>
            <View style={styles.pollSwitchRow}><Text style={styles.pollSwitchText}>Анонимное голосование</Text><Switch value={pollDraft.anonymous} onValueChange={anonymous => setPollDraft({...pollDraft, anonymous})} trackColor={{true: c.primary}} /></View>
          </ScrollView>
          <TouchableOpacity style={styles.pollCreateBtn} onPress={createPoll} disabled={sending}>
            {sending ? <LogoLoader width={52} color="#FFFFFF" /> : <Text style={styles.pollCreateText}>Создать опрос</Text>}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Галерея чата: медиа, файлы, голосовые, ссылки (ver. 7.35) ── */}
      <Modal
        transparent
        visible={!!mediaPanel}
        animationType="slide"
        onRequestClose={() => setMediaPanel(null)}>
        <View style={styles.forwardModal}>
          <View style={styles.forwardModalHeader}>
            <Text style={styles.forwardModalTitle}>Медиа чата</Text>
            <TouchableOpacity onPress={() => setMediaPanel(null)}>
              <X size={22} color={c.textTertiary} />
            </TouchableOpacity>
          </View>

          <View style={styles.mediaTabs}>
            {MEDIA_TABS.map(tab => (
              <TouchableOpacity
                key={tab.key}
                style={[styles.mediaTab, mediaPanel === tab.key && styles.mediaTabActive]}
                onPress={() => openMediaPanel(tab.key)}>
                <Text style={[styles.mediaTabText, mediaPanel === tab.key && styles.mediaTabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {mediaLoading ? (
            <View style={styles.center}><LogoLoader width={80} /></View>
          ) : mediaItems.length === 0 ? (
            <View style={styles.center}><Text style={styles.mediaEmpty}>Здесь пока пусто</Text></View>
          ) : mediaPanel === 'media' ? (
            <FlatList
              data={mediaItems}
              numColumns={3}
              keyExtractor={(item, idx) => `${item.messageId}:${idx}`}
              renderItem={({item}) => {
                const att = item.attachment || {};
                const uri = fixUrl(att.thumbnailUrl || att.thumbnailPath || att.url || att.path);
                return (
                  <TouchableOpacity
                    style={styles.mediaCell}
                    onPress={() => { setMediaPanel(null); jumpToMessage(item.messageId); }}>
                    {att.mimeType?.startsWith('video/')
                      ? <View style={styles.mediaCellVideo}><Play size={20} color={c.textTertiary} /></View>
                      : <Image source={{uri}} style={styles.mediaCellImage} />}
                  </TouchableOpacity>
                );
              }}
            />
          ) : (
            <FlatList
              data={mediaItems}
              keyExtractor={(item, idx) => `${item.messageId}:${idx}`}
              renderItem={({item}) => {
                const att = item.attachment || {};
                const isLink = mediaPanel === 'links';
                const title = isLink
                  ? (item.urls?.[0] || item.content)
                  : att.kind === 'voice'
                    ? 'Голосовое сообщение'
                    : (att.name || att.filename || 'Файл');
                return (
                  <TouchableOpacity
                    style={styles.mediaRow}
                    onPress={() => {
                      if (isLink && item.urls?.[0]) {
                        Linking.openURL(item.urls[0]).catch(() => {});
                        return;
                      }
                      setMediaPanel(null);
                      jumpToMessage(item.messageId);
                    }}>
                    <Text style={[styles.mediaRowTitle, isLink && styles.mediaRowLink]} numberOfLines={1}>
                      {title}
                    </Text>
                    <Text style={styles.mediaRowMeta} numberOfLines={1}>
                      {item.senderName} · {new Date(item.createdAt).toLocaleDateString('ru-RU')}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </Modal>

      {/* ── Context menu modal ── */}
      <Modal transparent visible={!!contextMenu} animationType="fade" onRequestClose={() => setContextMenu(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setContextMenu(null)}>
          <View style={contextMenuStyle}>
            {/* Reactions row */}
            <View style={styles.contextReactions}>
              {REACTIONS.map(emoji => (
                <TouchableOpacity
                  key={emoji}
                  style={styles.contextReactionBtn}
                  onPress={() => {
                    setContextMenu(null);
                    handleAddReaction(contextMenu?.message?.id, emoji);
                  }}>
                  <Text style={styles.contextReactionText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.contextDivider} />

            <TouchableOpacity
              style={styles.contextItem}
              onPress={() => {setContextMenu(null); setReplyTo(contextMenu?.message);}}>
              <Reply size={18} color={c.textPrimary} style={styles.contextItemIcon} />
              <Text style={styles.contextItemText}>Ответить</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.contextItem}
              onPress={() => startSelection(contextMenu?.message)}>
              <CheckCircle2 size={18} color={c.textPrimary} style={styles.contextItemIcon} />
              <Text style={styles.contextItemText}>Выбрать</Text>
            </TouchableOpacity>

            {canPinHere && contextMenu?.message?.type !== 'system' && (
              <TouchableOpacity
                style={styles.contextItem}
                onPress={() => togglePin(contextMenu?.message, !contextMenu?.message?.pinnedAt)}>
                {contextMenu?.message?.pinnedAt
                  ? <PinOff size={18} color={c.textPrimary} style={styles.contextItemIcon} />
                  : <Pin size={18} color={c.textPrimary} style={styles.contextItemIcon} />}
                <Text style={styles.contextItemText}>
                  {contextMenu?.message?.pinnedAt ? 'Открепить' : 'Закрепить'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.contextItem}
              onPress={() => openForward([contextMenu?.message?.id])}>
              <Forward size={18} color={c.textPrimary} style={styles.contextItemIcon} />
              <Text style={styles.contextItemText}>Переслать</Text>
            </TouchableOpacity>

            {/* Править можно только своё. Удалять — ещё и чужое, если ты
                суперадминистратор: мусор и сообщения ботов убирать больше некому */}
            {String(contextMenu?.message?.senderId) === String(user?.id) && contextMenu?.message?.type !== 'poll' && (
              <TouchableOpacity
                style={styles.contextItem}
                onPress={() => startEdit(contextMenu?.message)}>
                <Pencil size={18} color={c.textPrimary} style={styles.contextItemIcon} />
                <Text style={styles.contextItemText}>Редактировать</Text>
              </TouchableOpacity>
            )}
            {/* Удалить может каждый: как минимум «у себя». Стереть у всех
                разрешит или не разрешит сервер (ver. 7.29) */}
            {contextMenu?.message && (
              <TouchableOpacity
                style={styles.contextItem}
                onPress={() => confirmDelete([contextMenu?.message])}>
                <Trash2 size={18} color={c.error} style={styles.contextItemIcon} />
                <Text style={[styles.contextItemText, styles.contextItemDanger]}>Удалить</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* ── Forward modal ── */}
      <Modal transparent visible={showForwardModal} animationType="slide" onRequestClose={() => setShowForwardModal(false)}>
        <View style={styles.forwardModal}>
          <View style={styles.forwardModalHeader}>
            <Text style={styles.forwardModalTitle}>Переслать в чат</Text>
            <TouchableOpacity onPress={() => setShowForwardModal(false)}>
              <X size={22} color={c.textTertiary} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={chatsList}
            contentContainerStyle={{paddingBottom: insets.bottom}}
            keyExtractor={item => item.id?.toString() || String(Math.random())}
            renderItem={({item}) => (
              <TouchableOpacity style={styles.forwardChatItem} onPress={() => doForward(item.id)}>
                <Avatar uri={item.avatar} isGroup={item.type === 'group'} size={40} />
                <Text style={styles.forwardChatName}>{item.displayName}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>

      {/* ── Просмотр фото и видео: зум, плеер, сохранение ── */}
      <MediaViewer
        visible={!!mediaItem}
        items={mediaItem?.items || []}
        initialIndex={mediaItem?.index || 0}
        onClose={() => setMediaItem(null)}
      />
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = c => StyleSheet.create({
  // Кардиограмма — View фиксированной ширины, её надо центрировать явно
  loadMoreLoader: {alignSelf: 'center', marginVertical: 12},
  // Фон рисует ChatBackground — контейнер обязан быть прозрачным
  container: {flex: 1, backgroundColor: 'transparent'},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  msgList: {paddingVertical: 8, paddingHorizontal: 10},

  // Date separator
  dateSep: {alignItems: 'center', marginVertical: 10},
  dateSepText: {
    fontSize: 12, fontFamily: font.regular, color: c.textSecondary,
    backgroundColor: c.borderLight, paddingHorizontal: 12, paddingVertical: 3,
    borderRadius: radius.md,
  },

  // System message
  systemMsgWrap: {alignItems: 'center', marginVertical: 4},
  systemMsgText: {fontSize: 12, fontFamily: font.regular, color: c.textTertiary, fontStyle: 'italic'},

  // Bubble row
  // flex-end — аватарка равняется по нижнему краю пузырька, как в мессенджерах
  bubbleRow: {flexDirection: 'row', alignItems: 'flex-end', marginVertical: 2, paddingHorizontal: 4},
  bubbleRowOwn: {justifyContent: 'flex-end'},
  bubbleRowOther: {justifyContent: 'flex-start'},
  bubbleRowHighlighted: {backgroundColor: 'rgba(255, 214, 0, 0.25)', borderRadius: 8},
  // Режим выделения (ver. 7.29): подсветка строки и кружок-отметка слева
  bubbleRowSelected: {backgroundColor: c.primaryLight, borderRadius: 8},
  selectCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    alignSelf: 'center',
  },
  selectCheckOn: {backgroundColor: c.primary, borderColor: c.primary},
  selectionCount: {color: c.textPrimary, fontSize: 16, fontWeight: '600', marginLeft: 4},
  // Шапка закреплённых (ver. 7.33)
  pinnedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: c.bgSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  // flex + minWidth: без них длинный текст растягивает строку и выталкивает
  // кнопку открепления за край экрана
  pinnedContent: {flex: 1, minWidth: 0},
  pinnedTitle: {color: c.primary, fontSize: 12, fontWeight: '600'},
  pinnedText: {color: c.textSecondary, fontSize: 13},
  retryRow: {flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2},
  retryText: {color: c.error, fontSize: 11},
  // Галерея чата (ver. 7.35)
  mediaTabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  // Прозрачная подчёркивающая линия у неактивных вкладок: иначе активная
  // выше остальных на два пикселя и строка дёргается при переключении
  mediaTab: {paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 2, borderBottomColor: 'transparent'},
  mediaTabActive: {borderBottomColor: c.primary},
  mediaTabText: {color: c.textSecondary, fontSize: 14},
  mediaTabTextActive: {color: c.primary, fontWeight: '600'},
  mediaEmpty: {color: c.textTertiary, fontSize: 14},
  mediaCell: {flex: 1 / 3, aspectRatio: 1, padding: 1},
  mediaCellImage: {width: '100%', height: '100%', borderRadius: 4, backgroundColor: c.bgSecondary},
  mediaCellVideo: {
    width: '100%', height: '100%', borderRadius: 4,
    backgroundColor: c.bgSecondary, alignItems: 'center', justifyContent: 'center',
  },
  mediaRow: {
    paddingVertical: 10, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
  },
  mediaRowTitle: {color: c.textPrimary, fontSize: 14},
  mediaRowLink: {color: c.primary},
  mediaRowMeta: {color: c.textSecondary, fontSize: 12, marginTop: 2},
  bubbleAvatar: {marginRight: 6, marginBottom: 2},

  bubbleContent: {maxWidth: '78%'},
  senderNameRow: {flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3},
  senderName: {fontSize: 12.5, fontFamily: font.semiBold, color: c.primary},

  // Forward / reply
  forwardBadge: {
    flexDirection: 'row', alignItems: 'center',
    borderLeftWidth: 3, borderLeftColor: c.textTertiary,
    paddingLeft: 8, marginBottom: 3,
    backgroundColor: c.bgSecondary, borderRadius: 4, paddingVertical: 2, paddingRight: 8,
  },
  forwardBadgeOwn: {backgroundColor: 'rgba(255,255,255,0.2)', borderLeftColor: 'rgba(255,255,255,0.6)'},
  forwardLabel: {fontSize: 11, fontFamily: font.regular, color: c.textSecondary, fontStyle: 'italic'},
  forwardLabelOwn: {color: 'rgba(255,255,255,0.75)'},

  replyBadge: {
    borderLeftWidth: 3, borderLeftColor: c.primary,
    paddingLeft: 8, marginBottom: 3,
    backgroundColor: c.primaryLight, borderRadius: 4, paddingVertical: 2, paddingRight: 8,
  },
  replyBadgeOwn: {backgroundColor: 'rgba(255,255,255,0.2)', borderLeftColor: 'rgba(255,255,255,0.6)'},
  replyAuthor: {fontSize: 11, fontFamily: font.semiBold, color: c.primary},
  replyAuthorOwn: {color: 'rgba(255,255,255,0.9)'},
  replyText: {fontSize: 12, fontFamily: font.regular, color: c.textSecondary},
  replyTextOwn: {color: 'rgba(255,255,255,0.75)'},

  // Bubble
  bubble: {borderRadius: radius.lg, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6},
  bubbleOther: {backgroundColor: c.bgPrimary, borderBottomLeftRadius: 4, elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, shadowOffset: {width: 0, height: 1}},
  bubbleOwn: {backgroundColor: c.primary, borderBottomRightRadius: 4},
  msgText: {fontSize: 15, fontFamily: font.regular, color: c.bubbleOtherText, lineHeight: 21},
  msgTextOwn: {color: c.bubbleOwnText},
  // Разметка в тексте сообщения (см. components/RichText). Жирный задаёт
  // только начертание: цвет должен унаследоваться от пузырька — в своём он
  // белый, в чужом тёмный.
  msgTextBold: {fontFamily: font.semiBold},
  msgLink: {color: c.primary, textDecorationLine: 'underline'},
  // На синем фоне своего пузырька синяя ссылка нечитаема
  msgLinkOwn: {color: c.bubbleOwnText, textDecorationLine: 'underline'},
  deletedText: {fontSize: 14, fontFamily: font.regular, color: c.textTertiary, fontStyle: 'italic'},
  // Кнопки действий под сообщением бота (заявки с сайта)
  msgActions: {gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.borderLight},
  msgActionsOwn: {borderTopColor: 'rgba(255,255,255,0.25)'},
  msgActionBtn: {
    minHeight: 34, paddingHorizontal: 12, borderRadius: radius.sm,
    backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
  },
  // Пока действие выполняется — кнопка неактивна, чтобы не нажали второй раз
  msgActionBtnBusy: {opacity: 0.65},
  msgActionText: {fontSize: 13, fontFamily: font.semiBold, color: '#FFFFFF'},
  bubbleMeta: {flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2, alignItems: 'center'},
  // Ложится в «дырку», оставленную невидимым отступом в конце текста
  bubbleMetaFloating: {position: 'absolute', right: 12, bottom: 6, marginTop: 0},
  metaSpacer: {fontSize: 11},
  timeText: {fontSize: 11, fontFamily: font.regular, color: c.textTertiary},
  timeTextOwn: {color: 'rgba(255,255,255,0.65)'},
  msgStatus: {marginLeft: 4},
  editedLabel: {fontSize: 11, fontFamily: font.regular, color: c.textTertiary, fontStyle: 'italic'},
  editedLabelOwn: {color: 'rgba(255,255,255,0.6)'},

  // Reactions
  reactionsRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 4, flexShrink: 1},
  reactionsMetaRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'space-between', marginTop: 5,
  },
  reactionChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.bgSecondary, borderRadius: radius.md, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: c.borderLight,
  },
  reactionChipActive: {backgroundColor: c.primaryLight, borderColor: c.primary},
  reactionAvatar: {width: 16, height: 16, borderRadius: 8, marginRight: 4},
  reactionAvatarStub: {
    width: 16, height: 16, borderRadius: 8, marginRight: 4,
    backgroundColor: c.bgTertiary, alignItems: 'center', justifyContent: 'center',
  },
  reactionInitial: {fontSize: 9, fontFamily: font.semiBold, color: c.textSecondary},
  reactionCount: {fontSize: 12, fontFamily: font.medium, color: c.textSecondary, marginRight: 3},
  reactionEmoji: {fontSize: 13},
  reactionChipText: {fontSize: 13, fontFamily: font.regular},

  // Attachments
  attachmentsWrap: {marginBottom: 4},
  attachImage: {width: SCREEN_WIDTH * 0.55, height: SCREEN_WIDTH * 0.45, borderRadius: 8, marginBottom: 4},
  attachFile: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.bgSecondary, borderRadius: 8, padding: 8, marginBottom: 4,
  },
  attachFileOwn: {backgroundColor: 'rgba(255,255,255,0.15)'},
  attachFileIcon: {fontSize: 22, marginRight: 8},
  attachFileInfo: {flex: 1},
  attachFileName: {fontSize: 13, color: c.textPrimary, fontFamily: font.medium},
  attachFileNameOwn: {color: c.bubbleOwnText},
  attachFileSize: {fontSize: 11, fontFamily: font.regular, color: c.textSecondary, marginTop: 1},
  attachFileSizeOwn: {color: 'rgba(255,255,255,0.7)'},

  // Reaction quick pick
  reactionQuickPick: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.bgPrimary, paddingVertical: 10, paddingHorizontal: 12,
    borderTopWidth: 1, borderTopColor: c.bgSecondary,
    elevation: 4,
  },
  reactionQuickBtn: {paddingHorizontal: 6},
  reactionQuickText: {fontSize: 26},
  reactionQuickClose: {marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 4},

  // Edit / reply banners
  editBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.primaryLight, paddingHorizontal: 16, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: '#BFDBFE',
  },
  editBannerLabel: {fontSize: 12, color: c.primary, fontFamily: font.semiBold, marginRight: 8},
  editBannerText: {flex: 1, fontSize: 13, fontFamily: font.regular, color: c.textPrimary},
  replyBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F9FAFB', paddingHorizontal: 16, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: c.borderLight,
  },
  replyBannerBar: {width: 3, height: '100%', backgroundColor: c.primary, borderRadius: 2, marginRight: 10},
  replyBannerContent: {flex: 1},
  replyBannerName: {fontSize: 12, fontFamily: font.semiBold, color: c.primary},
  replyBannerText: {fontSize: 13, fontFamily: font.regular, color: c.textSecondary},

  // Pending files
  pendingRow: {
    backgroundColor: c.bgPrimary, paddingVertical: 8, paddingHorizontal: 10,
    borderTopWidth: 1, borderTopColor: c.bgSecondary, maxHeight: 90,
  },
  pendingItem: {alignItems: 'center', marginRight: 10, width: 70},
  pendingImage: {width: 60, height: 60, borderRadius: 6},
  pendingFile: {width: 60, height: 60, backgroundColor: c.bgSecondary, borderRadius: 6, alignItems: 'center', justifyContent: 'center'},
  pendingName: {fontSize: 10, fontFamily: font.regular, color: c.textSecondary, marginTop: 2},
  pendingRemove: {
    position: 'absolute', top: 0, right: 0,
    backgroundColor: c.error, borderRadius: 8, width: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
  },

  // Emoji panel
  emojiPanel: {
    backgroundColor: c.bgPrimary, borderTopWidth: 1, borderTopColor: c.borderLight, maxHeight: 180,
  },
  emojiGrid: {flexDirection: 'row', flexWrap: 'wrap', padding: 8},
  emojiBtn: {padding: 6},
  emojiBtnText: {fontSize: 26},

  // Input bar
  // Нижний отступ задаётся в компоненте: он зависит от системной панели
  // навигации (жесты/три кнопки) и от того, открыта ли клавиатура.
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: c.bgPrimary, paddingHorizontal: 10,
    paddingTop: 12,
    borderTopWidth: 1, borderTopColor: c.borderLight,
  },
  mentionMenu: {marginHorizontal: 10, paddingVertical: 5, backgroundColor: c.bgPrimary, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, maxHeight: 260},
  mentionItem: {flexDirection: 'row', alignItems: 'center', minHeight: 42, paddingHorizontal: 12, paddingVertical: 6},
  mentionTextWrap: {flex: 1, minWidth: 0},
  mentionLabel: {fontSize: 14, color: c.textPrimary, fontFamily: font.medium},
  mentionMeta: {fontSize: 11, color: c.textTertiary, fontFamily: font.regular, marginTop: 1},
  iconBtn: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  // Панель форматирования: отдельной полосой над строкой ввода — всплывающему
  // «пузырю» у выделения на телефоне негде встать, его закрывает лупа и
  // системное меню «Копировать / Вставить»
  formatBar: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    backgroundColor: c.bgPrimary, paddingHorizontal: 10, paddingVertical: 4,
    borderTopWidth: 1, borderTopColor: c.borderLight,
  },
  formatBtn: {
    width: 40, height: 36, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  textInput: {
    flex: 1, backgroundColor: c.bgSecondary, borderRadius: radius.xl,
    paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11,
    fontSize: 15, fontFamily: font.regular, color: c.textPrimary, maxHeight: 120,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 6,
  },
  // Микрофон — заглушка под голосовые. Без заливки, чтобы не спорить
  // с «самолётиком» за внимание: активное действие здесь пока не он.
  micBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', marginLeft: 6,
  },
  recordingBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.bgSecondary, borderRadius: radius.xl,
    paddingHorizontal: 14, height: 44,
  },
  recordingDot: {width: 9, height: 9, borderRadius: 5, backgroundColor: c.error, marginRight: 10},
  recordingTime: {fontSize: 15, fontFamily: font.medium, color: c.textPrimary, minWidth: 46},
  recordingHint: {fontSize: 13, fontFamily: font.regular, color: c.textSecondary},

  // Modals
  modalOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end'},
  attachMenu: {
    backgroundColor: c.bgPrimary, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    flexDirection: 'row', paddingVertical: 24, paddingHorizontal: 20, justifyContent: 'space-around',
  },
  attachMenuItem: {alignItems: 'center'},
  attachMenuIconWrap: {
    width: 60, height: 60, borderRadius: radius.lg,
    backgroundColor: c.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  attachMenuLabel: {fontSize: 13, fontFamily: font.regular, color: c.textPrimary},

  pollEditor: {flex: 1, backgroundColor: c.bgPrimary},
  pollEditorHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: c.borderLight},
  pollEditorTitle: {fontSize: 19, fontFamily: font.bold, color: c.textPrimary},
  pollEditorBody: {padding: 18, gap: 10},
  pollEditorLabel: {fontSize: 13, fontFamily: font.semiBold, color: c.textSecondary, marginTop: 4},
  pollEditorInput: {minHeight: 46, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, paddingHorizontal: 13, paddingVertical: 10, color: c.textPrimary, backgroundColor: c.bgSecondary, fontSize: 15, fontFamily: font.regular},
  pollOptionRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  pollOptionInput: {flex: 1},
  pollRemoveBtn: {width: 38, height: 38, alignItems: 'center', justifyContent: 'center'},
  pollAddBtn: {flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 9},
  pollAddText: {fontSize: 14, color: c.primary, fontFamily: font.medium},
  pollSwitchRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, borderTopWidth: 1, borderTopColor: c.borderLight},
  pollSwitchText: {fontSize: 15, color: c.textPrimary, fontFamily: font.regular},
  pollCreateBtn: {marginHorizontal: 18, minHeight: 48, borderRadius: radius.lg, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center'},
  pollCreateText: {fontSize: 15, color: '#FFFFFF', fontFamily: font.semiBold},

  contextMenu: {
    backgroundColor: c.bgPrimary, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: 16,
  },
  contextReactions: {flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8},
  contextReactionBtn: {padding: 6},
  contextReactionText: {fontSize: 28},
  contextDivider: {height: 1, backgroundColor: c.bgSecondary, marginVertical: 8},
  contextItem: {flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8},
  contextItemIcon: {marginRight: 14},
  contextItemText: {fontSize: 16, fontFamily: font.regular, color: c.textPrimary},
  contextItemDanger: {color: c.error},

  // Forward modal
  forwardModal: {
    flex: 1, marginTop: 80, backgroundColor: c.bgPrimary,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
  },
  forwardModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, borderBottomWidth: 1, borderBottomColor: c.bgSecondary,
  },
  forwardModalTitle: {fontSize: 17, fontFamily: font.bold, color: c.textPrimary},
  forwardChatItem: {flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12},
  forwardChatName: {fontSize: 15, fontFamily: font.regular, color: c.textPrimary},

  // Видео во вложениях — плитка с кнопкой воспроизведения, а не строка файла:
  // так сразу видно, что это ролик, а не документ
  attachVideo: {
    width: 200, height: 130, borderRadius: radius.md,
    backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center',
    marginBottom: 4, overflow: 'hidden',
  },
  attachVideoPlay: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  attachVideoName: {
    position: 'absolute', left: 8, right: 8, bottom: 6,
    fontSize: 11, fontFamily: font.regular, color: 'rgba(255,255,255,0.85)',
  },
  attachDownload: {padding: 6, marginLeft: 4},

  // In-chat search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bgPrimary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.borderLight,
    gap: 6,
  },
  searchBarInput: {
    flex: 1,
    height: 36,
    backgroundColor: c.bgSecondary,
    borderRadius: 18,
    paddingHorizontal: 14,
    fontSize: 14,
    fontFamily: font.regular,
    color: c.textPrimary,
  },
  searchCount: {
    fontSize: 13,
    fontFamily: font.medium,
    color: c.textSecondary,
    minWidth: 36,
    textAlign: 'center',
  },
  searchNavBtn: {padding: 4},
  searchNone: {
    fontSize: 13,
    fontFamily: font.regular,
    color: c.textTertiary,
    paddingRight: 4,
  },
});
