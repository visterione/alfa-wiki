// EditorExtensions.js - Кастомные расширения TipTap для Editor и ContentRenderer
import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import Blockquote from '@tiptap/extension-blockquote';
import TipTapTableCell from '@tiptap/extension-table-cell';
import TipTapTableHeader from '@tiptap/extension-table-header';
import TiptapImage from '@tiptap/extension-image';
import { Plus, Trash2, Paintbrush } from 'lucide-react';
import { BASE_URL } from '../services/api';

// Кастомное расширение Blockquote с типами
export const CustomBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      type: {
        default: 'default',
        parseHTML: element => element.getAttribute('data-type') || 'default',
        renderHTML: attributes => {
          return {
            'data-type': attributes.type,
            class: `blockquote-${attributes.type}`
          };
        }
      }
    };
  }
});

// Расширенный TableCell с поддержкой цвета фона
export const TableCell = TipTapTableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: element => element.getAttribute('data-background-color') || element.style.backgroundColor || null,
        renderHTML: attributes => {
          if (!attributes.backgroundColor) {
            return {};
          }
          return {
            'data-background-color': attributes.backgroundColor,
            style: `background-color: ${attributes.backgroundColor}`
          };
        }
      }
    };
  }
});

// Расширенный TableHeader с поддержкой цвета фона (аналогично TableCell)
export const TableHeader = TipTapTableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: element => element.getAttribute('data-background-color') || element.style.backgroundColor || null,
        renderHTML: attributes => {
          if (!attributes.backgroundColor) {
            return {};
          }
          return {
            'data-background-color': attributes.backgroundColor,
            style: `background-color: ${attributes.backgroundColor}`
          };
        }
      }
    };
  }
});

// React компонент для изменяемого изображения (для Editor)
function ResizableImageComponent({ node, updateAttributes }) {
  const [dimensions, setDimensions] = useState({
    width: node.attrs.width || null,
    height: node.attrs.height || null
  });
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Синхронизация размеров с node.attrs
  useEffect(() => {
    setDimensions({
      width: node.attrs.width || null,
      height: node.attrs.height || null
    });
  }, [node.attrs.width, node.attrs.height]);

  const handleMouseDown = (e, handle) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const currentWidth = dimensions.width || imgRef.current?.naturalWidth || 0;
    const currentHeight = dimensions.height || imgRef.current?.naturalHeight || 0;

    startPosRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: currentWidth,
      height: currentHeight
    };

    // Сохраняем финальные размеры здесь, чтобы избежать проблем с замыканием
    let finalWidth = currentWidth;
    let finalHeight = currentHeight;

    // Вычисляем соотношение сторон
    const aspectRatio = currentWidth / currentHeight;

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startPosRef.current.x;
      const deltaY = moveEvent.clientY - startPosRef.current.y;

      let newWidth = startPosRef.current.width;
      let newHeight = startPosRef.current.height;

      // Изменяем размер в зависимости от угла
      if (handle.includes('e')) newWidth += deltaX;
      if (handle.includes('w')) newWidth -= deltaX;
      if (handle.includes('s')) newHeight += deltaY;
      if (handle.includes('n')) newHeight -= deltaY;

      // Для угловых ручек - сохраняем пропорции
      if (handle.length === 2) {
        // Используем наибольшее изменение
        const widthChange = Math.abs(newWidth - startPosRef.current.width);
        const heightChange = Math.abs(newHeight - startPosRef.current.height);

        if (widthChange > heightChange) {
          // Изменение по ширине доминирует
          newHeight = newWidth / aspectRatio;
        } else {
          // Изменение по высоте доминирует
          newWidth = newHeight * aspectRatio;
        }
      }

      newWidth = Math.max(50, newWidth);
      newHeight = Math.max(50, newHeight);

      // Сохраняем финальные размеры
      finalWidth = newWidth;
      finalHeight = newHeight;

      setDimensions({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      // Используем финальные размеры из замыкания handleMouseMove
      const newAttrs = {
        width: Math.round(finalWidth),
        height: Math.round(finalHeight)
      };
      updateAttributes(newAttrs);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleImageLoad = () => {
    // Устанавливаем размеры только если они не заданы
    if (!node.attrs.width && !node.attrs.height && imgRef.current) {
      const naturalWidth = imgRef.current.naturalWidth;
      const naturalHeight = imgRef.current.naturalHeight;
      setDimensions({ width: naturalWidth, height: naturalHeight });
      updateAttributes({ width: naturalWidth, height: naturalHeight });
    }
  };

  // Формируем полный URL для изображения
  const imgSrc = node.attrs.src?.startsWith('/uploads/')
    ? `${BASE_URL}${node.attrs.src}`
    : node.attrs.src;

  return (
    <NodeViewWrapper>
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          display: 'inline-block',
          maxWidth: '100%',
          cursor: isResizing ? 'nwse-resize' : 'default'
        }}
      >
        <img
          ref={imgRef}
          src={imgSrc}
          alt={node.attrs.alt || ''}
          title={node.attrs.title || ''}
          onLoad={handleImageLoad}
          style={{
            width: dimensions.width ? `${dimensions.width}px` : 'auto',
            height: dimensions.height ? `${dimensions.height}px` : 'auto',
            display: 'block',
            maxWidth: '100%'
          }}
        />

        {/* Ручки для изменения размера */}
        <div
          onMouseDown={(e) => handleMouseDown(e, 'se')}
          style={{
            position: 'absolute',
            right: '-4px',
            bottom: '-4px',
            width: '12px',
            height: '12px',
            background: '#3b82f6',
            border: '2px solid white',
            borderRadius: '50%',
            cursor: 'nwse-resize',
            zIndex: 10
          }}
        />
        <div
          onMouseDown={(e) => handleMouseDown(e, 'ne')}
          style={{
            position: 'absolute',
            right: '-4px',
            top: '-4px',
            width: '12px',
            height: '12px',
            background: '#3b82f6',
            border: '2px solid white',
            borderRadius: '50%',
            cursor: 'nesw-resize',
            zIndex: 10
          }}
        />
        <div
          onMouseDown={(e) => handleMouseDown(e, 'sw')}
          style={{
            position: 'absolute',
            left: '-4px',
            bottom: '-4px',
            width: '12px',
            height: '12px',
            background: '#3b82f6',
            border: '2px solid white',
            borderRadius: '50%',
            cursor: 'nesw-resize',
            zIndex: 10
          }}
        />
        <div
          onMouseDown={(e) => handleMouseDown(e, 'nw')}
          style={{
            position: 'absolute',
            left: '-4px',
            top: '-4px',
            width: '12px',
            height: '12px',
            background: '#3b82f6',
            border: '2px solid white',
            borderRadius: '50%',
            cursor: 'nwse-resize',
            zIndex: 10
          }}
        />
      </div>
    </NodeViewWrapper>
  );
}

