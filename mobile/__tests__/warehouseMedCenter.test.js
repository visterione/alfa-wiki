/**
 * Выбранный медцентр — то, от чего зависит содержимое всего складского раздела.
 *
 * Проверяется здесь, а не на экранах, потому что цена ошибки одинакова во всех
 * четырёх местах и не видна глазом: неверное умолчание или потерянная запись
 * дают не поломку, а просто другой список — человек решит, что имущество
 * пропало, а не что выбран не тот медцентр.
 */

const mockStorage = new Map();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(key => Promise.resolve(mockStorage.has(key) ? mockStorage.get(key) : null)),
  setItem: jest.fn((key, value) => { mockStorage.set(key, value); return Promise.resolve(); }),
  removeItem: jest.fn(key => { mockStorage.delete(key); return Promise.resolve(); }),
}));

// Имя с приставкой mock — иначе jest.mock не пускает переменную в фабрику.
let mockAccess = {allowed: true, medCenterIds: []};
jest.mock('../src/services/api', () => ({
  warehouse: {
    access: jest.fn(() => Promise.resolve({data: mockAccess})),
    tree: jest.fn(() => Promise.resolve({data: {medCenters: []}})),
    inventorySessions: jest.fn(() => Promise.resolve({data: []})),
  },
}));

const load = () => {
  jest.resetModules();
  return require('../src/store/warehouseStore');
};

beforeEach(() => {
  mockStorage.clear();
  mockAccess = {allowed: true, medCenterIds: []};
});

describe('выбор медцентра по умолчанию', () => {
  it('доступ ко всей сети — стартуем со всей сети', async () => {
    const store = load();
    mockAccess = {allowed: true, medCenterIds: []};
    expect(await store.loadWarehouseMedCenter()).toBe('');
  });

  it('в правах один медцентр — он и выбран, спрашивать нечего', async () => {
    const store = load();
    mockAccess = {allowed: true, medCenterIds: ['mc-4']};
    expect(await store.loadWarehouseMedCenter()).toBe('mc-4');
  });

  it('в правах несколько — выбор за человеком, стартуем со всей сети', async () => {
    const store = load();
    mockAccess = {allowed: true, medCenterIds: ['mc-4', 'mc-7']};
    expect(await store.loadWarehouseMedCenter()).toBe('');
  });

  it('сохранённый выбор сильнее умолчания', async () => {
    mockStorage.set('warehouse.medCenterId', 'mc-9');
    const store = load();
    mockAccess = {allowed: true, medCenterIds: ['mc-4']};
    expect(await store.loadWarehouseMedCenter()).toBe('mc-9');
  });

  // Пустая строка в памяти — это осознанно выбранная «вся сеть», а не
  // отсутствие записи: перепутать их значит каждый раз возвращать человека,
  // работающего со всей сетью, в его единственный медцентр.
  it('сохранённая «вся сеть» не подменяется умолчанием', async () => {
    mockStorage.set('warehouse.medCenterId', '');
    const store = load();
    mockAccess = {allowed: true, medCenterIds: ['mc-4']};
    expect(await store.loadWarehouseMedCenter()).toBe('');
  });
});

describe('запоминание', () => {
  it('выбор переживает перезапуск', async () => {
    const first = load();
    await first.loadWarehouseMedCenter();
    first.setWarehouseMedCenter('mc-7');
    await Promise.resolve();

    const second = load();
    expect(await second.loadWarehouseMedCenter()).toBe('mc-7');
  });

  it('выход из аккаунта стирает выбор и из памяти телефона', async () => {
    const store = load();
    await store.loadWarehouseMedCenter();
    store.setWarehouseMedCenter('mc-7');
    store.resetWarehouseAccess();
    await Promise.resolve();

    expect(mockStorage.has('warehouse.medCenterId')).toBe(false);
  });
});

describe('сверка с тем, что есть', () => {
  it('пропавший медцентр сбрасывается на всю сеть', async () => {
    const store = load();
    await store.loadWarehouseMedCenter();
    store.setWarehouseMedCenter('mc-closed');

    store.reconcileWarehouseMedCenter(['mc-4', 'mc-7']);
    expect(store.getWarehouseMedCenter()).toBe('');
  });

  it('существующий остаётся нетронутым', async () => {
    const store = load();
    await store.loadWarehouseMedCenter();
    store.setWarehouseMedCenter('mc-4');

    store.reconcileWarehouseMedCenter(['mc-4', 'mc-7']);
    expect(store.getWarehouseMedCenter()).toBe('mc-4');
  });
});
