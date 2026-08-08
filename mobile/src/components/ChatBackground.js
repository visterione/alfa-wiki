import React, {useMemo} from 'react';
import {View, StyleSheet} from 'react-native';
import Svg, {Defs, Pattern, Rect, Circle, Path, G} from 'react-native-svg';
import {useSettings} from '../store/settingsStore';

/**
 * Фон переписки.
 *
 * Узоры рисуются вектором, а не картинками: файл не нужно хранить в двух
 * плотностях, он ничего не весит и перекрашивается под тему одной переменной.
 *
 * Все узоры намеренно малоконтрастные — они лежат под текстом, и любая
 * пестрота бьёт по читаемости. Насыщенность задаётся одним значением
 * непрозрачности, так что «сделать бледнее» — это правка в одном месте.
 *
 * Часть узоров — про медицину: это фон рабочего мессенджера клиники, и профиль
 * организации в оформлении уместнее абстрактных ромбов.
 */

// Непрозрачность узора. Разная для тем: на тёмном фоне тот же контраст
// выглядит заметно грубее, чем на светлом.
const PATTERN_OPACITY = {light: 0.055, dark: 0.075};

/**
 * Узоры.
 *
 * tile — размер повторяющейся плитки. У каждого узора свой: точкам хватает
 * 20 пунктов, а кардиограмме нужно 60, иначе вместо линии выйдет частокол.
 *
 * weight — поправка к непрозрачности. Залитые фигуры при одинаковом значении
 * выглядят плотнее контурных, и без поправки одни узоры лезли бы в глаза,
 * а другие терялись.
 */
export const CHAT_BACKGROUNDS = [
  {key: 'plain', label: 'Без узора'},
  {key: 'dots', label: 'Точки', tile: [20, 20]},
  {key: 'hex', label: 'Соты', tile: [30, 17.32]},
  {key: 'waves', label: 'Волны', tile: [20, 20]},
  {key: 'confetti', label: 'Конфетти', tile: [48, 48]},
  {key: 'pulse', label: 'Кардиограмма', tile: [60, 28]},
  {key: 'care', label: 'Забота', tile: [44, 44]},
  {key: 'crosses', label: 'Медкресты', tile: [40, 40], weight: 0.85},
  {key: 'pills', label: 'Таблетки', tile: [56, 56]},
];

function background(key) {
  return CHAT_BACKGROUNDS.find(b => b.key === key);
}

// Шестиугольник с плоским верхом и стороной s, вписанный центром в (cx, cy)
function hexagon(cx, cy, s) {
  const h = s * 0.866; // s·√3/2 — половина высоты
  return `M${cx - s} ${cy} L${cx - s / 2} ${cy - h} L${cx + s / 2} ${cy - h} ` +
    `L${cx + s} ${cy} L${cx + s / 2} ${cy + h} L${cx - s / 2} ${cy + h} Z`;
}

/**
 * Содержимое одной плитки узора.
 *
 * Фигуры либо целиком помещаются внутрь плитки, либо доходят до её края ровно
 * там же, где начинаются с противоположной стороны, — иначе на стыках плиток
 * появятся обрывы.
 */
