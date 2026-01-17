import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import TiptapImage from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TipTapTableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Placeholder from '@tiptap/extension-placeholder';
import Youtube from '@tiptap/extension-youtube';
import FontFamily from '@tiptap/extension-font-family';
import Blockquote from '@tiptap/extension-blockquote';
import EmojiPicker from 'emoji-picker-react';
import { LocalVideo } from './LocalVideo';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Code, Minus, Undo, Redo,
  Link as LinkIcon, Image as ImageIcon, Table as TableIcon,
  Highlighter, Youtube as YoutubeIcon, Subscript as SubIcon,
  Superscript as SupIcon, Palette, ChevronDown, Plus, Trash2,
  Maximize2, Minimize2, Paintbrush, Grid, Video, Smile, Type,
  AlertTriangle, AlertCircle
} from 'lucide-react';
import { media, BASE_URL } from '../services/api';
import toast from 'react-hot-toast';
import './Editor.css';

// Кастомное расширение Blockquote с типами
const CustomBlockquote = Blockquote.extend({
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
const TableCell = TipTapTableCell.extend({
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

// Улучшенное расширение изображений - используем стандартное расширение TipTap
const ResizableImage = TiptapImage.extend({
  name: 'resizableImage',

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
          return { 'data-display': attributes.display };
        }
      },
      float: {
        default: 'none',
        parseHTML: element => element.getAttribute('data-float') || 'none',
        renderHTML: attributes => {
          return { 'data-float': attributes.float };
        }
      },
      align: {
        default: 'left',
        parseHTML: element => element.getAttribute('data-align') || 'left',
        renderHTML: attributes => {
          return { 'data-align': attributes.align };
        }
      }
    };
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

// Кастомное всплывающее меню для изображений (без BubbleMenu)
function ImageBubbleMenu({ editor }) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedPos, setSelectedPos] = useState(null);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeMode, setResizeMode] = useState(null);
  const [currentSize, setCurrentSize] = useState({ width: 300, height: 200 });
  const menuRef = useRef(null);
  const isMountedRef = useRef(true);
  const resizeStartRef = useRef({ width: 0, height: 0, x: 0, y: 0, aspectRatio: 1 });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!editor) return;

    const updateImageMenu = () => {
      if (!isMountedRef.current || !editor || editor.isDestroyed) {
        setIsVisible(false);
        return;
      }

      try {
        const { state, view } = editor;
        const { selection } = state;
        const { $from } = selection;
        const node = $from.parent.type.name === 'resizableImage'
          ? $from.parent
          : state.doc.nodeAt(selection.from);

        if (node && node.type.name === 'resizableImage') {
          setSelectedNode(node);
          setSelectedPos(selection.from);

          // Обновляем currentSize только если НЕ происходит изменение размера
          // Это предотвращает сброс позиции ползунка после завершения resize
          if (!isResizing) {
            setCurrentSize({
              width: node.attrs.width || 300,
              height: node.attrs.height || 200
            });
          }

          // Получаем позицию выделенного изображения
          const { from } = selection;
          const start = view.coordsAtPos(from);
          const editorRect = view.dom.getBoundingClientRect();

          setPosition({
            top: start.top - editorRect.top - 50,
            left: start.left - editorRect.left
          });
          setIsVisible(true);
        } else {
          setIsVisible(false);
          setSelectedNode(null);
          setSelectedPos(null);
        }
      } catch (error) {
        // Игнорируем ошибки при работе с DOM
        setIsVisible(false);
      }
    };

    const handleTransaction = () => {
      if (isMountedRef.current && !isResizing) {
        updateImageMenu();
      }
    };

    editor.on('selectionUpdate', handleTransaction);
    editor.on('transaction', handleTransaction);

    return () => {
      if (editor && !editor.isDestroyed) {
        editor.off('selectionUpdate', handleTransaction);
        editor.off('transaction', handleTransaction);
      }
    };
  }, [editor, isResizing]);

  // Обработчик изменения размера
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e) => {
      if (!isMountedRef.current || !editor || editor.isDestroyed) return;

      const deltaX = e.clientX - resizeStartRef.current.x;
      const deltaY = e.clientY - resizeStartRef.current.y;

      let newWidth, newHeight;

      if (resizeMode === 'width') {
        newWidth = Math.max(50, resizeStartRef.current.width + deltaX * 2);
        newHeight = newWidth / resizeStartRef.current.aspectRatio;
      } else if (resizeMode === 'height') {
        newHeight = Math.max(50, resizeStartRef.current.height + deltaY * 2);
        newWidth = newHeight * resizeStartRef.current.aspectRatio;
      } else {
        // Пропорциональное изменение
        const scale = Math.max(50, resizeStartRef.current.width + deltaX * 2) / resizeStartRef.current.width;
        newWidth = resizeStartRef.current.width * scale;
        newHeight = resizeStartRef.current.height * scale;
      }

      const roundedWidth = Math.round(newWidth);
      const roundedHeight = Math.round(newHeight);

      // Обновляем состояние для отображения ползунка в реальном времени
      setCurrentSize({ width: roundedWidth, height: roundedHeight });

      if (selectedPos !== null) {
        editor.commands.setNodeSelection(selectedPos);
        editor.chain().focus().updateImageAttributes({
          width: roundedWidth,
          height: roundedHeight
        }).run();
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeMode(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeMode, editor, selectedPos]);

  if (!isVisible || !selectedNode || !editor || editor.isDestroyed) return null;

  const display = selectedNode.attrs.display || 'inline';
  const float = selectedNode.attrs.float || 'none';
  const align = selectedNode.attrs.align || 'left';

  const startResize = (e, mode) => {
    e.preventDefault();
    e.stopPropagation();

    // Получаем актуальные атрибуты из редактора, а не из selectedNode
    const { state } = editor;
    const { selection } = state;
    const { $from } = selection;
    const node = $from.parent.type.name === 'resizableImage'
      ? $from.parent
      : state.doc.nodeAt(selection.from);

    const currentWidth = node?.attrs.width || 300;
    const currentHeight = node?.attrs.height || 200;

    // Синхронизируем currentSize с актуальными атрибутами перед началом resize
    setCurrentSize({ width: currentWidth, height: currentHeight });

    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: currentWidth,
      height: currentHeight,
      aspectRatio: currentWidth / currentHeight
    };

    setResizeMode(mode);
    setIsResizing(true);
  };

  const setDisplay = (e, val) => {
    e.preventDefault();
    e.stopPropagation();
    if (editor && !editor.isDestroyed) {
      editor.chain().focus().updateImageAttributes({ display: val }).run();
    }
  };

  const setFloat = (e, val) => {
    e.preventDefault();
    e.stopPropagation();
    if (editor && !editor.isDestroyed) {
      editor.chain().focus().updateImageAttributes({ float: val }).run();
    }
  };

  const setAlign = (e, val) => {
    e.preventDefault();
    e.stopPropagation();
    if (editor && !editor.isDestroyed) {
      editor.chain().focus().updateImageAttributes({ align: val }).run();
    }
  };

  const resetSize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (editor && !editor.isDestroyed) {
      editor.chain().focus().updateImageAttributes({ width: null, height: null }).run();
    }
  };

  const deleteImage = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (editor && !editor.isDestroyed) {
      editor.chain().focus().deleteSelection().run();
    }
  };

  const getThumbPosition = () => {
    // Определяем диапазон размеров: от 50px (минимум) до 1000px (максимум)
    const minSize = 50;
    const maxSize = 1000;

    // Всегда используем currentSize, он обновляется и во время resize и при выборе изображения
    const currentWidth = currentSize.width;

    // Ограничиваем текущую ширину в пределах диапазона
    const clampedWidth = Math.max(minSize, Math.min(maxSize, currentWidth));

    // Вычисляем позицию в процентах (от 0 до 100)
    const position = ((clampedWidth - minSize) / (maxSize - minSize)) * 100;

    return position;
  };

  return (
    <div
      ref={menuRef}
      className="image-bubble-menu"
      style={{
        position: 'absolute',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 1000
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="image-bubble-section">
        <span className="image-bubble-label">Режим:</span>
        <button
          type="button"
          className={`image-bubble-btn ${display === 'inline' ? 'active' : ''}`}
          onClick={(e) => setDisplay(e, 'inline')}
          title="В строке"
        >
          Строка
        </button>
        <button
          type="button"
          className={`image-bubble-btn ${display === 'block' ? 'active' : ''}`}
          onClick={(e) => setDisplay(e, 'block')}
          title="Блок"
        >
          Блок
        </button>
      </div>

      <div className="image-bubble-divider" />

      {display === 'inline' && (
        <div className="image-bubble-section">
          <span className="image-bubble-label">Обтекание:</span>
          <button
            type="button"
            className={`image-bubble-btn ${float === 'none' ? 'active' : ''}`}
            onClick={(e) => setFloat(e, 'none')}
            title="Нет"
          >
            Нет
          </button>
          <button
            type="button"
            className={`image-bubble-btn ${float === 'left' ? 'active' : ''}`}
            onClick={(e) => setFloat(e, 'left')}
            title="Слева"
          >
            <AlignLeft size={14} />
          </button>
          <button
            type="button"
            className={`image-bubble-btn ${float === 'right' ? 'active' : ''}`}
            onClick={(e) => setFloat(e, 'right')}
            title="Справа"
          >
            <AlignRight size={14} />
          </button>
        </div>
      )}

      {display === 'block' && (
        <div className="image-bubble-section">
          <span className="image-bubble-label">Выравнивание:</span>
          <button
            type="button"
            className={`image-bubble-btn ${align === 'left' ? 'active' : ''}`}
            onClick={(e) => setAlign(e, 'left')}
            title="Слева"
          >
            <AlignLeft size={14} />
          </button>
          <button
            type="button"
            className={`image-bubble-btn ${align === 'center' ? 'active' : ''}`}
            onClick={(e) => setAlign(e, 'center')}
            title="По центру"
          >
            <AlignCenter size={14} />
          </button>
          <button
            type="button"
            className={`image-bubble-btn ${align === 'right' ? 'active' : ''}`}
            onClick={(e) => setAlign(e, 'right')}
            title="Справа"
          >
            <AlignRight size={14} />
          </button>
        </div>
      )}

      <div className="image-bubble-divider" />

      <div className="image-bubble-section image-resize-section">
        <span className="image-bubble-label">Размер:</span>
        <div
          className={`image-resize-slider ${isResizing ? 'active' : ''}`}
          onMouseDown={(e) => startResize(e, 'both')}
          title="Перетащите для изменения размера"
        >
          <div className="resize-slider-track" />
          <div
            className="resize-slider-thumb"
            style={{
              left: `${getThumbPosition()}%`
            }}
          />
        </div>
        <button
          type="button"
          className="image-bubble-btn"
          onClick={resetSize}
          title="Сбросить размер"
        >
          <Maximize2 size={14} />
        </button>
      </div>

      <div className="image-bubble-divider" />

      <div className="image-bubble-section">
        <button
          type="button"
          className="image-bubble-btn"
          onClick={deleteImage}
          title="Удалить"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// Вспомогательные компоненты
const MenuButton = ({ onClick, isActive, disabled, children, title }) => (
  <button
    type="button"
    className={`editor-btn ${isActive ? 'active' : ''}`}
    onClick={onClick}
    disabled={disabled}
    title={title}
  >
    {children}
  </button>
);

const MenuDivider = () => <div className="editor-divider" />;

// Расширенная палитра цветов выделения - 20 цветов
const highlightColors = [
  { name: 'Желтый', color: '#FFEB3B' },
  { name: 'Желтый яркий', color: '#FFFF00' },
  { name: 'Лайм', color: '#CDDC39' },
  { name: 'Зеленый', color: '#A5D6A7' },
  { name: 'Зеленый яркий', color: '#4CAF50' },
  { name: 'Мятный', color: '#80CBC4' },
  { name: 'Голубой', color: '#81D4FA' },
  { name: 'Синий светлый', color: '#90CAF9' },
  { name: 'Розовый', color: '#F48FB1' },
  { name: 'Розовый яркий', color: '#FF80AB' },
  { name: 'Оранжевый', color: '#FFCC80' },
  { name: 'Оранжевый яркий', color: '#FF9800' },
  { name: 'Персиковый', color: '#FFCCBC' },
  { name: 'Фиолетовый', color: '#CE93D8' },
  { name: 'Фиолетовый яркий', color: '#AB47BC' },
  { name: 'Красный', color: '#EF9A9A' },
  { name: 'Серый', color: '#E0E0E0' },
  { name: 'Бирюзовый', color: '#80DEEA' },
  { name: 'Коралловый', color: '#FFAB91' },
  { name: 'Лавандовый', color: '#E1BEE7' }
];

// Расширенная палитра цветов текста - 20 цветов
const textColors = [
  { name: 'Черный', color: '#000000' },
  { name: 'Темно-серый', color: '#424242' },
  { name: 'Серый', color: '#666666' },
  { name: 'Светло-серый', color: '#9E9E9E' },
  { name: 'Красный', color: '#E53935' },
  { name: 'Красный темный', color: '#C62828' },
  { name: 'Оранжевый', color: '#FB8C00' },
  { name: 'Оранжевый темный', color: '#EF6C00' },
  { name: 'Желтый', color: '#FDD835' },
  { name: 'Желто-зеленый', color: '#C0CA33' },
  { name: 'Зеленый', color: '#43A047' },
  { name: 'Зеленый темный', color: '#2E7D32' },
  { name: 'Бирюзовый', color: '#00ACC1' },
  { name: 'Голубой', color: '#039BE5' },
  { name: 'Синий', color: '#1E88E5' },
  { name: 'Синий темный', color: '#1565C0' },
  { name: 'Фиолетовый', color: '#8E24AA' },
  { name: 'Фиолетовый темный', color: '#6A1B9A' },
  { name: 'Розовый', color: '#D81B60' },
  { name: 'Коричневый', color: '#6D4C41' }
];

// Цвета для фона ячеек таблицы
const cellBgColors = [
  { name: 'Без цвета', color: 'transparent' },
  { name: 'Светло-серый', color: '#F5F5F5' },
  { name: 'Светло-голубой', color: '#E3F2FD' },
  { name: 'Светло-зеленый', color: '#E8F5E9' },
  { name: 'Светло-желтый', color: '#FFFDE7' },
  { name: 'Светло-оранжевый', color: '#FFF3E0' },
  { name: 'Светло-красный', color: '#FFEBEE' },
  { name: 'Светло-розовый', color: '#FCE4EC' },
  { name: 'Светло-фиолетовый', color: '#F3E5F5' },
  { name: 'Светло-бирюзовый', color: '#E0F2F1' }
];

// Доступные шрифты
const availableFonts = [
  { name: 'По умолчанию', value: '' },
  { name: 'Arial', value: 'Arial, sans-serif' },
  { name: 'Times New Roman', value: 'Times New Roman, serif' },
  { name: 'Courier New', value: 'Courier New, monospace' },
  { name: 'Georgia', value: 'Georgia, serif' },
  { name: 'Verdana', value: 'Verdana, sans-serif' },
  { name: 'Comic Sans MS', value: 'Comic Sans MS, cursive' },
  { name: 'Impact', value: 'Impact, fantasy' },
  { name: 'Trebuchet MS', value: 'Trebuchet MS, sans-serif' }
];

// Типы цитат
const blockquoteTypes = [
  { name: 'Цитата', value: 'default', icon: Quote, color: '#6B7280' },
  { name: 'Предупреждение', value: 'warning', icon: AlertTriangle, color: '#F59E0B' },
  { name: 'Опасность', value: 'danger', icon: AlertCircle, color: '#EF4444' }
];

function ColorDropdown({ editor, type, buttonRef, icon: Icon, title, colors }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && 
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [buttonRef]);

  const openMenu = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 240;
      const viewportWidth = window.innerWidth;
      
      let left = rect.left;
      if (rect.left + menuWidth > viewportWidth - 20) {
        left = viewportWidth - menuWidth - 20;
      }
      
      setPosition({
        top: rect.bottom + 4,
        left: left
      });
    }
    setIsOpen(!isOpen);
  };

  const applyColor = (color) => {
    if (type === 'highlight') {
      editor.chain().focus().toggleHighlight({ color }).run();
    } else {
      editor.chain().focus().setColor(color).run();
    }
    setIsOpen(false);
  };

  const clearColor = () => {
    if (type === 'highlight') {
      editor.chain().focus().unsetHighlight().run();
    } else {
      editor.chain().focus().unsetColor().run();
    }
    setIsOpen(false);
  };

  const isActive = type === 'highlight' ? editor.isActive('highlight') : false;

  return (
    <div className="editor-dropdown-wrapper">
      <button
        type="button"
        ref={buttonRef}
        className={`editor-btn ${isActive ? 'active' : ''}`}
        onClick={openMenu}
        title={title}
      >
        <Icon size={16} />
        <ChevronDown size={10} />
      </button>

      {isOpen && (
        <div 
          ref={menuRef}
          className="color-picker-dropdown"
          style={{ 
            position: 'fixed',
            top: position.top,
            left: position.left
          }}
        >
          <div className="color-picker-title">
            {type === 'highlight' ? 'Цвет выделения' : 'Цвет текста'}
          </div>
          <div className="color-picker-grid">
            {colors.map(({ name, color }) => (
              <button
                key={color}
                type="button"
                className="color-picker-item"
                style={{ background: color }}
                onClick={() => applyColor(color)}
                title={name}
              />
            ))}
          </div>
          <button
            type="button"
            className="color-picker-clear"
            onClick={clearColor}
          >
            Убрать {type === 'highlight' ? 'выделение' : 'цвет'}
          </button>
        </div>
      )}
    </div>
  );
}

