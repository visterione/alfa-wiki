import {useSafeAreaInsets} from 'react-native-safe-area-context';

/**
 * Место, которое занимает нижняя панель.
 *
 * Панель лежит поверх экранов, а не рядом с ними (см. AlfaTabBar), поэтому
 * высоту под неё экраны резервируют сами — отступом снизу у прокручиваемого
 * содержимого и у всего, что прижато к нижнему краю.
 *
 * Отдельным модулем, а не константой в AlfaTabBar: иначе каждый экран тянул бы
 * за собой всю панель с её SVG и градиентами ради одного числа.
 */

export const TAB_BAR_HEIGHT = 68;

/** Высота панели вместе с жестовой полосой под ней. */
export function useTabBarInset() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + insets.bottom;
}
