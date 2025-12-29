import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Placeholder from '@tiptap/extension-placeholder';
import Youtube from '@tiptap/extension-youtube';
import FontFamily from '@tiptap/extension-font-family';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Code, Minus, Undo, Redo,
  Link as LinkIcon, Image as ImageIcon, Table as TableIcon,
  Highlighter, Youtube as YoutubeIcon, Subscript as SubIcon,
  Superscript as SupIcon, Palette, ChevronDown, Plus, Trash2, Upload,
  ZoomIn, ZoomOut, WrapText, Maximize2
} from 'lucide-react';
import { media, BASE_URL } from '../services/api';
import toast from 'react-hot-toast';
import './Editor.css';

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

// РАСШИРЕННЫЙ Image extension с поддержкой размера и обтекания
const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: element => element.getAttribute('width'),
        renderHTML: attributes => {
          if (!attributes.width) return {}
          return { width: attributes.width }
        },
      },
      float: {
        default: 'none',
        parseHTML: element => element.getAttribute('data-float') || 'none',
        renderHTML: attributes => {
          return {
            'data-float': attributes.float,
            style: attributes.float !== 'none' ? `float: ${attributes.float};` : ''
          }
        },
      },
      align: {
        default: null,
        parseHTML: element => element.getAttribute('data-align'),
        renderHTML: attributes => {
          if (!attributes.align) return {}
          return { 'data-align': attributes.align }
        },
      },
    }
  },
});

// РАСШИРЕННАЯ ПАЛИТРА ЦВЕТОВ ДЛЯ ХАЙЛАЙТЕРА (20 цветов)
const highlightColors = [
  { name: 'Жёлтый яркий', color: '#FFEB3B' },
  { name: 'Жёлтый светлый', color: '#FFF9C4' },
  { name: 'Оранжевый', color: '#FFCC80' },
  { name: 'Оранжевый яркий', color: '#FFB74D' },
  { name: 'Красный', color: '#EF9A9A' },
  { name: 'Розовый', color: '#F48FB1' },
  { name: 'Розовый яркий', color: '#F06292' },
  { name: 'Фиолетовый', color: '#CE93D8' },
  { name: 'Фиолетовый глубокий', color: '#B39DDB' },
  { name: 'Синий', color: '#9FA8DA' },
  { name: 'Голубой', color: '#81D4FA' },
  { name: 'Голубой светлый', color: '#B3E5FC' },
  { name: 'Бирюзовый', color: '#80CBC4' },
  { name: 'Зелёный', color: '#A5D6A7' },
  { name: 'Зелёный светлый', color: '#C5E1A5' },
  { name: 'Лайм', color: '#E6EE9C' },
  { name: 'Серый светлый', color: '#EEEEEE' },
  { name: 'Серый', color: '#CCCCCC' },
  { name: 'Бежевый', color: '#FFCCBC' },
  { name: 'Коричневый', color: '#BCAAA4' },
];

// Цвета для текста
const textColors = [
  { name: 'Чёрный', color: '#000000' },
  { name: 'Серый тёмный', color: '#424242' },
  { name: 'Серый', color: '#666666' },
  { name: 'Красный', color: '#E53935' },
  { name: 'Оранжевый', color: '#FB8C00' },
  { name: 'Жёлтый', color: '#FDD835' },
  { name: 'Зелёный', color: '#43A047' },
  { name: 'Голубой', color: '#039BE5' },
  { name: 'Синий', color: '#1E88E5' },
  { name: 'Фиолетовый', color: '#8E24AA' },
  { name: 'Розовый', color: '#D81B60' },
  { name: 'Коричневый', color: '#6D4C41' },
];

// Цвета для фона ячеек таблицы
const cellBackgroundColors = [
  { name: 'Без цвета', color: 'transparent' },
  { name: 'Жёлтый светлый', color: '#FFF9C4' },
  { name: 'Оранжевый светлый', color: '#FFE0B2' },
  { name: 'Красный светлый', color: '#FFCDD2' },
  { name: 'Розовый светлый', color: '#F8BBD0' },
  { name: 'Фиолетовый светлый', color: '#E1BEE7' },
  { name: 'Синий светлый', color: '#C5CAE9' },
  { name: 'Голубой светлый', color: '#B3E5FC' },
  { name: 'Бирюзовый светлый', color: '#B2DFDB' },
  { name: 'Зелёный светлый', color: '#C8E6C9' },
  { name: 'Лайм светлый', color: '#F0F4C3' },
  { name: 'Серый светлый', color: '#F5F5F5' },
];

