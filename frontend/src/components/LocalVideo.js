// LocalVideo.js - Расширение TipTap для встраивания локального видео
// Расположение: frontend/src/components/LocalVideo.js

import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Расширение TipTap для встраивания локально загруженного видео
 * Поддерживает форматы: mp4, webm, ogg
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
        tag: 'div[data-local-video] video',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { src, poster } = HTMLAttributes;

    return [
      'div',
      {
        'data-local-video': '',
        style: 'position: relative; margin: 1rem 0; width: 100%;'
      },
      [
        'video',
        mergeAttributes(
          {
            src,
            poster,
            controls: '',
            preload: 'metadata',
            style: 'width: 100%; height: auto; border-radius: 8px;',
          }
        ),
        'Ваш браузер не поддерживает воспроизведение видео.'
      ],
    ];
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
