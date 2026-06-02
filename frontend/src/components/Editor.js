import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Placeholder from '@tiptap/extension-placeholder';
import Youtube from '@tiptap/extension-youtube';
import FontFamily from '@tiptap/extension-font-family';
import EmojiPicker from 'emoji-picker-react';
import { LocalVideo } from './LocalVideo';
import { CustomBlockquote, ResizableImage, InteractiveTable } from './EditorExtensions';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Code, Minus, Undo, Redo,
  Link as LinkIcon, Image as ImageIcon, Table as TableIcon,
  Highlighter, Youtube as YoutubeIcon, Subscript as SubIcon,
  Superscript as SupIcon, Palette, ChevronDown, Plus, Trash2,
  Maximize2, Minimize2, Paintbrush, Grid, Video, Smile, Type,
  AlertTriangle, AlertCircle, LayoutGrid
} from 'lucide-react';
import { media, BASE_URL } from '../services/api';
import toast from 'react-hot-toast';
import './Editor.css';

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const getStructuralPasteHtml = (text) => {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const nonEmptyLines = lines.map(line => line.trim()).filter(Boolean);

  if (nonEmptyLines.length < 2) {
    return null;
  }

  const bulletPattern = /^\s*[-*•]\s+/;
  const orderedPattern = /^\s*\d+[\.)]\s+/;
  const allBullets = nonEmptyLines.every(line => bulletPattern.test(line));
  const allOrdered = nonEmptyLines.every(line => orderedPattern.test(line));

  if (allBullets || allOrdered) {
    const tag = allOrdered ? 'ol' : 'ul';
    const markerPattern = allOrdered ? orderedPattern : bulletPattern;
    const items = nonEmptyLines
      .map(line => `<li><p>${escapeHtml(line.replace(markerPattern, '').trim())}</p></li>`)
      .join('');

    return `<${tag}>${items}</${tag}>`;
  }

  return lines
    .map(line => line.trim()
      ? `<p>${escapeHtml(line.trim())}</p>`
      : '<p></p>'
    )
    .join('');
};

// Расширение для обработки вставки изображений
const ImagePasteHandler = Extension.create({
  name: 'imagePasteHandler',

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey('imagePasteHandler'),
        props: {
          handlePaste(view, event) {
            console.log('=== ProseMirror handlePaste called ===');
            const items = Array.from(event.clipboardData?.items || []);
            console.log('Clipboard items:', items.map(i => i.type));

            // Сначала проверяем прямые файлы изображений
            for (const item of items) {
              if (item.type.startsWith('image/')) {
                console.log('Image file found in clipboard');
                event.preventDefault();

                const file = item.getAsFile();
                if (!file) {
                  console.log('No file from imageItem');
                  return true;
                }

                console.log('Image file:', file.name, file.size, file.type);

                if (file.size > 10 * 1024 * 1024) {
                  toast.error('Максимальный размер изображения 10MB');
                  return true;
                }

                toast.promise(
                  media.upload(file).then(({ data }) => {
                    const imageUrl = `${BASE_URL}/${data.path}`;
                    console.log('Image uploaded, URL:', imageUrl);
                    const { schema, tr } = view.state;
                    const node = schema.nodes.image.create({ src: imageUrl });
                    const transaction = tr.replaceSelectionWith(node);
                    view.dispatch(transaction);
                    console.log('Image node inserted');
                  }),
                  {
                    loading: 'Загрузка изображения...',
                    success: 'Изображение загружено',
                    error: 'Ошибка загрузки изображения',
                  }
                );

                return true;
              }
            }

            // Проверяем HTML на наличие base64 изображений
            const hasHtmlItem = items.some(item => item.type === 'text/html');
            if (hasHtmlItem) {
              // Читаем HTML синхронно, чтобы проверить до блокировки вставки
              const html = event.clipboardData.getData('text/html');
              console.log('HTML item found, checking for base64 images');

              const parser = new DOMParser();
              const doc = parser.parseFromString(html, 'text/html');
              const base64Images = doc.querySelectorAll('img[src^="data:image"]');

              if (base64Images.length === 0) {
                // Нет base64 изображений — ниже дадим шанс обработчику plain text
                // сохранить многострочную структуру, иначе TipTap обработает вставку сам.
                console.log('No base64 images, checking text structure');
              } else {
                // Есть base64 изображения — блокируем стандартную вставку и загружаем их
                event.preventDefault();
                console.log(`Found ${base64Images.length} base64 images, uploading to server`);

                base64Images.forEach((img) => {
                  const base64Data = img.src;
                  console.log('Processing base64 image, length:', base64Data.length);

                  // Конвертируем base64 в Blob
                  fetch(base64Data)
                    .then(res => res.blob())
                    .then(blob => {
                      console.log('Blob created, size:', blob.size);

                      if (blob.size > 10 * 1024 * 1024) {
                        toast.error('Максимальный размер изображения 10MB');
                        return;
                      }

                      // Создаем File из Blob
                      const file = new File([blob], 'pasted-image.png', { type: blob.type });

                      // Загружаем на сервер
                      toast.promise(
                        media.upload(file).then(({ data }) => {
                          const imageUrl = `${BASE_URL}/${data.path}`;
                          console.log('Base64 image uploaded, URL:', imageUrl);
                          const { schema, tr } = view.state;
                          const node = schema.nodes.image.create({ src: imageUrl });
                          const transaction = tr.replaceSelectionWith(node);
                          view.dispatch(transaction);
                        }),
                        {
                          loading: 'Загрузка изображения...',
                          success: 'Изображение загружено',
                          error: 'Ошибка загрузки изображения',
                        }
                      );
                    })
                    .catch(error => {
                      console.error('Error processing base64 image:', error);
                    });
                });

                return true;
              }
            }

            const text = event.clipboardData?.getData('text/plain') || '';
            const html = event.clipboardData?.getData('text/html') || '';
            const hasStructuralHtml = /<\/?(p|div|br|ul|ol|li|table|tr|td|th|h[1-6]|blockquote|pre)\b/i.test(html);
            const structuralTextHtml = getStructuralPasteHtml(text);

            if (structuralTextHtml && (!html || !hasStructuralHtml)) {
              event.preventDefault();
              editor.chain().focus().insertContent(structuralTextHtml).run();
              return true;
            }

            console.log('No image in clipboard');
            return false;
          },
        },
      }),
    ];
  },
});

