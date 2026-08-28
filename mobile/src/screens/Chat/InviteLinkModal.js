/**
 * Пригласительная ссылка группы (ver. 7.58).
 *
 * Замысел целиком — в backend/services/chatInvites.js. Здесь важно одно: приём
 * по ссылке выключен, пока его не включили, и первое, что видит админ, — это
 * выключатель, а не готовый адрес. Показать сразу сгенерированную ссылку
 * значило бы включить её за человека.
 *
 * Кнопки «скопировать» нет: буфера обмена в проекте нет вовсе (это отдельная
 * библиотека ради одной кнопки), а системный лист «Поделиться» и копирует, и
 * сразу отправляет в тот мессенджер, где человек и переписывается с коллегой, —
 * то есть делает ровно то, ради чего ссылку и открыли. Сам адрес при этом
 * выделяется пальцем: если нужен именно текст, его можно взять руками.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
} from 'react-native';
import {X, Link2, Share2, RefreshCw} from 'lucide-react-native';

import {chat as chatApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';

export default function InviteLinkModal({chatId, visible, onClose}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setState(null);
    chatApi.getInvite(chatId)
      .then(({data}) => setState(data))
      .catch(e => {
        Alert.alert('Ошибка', e?.response?.data?.error || 'Не удалось получить ссылку');
        onClose();
      });
  }, [chatId, onClose]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      const {data} = await fn();
      setState(data);
      if (okText) Alert.alert('Готово', okText);
    } catch (e) {
      Alert.alert('Не получилось', e?.response?.data?.error || 'Попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const rotate = () => Alert.alert(
    'Обновить ссылку?',
    'Прежняя перестанет работать. Тем, кому вы её уже отправили, придётся послать новую.',
    [
      {text: 'Отмена', style: 'cancel'},
      {
        text: 'Обновить',
        style: 'destructive',
        onPress: () => run(() => chatApi.rotateInvite(chatId), 'Ссылка обновлена'),
      },
    ],
  );

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.title}>Приглашение по ссылке</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <X size={20} color={c.textTertiary} />
            </TouchableOpacity>
          </View>

          {!state ? (
            <View style={styles.loader}><LogoLoader width={80} /></View>
          ) : !state.enabled ? (
            <>
              <Text style={styles.hint}>
                По ссылке в группу сможет вступить любой сотрудник портала, у кого
                она окажется. Посторонним ссылка бесполезна — она требует входа
                в портал.
              </Text>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, busy && styles.btnOff]}
                disabled={busy}
                activeOpacity={0.85}
                onPress={() => run(() => chatApi.enableInvite(chatId), 'Ссылка готова')}>
                <Link2 size={16} color="#FFFFFF" />
                <Text style={styles.btnPrimaryText}>Включить приглашение</Text>
              </TouchableOpacity>

              {/* У выключенной, но уже выданной ссылки адрес прежний — про это
                  стоит сказать заранее, иначе включение выглядит как выпуск
                  новой ссылки */}
              {Boolean(state.url) && (
                <Text style={styles.note}>
                  Включится прежняя ссылка. Чтобы разосланная раньше перестала
                  работать, обновите её после включения.
                </Text>
              )}
            </>
          ) : (
            <>
              <View style={styles.urlBox}>
                <Text style={styles.url} selectable numberOfLines={2}>{state.url}</Text>
              </View>

              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary]}
                activeOpacity={0.85}
                onPress={() => Share.share({message: state.url}).catch(() => {})}>
                <Share2 size={16} color="#FFFFFF" />
                <Text style={styles.btnPrimaryText}>Поделиться ссылкой</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, styles.btnPlain, busy && styles.btnOff]}
                disabled={busy}
                activeOpacity={0.8}
                onPress={rotate}>
                <RefreshCw size={15} color={c.textPrimary} />
                <Text style={styles.btnPlainText}>Обновить ссылку</Text>
              </TouchableOpacity>

              <Text style={styles.note}>
                «Обновить» выдаёт новый адрес, а разосланный раньше перестаёт
                работать — так забирают доступ у тех, кому ссылку переслали дальше.
              </Text>

              <TouchableOpacity
                style={[styles.btn, styles.btnDanger, busy && styles.btnOff]}
                disabled={busy}
                activeOpacity={0.8}
                onPress={() => run(() => chatApi.disableInvite(chatId), 'Приглашение выключено')}>
                <Text style={styles.btnDangerText}>Выключить приглашение</Text>
              </TouchableOpacity>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = c => StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
  },
  card: {
    width: '100%', backgroundColor: c.bgPrimary,
    borderRadius: radius.xl, padding: 20, gap: 12,
  },
  head: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  title: {flex: 1, fontSize: 17, fontFamily: font.semiBold, color: c.textPrimary},
  loader: {alignItems: 'center', paddingVertical: 20},

  hint: {fontSize: 13.5, fontFamily: font.regular, color: c.textSecondary, lineHeight: 19},
  note: {fontSize: 12, fontFamily: font.regular, color: c.textTertiary, lineHeight: 17},

  urlBox: {
    backgroundColor: c.bgSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  url: {fontSize: 13, fontFamily: font.regular, color: c.textPrimary, lineHeight: 18},

  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: radius.md, paddingVertical: 12,
  },
  btnOff: {opacity: 0.5},
  btnPrimary: {backgroundColor: c.primary},
  btnPrimaryText: {fontSize: 14.5, fontFamily: font.semiBold, color: '#FFFFFF'},
  btnPlain: {backgroundColor: c.bgTertiary},
  btnPlainText: {fontSize: 14, fontFamily: font.medium, color: c.textPrimary},
  btnDanger: {backgroundColor: `${c.error}1E`},
  btnDangerText: {fontSize: 14, fontFamily: font.medium, color: c.error},
});