// Расширение для редактора с возможностью изменения размера
export const ResizableImage = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: element => element.getAttribute('src'),
        renderHTML: attributes => {
          if (!attributes.src) return {};
          return { src: attributes.src };
        }
      },
      alt: {
        default: null,
        parseHTML: element => element.getAttribute('alt'),
        renderHTML: attributes => {
          if (!attributes.alt) return {};
          return { alt: attributes.alt };
        }
      },
      title: {
        default: null,
        parseHTML: element => element.getAttribute('title'),
        renderHTML: attributes => {
          if (!attributes.title) return {};
          return { title: attributes.title };
        }
      },
      width: {
        default: null,
        parseHTML: element => {
          const width = element.getAttribute('width') || element.style.width;
          return width ? parseInt(width) : null;
        },
        renderHTML: attributes => {
          if (!attributes.width) return {};
          return { width: attributes.width };
        }
      },
      height: {
        default: null,
        parseHTML: element => {
          const height = element.getAttribute('height') || element.style.height;
          return height ? parseInt(height) : null;
        },
        renderHTML: attributes => {
          if (!attributes.height) return {};
          return { height: attributes.height };
        }
      },
      display: {
        default: 'inline',
        parseHTML: element => element.getAttribute('data-display') || 'inline',
        renderHTML: attributes => {
          if (!attributes.display) return {};
          return { 'data-display': attributes.display };
        }
      },
      float: {
        default: 'none',
        parseHTML: element => element.getAttribute('data-float') || 'none',
        renderHTML: attributes => {
          if (!attributes.float) return {};
          return { 'data-float': attributes.float };
        }
      },
      align: {
        default: 'left',
        parseHTML: element => element.getAttribute('data-align') || 'left',
        renderHTML: attributes => {
          if (!attributes.align) return {};
          return { 'data-align': attributes.align };
        }
      }
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ node }) {
    // ВАЖНО: Этот метод вызывается при getHTML() для сериализации
    // Формируем атрибуты явно из node.attrs
    const attrs = {
      src: node.attrs.src
    };

    // Добавляем опциональные атрибуты
    if (node.attrs.alt) attrs.alt = node.attrs.alt;
    if (node.attrs.title) attrs.title = node.attrs.title;
    if (node.attrs.width) attrs.width = node.attrs.width;
    if (node.attrs.height) attrs.height = node.attrs.height;

    // Всегда добавляем data- атрибуты даже со значениями по умолчанию
    attrs['data-display'] = node.attrs.display || 'inline';
    attrs['data-float'] = node.attrs.float || 'none';
    attrs['data-align'] = node.attrs.align || 'left';

    console.log('ResizableImage renderHTML:', attrs);
    return ['img', attrs];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageComponent);
  },

  addCommands() {
    return {
      setImage: (options) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: options
        });
      },
      updateImageAttributes: (attrs) => ({ commands }) => {
        return commands.updateAttributes(this.name, attrs);
      }
    };
  }
});

