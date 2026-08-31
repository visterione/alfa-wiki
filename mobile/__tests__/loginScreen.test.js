/**
 * Дымовой тест экрана входа.
 *
 * Оба шага — логин и код — теперь висят в разметке одновременно и ездят лентой,
 * а не подменяют друг друга. Ошибиться тут легко и незаметно: шаг, который
 * уехал, продолжает существовать, и если забыть закрыть его от нажатий и от
 * озвучки, экран останется рабочим на вид, но с двумя формами под пальцем.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {View, TextInput, TouchableOpacity} from 'react-native';
import LoginScreen from '../src/screens/Auth/LoginScreen';

jest.mock('../src/store/authStore', () => ({useAuth: () => ({loginComplete: jest.fn()})}));
// Палитру берём настоящую, а не выдуманную: экран читает из неё десяток цветов,
// и заглушка с парой ключей падала бы на первом же новом обращении
jest.mock('../src/store/settingsStore', () => {
  const {getPalette} = jest.requireActual('../src/theme');
  const palette = getPalette('light');
  return {
    useTheme: () => palette,
    useThemedStyles: factory => factory(palette),
  };
});
jest.mock('../src/services/socket', () => ({connect: jest.fn(() => Promise.resolve())}));
jest.mock('../src/services/api', () => ({
  auth: {login: jest.fn(), verify2FA: jest.fn(), resend2FA: jest.fn()},
  setCachedToken: jest.fn(),
}));

const render = async () => {
  let tree;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<LoginScreen />);
  });
  // Смонтированный экран держит и таймер переноса фокуса, и анимацию высоты
  // на JS-драйвере. Без размонтирования они переживают тест, и jest не выходит.
  trees.push(tree);
  return tree;
};

const trees = [];
afterEach(() => {
  ReactTestRenderer.act(() => {
    trees.splice(0).forEach(t => t.unmount());
  });
});

const texts = tree =>
  tree.root.findAllByType(require('react-native').Text).flatMap(n =>
    n.props.children ? [].concat(n.props.children).filter(x => typeof x === 'string') : [],
  );

test('шапка с названием одна на оба шага, подзаголовка нет', async () => {
  const tree = await render();
  const all = texts(tree);
  expect(all.filter(t => t === 'Альфа Вики')).toHaveLength(1);
  expect(all).not.toContain('Войдите с помощью Альфа ID');
});

test('оба шага отрисованы сразу — иначе ленте нечего двигать', async () => {
  const all = texts(await render());
  expect(all).toContain('Войти');
  expect(all).toContain('Подтверждение входа');
  expect(all).toContain('Введите код, отправленный на почту');
  expect(all).toContain('Отправить ещё раз');
  expect(all).toContain('Назад');
});

test('уехавший шаг закрыт от нажатий и от озвучки', async () => {
  const tree = await render();
  const steps = tree.root
    .findAllByType(View)
    .filter(n => n.props.accessibilityElementsHidden !== undefined);

  expect(steps).toHaveLength(2);
  // На старте активен шаг с логином, второй должен быть выключен целиком
  expect(steps[0].props.pointerEvents).toBe('auto');
  expect(steps[0].props.accessibilityElementsHidden).toBe(false);
  expect(steps[1].props.pointerEvents).toBe('none');
  expect(steps[1].props.accessibilityElementsHidden).toBe(true);
  expect(steps[1].props.importantForAccessibility).toBe('no-hide-descendants');
});

test('после ввода логина шаги меняются местами, а не подменяют друг друга', async () => {
  const {auth: authApi} = require('../src/services/api');
  authApi.login.mockResolvedValue({data: {requiresTwoFactor: true, userId: 42}});

  const tree = await render();
  const inputs = tree.root.findAllByType(TextInput);
  await ReactTestRenderer.act(async () => {
    inputs[0].props.onChangeText('ivanov');
    inputs[1].props.onChangeText('secret123');
  });

  const submit = tree.root
    .findAllByType(TouchableOpacity)
    .find(n => n.props.activeOpacity === 0.85);
  await ReactTestRenderer.act(async () => {
    await submit.props.onPress();
  });

  const steps = tree.root
    .findAllByType(View)
    .filter(n => n.props.accessibilityElementsHidden !== undefined);
  expect(steps[0].props.pointerEvents).toBe('none');
  expect(steps[1].props.pointerEvents).toBe('auto');
  // Шаг с логином никуда не делся — он уехал и должен остаться в разметке
  expect(texts(tree)).toContain('Войти');
});
