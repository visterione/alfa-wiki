module.exports = {
  preset: 'react-native',
  // Библиотеки RN поставляются как ESM и по умолчанию не проходят через Babel:
  // jest спотыкается на первом же `import` внутри node_modules. Пресет
  // react-native пропускает через трансформ только сам react-native, поэтому
  // список расширен вручную — иначе тест падает ещё на импортах.
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@react-navigation|@notifee' +
      '|@react-native-firebase|@react-native-async-storage|@react-native-documents' +
      '|lucide-react-native))',
  ],
  setupFiles: ['<rootDir>/jest.setup.js'],
};
