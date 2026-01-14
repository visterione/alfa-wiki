// VkVideo.js - Расширение TipTap для встраивания VK видео
// Расположение: frontend/src/components/VkVideo.js

import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Расширение TipTap для встраивания VK видео
 * Использует iframe-код для встраивания, полученный от ВКонтакте
 * Формат iframe: <iframe src="https://vk.com/video_ext.php?oid=...&id=...&hash=..." width="..." height="..." ...></iframe>
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
 * Парсит iframe-код VK видео и извлекает параметры для встраивания
 * @param {string} iframeCode - HTML код iframe для встраивания VK видео
 * @returns {object|null} - Объект с параметрами { src, width, height } или null если код невалиден
 */
export function parseVkVideoIframe(iframeCode) {
  if (!iframeCode) return null;

  // Убираем переносы строк и лишние пробелы
  const cleanedCode = iframeCode.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Ищем iframe с vk.com/video_ext.php
  const iframeMatch = cleanedCode.match(/<iframe[^>]*src=["']([^"']*vk\.com\/video_ext\.php[^"']*)["'][^>]*>/i);

  if (!iframeMatch) return null;

  const src = iframeMatch[1];

  // Извлекаем width и height из атрибутов или стиля iframe
  let width = 640; // значение по умолчанию
  let height = 360; // значение по умолчанию

  // Пробуем извлечь width атрибут
  const widthMatch = cleanedCode.match(/width=["']?(\d+)["']?/i);
  if (widthMatch) {
    width = parseInt(widthMatch[1]);
  }

  // Пробуем извлечь height атрибут
  const heightMatch = cleanedCode.match(/height=["']?(\d+)["']?/i);
  if (heightMatch) {
    height = parseInt(heightMatch[1]);
  }

  return {
    src,
    width,
    height
  };
}