import React, {useEffect, useMemo, useState} from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
  FlatList,
  Pressable,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  Check, ChevronRight, Clock, Flag, MapPin, Bell, Repeat, Eye, Users, Tag, CircleDot,
} from 'lucide-react-native';

import {calendar as calendarApi, chat as chatApi} from '../../services/api';
import {syncCalendarReminders} from '../../services/calendarReminders';
import Avatar from '../../components/Avatar';
import BottomSheet from '../../components/BottomSheet';
import {radius, font} from '../../theme';
import {useSettings, useTheme, useThemedStyles} from '../../store/settingsStore';
import LogoLoader from '../../components/LogoLoader';
import {
  EDITABLE_TYPES,
  EVENT_TYPES,
  FREQUENCIES,
  PRIORITIES,
  REMINDER_PRESETS,
  STATUSES,
  VISIBILITY,
  WEEKDAYS_SHORT,
  MONTHS_GENITIVE,
  formatTime,
  reminderLabel,
} from './eventMeta';

/**
 * Создание и правка события.
 *
 * Подача — списком настроек, как в календарях телефона и в Telegram: строка
 * «поле — значение — стрелка», а выбор открывается нижней шторкой. Раньше все
 * варианты лежали прямо на экране рядами кнопок: форма растягивалась на три
 * прокрутки, и на ней было не видно, что вообще выбрано.
 *
 * Набор полей — тот же, что в вебе (frontend/src/components/calendar/EventModal.js):
 * событие, заведённое с телефона, не должно оказаться урезанным в браузере.
 */

const NO_REPEAT = 'none';

// Начало по умолчанию — ближайший час: событие «через 10 минут» заводят редко,
// а перебирать минуты в пикере долго
function defaultStart(dateIso) {
  const base = dateIso ? new Date(dateIso) : new Date();
  const now = new Date();
  base.setHours(base.toDateString() === now.toDateString() ? now.getHours() + 1 : 10, 0, 0, 0);
  return base;
}