// Компонент выпадающего меню для цветов
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
                style={{ background: color, border: color === 'transparent' ? '2px dashed #ccc' : '2px solid transparent' }}
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

// Компонент выпадающего меню таблицы С ЦВЕТОМ ЯЧЕЕК
function TableMenuDropdown({ editor, buttonRef }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCellColorPicker, setShowCellColorPicker] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && 
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setIsOpen(false);
        setShowCellColorPicker(false);
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
    setShowCellColorPicker(false);
  };

  const runCommand = (command) => {
    command();
    setIsOpen(false);
  };

  const setCellBackground = (color) => {
    editor.chain().focus().setCellAttribute('backgroundColor', color).run();
    setShowCellColorPicker(false);
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
              <div className="table-menu-title">Вставить таблицу</div>
              <div className="table-size-grid">
                {[2, 3, 4, 5].map(rows => (
                  <div key={rows} className="table-size-row">
                    {[2, 3, 4, 5].map(cols => (
                      <button
                        key={cols}
                        type="button"
                        className="table-size-cell"
                        onClick={() => runCommand(() => 
                          editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
                        )}
                      >
                        {cols}×{rows}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="table-menu-title">Таблица</div>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => 
                  editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
                )}
              >
                <Plus size={14} /> Вставить новую
              </button>

              <div className="table-menu-divider" />
              <div className="table-menu-title">Строки</div>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().addRowBefore().run())}
              >
                <Plus size={14} /> Добавить строку выше
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().addRowAfter().run())}
              >
                <Plus size={14} /> Добавить строку ниже
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().deleteRow().run())}
              >
                <Trash2 size={14} /> Удалить строку
              </button>

              <div className="table-menu-divider" />
              <div className="table-menu-title">Столбцы</div>
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
              <div className="table-menu-title">Ячейки</div>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().mergeCells().run())}
              >
                Объединить ячейки
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().splitCell().run())}
              >
                Разделить ячейку
              </button>
              <button
                type="button"
                className="table-menu-item"
                onClick={() => setShowCellColorPicker(!showCellColorPicker)}
              >
                <Palette size={14} /> Цвет фона ячейки
              </button>

              {showCellColorPicker && (
                <div className="cell-color-picker">
                  <div className="color-picker-grid">
                    {cellBackgroundColors.map(({ name, color }) => (
                      <button
                        key={color}
                        type="button"
                        className="color-picker-item"
                        style={{ 
                          background: color,
                          border: color === 'transparent' ? '2px dashed #ccc' : '2px solid transparent'
                        }}
                        onClick={() => setCellBackground(color)}
                        title={name}
                      />
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="table-menu-item"
                onClick={() => runCommand(() => editor.chain().focus().toggleHeaderCell().run())}
              >
                Переключить заголовок
              </button>

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

// BUBBLE MENU ДЛЯ ИЗОБРАЖЕНИЙ
function ImageBubbleMenu({ editor }) {
  if (!editor) return null;

  const currentAttrs = editor.getAttributes('image');
  const currentWidth = parseInt(currentAttrs.width) || null;
  const currentFloat = currentAttrs.float || 'none';

  const changeSize = (delta) => {
    const width = currentWidth || 300;
    const newWidth = Math.max(100, Math.min(1000, width + delta));
    editor.chain().focus().updateAttributes('image', { width: `${newWidth}px` }).run();
  };

  const setFloat = (float) => {
    editor.chain().focus().updateAttributes('image', { float }).run();
  };

  const deleteImage = () => {
    editor.chain().focus().deleteSelection().run();
  };

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{ duration: 100, placement: 'top' }}
      shouldShow={({ editor }) => editor.isActive('image')}
    >
      <div className="image-bubble-menu">
        <div className="image-bubble-section">
          <span className="image-bubble-label">Размер:</span>
          <button
            type="button"
            className="image-bubble-btn"
            onClick={() => changeSize(-50)}
            title="Уменьшить"
          >
            <ZoomOut size={14} />
          </button>
          <span className="image-bubble-size">{currentWidth || 'авто'}px</span>
          <button
            type="button"
            className="image-bubble-btn"
            onClick={() => changeSize(50)}
            title="Увеличить"
          >
            <ZoomIn size={14} />
          </button>
        </div>

        <div className="image-bubble-divider" />

        <div className="image-bubble-section">
          <span className="image-bubble-label">Обтекание:</span>
          <button
            type="button"
            className={`image-bubble-btn ${currentFloat === 'none' ? 'active' : ''}`}
            onClick={() => setFloat('none')}
            title="В тексте"
          >
            <WrapText size={14} />
          </button>
          <button
            type="button"
            className={`image-bubble-btn ${currentFloat === 'left' ? 'active' : ''}`}
            onClick={() => setFloat('left')}
            title="Слева"
          >
            <AlignLeft size={14} />
          </button>
          <button
            type="button"
            className={`image-bubble-btn ${currentFloat === 'center' ? 'active' : ''}`}
            onClick={() => setFloat('center')}
            title="По центру"
          >
            <AlignCenter size={14} />
          </button>
          <button
            type="button"
            className={`image-bubble-btn ${currentFloat === 'right' ? 'active' : ''}`}
            onClick={() => setFloat('right')}
            title="Справа"
          >
            <AlignRight size={14} />
          </button>
          <button
            type="button"
            className={`image-bubble-btn ${currentFloat === 'full' ? 'active' : ''}`}
            onClick={() => setFloat('full')}
            title="На всю ширину"
          >
            <Maximize2 size={14} />
          </button>
        </div>

        <div className="image-bubble-divider" />

        <button
          type="button"
          className="image-bubble-btn danger"
          onClick={deleteImage}
          title="Удалить"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </BubbleMenu>
  );
}

function MenuBar({ editor }) {
  const tableButtonRef = useRef(null);
  const highlightButtonRef = useRef(null);
  const colorButtonRef = useRef(null);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const setLink = useCallback(() => {
    const url = window.prompt('URL:', editor.getAttributes('link').href || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const handleImageUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Можно загружать только изображения');
      return;
    }

    setUploading(true);
    try {
      const { data } = await media.upload(file);
      const imageUrl = `${BASE_URL}/${data.path}`;
      editor.chain().focus().setImage({ src: imageUrl, width: '400px', float: 'none' }).run();
      toast.success('Изображение загружено');
    } catch (error) {
      toast.error('Ошибка загрузки изображения');
      console.error(error);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [editor]);

  const addImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const addYoutube = useCallback(() => {
    const url = window.prompt('YouTube URL:');
    if (url) {
      editor.commands.setYoutubeVideo({ src: url });
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="editor-menu">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageUpload}
      />

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
          <option value="p">Параграф</option>
          <option value="1">Заголовок 1</option>
          <option value="2">Заголовок 2</option>
          <option value="3">Заголовок 3</option>
          <option value="4">Заголовок 4</option>
          <option value="5">Заголовок 5</option>
          <option value="6">Заголовок 6</option>
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
        <MenuButton onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editor.isActive('underline')} title="Подчёркнутый">
          <UnderlineIcon size={16} />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleStrike().run()} isActive={editor.isActive('strike')} title="Зачёркнутый">
          <Strikethrough size={16} />
        </MenuButton>
        <ColorDropdown editor={editor} type="text" buttonRef={colorButtonRef} icon={Palette} title="Цвет текста" colors={textColors} />
        <ColorDropdown editor={editor} type="highlight" buttonRef={highlightButtonRef} icon={Highlighter} title="Выделение текста" colors={highlightColors} />
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
        <MenuButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} isActive={editor.isActive('codeBlock')} title="Блок кода">
          <Code size={16} />
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
        <MenuButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Горизонтальная линия">
          <Minus size={16} />
        </MenuButton>
      </div>

      <MenuDivider />

      <div className="editor-menu-group">
        <MenuButton onClick={setLink} isActive={editor.isActive('link')} title="Ссылка">
          <LinkIcon size={16} />
        </MenuButton>
        <MenuButton onClick={addImage} disabled={uploading} title="Загрузить изображение">
          {uploading ? <div className="loading-spinner" style={{ width: 14, height: 14 }} /> : <Upload size={16} />}
        </MenuButton>
        <MenuButton onClick={addYoutube} title="YouTube видео">
          <YoutubeIcon size={16} />
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
      CustomImage.configure({ inline: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            backgroundColor: {
              default: null,
              parseHTML: element => element.getAttribute('data-background-color'),
              renderHTML: attributes => {
                if (!attributes.backgroundColor) {
                  return {}
                }
                return {
                  'data-background-color': attributes.backgroundColor,
                  style: `background-color: ${attributes.backgroundColor}`
                }
              },
            },
          }
        },
      }),
      TableHeader,
      TextStyle,
      Color,
      Subscript,
      Superscript,
      FontFamily,
      Youtube.configure({ width: 640, height: 360 }),
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