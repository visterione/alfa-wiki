import React, {useCallback, useRef, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useFocusEffect} from '@react-navigation/native';
import {
  Clock, MapPin, Repeat, Bell, Users, Eye, Flag, Pencil, Trash2, AlignLeft,
} from 'lucide-react-native';

import {calendar as calendarApi} from '../../services/api';
import {syncCalendarReminders} from '../../services/calendarReminders';
import {useAuth} from '../../store/authStore';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import LogoLoader from '../../components/LogoLoader';
import {
  FREQUENCIES,
  PRIORITIES,
  STATUSES,
  VISIBILITY,
  WEEKDAYS_SHORT,
  eventColor,
  formatDateTime,
  reminderLabel,
  typeLabel,
} from './eventMeta';

/**
 * Карточка события: всё, что о нём известно, плюс правка и удаление.
 *
 * Событие приезжает параметром маршрута — список уже держит его целиком, и
 * повторный запрос только задержал бы открытие. Обновляем по месту после
 * возврата с формы правки.
 */
export default function EventScreen({route, navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const {user} = useAuth();

  const [event, setEvent] = useState(route.params.event);
  const [busy, setBusy] = useState(false);

  // Экземпляр повторяющегося события: его id — «uuid::дата», и обычные ручки
  // такой id не примут. Серия правится и удаляется по parentEventId.
  const isInstance = Boolean(event.isInstance);
  const seriesId = isInstance ? event.parentEventId : event.id;
  // Аккредитации и ТО приходят из своих разделов — здесь только на просмотр
  const isIntegrated = Boolean(event.isIntegrated);
  const canEdit =
    !isIntegrated &&
    (user?.isAdmin ||
      String(event.createdBy) === String(user?.id) ||
      (event.participants || []).some(p => String(p?.userId ?? p) === String(user?.id)));

  // Возврат с формы правки: перечитываем событие, чтобы карточка не показывала
  // старое. Через фокус, а не колбэком в параметрах: функции в параметрах
  // маршрута навигатор не сериализует и ругается на них в консоли.
  const reload = useCallback(async () => {
    if (isIntegrated) return;
    try {
      const {data} = await calendarApi.getEvent(seriesId);
      // Для экземпляра серии сохраняем его собственные даты: сервер отдаёт
      // родительское событие, у которого время первого повтора
      setEvent(prev => (isInstance ? {...prev, ...pickEditable(data)} : data));
    } catch (e) {
      console.warn('[Event] reload error:', e?.message);
    }
  }, [seriesId, isInstance, isIntegrated]);

  // Первый заход пропускаем: событие уже пришло в параметрах маршрута
  const mounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (mounted.current) reload();
      mounted.current = true;
    }, [reload]),
  );

  const openEdit = () => {
    navigation.navigate('CalendarEventEdit', {event: {...event, id: seriesId}});
  };

  const doDelete = async ({instanceOnly}) => {
    setBusy(true);
    try {
      if (instanceOnly) {
        await calendarApi.deleteEventInstance(seriesId, event.instanceDate || event.startTime);
      } else {
        await calendarApi.deleteEvent(seriesId);
      }
      // Уведомления удалённого события надо снять, иначе телефон напомнит
      // о том, чего уже нет
      syncCalendarReminders();
      navigation.goBack();
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.error || 'Не удалось удалить событие');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    if (isInstance) {
      Alert.alert('Удалить событие?', 'Событие повторяющееся — что удалить?', [
        {text: 'Отмена', style: 'cancel'},
        {text: 'Только это', onPress: () => doDelete({instanceOnly: true})},
        {text: 'Всю серию', style: 'destructive', onPress: () => doDelete({instanceOnly: false})},
      ]);
      return;
    }
    Alert.alert('Удалить событие?', 'Действие нельзя отменить.', [
      {text: 'Отмена', style: 'cancel'},
      {text: 'Удалить', style: 'destructive', onPress: () => doDelete({instanceOnly: false})},
    ]);
  };

  const color = eventColor(event);
  const rule = event.recurrenceRule || {};
  const reminders = Array.isArray(event.reminders) ? event.reminders : [];
  const participants = Array.isArray(event.participants) ? event.participants : [];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <View style={[styles.typeDot, {backgroundColor: color}]} />
          <Text style={styles.title}>{event.title}</Text>
        </View>
        <Text style={styles.typeLine}>
          {typeLabel(event.eventType)}
          {isIntegrated ? ' · из другого раздела' : ''}
        </Text>

        <Row icon={<Clock size={16} color={c.textSecondary} />} styles={styles}>
          {event.allDay
            ? `Весь день, ${formatDateTime(event.startTime).split(',')[0]}`
            : `${formatDateTime(event.startTime)} — ${formatDateTime(event.endTime || event.startTime)}`}
        </Row>

        {!!event.location && (
          <Row icon={<MapPin size={16} color={c.textSecondary} />} styles={styles}>
            {event.location}
          </Row>
        )}

        {!!event.description && (
          <Row icon={<AlignLeft size={16} color={c.textSecondary} />} styles={styles}>
            {event.description}
          </Row>
        )}

        <Row icon={<Flag size={16} color={c.textSecondary} />} styles={styles}>
          {`Приоритет: ${PRIORITIES[event.priority]?.label || '—'} · ${STATUSES[event.status]?.label || '—'}`}
        </Row>

        {(event.isRecurring || isInstance) && (
          <Row icon={<Repeat size={16} color={c.textSecondary} />} styles={styles}>
            {describeRecurrence(rule)}
          </Row>
        )}

        {reminders.length > 0 && (
          <Row icon={<Bell size={16} color={c.textSecondary} />} styles={styles}>
            {reminders
              .map(r => `${reminderLabel(r.minutesBefore || 15)}${r.type === 'email' ? ' (email)' : ''}`)
              .join(', ')}
          </Row>
        )}

        {participants.length > 0 && (
          <Row icon={<Users size={16} color={c.textSecondary} />} styles={styles}>
            {`Участников: ${participants.length}`}
          </Row>
        )}

        <Row icon={<Eye size={16} color={c.textSecondary} />} styles={styles}>
          {VISIBILITY[event.visibility]?.label || 'Личное'}
        </Row>

        {!!event.creator && (
          <Text style={styles.creator}>
            Создал: {event.creator.displayName || event.creator.username}
          </Text>
        )}
      </ScrollView>

      {canEdit && (
        <View style={[styles.actions, {paddingBottom: 12 + insets.bottom}]}>
          <TouchableOpacity style={styles.editBtn} onPress={openEdit} disabled={busy}>
            <Pencil size={18} color="#FFFFFF" />
            <Text style={styles.editBtnText}>Изменить</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete} disabled={busy}>
            {busy ? <LogoLoader width={40} color={c.error} /> : <Trash2 size={18} color={c.error} />}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function Row({icon, children, styles}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={styles.rowText}>{children}</Text>
    </View>
  );
}

