import React from 'react';

/**
 * Иконки проводника в духе Finder.
 *
 * Плоские контурные иконки lucide в сетке крупного размера читались как
 * набор чертежей: 48-пиксельный контур папки не отличается по весу от
 * контура документа, и глаз не цепляется за тип объекта. Здесь папка —
 * заливка с объёмом, документ — лист бумаги с загнутым углом, а тип
 * содержимого остаётся прежней иконкой lucide поверх листа. Так тип
 * читается цветом и знаком, а класс объекта (папка/файл) — силуэтом.
 *
 * Градиенты объявлены один раз спрайтом (ExplorerGlyphDefs) и берут цвет
 * из переменных темы: акцент в портале настраивается, и папки не должны
 * оставаться синими, когда весь интерфейс, например, зелёный.
 */

/**
 * Спрайт с градиентами. Монтируется один раз на модуль — если положить
 * <defs> внутрь каждой папки, в документе окажется полсотни одинаковых
 * id, и валидность разметки поедет без всякой пользы.
 *
 * svg не в display:none: скрытый таким образом контейнер в части браузеров
 * перестаёт отдавать градиенты ссылающимся элементам.
 */
export function ExplorerGlyphDefs() {
  return (
    <svg className="explorer-glyph-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="expFolderBack" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--exp-folder-back-1)" />
          <stop offset="1" stopColor="var(--exp-folder-back-2)" />
        </linearGradient>
        <linearGradient id="expFolderFront" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--exp-folder-front-1)" />
          <stop offset="0.34" stopColor="var(--exp-folder-front-2)" />
          <stop offset="1" stopColor="var(--exp-folder-front-3)" />
        </linearGradient>
        {/* Блик по верхней кромке передней створки — именно он даёт
            ощущение стекла, без него створка выглядит плоской заливкой. */}
        <linearGradient id="expFolderSheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.7)" />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Папка: задняя створка с язычком, поверх — передняя с бликом. */
export function FolderGlyph({ size = 48, className = '', style }) {
  return (
    <svg
      className={`explorer-glyph explorer-glyph-folder ${className}`.trim()}
      style={style}
      width={size}
      height={size * (52 / 64)}
      viewBox="0 0 64 52"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 11a7 7 0 0 1 7-7h13.6a4 4 0 0 1 2.9 1.25l4.1 4.35a4 4 0 0 0 2.9 1.25H55a7 7 0 0 1 7 7v25a7 7 0 0 1-7 7H9a7 7 0 0 1-7-7z"
        fill="url(#expFolderBack)"
      />
      <path
        d="M2 20.5a4 4 0 0 1 4-4h52a4 4 0 0 1 4 4V43a7 7 0 0 1-7 7H9a7 7 0 0 1-7-7z"
        fill="url(#expFolderFront)"
      />
      <path
        d="M2 20.5a4 4 0 0 1 4-4h52a4 4 0 0 1 4 4v4H2z"
        fill="url(#expFolderSheen)"
        opacity="0.4"
      />
    </svg>
  );
}

/**
 * Лист документа: белая бумага, загнутый угол, знак типа сверху и цветной
 * корешок с коротким названием типа снизу — как у generic-документов macOS.
 *
 * Цвет берётся из currentColor, который задаёт класс типа (.explorer-icon-*)
 * на обёртке: и знак, и корешок красятся одним значением, а варианта «забыли
 * перекрасить корешок» просто не существует.
 *
 * Знак рисует иконка lucide, а не сам глиф: их полтора десятка на каждый mime,
 * и переносить их в SVG было бы копированием ради копирования.
 */
export function DocGlyph({ size = 48, className = '', label, Icon }) {
  // В списке лист высотой 30 px, и подпись на корешке в нём превращается в
  // грязную полосу. Оставляем от корешка чистую цветную плашку: цветовой код
  // она держит, а тип в списке и так написан словом в колонке «Тип».
  const withLabel = size >= 48;
  const iconSize = Math.round(size * (withLabel ? 0.3 : 0.42));

  return (
    <span
      className={`explorer-glyph explorer-glyph-doc ${className}`.trim()}
      style={{ '--exp-doc-size': `${size}px` }}
      aria-hidden="true"
    >
      <span className="explorer-glyph-doc-fold" />
      {Icon && (
        <span className="explorer-glyph-doc-mark">
          <Icon size={iconSize} strokeWidth={1.9} />
        </span>
      )}
      <span className="explorer-glyph-doc-band">
        {withLabel && label ? <span>{label}</span> : null}
      </span>
    </span>
  );
}
