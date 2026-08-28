/**
 * Панель эмодзи: набор и раскладка.
 *
 * Проверяется ровно то, на что жаловались. Первое — набор был скудным, всего
 * три десятка смайлов; теперь их полторы тысячи с делением на категории.
 * Второе — рваный правый край: строки складывались переносом (flexWrap), и
 * последний эмодзи в ряду часто не помещался, оставляя пустое место, как будто
 * его забыли. Поэтому строки теперь считаются заранее, и тест следит, чтобы
 * все они, кроме последней в категории, были заполнены целиком.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {FlatList} from 'react-native';

import {AuthProvider} from '../src/store/authStore';
import {SettingsProvider} from '../src/store/settingsStore';
import EmojiPicker from '../src/components/EmojiPicker';
import {EMOJI_CATEGORIES} from '../src/data/emoji';

function renderPicker() {
  let tree;
  ReactTestRenderer.act(() => {
    // Панель берёт цвета из темы; тема живёт в настройках, а настройки читают
    // текущего пользователя — отсюда оба провайдера
    tree = ReactTestRenderer.create(
      <AuthProvider>
        <SettingsProvider>
          <EmojiPicker onSelect={() => {}} />
        </SettingsProvider>
      </AuthProvider>,
    );
  });
  return tree.root.findByType(FlatList).props.data;
}

describe('набор эмодзи', () => {
  it('покрывает все категории и не содержит пустых символов', () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThanOrEqual(8);
    for (const category of EMOJI_CATEGORIES) {
      expect(category.title).toBeTruthy();
      expect(category.emoji.length).toBeGreaterThan(50);
      expect(category.emoji.every(e => typeof e === 'string' && e.length > 0)).toBe(true);
    }
  });

  it('содержит заметно больше символов, чем прежний короткий список', () => {
    const total = EMOJI_CATEGORIES.reduce((sum, cat) => sum + cat.emoji.length, 0);
    expect(total).toBeGreaterThan(1000);
  });
});

describe('раскладка панели', () => {
  const items = renderPicker();

  it('начинает каждую категорию заголовком', () => {
    const headers = items.filter(item => item.type === 'header').map(item => item.title);
    expect(headers).toEqual(EMOJI_CATEGORIES.map(cat => cat.title));
  });

  it('не оставляет дыр в рядах: неполной может быть только последняя строка категории', () => {
    const rows = items.filter(item => item.type === 'row');
    const columns = Math.max(...rows.map(row => row.row.length));

    items.forEach((item, index) => {
      if (item.type !== 'row') return;
      const next = items[index + 1];
      const isLastOfCategory = !next || next.type === 'header';
      if (!isLastOfCategory) {
        expect(item.row.length).toBe(columns);
      }
    });
  });

  it('показывает весь набор без потерь', () => {
    const shown = items
      .filter(item => item.type === 'row')
      .reduce((sum, item) => sum + item.row.length, 0);
    const total = EMOJI_CATEGORIES.reduce((sum, cat) => sum + cat.emoji.length, 0);
    expect(shown).toBe(total);
  });
});
