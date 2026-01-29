// LocalVideo.js - Расширение TipTap для встраивания локального видео
// Расположение: frontend/src/components/LocalVideo.js

import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { BASE_URL } from '../services/api';

/**
 * React компонент для отображения видео
 * Простой вариант без ленивой загрузки - обычное HTML5 видео
 */
const VideoComponent = ({ node }) => {
  const { src, poster } = node.attrs;

  // Если src пустой - показываем ошибку
  if (!src) {
    return (
      <NodeViewWrapper>
        <div style={{
          padding: '20px',
          background: '#fff3cd',
          border: '2px solid #ffc107',
          borderRadius: '8px',
          margin: '1rem 0',
          textAlign: 'center',
          color: '#856404'
        }}>
          <p><strong>⚠️ Ошибка:</strong> Не указан путь к видео файлу</p>
        </div>
      </NodeViewWrapper>
    );
  }

  // Формируем полные URL для видео и постера
  const videoSrc = src?.startsWith('/uploads/') ? `${BASE_URL}${src}` : src;
  const videoPoster = poster?.startsWith('/uploads/') ? `${BASE_URL}${poster}` : poster;

  // Обычное HTML5 видео с preload="none"
  return (
    <NodeViewWrapper>
      <video
        src={videoSrc}
        poster={videoPoster}
        controls
        preload="none"
        style={{
          width: '100%',
          maxWidth: '100%',
          height: 'auto',
          minHeight: '300px',
          aspectRatio: '16/9',
          display: 'block',
          margin: '1rem 0',
          borderRadius: '8px',
          backgroundColor: '#000',
          objectFit: 'contain'
        }}
      >
        Ваш браузер не поддерживает воспроизведение видео.
      </video>
    </NodeViewWrapper>
  );
};

/**
 * Расширение TipTap для встраивания локально загруженного видео
 * Поддерживает форматы: mp4, webm, ogg
 * Использует ленивую загрузку для предотвращения фризов
 */
export const LocalVideo = Node.create({
  name: 'localVideo',

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      poster: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'video[src]',
        getAttrs: (dom) => {
          return {
            src: dom.getAttribute('src'),
            poster: dom.getAttribute('poster') || null,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { src, poster } = HTMLAttributes;

    // Возвращаем обычный video элемент для статического HTML
    return [
      'video',
      {
        src,
        poster: poster || undefined,
        controls: '',
        preload: 'none',
        style: 'width: 100%; max-width: 100%; height: auto; min-height: 300px; aspect-ratio: 16/9; display: block; margin: 1rem 0; border-radius: 8px; background-color: #000; object-fit: contain;'
      }
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoComponent);
  },

  addCommands() {
    return {
      setLocalVideo: (options) => ({ commands }) => {
        if (!options.src) {
          return false;
        }

        return commands.insertContent({
          type: this.name,
          attrs: options,
        });
      },
    };
  },
});
