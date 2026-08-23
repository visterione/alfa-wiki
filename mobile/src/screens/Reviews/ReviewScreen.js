/**
 * Карточка отзыва — то, ради чего раздел вообще открывают с телефона.
 *
 * ── Что здесь можно ──────────────────────────────────────────────────────────
 *
 * Прочитать отзыв, посмотреть, что по нему уже делали, написать комментарий,
 * передвинуть по этапу и взять на себя. Это и есть работа с негативом в
 * промежутке между кабинетами: остальное — заведение отзыва, финализация с
 * категорией решения, ответ на площадке и PDF — осталось в вебе.
 *
 * Финализации нет намеренно. Она закрывает работу, требует категории решения и
 * описания, и после неё отзыв не двигается никуда: нажать такое одной рукой в
 * коридоре слишком легко. Ровно та же граница проведена у инвентаризации.
 *
 * ── Переходы ─────────────────────────────────────────────────────────────────
 *
 * Показываются только те, что разрешены с текущего этапа (NEXT_STATUSES) — те
 * же правила, что проверяет сервер. Кроме них у доски бывает свой сценарий, о
 * нём знает только сервер: если переход запрещён сценарием, он ответит отказом,
 * и текст этого отказа мы показываем как есть.
 */
import React, {useCallback, useState} from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, Linking, ActivityIndicator,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Send, ExternalLink, UserPlus, UserMinus, ArrowRight} from 'lucide-react-native';

