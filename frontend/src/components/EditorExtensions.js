// EditorExtensions.js - Кастомные расширения TipTap для Editor и ContentRenderer
import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { useState, useRef, useEffect } from 'react';
import Blockquote from '@tiptap/extension-blockquote';
import TipTapTableCell from '@tiptap/extension-table-cell';
import TiptapImage from '@tiptap/extension-image';

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
        parseHTML: element => element.getAttribute('data-background-color') || element.style.backgroundColor,
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
          src={node.attrs.src}
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
  }
});
