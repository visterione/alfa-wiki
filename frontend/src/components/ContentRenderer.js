// ContentRenderer.js - Компонент для рендеринга TipTap контента
import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
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
import { CustomBlockquote, TableCell, TableHeader, ResizableImageReadOnly } from './EditorExtensions';
import { BASE_URL } from '../services/api';
import './Editor.css';
import './ContentRenderer.css';

/**
 * Преобразует относительные пути медиа в абсолютные
 */
function fixMediaPaths(htmlContent) {
  if (!htmlContent) return htmlContent;

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlContent;

  // Исправляем src изображений
  const images = tempDiv.querySelectorAll('img');
  images.forEach(img => {
    const src = img.getAttribute('src');
    if (src && src.startsWith('/uploads/')) {
      img.setAttribute('src', `${BASE_URL}${src}`);
    }
  });

  // Исправляем src видео
  const videos = tempDiv.querySelectorAll('video');
  videos.forEach(video => {
    const src = video.getAttribute('src');
    if (src && src.startsWith('/uploads/')) {
      video.setAttribute('src', `${BASE_URL}${src}`);
    }
    const poster = video.getAttribute('poster');
    if (poster && poster.startsWith('/uploads/')) {
      video.setAttribute('poster', `${BASE_URL}${poster}`);
    }
  });

  return tempDiv.innerHTML;
}

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
        resizable: true, // Включаем resizable чтобы сохранялись ширины колонок (colwidth)
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

    console.log('=== ContentRenderer: Setting content ===');
    console.log('Content length:', content.length);

    // Преобразуем относительные пути медиа в абсолютные
    const fixedContent = fixMediaPaths(content);

    // Проверяем изображения во входящем контенте
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = fixedContent;
    const images = tempDiv.querySelectorAll('img');
    console.log('Images in incoming content:', images.length);
    images.forEach((img, i) => {
      console.log(`Image ${i}:`, {
        src: img.src?.substring(0, 100) + (img.src?.length > 100 ? '...' : ''),
        srcAttr: img.getAttribute('src')?.substring(0, 100),
        width: img.getAttribute('width'),
        height: img.getAttribute('height'),
        'data-display': img.getAttribute('data-display'),
        'data-float': img.getAttribute('data-float'),
        'data-align': img.getAttribute('data-align')
      });
    });

    // Избегаем бесконечного цикла проверяя текущий контент
    const currentContent = editor.getHTML();
    if (currentContent !== fixedContent) {
      // emitUpdate: false предотвращает лишние события
      editor.commands.setContent(fixedContent, false);
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
