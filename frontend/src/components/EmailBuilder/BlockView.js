/**
 * Отрисовка блоков на холсте конструктора (ver. 8.43).
 *
 * Холст — НЕ рендерер письма, и это важно понимать, читая файл. Настоящее
 * письмо собирает backend/services/emailRenderer.js таблицами и инлайновыми
 * стилями; здесь то же самое нарисовано обычным CSS, потому что браузеру
 * таблицы ни к чему, а редактировать в них неудобно. Точный вид показывает
 * вкладка «Предпросмотр», которая зовёт рендерер на сервере.
 *
 * Отсюда правило: любое изменение вида блока делается в ДВУХ местах — здесь и в
 * рендерере. Разойдутся — человек увидит на холсте одно, а получатель другое.
 * Поэтому значения по умолчанию (отступы, ширина содержимого, цвета) заданы в
 * обоих файлах одинаково и вынесены в константы.
 */

import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Link as LinkIcon, Heading2, Heading3, Image as ImageIcon, Code2
} from 'lucide-react';
import { BASE_URL } from '../../services/api';
import { fontStack, ensureWebFont } from './fonts';

// Ширина содержимого письма: 600 минус боковые поля карточки. Тем же числом
// рендерер считает ширину картинок и колонок — см. ctx.contentWidth.
export const CONTENT_WIDTH = 552;

const pad = (block) => {
  const p = block?.padding || {};
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return `${n(p.top, 12)}px ${n(p.right, 24)}px ${n(p.bottom, 12)}px ${n(p.left, 24)}px`;
};

/** Относительный путь из документа → адрес, по которому картинку видно сейчас. */
/**
 * Градиенты: то же, что делает backend/services/emailRenderer.js.
 *
 * Два одинаковых куска логики в разных файлах — сознательный размен. Рендерер
 * живёт на сервере и в браузер не попадает, а холст обязан показывать ровно то,
 * что уедет получателю. Правило простое: правишь градиент здесь — правь и там,
 * иначе человек увидит на холсте не своё письмо.
 */

/**
 * Блоки, которые расходуют градиент на себя, а не на полосу под собой.
 * Повторяет OWNS_GRADIENT из рендерера — см. комментарий там.
 */
export const OWNS_GRADIENT = new Set(['button', 'hero', 'divider']);

const GRADIENT_POSITIONS = new Set([
  'center', 'top', 'bottom', 'left', 'right',
  'top left', 'top right', 'bottom left', 'bottom right',
]);

