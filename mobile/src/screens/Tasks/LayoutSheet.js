/**
 * Раскладка часов многодневной подзадачи по дням окна (ver. 8.48).
 *
 * Тот же разговор, что и в вебе, и слова в нём обязаны совпадать: человек
 * раскладывает одну и ту же работу и там, и здесь. До 8.48 подзадача должна была
 * поместиться в один рабочий день, и работа на двадцать часов не ставилась в
 * план вообще; теперь у неё есть окно дат, а здесь человек говорит, сколько
 * часов сидит над ней в каждый его день.
 *
 * Раскладывает человек, а не система: кнопки «разложить поровну» нет намеренно —
 * ровный слой молча влезает в уже плотный день и перегружает его, ровно то,
 * против чего модуль затевался. Зато у каждого дня подписано его свободное
 * время, и нажатие по строке заполняет её этим остатком: решение про один день,
 * принятое человеком.
 *
 * На телефоне ввод шагами по 15 минут, а не клавиатурой. Числовое поле здесь
 * означало бы поднятую клавиатуру поверх той самой таблицы, по которой человек и
 * решает, сколько куда положить, — а решение это глазами по полосам загрузки, а
 * не вслепую.
 */

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
} from 'react-native';
import {Minus, Plus, X} from 'lucide-react-native';

import {tasks as tasksApi} from '../../services/api';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import LoadBar from './LoadBar';
import {daysBetween, dnum, dshort, estimateText, hoursText} from './taskMeta';

/** Шаг — четверть часа, как и на шкале дня в веб-форме постановки. */
const STEP = 0.25;

const round = value => Math.round(value * 100) / 100;