// Dropdown для выбора типа цитаты
function BlockquoteDropdown({ editor, buttonRef }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && 
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [buttonRef]);

  const openMenu = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 220;
      const viewportWidth = window.innerWidth;
      
      let left = rect.left;
      if (rect.left + menuWidth > viewportWidth - 20) {
        left = viewportWidth - menuWidth - 20;
      }
      
      setPosition({
        top: rect.bottom + 4,
        left: left
      });
    }
    setIsOpen(!isOpen);
  };

  const setBlockquoteType = (type) => {
    if (editor.isActive('blockquote')) {
      editor.chain().focus().updateAttributes('blockquote', { type }).run();
    } else {
      editor.chain().focus().toggleBlockquote().updateAttributes('blockquote', { type }).run();
    }
    setIsOpen(false);
  };

  const getCurrentType = () => {
    if (!editor.isActive('blockquote')) return null;
    const attrs = editor.getAttributes('blockquote');
    return attrs.type || 'default';
  };

  const currentType = getCurrentType();
  const isActive = editor.isActive('blockquote');

  return (
    <div className="editor-dropdown-wrapper">
      <button
        type="button"
        ref={buttonRef}
        className={`editor-btn ${isActive ? 'active' : ''}`}
        onClick={openMenu}
        title="Блок цитаты"
      >
        <Quote size={16} />
        <ChevronDown size={10} />
      </button>

      {isOpen && (
        <div 
          ref={menuRef}
          className="blockquote-picker-dropdown"
          style={{ 
            position: 'fixed',
            top: position.top,
            left: position.left
          }}
        >
          <div className="blockquote-picker-title">Выбор типа блока</div>
          <div className="blockquote-picker-list">
            {blockquoteTypes.map(({ name, value, icon: Icon, color }) => (
              <button
                key={value}
                type="button"
                className={`blockquote-picker-item ${currentType === value ? 'active' : ''}`}
                onClick={() => setBlockquoteType(value)}
              >
                <Icon size={16} style={{ color }} />
                <span>{name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Dropdown для выбора шрифта
function FontFamilyDropdown({ editor, buttonRef }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && 
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [buttonRef]);

  const openMenu = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 200;
      const viewportWidth = window.innerWidth;
      
      let left = rect.left;
      if (rect.left + menuWidth > viewportWidth - 20) {
        left = viewportWidth - menuWidth - 20;
      }
      
      setPosition({
        top: rect.bottom + 4,
        left: left
      });
    }
    setIsOpen(!isOpen);
  };

  const setFont = (fontValue) => {
    if (fontValue === '') {
      editor.chain().focus().unsetFontFamily().run();
    } else {
      editor.chain().focus().setFontFamily(fontValue).run();
    }
    setIsOpen(false);
  };

  return (
    <div className="editor-dropdown-wrapper">
      <button
        type="button"
        ref={buttonRef}
        className="editor-btn"
        onClick={openMenu}
        title="Шрифт"
      >
        <Type size={16} />
        <ChevronDown size={10} />
      </button>

      {isOpen && (
        <div 
          ref={menuRef}
          className="font-picker-dropdown"
          style={{ 
            position: 'fixed',
            top: position.top,
            left: position.left
          }}
        >
          <div className="font-picker-title">Выбор шрифта</div>
          <div className="font-picker-list">
            {availableFonts.map(({ name, value }) => (
              <button
                key={value || 'default'}
                type="button"
                className={`font-picker-item ${editor.isActive('textStyle', { fontFamily: value }) ? 'active' : ''}`}
                onClick={() => setFont(value)}
                style={{ fontFamily: value || 'inherit' }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Dropdown для выбора эмодзи
function EmojiDropdown({ editor, buttonRef }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && 
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [buttonRef]);

  const openMenu = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 352;
      const viewportWidth = window.innerWidth;
      
      let left = rect.left;
      if (rect.left + menuWidth > viewportWidth - 20) {
        left = viewportWidth - menuWidth - 20;
      }
      
      setPosition({
        top: rect.bottom + 4,
        left: left
      });
    }
    setIsOpen(!isOpen);
  };

  const onEmojiClick = (emojiData) => {
    editor.chain().focus().insertContent(emojiData.emoji).run();
    setIsOpen(false);
  };

  return (
    <div className="editor-dropdown-wrapper">
      <button
        type="button"
        ref={buttonRef}
        className="editor-btn"
        onClick={openMenu}
        title="Эмодзи"
      >
        <Smile size={16} />
      </button>

      {isOpen && (
        <div 
          ref={menuRef}
          className="emoji-picker-dropdown"
          style={{ 
            position: 'fixed',
            top: position.top,
            left: position.left,
            zIndex: 1000
          }}
        >
          <EmojiPicker 
            onEmojiClick={onEmojiClick}
            width={350}
            height={400}
            searchPlaceholder="Поиск эмодзи..."
            previewConfig={{ showPreview: false }}
          />
        </div>
      )}
    </div>
  );
}

function TableSizeSelector({ onSelect }) {
  const maxRows = 10;
  const maxCols = 10;
  const [hover, setHover] = useState({ rows: 0, cols: 0 });

  const handleCellHover = (rowIndex, colIndex) => {
    setHover({ rows: rowIndex + 1, cols: colIndex + 1 });
  };

  const handleCellClick = (rowIndex, colIndex) => {
    onSelect(rowIndex + 1, colIndex + 1);
  };

  return (
    <div className="table-size-selector">
      <div className="table-size-title">
        {hover.rows > 0 && hover.cols > 0 
          ? `Таблица ${hover.rows} × ${hover.cols}` 
          : 'Выберите размер таблицы'}
      </div>
      <div className="table-size-grid">
        {Array.from({ length: maxRows }).map((_, rowIndex) => (
          <div key={rowIndex} className="table-size-row">
            {Array.from({ length: maxCols }).map((_, colIndex) => (
              <div
                key={colIndex}
                className={`table-size-cell ${
                  rowIndex < hover.rows && colIndex < hover.cols ? 'active' : ''
                }`}
                onMouseEnter={() => handleCellHover(rowIndex, colIndex)}
                onClick={() => handleCellClick(rowIndex, colIndex)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TableMenuDropdown({ editor, buttonRef }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [showCellColors, setShowCellColors] = useState(false);
  const [showSizeSelector, setShowSizeSelector] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && 
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setIsOpen(false);
        setShowCellColors(false);
        setShowSizeSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [buttonRef]);

  const openMenu = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 240;
      const viewportWidth = window.innerWidth;
      
      let left = rect.left;
      if (rect.left + menuWidth > viewportWidth - 20) {
        left = viewportWidth - menuWidth - 20;
      }
      
      setPosition({
        top: rect.bottom + 4,
        left: left
      });
    }
    setIsOpen(!isOpen);
    setShowCellColors(false);
    setShowSizeSelector(false);
  };

  const runCommand = (command) => {
    command();
    setIsOpen(false);
    setShowCellColors(false);
    setShowSizeSelector(false);
  };

  const handleTableSizeSelect = (rows, cols) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    setIsOpen(false);
    setShowSizeSelector(false);
  };

  const setCellBgColor = (color) => {
    if (color === 'transparent') {
      editor.chain().focus().setCellAttribute('backgroundColor', null).run();
    } else {
      editor.chain().focus().setCellAttribute('backgroundColor', color).run();
    }
    setShowCellColors(false);
  };

  if (!editor) return null;

  const isInTable = editor.isActive('table');

  return (
    <div className="editor-dropdown-wrapper">
      <button
        type="button"
        ref={buttonRef}
        className={`editor-btn ${isInTable ? 'active' : ''}`}
        onClick={openMenu}
        title="Таблица"
      >
        <TableIcon size={16} />
        <ChevronDown size={10} />
      </button>

      {isOpen && (
        <div 
          ref={menuRef}
          className="table-menu-dropdown"
          style={{ 
            position: 'fixed',
            top: position.top,
            left: position.left
          }}
        >
          {!isInTable ? (
            <>
              <div className="table-menu-title">Создать таблицу</div>
              {!showSizeSelector && (
                <button
                  type="button"
                  className="table-menu-item"
                  onClick={() => setShowSizeSelector(true)}
                >
                  <Grid size={16} />
                  Выбрать размер
                </button>
              )}
              {showSizeSelector && (
                <TableSizeSelector onSelect={handleTableSizeSelect} />
              )}
            </>
          ) : (
            <>
              <div className="table-menu-title">Редактировать таблицу</div>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().addColumnBefore().run())}
              >
                <Plus size={16} />
                Колонку слева
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().addColumnAfter().run())}
              >
                <Plus size={16} />
                Колонку справа
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().deleteColumn().run())}
              >
                <Trash2 size={16} />
                Удалить колонку
              </button>
              <div className="table-menu-divider" />
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().addRowBefore().run())}
              >
                <Plus size={16} />
                Строку выше
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().addRowAfter().run())}
              >
                <Plus size={16} />
                Строку ниже
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().deleteRow().run())}
              >
                <Trash2 size={16} />
                Удалить строку
              </button>
              <div className="table-menu-divider" />
              <button
                type="button"
                className="table-menu-item"
                onClick={() => setShowCellColors(!showCellColors)}
              >
                <Paintbrush size={16} />
                Цвет ячейки
              </button>
              {showCellColors && (
                <div className="cell-color-grid">
                  {cellBgColors.map(({ name, color }) => (
                    <button
                      key={color}
                      type="button"
                      className="cell-color-item"
                      style={{ background: color, border: color === 'transparent' ? '2px dashed #ccc' : 'none' }}
                      onClick={() => setCellBgColor(color)}
                      title={name}
                    />
                  ))}
                </div>
              )}
              <div className="table-menu-divider" />
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().deleteTable().run())}
              >
                <Trash2 size={16} />
                Удалить таблицу
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuBar({ editor }) {
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const highlightButtonRef = useRef(null);
  const colorButtonRef = useRef(null);
  const tableButtonRef = useRef(null);
  const fontFamilyButtonRef = useRef(null);
  const emojiButtonRef = useRef(null);
  const blockquoteButtonRef = useRef(null);

  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL:', previousUrl);

    if (url === null) return;

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const addImage = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handleImageUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Выберите изображение');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Максимальный размер изображения 10MB');
      return;
    }

    setUploadingImage(true);
    try {
      const { data } = await media.upload(file);
      const imageUrl = `${BASE_URL}/${data.path}`;

      // Используем setTimeout для отложенной вставки после завершения загрузки
      setTimeout(() => {
        if (editor && !editor.isDestroyed) {
          editor.chain().focus().setImage({ src: imageUrl }).run();
        }
      }, 0);

      toast.success('Изображение загружено');
    } catch (e) {
      toast.error('Ошибка загрузки изображения');
      console.error(e);
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) {
        imageInputRef.current.value = '';
      }
    }
  }, [editor]);

  const addYoutube = useCallback(() => {
    const url = window.prompt('YouTube URL:');
    if (url) {
      editor.commands.setYoutubeVideo({ src: url });
    }
  }, [editor]);

  const addLocalVideo = useCallback(() => {
    videoInputRef.current?.click();
  }, []);

  const handleVideoUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      toast.error('Выберите видео файл');
      return;
    }

    const maxSize = 200 * 1024 * 1024; // 200MB
    if (file.size > maxSize) {
      toast.error('Максимальный размер видео 200MB');
      return;
    }

    setUploadingVideo(true);
    try {
      const { data } = await media.upload(file);
      const videoUrl = `${BASE_URL}/${data.path}`;

      // Используем setTimeout для отложенной вставки после завершения загрузки
      setTimeout(() => {
        if (editor && !editor.isDestroyed) {
          editor.chain().focus().setLocalVideo({
            src: videoUrl
          }).run();
        }
      }, 0);

      toast.success('Видео загружено');
    } catch (e) {
      toast.error('Ошибка загрузки видео');
      console.error(e);
    } finally {
      setUploadingVideo(false);
      if (videoInputRef.current) {
        videoInputRef.current.value = '';
      }
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="editor-menu">
      <div className="editor-menu-group">
        <select
          className="editor-select"
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'p') editor.chain().focus().setParagraph().run();
            else editor.chain().focus().toggleHeading({ level: parseInt(val) }).run();
          }}
          value={
            editor.isActive('heading', { level: 1 }) ? '1' :
            editor.isActive('heading', { level: 2 }) ? '2' :
            editor.isActive('heading', { level: 3 }) ? '3' :
            editor.isActive('heading', { level: 4 }) ? '4' :
            editor.isActive('heading', { level: 5 }) ? '5' :
            editor.isActive('heading', { level: 6 }) ? '6' : 'p'
          }
        >
          <option value="p">Обычный текст</option>
          <option value="1">Заголовок 1</option>
          <option value="2">Заголовок 2</option>
          <option value="3">Заголовок 3</option>
          <option value="4">Заголовок 4</option>
          <option value="5">Заголовок 5</option>
          <option value="6">Заголовок 6</option>
        </select>
      </div>

      <div className="editor-menu-group">
        <FontFamilyDropdown editor={editor} buttonRef={fontFamilyButtonRef} />
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <MenuButton onClick={() => editor.chain().focus().toggleBold().run()} isActive={editor.isActive('bold')} title="Жирный">
          <Bold size={16} />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editor.isActive('italic')} title="Курсив">
          <Italic size={16} />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editor.isActive('underline')} title="Подчеркнутый">
          <UnderlineIcon size={16} />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleStrike().run()} isActive={editor.isActive('strike')} title="Зачеркнутый">
          <Strikethrough size={16} />
        </MenuButton>
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <ColorDropdown 
          editor={editor} 
          type="highlight" 
          buttonRef={highlightButtonRef}
          icon={Highlighter}
          title="Цвет выделения"
          colors={highlightColors}
        />
        <ColorDropdown 
          editor={editor} 
          type="color" 
          buttonRef={colorButtonRef}
          icon={Palette}
          title="Цвет текста"
          colors={textColors}
        />
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <MenuButton onClick={() => editor.chain().focus().setTextAlign('left').run()} isActive={editor.isActive({ textAlign: 'left' })} title="По левому краю">
          <AlignLeft size={16} />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().setTextAlign('center').run()} isActive={editor.isActive({ textAlign: 'center' })} title="По центру">
          <AlignCenter size={16} />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().setTextAlign('right').run()} isActive={editor.isActive({ textAlign: 'right' })} title="По правому краю">
          <AlignRight size={16} />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().setTextAlign('justify').run()} isActive={editor.isActive({ textAlign: 'justify' })} title="По ширине">
          <AlignJustify size={16} />
        </MenuButton>
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <MenuButton onClick={() => editor.chain().focus().toggleBulletList().run()} isActive={editor.isActive('bulletList')} title="Маркированный список">
          <List size={16} />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleOrderedList().run()} isActive={editor.isActive('orderedList')} title="Нумерованный список">
          <ListOrdered size={16} />
        </MenuButton>
        <BlockquoteDropdown editor={editor} buttonRef={blockquoteButtonRef} />
        <MenuButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} isActive={editor.isActive('codeBlock')} title="Код">
          <Code size={16} />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Разделитель">
          <Minus size={16} />
        </MenuButton>
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <MenuButton onClick={() => editor.chain().focus().toggleSubscript().run()} isActive={editor.isActive('subscript')} title="Подстрочный">
          <SubIcon size={16} />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleSuperscript().run()} isActive={editor.isActive('superscript')} title="Надстрочный">
          <SupIcon size={16} />
        </MenuButton>
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <EmojiDropdown editor={editor} buttonRef={emojiButtonRef} />
        <MenuButton onClick={setLink} isActive={editor.isActive('link')} title="Ссылка">
          <LinkIcon size={16} />
        </MenuButton>
        <MenuButton onClick={addImage} disabled={uploadingImage} title={uploadingImage ? "Загрузка..." : "Изображение"}>
          {uploadingImage ? <div className="loading-spinner-small" /> : <ImageIcon size={16} />}
        </MenuButton>
        <input 
          ref={imageInputRef} 
          type="file" 
          accept="image/*" 
          hidden 
          onChange={handleImageUpload} 
        />
        <MenuButton onClick={addYoutube} title="YouTube видео">
          <YoutubeIcon size={16} />
        </MenuButton>
        <MenuButton onClick={addLocalVideo} disabled={uploadingVideo} title={uploadingVideo ? "Загрузка видео..." : "Загрузить видео"}>
          {uploadingVideo ? <div className="loading-spinner-small" /> : <Video size={16} />}
        </MenuButton>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/ogg"
          hidden
          onChange={handleVideoUpload}
        />
        <TableMenuDropdown editor={editor} buttonRef={tableButtonRef} />
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <MenuButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Отменить">
          <Undo size={16} />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Повторить">
          <Redo size={16} />
        </MenuButton>
      </div>
    </div>
  );
}

export default function Editor({ content, onChange, placeholder = 'Начните писать...' }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false, // Отключаем стандартный blockquote
      }),
      CustomBlockquote, // Используем кастомный blockquote
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false }),
      ResizableImage,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TextStyle,
      Color,
      Subscript,
      Superscript,
      FontFamily,
      Youtube.configure({ width: 640, height: 360 }),
      LocalVideo,
      Placeholder.configure({ placeholder })
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    }
  });

  // Очистка редактора при размонтировании компонента
  useEffect(() => {
    return () => {
      if (editor) {
        editor.destroy();
      }
    };
  }, [editor]);

  return (
    <div className="editor-container">
      <MenuBar editor={editor} />
      <div style={{ position: 'relative' }}>
        <EditorContent editor={editor} className="editor-content" />
        {editor && <ImageBubbleMenu editor={editor} />}
      </div>
    </div>
  );
}