// Bubble Menu для изображений
function ImageBubbleMenu({ editor }) {
  const [selectedNode, setSelectedNode] = useState(null);

  useEffect(() => {
    // Защита от уже уничтоженного editor
    if (!editor || editor.isDestroyed) return;

    const updateSelection = () => {
      // Проверяем что editor еще активен
      if (!editor || editor.isDestroyed) return;

      const { state } = editor;
      const { selection } = state;
      const { $from } = selection;
      const node = $from.parent.type.name === 'resizableImage'
        ? $from.parent
        : state.doc.nodeAt(selection.from);

      if (node && node.type.name === 'resizableImage') {
        setSelectedNode(node);
      } else {
        setSelectedNode(null);
      }
    };

    editor.on('selectionUpdate', updateSelection);
    editor.on('update', updateSelection);

    return () => {
      // Безопасная очистка
      if (editor && !editor.isDestroyed) {
        editor.off('selectionUpdate', updateSelection);
        editor.off('update', updateSelection);
      }
    };
  }, [editor]);

  // Не показываем BubbleMenu если editor уничтожен
  if (!editor || editor.isDestroyed || !selectedNode) return null;

  const display = selectedNode.attrs.display || 'inline';
  const float = selectedNode.attrs.float || 'none';
  const align = selectedNode.attrs.align || 'left';

  const setDisplay = (e, val) => {
    e.preventDefault();
    editor.chain().focus().updateImageAttributes({ display: val }).run();
  };

  const setFloat = (e, val) => {
    e.preventDefault();
    editor.chain().focus().updateImageAttributes({ float: val }).run();
  };

  const setAlign = (e, val) => {
    e.preventDefault();
    editor.chain().focus().updateImageAttributes({ align: val }).run();
  };

  const resetSize = (e) => {
    e.preventDefault();
    editor.chain().focus().updateImageAttributes({ width: null, height: null }).run();
  };

  return (
    <div>
      <BubbleMenu
        editor={editor}
        tippyOptions={{ duration: 100 }}
        shouldShow={({ editor, state }) => {
          // Дополнительная проверка
          return editor && !editor.isDestroyed && editor.isActive('resizableImage');
        }}
      >
        <div className="image-bubble-menu">
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
  { name: 'Розовый яркий', color: '#de64a1' },
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
  const [withHeaderRow, setWithHeaderRow] = useState(true);
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

  const closeAll = () => {
    setIsOpen(false);
    setShowCellColors(false);
    setShowSizeSelector(false);
  };

  const runCommand = (command) => {
    command();
    closeAll();
  };

  const handleTableSizeSelect = (rows, cols) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run();
    closeAll();
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
  const canMerge = editor.can().mergeCells();
  const canSplit = editor.can().splitCell();

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
              <label className="table-menu-toggle" onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={withHeaderRow}
                  onChange={e => setWithHeaderRow(e.target.checked)}
                />
                Строка заголовков
              </label>
              {!showSizeSelector && (
                <button
                  type="button"
                  className="table-menu-item"
                  onClick={() => setShowSizeSelector(true)}
                >
                  <LayoutGrid size={16} />
                  Выбрать размер
                </button>
              )}
              {showSizeSelector && (
                <TableSizeSelector onSelect={handleTableSizeSelect} />
              )}
            </>
          ) : (
            <>
              <div className="table-menu-title">Столбцы</div>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().addColumnBefore().run())}
              >
                <Plus size={16} />
                Столбец слева
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().addColumnAfter().run())}
              >
                <Plus size={16} />
                Столбец справа
              </button>
              <button
                type="button"
                className="table-menu-item table-menu-item--danger"
                onClick={() => runCommand(() => editor.chain().focus().deleteColumn().run())}
              >
                <Trash2 size={16} />
                Удалить столбец
              </button>
              <div className="table-menu-divider" />
              <div className="table-menu-title">Строки</div>
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
                className="table-menu-item table-menu-item--danger"
                onClick={() => runCommand(() => editor.chain().focus().deleteRow().run())}
              >
                <Trash2 size={16} />
                Удалить строку
              </button>
              <div className="table-menu-divider" />
              <div className="table-menu-title">Ячейки</div>
              <button
                type="button"
                className="table-menu-item"
                disabled={!canMerge}
                onClick={() => runCommand(() => editor.chain().focus().mergeCells().run())}
              >
                <GitMerge size={16} />
                Объединить ячейки
              </button>
              <button
                type="button"
                className="table-menu-item"
                disabled={!canSplit}
                onClick={() => runCommand(() => editor.chain().focus().splitCell().run())}
              >
                <Scissors size={16} />
                Разделить ячейку
              </button>
              <div className="table-menu-divider" />
              <div className="table-menu-title">Оформление</div>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().toggleHeaderRow().run())}
              >
                <LayoutGrid size={16} />
                Переключить строку-шапку
              </button>
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
                className="table-menu-item table-menu-item--danger"
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

