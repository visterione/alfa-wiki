import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  Linking,
  StyleSheet,
  Platform,
  TouchableOpacity,
} from 'react-native';
import Video from 'react-native-video';
import {Play} from 'lucide-react-native';

import {parseHtml} from '../utils/html';
import CONFIG from '../config';
import MediaViewer from './MediaViewer';
import {font, radius} from '../theme';
import {useSettings, useTheme, useThemedStyles} from '../store/settingsStore';

/**
 * Материал урока: HTML из редактора, показанный обычными компонентами.
 *
 * Разбор живёт в utils/html — здесь только рисование. Ширина колонки приходит
 * снаружи, потому что от неё считаются картинки и таблицы, а сам компонент
 * лежит внутри чужой прокрутки и своей ширины не знает.
 *
 * Цвета текста из редактора применяются не всегда: в вебе их подбирали на белом
 * фоне, и чёрная строка на тёмной теме исчезла бы. Слишком тёмные в тёмной теме
 * и слишком светлые в светлой заменяются на обычный цвет текста — потеря
 * оттенка лучше, чем нечитаемая строка.
 */
export default function HtmlContent({html, width}) {
  const styles = useThemedStyles(makeStyles);
  const [viewed, setViewed] = useState(null);

  const blocks = React.useMemo(() => parseHtml(html), [html]);

  if (!blocks.length) {
    return <Text style={styles.empty}>Урок пока не содержит материалов</Text>;
  }

  return (
    <View>
      {blocks.map((block, i) => (
        <Block
          key={i}
          block={block}
          width={width}
          prev={blocks[i - 1]}
          onOpenImage={setViewed}
        />
      ))}

      <MediaViewer visible={!!viewed} item={viewed} onClose={() => setViewed(null)} />
    </View>
  );
}

function Block({block, width, prev, onOpenImage}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const {scale} = useSettings();

  switch (block.type) {
    case 'heading': {
      const size = [26, 22, 19, 17, 16, 16][block.level - 1] * scale;
      return (
        <Text
          style={[
            styles.heading,
            {fontSize: size, lineHeight: size * 1.3, textAlign: block.align || 'left'},
            // Заголовок сразу после заголовка не нуждается в двойном разрыве
            prev?.type === 'heading' && styles.tightTop,
          ]}>
          <Runs runs={block.runs} styles={styles} c={c} />
        </Text>
      );
    }

    case 'list-item':
      return (
        <View style={[styles.listRow, {marginLeft: block.depth * 18}]}>
          <Text style={[styles.bullet, {fontSize: 16 * scale}]}>
            {block.ordered ? `${block.index}.` : '•'}
          </Text>
          <Text style={[styles.text, {fontSize: 16 * scale, lineHeight: 24 * scale, flex: 1}]}>
            <Runs runs={block.runs} styles={styles} c={c} />
          </Text>
        </View>
      );

    case 'quote':
      return (
        <View style={styles.quote}>
          <Text style={[styles.text, {fontSize: 16 * scale, lineHeight: 24 * scale}]}>
            <Runs runs={block.runs} styles={styles} c={c} />
          </Text>
        </View>
      );

    case 'code':
      // Код не переносится: перенос ломает выравнивание, поэтому длинные
      // строки уезжают вбок собственной прокруткой
      return (
        <View style={styles.codeBlock}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={styles.codeText}>{block.text}</Text>
          </ScrollView>
        </View>
      );

    case 'divider':
      return <View style={styles.divider} />;

    case 'image':
      return <LessonImage block={block} width={width} onOpen={onOpenImage} />;

    case 'video':
      return <LessonVideo block={block} width={width} />;

    case 'embed':
      return <Embed src={block.src} width={width} />;

    case 'table':
      return <Table rows={block.rows} width={width} />;

    default:
      return (
        <Text
          style={[
            styles.text,
            styles.paragraph,
            {fontSize: 16 * scale, lineHeight: 24 * scale, textAlign: block.align || 'left'},
          ]}>
          <Runs runs={block.runs} styles={styles} c={c} />
        </Text>
      );
  }
}

/**
 * Куски строки с оформлением.
 *
 * Возвращает набор <Text>, поэтому вставляется внутрь готового <Text> и
 * наследует его размер — иначе размер шрифта пришлось бы дублировать на каждом
 * куске. Внутренние ссылки (начинаются с «/») ведут в разделы веб-версии,
 * которых на телефоне нет: их подсвечиваем, но не открываем.
 */
