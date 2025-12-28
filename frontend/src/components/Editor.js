import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
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
  Highlighter, Type, Youtube as YoutubeIcon, Subscript as SubIcon,
  Superscript as SupIcon, Palette, ChevronDown, Plus, Trash2
} from 'lucide-react';
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

const highlightColors = [
  { name: 'Жёлтый', color: '#fef08a' },
  { name: 'Зелёный', color: '#bbf7d0' },
  { name: 'Голубой', color: '#bae6fd' },
  { name: 'Розовый', color: '#fbcfe8' },
  { name: 'Оранжевый', color: '#fed7aa' },
  { name: 'Фиолетовый', color: '#ddd6fe' },
  { name: 'Красный', color: '#fecaca' },
  { name: 'Серый', color: '#e5e7eb' },
];

const textColors = [
  { name: 'Чёрный', color: '#000000' },
  { name: 'Серый', color: '#6b7280' },
  { name: 'Красный', color: '#dc2626' },
  { name: 'Оранжевый', color: '#ea580c' },
  { name: 'Жёлтый', color: '#ca8a04' },
  { name: 'Зелёный', color: '#16a34a' },
  { name: 'Голубой', color: '#0891b2' },
  { name: 'Синий', color: '#2563eb' },
  { name: 'Фиолетовый', color: '#7c3aed' },
  { name: 'Розовый', color: '#db2777' },
];

function ColorDropdown({ isOpen, onClose, colors, onSelect, title, currentColor }) {
  const ref = useRef(null);
  
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  
  return (
    <div className="color-picker-dropdown" ref={ref}>
      <div className="color-picker-title">{title}</div>
      <div className="color-picker-grid">
        {colors.map(({ name, color }) => (
          <button
            key={color}
            className={`color-picker-item ${currentColor === color ? 'active' : ''}`}
            style={{ background: color }}
            onClick={() => { onSelect(color); onClose(); }}
            title={name}
          />
        ))}
      </div>
      <button className="color-picker-clear" onClick={() => { onSelect(null); onClose(); }}>
        Сбросить
      </button>
    </div>
  );
}

function TableDropdown({ isOpen, onClose, editor }) {
  const ref = useRef(null);
  
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen || !editor) return null;

  const canAddRowBefore = editor.can().addRowBefore();
  const canAddRowAfter = editor.can().addRowAfter();
  const canDeleteRow = editor.can().deleteRow();
  const canAddColumnBefore = editor.can().addColumnBefore();
  const canAddColumnAfter = editor.can().addColumnAfter();
  const canDeleteColumn = editor.can().deleteColumn();
  const canMergeCells = editor.can().mergeCells();
  const canSplitCell = editor.can().splitCell();
  const canDeleteTable = editor.can().deleteTable();
  
  const isInTable = canDeleteTable;
  
  return (
    <div className="table-menu-dropdown" ref={ref}>
      <div className="table-menu-title">Таблица</div>
      
      {/* Всегда показываем возможность создать таблицу */}
      <button className="table-menu-item" onClick={() => {
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        onClose();
      }}>
        <Plus size={16} /> Вставить таблицу 3×3
      </button>
      
      {/* Показываем остальные опции только если мы в таблице */}
      {isInTable && (
        <>
          <div className="table-menu-divider" />
          <div className="table-menu-section">Строки</div>
          
          <button 
            className="table-menu-item" 
            disabled={!canAddRowBefore}
            onClick={() => { editor.chain().focus().addRowBefore().run(); onClose(); }}
          >
            <Plus size={16} /> Добавить строку выше
          </button>
          <button 
            className="table-menu-item" 
            disabled={!canAddRowAfter}
            onClick={() => { editor.chain().focus().addRowAfter().run(); onClose(); }}
          >
            <Plus size={16} /> Добавить строку ниже
          </button>
          <button 
            className="table-menu-item danger" 
            disabled={!canDeleteRow}
            onClick={() => { editor.chain().focus().deleteRow().run(); onClose(); }}
          >
            <Trash2 size={16} /> Удалить строку
          </button>
          
          <div className="table-menu-section">Столбцы</div>
          
          <button 
            className="table-menu-item" 
            disabled={!canAddColumnBefore}
            onClick={() => { editor.chain().focus().addColumnBefore().run(); onClose(); }}
          >
            <Plus size={16} /> Добавить столбец слева
          </button>
          <button 
            className="table-menu-item" 
            disabled={!canAddColumnAfter}
            onClick={() => { editor.chain().focus().addColumnAfter().run(); onClose(); }}
          >
            <Plus size={16} /> Добавить столбец справа
          </button>
          <button 
            className="table-menu-item danger" 
            disabled={!canDeleteColumn}
            onClick={() => { editor.chain().focus().deleteColumn().run(); onClose(); }}
          >
            <Trash2 size={16} /> Удалить столбец
          </button>
          
          <div className="table-menu-section">Ячейки</div>
          
          <button 
            className="table-menu-item" 
            disabled={!canMergeCells}
            onClick={() => { editor.chain().focus().mergeCells().run(); onClose(); }}
          >
            <TableIcon size={16} /> Объединить ячейки
          </button>
          <button 
            className="table-menu-item" 
            disabled={!canSplitCell}
            onClick={() => { editor.chain().focus().splitCell().run(); onClose(); }}
          >
            <TableIcon size={16} /> Разделить ячейку
          </button>
          <button 
            className="table-menu-item"
            onClick={() => { editor.chain().focus().toggleHeaderCell().run(); onClose(); }}
          >
            <Type size={16} /> Переключить заголовок
          </button>
          
          <div className="table-menu-divider" />
          
          <button 
            className="table-menu-item danger" 
            disabled={!canDeleteTable}
            onClick={() => { editor.chain().focus().deleteTable().run(); onClose(); }}
          >
            <Trash2 size={16} /> Удалить таблицу
          </button>
        </>
      )}
    </div>
  );
}