import {reviews as reviewsApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import Stars from '../../components/Stars';
import SwipeTabs from '../../components/SwipeTabs';
import {useAuth} from '../../store/authStore';
import {refreshReviewsBadge} from '../../store/reviewsStore';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {
  NEXT_STATUSES, statusLabel, statusColor, DECISION_CATEGORIES, HISTORY_LABELS,
  dateText, dateTimeText,
} from './reviewsMeta';

export default function ReviewScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const {user} = useAuth();
  const {reviewId} = route.params || {};

  const [review, setReview] = useState(null);
  const [tab, setTab] = useState('review');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => reviewsApi.review(reviewId)
    .then(({data}) => {
      setReview(data);
      navigation.setOptions({title: data.patientName || 'Отзыв'});
    })
    .catch(() => setReview(false)), [reviewId, navigation]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (run, failTitle) => {
    setBusy(true);
    try {
      await run();
      await load();
      // Назначение и смена этапа меняют то, что висит лично на человеке, —
      // счётчик в колесе обязан догнать, не дожидаясь захода в раздел
      refreshReviewsBadge();
    } catch (e) {
      Alert.alert(failTitle, e?.response?.data?.error || 'Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  if (review === false) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Отзыв не открылся</Text>
      </View>
    );
  }
  if (!review) return <LogoLoader />;

  const mine = (review.assigneeIds || []).includes(user?.id);
  const history = [...(review.history || [])]
    .sort((a, z) => new Date(z.createdAt) - new Date(a.createdAt));
  const moves = NEXT_STATUSES[review.status] || [];

  const send = () => {
    if (!comment.trim()) return;
    act(async () => {
      await reviewsApi.comment(reviewId, {comment: comment.trim()});
      setComment('');
    }, 'Комментарий не отправлен');
  };

  const reviewPage = (
    <View style={styles.page}>
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Stars rating={review.rating} size={16} />
          <View style={[styles.chip, {backgroundColor: `${statusColor(review.status)}22`}]}>
            <Text style={[styles.chipText, {color: statusColor(review.status)}]}>
              {statusLabel(review.status)}
            </Text>
          </View>
        </View>

        <Text style={styles.text}>{review.reviewText}</Text>

        {Boolean(review.additionalInfo) && (
          <Text style={styles.extra}>{review.additionalInfo}</Text>
        )}
      </View>

      <View style={[styles.card, styles.gap]}>
        {[
          ['Пациент', review.patientName],
          ['Дата отзыва', dateText(review.reviewDate)],
          ['Площадка', review.platform?.name],
          ['Врач', review.doctorName],
          ['Доска', review.board?.name],
          ['Назначен', review.assignees?.[0]?.displayName || 'никому'],
        ].filter(([, value]) => value).map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue}>{value}</Text>
          </View>
        ))}
      </View>

      {/* Решение показывается только когда оно принято: пустой блок «решение —
          нет» на карточке в работе только занимает место */}
      {Boolean(review.decisionCategory) && (
        <View style={[styles.card, styles.gap]}>
          <Text style={styles.section}>
            {DECISION_CATEGORIES[review.decisionCategory] || review.decisionCategory}
          </Text>
          {Boolean(review.decisionDescription) && (
            <Text style={styles.text}>{review.decisionDescription}</Text>
          )}
          <Text style={styles.rowLabel}>
            {review.finalizer?.displayName} · {dateTimeText(review.finalizedAt)}
          </Text>
        </View>
      )}

      {Boolean(review.externalUrl) && (
        <Pressable
          style={[styles.link, styles.gap]}
          onPress={() => Linking.openURL(review.externalUrl)}>
          <ExternalLink size={16} color={c.primary} />
          <Text style={styles.linkText}>Оригинал на площадке</Text>
        </Pressable>
      )}
    </View>
  );

  const historyPage = (
    <View style={styles.page}>
      <View style={styles.card}>
        {history.map(entry => (
          <View key={entry.id} style={styles.entry}>
            <View style={styles.entryHead}>
              <Text style={styles.entryAction}>
                {HISTORY_LABELS[entry.action] || entry.action}
              </Text>
              <Text style={styles.entryWhen}>{dateTimeText(entry.createdAt)}</Text>
            </View>
            <Text style={styles.entryWho}>
              {entry.user?.displayName || entry.user?.username || 'Система'}
            </Text>
            {Boolean(entry.comment) && <Text style={styles.entryText}>{entry.comment}</Text>}
            {Boolean(entry.oldValue || entry.newValue) && (
              <Text style={styles.entryText}>
                {[entry.oldValue, entry.newValue].filter(Boolean).join(' → ')}
              </Text>
            )}
          </View>
        ))}
        {!history.length && <Text style={styles.none}>Пока ничего не происходило</Text>}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 130}]}
        keyboardShouldPersistTaps="handled">
        <SwipeTabs
          value={tab}
          onChange={setTab}
          tabs={[
            {key: 'review', label: 'Отзыв'},
            {key: 'history', label: `История (${history.length})`},
          ]}>
          {reviewPage}
          {historyPage}
        </SwipeTabs>

        {/* Действия под содержимым, а не в шапке: их несколько, они подписаны
            словами, и промахнуться в шапке значками было бы дороже */}
        <View style={styles.actions}>
          <Pressable
            style={styles.action}
            disabled={busy}
            onPress={() => act(
              () => reviewsApi.assign(reviewId, {assigneeId: mine ? null : user?.id}),
              'Не назначено',
            )}>
            {mine
              ? <UserMinus size={16} color={c.textSecondary} />
              : <UserPlus size={16} color={c.primary} />}
            <Text style={[styles.actionText, mine && styles.actionTextOff]}>
              {mine ? 'Снять с себя' : 'Взять на себя'}
            </Text>
          </Pressable>

          {moves.map(next => (
            <Pressable
              key={next}
              style={styles.action}
              disabled={busy}
              onPress={() => act(
                () => reviewsApi.move(reviewId, {status: next}),
                'Этап не сменился',
              )}>
              <ArrowRight size={16} color={statusColor(next)} />
              <Text style={[styles.actionText, {color: statusColor(next)}]}>
                {statusLabel(next)}
              </Text>
            </Pressable>
          ))}
        </View>

        {!moves.length && (
          <Text style={styles.note}>
            Дальше по этапам отзыв не двигается — решение принимают в веб-версии
          </Text>
        )}
      </ScrollView>

      <View style={[styles.bar, {paddingBottom: insets.bottom + 10}]}>
        <TextInput
          style={styles.input}
          value={comment}
          onChangeText={setComment}
          placeholder="Комментарий"
          placeholderTextColor={c.textTertiary}
          multiline
        />
        <Pressable
          style={[styles.send, (!comment.trim() || busy) && styles.sendOff]}
          disabled={!comment.trim() || busy}
          onPress={send}>
          {busy
            ? <ActivityIndicator size="small" color="#FFFFFF" />
            : <Send size={17} color="#FFFFFF" />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  content: {padding: 16},
  page: {width: '100%'},
  card: {backgroundColor: c.bgPrimary, borderRadius: radius.lg, padding: 14, gap: 8},
  gap: {marginTop: 12},
  cardHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  chip: {paddingHorizontal: 9, paddingVertical: 4, borderRadius: 11},
  chipText: {fontFamily: font.semiBold, fontSize: 11},
  text: {fontFamily: font.regular, fontSize: 14, color: c.textPrimary, lineHeight: 20},
  extra: {fontFamily: font.regular, fontSize: 13, color: c.textSecondary, lineHeight: 19},
  section: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  row: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
  rowLabel: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, width: 110},
  rowValue: {flex: 1, fontFamily: font.medium, fontSize: 13, color: c.textPrimary},

  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
  },
  linkText: {fontFamily: font.semiBold, fontSize: 14, color: c.primary},

  entry: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    gap: 3,
  },
  entryHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  entryAction: {fontFamily: font.semiBold, fontSize: 13, color: c.textPrimary},
  entryWhen: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary},
  entryWho: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary},
  entryText: {fontFamily: font.regular, fontSize: 13, color: c.textPrimary, lineHeight: 18},

  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14},
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: c.bgPrimary,
  },
  actionText: {fontFamily: font.medium, fontSize: 13, color: c.primary},
  actionTextOff: {color: c.textSecondary},
  note: {
    fontFamily: font.regular,
    fontSize: 12,
    color: c.textTertiary,
    marginTop: 12,
    lineHeight: 17,
  },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: c.bgPrimary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 11,
    backgroundColor: c.bgSecondary,
    color: c.textPrimary,
    fontFamily: font.regular,
    fontSize: 14,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: {opacity: 0.4},

  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', paddingVertical: 20},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: c.bgSecondary},
  emptyText: {fontFamily: font.regular, fontSize: 14, color: c.textSecondary},
});
