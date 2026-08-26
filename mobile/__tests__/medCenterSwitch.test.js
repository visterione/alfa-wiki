/**
 * Переключатель медцентров: как он выглядит.
 *
 * Проверяется то, что уже один раз сломалось и чего не видно в коде. Знак
 * медцентра обязан лежать на белой плитке — логотипы приходят прозрачными PNG,
 * нарисованными для белого листа, и в тёмной теме от знака оставался чёрный
 * прямоугольник. Своей заливки у кнопки в шапке быть не должно: вместе с
 * плиткой знака получалась кнопка внутри кнопки. А строки списка обязаны иметь
 * поля по бокам — без них логотип и галочка упирались в края экрана.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {StyleSheet} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

const mockTree = {
  medCenters: [
    {
      id: 'mc1', name: 'МЦ Альфа', address: 'ул. Владимирская, 93',
      logoSquareUrl: '/uploads/mc/alfa.png',
      floors: [{id: 'f1', number: 1, rooms: [{id: 'r1', number: '101'}]}],
    },
    {
      // Логотипа нет — плитка заливается фирменным цветом и несёт инициалы
      id: 'mc2', name: 'МЦ Линия', color: '#FF6B00',
      floors: [{id: 'f2', number: 1, rooms: [{id: 'r2', number: '201'}]}],
    },
  ],
};

jest.mock('../src/services/api', () => ({
  warehouse: {
    access: jest.fn(() => Promise.resolve({data: {allowed: true, medCenterIds: []}})),
    tree: jest.fn(() => Promise.resolve({data: mockTree})),
    inventorySessions: jest.fn(() => Promise.resolve({data: []})),
  },
}));

const {AuthProvider} = require('../src/store/authStore');
const {SettingsProvider} = require('../src/store/settingsStore');
const MedCenterSwitch = require('../src/screens/Warehouse/MedCenterSwitch').default;

async function render() {
  let tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      // Шторка спрашивает безопасные поля экрана — отсюда SafeAreaProvider с
      // заданными размерами: без них хук падает ещё до отрисовки.
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 390, height: 844},
          insets: {top: 47, left: 0, right: 0, bottom: 34},
        }}>
        <AuthProvider>
          <SettingsProvider><MedCenterSwitch /></SettingsProvider>
        </AuthProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
}

const flat = style => StyleSheet.flatten(style) || {};

// Ищем по отрисованным хост-узлам, а не по Pressable: до хоста доезжает
// итоговый стиль, а сам Pressable в дереве представлен своим View.
const hosts = (tree, predicate) => tree.root.findAll(
  node => typeof node.type === 'string' && predicate(node),
);
const headerButton = tree => hosts(tree, n => n.props.accessibilityRole === 'button')[0];

/** Плитка знака — ближайший предок со скруглением: между ней и содержимым
 *  бывают служебные обёртки, и «родитель» не всегда попадает в неё. */
const markAround = (node) => {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (flat(cur.props?.style).borderRadius) return flat(cur.props.style);
  }
  return {};
};

/** Открыть шторку: до нажатия список медцентров не смонтирован. */
async function openSheet(tree) {
  await ReactTestRenderer.act(async () => { headerButton(tree).props.onClick(); });
}

/** Строки списка — нажимаемые ряды: у подложки шторки ряда нет. */
const rowsOf = tree => hosts(
  tree,
  n => n.props.onClick && !n.props.accessibilityRole
    && flat(n.props.style).flexDirection === 'row',
);

test('логотип лежит на белой плитке со скруглёнными углами', async () => {
  const tree = await render();
  await openSheet(tree);

  const image = hosts(tree, n => n.type === 'Image')[0];
  const mark = markAround(image);

  expect(mark.backgroundColor).toBe('#FFFFFF');
  expect(mark.borderRadius).toBeGreaterThan(0);
  // Квадрат, а не круг: у круга срезались бы углы фирменного знака
  expect(mark.borderRadius).toBeLessThan(mark.width / 2);
  expect(mark.width).toBe(mark.height);
  // Поля вокруг знака, чтобы он не упирался в края плитки
  expect(mark.padding).toBeGreaterThan(0);
});

test('у кнопки в шапке нет своей заливки — иначе кнопка в кнопке', async () => {
  const tree = await render();
  expect(flat(headerButton(tree).props.style).backgroundColor).toBeUndefined();
});

test('строки списка отступают от краёв экрана', async () => {
  const tree = await render();
  await openSheet(tree);

  const rows = rowsOf(tree);
  expect(rows.length).toBe(3); // «Все медцентры» и два медцентра

  for (const row of rows) {
    expect(flat(row.props.style).paddingHorizontal).toBeGreaterThanOrEqual(16);
  }
});

test('медцентр без логотипа получает плитку своего цвета с инициалами', async () => {
  const tree = await render();
  await openSheet(tree);

  const initials = hosts(tree, n => n.children?.[0] === 'МЛ');
  expect(initials.length).toBe(1);
  expect(markAround(initials[0]).backgroundColor).toBe('#FF6B00');
});
