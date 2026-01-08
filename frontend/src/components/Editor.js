import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import TiptapImage from '@tiptap/extension-image';
import { Node, mergeAttributes } from '@tiptap/core';
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
import { VkVideo, getVkVideoEmbedUrl } from './VkVideo';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Code, Minus, Undo, Redo,
  Link as LinkIcon, Image as ImageIcon, Table as TableIcon,
  Highlighter, Youtube as YoutubeIcon, Subscript as SubIcon,
  Superscript as SupIcon, Palette, ChevronDown, Plus, Trash2,
  Maximize2, Minimize2, Paintbrush, Grid, Video
} from 'lucide-react';
import { media, BASE_URL } from '../services/api';
import toast from 'react-hot-toast';
import './Editor.css';

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

// Улучшенное расширение изображений с правильным парсингом размеров
const ResizableImage = Node.create({
  name: 'resizableImage',
  group: 'block',
  draggable: true,
  
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { 
        default: null,
        parseHTML: element => {
          const width = element.getAttribute('width') || element.style.width;
          if (width) {
            return parseInt(width);
          }
          return null;
        }
      },
      height: { 
        default: null,
        parseHTML: element => {
          const height = element.getAttribute('height') || element.style.height;
          if (height) {
            return parseInt(height);
          }
          return null;
        }
      },
      display: { 
        default: 'inline',
        parseHTML: element => element.getAttribute('data-display') || 'inline'
      },
      float: { 
        default: 'none',
        parseHTML: element => element.getAttribute('data-float') || 'none'
      },
      align: { 
        default: 'left',
        parseHTML: element => element.getAttribute('data-align') || 'left'
      }
    };
  },

  parseHTML() {
    return [{
      tag: 'img[src]',
      getAttrs: dom => ({
        src: dom.getAttribute('src'),
        alt: dom.getAttribute('alt'),
        title: dom.getAttribute('title'),
        width: dom.getAttribute('width') ? parseInt(dom.getAttribute('width')) : null,
        height: dom.getAttribute('height') ? parseInt(dom.getAttribute('height')) : null,
        display: dom.getAttribute('data-display') || 'inline',
        float: dom.getAttribute('data-float') || 'none',
        align: dom.getAttribute('data-align') || 'left'
      })
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, {
      'data-display': HTMLAttributes.display,
      'data-float': HTMLAttributes.float,
      'data-align': HTMLAttributes.align
    })];
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

// Компонент для изменяемого изображения
const ResizableImageComponent = ({ node, updateAttributes, selected, editor }) => {
  const [resizing, setResizing] = useState(false);
  const [dimensions, setDimensions] = useState({
    width: node.attrs.width || null,
    height: node.attrs.height || null
  });
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const startRef = useRef({ x: 0, y: 0, width: 0, height: 0, aspectRatio: 1 });

  useEffect(() => {
    if (imgRef.current && imgRef.current.complete) {
      if (!node.attrs.width || !node.attrs.height) {
        startRef.current.aspectRatio = imgRef.current.naturalWidth / imgRef.current.naturalHeight;
      }
    }
  }, [node.attrs.src]);

  const handleMouseDown = (e, corner) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);

    const currentWidth = dimensions.width || imgRef.current?.offsetWidth || 0;
    const currentHeight = dimensions.height || imgRef.current?.offsetHeight || 0;
    
    startRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: currentWidth,
      height: currentHeight,
      aspectRatio: currentWidth / currentHeight
    };

    const handleMouseMove = (moveEvent) => {
      if (!containerRef.current) return;

      const deltaX = moveEvent.clientX - startRef.current.x;
      const deltaY = moveEvent.clientY - startRef.current.y;
      
      let newWidth;
      let newHeight;

      if (corner === 'se' || corner === 'ne') {
        newWidth = Math.max(100, startRef.current.width + deltaX);
      } else {
        newWidth = Math.max(100, startRef.current.width - deltaX);
      }

      newHeight = newWidth / startRef.current.aspectRatio;

      setDimensions({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setResizing(false);
      updateAttributes({ 
        width: Math.round(dimensions.width), 
        height: Math.round(dimensions.height) 
      });
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const display = node.attrs.display || 'inline';
  const float = node.attrs.float || 'none';
  const align = node.attrs.align || 'left';

  const containerStyle = {
    textAlign: display === 'block' ? align : undefined
  };

  const imgStyle = {
    width: dimensions.width ? `${dimensions.width}px` : undefined,
    height: dimensions.height ? `${dimensions.height}px` : undefined,
    float: display === 'inline' ? float : undefined,
    textAlign: display === 'block' ? align : undefined,
    width: display === 'block' ? '100%' : undefined
  };
  
  const wrapperStyle = display === 'block' ? {
    display: 'inline-block',
    margin: '0.5em 0'
  } : {
    margin: float === 'left' ? '0.5em 1em 0.5em 0' : 
            float === 'right' ? '0.5em 0 0.5em 1em' : undefined
  };

  return (
    <NodeViewWrapper style={containerStyle}>
      <div 
        ref={containerRef}
        className={`resizable-image-container ${selected ? 'selected' : ''} ${resizing ? 'resizing' : ''}`}
        style={wrapperStyle}
      >
        <img
          ref={imgRef}
          src={node.attrs.src}
          alt={node.attrs.alt || ''}
          title={node.attrs.title || ''}
          style={imgStyle}
        />
        {selected && (
          <>
            <div className="resize-handle nw" onMouseDown={(e) => handleMouseDown(e, 'nw')} />
            <div className="resize-handle ne" onMouseDown={(e) => handleMouseDown(e, 'ne')} />
            <div className="resize-handle sw" onMouseDown={(e) => handleMouseDown(e, 'sw')} />
            <div className="resize-handle se" onMouseDown={(e) => handleMouseDown(e, 'se')} />
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
};

// Меню настроек изображения (появляется при выделении)
function ImageBubbleMenu({ editor }) {
  if (!editor) return null;

  const attrs = editor.getAttributes('resizableImage');
  const display = attrs.display || 'inline';
  const float = attrs.float || 'none';
  const align = attrs.align || 'left';

  const setDisplay = (e, value) => {
    e.preventDefault();
    editor.chain().focus().updateImageAttributes({ display: value }).run();
  };

  const setFloat = (e, value) => {
    e.preventDefault();
    editor.chain().focus().updateImageAttributes({ float: value }).run();
  };

  const setAlign = (e, value) => {
    e.preventDefault();
    editor.chain().focus().updateImageAttributes({ align: value }).run();
  };

  const resetSize = (e) => {
    e.preventDefault();
    editor.chain().focus().updateImageAttributes({ width: null, height: null }).run();
  };

  return (
    <BubbleMenu 
      editor={editor} 
      tippyOptions={{ duration: 100, placement: 'top' }}
      shouldShow={({ editor }) => editor.isActive('resizableImage')}
    >
      <div className="image-bubble-menu">
        <div className="image-bubble-section">
          <span className="image-bubble-label">Режим:</span>
          <button 
            type="button"
            className={`image-bubble-btn ${display === 'inline' ? 'active' : ''}`}
            onClick={(e) => setDisplay(e, 'inline')}
            title="В тексте"
          >
            В тексте
          </button>
          <button 
            type="button"
            className={`image-bubble-btn ${display === 'block' ? 'active' : ''}`}
            onClick={(e) => setDisplay(e, 'block')}
            title="Отдельно"
          >
            Отдельно
          </button>
        </div>

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
              Слева
            </button>
            <button 
              type="button"
              className={`image-bubble-btn ${float === 'right' ? 'active' : ''}`}
              onClick={(e) => setFloat(e, 'right')}
              title="Справа"
            >
              Справа
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

        <div className="image-bubble-section">
          <button 
            type="button"
            className="image-bubble-btn"
            onClick={resetSize}
            title="Сбросить размер"
          >
            <Maximize2 size={14} />
          </button>
          <button 
            type="button"
            className="image-bubble-btn"
            onClick={(e) => {
              e.preventDefault();
              editor.chain().focus().deleteSelection().run();
            }}
            title="Удалить"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </BubbleMenu>
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
              <button
                type="button"
                className="table-menu-item"
                onClick={() => setShowSizeSelector(!showSizeSelector)}
              >
                <Grid size={14} /> Вставить таблицу
              </button>
              {showSizeSelector && (
                <TableSizeSelector onSelect={handleTableSizeSelect} />
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().addColumnBefore().run())}
              >
                <Plus size={14} /> Добавить столбец слева
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().addColumnAfter().run())}
              >
                <Plus size={14} /> Добавить столбец справа
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().deleteColumn().run())}
              >
                <Trash2 size={14} /> Удалить столбец
              </button>
              <div className="table-menu-divider" />
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().addRowBefore().run())}
              >
                <Plus size={14} /> Добавить строку сверху
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().addRowAfter().run())}
              >
                <Plus size={14} /> Добавить строку снизу
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().deleteRow().run())}
              >
                <Trash2 size={14} /> Удалить строку
              </button>
              <div className="table-menu-divider" />
              <button
                type="button"
                className="table-menu-item"
                onClick={() => setShowCellColors(!showCellColors)}
              >
                <Paintbrush size={14} /> Цвет фона ячейки
              </button>
              
              {showCellColors && (
                <div className="cell-colors-grid">
                  {cellBgColors.map(({ name, color }) => (
                    <button
                      key={color}
                      type="button"
                      className="cell-color-item"
                      style={{ 
                        background: color,
                        border: color === 'transparent' ? '1px solid var(--border)' : 'none' 
                      }}
                      onClick={() => setCellBgColor(color)}
                      title={name}
                    />
                  ))}
                </div>
              )}

              <div className="table-menu-divider" />
              <button
                type="button"
                className="table-menu-item danger"
                onClick={() => runCommand(() => editor.chain().focus().deleteTable().run())}
              >
                <Trash2 size={14} /> Удалить таблицу
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuBar({ editor }) {
  const tableButtonRef = useRef(null);
  const highlightButtonRef = useRef(null);
  const colorButtonRef = useRef(null);
  const imageInputRef = useRef(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const setLink = useCallback(() => {
    const url = window.prompt('URL:', editor.getAttributes('link').href || 'https://');
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
      editor.chain().focus().setImage({ src: imageUrl }).run();
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

  const addVkVideo = useCallback(() => {
    const url = window.prompt('VK Video URL:');
    if (!url) return;

    const embedUrl = getVkVideoEmbedUrl(url);
    if (!embedUrl) {
      toast.error('Неверный формат URL VK видео');
      return;
    }

    editor.commands.setVkVideo({ 
      src: embedUrl,
      width: 640,
      height: 360
    });
    toast.success('VK видео добавлено');
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
            editor.isActive('heading', { level: 3 }) ? '3' : 'p'
          }
        >
          <option value="p">Обычный текст</option>
          <option value="1">Заголовок 1</option>
          <option value="2">Заголовок 2</option>
          <option value="3">Заголовок 3</option>
        </select>
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
        <MenuButton onClick={() => editor.chain().focus().toggleBlockquote().run()} isActive={editor.isActive('blockquote')} title="Цитата">
          <Quote size={16} />
        </MenuButton>
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
        <MenuButton onClick={addVkVideo} title="VK видео">
          <Video size={16} />
        </MenuButton>
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
      StarterKit,
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
      VkVideo,
      Placeholder.configure({ placeholder })
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    }
  });

  return (
    <div className="editor-container">
      <MenuBar editor={editor} />
      <EditorContent editor={editor} className="editor-content" />
      <ImageBubbleMenu editor={editor} />
    </div>
  );
}