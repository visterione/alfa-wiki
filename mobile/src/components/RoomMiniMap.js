/**
 * Схема этажа с подсвеченным кабинетом — только чтение.
 *
 * Отвечает на вопрос, которого не было ни в одном списке: «а это вообще где?».
 * Номер кабинета говорит о месте меньше, чем кажется: 305 есть в каждом здании
 * сети, а человек с телефоном чаще ищет дорогу, чем карточку.
 *
 * Метрики соседних кабинетов здесь не показываются намеренно — ни загрузки, ни
 * заполненности, ни цветовых зон. Это схема одного кабинета, а не отчёт по
 * этажу: раскрась соседей, и взгляд уйдёт сравнивать их между собой вместо
 * того, чтобы найти нужную дверь. Отчёты по этажу остались в вебе.
 *
 * Геометрия — та же, что у планов в вебе: точки в метрах, `{points, holes}`,
 * вырезы рисуются правилом evenodd (см. frontend FloorPlanSvg.js).
 */
import React, {useMemo} from 'react';
import {View, Text, StyleSheet} from 'react-native';
import Svg, {Path, Text as SvgText} from 'react-native-svg';

import {radius, font} from '../theme';
import {useThemedStyles, useTheme} from '../store/settingsStore';

const MAP_HEIGHT = 168;
// Поле вокруг контура, в метрах: без него стены упираются в край картинки
const PAD_M = 0.6;

const ringsOf = (geometry) => {
  const points = Array.isArray(geometry?.points) ? geometry.points : [];
  const holes = Array.isArray(geometry?.holes)
    ? geometry.holes.filter(h => Array.isArray(h) && h.length >= 3)
    : [];
  return {points, holes};
};

const ringPath = ring => `${ring.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ')} Z`;

const shapePath = ({points, holes}) => (points.length < 3
  ? null
  : [points, ...holes].map(ringPath).join(' '));

const boundsOf = (points) => {
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
};

/** Центр подписи: сохранённый в плане, иначе середина габарита. */
const labelPoint = (plan, points) => {
  if (Number.isFinite(plan?.label?.x) && Number.isFinite(plan?.label?.y)) return plan.label;
  const b = boundsOf(points);
  return {x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2};
};

export default function RoomMiniMap({plan, roomId}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();

  const view = useMemo(() => {
    if (!plan) return null;
    const outline = ringsOf(plan.floor?.outline);
    const rooms = (plan.rooms || []).map(room => ({room, rings: ringsOf(room.plan)}));

    // Габарит собирается по тому, что реально нарисовано. Опираться только на
    // planWidthM/planHeightM нельзя: у этажей с контуром произвольной формы
    // объявленный прямоугольник заметно больше самого этажа, и схема съезжала
    // бы в угол картинки.
    const all = [...outline.points, ...rooms.flatMap(r => r.rings.points)];
    if (all.length < 3) return null;

    const b = boundsOf(all);
    const width = b.maxX - b.minX + PAD_M * 2;
    const height = b.maxY - b.minY + PAD_M * 2;
    if (!(width > 0 && height > 0)) return null;

    return {
      viewBox: `${b.minX - PAD_M} ${b.minY - PAD_M} ${width} ${height}`,
      outline: shapePath(outline),
      // Кегль подписи задан в метрах плана: SVG масштабируется целиком, и
      // пиксельный размер здесь означал бы разный кегль на разных этажах.
      unit: Math.max(width, height) / 42,
      rooms,
    };
  }, [plan]);

  // Пока схема не пришла — просто пустое место в цвет карточки. Надпись здесь
  // мигала бы «схемы нет» на каждом открытии кабинета, а через полсекунды
  // сменялась планом.
  if (!plan) return <View style={styles.skeleton} />;

  if (!view) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Схема этажа не готова</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Svg width="100%" height={MAP_HEIGHT} viewBox={view.viewBox} preserveAspectRatio="xMidYMid meet">
        {Boolean(view.outline) && (
          <Path
            d={view.outline}
            fillRule="evenodd"
            fill={c.bgSecondary}
            stroke={c.textTertiary}
            strokeWidth={view.unit * 0.12}
          />
        )}

        {view.rooms.map(({room, rings}) => {
          const d = shapePath(rings);
          if (!d) return null;
          const mine = room.id === roomId;
          return (
            <Path
              key={room.id}
              d={d}
              fillRule="evenodd"
              fill={mine ? c.primary : c.bgTertiary}
              stroke={mine ? c.primary : c.textTertiary}
              strokeWidth={view.unit * (mine ? 0.2 : 0.08)}
            />
          );
        })}

        {view.rooms.map(({room, rings}) => {
          if (rings.points.length < 3) return null;
          const mine = room.id === roomId;
          const b = boundsOf(rings.points);
          const size = view.unit * (mine ? 1.15 : 0.85);
          // Номер шире самого кабинета читается не подписью, а помаркой поверх
          // схемы. Соседей в таком случае оставляем без подписи — свой кабинет
          // подписан всегда, ради него схема и открыта.
          if (!mine && (b.maxX - b.minX) < size * String(room.number).length * 0.62) return null;
          const at = labelPoint(room.plan, rings.points);
          return (
            <SvgText
              key={`t-${room.id}`}
              x={at.x}
              y={at.y + size * 0.35}
              textAnchor="middle"
              fontSize={size}
              fontWeight={mine ? '700' : '400'}
              fill={mine ? '#FFFFFF' : c.textTertiary}>
              {room.number}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  wrap: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    paddingVertical: 8,
  },
  skeleton: {
    height: MAP_HEIGHT + 16,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
  },
  empty: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    padding: 18,
    alignItems: 'center',
  },
  emptyText: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary, textAlign: 'center'},
});