function PatternTile({name, color}) {
  switch (name) {
    case 'dots':
      return <Circle cx={10} cy={10} r={1.6} fill={color} />;

    case 'hex':
      // Соты складываются из двух рядов со сдвигом на полшага. Шестиугольники
      // по углам плитки дорисовываются соседними плитками
      return (
        <G stroke={color} strokeWidth={1} fill="none">
          <Path d={hexagon(0, 0, 10)} />
          <Path d={hexagon(30, 0, 10)} />
          <Path d={hexagon(0, 17.32, 10)} />
          <Path d={hexagon(30, 17.32, 10)} />
          <Path d={hexagon(15, 8.66, 10)} />
        </G>
      );

    case 'waves':
      return (
        <Path
          d="M0 14 Q5 8 10 14 T20 14"
          stroke={color}
          strokeWidth={1.2}
          fill="none"
          strokeLinecap="round"
        />
      );

    case 'confetti':
      return (
        <G stroke={color} strokeWidth={1.6} strokeLinecap="round" fill="none">
          <Path d="M6 8 L12 4" />
          <Path d="M20 6 L24 12" />
          <Path d="M36 4 L40 10" />
          <Path d="M4 22 L8 28" />
          <Path d="M18 24 L24 22" />
          <Path d="M32 26 L36 20" />
          <Path d="M8 38 L14 42" />
          <Path d="M24 40 L28 34" />
          <Path d="M38 36 L42 42" />
          <Circle cx={30} cy={14} r={1.4} fill={color} stroke="none" />
          <Circle cx={14} cy={18} r={1.2} fill={color} stroke="none" />
          <Circle cx={44} cy={26} r={1.2} fill={color} stroke="none" />
          <Circle cx={20} cy={34} r={1.4} fill={color} stroke="none" />
        </G>
      );

    case 'pulse':
      // Линия входит и выходит на одной высоте — иначе на стыке плиток
      // получилась бы ступенька
      return (
        <Path
          d="M0 20 H14 L17 19 L20 8 L23 26 L26 16 L29 20 H42 L45 15 L47 20 H60"
          stroke={color}
          strokeWidth={1.4}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );

    case 'care':
      return (
        <G stroke={color} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <Path
            d="M22 34 C22 34 8 25.5 8 16 C8 11.6 11.4 8 15.6 8 C18.2 8 20.7 9.4 22 11.6 C23.3 9.4 25.8 8 28.4 8 C32.6 8 36 11.6 36 16 C36 25.5 22 34 22 34 Z"
            strokeWidth={1.3}
          />
          <Path d="M12 19 H17 L19.5 14 L22.5 24 L25 19 H32" strokeWidth={1.2} />
        </G>
      );

    case 'crosses':
      return (
        <G fill={color}>
          <Rect x={8.2} y={5} width={3.6} height={10} rx={1.3} />
          <Rect x={5} y={8.2} width={10} height={3.6} rx={1.3} />
          <Rect x={28.2} y={25} width={3.6} height={10} rx={1.3} />
          <Rect x={25} y={28.2} width={10} height={3.6} rx={1.3} />
        </G>
      );

    case 'pills':
      return (
        <G stroke={color} strokeWidth={1.3} fill="none">
          <G transform="rotate(-35 15 15)">
            <Rect x={4} y={10} width={22} height={10} rx={5} />
            <Path d="M15 10 V20" />
          </G>
          <G transform="rotate(30 44 10)">
            <Rect x={36} y={6} width={16} height={8} rx={4} />
            <Path d="M44 6 V14" />
          </G>
          <Circle cx={40} cy={38} r={8.5} />
          <Path d="M31.5 38 H48.5" />
          <Circle cx={12} cy={44} r={6} />
          <Path d="M6 44 H18" />
        </G>
      );

    default:
      return null;
  }
}

/**
 * Образец узора для экрана настроек.
 *
 * Выбирать фон вслепую по названию неудобно: как «Соты» лягут под текст, по
 * слову не поймёшь. Плитки у узоров разного размера, поэтому образец не
 * подгоняется под пиксели, а показывает примерно два повтора любого из них —
 * иначе крупные узоры не влезали бы, а мелкие превращались в шум.
 */
export function PatternPreview({name, width = 44, height = 44}) {
  const {scheme, colors} = useSettings();
  const opacity = PATTERN_OPACITY[scheme] ?? PATTERN_OPACITY.light;
  const bg = background(name);

  if (!bg?.tile) {
    return null;
  }

  const [tw, th] = bg.tile;
  const viewWidth = tw * 2;
  const viewHeight = viewWidth * (height / width);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${viewWidth} ${viewHeight}`}>
      <Defs>
        <Pattern id={`prev-${name}`} patternUnits="userSpaceOnUse" width={tw} height={th}>
          <PatternTile name={name} color={colors.textPrimary} />
        </Pattern>
      </Defs>
      {/* В образце узор заметно контрастнее, чем в чате: в настоящей бледности
          на маленьком квадрате все варианты выглядели бы одинаково пустыми */}
      <Rect
        x={0}
        y={0}
        width={viewWidth}
        height={viewHeight}
        fill={`url(#prev-${name})`}
        opacity={Math.min(1, opacity * 6 * (bg.weight ?? 1))}
      />
    </Svg>
  );
}

export default function ChatBackground() {
  const {chatBackground, scheme, colors} = useSettings();

  const bg = background(chatBackground);
  const opacity = (PATTERN_OPACITY[scheme] ?? PATTERN_OPACITY.light) * (bg?.weight ?? 1);
  const patternColor = colors.textPrimary;

  const svg = useMemo(() => {
    if (!bg?.tile) return null;
    const [tw, th] = bg.tile;
    return (
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern id="bg" patternUnits="userSpaceOnUse" width={tw} height={th}>
            <PatternTile name={bg.key} color={patternColor} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#bg)" opacity={opacity} />
      </Svg>
    );
  }, [bg, patternColor, opacity]);

  return (
    <View style={[StyleSheet.absoluteFill, {backgroundColor: colors.bgSecondary}]} pointerEvents="none">
      {svg}
    </View>
  );
}
