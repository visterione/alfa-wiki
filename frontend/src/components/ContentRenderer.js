// ContentRenderer.js - Компонент для рендеринга TipTap контента
import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Youtube from '@tiptap/extension-youtube';
import { LocalVideo } from './LocalVideo';
import { CustomBlockquote, TableCell, ResizableImageReadOnly } from './EditorExtensions';
import './Editor.css';
import './ContentRenderer.css';

/**
 * Компонент для отображения контента в режиме просмотра
 * Использует те же расширения что и Editor, но в режиме только для чтения
 */
export default function ContentRenderer({ content }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false, // Отключаем стандартный blockquote
      }),
      CustomBlockquote, // Используем кастомный blockquote с типами
      ResizableImageReadOnly, // Используем кастомное изображение с поддержкой атрибутов
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      Table.configure({
        resizable: false, // Отключаем resizable в режиме просмотра
      }),
      TableRow,
      TableHeader,
      TableCell, // Кастомный TableCell с поддержкой backgroundColor
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Underline,
      Highlight.configure({ multicolor: true }), // Поддержка текстовых выделителей
      TextStyle, // Необходимо для Color
      Color, // Поддержка цвета текста
      FontFamily, // Поддержка разных шрифтов
      Subscript, // Подстрочный текст
      Superscript, // Надстрочный текст
      Youtube.configure({
        controls: true,
        nocookie: true,
      }),
      LocalVideo, // Наш компонент для локального видео
    ],
    content: content || '<p>Контент не загружен</p>',
    editable: false, // Только для чтения
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-xl mx-auto focus:outline-none',
      },
    },
  });

  // Обновляем контент только при изменении
  useEffect(() => {
    if (!editor || editor.isDestroyed || !content) return;

    // Избегаем бесконечного цикла проверяя текущий контент
    const currentContent = editor.getHTML();
    if (currentContent !== content) {
      // emitUpdate: false предотвращает лишние события
      editor.commands.setContent(content, false);
    }
  }, [editor, content]);

  // Очищаем editor при размонтировании
  useEffect(() => {
    return () => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    };
  }, [editor]);

  if (!editor) {
    return null;
  }

  return (
    <div className="content-renderer">
      <EditorContent editor={editor} />
    </div>
  );
}