function shortDate(date) {
  const d = new Date(date);
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()].slice(0, 3)}`;
}

export default function EventEditScreen({route, navigation}) {
  const c = useTheme();
  const settings = useSettings();
  const styles = useThemedStyles(makeStyles);

  const existing = route.params?.event || null;
  const isEdit = Boolean(existing);

  const [title, setTitle] = useState(existing?.title || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [location, setLocation] = useState(existing?.location || '');
  const [allDay, setAllDay] = useState(Boolean(existing?.allDay));
  const [start, setStart] = useState(() =>
    existing ? new Date(existing.startTime) : defaultStart(route.params?.date),
  );
  const [end, setEnd] = useState(() =>
    existing
      ? new Date(existing.endTime || existing.startTime)
      : new Date(defaultStart(route.params?.date).getTime() + 60 * 60 * 1000),
  );
  const [eventType, setEventType] = useState(existing?.eventType || 'personal');
  const [priority, setPriority] = useState(existing?.priority || 'medium');
  const [status, setStatus] = useState(existing?.status || 'planned');
  const [visibility, setVisibility] = useState(
    existing?.visibility || settings.taskDefaultVisibility || 'private',
  );
  const [sharedWith, setSharedWith] = useState(existing?.sharedWith || []);
  const [participants, setParticipants] = useState(
    (existing?.participants || []).map(p => (typeof p === 'string' ? p : p.userId)).filter(Boolean),
  );
  const [frequency, setFrequency] = useState(
    existing?.isRecurring ? existing?.recurrenceRule?.frequency || 'weekly' : NO_REPEAT,
  );
  const [daysOfWeek, setDaysOfWeek] = useState(existing?.recurrenceRule?.daysOfWeek || []);
  const [repeatUntil, setRepeatUntil] = useState(existing?.recurrenceRule?.endDate || null);
  const [reminders, setReminders] = useState(() =>
    (existing?.reminders || []).map(r => r.minutesBefore || 15),
  );

  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(null); // {field, mode}
  const [sheet, setSheet] = useState(null); // 'type' | 'priority' | ...
  const [users, setUsers] = useState([]);
  const [userQuery, setUserQuery] = useState('');

  const save = React.useCallback(async () => {
    if (!title.trim()) {
      Alert.alert('Без названия нельзя', 'Введите название события');
      return;
    }
    // «Весь день» на сервере — обычное событие с границами суток: отдельного
    // формата хранения нет, а без нормализации в списке появлялось бы время
    const startAt = new Date(start);
    const endAt = new Date(end);
    if (allDay) {
      startAt.setHours(0, 0, 0, 0);
      endAt.setHours(23, 59, 0, 0);
    }
    if (endAt <= startAt) {
      Alert.alert('Проверьте время', 'Окончание должно быть позже начала');
      return;
    }

    const isRecurring = frequency !== NO_REPEAT;
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      startTime: startAt.toISOString(),
      endTime: endAt.toISOString(),
      allDay,
      eventType,
      priority,
      status,
      color: EVENT_TYPES[eventType]?.color,
      isRecurring,
      recurrenceRule: isRecurring
        ? {frequency, interval: 1, daysOfWeek, endDate: repeatUntil}
        : null,
      reminders: reminders.map(minutesBefore => ({type: 'notification', minutesBefore})),
      visibility,
      sharedWith: visibility === 'shared' ? sharedWith : [],
      participants: participants.map(userId => ({userId, status: 'pending'})),
    };

    setSaving(true);
    try {
      if (isEdit) {
        await calendarApi.updateEvent(existing.id, payload);
      } else {
        await calendarApi.createEvent(payload);
      }
      // Напоминания планируются на устройстве — расписание надо пересобрать
      // сразу, а не ждать следующего запуска приложения
      syncCalendarReminders();
      navigation.goBack();
    } catch (e) {
      const message =
        e?.response?.data?.error ||
        e?.response?.data?.errors?.[0]?.msg ||
        'Не удалось сохранить событие';
      Alert.alert('Ошибка', message);
    } finally {
      setSaving(false);
    }
  }, [
    title, description, location, allDay, start, end, eventType, priority, status,
    frequency, daysOfWeek, repeatUntil, reminders, visibility, sharedWith, participants,
    isEdit, existing, navigation,
  ]);

  // Действие вынесено в шапку — как в системных формах: содержимое тогда
  // прокручивается целиком, а кнопка всегда на виду
  useEffect(() => {
    navigation.setOptions({
      title: isEdit ? 'Событие' : 'Новое событие',
      headerRight: () =>
        saving ? (
          <LogoLoader width={40} color="#FFFFFF" />
        ) : (
          <TouchableOpacity onPress={save} hitSlop={10}>
            <Text style={styles.headerAction}>Готово</Text>
          </TouchableOpacity>
        ),
    });
  }, [navigation, isEdit, saving, save, styles]);

  // Список сотрудников нужен только для участников и доступа — тянем один раз
  useEffect(() => {
    const needsUsers = sheet === 'shared' || sheet === 'participants';
    if (!needsUsers || users.length) return;
    chatApi
      .getUsers()
      .then(res => setUsers(res.data || []))
      .catch(() => setUsers([]));
  }, [sheet, users.length]);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      `${u.displayName || ''} ${u.username || ''}`.toLowerCase().includes(q),
    );
  }, [users, userQuery]);

  /**
   * Правка даты/времени.
   *
   * Конец тянется за началом: если начало уехало за конец, конец сдвигается на
   * ту же длительность. Иначе почти каждая правка начала требовала бы вручную
   * поправить и конец, а сервер такое событие просто не примет.
   */
  const onPicked = (field, value) => {
    if (!value) return;
    if (field === 'until') {
      setRepeatUntil(value.toISOString());
      return;
    }
    if (field === 'start') {
      const shift = value.getTime() - start.getTime();
      setStart(value);
      if (end.getTime() <= value.getTime()) setEnd(new Date(end.getTime() + shift));
      return;
    }
    if (value.getTime() <= start.getTime()) {
      Alert.alert('Проверьте время', 'Окончание должно быть позже начала');
      return;
    }
    setEnd(value);
  };

  const toggleReminder = minutes => {
    setReminders(prev =>
      prev.includes(minutes)
        ? prev.filter(m => m !== minutes)
        : [...prev, minutes].sort((a, b) => a - b),
    );
  };

  const toggleWeekday = index => {
    // На сервере и в вебе дни недели — как в JS: 0 это воскресенье
    const day = (index + 1) % 7;
    setDaysOfWeek(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort(),
    );
  };

  const toggleUser = id => {
    const key = String(id);
    const setter = sheet === 'shared' ? setSharedWith : setParticipants;
    setter(prev =>
      prev.map(String).includes(key) ? prev.filter(x => String(x) !== key) : [...prev, id],
    );
  };

  const pickerValue =
    picker?.field === 'start' ? start
      : picker?.field === 'end' ? end
        : repeatUntil ? new Date(repeatUntil) : new Date();

  const repeatSummary =
    frequency === NO_REPEAT
      ? 'Не повторять'
      : FREQUENCIES[frequency]?.label + (repeatUntil ? `, до ${shortDate(repeatUntil)}` : '');

  const remindersSummary = reminders.length
    ? reminders.map(reminderLabel).join(', ')
    : 'Нет';

  const selectedIds = sheet === 'shared' ? sharedWith : participants;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {/* Название и описание — без подписей: подсказки в самих полях
            понятнее ярлыков, а форма начинается сразу с дела */}
        <View style={styles.card}>
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="Название события"
            placeholderTextColor={c.textTertiary}
            maxLength={200}
          />
          <View style={styles.divider} />
          <TextInput
            style={styles.descInput}
            value={description}
            onChangeText={setDescription}
            placeholder="Описание"
            placeholderTextColor={c.textTertiary}
            multiline
          />
        </View>

        <View style={styles.card}>
          <SwitchRow
            styles={styles}
            icon={<Clock size={18} color={c.textSecondary} />}
            label="Весь день"
            value={allDay}
            onChange={setAllDay}
            trackColor={c.primary}
          />
          <View style={styles.divider} />
          <DateRow
            styles={styles}
            label="Начало"
            date={start}
            allDay={allDay}
            onDate={() => setPicker({field: 'start', mode: 'date'})}
            onTime={() => setPicker({field: 'start', mode: 'time'})}
          />
          <View style={styles.divider} />
          <DateRow
            styles={styles}
            label="Окончание"
            date={end}
            allDay={allDay}
            onDate={() => setPicker({field: 'end', mode: 'date'})}
            onTime={() => setPicker({field: 'end', mode: 'time'})}
          />
        </View>

        <View style={styles.card}>
          <Row
            styles={styles}
            icon={<Tag size={18} color={c.textSecondary} />}
            label="Тип"
            value={EVENT_TYPES[eventType]?.label}
            dot={EVENT_TYPES[eventType]?.color}
            onPress={() => setSheet('type')}
          />
          <View style={styles.divider} />
          <Row
            styles={styles}
            icon={<Flag size={18} color={c.textSecondary} />}
            label="Приоритет"
            value={PRIORITIES[priority]?.label}
            dot={PRIORITIES[priority]?.color}
            onPress={() => setSheet('priority')}
          />
          {isEdit && (
            <>
              <View style={styles.divider} />
              <Row
                styles={styles}
                icon={<CircleDot size={18} color={c.textSecondary} />}
                label="Статус"
                value={STATUSES[status]?.label}
                onPress={() => setSheet('status')}
              />
            </>
          )}
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowIcon}><MapPin size={18} color={c.textSecondary} /></View>
            <Text style={styles.rowLabel}>Место</Text>
            <TextInput
              style={styles.inlineInput}
              value={location}
              onChangeText={setLocation}
              placeholder="Не указано"
              placeholderTextColor={c.textTertiary}
              textAlign="right"
            />
          </View>
        </View>

        <View style={styles.card}>
          <Row
            styles={styles}
            icon={<Bell size={18} color={c.textSecondary} />}
            label="Напоминание"
            value={remindersSummary}
            onPress={() => setSheet('reminders')}
          />
          <View style={styles.divider} />
          <Row
            styles={styles}
            icon={<Repeat size={18} color={c.textSecondary} />}
            label="Повтор"
            value={repeatSummary}
            onPress={() => setSheet('repeat')}
          />
        </View>

        <View style={styles.card}>
          <Row
            styles={styles}
            icon={<Eye size={18} color={c.textSecondary} />}
            label="Кто видит"
            value={VISIBILITY[visibility]?.label}
            onPress={() => setSheet('visibility')}
          />
          {visibility === 'shared' && (
            <>
              <View style={styles.divider} />
              <Row
                styles={styles}
                icon={<Users size={18} color={c.textSecondary} />}
                label="Кому показывать"
                value={sharedWith.length ? `${sharedWith.length} чел.` : 'Никому'}
                onPress={() => setSheet('shared')}
              />
            </>
          )}
          <View style={styles.divider} />
          <Row
            styles={styles}
            icon={<Users size={18} color={c.textSecondary} />}
            label="Участники"
            value={participants.length ? `${participants.length} чел.` : 'Нет'}
            onPress={() => setSheet('participants')}
          />
        </View>

        <Text style={styles.footnote}>
          Участники видят событие в своём календаре и получают напоминания о нём.
        </Text>
      </ScrollView>

      {/* Системный выбор даты/времени: на Android это отдельный диалог,
          поэтому компонент монтируется только на время показа */}
      {picker && (
        <DateTimePicker
          value={pickerValue}
          mode={picker.mode}
          is24Hour
          onChange={(event, value) => {
            setPicker(null);
            if (event.type === 'set') onPicked(picker.field, value);
          }}
        />
      )}

      <OptionSheet
        visible={sheet === 'type'}
        title="Тип события"
        options={EDITABLE_TYPES.map(key => ({
          key, label: EVENT_TYPES[key].label, dot: EVENT_TYPES[key].color,
        }))}
        selected={[eventType]}
        onSelect={key => {
          setEventType(key);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        styles={styles}
        c={c}
      />

      <OptionSheet
        visible={sheet === 'priority'}
        title="Приоритет"
        options={Object.entries(PRIORITIES).map(([key, v]) => ({key, label: v.label, dot: v.color}))}
        selected={[priority]}
        onSelect={key => {
          setPriority(key);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        styles={styles}
        c={c}
      />

      <OptionSheet
        visible={sheet === 'status'}
        title="Статус"
        options={Object.entries(STATUSES).map(([key, v]) => ({key, label: v.label}))}
        selected={[status]}
        onSelect={key => {
          setStatus(key);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        styles={styles}
        c={c}
      />

      <OptionSheet
        visible={sheet === 'visibility'}
        title="Кто видит событие"
        options={Object.entries(VISIBILITY).map(([key, v]) => ({
          key, label: v.label, hint: v.hint,
        }))}
        selected={[visibility]}
        onSelect={key => {
          setVisibility(key);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        styles={styles}
        c={c}
      />

      {/* Напоминаний может быть несколько — шторка остаётся открытой */}
      <OptionSheet
        visible={sheet === 'reminders'}
        title="Напоминания"
        options={REMINDER_PRESETS.map(p => ({key: p.minutes, label: p.label}))}
        selected={reminders}
        multi
        onSelect={toggleReminder}
        onClose={() => setSheet(null)}
        styles={styles}
        c={c}
      />

      <BottomSheet visible={sheet === 'repeat'} title="Повтор" onClose={() => setSheet(null)}>
        <ScrollView bounces={false}>
          {[{key: NO_REPEAT, label: 'Не повторять'},
            ...Object.entries(FREQUENCIES).map(([key, v]) => ({key, label: v.label}))
          ].map(option => (
            <TouchableOpacity
              key={option.key}
              style={styles.optionRow}
              onPress={() => setFrequency(option.key)}>
              <Text style={styles.optionLabel}>{option.label}</Text>
              {frequency === option.key && <Check size={19} color={c.primary} />}
            </TouchableOpacity>
          ))}

          {frequency === 'weekly' && (
            <View style={styles.weekdaysWrap}>
              <Text style={styles.sheetSectionLabel}>По каким дням</Text>
              <View style={styles.weekdays}>
                {WEEKDAYS_SHORT.map((label, i) => {
                  const active = daysOfWeek.includes((i + 1) % 7);
                  return (
                    <TouchableOpacity
                      key={label}
                      style={[styles.weekday, active && styles.weekdayActive]}
                      onPress={() => toggleWeekday(i)}>
                      <Text style={[styles.weekdayText, active && styles.weekdayTextActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {frequency !== NO_REPEAT && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => setPicker({field: 'until', mode: 'date'})}>
                <Text style={styles.optionLabel}>Повторять до</Text>
                <Text style={styles.optionValue}>
                  {repeatUntil ? new Date(repeatUntil).toLocaleDateString('ru-RU') : 'Без конца'}
                </Text>
              </TouchableOpacity>
              {!!repeatUntil && (
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={() => setRepeatUntil(null)}>
                  <Text style={[styles.optionLabel, {color: c.error}]}>Убрать дату окончания</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          <View style={styles.sheetBottomPad} />
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        visible={sheet === 'shared' || sheet === 'participants'}
        title={sheet === 'shared' ? 'Кому показывать' : 'Участники'}
        onClose={() => {
          setSheet(null);
          setUserQuery('');
        }}>
        <TextInput
          style={styles.searchInput}
          value={userQuery}
          onChangeText={setUserQuery}
          placeholder="Поиск сотрудника"
          placeholderTextColor={c.textTertiary}
        />
        <FlatList
          data={filteredUsers}
          keyExtractor={item => String(item.id)}
          keyboardShouldPersistTaps="handled"
          renderItem={({item}) => {
            const picked = selectedIds.map(String).includes(String(item.id));
            return (
              <Pressable
                style={({pressed}) => [styles.userRow, pressed && styles.rowPressed]}
                onPress={() => toggleUser(item.id)}>
                <Avatar uri={item.avatar} size={38} />
                <Text style={styles.userName} numberOfLines={1}>
                  {item.displayName || item.username}
                </Text>
                {picked && <Check size={19} color={c.primary} />}
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={styles.sheetEmpty}>Никого не нашлось</Text>}
        />
      </BottomSheet>
    </View>
  );
}

// ── Строки списка ────────────────────────────────────────────────────────────

function Row({icon, label, value, dot, onPress, styles}) {
  return (
    <Pressable
      style={({pressed}) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueWrap}>
        {!!dot && <View style={[styles.valueDot, {backgroundColor: dot}]} />}
        <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
      </View>
      <ChevronRight size={17} color={styles.chevronColor.color} />
    </Pressable>
  );
}

function SwitchRow({icon, label, value, onChange, styles, trackColor}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{true: trackColor}} />
    </View>
  );
}

/** Дата и время — двумя отдельными целями: менять их поодиночке удобнее, чем
 *  проходить оба шага системного диалога ради одной минуты. */
function DateRow({label, date, allDay, onDate, onTime, styles}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon} />
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.dateValues}>
        <Pressable
          style={({pressed}) => [styles.datePill, pressed && styles.rowPressed]}
          onPress={onDate}>
          <Text style={styles.datePillText}>{shortDate(date)}</Text>
        </Pressable>
        {!allDay && (
          <Pressable
            style={({pressed}) => [styles.datePill, pressed && styles.rowPressed]}
            onPress={onTime}>
            <Text style={styles.datePillText}>{formatTime(date)}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Шторка со списком вариантов. multi — оставаться открытой и допускать
 *  несколько отметок (напоминания). */
function OptionSheet({visible, title, options, selected, multi, onSelect, onClose, styles, c}) {
  const keys = selected.map(String);
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose} maxHeightRatio={0.7}>
      <ScrollView bounces={false}>
        {options.map(option => (
          <Pressable
            key={String(option.key)}
            style={({pressed}) => [styles.optionRow, pressed && styles.rowPressed]}
            onPress={() => onSelect(option.key)}>
            {!!option.dot && <View style={[styles.valueDot, {backgroundColor: option.dot}]} />}
            <View style={styles.optionTextWrap}>
              <Text style={styles.optionLabel}>{option.label}</Text>
              {!!option.hint && <Text style={styles.optionHint}>{option.hint}</Text>}
            </View>
            {keys.includes(String(option.key)) && <Check size={19} color={c.primary} />}
          </Pressable>
        ))}
        {multi && (
          <TouchableOpacity style={styles.sheetDone} onPress={onClose}>
            <Text style={styles.sheetDoneText}>Готово</Text>
          </TouchableOpacity>
        )}
        <View style={styles.sheetBottomPad} />
      </ScrollView>
    </BottomSheet>
  );
}

const makeStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 12, paddingBottom: 32},
  headerAction: {fontSize: 16, fontFamily: font.semiBold, color: '#FFFFFF'},

  // Карточки-группы: поля собраны по смыслу, между группами воздух
  card: {
    backgroundColor: c.bgPrimary, borderRadius: radius.lg,
    marginBottom: 12, overflow: 'hidden',
  },
  divider: {height: StyleSheet.hairlineWidth, backgroundColor: c.borderLight, marginLeft: 46},

  titleInput: {
    fontSize: 17, fontFamily: font.medium, color: c.textPrimary,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  descInput: {
    fontSize: 15, fontFamily: font.regular, color: c.textPrimary,
    paddingHorizontal: 16, paddingVertical: 12,
    minHeight: 72, textAlignVertical: 'top',
  },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13, minHeight: 52,
  },
  rowPressed: {backgroundColor: c.bgSecondary},
  rowIcon: {width: 30},
  rowLabel: {fontSize: 15, fontFamily: font.regular, color: c.textPrimary},
  rowValueWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'flex-end', gap: 6, marginLeft: 12,
  },
  rowValue: {fontSize: 14.5, fontFamily: font.regular, color: c.textSecondary, flexShrink: 1},
  valueDot: {width: 8, height: 8, borderRadius: 4},
  // Цвет стрелки берётся отсюда: иконке нужен цвет строкой, а не стилем
  chevronColor: {color: c.textTertiary},
  inlineInput: {
    flex: 1, marginLeft: 12, paddingVertical: 0,
    fontSize: 14.5, fontFamily: font.regular, color: c.textPrimary,
  },

  dateValues: {flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 8},
  datePill: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.md, backgroundColor: c.bgSecondary,
  },
  datePillText: {fontSize: 14.5, fontFamily: font.medium, color: c.textPrimary},

  footnote: {
    fontSize: 12.5, fontFamily: font.regular, color: c.textTertiary,
    paddingHorizontal: 16, marginTop: 2,
  },

  // ── Шторки ──
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  optionTextWrap: {flex: 1},
  optionLabel: {fontSize: 15.5, fontFamily: font.regular, color: c.textPrimary},
  optionHint: {fontSize: 12.5, fontFamily: font.regular, color: c.textTertiary, marginTop: 1},
  optionValue: {fontSize: 14.5, fontFamily: font.regular, color: c.textSecondary},
  sheetSectionLabel: {
    fontSize: 12.5, fontFamily: font.medium, color: c.textSecondary,
    paddingHorizontal: 20, paddingBottom: 8,
  },
  weekdaysWrap: {paddingTop: 8},
  weekdays: {flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20},
  weekday: {
    width: 38, height: 38, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.bgSecondary,
  },
  weekdayActive: {backgroundColor: c.primary},
  weekdayText: {fontSize: 13, fontFamily: font.medium, color: c.textSecondary},
  weekdayTextActive: {color: '#FFFFFF'},
  sheetDone: {alignItems: 'center', paddingVertical: 14},
  sheetDoneText: {fontSize: 15.5, fontFamily: font.semiBold, color: c.primary},
  sheetBottomPad: {height: 12},
  sheetEmpty: {
    textAlign: 'center', paddingVertical: 24,
    fontSize: 14, fontFamily: font.regular, color: c.textTertiary,
  },
  searchInput: {
    marginHorizontal: 20, marginBottom: 8,
    backgroundColor: c.bgSecondary, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 9,
    fontSize: 14.5, fontFamily: font.regular, color: c.textPrimary,
  },
  userRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 9,
  },
  userName: {flex: 1, fontSize: 15, fontFamily: font.regular, color: c.textPrimary},
});