const MenuBar = ({ editor }) => {
  const [showHighlightColors, setShowHighlightColors] = useState(false);
  const [showTextColors, setShowTextColors] = useState(false);
  const [showTableMenu, setShowTableMenu] = useState(false);

  if (!editor) return null;

  const addLink = useCallback(() => {
    const url = window.prompt('URL ссылки:', 'https://');
    if (url) editor.chain().focus().setLink({ href: url }).run();
  }, [editor]);

  const addImage = useCallback(() => {
    const url = window.prompt('URL изображения:');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const addYoutube = useCallback(() => {
    const url = window.prompt('URL YouTube видео:');
    if (url) editor.chain().focus().setYoutubeVideo({ src: url }).run();
  }, [editor]);

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
            editor.isActive('heading', { level: 4 }) ? '4' : 'p'
          }
        >
          <option value="p">Параграф</option>
          <option value="1">Заголовок 1</option>
          <option value="2">Заголовок 2</option>
          <option value="3">Заголовок 3</option>
          <option value="4">Заголовок 4</option>
        </select>

        <select
          className="editor-select"
          onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
          value={editor.getAttributes('textStyle').fontFamily || ''}
        >
          <option value="">Шрифт по умолчанию</option>
          <option value="Inter">Inter</option>
          <option value="Arial">Arial</option>
          <option value="Georgia">Georgia</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
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
        
        <div className="editor-dropdown-wrapper">
          <MenuButton 
            onClick={() => setShowHighlightColors(!showHighlightColors)} 
            isActive={editor.isActive('highlight')} 
            title="Выделение цветом"
          >
            <Highlighter size={16} />
            <ChevronDown size={12} />
          </MenuButton>
          <ColorDropdown
            isOpen={showHighlightColors}
            onClose={() => setShowHighlightColors(false)}
            colors={highlightColors}
            onSelect={(color) => {
              if (color) editor.chain().focus().toggleHighlight({ color }).run();
              else editor.chain().focus().unsetHighlight().run();
            }}
            title="Цвет выделения"
            currentColor={editor.getAttributes('highlight').color}
          />
        </div>
        
        <div className="editor-dropdown-wrapper">
          <MenuButton onClick={() => setShowTextColors(!showTextColors)} title="Цвет текста">
            <Palette size={16} />
            <ChevronDown size={12} />
          </MenuButton>
          <ColorDropdown
            isOpen={showTextColors}
            onClose={() => setShowTextColors(false)}
            colors={textColors}
            onSelect={(color) => {
              if (color) editor.chain().focus().setColor(color).run();
              else editor.chain().focus().unsetColor().run();
            }}
            title="Цвет текста"
            currentColor={editor.getAttributes('textStyle').color}
          />
        </div>
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
        <MenuButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Горизонтальная линия">
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
        <MenuButton onClick={addLink} isActive={editor.isActive('link')} title="Ссылка">
          <LinkIcon size={16} />
        </MenuButton>
        <MenuButton onClick={addImage} title="Изображение">
          <ImageIcon size={16} />
        </MenuButton>
        <MenuButton onClick={addYoutube} title="YouTube видео">
          <YoutubeIcon size={16} />
        </MenuButton>
        
        <div className="editor-dropdown-wrapper">
          <MenuButton 
            onClick={() => setShowTableMenu(!showTableMenu)} 
            isActive={editor.isActive('table')} 
            title="Таблица"
          >
            <TableIcon size={16} />
            <ChevronDown size={12} />
          </MenuButton>
          <TableDropdown
            isOpen={showTableMenu}
            onClose={() => setShowTableMenu(false)}
            editor={editor}
          />
        </div>
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
};

export default function Editor({ content, onChange, placeholder = 'Начните вводить текст...' }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TextStyle,
      Color,
      Subscript,
      Superscript,
      Placeholder.configure({ placeholder }),
      Youtube.configure({ width: 640, height: 360 }),
      FontFamily
    ],
    content,
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
    editorProps: {
      attributes: { class: 'editor-content' }
    }
  });

  return (
    <div className="tiptap-editor">
      <MenuBar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}