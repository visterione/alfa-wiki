/**
 * Отчёты склада: что приходит по расписанию и как это посмотреть сейчас.
 *
 * ── Зачем это на телефоне ────────────────────────────────────────────────────
 *
 * Регламентные отчёты рассылались только почтой, в 07:30. Кладовщик и МОЛ в это
 * время в отделении, а не за компьютером, и письмо про сроки годности они
 * читают в лучшем случае к обеду — когда просроченное уже успели выдать.
 * Теперь тот же прогон шлёт push, а сам отчёт с файлом открывается здесь.
 *
 * ── Почему отчёт пересчитывается, а не берётся из письма ─────────────────────
 *
 * Собирается он тем же кодом и по тем же правам (buildFor в services/warehouse/
 * mailing.js), но на момент открытия. Показывать вчерашний срез в разделе, куда
 * заходят «посмотреть, что там сейчас», значило бы отвечать не на тот вопрос.
 *
 * ── Отписка ──────────────────────────────────────────────────────────────────
 *
 * Переключатель выключает только письмо и push, но не доступ: отчёт по-прежнему
 * открывается отсюда. Рассылка, от которой нельзя отписаться, отключается
 * правилом в почтовом клиенте — и тогда она не доходит уже молча.
 */
import React, {useCallback, useState} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet, Switch, ActivityIndicator} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {FileDown, Bell} from 'lucide-react-native';

import {warehouse as warehouseApi, authHeader} from '../../services/api';
import {saveAttachment} from '../../services/downloads';
import LogoLoader from '../../components/LogoLoader';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';

export default function WarehouseMailingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  const [data, setData] = useState(null);
  // Сводка по каждому отчёту приходит отдельным запросом: она считается по
  // живым данным и на пустой базе тоже занимает время.
  const [summaries, setSummaries] = useState({});
  const [busy, setBusy] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    warehouseApi.mailings()
      .then(({data: payload}) => {
        if (!alive) return;
        setData(payload);
        for (const item of payload.items || []) {
          warehouseApi.mailingReport(item.code)
            .then(({data: summary}) => alive && setSummaries(prev => ({...prev, [item.code]: summary})))
            .catch(() => alive && setSummaries(prev => ({...prev, [item.code]: {failed: true}})));
        }
      })
      .catch(() => alive && setData(false));
    return () => { alive = false; };
  }, []));

  const toggle = async (code, enabled) => {
    setData(prev => ({
      ...prev,
      items: prev.items.map(item => (item.code === code ? {...item, enabled} : item)),
    }));
    await warehouseApi.setMailing(code, enabled).catch(() => {});
  };

  const download = async (code, fileName) => {
    setBusy(code);
    try {
      await saveAttachment({
        url: warehouseApi.mailingReportFileUrl(code),
        name: fileName || `${code}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers: await authHeader(),
      });
    } finally {
      setBusy(null);
    }
  };

  if (data === false) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Раздел не открылся</Text>
      </View>
    );
  }
  if (!data) return <LogoLoader />;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{padding: 16, paddingBottom: tabInset + 24}}>
      {!data.items?.length && (
        <Text style={styles.none}>Отчётов, доступных вам, пока нет</Text>
      )}

      {(data.items || []).map((item) => {
        const summary = summaries[item.code];
        return (
          <View key={item.code} style={styles.card}>
            <View style={styles.head}>
              <View style={styles.headText}>
                <Text style={styles.title}>{item.label}</Text>
                <Text style={styles.schedule}>{item.schedule}</Text>
              </View>
              <Switch
                value={item.enabled}
                onValueChange={value => toggle(item.code, value)}
                trackColor={{true: c.primary}}
              />
            </View>

            {/* Что в отчёте прямо сейчас. Пусто — это не ошибка: у сроков
                годности «нечего сообщать» нормальное состояние. */}
            {!summary && <ActivityIndicator size="small" color={c.textTertiary} style={styles.wait} />}
            {summary?.failed && <Text style={styles.state}>Не удалось посчитать</Text>}
            {summary?.empty && <Text style={styles.state}>Сейчас сообщать нечего</Text>}

            {Boolean(summary && !summary.empty && !summary.failed) && (
              <>
                <View style={styles.alert}>
                  <Bell size={14} color={c.primary} />
                  <Text style={styles.alertText}>
                    {summary.alert?.text || summary.subject}
                  </Text>
                </View>

                {Boolean(summary.fileName) && (
                  <Pressable
                    style={styles.button}
                    disabled={busy === item.code}
                    onPress={() => download(item.code, summary.fileName)}>
                    <FileDown size={16} color={c.primary} />
                    <Text style={styles.buttonText}>
                      {busy === item.code ? 'Скачиваю…' : 'Скачать файл'}
                    </Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        );
      })}

      {/* Адрес показываем, только если письма уходить не могут: остальным он
          ничего не сообщает, а тому, у кого его нет, объясняет, почему приходит
          только push. */}
      {!data.deliverable && (
        <Text style={styles.note}>
          Почта в профиле не заполнена — отчёты приходят только уведомлением на телефон.
        </Text>
      )}
    </ScrollView>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  card: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  head: {flexDirection: 'row', alignItems: 'center', gap: 12},
  headText: {flex: 1},
  title: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  schedule: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  wait: {alignSelf: 'flex-start'},
  state: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary},
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.primaryLight,
    borderRadius: radius.md,
    padding: 10,
  },
  alertText: {flex: 1, fontFamily: font.medium, fontSize: 12, color: c.textPrimary, lineHeight: 17},
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
  },
  buttonText: {fontFamily: font.semiBold, fontSize: 14, color: c.primary},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', marginTop: 40},
  note: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary, lineHeight: 18, marginTop: 4},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: c.bgSecondary},
  emptyText: {fontFamily: font.regular, fontSize: 14, color: c.textSecondary},
});