function Runs({runs, styles, c}) {
  return (
    <>
      {runs.map((run, i) => {
        const openable = run.link && /^https?:/i.test(run.link);
        const style = [
          run.bold && styles.bold,
          run.italic && styles.italic,
          run.underline && !run.strike && styles.underline,
          run.strike && !run.underline && styles.strike,
          run.underline && run.strike && styles.underlineStrike,
          run.code && styles.inlineCode,
          (run.sup || run.sub) && styles.smallScript,
          run.link && styles.link,
          run.color && !run.link && colorStyle(run.color, c),
          run.highlight && highlightStyle(run.highlight),
        ].filter(Boolean);

        return (
          <Text
            key={i}
            style={style.length ? style : undefined}
            onPress={openable ? () => Linking.openURL(run.link).catch(() => {}) : undefined}>
            {run.text}
          </Text>
        );
      })}
    </>
  );
}

/**
 * Картинка урока.
 *
 * Пропорции берутся из атрибутов, если редактор их проставил, иначе
 * запрашиваются у самой картинки. Пока размер неизвестен, место держится по
 * соотношению 3:2 — так текст под картинкой не прыгает, когда та догрузится.
 */
function LessonImage({block, width, onOpen}) {
  const styles = useThemedStyles(makeStyles);
  const uri = CONFIG.fileUrl(block.src);
  const known = block.width && block.height ? block.height / block.width : null;
  const [ratio, setRatio] = useState(known);

  useEffect(() => {
    if (known || !uri) return undefined;
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => {
        if (alive && w > 0) setRatio(h / w);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [uri, known]);

  if (!uri) return null;

  // Мелкую картинку не растягиваем на всю колонку: у схем и подписей от этого
  // размывается текст
  const shown = block.width ? Math.min(block.width, width) : width;
  const height = shown * (ratio || 0.66);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onOpen({url: uri, name: block.alt || 'Изображение', mimeType: 'image/*'})}>
      <Image
        source={{uri}}
        style={[styles.image, {width: shown, height}]}
        resizeMode="contain"
      />
      {!!block.alt && <Text style={styles.caption}>{block.alt}</Text>}
    </TouchableOpacity>
  );
}

/**
 * Видео из урока.
 *
 * До первого нажатия ролик стоит и показывает обложку: в уроке их может быть
 * несколько, и одновременный автозапуск превратил бы страницу в шум. Плеерные
 * кнопки появляются вместе с воспроизведением — иначе они закрывают обложку
 * ещё до того, как человек решил смотреть.
 */