export default function LayoutSheet({
  visible,
  window: frame,
  estimateHours,
  days: given,
  userId,
  title,
  submitLabel = 'Поставить в план',
  busy,
  onSubmit,
  onClose,
}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [days, setDays] = useState(given || null);
  const [hours, setHours] = useState({});
  const [loading, setLoading] = useState(!given);

  const from = frame?.from;
  const to = frame?.to;

  /**
   * Загрузка по дням окна. Может приехать готовой — её отдаёт разбор во входящих,
   * и второй запрос за теми же числами был бы вторым способом их посчитать.
   */
  useEffect(() => {
    if (!visible) return undefined;
    if (given) {
      setDays(given);
      setLoading(false);
      return undefined;
    }
    if (!from || !to) return undefined;
    let alive = true;
    setLoading(true);
    tasksApi
      .getPersonLoad(userId, from, to)
      .then(res => {
        if (alive) setDays(res.data?.days || []);
      })
      .catch(() => {
        if (alive) setDays([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [visible, given, userId, from, to]);

  // Открыли заново — раскладка пустая. Оставленные с прошлого раза часы
  // относились бы к другому окну или к другой подзадаче.
  useEffect(() => {
    if (visible) setHours({});
  }, [visible, from, to]);

  const byDate = useMemo(
    () => new Map((days || []).map(day => [day.date, day])),
    [days],
  );

  const rows = (from && to ? daysBetween(from, to) : []).map(date => {
    const day = byDate.get(date) || {};
    const planned = Number(hours[date] || 0);
    const norm = day.norm === null || day.norm === undefined ? null : Number(day.norm);
    const after = round(Number(day.hours || 0) + planned);
    return {
      date,
      day,
      planned,
      norm,
      after,
      free: Number(day.free || 0),
      // День, в который раскладывать нельзя: выходной, отпуск или человек не
      // заведён в модуле. Сервер отказал бы по такому дню, и открытый шаг здесь
      // обещал бы невозможное.
      closed: !!day.onVacation || !!day.onDayOff || !norm,
      over: norm !== null && after > norm + 1e-9 ? round(after - norm) : 0,
    };
  });

  const total = round(rows.reduce((sum, row) => sum + row.planned, 0));
  const need = round(Number(estimateHours) || 0);
  const left = round(need - total);
  const overloaded = rows.filter(row => row.planned > 0 && row.over > 0);
  const capacity = round(
    rows.filter(row => !row.closed).reduce((sum, row) => sum + row.free, 0),
  );
  const ready = total > 0 && Math.abs(total - need) < 0.005;

  const bump = useCallback((date, delta) => {
    setHours(prev => {
      const next = round(Math.max(Number(prev[date] || 0) + delta, 0));
      return {...prev, [date]: next || 0};
    });
  }, []);

  /**
   * Нажатие по строке — «всё свободное этого дня», но не больше того, что
   * осталось разложить: иначе кнопка тут же делала бы сумму больше оценки, то
   * есть предлагала бы сделать неверно.
   */
  const fill = row => {
    if (row.closed) return;
    const take = Math.min(row.free, round(left + row.planned));
    if (take <= 0) return;
    setHours(prev => ({...prev, [row.date]: round(Math.round(take / STEP) * STEP)}));
  };

  const submit = () => {
    if (!ready) return;
    const layout = rows
      .filter(row => row.planned > 0)
      .map(row => ({date: row.date, hours: row.planned}));
    if (!overloaded.length) {
      onSubmit(layout, false);
      return;
    }
    // Взять сверх нормы можно — это своё решение исполнителя, — но подтверждение
    // спрашивается по конкретным дням, а не одной галочкой на всё окно.
    Alert.alert(
      'Переработка',
      `${overloaded
        .map(row => `${dnum(row.date)} — станет ${hoursText(row.after)} из ${hoursText(row.norm)}`)
        .join('\n')}\n\nАвтор увидит, что вы в переработке.`,
      [
        {text: 'Отмена', style: 'cancel'},
        {text: 'Всё равно взять', onPress: () => onSubmit(layout, true)},
      ],
    );
  };

  return (
    <Modal visible={!!visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.mask}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={{flex: 1}}>
              <Text style={styles.title}>{title || 'Разложить по дням'}</Text>
              <Text style={styles.sub}>
                {dnum(from)} — {dnum(to)} · разложить {estimateText(need)}
              </Text>
            </View>
            <Pressable style={styles.close} onPress={onClose} hitSlop={8}>
              <X size={20} color={c.textSecondary} />
            </Pressable>
          </View>

          {!loading && capacity < need && (
            <Text style={[styles.note, {color: c.warning}]}>
              Свободного в окне только {hoursText(capacity)} — часть часов придётся
              взять сверх нормы или попросить другое окно.
            </Text>
          )}

          {loading ? (
            <Text style={styles.note}>Смотрим свободное время…</Text>
          ) : (
            <ScrollView style={styles.rows} contentContainerStyle={{paddingBottom: 6}}>
              {rows.map(row => (
                <Pressable
                  key={row.date}
                  style={[
                    styles.row,
                    row.closed && styles.rowClosed,
                    // Переработка подкрашивает строку, а не красит текст:
                    // в списке из десяти дней один красный абзац теряется, а
                    // подложка видна сразу. Цвет задан прозрачностью от error, а
                    // не отдельным токеном: в палитре светлого варианта нет.
                    row.planned > 0 && row.over > 0 && {backgroundColor: 'rgba(255,59,48,0.09)', borderColor: c.error},
                  ]}
                  disabled={row.closed || busy}
                  onPress={() => fill(row)}>
                  <View style={styles.rowTop}>
                    <Text style={styles.day}>{dshort(row.date)}</Text>

                    <View style={styles.stepper}>
                      <Pressable
                        style={[styles.step, (row.closed || !row.planned) && styles.stepOff]}
                        disabled={row.closed || !row.planned || busy}
                        hitSlop={6}
                        onPress={() => bump(row.date, -STEP)}>
                        <Minus size={15} color={c.textSecondary} />
                      </Pressable>
                      <Text style={[styles.value, row.planned > 0 && {color: c.textPrimary}]}>
                        {row.planned > 0 ? hoursText(row.planned) : '—'}
                      </Text>
                      <Pressable
                        style={[styles.step, row.closed && styles.stepOff]}
                        disabled={row.closed || busy}
                        hitSlop={6}
                        onPress={() => bump(row.date, STEP)}>
                        <Plus size={15} color={c.textSecondary} />
                      </Pressable>
                    </View>
                  </View>

                  <LoadBar
                    hours={row.after}
                    norm={row.norm}
                    onVacation={row.day.onVacation}
                    compact
                  />

                  <Text
                    style={[
                      styles.hint,
                      row.planned > 0 && row.over > 0 && {color: c.error},
                    ]}>
                    {row.closed
                      ? row.day.onVacation
                        ? 'отпуск'
                        : row.day.onDayOff
                          ? 'выходной'
                          : 'норма не задана'
                      : row.planned > 0 && row.over > 0
                        ? `станет ${hoursText(row.after)} из ${hoursText(row.norm)} — переработка ${hoursText(row.over)}`
                        : row.free > 0
                          ? `свободно ${hoursText(row.free)} — нажмите, чтобы заполнить`
                          : 'день занят'}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={styles.foot}>
            <Text style={styles.total}>
              разложено{' '}
              <Text style={[styles.totalValue, ready && {color: c.success}]}>
                {hoursText(total)}
              </Text>{' '}
              из {hoursText(need)}
              {!ready && left > 0 ? ` · осталось ${hoursText(left)}` : ''}
              {!ready && left < 0 ? ` · лишние ${hoursText(-left)}` : ''}
            </Text>
            <Pressable
              style={[
                styles.submit,
                overloaded.length && {backgroundColor: c.error},
                (!ready || busy) && styles.submitOff,
              ]}
              disabled={!ready || busy}
              onPress={submit}>
              <Text style={styles.submitText}>
                {overloaded.length ? 'Всё равно взять' : submitLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = c =>
  StyleSheet.create({
    mask: {flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end'},
    // Лист на три четверти экрана, а не во всю высоту: видно, что под ним
    // осталась карточка задачи, из которой человек пришёл.
    sheet: {
      maxHeight: '86%',
      backgroundColor: c.bgPrimary,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      padding: 16,
      paddingBottom: 22,
    },
    head: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
    title: {fontFamily: font.semiBold, fontSize: 16, color: c.textPrimary},
    sub: {fontFamily: font.regular, fontSize: 12.5, color: c.textSecondary, marginTop: 3},
    close: {padding: 4},
    note: {
      fontFamily: font.regular,
      fontSize: 12.5,
      lineHeight: 18,
      color: c.textSecondary,
      marginTop: 9,
    },
    rows: {marginTop: 10},
    row: {
      paddingVertical: 9,
      paddingHorizontal: 10,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderLight,
      marginBottom: 7,
      gap: 7,
    },
    rowClosed: {opacity: 0.55},
    rowTop: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
    day: {fontFamily: font.medium, fontSize: 13, color: c.textPrimary},
    stepper: {flexDirection: 'row', alignItems: 'center', gap: 4},
    step: {
      width: 30,
      height: 30,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.bgSecondary,
    },
    stepOff: {opacity: 0.4},
    value: {
      minWidth: 62,
      textAlign: 'center',
      fontFamily: font.medium,
      fontSize: 13,
      color: c.textTertiary,
    },
    hint: {fontFamily: font.regular, fontSize: 11.5, color: c.textTertiary},
    foot: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.borderLight,
      gap: 10,
    },
    total: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary},
    totalValue: {fontFamily: font.semiBold, color: c.textPrimary},
    submit: {
      height: 46,
      borderRadius: radius.md,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    submitOff: {opacity: 0.45},
    submitText: {fontFamily: font.semiBold, fontSize: 14, color: '#fff'},
  });