// Версия для режима просмотра - простое расширение TiptapImage без ручек
export const ResizableImageReadOnly = TiptapImage.extend({
  name: 'image',

  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (dom) => {
          let src = dom.getAttribute('src');

          // Исправляем относительные пути при парсинге
          if (src && src.startsWith('/uploads/')) {
            src = `${BASE_URL}${src}`;
            console.log('🖼️ ResizableImageReadOnly parseHTML: Fixed src', src);
          }

          return {
            src,
            alt: dom.getAttribute('alt'),
            title: dom.getAttribute('title'),
            width: dom.getAttribute('width') ? parseInt(dom.getAttribute('width')) : null,
            height: dom.getAttribute('height') ? parseInt(dom.getAttribute('height')) : null,
            display: dom.getAttribute('data-display') || 'inline',
            float: dom.getAttribute('data-float') || 'none',
            align: dom.getAttribute('data-align') || 'left',
          };
        },
      },
    ];
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: element => {
          const width = element.getAttribute('width') || element.style.width;
          return width ? parseInt(width) : null;
        },
        renderHTML: attributes => {
          if (!attributes.width) return {};
          return { width: attributes.width };
        }
      },
      height: {
        default: null,
        parseHTML: element => {
          const height = element.getAttribute('height') || element.style.height;
          return height ? parseInt(height) : null;
        },
        renderHTML: attributes => {
          if (!attributes.height) return {};
          return { height: attributes.height };
        }
      },
      display: {
        default: 'inline',
        parseHTML: element => element.getAttribute('data-display') || 'inline',
        renderHTML: attributes => {
          if (!attributes.display) return {};
          return { 'data-display': attributes.display };
        }
      },
      float: {
        default: 'none',
        parseHTML: element => element.getAttribute('data-float') || 'none',
        renderHTML: attributes => {
          if (!attributes.float) return {};
          return { 'data-float': attributes.float };
        }
      },
      align: {
        default: 'left',
        parseHTML: element => element.getAttribute('data-align') || 'left',
        renderHTML: attributes => {
          if (!attributes.align) return {};
          return { 'data-align': attributes.align };
        }
      }
    };
  },

  renderHTML({ HTMLAttributes }) {
    console.log('🖼️ ResizableImageReadOnly renderHTML:', HTMLAttributes);

    // Пути уже исправлены в parseHTML, просто рендерим все атрибуты
    const attrs = {
      src: HTMLAttributes.src,
    };

    if (HTMLAttributes.alt) attrs.alt = HTMLAttributes.alt;
    if (HTMLAttributes.title) attrs.title = HTMLAttributes.title;
    if (HTMLAttributes.width) attrs.width = HTMLAttributes.width;
    if (HTMLAttributes.height) attrs.height = HTMLAttributes.height;
    if (HTMLAttributes.display) attrs['data-display'] = HTMLAttributes.display;
    if (HTMLAttributes.float) attrs['data-float'] = HTMLAttributes.float;
    if (HTMLAttributes.align) attrs['data-align'] = HTMLAttributes.align;

    return ['img', attrs];
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// InteractiveTable — кастомный NodeView для редактируемых таблиц
// Хранится как обычный HTML <table> для обратной совместимости с ContentRenderer
// ─────────────────────────────────────────────────────────────────────────────

// 10 строк × 10 столбцов. Каждая строка — один оттенок, слева ярко/тёмно → справа бледно/светло.
// Первая строка — нейтральные (чёрный → без цвета), остальные — цветные семейства.
const CELL_BG_COLORS = [
  // ── Нейтральные ──────────────────────────────────────────────────────────
  { name: 'Чёрный',         color: '#212121' },
  { name: 'Серый 800',      color: '#424242' },
  { name: 'Серый 700',      color: '#616161' },
  { name: 'Серый 600',      color: '#757575' },
  { name: 'Серый 500',      color: '#9E9E9E' },
  { name: 'Серый 400',      color: '#BDBDBD' },
  { name: 'Серый 300',      color: '#E0E0E0' },
  { name: 'Серый 200',      color: '#EEEEEE' },
  { name: 'Серый 100',      color: '#F5F5F5' },
  { name: 'Без цвета',      color: '' },
  // ── Красные ──────────────────────────────────────────────────────────────
  { name: 'Красный 900',    color: '#B71C1C' },
  { name: 'Красный 800',    color: '#C62828' },
  { name: 'Красный 700',    color: '#D32F2F' },
  { name: 'Красный 600',    color: '#E53935' },
  { name: 'Красный 500',    color: '#F44336' },
  { name: 'Красный 400',    color: '#EF5350' },
  { name: 'Красный 300',    color: '#E57373' },
  { name: 'Красный 200',    color: '#EF9A9A' },
  { name: 'Красный 100',    color: '#FFCDD2' },
  { name: 'Красный 50',     color: '#FFEBEE' },
  // ── Розовые ──────────────────────────────────────────────────────────────
  { name: 'Розовый 900',    color: '#880E4F' },
  { name: 'Розовый 800',    color: '#AD1457' },
  { name: 'Розовый 700',    color: '#C2185B' },
  { name: 'Розовый 600',    color: '#D81B60' },
  { name: 'Розовый 500',    color: '#E91E63' },
  { name: 'Розовый 400',    color: '#EC407A' },
  { name: 'Розовый 300',    color: '#F06292' },
  { name: 'Розовый 200',    color: '#F48FB1' },
  { name: 'Розовый 100',    color: '#F8BBD0' },
  { name: 'Розовый 50',     color: '#FCE4EC' },
  // ── Оранжевые (Deep Orange) ──────────────────────────────────────────────
  { name: 'Оранжевый 900',  color: '#BF360C' },
  { name: 'Оранжевый 800',  color: '#D84315' },
  { name: 'Оранжевый 700',  color: '#E64A19' },
  { name: 'Оранжевый 600',  color: '#F4511E' },
  { name: 'Оранжевый 500',  color: '#FF5722' },
  { name: 'Оранжевый 400',  color: '#FF7043' },
  { name: 'Оранжевый 300',  color: '#FF8A65' },
  { name: 'Оранжевый 200',  color: '#FFAB91' },
  { name: 'Оранжевый 100',  color: '#FFCCBC' },
  { name: 'Оранжевый 50',   color: '#FBE9E7' },
  // ── Янтарные / Жёлтые ────────────────────────────────────────────────────
  { name: 'Янтарный 900',   color: '#FF6F00' },
  { name: 'Янтарный 800',   color: '#FF8F00' },
  { name: 'Янтарный 700',   color: '#FFA000' },
  { name: 'Янтарный 600',   color: '#FFB300' },
  { name: 'Янтарный 500',   color: '#FFC107' },
  { name: 'Янтарный 400',   color: '#FFCA28' },
  { name: 'Янтарный 300',   color: '#FFD54F' },
  { name: 'Янтарный 200',   color: '#FFE082' },
  { name: 'Янтарный 100',   color: '#FFECB3' },
  { name: 'Янтарный 50',    color: '#FFF8E1' },
  // ── Зелёные ──────────────────────────────────────────────────────────────
  { name: 'Зелёный 900',    color: '#1B5E20' },
  { name: 'Зелёный 800',    color: '#2E7D32' },
  { name: 'Зелёный 700',    color: '#388E3C' },
  { name: 'Зелёный 600',    color: '#43A047' },
  { name: 'Зелёный 500',    color: '#4CAF50' },
  { name: 'Зелёный 400',    color: '#66BB6A' },
  { name: 'Зелёный 300',    color: '#81C784' },
  { name: 'Зелёный 200',    color: '#A5D6A7' },
  { name: 'Зелёный 100',    color: '#C8E6C9' },
  { name: 'Зелёный 50',     color: '#E8F5E9' },
  // ── Бирюзовые ────────────────────────────────────────────────────────────
  { name: 'Бирюзовый 900',  color: '#004D40' },
  { name: 'Бирюзовый 800',  color: '#00695C' },
  { name: 'Бирюзовый 700',  color: '#00796B' },
  { name: 'Бирюзовый 600',  color: '#00897B' },
  { name: 'Бирюзовый 500',  color: '#009688' },
  { name: 'Бирюзовый 400',  color: '#26A69A' },
  { name: 'Бирюзовый 300',  color: '#4DB6AC' },
  { name: 'Бирюзовый 200',  color: '#80CBC4' },
  { name: 'Бирюзовый 100',  color: '#B2DFDB' },
  { name: 'Бирюзовый 50',   color: '#E0F2F1' },
  // ── Синие ────────────────────────────────────────────────────────────────
  { name: 'Синий 900',      color: '#0D47A1' },
  { name: 'Синий 800',      color: '#1565C0' },
  { name: 'Синий 700',      color: '#1976D2' },
  { name: 'Синий 600',      color: '#1E88E5' },
  { name: 'Синий 500',      color: '#2196F3' },
  { name: 'Синий 400',      color: '#42A5F5' },
  { name: 'Синий 300',      color: '#64B5F6' },
  { name: 'Синий 200',      color: '#90CAF9' },
  { name: 'Синий 100',      color: '#BBDEFB' },
  { name: 'Синий 50',       color: '#E3F2FD' },
  // ── Фиолетовые ───────────────────────────────────────────────────────────
  { name: 'Фиолет. 900',    color: '#4A148C' },
  { name: 'Фиолет. 800',    color: '#6A1B9A' },
  { name: 'Фиолет. 700',    color: '#7B1FA2' },
  { name: 'Фиолет. 600',    color: '#8E24AA' },
  { name: 'Фиолет. 500',    color: '#9C27B0' },
  { name: 'Фиолет. 400',    color: '#AB47BC' },
  { name: 'Фиолет. 300',    color: '#BA68C8' },
  { name: 'Фиолет. 200',    color: '#CE93D8' },
  { name: 'Фиолет. 100',    color: '#E1BEE7' },
  { name: 'Фиолет. 50',     color: '#F3E5F5' },
  // ── Коричневые ───────────────────────────────────────────────────────────
  { name: 'Коричневый 900', color: '#3E2723' },
  { name: 'Коричневый 800', color: '#4E342E' },
  { name: 'Коричневый 700', color: '#5D4037' },
  { name: 'Коричневый 600', color: '#6D4C41' },
  { name: 'Коричневый 500', color: '#795548' },
  { name: 'Коричневый 400', color: '#8D6E63' },
  { name: 'Коричневый 300', color: '#A1887F' },
  { name: 'Коричневый 200', color: '#BCAAA4' },
  { name: 'Коричневый 100', color: '#D7CCC8' },
  { name: 'Коричневый 50',  color: '#EFEBE9' },
];

// ── Утилиты ─────────────────────────────────────────────────────────────────

/**
 * Строит карту сетки таблицы: для каждой (gridR, gridC) — какая ячейка владеет,
 * а для каждой ячейки (rowIdx, cellIdx) — её координаты в сетке.
 */
function computeGridMap(rows) {
  const occupied = {}; // `${r},${c}` -> { rowIdx, cellIdx }
  const cellToGrid = rows.map(() => []);
  let numCols = 0;
  for (let ri = 0; ri < rows.length; ri++) {
    let gc = 0;
    for (let ci = 0; ci < rows[ri].length; ci++) {
      while (occupied[`${ri},${gc}`]) gc++;
      const cell = rows[ri][ci];
      const cs = Math.max(1, cell.colSpan || 1);
      const rs = Math.max(1, cell.rowSpan || 1);
      cellToGrid[ri][ci] = { gridR: ri, gridC: gc };
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          occupied[`${ri + dr},${gc + dc}`] = { rowIdx: ri, cellIdx: ci };
        }
      }
      numCols = Math.max(numCols, gc + cs);
      gc += cs;
    }
  }
  return { occupied, cellToGrid, numCols, numRows: rows.length };
}