const withAlpha = (color, alpha) => {
  const value = String(color || '').trim();
  const a = Number(alpha);
  if (!Number.isFinite(a) || a >= 100 || a < 0) return value;
  const hex = value.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return value;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${(a / 100).toFixed(2)})`;
};

export const normalizeGradient = (g) => {
  if (!g || typeof g !== 'object') return null;
  let stops = Array.isArray(g.stops) ? g.stops.filter(st => st && st.color) : [];
  if (stops.length < 2 && g.from && g.to) stops = [{ color: g.from, at: 0 }, { color: g.to, at: 100 }];
  if (stops.length < 2) return null;

  const ordered = stops
    .map((st, i) => ({
      color: String(st.color),
      alpha: st.alpha,
      at: Number.isFinite(Number(st.at)) ? Math.min(100, Math.max(0, Number(st.at))) : Math.round((i / (stops.length - 1)) * 100),
    }))
    .sort((a, b) => a.at - b.at);

  return {
    type: ['linear', 'radial', 'conic'].includes(g.type) ? g.type : 'linear',
    angle: Number.isFinite(Number(g.angle)) ? Number(g.angle) : 135,
    shape: g.shape === 'circle' ? 'circle' : 'ellipse',
    position: GRADIENT_POSITIONS.has(g.position) ? g.position : 'center',
    stops: ordered,
  };
};

export const gradientCss = (g) => {
  const n = normalizeGradient(g);
  if (!n) return '';
  const list = n.stops.map(st => `${withAlpha(st.color, st.alpha)} ${st.at}%`).join(', ');
  if (n.type === 'radial') return `radial-gradient(${n.shape} at ${n.position}, ${list})`;
  if (n.type === 'conic') return `conic-gradient(from ${n.angle}deg at ${n.position}, ${list})`;
  return `linear-gradient(${n.angle}deg, ${list})`;
};

export const gradientHasAlpha = (g) => {
  const n = normalizeGradient(g);
  return Boolean(n && n.stops.some(st => Number.isFinite(Number(st.alpha)) && Number(st.alpha) < 100));
};

export const gradientFallback = (g) => {
  const n = normalizeGradient(g);
  if (!n) return '';
  const opaque = n.stops.find(st => !Number.isFinite(Number(st.alpha)) || Number(st.alpha) >= 100);
  return (opaque || n.stops[0]).color;
};

/**
 * Фон блока или карточки.
 *
 * Выведенный из градиента цвет не красится, если в градиенте есть
 * прозрачность: он лёг бы под ним и закрыл фон письма — см. тот же запрет в
 * рендерере.
 */
export const bgStyle = (source) => {
  if (!source) return {};
  const css = gradientCss(source.gradient);
  const derived = gradientHasAlpha(source.gradient) ? '' : gradientFallback(source.gradient);
  const solid = source.background || derived;
  if (!css) return solid ? { background: solid } : {};
  return { background: solid || undefined, backgroundImage: css };
};

/** Градиент буквами. Под ним всегда лежит настоящий цвет — его увидят те,
    до кого градиент не доехал. */
export const textGradientStyle = (gradient, fallbackColor) => {
  const css = gradientCss(gradient);
  const color = fallbackColor || gradientFallback(gradient);
  if (!css) return color ? { color } : {};
  return {
    color,
    backgroundImage: css,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  };
};

/** Оформление карточки вокруг содержимого блока. */
export const cardStyle = (card) => {
  if (!card) return null;
  return {
    ...bgStyle(card),
    borderRadius: `${Number(card.radius) || 0}px`,
    border: Number(card.borderWidth) ? `${card.borderWidth}px solid ${card.borderColor || '#E5E5EA'}` : undefined,
    boxShadow: card.shadow ? '0 6px 18px rgba(0,0,0,0.08)' : undefined,
    padding: `${Number(card.padding) ?? 20}px`,
  };
};

export const previewSrc = (src) => {
  const raw = String(src || '').trim();
  if (!raw) return '';
  if (/^(https?:|data:)/i.test(raw)) return raw;
  return `${BASE_URL}${raw.startsWith('/') ? '' : '/'}${raw}`;
};

/**
 * Текст правится прямо на холсте, а не в панели справа.
 *
 * Редактор поднимается только у выбранного блока: TipTap на каждый абзац письма
 * из двадцати блоков — это двадцать экземпляров ProseMirror в памяти, и набор
 * текста начинает подтормаживать. Невыбранные блоки показываются готовой
 * разметкой, и по клику на месте одного из них появляется настоящий редактор.
 */
function TextEditable({ block, settings, selected, onChange }) {
  /**
   * Обработчик правки держится в ref, а не передаётся в TipTap напрямую.
   *
   * useEditor создаёт редактор один раз на весь срок выделения блока и вместе с
   * ним замораживает onUpdate — со всеми замыканиями, которые в нём оказались.
   * Внешний onChange при каждой перерисовке новый и видит свежий документ, а
   * замороженный — тот, что был в момент создания редактора. Из-за этого правка,
   * сделанная в панели свойств при выделенном тексте (скажем, размер шрифта),
   * пропадала на следующем же нажатии клавиши: очередное onUpdate пересобирало
   * документ из устаревшего состояния.
   */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /**
   * Редактор создаётся ОДИН раз на блок и живёт, пока живёт блок.
   *
   * Раньше он пересоздавался при каждом выделении (deps: [selected]), и это
   * оказалось источником падения «The object can not be found here»: TipTap
   * сносит свой DOM сам, а React в тот же момент перестраивал поддерево после
   * вставки нового блока — и не находил узла, который собирался удалить.
   * Теперь вместо пересоздания переключается только режим правки.
   */
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Картинка, таблица и цитата в письме — отдельные блоки конструктора,
        // внутри абзаца им делать нечего.
        codeBlock: false,
        horizontalRule: false,
        blockquote: false,
      }),
      Underline,
      TextStyle,
      Color,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Текст письма…' }),
    ],
    content: block.html || '',
    editable: selected,
    onUpdate: ({ editor: ed }) => onChangeRef.current({ html: ed.getHTML() }),
  });

  useEffect(() => {
    if (editor && editor.isEditable !== selected) editor.setEditable(selected);
  }, [editor, selected]);

  // Содержимое могло измениться снаружи — например, применили шаблон или
  // откатили действие. Сравнение с текущим HTML обязательно: без него setContent
  // сбрасывает курсор в начало при каждом нажатии клавиши.
  useEffect(() => {
    if (editor && !editor.isFocused && block.html !== editor.getHTML()) {
      editor.commands.setContent(block.html || '', false);
    }
  }, [block.html, editor]);

  if (!editor) return null;

  const addLink = () => {
    const prev = editor.getAttributes('link').href || '';
    const url = window.prompt('Адрес ссылки', prev);
    if (url === null) return;
    if (!url.trim()) return editor.chain().focus().unsetLink().run();
    const href = /^(https?:|mailto:|tel:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    editor.chain().focus().setLink({ href }).run();
  };

  return (
    <>
      {/*
        Панель рендерится всегда, а не только у выделенного блока: её появление
        и исчезновение — это вставка и удаление DOM, и делать это одновременно
        с перестройкой списка блоков значит снова наступить на ту же ошибку.
        Показывать её или нет, решает shouldShow по состоянию редактора.
      */}
      <BubbleMenu
        editor={editor}
        tippyOptions={{ duration: 120 }}
        className="eb-bubble"
        shouldShow={({ editor: ed, from, to }) => ed.isEditable && from !== to}
      >
          <button type="button" className={editor.isActive('bold') ? 'active' : ''} onClick={() => editor.chain().focus().toggleBold().run()} title="Жирный"><Bold size={14} /></button>
          <button type="button" className={editor.isActive('italic') ? 'active' : ''} onClick={() => editor.chain().focus().toggleItalic().run()} title="Курсив"><Italic size={14} /></button>
          <button type="button" className={editor.isActive('underline') ? 'active' : ''} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Подчёркнутый"><UnderlineIcon size={14} /></button>
          <span className="eb-bubble-sep" />
          <button type="button" className={editor.isActive('heading', { level: 2 }) ? 'active' : ''} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Заголовок"><Heading2 size={14} /></button>
          <button type="button" className={editor.isActive('heading', { level: 3 }) ? 'active' : ''} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Подзаголовок"><Heading3 size={14} /></button>
          <span className="eb-bubble-sep" />
          <button type="button" className={editor.isActive('bulletList') ? 'active' : ''} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Список"><List size={14} /></button>
          <button type="button" className={editor.isActive('orderedList') ? 'active' : ''} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Нумерованный список"><ListOrdered size={14} /></button>
          <span className="eb-bubble-sep" />
          <button type="button" className={editor.isActive('link') ? 'active' : ''} onClick={addLink} title="Ссылка"><LinkIcon size={14} /></button>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </>
  );
}

export default function BlockView({ block, settings, selected, onChange, renderColumn, renderColumnFooter }) {
  // Шрифт блока перекрывает шрифт письма — ровно как в рендерере. Подгружаем
  // веб-шрифт сразу: иначе холст покажет Montserrat системным.
  const font = block.font || settings.font;
  if (font) ensureWebFont(font);
  const s = font ? { ...settings, fontFamily: fontStack(font) } : settings;

  switch (block.type) {
    case 'text': {
      const style = {
        fontFamily: s.fontFamily,
        fontSize: `${block.fontSize || s.fontSize}px`,
        lineHeight: block.lineHeight || s.lineHeight,
        textAlign: block.align || 'left',
        // Красная строка задаётся переменной, а её подхватывают абзацы внутри
        // ProseMirror — правилом в EmailBuilder.css. Поставить text-indent прямо
        // здесь нельзя: отступ получил бы только первый абзац блока, а нужен
        // каждый, ровно как в рендерере.
        '--eb-indent': `${Number(block.indent) || 0}px`,
        '--eb-link': s.linkColor,
        ...textGradientStyle(block.textGradient, block.color || s.textColor),
      };
      return (
        <div className="eb-text" style={style}>
          <TextEditable block={block} settings={s} selected={selected} onChange={onChange} />
        </div>
      );
    }

    case 'image': {
      const src = previewSrc(block.src);
      const width = Math.min(100, Math.max(5, Number(block.width) || 100));
      if (!src) {
        return (
          <div className="eb-image-empty" style={{ textAlign: block.align || 'center' }}>
            <ImageIcon size={22} />
          </div>
        );
      }
      return (
        <div style={{ textAlign: block.align || 'center' }}>
          <img
            src={src}
            alt={block.alt || ''}
            style={{
              display: 'inline-block',
              width: `${width}%`,
              maxWidth: '100%',
              borderRadius: block.shape === 'circle' ? '50%' : (block.radius ? `${block.radius}px` : 0),
              border: Number(block.borderWidth) ? `${block.borderWidth}px solid ${block.borderColor || '#FFFFFF'}` : undefined,
            }}
          />
        </div>
      );
    }

    case 'button': {
      const text = block.text || 'Кнопка';
      // Градиент кнопки виден и на холсте. Раньше здесь стоял только сплошной
      // цвет, и выбор градиента в панели свойств ничего не менял: письмо
      // уходило правильным, а человек этого не видел и считал, что не работает.
      const solid = block.bg || gradientFallback(block.gradient) || s.linkColor;
      return (
        <div style={{ textAlign: block.align || 'center' }}>
          <span
            className="eb-button"
            style={{
              background: solid,
              backgroundImage: gradientCss(block.gradient) || undefined,
              color: block.color || '#FFFFFF',
              borderRadius: `${block.radius ?? 10}px`,
              padding: `${block.paddingY ?? 14}px ${block.paddingX ?? 28}px`,
              fontSize: `${block.fontSize || 16}px`,
              fontFamily: s.fontFamily,
            }}
          >
            {text}
          </span>

        </div>
      );
    }

    case 'divider': {
      const width = Math.min(100, Math.max(10, Number(block.width) || 100));
      return (
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-block',
              width: `${width}%`,
              height: `${block.thickness || 1}px`,
              background: block.color || (gradientHasAlpha(block.gradient) ? undefined : gradientFallback(block.gradient)) || (gradientCss(block.gradient) ? undefined : '#E5E5EA'),
              backgroundImage: gradientCss(block.gradient) || undefined,
            }}
          />
        </div>
      );
    }

    case 'spacer':
      return (
        <div className="eb-spacer" style={{ height: `${Number(block.height) || 24}px` }}>
          <span>{Number(block.height) || 24}px</span>
        </div>
      );

    case 'header': {
      const src = previewSrc(block.src);
      const a = block.align || 'center';
      return (
        <div style={{ textAlign: a }}>
          {src
            ? <img src={src} alt={block.alt || ''} style={{ display: 'inline-block', width: `${Number(block.logoWidth) || 160}px`, maxWidth: '100%' }} />
            : <div className="eb-image-empty"><ImageIcon size={20} /><span>Логотип не загружен</span></div>}
          {block.tagline && (
            <div style={{ fontFamily: s.fontFamily, fontSize: 13, lineHeight: 1.5, color: block.mutedColor || block.color || s.mutedColor, paddingTop: 10 }}>
              {block.tagline}
            </div>
          )}
        </div>
      );
    }

    case 'promo': {
      const src = previewSrc(block.src);
      const radius = Number(block.radius) || 14;
      return (
        <div style={{ background: block.bg || '#F7F7FA', borderRadius: radius, overflow: 'hidden', fontFamily: s.fontFamily }}>
          {src
            ? <img src={src} alt={block.alt || ''} style={{ display: 'block', width: '100%' }} />
            : <div className="eb-image-empty" style={{ border: 0 }}><ImageIcon size={20} /><span>Картинка не выбрана</span></div>}
          <div style={{ padding: '18px 16px' }}>
            {block.badge && (
              <div style={{ paddingBottom: 10 }}>
                <span style={{ display: 'inline-block', borderRadius: 999, background: block.badgeBg || '#FF3B30', color: block.badgeColor || '#fff', padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>
                  {block.badge}
                </span>
              </div>
            )}
            {block.title && <div style={{ fontSize: 19, lineHeight: 1.3, fontWeight: 700, color: block.color || s.textColor }}>{block.title}</div>}
            {block.text && <div style={{ fontSize: 14, lineHeight: 1.5, color: block.color || s.textColor, paddingTop: 8 }}>{block.text}</div>}
            {(block.price || block.oldPrice) && (
              <div style={{ paddingTop: 14 }}>
                {block.oldPrice && <s style={{ fontSize: 15, color: block.mutedColor || s.mutedColor, marginRight: 10 }}>{block.oldPrice}</s>}
                {block.price && <b style={{ fontSize: 22, color: block.priceColor || block.color || s.textColor }}>{block.price}</b>}
              </div>
            )}
            {block.buttonText && (
              <div style={{ paddingTop: 16 }}>
                <span className="eb-button" style={{ background: block.buttonBg || s.linkColor, color: '#fff', borderRadius: 10, padding: '14px 28px', fontSize: 16 }}>
                  {block.buttonText}
                </span>

              </div>
            )}
          </div>
        </div>
      );
    }

    case 'services': {
      const items = Array.isArray(block.items) ? block.items : [];
      if (!items.length) return <div className="eb-empty-inline" />;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: s.fontFamily }}>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} style={{ borderBottom: i < items.length - 1 ? `1px solid ${block.lineColor || '#E5E5EA'}` : 'none' }}>
                <td style={{ padding: '10px 12px 10px 0', verticalAlign: 'top' }}>
                  <div style={{ fontSize: 15, lineHeight: 1.4, color: block.color || s.textColor }}>{item?.name}</div>
                  {item?.note && <div style={{ fontSize: 12, lineHeight: 1.4, color: block.mutedColor || s.mutedColor, paddingTop: 2 }}>{item.note}</div>}
                </td>
                <td style={{ padding: '10px 0', width: 110, textAlign: 'right', verticalAlign: 'top' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: block.color || s.textColor, whiteSpace: 'nowrap' }}>{item?.price}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    case 'social': {
      const colors = { vk: '#0077FF', telegram: '#26A5E4', whatsapp: '#25D366', site: s.linkColor, phone: '#5856D6' };
      const labels = { vk: 'ВКонтакте', telegram: 'Telegram', whatsapp: 'WhatsApp', site: 'Сайт', phone: 'Позвонить' };
      const items = (Array.isArray(block.items) ? block.items : []);
      const live = items.filter(i => i && i.href);
      return (
        <div style={{ textAlign: block.align || 'center' }}>
          {live.map((item, i) => (
            <span
              key={i}
              className="eb-button"
              style={{
                background: item.color || colors[item.network] || s.linkColor,
                color: '#fff', borderRadius: 8, padding: '9px 16px',
                fontSize: 13, marginRight: i < live.length - 1 ? 8 : 0,
                fontFamily: s.fontFamily,
              }}
            >
              {item.label || labels[item.network] || item.network}
            </span>
          ))}
          {!items.length && <div className="eb-empty-inline" />}
        </div>
      );
    }

    case 'contacts': {
      const lines = [block.address, block.hours, block.phone, block.site].filter(Boolean);
      if (!block.title && !lines.length) return <div className="eb-empty-inline" />;
      return (
        <div style={{ fontFamily: s.fontFamily, fontSize: 14, lineHeight: 1.5, color: block.color || s.textColor, textAlign: block.align || 'center' }}>
          {block.title && <div style={{ fontSize: 15, fontWeight: 700, paddingBottom: 8 }}>{block.title}</div>}
          {block.address && <div style={{ paddingBottom: 4 }}>{block.address}</div>}
          {block.hours && <div style={{ paddingBottom: 4 }}>{block.hours}</div>}
          {block.phone && <div style={{ paddingBottom: 4, color: block.linkColor || s.linkColor, fontWeight: 600 }}>{block.phone}</div>}
          {block.site && <div style={{ color: block.linkColor || s.linkColor, textDecoration: 'underline' }}>{block.site}</div>}
        </div>
      );
    }

    case 'hero': {
      const src = previewSrc(block.src);
      const height = Number(block.height) || 260;
      const overlay = (Math.min(100, Math.max(0, Number(block.overlay) ?? 35)) / 100).toFixed(2);
      // Затемнение — слой в самом фоне, как и в рендерере: отдельным блоком
      // внутри оно заняло бы высоту текста, и сверху осталась бы светлая полоса.
      const shade = Number(overlay) > 0
        ? ({
          bottom: `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,${overlay}) 100%)`,
          top: `linear-gradient(to bottom, rgba(0,0,0,${overlay}) 0%, rgba(0,0,0,0) 100%)`,
        }[block.overlayStyle] || `linear-gradient(rgba(0,0,0,${overlay}), rgba(0,0,0,${overlay}))`)
        : '';
      const layers = [shade, src ? `url(${src})` : ''].filter(Boolean).join(', ');
      return (
        <div
          style={{
            minHeight: height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: block.bg || '#1C1C1E',
            backgroundImage: layers || undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div style={{ width: '100%', padding: '28px 24px', textAlign: block.align || 'center' }}>
            {block.title && (
              <div style={{
                fontFamily: s.fontFamily,
                fontSize: Number(block.titleSize) || 28,
                lineHeight: 1.25,
                fontWeight: 700,
                ...textGradientStyle(block.textGradient, block.color || '#fff'),
              }}>
                {block.title}
              </div>
            )}
            {block.text && (
              <div style={{ fontFamily: s.fontFamily, fontSize: 15, lineHeight: 1.5, color: block.color || '#fff', paddingTop: 10 }}>
                {block.text}
              </div>
            )}
            {block.buttonText && (
              <div style={{ paddingTop: 18 }}>
                <span className="eb-button" style={{ background: block.buttonBg || s.linkColor, color: '#fff', borderRadius: 10, padding: '14px 28px', fontSize: 16 }}>
                  {block.buttonText}
                </span>
              </div>
            )}

          </div>
        </div>
      );
    }

    case 'textimage': {
      const src = previewSrc(block.src);
      const side = block.side === 'right' ? 'right' : 'left';
      const width = Number(block.imageWidth) || 200;
      const gap = Number(block.gap) ?? 16;
      const style = {
        fontFamily: s.fontFamily,
        fontSize: `${block.fontSize || s.fontSize}px`,
        lineHeight: block.lineHeight || s.lineHeight,
        color: block.color || s.textColor,
        textAlign: block.align || 'left',
        '--eb-indent': `${Number(block.indent) || 0}px`,
        '--eb-link': s.linkColor,
      };
      return (
        <div style={style}>
          {src ? (
            <img
              src={src}
              alt={block.alt || ''}
              style={{
                float: side,
                width,
                maxWidth: '45%',
                height: 'auto',
                borderRadius: block.radius ? `${block.radius}px` : 0,
                margin: side === 'left' ? `0 ${gap}px ${gap}px 0` : `0 0 ${gap}px ${gap}px`,
              }}
            />
          ) : (
            <div className="eb-image-empty" style={{ float: side, width, margin: side === 'left' ? `0 ${gap}px ${gap}px 0` : `0 0 ${gap}px ${gap}px` }}>
              <ImageIcon size={18} />
            </div>
          )}
          <TextEditable block={block} settings={s} selected={selected} onChange={onChange} />
          <div style={{ clear: 'both' }} />
        </div>
      );
    }

    case 'iconlist': {
      const items = Array.isArray(block.items) ? block.items : [];
      if (!items.length) return <div className="eb-empty-inline" />;
      const size = Number(block.iconSize) || 28;
      const gap = Number(block.gap) ?? 14;
      return (
        <div style={{ fontFamily: s.fontFamily }}>
          {items.map((item, i) => {
            const icon = previewSrc(item?.image);
            return (
              <div key={i} style={{ display: 'flex', gap: 14, paddingTop: i ? gap : 0 }}>
                <div style={{ flex: `0 0 ${size}px` }}>
                  {icon
                    ? <img src={icon} alt="" style={{ display: 'block', width: size }} />
                    : <div style={{ fontSize: size, lineHeight: 1 }}>{item?.emoji || '•'}</div>}
                </div>
                <div style={{ minWidth: 0 }}>
                  {item?.title && <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35, color: block.color || s.textColor }}>{item.title}</div>}
                  {item?.text && <div style={{ fontSize: 14, lineHeight: 1.5, color: block.mutedColor || s.mutedColor, paddingTop: item?.title ? 3 : 0 }}>{item.text}</div>}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    case 'unsubscribe': {
      const color = block.color || s.mutedColor;
      const link = block.linkColor || block.color || s.mutedColor;
      const label = String(block.linkText ?? '').trim() || 'Отписаться от рассылки';
      const style = {
        fontFamily: s.fontFamily,
        fontSize: `${Number(block.fontSize) || 12}px`,
        lineHeight: block.lineHeight || 1.5,
        color,
        textAlign: block.align || 'center',
        '--eb-indent': `${Number(block.indent) || 0}px`,
        '--eb-link': link,
      };
      return (
        <div style={style}>
          <TextEditable block={block} settings={s} selected={selected} onChange={onChange} />
          <div style={{ paddingTop: Number(block.gap) ?? 6 }}>
            {/* Ссылка не правится кликом: её адрес подставляется на отправке,
                а подпись меняется полем в панели свойств. */}
            <span style={{ color: link, textDecoration: 'underline' }}>{label}</span>
          </div>
        </div>
      );
    }

    case 'columns': {
      const cols = Array.isArray(block.columns) ? block.columns : [];
      const gap = Number(block.gap) || 0;
      const weights = cols.map(c => Math.max(1, Number(c.width) || 1));
      const sum = weights.reduce((a, b) => a + b, 0);
      return (
        <div className="eb-columns" style={{ gap: `${gap}px`, alignItems: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[block.valign] || 'flex-start' }}>
          {cols.map((col, i) => (
            <div key={i} className="eb-column" style={{ flex: `0 0 calc(${(weights[i] / sum) * 100}% - ${(gap * (cols.length - 1)) / cols.length}px)` }}>
              {renderColumn ? renderColumn(col, i) : null}
              {renderColumnFooter ? renderColumnFooter(col, i) : null}
            </div>
          ))}
        </div>
      );
    }

    case 'html':
      return (
        <div className="eb-raw">
          <div className="eb-raw-tag"><Code2 size={12} /></div>
          <div className="eb-raw-body" dangerouslySetInnerHTML={{ __html: block.code || '' }} />
        </div>
      );

    default:
      return <div className="eb-unknown" />;
  }
}

export { pad };
