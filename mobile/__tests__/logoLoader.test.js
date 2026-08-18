/**
 * Индикатор загрузки: где он оказывается на экране.
 *
 * Проверяется ровно то, что было сломано: `<LogoLoader />` без параметров —
 * это полноэкранное состояние, и знак обязан стоять по центру, а не в левом
 * верхнем углу. Встроенные индикаторы (в кнопке, в аватарке) центрирующей
 * обёртки получать не должны — она растянула бы их на всю кнопку.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {StyleSheet} from 'react-native';

import {AuthProvider} from '../src/store/authStore';
import {SettingsProvider} from '../src/store/settingsStore';
import LogoLoader from '../src/components/LogoLoader';

function rootStyle(element) {
  let tree;
  ReactTestRenderer.act(() => {
    // Индикатор берёт цвет из темы; тема живёт в настройках, а настройки
    // читают текущего пользователя — отсюда оба провайдера.
    tree = ReactTestRenderer.create(
      <AuthProvider>
        <SettingsProvider>{element}</SettingsProvider>
      </AuthProvider>,
    );
  });
  const root = tree.root.findAllByType('View')[0];
  return StyleSheet.flatten(root.props.style);
}

test('без параметров индикатор занимает экран и центрируется', () => {
  const style = rootStyle(<LogoLoader />);
  expect(style.flex).toBe(1);
  expect(style.alignItems).toBe('center');
  expect(style.justifyContent).toBe('center');
});

test('с заданной шириной индикатор остаётся встроенным', () => {
  const style = rootStyle(<LogoLoader width={40} />);
  expect(style.flex).toBeUndefined();
  expect(style.width).toBe(40);
});

test('ширину можно задать и полноэкранному индикатору', () => {
  const style = rootStyle(<LogoLoader width={64} screen />);
  expect(style.flex).toBe(1);
});