/** Парсит <table> HTML → { rows, header, colWidths, widthMode } */
function parseHtmlTable(html) {
  const empty = { rows: [
    [{ text: '', bg: '', colSpan: 1, rowSpan: 1 }, { text: '', bg: '', colSpan: 1, rowSpan: 1 }],
    [{ text: '', bg: '', colSpan: 1, rowSpan: 1 }, { text: '', bg: '', colSpan: 1, rowSpan: 1 }],
  ], header: true, colWidths: [], widthMode: 'full' };
  if (!html) return empty;
  const div = document.createElement('div');
  div.innerHTML = html;
  const table = div.querySelector('table');
  if (!table) return empty;

  const widthMode = table.getAttribute('data-width-mode') || 'full';
  const colEls = table.querySelectorAll('colgroup col');
  const colWidths = Array.from(colEls).map(col => {
    const sw = col.style.width;
    if (sw && sw.endsWith('px')) return parseFloat(sw);
    const wa = col.getAttribute('width');
    return wa ? parseFloat(wa) : null;
  });

  const allRows = Array.from(table.querySelectorAll('tr'));
  const header = allRows.length > 0 && allRows[0].querySelector('th') !== null;
  const rows = allRows.map(tr =>
    Array.from(tr.querySelectorAll('td, th')).map(cell => ({
      text: cell.innerText ?? cell.textContent ?? '',
      bg: cell.getAttribute('data-background-color') || cell.style.backgroundColor || '',
      colSpan: Math.max(1, parseInt(cell.getAttribute('colspan') || '1')),
      rowSpan: Math.max(1, parseInt(cell.getAttribute('rowspan') || '1')),
    }))
  );
  return { rows, header, colWidths, widthMode };
}