// Плавающая панель управления таблицей — появляется над активной ячейкой
function TableBubbleMenu({ editor }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const panelRef = useRef(null);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      if (editor.isDestroyed) return;

      const isInTable = editor.isActive('table');
      if (!isInTable) {
        setVisible(false);
        return;
      }

      // Находим активную ячейку в DOM
      const { view } = editor;
      const { from } = view.state.selection;
      const domPos = view.domAtPos(from);
      let node = domPos.node;

      // Поднимаемся к td/th
      while (node && node.nodeName !== 'TD' && node.nodeName !== 'TH' && node !== view.dom) {
        node = node.parentNode;
      }

      if (!node || (node.nodeName !== 'TD' && node.nodeName !== 'TH')) {
        setVisible(false);
        return;
      }

      const cellRect = node.getBoundingClientRect();

      // Высота панели ~34px, отступ 6px
      const MENU_HEIGHT = 34;
      const MARGIN = 6;
      const MENU_WIDTH = 460; // приблизительная ширина панели

      // Выбираем: показывать выше или ниже ячейки
      let top;
      if (cellRect.top >= MENU_HEIGHT + MARGIN + 10) {
        top = cellRect.top - MENU_HEIGHT - MARGIN; // над ячейкой
      } else {
        top = cellRect.bottom + MARGIN; // под ячейкой
      }

      // Не выходить за правый край экрана
      let left = cellRect.left;
      if (left + MENU_WIDTH > window.innerWidth - 8) {
        left = window.innerWidth - MENU_WIDTH - 8;
      }
      left = Math.max(8, left);

      setPos({ top, left });
      setVisible(true);
    };

    editor.on('selectionUpdate', update);
    editor.on('update', update);

    return () => {
      if (!editor.isDestroyed) {
        editor.off('selectionUpdate', update);
        editor.off('update', update);
      }
    };
  }, [editor]);

  if (!editor || !visible) return null;

  return (
    <div
      ref={panelRef}
      className="table-float-menu"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={e => e.preventDefault()} // не снимаем фокус с редактора
    >
      {/* Строки */}
      <button
        type="button"
        className="table-float-btn"
        title="Добавить строку выше"
        onClick={() => editor.chain().focus().addRowBefore().run()}
      >
        <Plus size={11} />строку выше
      </button>
      <button
        type="button"
        className="table-float-btn"
        title="Добавить строку ниже"
        onClick={() => editor.chain().focus().addRowAfter().run()}
      >
        <Plus size={11} />строку ниже
      </button>
      <button
        type="button"
        className="table-float-btn table-float-btn--danger"
        title="Удалить строку"
        onClick={() => editor.chain().focus().deleteRow().run()}
      >
        <Trash2 size={11} />строку
      </button>

      <div className="table-float-sep" />

      {/* Столбцы */}
      <button
        type="button"
        className="table-float-btn"
        title="Добавить столбец слева"
        onClick={() => editor.chain().focus().addColumnBefore().run()}
      >
        <Plus size={11} />столбец слева
      </button>
      <button
        type="button"
        className="table-float-btn"
        title="Добавить столбец справа"
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      >
        <Plus size={11} />столбец справа
      </button>
      <button
        type="button"
        className="table-float-btn table-float-btn--danger"
        title="Удалить столбец"
        onClick={() => editor.chain().focus().deleteColumn().run()}
      >
        <Trash2 size={11} />столбец
      </button>

      <div className="table-float-sep" />

      {/* Объединение */}
      <button
        type="button"
        className="table-float-btn"
        title="Объединить / разделить ячейки"
        onClick={() => editor.chain().focus().mergeOrSplit().run()}
      >
        <GitMerge size={11} />объединить
      </button>
    </div>
  );
}

