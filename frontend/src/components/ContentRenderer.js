// ContentRenderer.js - Компонент для рендеринга TipTap контента
import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Youtube from '@tiptap/extension-youtube';
import { LocalVideo } from './LocalVideo';
import './Editor.css';
import './ContentRenderer.css';

/**
 * Компонент для отображения контента в режиме просмотра
 * Использует те же расширения что и Editor, но в режиме только для чтения
 */
export default function ContentRenderer({ content }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
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
      TableCell,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Underline,
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