function LessonVideo({block, width}) {
  const styles = useThemedStyles(makeStyles);
  const [started, setStarted] = useState(false);
  const uri = CONFIG.fileUrl(block.src);

  if (!uri) return null;

  return (
    <View style={[styles.video, {width, height: width * 0.5625}]}>
      <Video
        source={{uri}}
        poster={CONFIG.fileUrl(block.poster) || undefined}
        style={StyleSheet.absoluteFill}
        controls={started}
        paused={!started}
        resizeMode="contain"
        onError={() => {}}
      />
      {!started && (
        <TouchableOpacity
          style={[StyleSheet.absoluteFill, styles.videoCover]}
          activeOpacity={0.85}
          onPress={() => setStarted(true)}>
          <View style={styles.embedPlay}>
            <Play size={26} color="#FFFFFF" fill="#FFFFFF" />
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * Ролик со стороннего сайта.
 *
 * Встроить его нечем — WebView в приложении нет, — поэтому показываем обложку
 * с кнопкой и открываем в YouTube: там ролик и так проиграется удобнее, с
 * полноэкранным режимом и качеством.
 */
function Embed({src, width}) {
  const styles = useThemedStyles(makeStyles);
  const id = youtubeId(src);

  const open = () => {
    const url = id ? `https://www.youtube.com/watch?v=${id}` : src;
    if (url) Linking.openURL(url).catch(() => {});
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={open}
      style={[styles.embed, {width, height: width * 0.5625}]}>
      {!!id && (
        <Image
          source={{uri: `https://img.youtube.com/vi/${id}/hqdefault.jpg`}}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      )}
      <View style={styles.embedPlay}>
        <Play size={26} color="#FFFFFF" fill="#FFFFFF" />
      </View>
      <Text style={styles.embedHint}>Открыть видео</Text>
    </TouchableOpacity>
  );
}

function youtubeId(src) {
  const m = String(src || '').match(/(?:embed\/|v=|youtu\.be\/)([\w-]{6,})/);
  return m ? m[1] : null;
}

/**
 * Таблица. Колонки фиксированной ширины, вся таблица едет вбок: ужимать её
 * под ширину экрана бессмысленно — в ячейках оказываются цифры по букве в
 * строку.
 */
function Table({rows, width}) {
  const styles = useThemedStyles(makeStyles);
  const columns = Math.max(...rows.map(r => r.length));
  const cellWidth = Math.max(110, Math.min(180, width / Math.min(columns, 3)));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tableScroll}
      contentContainerStyle={styles.table}>
      <View>
        {rows.map((row, i) => (
          <View key={i} style={styles.tableRow}>
            {row.map((cell, j) => (
              <View
                key={j}
                style={[styles.tableCell, {width: cellWidth}, cell.header && styles.tableHeadCell]}>
                <Text style={[styles.tableText, cell.header && styles.tableHeadText]}>
                  {cell.runs.map(r => r.text).join('')}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// Яркость цвета по восприятию (коэффициенты sRGB). Нужна, чтобы понять,
// переживёт ли цвет из веба текущую тему.
function luminance(color) {
  const hex = String(color).trim().replace('#', '');
  const full = hex.length === 3 ? hex.split('').map(x => x + x).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  return (
    (0.299 * ((n >> 16) & 0xff) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff)) / 255
  );
}

function colorStyle(color, c) {
  const l = luminance(color);
  if (l === null) return null;
  const dark = luminance(c.bgPrimary) < 0.5;
  // На тёмном фоне тёмный текст не виден, на светлом — светлый
  if (dark ? l < 0.4 : l > 0.7) return null;
  return {color};
}

// Выделитель всегда светлый — его подбирали на белом фоне. Значит и буквы на
// нём обязаны быть тёмными, независимо от темы приложения.
function highlightStyle(value) {
  const color = typeof value === 'string' && luminance(value) !== null ? value : '#FFF3A3';
  return {backgroundColor: color, color: '#1D1D1F'};
}

const makeStyles = c => StyleSheet.create({
  empty: {fontFamily: font.regular, fontSize: 15, color: c.textSecondary},
  text: {fontFamily: font.regular, color: c.textPrimary},
  paragraph: {marginBottom: 14},
  heading: {
    fontFamily: font.semiBold,
    color: c.textPrimary,
    marginTop: 18,
    marginBottom: 10,
  },
  tightTop: {marginTop: 4},

  listRow: {flexDirection: 'row', marginBottom: 8, paddingRight: 4},
  bullet: {
    fontFamily: font.medium,
    color: c.primary,
    width: 24,
    lineHeight: 24,
  },

  quote: {
    borderLeftWidth: 3,
    borderLeftColor: c.primary,
    backgroundColor: c.primaryLight,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
  },

  codeBlock: {
    backgroundColor: c.bgTertiary,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 14,
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: c.textPrimary,
  },

  divider: {height: 1, backgroundColor: c.borderLight, marginVertical: 18},

  image: {borderRadius: radius.md, marginBottom: 6, backgroundColor: c.bgTertiary},
  caption: {
    fontFamily: font.regular,
    fontSize: 13,
    color: c.textSecondary,
    marginBottom: 14,
  },
  video: {
    borderRadius: radius.md,
    marginBottom: 14,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  videoCover: {alignItems: 'center', justifyContent: 'center'},

  embed: {
    borderRadius: radius.md,
    marginBottom: 14,
    backgroundColor: c.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  embedPlay: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  embedHint: {
    fontFamily: font.medium,
    fontSize: 13,
    color: '#FFFFFF',
    marginTop: 8,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },

  tableScroll: {marginBottom: 14},
  table: {paddingRight: 4},
  tableRow: {flexDirection: 'row'},
  tableCell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  tableHeadCell: {backgroundColor: c.bgTertiary},
  tableText: {fontFamily: font.regular, fontSize: 14, color: c.textPrimary},
  tableHeadText: {fontFamily: font.semiBold},

  bold: {fontFamily: font.semiBold},
  italic: {fontStyle: 'italic'},
  underline: {textDecorationLine: 'underline'},
  strike: {textDecorationLine: 'line-through'},
  underlineStrike: {textDecorationLine: 'underline line-through'},
  inlineCode: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 14,
    backgroundColor: c.bgTertiary,
  },
  // Верхний и нижний индексы: сдвинуть строку по базовой линии в RN нечем,
  // поэтому отличаем только размером
  smallScript: {fontSize: 11},
  link: {color: c.primary, textDecorationLine: 'underline'},
});
