// VkVideo.js - Расширение TipTap для встраивания VK видео
// Расположение: frontend/src/components/VkVideo.js

import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Расширение TipTap для встраивания VK видео
 * Поддерживает форматы:
 * - https://vkvideo.ru/video-XXXXXXXX_XXXXXXXXX (новый домен)
 * - https://vk.com/video-XXXXXXXX_XXXXXXXXX
 * - https://vk.com/video?z=video-XXXXXXXX_XXXXXXXXX
 * - https://vk.com/clip-XXXXXXXX_XXXXXXXXX
 */
export const VkVideo = Node.create({
  name: 'vkVideo',

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      width: {
        default: 640,
      },
      height: {
        default: 360,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-vk-video] iframe',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { src, width, height } = HTMLAttributes;

    return [
      'div',
      { 
        'data-vk-video': '', 
        style: 'position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; margin: 1rem 0;' 
      },
      [
        'iframe',
        mergeAttributes(
          {
            src,
            width,
            height,
            frameborder: '0',
            allowfullscreen: '',
            allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock;',
            style: 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: 8px;',
          }
        ),
      ],
    ];
  },

  addCommands() {
    return {
      setVkVideo: (options) => ({ commands }) => {
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

/**
 * Парсит URL VK видео и возвращает embed URL
 * @param {string} url - URL VK видео
 * @returns {string|null} - Embed URL или null если URL невалиден
 */
export function getVkVideoEmbedUrl(url) {
  if (!url) return null;

  // Паттерны для разных форматов VK видео
  const patterns = [
    // https://vkvideo.ru/video-XXXXXXXX_XXXXXXXXX (новый домен VK Video)
    /vkvideo\.ru\/video(-?\d+_\d+)/,
    // https://vk.com/video-XXXXXXXX_XXXXXXXXX
    /vk\.com\/video(-?\d+_\d+)/,
    // https://vk.com/video?z=video-XXXXXXXX_XXXXXXXXX
    /vk\.com\/video\?z=video(-?\d+_\d+)/,
    // https://vk.com/clip-XXXXXXXX_XXXXXXXXX (клипы)
    /vk\.com\/clip(-?\d+_\d+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const videoId = match[1];
      // VK embed URL формат
      return `https://vk.com/video_ext.php?oid=${videoId.split('_')[0]}&id=${videoId.split('_')[1]}&hd=2`;
    }
  }

  return null;
}