/** Сериализует rows → HTML <table> */
function serializeToHtml(rows, header, colWidths, widthMode) {
  if (!rows.length) return '<table><tr><td></td></tr></table>';

  const mode = widthMode || 'full';
  const tableStyle = mode === 'fit'
    ? 'table-layout:auto;width:auto'
    : mode === 'fixed'
    ? 'table-layout:fixed;width:100%'
    : 'width:100%';

  const colgroup = (colWidths && colWidths.length > 0)
    ? '<colgroup>' + colWidths.map(w => `<col style="width:${w ? w + 'px' : 'auto'}">`).join('') + '</colgroup>'
    : '';

  const trs = rows.map((cells, ri) => {
    const tds = cells.map(cell => {
      const tag = (header && ri === 0) ? 'th' : 'td';
      const attrs = [];
      if (cell.bg) attrs.push(`data-background-color="${cell.bg}" style="background-color:${cell.bg}"`);
      if ((cell.colSpan || 1) > 1) attrs.push(`colspan="${cell.colSpan}"`);
      if ((cell.rowSpan || 1) > 1) attrs.push(`rowspan="${cell.rowSpan}"`);
      const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
      const text = (cell.text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<${tag}${attrStr}>${text}</${tag}>`;
    });
    return `<tr>${tds.join('')}</tr>`;
  });

  return `<table data-width-mode="${mode}" style="${tableStyle}">${colgroup}${trs.join('')}</table>`;
}

// ── Компонент редактируемой таблицы ─────────────────────────────────────────

function InteractiveTableComponent({ node, updateAttributes }) {
  const initParsed = useMemo(() => parseHtmlTable(node.attrs.tableHtml), []); // eslint-disable-line

  const [rows, setRows]           = useState(initParsed.rows);
  const [header, setHeader]       = useState(initParsed.header);
  const [colWidths, setColWidths] = useState(initParsed.colWidths);
  const [widthMode, setWidthMode] = useState(initParsed.widthMode);
  const [selAnchor, setSelAnchor] = useState(null); // grid coords {r,c}
  const [selFocus, setSelFocus]   = useState(null); // grid coords {r,c}
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Рефы для event-listener-замыканий (resize, save on mouseup)
  const rowsRef      = useRef(rows);
  const headerRef    = useRef(header);
  const colWidthsRef = useRef(colWidths);
  const widthModeRef = useRef(widthMode);
  useEffect(() => { rowsRef.current      = rows;      }, [rows]);
  useEffect(() => { headerRef.current    = header;    }, [header]);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);
  useEffect(() => { widthModeRef.current = widthMode; }, [widthMode]);

  // Рефы на textarea по `${rowIdx},${cellIdx}`
  const textareaRefs = useRef({});

  // Рефы на контейнер для измерений при ресайзе
  const tableElRef = useRef(null);

  // Ref на color-picker div (для закрытия по клику вне)
  const colorPickerRef = useRef(null);

  // Флаг drag-selection (зажата кнопка мыши и тянем)
  const isDraggingRef = useRef(false);
  // setSelFocus ref для использования в глобальных обработчиках
  const setSelFocusRef = useRef(null);
  setSelFocusRef.current = setSelFocus;

  // Синхронизация при undo/redo (изменение attrs снаружи)
  useEffect(() => {
    const p = parseHtmlTable(node.attrs.tableHtml);
    setRows(p.rows);
    setHeader(p.header);
    setColWidths(p.colWidths);
    setWidthMode(p.widthMode);
  }, [node.attrs.tableHtml]);

  // Авто-высота textarea: подстраиваем при монтировании и после изменения rows (undo/redo)
  useEffect(() => {
    Object.values(textareaRefs.current).forEach(el => {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    });
  }, [rows]);

  // Закрыть color-picker при клике вне
  useEffect(() => {
    const h = (e) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target))
        setShowColorPicker(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Глобальный drag-selection через elementFromPoint
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    const onMove = (e) => {
      if (!isDraggingRef.current) return;
      let el = document.elementFromPoint(e.clientX, e.clientY);
      while (el && el.tagName !== 'TD' && el.tagName !== 'TH' && el !== document.body) {
        el = el.parentElement;
      }
      if (!el || (el.tagName !== 'TD' && el.tagName !== 'TH')) return;
      const gr = el.getAttribute('data-grid-r');
      const gc = el.getAttribute('data-grid-c');
      if (gr === null || gc === null) return;
      setSelFocusRef.current({ r: parseInt(gr), c: parseInt(gc) });
    };
    const onUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const gridMap = useMemo(() => computeGridMap(rows), [rows]);

  const selRect = useMemo(() => {
    if (!selAnchor || !selFocus) return null;
    return {
      r1: Math.min(selAnchor.r, selFocus.r), c1: Math.min(selAnchor.c, selFocus.c),
      r2: Math.max(selAnchor.r, selFocus.r), c2: Math.max(selAnchor.c, selFocus.c),
    };
  }, [selAnchor, selFocus]);

  const save = useCallback((nr, nh, ncw, nwm) => {
    updateAttributes({
      tableHtml: serializeToHtml(
        nr  ?? rowsRef.current,
        nh  ?? headerRef.current,
        ncw ?? colWidthsRef.current,
        nwm ?? widthModeRef.current,
      )
    });
  }, [updateAttributes]);

  const focusCell = (ri, ci) => {
    const el = textareaRefs.current[`${ri},${ci}`];
    if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
  };

  // ── Операции со строками/столбцами ──────────────────────────────────────

  const targetRowIdx = () =>
    selAnchor ? (gridMap.occupied[`${selAnchor.r},${selAnchor.c}`]?.rowIdx ?? rows.length - 1) : rows.length - 1;

  const targetGridC = () => selAnchor ? selAnchor.c : gridMap.numCols - 1;

  const addRow = (after) => {
    const idx = targetRowIdx();
    const newRow = Array.from({ length: gridMap.numCols }, () => ({ text: '', bg: '', colSpan: 1, rowSpan: 1 }));
    const nr = [...rows];
    nr.splice(after ? idx + 1 : idx, 0, newRow);
    setRows(nr);
    setSelAnchor(null); setSelFocus(null);
    save(nr, header, colWidths, widthMode);
  };

  const deleteRow = () => {
    if (rows.length <= 1) return;
    const idx = targetRowIdx();
    // Уменьшить rowspan ячеек выше, которые перекрывают удаляемую строку
    const nr = rows
      .map((row, ri) => {
        if (ri === idx) return null;
        if (ri < idx) {
          return row.map((cell, ci) => {
            const pos = gridMap.cellToGrid[ri]?.[ci];
            if (!pos) return cell;
            const rs = cell.rowSpan || 1;
            if (ri + rs > idx) return { ...cell, rowSpan: Math.max(1, rs - 1) };
            return cell;
          });
        }
        return row;
      })
      .filter(Boolean);
    setRows(nr);
    setSelAnchor(null); setSelFocus(null);
    save(nr, header, colWidths, widthMode);
  };

  const addCol = (after) => {
    const tgc = targetGridC();
    const insertGridC = after ? tgc + 1 : tgc;
    const nr = rows.map((row, ri) => {
      const newRow = [...row];
      let insertAt = newRow.length;
      for (let ci = 0; ci < row.length; ci++) {
        const pos = gridMap.cellToGrid[ri]?.[ci];
        if (!pos) continue;
        if (after ? pos.gridC + (row[ci].colSpan || 1) > tgc : pos.gridC >= insertGridC) {
          insertAt = after ? ci + 1 : ci;
          break;
        }
      }
      newRow.splice(insertAt, 0, { text: '', bg: '', colSpan: 1, rowSpan: 1 });
      return newRow;
    });
    const ncw = [...colWidths]; ncw.splice(insertGridC, 0, null);
    setRows(nr); setColWidths(ncw);
    setSelAnchor(null); setSelFocus(null);
    save(nr, header, ncw, widthMode);
  };

  const deleteCol = () => {
    if (gridMap.numCols <= 1) return;
    const tgc = targetGridC();
    const nr = rows.map((row, ri) =>
      row
        .map((cell, ci) => {
          const pos = gridMap.cellToGrid[ri]?.[ci];
          if (!pos) return cell;
          const { gridC } = pos;
          const cs = cell.colSpan || 1;
          if (gridC === tgc) return cs === 1 ? null : { ...cell, colSpan: cs - 1 };
          if (gridC < tgc && gridC + cs > tgc) return { ...cell, colSpan: cs - 1 };
          return cell;
        })
        .filter(Boolean)
    );
    const ncw = colWidths.filter((_, i) => i !== tgc);
    setRows(nr); setColWidths(ncw);
    setSelAnchor(null); setSelFocus(null);
    save(nr, header, ncw, widthMode);
  };

  // ── Цвет ячеек ──────────────────────────────────────────────────────────

  const setCellBg = (color) => {
    if (!selRect) return;
    const nr = rows.map((row, ri) =>
      row.map((cell, ci) => {
        const pos = gridMap.cellToGrid[ri]?.[ci];
        if (!pos) return cell;
        const { gridR, gridC } = pos;
        if (gridR >= selRect.r1 && gridR <= selRect.r2 && gridC >= selRect.c1 && gridC <= selRect.c2)
          return { ...cell, bg: color };
        return cell;
      })
    );
    setRows(nr);
    save(nr, header, colWidths, widthMode);
    setShowColorPicker(false);
  };

  // ── Шапка ───────────────────────────────────────────────────────────────

  const toggleHeader = () => {
    const nh = !header;
    setHeader(nh);
    save(rows, nh, colWidths, widthMode);
  };

  // ── Объединение ─────────────────────────────────────────────────────────

  const canMerge = selRect && (selRect.r1 !== selRect.r2 || selRect.c1 !== selRect.c2);

  const handleMerge = () => {
    if (!selRect) return;
    const { r1, c1, r2, c2 } = selRect;
    const anchorInfo = gridMap.occupied[`${r1},${c1}`];
    if (!anchorInfo) return;
    const { rowIdx: aRi, cellIdx: aCi } = anchorInfo;

    // Собираем все ячейки в прямоугольнике кроме anchor → удалить
    const toRemove = new Set();
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const info = gridMap.occupied[`${r},${c}`];
        if (!info) continue;
        if (info.rowIdx === aRi && info.cellIdx === aCi) continue;
        toRemove.add(`${info.rowIdx},${info.cellIdx}`);
      }
    }
    const nr = rows.map((row, ri) =>
      row
        .map((cell, ci) => {
          if (ri === aRi && ci === aCi) return { ...cell, colSpan: c2 - c1 + 1, rowSpan: r2 - r1 + 1 };
          return cell;
        })
        .filter((_, ci) => !toRemove.has(`${ri},${ci}`))
    );
    setRows(nr);
    setSelAnchor({ r: r1, c: c1 }); setSelFocus({ r: r1, c: c1 });
    save(nr, header, colWidths, widthMode);
  };

  // ── Разделение ──────────────────────────────────────────────────────────

  const canSplit = Boolean(selAnchor && (() => {
    const info = gridMap.occupied[`${selAnchor.r},${selAnchor.c}`];
    if (!info) return false;
    const cell = rows[info.rowIdx]?.[info.cellIdx];
    return cell && ((cell.colSpan || 1) > 1 || (cell.rowSpan || 1) > 1);
  })());

  const handleSplit = () => {
    if (!selAnchor) return;
    const info = gridMap.occupied[`${selAnchor.r},${selAnchor.c}`];
    if (!info) return;
    const { rowIdx, cellIdx } = info;
    const cell = rows[rowIdx][cellIdx];
    const cs = cell.colSpan || 1;
    const rs = cell.rowSpan || 1;
    if (cs <= 1 && rs <= 1) return;

    const { gridC: anchorGridC } = gridMap.cellToGrid[rowIdx][cellIdx];

    // Копия
    let nr = rows.map(row => row.map(c => ({ ...c })));
    // Сброс span
    nr[rowIdx][cellIdx] = { ...cell, colSpan: 1, rowSpan: 1 };
    // Вставить cs-1 ячеек справа в той же строке
    for (let dc = cs - 1; dc >= 1; dc--) {
      nr[rowIdx].splice(cellIdx + 1, 0, { text: '', bg: '', colSpan: 1, rowSpan: 1 });
    }
    // Вставить cs ячеек в нижних строках (для rowspan)
    for (let dr = 1; dr < rs; dr++) {
      const ri = rowIdx + dr;
      if (ri >= nr.length) continue;
      const tmpMap = computeGridMap(nr.slice(0, ri + 1));
      let insertAt = nr[ri].length;
      for (let ci2 = 0; ci2 < nr[ri].length; ci2++) {
        const pos = tmpMap.cellToGrid[ri]?.[ci2];
        if (pos && pos.gridC >= anchorGridC) { insertAt = ci2; break; }
      }
      for (let dc = 0; dc < cs; dc++) {
        nr[ri].splice(insertAt + dc, 0, { text: '', bg: '', colSpan: 1, rowSpan: 1 });
      }
    }
    setRows(nr);
    save(nr, header, colWidths, widthMode);
  };

  // ── Режим ширины ────────────────────────────────────────────────────────

  const changeWidthMode = (mode) => {
    let ncw = colWidths;
    if (mode === 'fixed' && colWidths.length === 0 && tableElRef.current) {
      const tbl = tableElRef.current;
      const totalW = tbl.getBoundingClientRect().width || 600;
      const perCol = Math.round(totalW / Math.max(1, gridMap.numCols));
      ncw = Array.from({ length: gridMap.numCols }, () => perCol);
      setColWidths(ncw);
    }
    setWidthMode(mode);
    save(rows, header, ncw, mode);
  };

  // ── Resize колонок ──────────────────────────────────────────────────────

  const handleResizeStart = (e, gridC) => {
    e.preventDefault(); e.stopPropagation();
    const cellEl = e.currentTarget.closest('td, th');
    const startWidth = cellEl ? cellEl.getBoundingClientRect().width : 100;
    const startX = e.clientX;

    const onMove = (me) => {
      const newW = Math.max(36, startWidth + (me.clientX - startX));
      const next = [...colWidthsRef.current];
      while (next.length <= gridC) next.push(null);
      next[gridC] = Math.round(newW);
      colWidthsRef.current = next;
      setColWidths(next);
      if (widthModeRef.current !== 'fixed') {
        widthModeRef.current = 'fixed';
        setWidthMode('fixed');
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      save(rowsRef.current, headerRef.current, colWidthsRef.current, widthModeRef.current);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── Обновление текста ячейки ────────────────────────────────────────────

  const updateCell = (ri, ci, text) => {
    const nr = rows.map((row, r) =>
      row.map((cell, c) => r === ri && c === ci ? { ...cell, text } : cell)
    );
    setRows(nr);
    save(nr, header, colWidths, widthMode);
  };

  // ── Helpers ─────────────────────────────────────────────────────────────

  const isCellSelected = (gridR, gridC) => {
    if (!selRect) return false;
    return gridR >= selRect.r1 && gridR <= selRect.r2 && gridC >= selRect.c1 && gridC <= selRect.c2;
  };

  const isActiveSingle = (gridR, gridC) =>
    selAnchor && selFocus &&
    selAnchor.r === selFocus.r && selAnchor.c === selFocus.c &&
    selAnchor.r === gridR && selAnchor.c === gridC;

  const tableStyle = widthMode === 'fit'
    ? { tableLayout: 'auto', width: 'auto' }
    : widthMode === 'fixed'
    ? { tableLayout: 'fixed', width: '100%' }
    : { width: '100%' };

  // ── Рендер ──────────────────────────────────────────────────────────────

  return (
    <NodeViewWrapper className={`itable-wrapper${isDragging ? ' itable-wrapper--dragging' : ''}`} contentEditable={false}>
      {/* Toolbar */}
      <div className="itable-toolbar" onMouseDown={e => e.preventDefault()}>

        {/* Строки */}
        <span className="itable-toolbar-group">
          <button type="button" className="itable-btn" title="Строку выше"  onClick={() => addRow(false)}><Plus size={11}/>↑</button>
          <button type="button" className="itable-btn" title="Строку ниже"  onClick={() => addRow(true)} ><Plus size={11}/>↓</button>
          <button type="button" className="itable-btn itable-btn--danger"   title="Удалить строку" onClick={deleteRow}><Trash2 size={11}/></button>
        </span>
        <span className="itable-toolbar-sep"/>

        {/* Столбцы */}
        <span className="itable-toolbar-group">
          <button type="button" className="itable-btn" title="Столбец слева"  onClick={() => addCol(false)}><Plus size={11}/>←</button>
          <button type="button" className="itable-btn" title="Столбец справа" onClick={() => addCol(true)} ><Plus size={11}/>→</button>
          <button type="button" className="itable-btn itable-btn--danger"     title="Удалить столбец" onClick={deleteCol}><Trash2 size={11}/></button>
        </span>
        <span className="itable-toolbar-sep"/>

        {/* Объединение */}
        <span className="itable-toolbar-group">
          <button type="button" className="itable-btn" disabled={!canMerge} onClick={handleMerge} title="Объединить выделенные ячейки">объед.</button>
          <button type="button" className="itable-btn" disabled={!canSplit}  onClick={handleSplit} title="Разделить ячейку">раздел.</button>
        </span>
        <span className="itable-toolbar-sep"/>

        {/* Цвет ячейки */}
        <span ref={colorPickerRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="itable-btn"
            title="Цвет заливки"
            onClick={() => setShowColorPicker(v => !v)}
          >
            <Paintbrush size={11}/>
          </button>
          {showColorPicker && (
            <div className="itable-color-picker">
              {CELL_BG_COLORS.map(({ name, color }) => (
                <button
                  key={color || '__none__'}
                  type="button"
                  className="itable-color-swatch"
                  style={{
                    background: color || '#fff',
                    border: color ? '1px solid rgba(0,0,0,0.08)' : '2px dashed #ccc',
                  }}
                  title={name}
                  onClick={() => setCellBg(color)}
                />
              ))}
            </div>
          )}
        </span>
        <span className="itable-toolbar-sep"/>

        {/* Шапка */}
        <button type="button" className={`itable-btn ${header ? 'itable-btn--active' : ''}`} onClick={toggleHeader} title="Строка-заголовок">
          шапка
        </button>
        <span className="itable-toolbar-sep"/>

        {/* Режим ширины */}
        <span className="itable-toolbar-group">
          <button type="button" className={`itable-btn ${widthMode === 'full'  ? 'itable-btn--active' : ''}`} onClick={() => changeWidthMode('full')}  title="На всю ширину">100%</button>
          <button type="button" className={`itable-btn ${widthMode === 'fit'   ? 'itable-btn--active' : ''}`} onClick={() => changeWidthMode('fit')}   title="По содержимому">авто</button>
          <button type="button" className={`itable-btn ${widthMode === 'fixed' ? 'itable-btn--active' : ''}`} onClick={() => changeWidthMode('fixed')} title="Фиксированная (перетащите границу)">фикс.</button>
        </span>
      </div>

      {/* Table */}
      <div className="itable-scroll">
        <table className="itable-table" style={tableStyle} ref={tableElRef}>
          {colWidths.length > 0 && (
            <colgroup>
              {Array.from({ length: gridMap.numCols }).map((_, c) => (
                <col key={c} style={colWidths[c] ? { width: `${colWidths[c]}px` } : undefined}/>
              ))}
            </colgroup>
          )}
          <tbody>
            {rows.map((cells, rowIdx) => (
              <tr key={rowIdx}>
                {cells.map((cell, cellIdx) => {
                  const pos = gridMap.cellToGrid[rowIdx]?.[cellIdx];
                  if (!pos) return null;
                  const { gridR, gridC } = pos;
                  const Tag = (header && rowIdx === 0) ? 'th' : 'td';
                  const selected = isCellSelected(gridR, gridC);
                  const active   = isActiveSingle(gridR, gridC);

                  return (
                    <Tag
                      key={cellIdx}
                      data-grid-r={gridR}
                      data-grid-c={gridC}
                      className={`itable-cell${selected ? ' itable-cell--selected' : ''}${active ? ' itable-cell--active' : ''}`}
                      style={{ backgroundColor: cell.bg || undefined, position: 'relative' }}
                      colSpan={(cell.colSpan || 1) > 1 ? cell.colSpan : undefined}
                      rowSpan={(cell.rowSpan || 1) > 1 ? cell.rowSpan : undefined}
                      onMouseDown={e => {
                        if (e.target.classList.contains('itable-resize-handle')) return;
                        if (e.shiftKey && selAnchor) {
                          e.preventDefault();
                          setSelFocus({ r: gridR, c: gridC });
                          isDraggingRef.current = false;
                          return;
                        }
                        setSelAnchor({ r: gridR, c: gridC });
                        setSelFocus({ r: gridR, c: gridC });
                        isDraggingRef.current = true;
                        setIsDragging(true);
                      }}
                    >
                      <textarea
                        ref={el => {
                          if (el) textareaRefs.current[`${rowIdx},${cellIdx}`] = el;
                          else delete textareaRefs.current[`${rowIdx},${cellIdx}`];
                        }}
                        className="itable-input"
                        value={cell.text}
                        rows={1}
                        onChange={e => updateCell(rowIdx, cellIdx, e.target.value)}
                        onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                        onKeyDown={e => {
                          if (e.key === 'Tab') {
                            e.preventDefault();
                            const nextGC = gridC + (cell.colSpan || 1);
                            let nxtInfo;
                            if (nextGC < gridMap.numCols) nxtInfo = gridMap.occupied[`${gridR},${nextGC}`];
                            else if (gridR + 1 < gridMap.numRows) nxtInfo = gridMap.occupied[`${gridR + 1},0`];
                            if (nxtInfo) {
                              const nPos = gridMap.cellToGrid[nxtInfo.rowIdx]?.[nxtInfo.cellIdx];
                              if (nPos) { setSelAnchor(nPos); setSelFocus(nPos); }
                              focusCell(nxtInfo.rowIdx, nxtInfo.cellIdx);
                            }
                          }
                        }}
                      />
                      {/* Ручка ресайза колонки */}
                      <div
                        className="itable-resize-handle"
                        onMouseDown={e => handleResizeStart(e, gridC)}
                        title="Потяните для изменения ширины"
                      />
                    </Tag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </NodeViewWrapper>
  );
}

/** Read-only версия */
function InteractiveTableReadOnlyComponent({ node }) {
  return (
    <NodeViewWrapper className="itable-wrapper itable-wrapper--readonly" contentEditable={false}>
      <div
        dangerouslySetInnerHTML={{ __html: node.attrs.tableHtml || '' }}
        onMouseDown={e => e.stopPropagation()}
        onDragStart={e => e.preventDefault()}
      />
    </NodeViewWrapper>
  );
}

/** Общая фабрика для создания InteractiveTable extension */
function makeInteractiveTable(readOnly = false) {
  return Node.create({
    name: 'interactiveTable',
    group: 'block',
    atom: true,
    draggable: false,
    selectable: true,

    addAttributes() {
      return {
        tableHtml: {
          default: '<table><tr><th></th><th></th></tr><tr><td></td><td></td></tr></table>',
          // parseHTML вызывается ниже через getAttrs в parseHTML()
          parseHTML: () => null,
          renderHTML: attributes => ({
            'data-table-html': encodeURIComponent(attributes.tableHtml || ''),
          }),
        },
      };
    },

    parseHTML() {
      return [
        // Новый формат: div с data-itable (сохранённые редактором)
        {
          tag: 'div[data-itable]',
          getAttrs: dom => ({
            tableHtml: decodeURIComponent(dom.getAttribute('data-table-html') || ''),
          }),
        },
        // Обратная совместимость: обычные <table> из старых страниц
        {
          tag: 'table',
          getAttrs: dom => ({
            tableHtml: dom.outerHTML,
          }),
        },
      ];
    },

    renderHTML({ HTMLAttributes }) {
      // Сериализуем как div[data-itable] с вложенным tableHtml в атрибуте
      return ['div', { 'data-itable': '1', ...HTMLAttributes }];
    },

    addNodeView() {
      return ReactNodeViewRenderer(readOnly ? InteractiveTableReadOnlyComponent : InteractiveTableComponent);
    },

    addCommands() {
      return {
        insertInteractiveTable: ({ rows = 3, cols = 3, header = true } = {}) => ({ commands }) => {
          const headerRow = header
            ? '<tr>' + Array.from({ length: cols }, () => '<th></th>').join('') + '</tr>'
            : '';
          const bodyRows = Array.from({ length: header ? rows - 1 : rows }, () =>
            '<tr>' + Array.from({ length: cols }, () => '<td></td>').join('') + '</tr>'
          ).join('');
          const tableHtml = `<table>${headerRow}${bodyRows}</table>`;
          return commands.insertContent({ type: 'interactiveTable', attrs: { tableHtml } });
        },
      };
    },
  });
}

export const InteractiveTable = makeInteractiveTable(false);
export const InteractiveTableReadOnly = makeInteractiveTable(true);
