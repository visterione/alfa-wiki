// LocalVideo.js - Расширение TipTap для встраивания локального видео
// Расположение: frontend/src/components/LocalVideo.js

import React, { useState, useRef } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { Play, AlertCircle } from 'lucide-react';
import './LocalVideo.css';

/**
 * React компонент для ленивой загрузки видео
 * Упрощенная версия с img вместо сложного placeholder
 */
const LazyVideoComponent = ({ node, updateAttributes }) => {
  const { src, poster } = node.attrs;
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const videoRef = useRef(null);

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
          <p><strong>⚠️ Ошибка:</strong> Не указан путь к видео файлу (src пустой)</p>
          <p style={{ fontSize: '12px', marginTop: '8px' }}>
            Пожалуйста, удалите этот блок и добавьте видео заново
          </p>
        </div>
      </NodeViewWrapper>
    );
  }

  const handleLoadVideo = () => {
    setIsLoaded(true);
  };

  const handleVideoError = (e) => {
    console.error('Video load error:', e);
    setHasError(true);
  };

  // Если видео загружено - показываем его
  if (isLoaded) {
    return (
      <NodeViewWrapper>
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          controls
          preload="metadata"
          onError={handleVideoError}
          style={{
            width: '100%',
            maxWidth: '100%',
            height: 'auto',
            display: 'block',
            margin: '1rem 0',
            borderRadius: '8px',
            backgroundColor: '#000'
          }}
        >
          Ваш браузер не поддерживает воспроизведение видео.
        </video>
      </NodeViewWrapper>
    );
  }

  // Если ошибка - показываем сообщение
  if (hasError) {
    return (
      <NodeViewWrapper>
        <div style={{
          padding: '40px 20px',
          background: '#f8d7da',
          color: '#721c24',
          border: '2px solid #f5c6cb',
          borderRadius: '8px',
          margin: '1rem 0',
          textAlign: 'center'
        }}>
          <AlertCircle size={48} color="#721c24" style={{ margin: '0 auto' }} />
          <p style={{ marginTop: '12px', fontSize: '14px', fontWeight: 'bold' }}>
            Не удалось загрузить видео
          </p>
          <p style={{ fontSize: '12px', marginTop: '4px', opacity: 0.7 }}>
            {src}
          </p>
          <button
            onClick={handleLoadVideo}
            style={{
              marginTop: '12px',
              padding: '8px 16px',
              background: '#721c24',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            Попробовать снова
          </button>
        </div>
      </NodeViewWrapper>
    );
  }

  // По умолчанию - показываем thumbnail с кнопкой загрузки
  return (
    <NodeViewWrapper>
      <div
        onClick={handleLoadVideo}
        style={{
          position: 'relative',
          margin: '1rem 0',
          cursor: 'pointer',
          borderRadius: '8px',
          overflow: 'hidden',
          backgroundColor: '#f0f0f0'
        }}
      >
        <img
          src={poster || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"%3E%3Crect fill="%23e0e0e0" width="800" height="450"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23666" font-size="24" font-family="Arial"%3EВидео%3C/text%3E%3C/svg%3E'}
          alt="Video thumbnail"
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            minHeight: '200px',
            objectFit: 'cover'
          }}
        />
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.3)',
          transition: 'background 0.2s'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.3)'}
        >
          <div style={{
            background: 'rgba(255, 255, 255, 0.95)',
            borderRadius: '50%',
            width: '80px',
            height: '80px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}>
            <Play size={40} color="#333" fill="#333" />
          </div>
        </div>
      </div>
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
        tag: 'div[data-local-video]',
        getAttrs: (dom) => {
          // Извлекаем src и poster из data-атрибутов или из вложенного video
          const videoElement = dom.querySelector('video');
          const src = dom.getAttribute('data-src') || videoElement?.getAttribute('src') || null;
          const poster = dom.getAttribute('data-poster') || videoElement?.getAttribute('poster') || null;

          return { src, poster };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { src, poster } = HTMLAttributes;

    return [
      'div',
      {
        'data-local-video': '',
        'data-src': src,
        'data-poster': poster || '',
        style: 'position: relative; margin: 1rem 0; width: 100%; min-height: 200px; background: #f0f0f0; border-radius: 8px;'
      },
      [
        'div',
        {
          style: 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: #666;'
        },
        'Видео загрузится при клике'
      ]
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LazyVideoComponent);
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
