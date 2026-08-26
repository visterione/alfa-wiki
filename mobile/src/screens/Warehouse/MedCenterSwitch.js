/**
 * Переключатель медцентров — один на весь складской раздел.
 *
 * ── Зачем ────────────────────────────────────────────────────────────────────
 *
 * Медцентр за смену не меняется: человек приходит в своё здание и работает в
 * нём. При этом раньше его спрашивали трижды и по-разному — шагом спуска в
 * кабинетах, строкой в листе отбора оборудования, никак в материалах. Здесь
 * ответ даётся один раз и держится до следующего раза, включая перезапуск
 * приложения (см. warehouseStore).
 *
 * ── Почему в шапке, а не полосой над списком ─────────────────────────────────
 *
 * Выбор действует на весь раздел, а не на конкретный список, и полоса над
 * списком читалась бы как отбор этого списка. Шапка — то место, где обычно
 * стоит указание «где я нахожусь», и логотип медцентра отвечает на это одним
 * взглядом, не отнимая у списка ни строки.
 *
 * ── Почему логотип, а не название ────────────────────────────────────────────
 *
 * Названия сети похожи между собой — «МЦ Альфа», «МЦ Линия», «МЦ Смайл», — и
 * различать их в шапке по первому слову нельзя, а на второе там нет ширины.
 * Знак различается сразу. Там, где логотипа нет, остаётся название: это хуже,
 * но честнее пустого места.
 *
 * ── Когда переключателя нет ──────────────────────────────────────────────────
 *
 * Если складом занят один медцентр, выбирать не из чего, и кнопка не рисуется
 * вовсе — по тому же правилу, по которому FloorSwitch прячется при одном этаже,
 * а спуск по локациям пропускает уровень с единственным потомком. Кнопка,
 * открывающая список из одной строки, — это обещание выбора, которого нет.
 */

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {View, Text, Image, Pressable, ScrollView, StyleSheet} from 'react-native';
import {Check, ChevronDown, Building2, Globe} from 'lucide-react-native';

import CONFIG from '../../config';
import BottomSheet from '../../components/BottomSheet';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {
  loadLocationTree, useWarehouseMedCenter, setWarehouseMedCenter,
  reconcileWarehouseMedCenter,
} from '../../store/warehouseStore';
import {medCentersOf} from './locationTree';

/** Знак медцентра или запасной значок, когда логотипа нет. */
function MedCenterMark({logoUrl, size, color}) {
  if (!logoUrl) return <Building2 size={size} color={color} />;
  return (
    <Image
      source={{uri: CONFIG.fileUrl(logoUrl)}}
      style={{width: size, height: size}}
      resizeMode="contain"
    />
  );
}

export default function MedCenterSwitch() {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const {medCenterId} = useWarehouseMedCenter();
  const [list, setList] = useState([]);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    loadLocationTree().then(tree => {
      const found = medCentersOf(tree);
      setList(found);
      // Медцентр могли закрыть, а права сузить: выбор, сделанный полгода назад,
      // иначе показывал бы пустые списки без объяснения.
      reconcileWarehouseMedCenter(found.map(mc => mc.id));
    });
  }, []);

  const current = useMemo(
    () => list.find(mc => mc.id === medCenterId) || null,
    [list, medCenterId],
  );

  const choose = useCallback((id) => {
    setWarehouseMedCenter(id);
    setSheet(false);
  }, []);

  if (list.length < 2) return null;

  return (
    <>
      <Pressable style={styles.button} onPress={() => setSheet(true)} hitSlop={8}>
        {current
          ? <MedCenterMark logoUrl={current.logoUrl} size={22} color={c.textSecondary} />
          : <><Building2 size={16} color={c.textSecondary} /><Text style={styles.all}>Все</Text></>}
        <ChevronDown size={14} color={c.textTertiary} />
      </Pressable>

      <BottomSheet visible={sheet} title="Медцентр" onClose={() => setSheet(false)}>
        <ScrollView>
          {/* Вся сеть — полноценный режим, а не «ничего не выбрано»: он нужен
              снабжению и тем, кто ведёт сеть целиком. Поэтому у него своя
              строка с названием, а не пустой пункт наверху списка. */}
          <Pressable style={styles.row} onPress={() => choose('')}>
            <View style={styles.rowMark}>
              <Building2 size={22} color={c.textSecondary} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Все медцентры</Text>
              <Text style={styles.rowSub}>Склад всей сети целиком</Text>
            </View>
            {!medCenterId && <Check size={18} color={c.primary} />}
          </Pressable>

          {list.map(mc => (
            <Pressable key={mc.id} style={styles.row} onPress={() => choose(mc.id)}>
              <View style={styles.rowMark}>
                <MedCenterMark logoUrl={mc.logoUrl} size={26} color={c.textSecondary} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{mc.title}</Text>
                {Boolean(mc.subtitle) && (
                  <Text style={styles.rowSub} numberOfLines={1}>{mc.subtitle}</Text>
                )}
              </View>
              {medCenterId === mc.id && <Check size={18} color={c.primary} />}
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>
    </>
  );
}

const makeStyles = c => StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: c.bgSecondary,
  },
  all: {fontFamily: font.medium, fontSize: 13, color: c.textSecondary},

  row: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12},
  // Знак стоит в клетке одной ширины: логотипы у сети разной формы, и без
  // клетки названия в списке разъезжались бы по левому краю.
  rowMark: {width: 34, alignItems: 'center'},
  rowText: {flex: 1, minWidth: 0},
  rowTitle: {fontFamily: font.medium, fontSize: 15, color: c.textPrimary},
  rowSub: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary, marginTop: 1},

  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
  },
  hintText: {flex: 1, fontFamily: font.regular, fontSize: 13, color: c.primary, lineHeight: 18},
});


/**
 * Спасение от молчаливого отбора.
 *
 * Выбор медцентра живёт неделями и не виден со списка, поэтому пустой список
 * читается как «этого нет в базе», а не как «этого нет здесь». Разница
 * принципиальная: в первом случае человек идёт заводить карточку заново.
 *
 * Поэтому на пустом списке экран сам пересчитывает то же самое по всей сети и,
 * если там что-то есть, говорит об этом и предлагает переключиться. Ровно то
 * же самое чинили в ver. 7.49 у поиска по остаткам: список, который врёт
 * молча, хуже списка, который признаётся.
 *
 * @param probe запрос без отбора по медцентру, возвращает число найденного
 * @param enabled считать только тогда, когда список и правда пуст
 */
export function useNetworkFallback(probe, {enabled}) {
  const [found, setFound] = useState(null);

  useEffect(() => {
    if (!enabled) { setFound(null); return undefined; }
    let alive = true;
    probe()
      .then(n => alive && setFound(Number(n) || 0))
      .catch(() => alive && setFound(null));
    return () => { alive = false; };
  }, [enabled, probe]);

  return found;
}

/** Подсказка под пустым списком. Ничего не нашлось и по сети — молчит. */
export function NetworkFallbackHint({found}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  if (!found) return null;

  return (
    <Pressable style={styles.hint} onPress={() => setWarehouseMedCenter('')}>
      <Globe size={18} color={c.primary} />
      <Text style={styles.hintText}>
        В выбранном медцентре пусто, а по всей сети найдено {found}. Показать всё
      </Text>
    </Pressable>
  );
}