function MenuBar({ editor }) {
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [activeCellEditor, setActiveCellEditor] = useState(null);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const highlightButtonRef = useRef(null);
  const colorButtonRef = useRef(null);
  const fontFamilyButtonRef = useRef(null);
  const emojiButtonRef = useRef(null);
  const blockquoteButtonRef = useRef(null);

  useEffect(() => {
    const handleCellFocus = (event) => {
      setActiveCellEditor(event.detail?.editor || null);
    };

    const handleMouseDown = (event) => {
      const target = event.target;
      if (target.closest?.('.itable-cell-tiptap') || target.closest?.('.editor-menu')) return;
      setActiveCellEditor(null);
    };

    window.addEventListener('interactive-table-cell-focus', handleCellFocus);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      window.removeEventListener('interactive-table-cell-focus', handleCellFocus);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  const formatEditor = activeCellEditor && !activeCellEditor.isDestroyed ? activeCellEditor : editor;

  const setLink = useCallback(() => {
    const previousUrl = formatEditor.getAttributes('link').href;
    const url = window.prompt('URL:', previousUrl);

    if (url === null) return;

    if (url === '') {
      formatEditor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    formatEditor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [formatEditor]);

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

    const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
    if (file.size > maxSize) {
      toast.error('Максимальный размер видео 10GB');
      return;
    }

    setUploadingVideo(true);
    try {
      const { data } = await media.upload(file);
      // Сохраняем относительный путь вместо полного URL
      const videoPath = data.path.startsWith('/') ? data.path : `/${data.path}`;
      editor.chain().focus().setLocalVideo({
        src: videoPath
      }).run();
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
            if (val === 'p') formatEditor.chain().focus().setParagraph().run();
            else formatEditor.chain().focus().toggleHeading({ level: parseInt(val) }).run();
          }}
          value={
            formatEditor.isActive('heading', { level: 1 }) ? '1' :
            formatEditor.isActive('heading', { level: 2 }) ? '2' :
            formatEditor.isActive('heading', { level: 3 }) ? '3' :
            formatEditor.isActive('heading', { level: 4 }) ? '4' :
            formatEditor.isActive('heading', { level: 5 }) ? '5' :
            formatEditor.isActive('heading', { level: 6 }) ? '6' : 'p'
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
        <FontFamilyDropdown editor={formatEditor} buttonRef={fontFamilyButtonRef} />
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <MenuButton onClick={() => formatEditor.chain().focus().toggleBold().run()} isActive={formatEditor.isActive('bold')} title="Жирный">
          <Bold size={16} />
        </MenuButton>
        <MenuButton onClick={() => formatEditor.chain().focus().toggleItalic().run()} isActive={formatEditor.isActive('italic')} title="Курсив">
          <Italic size={16} />
        </MenuButton>
        <MenuButton onClick={() => formatEditor.chain().focus().toggleUnderline().run()} isActive={formatEditor.isActive('underline')} title="Подчеркнутый">
          <UnderlineIcon size={16} />
        </MenuButton>
        <MenuButton onClick={() => formatEditor.chain().focus().toggleStrike().run()} isActive={formatEditor.isActive('strike')} title="Зачеркнутый">
          <Strikethrough size={16} />
        </MenuButton>
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <ColorDropdown 
          editor={formatEditor} 
          type="highlight" 
          buttonRef={highlightButtonRef}
          icon={Highlighter}
          title="Цвет выделения"
          colors={highlightColors}
        />
        <ColorDropdown 
          editor={formatEditor} 
          type="color" 
          buttonRef={colorButtonRef}
          icon={Palette}
          title="Цвет текста"
          colors={textColors}
        />
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <MenuButton onClick={() => formatEditor.chain().focus().setTextAlign('left').run()} isActive={formatEditor.isActive({ textAlign: 'left' })} title="По левому краю">
          <AlignLeft size={16} />
        </MenuButton>
        <MenuButton onClick={() => formatEditor.chain().focus().setTextAlign('center').run()} isActive={formatEditor.isActive({ textAlign: 'center' })} title="По центру">
          <AlignCenter size={16} />
        </MenuButton>
        <MenuButton onClick={() => formatEditor.chain().focus().setTextAlign('right').run()} isActive={formatEditor.isActive({ textAlign: 'right' })} title="По правому краю">
          <AlignRight size={16} />
        </MenuButton>
        <MenuButton onClick={() => formatEditor.chain().focus().setTextAlign('justify').run()} isActive={formatEditor.isActive({ textAlign: 'justify' })} title="По ширине">
          <AlignJustify size={16} />
        </MenuButton>
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <MenuButton onClick={() => formatEditor.chain().focus().toggleBulletList().run()} isActive={formatEditor.isActive('bulletList')} title="Маркированный список">
          <List size={16} />
        </MenuButton>
        <MenuButton onClick={() => formatEditor.chain().focus().toggleOrderedList().run()} isActive={formatEditor.isActive('orderedList')} title="Нумерованный список">
          <ListOrdered size={16} />
        </MenuButton>
        <BlockquoteDropdown editor={formatEditor} buttonRef={blockquoteButtonRef} />
        <MenuButton onClick={() => formatEditor.chain().focus().toggleCodeBlock().run()} isActive={formatEditor.isActive('codeBlock')} title="Код">
          <Code size={16} />
        </MenuButton>
        <MenuButton onClick={() => formatEditor.chain().focus().setHorizontalRule().run()} disabled={formatEditor !== editor} title="Разделитель">
          <Minus size={16} />
        </MenuButton>
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <MenuButton onClick={() => formatEditor.chain().focus().toggleSubscript().run()} isActive={formatEditor.isActive('subscript')} title="Подстрочный">
          <SubIcon size={16} />
        </MenuButton>
        <MenuButton onClick={() => formatEditor.chain().focus().toggleSuperscript().run()} isActive={formatEditor.isActive('superscript')} title="Надстрочный">
          <SupIcon size={16} />
        </MenuButton>
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <EmojiDropdown editor={formatEditor} buttonRef={emojiButtonRef} />
        <MenuButton onClick={setLink} isActive={formatEditor.isActive('link')} title="Ссылка">
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
        <MenuButton
          onClick={() => editor.chain().focus().insertInteractiveTable({ rows: 3, cols: 3, header: true }).run()}
          title="Вставить таблицу"
        >
          <TableIcon size={16} />
        </MenuButton>
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <MenuButton onClick={() => formatEditor.chain().focus().undo().run()} disabled={!formatEditor.can().undo()} title="Отменить">
          <Undo size={16} />
        </MenuButton>
        <MenuButton onClick={() => formatEditor.chain().focus().redo().run()} disabled={!formatEditor.can().redo()} title="Повторить">
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
      InteractiveTable,
      TextStyle,
      Color,
      Subscript,
      Superscript,
      FontFamily,
      Youtube.configure({ width: 640, height: 360 }),
      LocalVideo,
      ImagePasteHandler, // Добавляем обработчик вставки изображений
      Placeholder.configure({ placeholder })
    ],
    content,
    editorProps: {
      attributes: {
        class: 'wiki-editor-prosemirror',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      console.log('=== Editor onUpdate ===');
      console.log('HTML:', html);
      // Проверяем изображения
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      const images = tempDiv.querySelectorAll('img');
      console.log('Images found:', images.length);
      images.forEach((img, i) => {
        console.log(`Image ${i}:`, {
          src: img.src.substring(0, 100) + (img.src.length > 100 ? '...' : ''),
          width: img.getAttribute('width'),
          height: img.getAttribute('height'),
          'data-display': img.getAttribute('data-display'),
          'data-float': img.getAttribute('data-float'),
          'data-align': img.getAttribute('data-align')
        });
      });
      onChange?.(html);
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