/** Поля, которые могли измениться при правке серии и должны перекрыть копию
 *  экземпляра, лежащую в параметрах маршрута. */
function pickEditable(data) {
  const {title, description, location, eventType, priority, status, color, reminders, visibility} = data;
  return {title, description, location, eventType, priority, status, color, reminders, visibility};
}

function describeRecurrence(rule) {
  const base = FREQUENCIES[rule.frequency]?.label || 'Повторяется';
  const interval = rule.interval > 1 ? `, каждые ${rule.interval}` : '';
  const days =
    rule.frequency === 'weekly' && rule.daysOfWeek?.length
      ? ` (${rule.daysOfWeek.map(d => WEEKDAYS_SHORT[(d + 6) % 7]).join(', ')})`
      : '';
  const until = rule.endDate
    ? ` до ${new Date(rule.endDate).toLocaleDateString('ru-RU')}`
    : '';
  return `${base}${interval}${days}${until}`;
}

const makeStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgPrimary},
  content: {padding: 16, paddingBottom: 24},

  titleRow: {flexDirection: 'row', alignItems: 'center'},
  typeDot: {width: 10, height: 10, borderRadius: 5, marginRight: 8},
  title: {flex: 1, fontSize: 20, fontFamily: font.semiBold, color: c.textPrimary},
  typeLine: {
    fontSize: 13, fontFamily: font.regular, color: c.textTertiary,
    marginTop: 2, marginBottom: 14, marginLeft: 18,
  },

  row: {flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12},
  rowIcon: {width: 26, paddingTop: 1},
  rowText: {flex: 1, fontSize: 14.5, fontFamily: font.regular, color: c.textPrimary, lineHeight: 20},

  creator: {fontSize: 12.5, fontFamily: font.regular, color: c.textTertiary, marginTop: 8},

  actions: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: c.borderLight,
    backgroundColor: c.bgPrimary,
  },
  editBtn: {
    flex: 1, flexDirection: 'row', gap: 8,
    alignItems: 'center', justifyContent: 'center',
    height: 48, borderRadius: radius.lg, backgroundColor: c.primary,
  },
  editBtnText: {fontSize: 15, fontFamily: font.semiBold, color: '#FFFFFF'},
  deleteBtn: {
    width: 48, height: 48, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.error,
  },
});
