'use strict';

/**
 * Шрифты писем (ver. 8.43).
 *
 * ── Почему список, а не свободное поле ───────────────────────────────────────
 *
 * Шрифт в письме — не то же, что шрифт на странице. Почтовый клиент рисует его
 * тем, что стоит на машине получателя, и «красивый шрифт», которого там нет,
 * молча подменяется на что попало — чаще всего на Times New Roman, и вёрстка
 * разъезжается по ширине. Поэтому здесь закрытый список из двух частей:
 *
 *   • БЕЗОПАСНЫЕ — стоят в Windows и macOS с рождения. Доезжают везде и всегда.
 *   • ВЕБ-ШРИФТЫ (Google Fonts) — подгружаются письмом. Работают в Apple Mail,
 *     на iPhone, в Яндекс.Почте и Mail.ru. Gmail и Outlook веб-шрифты вырезают,
 *     и там останется запасной из того же стека. Поэтому у каждого веб-шрифта
 *     подобран запасной похожей ширины: подмена не должна ломать раскладку.
 *
 * Каждое значение — это СТЕК, а не одно имя. Первый шрифт, который нашёлся у
 * получателя, и будет использован; последним всегда стоит родовое семейство.
 */

const FONTS = {
  system: {
    label: 'Системный',
    stack: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  arial: { label: 'Arial', stack: "Arial, Helvetica, sans-serif" },
  verdana: { label: 'Verdana', stack: "Verdana, Geneva, sans-serif" },
  tahoma: { label: 'Tahoma', stack: "Tahoma, Verdana, sans-serif" },
  trebuchet: { label: 'Trebuchet MS', stack: "'Trebuchet MS', Tahoma, sans-serif" },
  georgia: { label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  times: { label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
  courier: { label: 'Courier New', stack: "'Courier New', Courier, monospace" },

  // ── Веб-шрифты ─────────────────────────────────────────────────────────────
  // `web` — то, что уходит в адрес Google Fonts. Начертания ограничены 400 и
  // 700: письму больше не нужно, а каждый лишний вес — это лишние килобайты,
  // которые получатель качает по мобильному интернету.
  montserrat: {
    label: 'Montserrat',
    web: 'Montserrat:wght@400;700',
    stack: "'Montserrat', 'Trebuchet MS', Arial, sans-serif",
  },
  roboto: {
    label: 'Roboto',
    web: 'Roboto:wght@400;700',
    stack: "'Roboto', Arial, Helvetica, sans-serif",
  },
  opensans: {
    label: 'Open Sans',
    web: 'Open+Sans:wght@400;700',
    stack: "'Open Sans', Arial, Helvetica, sans-serif",
  },
  lato: {
    label: 'Lato',
    web: 'Lato:wght@400;700',
    stack: "'Lato', Tahoma, Arial, sans-serif",
  },
  ptserif: {
    label: 'PT Serif',
    web: 'PT+Serif:wght@400;700',
    stack: "'PT Serif', Georgia, 'Times New Roman', serif",
  },
  playfair: {
    label: 'Playfair Display',
    web: 'Playfair+Display:wght@400;700',
    stack: "'Playfair Display', Georgia, 'Times New Roman', serif",
  },
  // Кириллица у Google Fonts есть не у всех семейств — здесь только те, у
  // которых она есть. Латинский шрифт в русском письме подменяется посимвольно,
  // и текст выходит из двух разных гарнитур сразу.
};

const DEFAULT_FONT = 'system';

/** Стек по ключу. Незнакомый ключ — не повод остаться без шрифта. */
const fontStack = (key) => (FONTS[key] || FONTS[DEFAULT_FONT]).stack;

/**
 * Подключение веб-шрифтов.
 *
 * Два способа сразу и это не перестраховка ради перестраховки: часть клиентов
 * читает <link>, часть — только @import внутри <style>. Оба спрятаны от Outlook
 * условным комментарием: Word спотыкается о внешние шрифты и в некоторых
 * версиях перестаёт рисовать письмо целиком.
 */
const webFontTags = (keys) => {
  const families = [...new Set(keys)]
    .map(key => FONTS[key]?.web)
    .filter(Boolean);
  if (!families.length) return '';

  const href = `https://fonts.googleapis.com/css2?${families.map(f => `family=${f}`).join('&')}&display=swap`;
  return `<!--[if !mso]><!-->
<link href="${href}" rel="stylesheet" type="text/css">
<style type="text/css">@import url('${href}');</style>
<!--<![endif]-->`;
};

module.exports = { FONTS, DEFAULT_FONT, fontStack, webFontTags };
