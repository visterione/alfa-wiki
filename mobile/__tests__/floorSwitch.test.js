/**
 * Переключатель этажей: раскладка панели.
 *
 * Проверяется ровно то, что было сломано в первой версии и что не видно в
 * коде: панель обязана занимать всю ширину (клетки растягиваются), а не
 * обнимать содержимое, оставляя половину экрана пустой, и не тянуться вниз —
 * прокручиваемая версия съедала пол-экрана и обрезала кнопкам низ.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {StyleSheet, Text, View} from 'react-native';

import {AuthProvider} from '../src/store/authStore';
import {SettingsProvider} from '../src/store/settingsStore';
import FloorSwitch from '../src/screens/Warehouse/FloorSwitch';

const floor = (key, short, extra = {}) => ({key, short, title: `${short} этаж`, ...extra});

function render(element) {
  let tree;
  ReactTestRenderer.act(() => {
    // Панель берёт цвета из темы; тема живёт в настройках, а настройки читают
    // текущего пользователя — отсюда оба провайдера.
    tree = ReactTestRenderer.create(
      <AuthProvider>
        <SettingsProvider>{element}</SettingsProvider>
      </AuthProvider>,
    );
  });
  return tree;
}

// Кнопка — это Pressable: у самого элемента лежит onPress, у отрисованного им
// хоста — итоговый стиль. Спрашиваем каждый о своём.
const buttons = tree => tree.root.findAll(
  node => node.props?.accessibilityRole === 'button' && typeof node.props?.onPress === 'function',
);
const cells = tree => tree.root.findAllByProps({accessibilityRole: 'button'})
  .filter(node => typeof node.type === 'string');

test('один этаж — панели нет: выбирать не из чего', () => {
  const tree = render(<FloorSwitch floors={[floor('f1', '1')]} value="f1" onChange={() => {}} />);
  expect(tree.toJSON()).toBeNull();
});

test('клетки делят ширину поровну и не тянут панель вниз', () => {
  const tree = render(
    <FloorSwitch floors={[floor('f1', '1'), floor('f2', '2')]} value="f1" onChange={() => {}} />,
  );

  const panel = StyleSheet.flatten(tree.root.findAllByType(View)[0].props.style);
  expect(panel.flexDirection).toBe('row');
  // Ряд переносится, а не уезжает за край, когда этажей слишком много
  expect(panel.flexWrap).toBe('wrap');
  // Высота панели считается по содержимому: ничего, что тянуло бы её вниз
  expect(panel.height).toBeUndefined();
  expect(panel.flex).toBeUndefined();

  for (const cell of cells(tree)) {
    const style = StyleSheet.flatten(cell.props.style);
    // Растягиваются на свободную ширину — из-за этого панель во всю ширину
    expect(style.flexGrow).toBe(1);
    // Но не уже пальца
    expect(style.minWidth).toBe(44);
    expect(style.height).toBe(40);
  }
});

test('своего верхнего отступа у панели нет: интервалы идут сверху вниз', () => {
  // Второй отступ складывался бы с чужим — из-за этого панель прижималась к
  // шапке экрана, а от поиска под ней отходила вдвое дальше.
  const tree = render(
    <FloorSwitch
      floors={[floor('f1', '1'), floor('f2', '2')]}
      value="f1"
      onChange={() => {}}
      spacing={8}
    />,
  );

  const panel = StyleSheet.flatten(tree.root.findAllByType(View)[0].props.style);
  expect(panel.marginTop).toBeUndefined();
  expect(panel.marginBottom).toBe(8);
});

test('в клетке только номер, выбранная отличается заливкой', () => {
  const tree = render(
    <FloorSwitch floors={[floor('f1', '1'), floor('f4', '4')]} value="f4" onChange={() => {}} />,
  );

  const texts = tree.root.findAllByType(Text).map(t => t.props.children);
  // Ни «этаж», ни счётчиков — только числа
  expect(texts).toEqual(['1', '4']);

  const [first, second] = cells(tree).map(cell => StyleSheet.flatten(cell.props.style));
  expect(first.backgroundColor).not.toBe(second.backgroundColor);
});

test('нажатие отдаёт ключ этажа, а не индекс', () => {
  const picked = [];
  const tree = render(
    <FloorSwitch
      floors={[floor('f1', '1'), floor('f2', '2')]}
      value="f1"
      onChange={key => picked.push(key)}
    />,
  );

  ReactTestRenderer.act(() => { buttons(tree)[1].props.onPress(); });
  expect(picked).toEqual(['f2']);
});

test('склад показывается значком: номера у него нет', () => {
  const tree = render(
    <FloorSwitch
      floors={[floor('f1', '1'), {key: 'svc', title: 'Склады', service: true}]}
      value="f1"
      onChange={() => {}}
    />,
  );

  // Текстовая клетка одна — вторая рисуется значком
  expect(tree.root.findAllByType(Text).map(t => t.props.children)).toEqual(['1']);
  expect(cells(tree)).toHaveLength(2);
});
