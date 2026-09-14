/**
 * Слот для инструментов вкладки в общей строке модуля «Маркетинг» (ver. 8.22).
 *
 * Переключатель вкладок принадлежит модулю, а поиск и фильтры — конкретной
 * вкладке, но живут они в одной строке. Вкладка отдаёт свои инструменты сюда
 * порталом: держать поиск акций в состоянии модуля значило бы учить модуль
 * устройству каждой вкладки, а карта и анонсы получали бы чужое поле ввода.
 *
 * Отдельный файл, а не index.js, — чтобы вкладка не импортировала модуль,
 * который импортирует её саму: круговой импорт здесь оставил бы MarketingTools
 * неопределённым на первой отрисовке.
 */

import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

export const ToolsSlotContext = createContext(null);

export function MarketingTools({ children }) {
  const slot = useContext(ToolsSlotContext);
  return slot ? createPortal(children, slot) : null;
}
