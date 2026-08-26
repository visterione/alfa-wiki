/**
 * Переключатель этажей — панель с номерами над списком кабинетов.
 *
 * ── Почему именно так ────────────────────────────────────────────────────────
 *
 * Тот же элемент, что и на карте склада в вебе: там он вертикальной колонкой
 * сбоку от плана, здесь — горизонтальной панелью над списком. Человек читает
 * его как кнопки лифта, и это ровно тот образ, который нужен: этаж — не
 * категория с названием, а число.
 *
 * Поэтому в клетке стоит только номер. Ни слова «этаж» (оно одинаковое во всех
 * клетках и потому не различает ничего), ни числа кабинетов (это ответ на
 * другой вопрос, а в клетке ростом в сорок пунктов он ломает вёрстку).
 * Названия этажей — «Административный», «Главный» — остаются заголовками групп
 * в самом списке, где на них есть ширина.
 *
 * Кнопки «Все» здесь нет намеренно: этаж выбран всегда, и список показывает
 * ровно один. Поиск при этом идёт по всему медцентру — искать по этажу, когда
 * человек уже набирает номер кабинета, значило бы прятать от него ответ.
 *
 * Складам и кабинетам без этажа номера не положено: у первых стоит значок, у
 * вторых прочерк. Выкидывать их из панели нельзя — это такие же места, и
 * попасть в них надо тем же движением.
 *
 * ── Почему обычный ряд, а не горизонтальная прокрутка ────────────────────────
 *
 * Первая версия была прокручиваемой, и это оказалось неверно втройне. Панель
 * обнимала содержимое, оставляя половину экрана пустой. ScrollView в колоночной
 * раскладке тянется на всю оставшуюся высоту — из-за этого панель занимала
 * пол-экрана, а её кнопки обрезались снизу. И главное: прокрутка прячет часть
 * этажей, а их у медцентра пять-шесть, и все должны быть видны сразу — иначе
 * переключатель перестаёт отвечать на вопрос «а какие этажи вообще есть».
 *
 * Поэтому ряд обычный, во всю ширину: клетки делят её поровну (flexGrow), но не
 * уже сорока четырёх пунктов — ниже этого в них не попасть пальцем. Если этажей
 * столько, что в строку они не помещаются, ряд переносится на вторую строку, а
 * не уезжает за край.
 */

import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {Boxes} from 'lucide-react-native';

import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';

/**
 * @param {number} inset поля по бокам. Экраны склада живут на разных отступах —
 *   «Кабинеты» на шестнадцати, «Размещение» на двенадцати, — и панель обязана
 *   вставать по одной линии с поиском и списком того экрана, где стоит.
 * @param {number} spacing отступ снизу. Сверху своего отступа у панели нет
 *   намеренно: в обоих экранах интервалы идут сверху вниз — каждый элемент
 *   отодвигает следующий, — и второй отступ здесь складывался бы с чужим.
 *   Именно от этого панель прижималась к шапке, а от поиска отходила вдвое.
 */
export default function FloorSwitch({floors, value, onChange, inset = 16, spacing = 12}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();

  // Один этаж — не выбор: панель из единственной кнопки только отнимает высоту
  // у списка, ради которого экран и открыт.
  if (!floors || floors.length < 2) return null;

  return (
    <View style={[styles.panel, {marginHorizontal: inset, marginBottom: spacing}]}>
      {floors.map((floor) => {
        const on = floor.key === value;
        return (
          <Pressable
            key={floor.key}
            style={[styles.cell, on && styles.cellOn]}
            onPress={() => onChange(floor.key)}
            accessibilityRole="button"
            accessibilityState={{selected: on}}
            accessibilityLabel={floor.title}>
            {floor.service
              ? <Boxes size={17} color={on ? '#FFFFFF' : c.textSecondary} />
              : (
                <Text style={[styles.number, on && styles.numberOn]} numberOfLines={1}>
                  {floor.short || floor.title}
                </Text>
              )}
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  panel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    padding: 5,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
  },
  cell: {
    // Делят ширину поровну, но не уже 44 пунктов: это минимум, в который
    // попадают пальцем. Когда клеток слишком много, ряд переносится.
    flexGrow: 1,
    flexBasis: 44,
    minWidth: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: c.bgSecondary,
  },
  cellOn: {backgroundColor: c.primary},
  number: {fontFamily: font.semiBold, fontSize: 15, color: c.textSecondary},
  numberOn: {color: '#FFFFFF'},
});
